// src/routes/subscription.js
import express from 'express';
import { Op } from 'sequelize';
import Subscription from '../models/Subscription.js';
import User from '../models/User.js';
import { authMiddleware } from '../auth.js';
import 'dotenv/config';

const router = express.Router();



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


router.post('/set_webhook',authMiddleware ,async (req, res) => {
  try {
    const userId = req.user.id; 
    const { webhookUrl } = req.body;

    if (!webhookUrl) {
      return res.status(400).json({ message: 'webhookUrl is required' });
    }

    
    if (!isValidHttpsUrl(webhookUrl))
      return res
        .status(400)
        .json({ message: 'Invalid webhook URL — must be HTTPS' });


    const subscription = await Subscription.findOne({ userId });


    subscription.webhookUrl = webhookUrl;
    await subscription.save();

    return res.json({
      message: 'Webhook URL updated successfully',
      webhookUrl: subscription.webhookUrl,
    });
  } catch (err) {
    console.error('Update webhook error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

function isValidHttpsUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';  
  } catch (err) {
    return false;
  }
}

export default router