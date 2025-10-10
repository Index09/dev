import { Worker } from 'bullmq';
import axios from 'axios';
import { Redis } from 'ioredis';

const connection = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null, 
  enableReadyCheck: false      
});

new Worker(
  'webhookQueue',
  async (job) => {
    const { url, payload } = job.data;
    try {
        console.log(url)
      await axios.post(url, payload);
      console.log(`✅ Webhook sent to ${url}`);
    } catch (err) {
      console.error(`❌ Webhook failed: ${url}`, err.message);
    }
  },
  { connection }
);