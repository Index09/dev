import express from "express";
import {
  hashPassword,
  verifyPassword,
  signToken,
  authMiddleware,
} from "../auth.js";
import User from "../models/User.js";
import Subscription from "../models/Subscription.js";
import { Op } from "sequelize";
import sendWmsg from "../util/sendWmsg.js";
import jwt from "jsonwebtoken";

const router = express.Router();
// Register
router.post("/verify-otp", async (req, res) => {
  try {
    const { name, phone, email, password, otp } = req.body;

    if (!email || !password || !phone || !otp)
      return res.status(400).json({ error: "All fields are required" });

    // تحقق من كود OTP
    const storedOtp = otpStore.get(phone);
    if (storedOtp !== otp)
      return res.status(400).json({ error: "Invalid or expired OTP" });

    const exists = await User.findOne({ where: { email } });
    if (exists)
      return res.status(400).json({ error: "Email already registered" });

    const passwordHash = await hashPassword(password);

    const user = await User.create({ name, phone, email, passwordHash });

    otpStore.delete(phone);

    const token = jwt.sign({ user }, "whatsApp_service_Walidreda201559@@@");

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

const otpStore = new Map();
router.post("/send-otp", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone number required" });

    const exists = await User.findOne({ where: { phone } });

    if (exists)
      return res.status(400).json({ error: "رقم الهاتف موجود بالفعيل" });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    otpStore.set(phone, otp);
    try {
      sendWmsg(`كود تفعيل حسابك : ${otp}`, phone);
    } catch (error) {}
    console.log(`OTP for ${phone}: ${otp}`);
    res.json({ success: true, message: "OTP sent successfully", otp });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "email and password required" });

    const user = await User.findOne({ where: { email } });
    if (!user) return res.status(400).json({ error: "Invalid credentials" });

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return res.status(400).json({ error: "Invalid credentials" });

    const token = signToken(user);
    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/subscribe", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    //This is free Plan for now and the payment is disabled !!!!!!!!!!!!
    const existing = await Subscription.findOne({
      where: {
        userId,
        plan_type: "free",
      },
      order: [["endAt", "DESC"]],
    });

    if (existing) {
      return res.status(400).json({
        error: "المستخدم يستخدم هذه الخطة حالياً",
        subscription: existing,
      });
    }

    const plan = req.body.plan;
    const startAt = new Date();
    const endAt = new Date(startAt);
    endAt.setDate(endAt.getDate() + 7);

    const sub = await Subscription.create({
      userId,
      startAt,
      endAt,
      status: "active",
      plan_type: plan,
    });

    res.json({ success: true, subscription: sub });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/subscriptions", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const subs = await Subscription.findAll({
      where: { userId },
      order: [["startAt", "DESC"]],
    });
    return res.json({ subscriptions: subs });
  } catch (err) {
    console.error("GET /subscriptions error", err);
    return res.status(500).json({ error: "Failed to load subscriptions" });
  }
});

export default router;
