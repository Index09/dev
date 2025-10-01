const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');
const User = require('./User');

const Subscription = sequelize.define('Subscription', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  startAt: { type: DataTypes.DATE, allowNull: false },
  endAt: { type: DataTypes.DATE, allowNull: false },
  status: { type: DataTypes.ENUM('active', 'expired', 'cancelled'), defaultValue: 'active' }
}, { tableName: 'subscriptions', timestamps: false });

Subscription.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(Subscription, { foreignKey: 'userId' });

module.exports = Subscription