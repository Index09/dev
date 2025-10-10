import DataTypes from "sequelize";
import sequelize from "../config/db.js";
import User from "./User.js";

const Device = sequelize.define(
  "Device",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      unique: true,
    }, // unique -> 1 device per user
    instanceId: { type: DataTypes.STRING(200), allowNull: false, unique: true },
    meta: { type: DataTypes.JSON, allowNull: true },
    status: { type: DataTypes.STRING(200) },
    messagesCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    linkedNumber: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    tableName: "devices",
    indexes: [
      {
        fields: ["instanceId"],
      },
      {
        fields: ["linkedNumber"],
      },
      {
        fields: ["status"],
      },
    ],
    
  }
);

Device.belongsTo(User, { foreignKey: "userId" });
User.hasOne(Device, { foreignKey: "userId" });

export default Device;
