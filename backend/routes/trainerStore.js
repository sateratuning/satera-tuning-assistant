// routes/trainerStore.js
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const ROOT = path.join(__dirname, "trainer_entries");
if (!fs.existsSync(ROOT)) fs.mkdirSync(ROOT, { recursive: true });

function entryPath(id) {
  return path.join(ROOT, `${id}.json`);
}

function createOrLoadEntry(seed = {}) {
  const id = seed.trainer_entry_id || randomUUID();
  const p = entryPath(id);
  if (fs.existsSync(p)) {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return { id, data };
  }
  const data = {
    id,
    createdAt: Date.now(),
    vehicle: seed.vehicle || null,
    files: seed.files || {},
    notes: "",
    chatPairs: [], // [{system, user, assistant, notes}]
  };
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return { id, data };
}

function loadEntry(id) {
  const p = entryPath(id);
  if (!fs.existsSync(p)) throw new Error("trainer_entry_id not found");
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  return { id, data };
}

function saveEntry(id, data) {
  const p = entryPath(id);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return { id, data };
}

function listEntries() {
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith(".json"));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")));
}

module.exports = {
  createOrLoadEntry,
  loadEntry,
  saveEntry,
  listEntries,
  ROOT,
};
