import {
  default as makeWASocket,
  useMultiFileAuthState,
  Browsers,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import Qrcode from "qrcode";

import pkg from "pino";
const { pino } = pkg;

const logger = pino({ level: "silent" });

import fs from "fs-extra";
import path from "path";

import { Op } from "sequelize";

import Device from "./models/Device.js";
import MAKE_WEBHOOK_CALL from "./handlers/autoReply.js";

const CONCURRENCY = 5;
const START_STAGGER_MS = 3000;
const READY_TIMEOUT_MS = 30000;
const MAX_RETRIES = 4;

class InstanceManager {
  constructor() {
    this.clients = new Map(); // instanceId -> { socket, meta, authState }
    this.retryCounts = new Map();
    this.loading = false;
    this.memoryStats = {
      lastCleanup: Date.now(),
      cleanupInterval: 60000,
      maxHeapThreshold: 500 * 1024 * 1024, // Increased to 500MB since Baileys is efficient
    };
  }
  async safeDestroy(instanceId) {
    const rec = this.clients.get(instanceId);
    if (rec && rec.socket) {
      try {
        rec.socket.ev.removeAllListeners();
        if (rec.socket.ws && rec.socket.ws.readyState === 1) {
          rec.socket.ws.close();
        }
      } catch (e) {}
    }
    this.clients.delete(instanceId);
    this.retryCounts.delete(instanceId);
  }

  bindCommonEvents(socket, instanceId, meta) {
    socket.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log(`[${instanceId}] QR generated`);
        const rec = this.clients.get(instanceId);
        if (rec) {
          rec.qr = qr;
          try {
            rec.qrBase64 = await Qrcode.toDataURL(qr);
          } catch (err) {
            console.error("QR base64 error:", err);
          }
        }
      }

      if (connection === "open") {
        // existing open handling (keep as-is)...
        console.log(`[${instanceId}] connected and ready`);
        meta.status = "ready";
        await this.updateDeviceStatus(instanceId, "ready");
        // ... rest of your open logic
        return; // done
      }

      if (connection === "connecting") {
        console.log(`[${instanceId}] connecting...`);
        meta.status = "connecting";
        await this.updateDeviceStatus(instanceId, "connecting");
        return;
      }

      // === Proper 'close' handling ===
      if (connection === "close") {
        const err = lastDisconnect?.error;
        const statusCode = err?.output?.statusCode ?? null;
        console.warn(`[${instanceId}] connection closed`, err?.message || err);

        // consider logged out if statusCode is 401 or Baileys DisconnectReason.loggedOut
        const isLoggedOut =
          statusCode === DisconnectReason.loggedOut ||
          statusCode === 401 ||
          (err && err.output && err.output.statusCode === 401);

        if (isLoggedOut) {
          meta.status = "logged_out";
          await this.updateDeviceStatus(instanceId, "logged_out");
          console.log(`[${instanceId}] Logged out — manual re-auth required`);
          // keep client removed so front-end can request new QR
          await this.safeDestroy(instanceId);
          return;
        }

        // Otherwise try immediate recovery
        meta.status = "disconnected";
        await this.updateDeviceStatus(instanceId, "disconnected");

        try {
          console.log(
            `[${instanceId}] Attempting immediate re-initialization...`
          );
          // clean up old client if any, then try to init again
          await this.safeDestroy(instanceId);
          await this._initSingle(instanceId);
          console.log(
            `[${instanceId}] Re-initialized successfully after close`
          );
          // success: nothing else to do
        } catch (reinitErr) {
          console.error(
            `[${instanceId}] Immediate reinit failed:`,
            reinitErr?.message || reinitErr
          );
          // schedule retry/backoff (existing logic)
          this.scheduleRetry(instanceId);
        }
      }
    });

    socket.ev.on("messages.upsert", async (update) => {
      try {
        const messages = update.messages;
        if (!messages || messages.length === 0) return;
        for (const msg of messages) {
          if (!msg.message || msg.key.fromMe) continue;
          const remoteJid = msg.key.remoteJid;
          const phone = remoteJid.replace("@s.whatsapp.net", "");
          const body = msg.message?.conversation || null;

          MAKE_WEBHOOK_CALL({ body, phone, instanceId });
        }
      } catch (err) {
        console.error("❌ Error processing message:", err);
      }
    });
  }

  async updateDeviceStatus(instanceId, status) {
    try {
      await Device.update({ status }, { where: { instanceId } });
    } catch (error) {
      console.error(`DB update failed for ${instanceId}:`, error);
    }
  }
  scheduleRetry(instanceId) {
    const attempts = (this.retryCounts.get(instanceId) || 0) + 1;
    if (attempts > MAX_RETRIES) {
      console.warn(
        `[${instanceId}] reached max retries (${MAX_RETRIES}), giving up.`
      );
      Device.update({ status: "failed" }, { where: { instanceId } }).catch(
        console.error
      );
      return;
    }
    this.retryCounts.set(instanceId, attempts);
    const delay =
      Math.min(60_000, Math.pow(2, attempts) * 1000) +
      Math.floor(Math.random() * 3000); // cap 60s + jitter
    console.log(
      `[${instanceId}] scheduling retry #${attempts} in ${Math.round(
        delay / 1000
      )}s`
    );
    setTimeout(async () => {
      try {
        const rec = this.clients.get(instanceId);
        if (rec && rec.client) {
          try {
            await rec.client.destroy();
          } catch (e) {}
          this.clients.delete(instanceId);
        }
        await this._initSingle(instanceId);
      } catch (err) {
        console.error(`[${instanceId}] retry init failed:`, err.message || err);
      }
    }, delay);
  }

  async _initSingle(instanceId) {
    if (this.clients.has(instanceId)) {
      const existing = this.clients.get(instanceId);
      if (existing.socket && !existing.socket.user) {
        await this.safeDestroy(instanceId);
      } else {
        return existing.meta;
      }
    }
    const dbDevice = await Device.findOne({
      where: { instanceId },
      attributes: ["id", "instanceId", "status", "meta"],
    });

    const meta = {
      id: instanceId,
      autoReply: null,
      status: "initializing",
      lastActivity: Date.now(),
      createdAt: Date.now(),
    };

    try {
      const { state, saveCreds } = await useMultiFileAuthState(
        `sessions/${instanceId}`
      );

      const socket = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: logger,
        browser: Browsers.macOS("Safari"),
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        defaultQueryTimeoutMs: 60000,
      });
      socket.ev.on("creds.update", saveCreds);

      this.clients.set(instanceId, {
        socket,
        meta,
        authState: { state, saveCreds },
      });
      this.bindCommonEvents(socket, instanceId, meta);

      await this.updateDeviceStatus(instanceId, "initializing");
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.ev.off("connection.update", connectionHandler);
          reject(new Error("Connection timeout"));
        }, READY_TIMEOUT_MS);

        const connectionHandler = (update) => {
          if (update.connection === "open") {
            clearTimeout(timeout);
            socket.ev.off("connection.update", connectionHandler);
            resolve();
          } else if (update.connection === "close") {
            clearTimeout(timeout);
            socket.ev.off("connection.update", connectionHandler);
            reject(
              new Error(
                `Connection closed: ${
                  update.lastDisconnect?.error?.message || "unknown"
                }`
              )
            );
          }
        };
        socket.ev.on("connection.update", connectionHandler);
      });

      this.retryCounts.delete(instanceId);
      return meta;
    } catch (err) {
      console.warn(`[${instanceId}] init failed:`, err.message);
      meta.status = "disconnected";
      await this.updateDeviceStatus(instanceId, "disconnected");
      this.scheduleRetry(instanceId);
      throw err;
    }
  }

  async loadAllFromDB() {
    if (this.loading) return;
    this.loading = true;
    try {
      const devices = await Device.findAll({
        where: { status: { [Op.not]: "destroyed" } },
        attributes: ["instanceId"],
        raw: true,
      });

      console.log(`InstanceManager: found ${devices.length} devices to load.`);

      const instanceIds = devices.map((d) => d.instanceId);
      const results = [];
      let currentIndex = 0;

      const processBatch = async () => {
        while (currentIndex < instanceIds.length) {
          const instanceId = instanceIds[currentIndex++];
          const stagger = (currentIndex - 1) * START_STAGGER_MS;

          if (stagger > 0) {
            await new Promise((resolve) => setTimeout(resolve, stagger));
          }

          try {
            const meta = await this._initSingle(instanceId);
            results.push({ instanceId, ok: true, status: meta.status });
          } catch (err) {
            results.push({ instanceId, ok: false, error: err.message });
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
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

  async destroyInstance(instanceId) {
    await this.safeDestroy(instanceId);

    // Cleanup session files
    const sessionDir = path.resolve(process.cwd(), "sessions", instanceId);
    await fs.remove(sessionDir).catch(() => {});

    await this.updateDeviceStatus(instanceId, "destroyed");
  }

  async logoutInstance(instanceId) {
    const rec = this.clients.get(instanceId);
    if (!rec || !rec.socket) throw new Error("Instance not found");

    try {
      rec.socket.ev.removeAllListeners();
      if (rec.socket.ws && rec.socket.ws.readyState === 1) {
        rec.socket.ws.close();
      }

      this.clients.delete(instanceId);
      const sessionDir = path.resolve(process.cwd(), "sessions", instanceId);
      await fs.remove(sessionDir).catch(() => {});

      await this.updateDeviceStatus(instanceId, "logged_out");
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
      attributes: ["id", "instanceId", "status", "meta"],
    });

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

  async sendMessage(instanceId, jid, content, options = {}) {
    const socket = this.getClient(instanceId);
    if (!socket) throw new Error("Instance not found or not ready");

    try {
      return await socket.sendMessage(jid, content, options);
    } catch (error) {
      console.warn(
        `[${instanceId}] sendMessage failed, attempting reinit:`,
        error?.message || error
      );

      try {
        await this.safeDestroy(instanceId);
      } catch (e) {
        console.warn(
          `[${instanceId}] safeDestroy during sendMessage recovery failed:`,
          e?.message || e
        );
      }

      try {
        await this._initSingle(instanceId);
        const newSocket = this.getClient(instanceId);
        if (!newSocket)
          throw new Error("Reinitialized but client not available");

        return await newSocket.sendMessage(jid, content, options);
      } catch (retryErr) {
        console.error(
          `[${instanceId}] sendMessage retry failed:`,
          retryErr?.message || retryErr
        );
        this.scheduleRetry(instanceId);
        throw retryErr;
      }
    }
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
