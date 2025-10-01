// src/routes/subscription.js
const express = require('express');
const { Op } = require('sequelize');
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const { authMiddleware } = require('../auth');
require('dotenv').config();

const router = express.Router();

/**
 * POST /subscribe
 * Create a 1-month subscription for the authenticated user.
 * (This is a simple flow without payment integration.)
 */
router.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Optionally: reject if user already has an active subscription (or allow stacking)
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

/**
 * GET /status
 * Returns current subscription status for the authenticated user.
 */
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

/**
 * POST /cancel
 * Cancel the active subscription for the authenticated user.
 */
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

/**
 * POST /webhook
 * Example payment gateway webhook handler that creates a subscription after successful payment.
 * Expects JSON body: { userId: <number>, months: <number> }
 * Protect with WEBHOOK_SECRET header (optional): x-webhook-secret: <WEBHOOK_SECRET>
 */
router.post('/webhook', express.json(), async (req, res) => {
  try {
    const webhookSecret = process.env.WEBHOOK_SECRET;
    if (webhookSecret) {
      const headerSecret = req.headers['x-webhook-secret'];
      if (!headerSecret || headerSecret !== webhookSecret) {
        return res.status(403).json({ error: 'Invalid webhook secret' });
      }
    }

    const { userId, months = 1 } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    // ensure user exists
    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Create subscription starting today for `months` months
    const startAt = new Date();
    const endAt = new Date(startAt);
    endAt.setMonth(endAt.getMonth() + Number(months));

    const sub = await Subscription.create({
      userId,
      startAt,
      endAt,
      status: 'active'
    });

    // respond quickly to the payment gateway (it may expect 200)
    return res.json({ success: true, subscription: sub });
  } catch (err) {
    console.error('POST /webhook error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;