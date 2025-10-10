import dotenv from 'dotenv';
import { Sequelize } from 'sequelize';
import './models/Device.js';
import './models/User.js';
import './models/Subscription.js';
import sequelize from './config/db.js'; // existing DB config

dotenv.config();

async function resetDatabase() {
  try {
    console.log('🔄 Resetting MySQL database...');

    // Drop and recreate all tables
    await sequelize.sync({ force: true });

    console.log('✅ Database reset complete! All tables recreated.');

    // List all tables in the current MySQL database
    const [results] = await sequelize.query('SHOW TABLES');
    const tables = results.map((row) => Object.values(row)[0]);

    console.log('📊 Tables created:', tables);
  } catch (error) {
    console.error('❌ Database reset failed:', error);
  } finally {
    await sequelize.close();
  }
}

// Run it directly
resetDatabase();