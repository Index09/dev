import express from 'express';
import { Op } from 'sequelize';
import User from '../models/User.js';
import Device from '../models/Device.js';
import Subscription from '../models/Subscription.js';

const router = express.Router();

// Get all users with pagination
router.get('/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const { count, rows: users } = await User.findAndCountAll({
      include: [
        {
          model: Device,
          attributes: ['id', 'instanceId', 'messagesCount', 'status', 'createdAt']
        },
        {
          model: Subscription,
          attributes: ['id', 'startAt', 'endAt', 'status']
        }
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    const totalPages = Math.ceil(count / limit);

    res.json({
      success: true,
      users,
      totalPages,
      totalUsers: count,
      currentPage: page
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'خطأ في الخادم'
    });
  }
});

// Delete user device
router.delete('/users/:userId/device', async (req, res) => {
  try {
    const { userId } = req.params;

    const device = await Device.findOne({ where: { userId } });
    
    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'لم يتم العثور على جهاز لهذا المستخدم'
      });
    }

    await Device.destroy({ where: { userId } });

    res.json({
      success: true,
      message: 'تم حذف الجهاز بنجاح'
    });
  } catch (error) {
    console.error('Error deleting device:', error);
    res.status(500).json({
      success: false,
      message: 'خطأ في الخادم'
    });
  }
});

// Extend subscription
router.post('/users/:userId/subscription/extend', async (req, res) => {
  try {
    const { userId } = req.params;
    const { months } = req.body;

    if (!months || months < 1) {
      return res.status(400).json({
        success: false,
        message: 'عدد الأشهر غير صالح'
      });
    }

    // Find user's active subscription or create new one
    let subscription = await Subscription.findOne({
      where: { 
        userId, 
        status: 'active' 
      }
    });

    const now = new Date();
    let startAt = now;
    let endAt = new Date(now);

    if (subscription) {
      // Extend existing subscription
      startAt = new Date(subscription.startAt);
      endAt = new Date(subscription.endAt);
      endAt.setMonth(endAt.getMonth() + months);
    } else {
      // Create new subscription
      endAt.setMonth(endAt.getMonth() + months);
      subscription = await Subscription.create({
        userId,
        startAt: now,
        endAt,
        status: 'active'
      });
    }

    await subscription.update({ endAt });

    res.json({
      success: true,
      message: `تم تجديد الاشتراك لمدة ${months} شهر`,
      subscription: {
        id: subscription.id,
        startAt: subscription.startAt,
        endAt: subscription.endAt,
        status: subscription.status
      }
    });
  } catch (error) {
    console.error('Error extending subscription:', error);
    res.status(500).json({
      success: false,
      message: 'خطأ في الخادم'
    });
  }
});

export default router;