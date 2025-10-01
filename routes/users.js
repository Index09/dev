const express = require('express');
const { hashPassword, verifyPassword, signToken, authMiddleware } = require('../auth');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const { Op } = require('sequelize');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    // Basic email check
    const exists = await User.findOne({ where: { email } });
    if (exists) return res.status(400).json({ error: 'Email already registered' });

    const passwordHash = await hashPassword(password);
    const user = await User.create({ email, passwordHash });

    const token = signToken(user);
    res.json({ success: true, token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    const user = await User.findOne({ where: { email } });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });

    const token = signToken(user);
    res.json({ success: true, token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Subscribe (1 month)
router.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Create a subscription for 1 month from now
    const startAt = new Date();
    const endAt = new Date(startAt);
    endAt.setMonth(endAt.getMonth() + 1); // 1 month

    const sub = await Subscription.create({
      userId,
      startAt,
      endAt,
      status: 'active'
    });

    res.json({ success: true, subscription: sub });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});



router.get('/subscriptions', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const subs = await Subscription.findAll({
      where: { userId },
      order: [['startAt', 'DESC']]
    });
    return res.json({ subscriptions: subs });
  } catch (err) {
    console.error('GET /subscriptions error', err);
    return res.status(500).json({ error: 'Failed to load subscriptions' });
  }
});

module.exports = router;