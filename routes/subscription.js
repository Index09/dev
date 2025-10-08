// src/routes/subscription.js
import express from 'express';
import { Op } from 'sequelize';
import Subscription from '../models/Subscription.js';
import User from '../models/User.js';
import { authMiddleware } from '../auth.js';
import 'dotenv/config';

const router = express.Router();


router.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const now = new Date();
    const existing = await Subscription.findOne({
      where: {
        userId,
        endAt: { [Op.gt]: now },
        status: 'active'
      },
      order: [['endAt', 'DESC']]
    });

    if (existing) {
      return res.status(400).json({
        error: 'User already has an active subscription',
        subscription: existing
      });
    }

    const startAt = new Date();
    const endAt = new Date(startAt);
    endAt.setMonth(endAt.getMonth() + 1); // add 1 month
    const sub = await Subscription.create({
      userId,
      startAt,
      endAt,
      status: 'active'
    });
    return res.json({ success: true, subscription: sub });
  } catch (err) {
    console.error('POST /subscribe error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});


router.get('/status', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();

    const sub = await Subscription.findOne({
      where: {
        userId,
        endAt: { [Op.gt]: now },
        status: 'active'
      },
      order: [['endAt', 'DESC']]
    });

    if (!sub) {
      return res.json({ active: false });
    }

    return res.json({
      active: true,
      subscription: {
        id: sub.id,
        startAt: sub.startAt,
        endAt: sub.endAt,
        status: sub.status
      }
    });
  } catch (err) {
    console.error('GET /status error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});
router.post('/cancel', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();

    const sub = await Subscription.findOne({
      where: {
        userId,
        endAt: { [Op.gt]: now },
        status: 'active'
      },
      order: [['endAt', 'DESC']]
    });

    if (!sub) return res.status(400).json({ error: 'No active subscription to cancel' });

    sub.status = 'cancelled';
    await sub.save();

    return res.json({ success: true, subscription: sub });
  } catch (err) {
    console.error('POST /cancel error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});


export default router