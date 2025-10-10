import { Sequelize } from 'sequelize';

import dotenv from 'dotenv';
dotenv.config();


const user = process.env.DB_USER
const password = process.env.DB_PASS
const sequelize = new Sequelize('whatsapp_app',user, password, {
  host: 'localhost',
  dialect: 'mysql',
  logging: false,
  define: {
    timestamps: true,
  },
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});
export default sequelize;