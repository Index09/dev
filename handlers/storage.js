const fs = require("fs-extra");
const path = require("path");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const META_FILE = path.join(DATA_DIR, "instances.json");

async function ensureMeta() {
  await fs.ensureDir(DATA_DIR);
  if (!(await fs.pathExists(META_FILE))) {
    await fs.writeJson(META_FILE, { instances: {} }, { spaces: 2 });
  }
}

async function readMeta() {
  await ensureMeta();
  return fs.readJson(META_FILE);
}

async function writeMeta(meta) {
  await ensureMeta();
  return fs.writeJson(META_FILE, meta, { spaces: 2 });
}

module.exports = { readMeta, writeMeta };