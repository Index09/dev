import 'dotenv/config';
import express from 'express';
import sequelize from './config/db.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import userRoutes from './routes/users.js';
import instanceRoutes from './routes/instances.js';
import subscriptions from './routes/subscription.js';
import adminRoutes from './routes/admin.js';
import instanceManager from './instanceManager.js';
import cors from 'cors';

const app = express();
app.use(express.json());
app.use(cors());

app.get( '/', (req, res) => {
  res.sendFile(path.join(__dirname, "public/landing", "index.html"));
});

app.use('/assets', express.static('public'))
app.use(express.static(path.join(__dirname, "public")));
app.get( ['/dashboard', '/instances' , '/subscribe' , '/login' , '/register' , '/subscribe'], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});



// sync DB
(async () => {
  try {
    await sequelize.authenticate();
    // sync models (for production use migrations; sync is ok for prototype)
    await sequelize.sync();
    console.log('DB connected and synced');
  } catch (err) {
    console.error('DB connection error', err);
    process.exit(1);
  }
})();

(async () => {
  try {
    const res = await instanceManager.loadAllFromDB();
    console.log('Initial load results:', res);
  } catch (err) {
    console.error('Error loading instances:', err);
  }
})();

app.use('/api/users', userRoutes);
app.use('/api/instances', instanceRoutes);
app.use('/api/subscriptions', subscriptions);


app.use('/api/admin', adminRoutes);




const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));