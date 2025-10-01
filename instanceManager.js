import { default as makeWASocket, useMultiFileAuthState, Browsers, DisconnectReason } from '@whiskeysockets/baileys';
import Qrcode from 'qrcode';

// 🚫 Disable ALL Baileys logging
import pkg from 'pino';
const { pino } = pkg;
const logger = pino({ level: 'silent' }); // Complete silence

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { Sequelize, DataTypes, Op } from 'sequelize';

// For __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import your local modules
import Device from './models/Device.js';
//import AUTO_REPLY from './handlers/autoReply.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
fs.ensureDirSync(DATA_DIR);

// Optimized tunables - can be more aggressive with Baileys
const CONCURRENCY = 5; // Increased since Baileys is lightweight
const START_STAGGER_MS = 1000; // Reduced stagger
const READY_TIMEOUT_MS = 30000; // Normal timeout
const MAX_RETRIES = 4;

class InstanceManager {
  constructor() {
    this.clients = new Map(); // instanceId -> { socket, meta, authState }
    this.retryCounts = new Map();
    this.loading = false;
    
    // Memory monitoring - Baileys uses much less memory
    this.memoryStats = {
      lastCleanup: Date.now(),
      cleanupInterval: 60000,
      maxHeapThreshold: 500 * 1024 * 1024, // Increased to 500MB since Baileys is efficient
    };
    
    this.startMemoryMonitor();
  }

  // 🚀 Start memory monitoring
  startMemoryMonitor() {
    if (this.memoryInterval) return;
    
    this.memoryInterval = setInterval(() => {
      const memory = process.memoryUsage();
      const heapUsedMB = Math.round(memory.heapUsed / 1024 / 1024);
      console.log(`memory usage: ${heapUsedMB}MB, Clients: ${this.clients.size}`);
    }, 30000);
  }



  // 🚀 Safe destroy without throwing errors
  async safeDestroy(instanceId) {
    const rec = this.clients.get(instanceId);
    if (rec && rec.socket) {
      try {
        // Baileys doesn't have explicit destroy, just remove listeners
        rec.socket.ev.removeAllListeners();
        // Close the connection if it exists
        if (rec.socket.ws && rec.socket.ws.readyState === 1) {
          rec.socket.ws.close();
        }
      } catch (e) {
        // Silent fail
      }
    }
    this.clients.delete(instanceId);
    this.retryCounts.delete(instanceId);
  }

