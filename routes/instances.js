// src/routes/instances.js
import express from "express";
import { authMiddleware } from "../auth.js";
import Device from "../models/Device.js";
import Subscription from "../models/Subscription.js";
import instanceManager from "../instanceManager.js";
import { Op } from "sequelize";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { whatsappSafeMiddleware } from "../middleware/safeMessageMiddleware.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

router.post("/", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    

    const now = new Date();
    const sub = await Subscription.findOne({
      where: { userId, endAt: { [Op.gt]: now }, status: "active" },
      order: [["endAt", "DESC"]],
    });
    if (!sub) return res.status(403).json({ error: "No active subscription" });

    const existing = await Device.findOne({
      where: { userId, status: { [Op.not]: "destroyed" } },
    });
    if (existing)
      return res.status(400).json({ error: "User already has a device" });

    const instanceId = `user_${userId}`;

    const device = await Device.create({
      userId,
      instanceId,
      meta: {},
      status: "initializing",
    });

    instanceManager
      .ensureInstance(instanceId)
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

router.get("/", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const dev = await Device.findOne({where: { userId }});

    const subscription = await Subscription.findOne({
      where: { userId },
      order: [['createdAt', 'DESC']], 
    });
    return res.json({ device: dev , subscription });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch device" });
  }
});

router.get("/:instanceId/qr", authMiddleware, async (req, res) => {
  const { instanceId } = req.params;

  try {
    let qr = instanceManager.getQR(instanceId);

    const sessionDir = path.resolve(process.cwd(), "sessions", instanceId);
    const folderExists = fs.existsSync(sessionDir);

    if (!qr || !folderExists) {
      console.log(
        `[${instanceId}] No QR/folder found, creating new instance...`
      );
      console.log(instanceId);

      await instanceManager.ensureInstance(instanceId);

      qr = instanceManager.getQR(instanceId);

      if (!qr) {
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
router.post(
  "/send",
  authMiddleware,
  whatsappSafeMiddleware,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { to, body } = req.body;
      if (!to || !body)
        return res.status(400).json({ error: "to and body required" });
      const dev = await Device.findOne({
        where: {
          userId,
        },
      });
      if (!dev) return res.status(404).json({ error: "No ready device found" });

      const socket = instanceManager.getClient(dev.instanceId);
      if (!socket)
        return res.status(500).json({ error: "Instance client not available" });


      if (!socket.user) {
        return res.status(500).json({ error: "WhatsApp connection not ready" });
      }

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
  }
);
router.post("/:id/logout", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const dev = await Device.findOne({
      where: { userId },
    });
    if (!dev) return res.status(404).json({ error: "No device" });

    const instanceId = dev.instanceId;
    try {
      await instanceManager.destroyInstance(instanceId);
    } catch (err) {
      console.warn("instanceManager.destroyInstance error:", err.message);
    }

    await dev.destroy();

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to destroy" });
  }
});

export default router;
