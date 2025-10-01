import { DataTypes } from 'sequelize';  // Fixed: import named export
import sequelize from '../config/db.js';
import User from './User.js';  // Fixed: add .js extension

const Subscription = sequelize.define('Subscription', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  startAt: { type: DataTypes.DATE, allowNull: false },
  endAt: { type: DataTypes.DATE, allowNull: false },
  status: { type: DataTypes.ENUM('active', 'expired', 'cancelled'), defaultValue: 'active' }
}, { tableName: 'subscriptions', timestamps: false });

Subscription.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(Subscription, { foreignKey: 'userId' });

export default Subscription;