import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

const User = sequelize.define('User', {
  id: { 
    type: DataTypes.INTEGER.UNSIGNED, 
    autoIncrement: true, 
    primaryKey: true 
  },
  name: { 
    type: DataTypes.STRING(100), 
    allowNull: false 
  },
  phone: { 
    type: DataTypes.STRING(20), 
    allowNull: false, 
    unique: true 
  },
  email: { 
    type: DataTypes.STRING(200), 
    allowNull: false, 
    unique: true 
  },
  passwordHash: { 
    type: DataTypes.STRING(200), 
    allowNull: false 
  },
  createdAt: { 
    type: DataTypes.DATE, 
    defaultValue: DataTypes.NOW 
  },
  updatedAt: { 
    type: DataTypes.DATE, 
    defaultValue: DataTypes.NOW 
  }
}, { 
  tableName: 'users',
  timestamps: true
});

export default User;
