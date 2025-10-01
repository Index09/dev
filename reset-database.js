import sequelize from './config/db.js';
import './models/Device.js';
import './models/User.js';
import './models/Subscription.js';

async function resetDatabase() {
  try {
    console.log('🔄 Resetting database...');
    
    // This will DROP and RECREATE all tables
    await sequelize.sync({ force: true });
    
    console.log('✅ Database reset complete! All tables recreated.');
    
    // Verify
    const tables = await sequelize.getQueryInterface().showAllTables();
    console.log('📊 Tables created:', tables);
    
  } catch (error) {
    console.error('❌ Database reset failed:', error);
  } finally {
    await sequelize.close();
  }
}

resetDatabase();