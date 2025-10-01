import { DataTypes } from 'sequelize';  // Fixed: import named export
import sequelize from '../config/db.js'; // Fixed: add .js extension

const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
  email: { type: DataTypes.STRING(200), allowNull: false, unique: true },
  passwordHash: { type: DataTypes.STRING(200), allowNull: false },
  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, { tableName: 'users', timestamps: false });

export default User;