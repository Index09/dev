
import Sequelize from 'sequelize'
import 'dotenv/config';

const sequelize = new Sequelize(
  process.env.DB_NAME || 'wwebjs_subscriptions',
  process.env.DB_USER || 'root',
  process.env.DB_PASS || '',
  {
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    logging: false,
    pool: { max: 10, min: 0, acquire: 30000, idle: 10000 }
  }
);

export default sequelize