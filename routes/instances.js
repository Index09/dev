// src/routes/instances.js
import express from "express";
import { authMiddleware } from "../auth.js";
import Device from "../models/Device.js";
import Subscription from "../models/Subscription.js";
import instanceManager from "../instanceManager.js";
import { Op } from "sequelize";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { whatsappSafeMiddleware } from '../middleware/safeMessageMiddleware.js'


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Create instance for logged user
router.post("/", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { autoReply } = req.body;

    // ✅ Check subscription validity
    const now = new Date();
    const sub = await Subscription.findOne({
      where: { userId, endAt: { [Op.gt]: now }, status: "active" },
      order: [["endAt", "DESC"]],
    });
    if (!sub) return res.status(403).json({ error: "No active subscription" });

    // ✅ Check if user already has device
    const existing = await Device.findOne({
      where: { userId, status: { [Op.not]: "destroyed" } },
    });
    if (existing)
      return res.status(400).json({ error: "User already has a device" });

    // ✅ Use deterministic instanceId
    const instanceId = `user_${userId}`;

    // ✅ Create device in DB
    const device = await Device.create({
      userId,
      instanceId,
      meta: { autoReply: autoReply || null },
      status: "initializing",
    });

    // ✅ Initialize instance (new instance manager handles persistence/reconnect)
    instanceManager
      .ensureInstance(instanceId, { autoReply })
      .then(async (meta) => {
        await device.update({ status: "ready", meta });
      })
      .catch(async (err) => {
        console.warn("Instance creation error:", err.message);
        await device.update({ status: "error", meta: { error: err.message } });
      });

    return res.json({ success: true, device });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get the current user's device
router.get("/", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const dev = await Device.findOne({
      where: { userId, status: { [Op.not]: "destroyed" } },
    });
    if (!dev) return res.status(404).json({ error: "No device found" });

    return res.json({ device: dev });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch device" });
  }
});

router.get("/:instanceId/qr", authMiddleware, async (req, res) => {
  const { instanceId } = req.params;

  try {
    // 1. Check if client exists and has QR
    let qr = instanceManager.getQR(instanceId);

    // 2. Check if session folder exists (Baileys uses different path)
    const sessionDir = path.resolve(process.cwd(), "sessions", instanceId);
    const folderExists = fs.existsSync(sessionDir);

    if (!qr || !folderExists) {
      console.log(
        `[${instanceId}] No QR/folder found, creating new instance...`
      );
      console.log(instanceId);

      // Ensure instance exists - this will generate a new QR if needed
      await instanceManager.ensureInstance(instanceId);

      // Get the QR again after ensuring instance
      qr = instanceManager.getQR(instanceId);

      // If still no QR, the instance might be connecting or ready
      if (!qr) {
        // Check the current status
        const socket = instanceManager.getClient(instanceId);
        if (socket && socket.user) {
          return res.status(200).json({
            instanceId,
            status: "authenticated",
            message: "Device is already authenticated and ready",
          });
        } else {
          // Wait a bit for QR to generate and try again
          await new Promise((resolve) => setTimeout(resolve, 2000));
          qr = instanceManager.getQR(instanceId);
        }
      }
    }

    if (!qr) {
      // Check if instance exists and what status it's in
      const socket = instanceManager.getClient(instanceId);
      if (socket) {
        if (socket.user) {
          return res.status(200).json({
            instanceId,
            status: "authenticated",
            message: "Device is already authenticated and ready",
          });
        } else {
          return res.status(202).json({
            instanceId,
            status: "connecting",
            message: "Device is connecting, QR may be generated soon",
          });
        }
      }

      return res.status(404).json({
        error: "No QR available",
        details: "Instance may be connecting or already authenticated",
      });
    }

    res.json({
      instanceId,
      qr,
      status: "qr_available",
    });
  } catch (err) {
    console.error(`QR generation error for ${instanceId}:`, err);
    res.status(500).json({
      error: "QR generation failed",
      details: err.message,
    });
  }
});
// Send message
router.post("/send", authMiddleware, whatsappSafeMiddleware ,async (req, res) => {
  try {
    const userId = req.user.id;
    const { to, body } = req.body;
    if (!to || !body)
      return res.status(400).json({ error: "to and body required" });

    const dev = await Device.findOne({
      where: {
        userId,
        // status: {
        //   [Op.or]: ["ready", "authenticated"],
        // },
      },
    });
    if (!dev) return res.status(404).json({ error: "No ready device found" });

    const socket = instanceManager.getClient(dev.instanceId);
    if (!socket)
      return res.status(500).json({ error: "Instance client not available" });

    // Check if socket is actually connected and ready
    if (!socket.user) {
      return res.status(500).json({ error: "WhatsApp connection not ready" });
    }

    // Normalize phone number and create JID
    const phone = to.replace(/[^0-9]/g, "");

    // Baileys uses different JID formats - try both common ones
    let chatId = `${phone}@s.whatsapp.net`; // Standard JID format

    // Alternative: check if it's a group or broadcast
    if (phone.includes("-")) {
      chatId = `${phone}@g.us`; // Group JID
    }

    // Send message using Baileys format
    await socket.sendMessage(chatId, { text: body });

    const instanceId = dev.instanceId;
    await Device.increment("messagesCount", { where: { instanceId } });

    return res.json({ success: true });
  } catch (err) {
    console.error("Send message error:", err);

    // Handle specific Baileys errors
    if (err.message.includes("not-authorized")) {
      return res.status(401).json({ error: "WhatsApp session expired" });
    }
    if (err.message.includes("not-connected")) {
      return res.status(500).json({ error: "WhatsApp not connected" });
    }
    if (err.message.includes("group-not-found")) {
      return res.status(404).json({ error: "Group not found" });
    }
    if (err.message.includes("number-not-registered")) {
      return res
        .status(404)
        .json({ error: "Phone number not registered on WhatsApp" });
    }

    res.status(500).json({ error: "Send failed", details: err.message });
  }
});
router.post("/:id/logout", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const dev = await Device.findOne({
      where: { userId},
    });
    if (!dev) return res.status(404).json({ error: "No device" });

    const instanceId = dev.instanceId;

    // ✅ Destroy instance safely
    try {
      await instanceManager.destroyInstance(instanceId);
    } catch (err) {
      console.warn("instanceManager.destroyInstance error:", err.message);
    }


    await dev.destroy()

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to destroy" });
  }
});

export default router
