// src/server.js
require('dotenv').config();
const express = require('express');
const sequelize = require('./config/db');
const path = require('path');

const userRoutes = require('./routes/users');
const instanceRoutes = require('./routes/instances');
const subscriptions = require('./routes/subscription');
const instanceManager = require('./instanceManager');
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

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

app.use(express.static(path.join(__dirname, "public")));

app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found" });
});


app.get( ["/" , '/instances' , 'subscribe'], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});






const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));