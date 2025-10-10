import { DataTypes } from "sequelize"; // Fixed: import named export
import sequelize from "../config/db.js";
import User from "./User.js"; // Fixed: add .js extension

const Subscription = sequelize.define(
  "Subscription",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    startAt: { type: DataTypes.DATE, allowNull: false },
    endAt: { type: DataTypes.DATE, allowNull: false },
    status: {
      type: DataTypes.ENUM("active", "expired", "cancelled"),
      defaultValue: "active",
    },
    plan_type: {
      type: DataTypes.ENUM("free", "limit", "open"),
      defaultValue: "free",
    },
    webhookUrl: {
      type: DataTypes.STRING(200),
      allowNull: true, 
    },
  },
  { tableName: "subscriptions" }
);

Subscription.belongsTo(User, { foreignKey: "userId" });
User.hasMany(Subscription, { foreignKey: "userId" });

export default Subscription;