  onceWithTimeout(emitter, event, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        emitter.off(event, handler);
        reject(new Error('timeout'));
      }, timeoutMs);

      const handler = (...args) => {
        clearTimeout(timer);
        resolve(args);
      };

      emitter.on(event, handler);
    });
  }

  // 🚀 Optimized event binding with memory considerations
  bindCommonEvents(socket, instanceId, meta) {
    // Track last activity
    const updateActivity = () => {
      meta.lastActivity = Date.now();
    };

    // QR handler
    socket.ev.on('connection.update', async (update) => {
      updateActivity();
      
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        console.log(`[${instanceId}] QR generated`);
        const rec = this.clients.get(instanceId);
        if (rec) {
          rec.qr = qr;
          try {
            rec.qrBase64 = await Qrcode.toDataURL(qr);
          } catch (err) {
            console.error('QR base64 error:', err);
          }
        }
      }

      if (connection === 'open') {
        console.log(`[${instanceId}] connected and ready`);
        meta.status = 'ready';
        this.updateDeviceStatus(instanceId, 'ready');
        
        // Auto-reply can be enabled here
        // socket.ev.on('messages.upsert', (m) => AUTO_REPLY(meta)(m, socket));
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log(`[${instanceId}] connection closed due to ${lastDisconnect?.error?.message || 'unknown reason'}, reconnecting: ${shouldReconnect}`);
        
        if (shouldReconnect) {
          meta.status = 'disconnected';
          this.updateDeviceStatus(instanceId, 'disconnected');
          this.scheduleRetry(instanceId);
        } else {
          meta.status = 'logged_out';
          this.updateDeviceStatus(instanceId, 'logged_out');
        }
      }

      if (connection === 'connecting') {
        console.log(`[${instanceId}] connecting...`);
        meta.status = 'connecting';
        this.updateDeviceStatus(instanceId, 'connecting');
      }
    });

    // Error handling
    socket.ev.on('connection.update', (update) => {
      if (update.error) {
        console.error(`[${instanceId}] connection error:`, update.error);
      }
    });

    // Credentials updated
    socket.ev.on('creds.update', () => {
      // Credentials are automatically saved by useMultiFileAuthState
      updateActivity();
    });
  }

  // 🚀 Batch database updates to reduce I/O
  async updateDeviceStatus(instanceId, status) {
    try {
      await Device.update({ status }, { where: { instanceId } });
    } catch (error) {
      console.error(`DB update failed for ${instanceId}:`, error);
    }
  }

  scheduleRetry(instanceId) {
    const attempts = (this.retryCounts.get(instanceId) || 0) + 1;
    
    this.retryCounts.set(instanceId, attempts);
    const delay = Math.min(45000, Math.pow(2, attempts) * 1000) + Math.floor(Math.random() * 2000);
    
    console.log(`[${instanceId}] scheduling retry #${attempts} in ${Math.round(delay / 1000)}s`);
    
    setTimeout(async () => {
      try {
        await this._initSingle(instanceId);
      } catch (err) {
        console.error(`[${instanceId}] retry init failed:`, err.message);
        this.scheduleRetry(instanceId);
      }
    }, delay);
  }

  // 🚀 Optimized single instance initialization
  async _initSingle(instanceId) {
    if (this.clients.has(instanceId)) {
      const existing = this.clients.get(instanceId);
      // Check if socket is still connected
      if (existing.socket && !existing.socket.user) {
        // Socket exists but not authenticated, safe to recreate
        await this.safeDestroy(instanceId);
      } else {
        return existing.meta;
      }
    }

    // Use lean database query
    const dbDevice = await Device.findOne({ 
      where: { instanceId },
      attributes: ['id', 'instanceId', 'status', 'meta']
    });

    const meta = {
      id: instanceId,
      autoReply: dbDevice?.meta?.autoReply || null,
      status: 'initializing',
      lastActivity: Date.now(),
      createdAt: Date.now()
    };

    try {
      // 🚀 Baileys authentication setup
      const { state, saveCreds } = await useMultiFileAuthState(`sessions/${instanceId}`);
      
      // 🚀 Create Baileys socket
      const socket = makeWASocket({
        auth: state,
        printQRInTerminal: false, // We handle QR ourselves
        logger: logger,
        browser: Browsers.ubuntu('Chrome'), // Mimic browser
        markOnlineOnConnect: true, 
        generateHighQualityLinkPreview: false, // Save resources
        syncFullHistory: false, // Save resources
        defaultQueryTimeoutMs: 60000, // Longer timeout
      });

      // Save credentials when updated
      socket.ev.on('creds.update', saveCreds);

      this.clients.set(instanceId, { socket, meta, authState: { state, saveCreds } });
      this.bindCommonEvents(socket, instanceId, meta);

      await this.updateDeviceStatus(instanceId, 'initializing');

      // 🚀 Wait for connection to open with timeout
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.ev.off('connection.update', connectionHandler);
          reject(new Error('Connection timeout'));
        }, READY_TIMEOUT_MS);

        const connectionHandler = (update) => {
          if (update.connection === 'open') {
            clearTimeout(timeout);
            socket.ev.off('connection.update', connectionHandler);
            resolve();
          } else if (update.connection === 'close') {
            clearTimeout(timeout);
            socket.ev.off('connection.update', connectionHandler);
            reject(new Error(`Connection closed: ${update.lastDisconnect?.error?.message || 'unknown'}`));
          }
        };

        socket.ev.on('connection.update', connectionHandler);
      });

      this.retryCounts.delete(instanceId);
      return meta;
    } catch (err) {
      console.warn(`[${instanceId}] init failed:`, err.message);
      meta.status = 'disconnected';
      await this.updateDeviceStatus(instanceId, 'disconnected');
      this.scheduleRetry(instanceId);
      throw err;
    }
  }

  // 🚀 Optimized batch loading with better memory management
  async loadAllFromDB() {
    if (this.loading) return;
    this.loading = true;

    try {
      const devices = await Device.findAll({
        where: { status: { [Op.not]: 'destroyed' } },
        attributes: ['instanceId'],
        raw: true
      });

      console.log(`InstanceManager: found ${devices.length} devices to load.`);

      const instanceIds = devices.map(d => d.instanceId);
      const results = [];
      let currentIndex = 0;

      const processBatch = async () => {
        while (currentIndex < instanceIds.length) {
          const instanceId = instanceIds[currentIndex++];
          const stagger = (currentIndex - 1) * START_STAGGER_MS;
          
          if (stagger > 0) {
            await new Promise(resolve => setTimeout(resolve, stagger));
          }

          try {
            const meta = await this._initSingle(instanceId);
            results.push({ instanceId, ok: true, status: meta.status });
          } catch (err) {
            results.push({ instanceId, ok: false, error: err.message });
          }

          // Small delay between instances in same batch
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      };

      const workers = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        workers.push(processBatch());
      }
      
      await Promise.all(workers);
      return results;

    } finally {
      this.loading = false;
    }
  }

  getClient(instanceId) {
    const rec = this.clients.get(instanceId);
    return rec ? rec.socket : null;
  }

  // 🚀 Optimized destruction
  async destroyInstance(instanceId) {
    await this.safeDestroy(instanceId);
    
    // Cleanup session files
    const sessionDir = path.resolve(process.cwd(), 'sessions', instanceId);
    await fs.remove(sessionDir).catch(() => {});
    
    await this.updateDeviceStatus(instanceId, 'destroyed');
  }

  async logoutInstance(instanceId) {
    const rec = this.clients.get(instanceId);
    if (!rec || !rec.socket) throw new Error('Instance not found');

    try {
      // Baileys logout - close connection and cleanup
      rec.socket.ev.removeAllListeners();
      if (rec.socket.ws && rec.socket.ws.readyState === 1) {
        rec.socket.ws.close();
      }
      
      this.clients.delete(instanceId);
      
      // Cleanup session files
      const sessionDir = path.resolve(process.cwd(), 'sessions', instanceId);
      await fs.remove(sessionDir).catch(() => {});

      await this.updateDeviceStatus(instanceId, 'logged_out');
      console.log(`[${instanceId}] logged out successfully`);
      return { success: true };
    } catch (err) {
      console.error(`[${instanceId}] logout failed`, err);
      throw err;
    }
  }

  listStatus() {
    const status = [];
    for (const [id, { meta }] of this.clients.entries()) {
      status.push({ id, status: meta.status });
    }
    return status;
  }

  async ensureInstance(instanceId, options = {}) {
    if (this.clients.has(instanceId)) {
      return this.clients.get(instanceId).meta;
    }

    let device = await Device.findOne({ 
      where: { instanceId },
      attributes: ['id', 'instanceId', 'status', 'meta']
    });
    
    if (!device) {
      device = await Device.create({
        instanceId,
        status: 'initializing',
        meta: options,
      });
    }

    const meta = await this._initSingle(instanceId);

    if (options && Object.keys(options).length > 0) {
      await Device.update(
        { meta: { ...(device.meta || {}), ...options } },
        { where: { instanceId } }
      );
    }

    return meta;
  }

  getQR(instanceId) {
    const rec = this.clients.get(instanceId);
    return rec ? rec.qr : null;
  }

  // 🚀 Send message method (equivalent to client.sendMessage)
  async sendMessage(instanceId, jid, content, options = {}) {
    const socket = this.getClient(instanceId);
    if (!socket) throw new Error('Instance not found or not ready');
    
    return await socket.sendMessage(jid, content, options);
  }

  // 🚀 Get all chats
  async getChats(instanceId) {
    const socket = this.getClient(instanceId);
    if (!socket) throw new Error('Instance not found or not ready');
    
    return await socket.fetchBlocklist();
  }

  // 🚀 Cleanup on destroy
  async destroy() {
    if (this.memoryInterval) {
      clearInterval(this.memoryInterval);
    }
    
    // Destroy all clients
    const destroyPromises = [];
    for (const [instanceId] of this.clients.entries()) {
      destroyPromises.push(this.safeDestroy(instanceId));
    }
    
    await Promise.allSettled(destroyPromises);
    this.clients.clear();
    this.retryCounts.clear();
  }
}



const instanceManager = new InstanceManager();
export default instanceManager;