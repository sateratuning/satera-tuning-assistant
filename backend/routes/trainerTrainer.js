// backend/routes/trainerTrainer.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const router = express.Router();

/**
 * Storage layout:
 * - data/trainer_entries/<trainer_entry_id>.json     (accumulates chat pairs)
 * - routes/fine-tune-upload-chat.jsonl               (global JSONL to fine-tune)
 */

const dataDir = path.join(__dirname, "..", "data", "trainer_entries");
const jsonlPath = path.join(__dirname, "fine-tune-upload-chat.jsonl");

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
ensureDir(dataDir);

// Utility: load/save per-entry examples file
function entryFile(id) { return path.join(dataDir, `${id}.json`); }
function loadEntry(id) {
  const f = entryFile(id);
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return []; }
}
function saveEntry(id, arr) {
  ensureDir(dataDir);
  fs.writeFileSync(entryFile(id), JSON.stringify(arr, null, 2), "utf8");
}

// 1) Save chat pairs to entry
// body: { trainer_entry_id: string, chatPairs: [{system?, user, assistant, notes?}], notes? }
router.post("/trainer/save-chat", (req, res) => {
  try {
    const { trainer_entry_id, chatPairs } = req.body || {};
    if (!trainer_entry_id) return res.status(400).json({ ok: false, error: "missing trainer_entry_id" });
    if (!Array.isArray(chatPairs) || chatPairs.length === 0) {
      return res.status(400).json({ ok: false, error: "chatPairs empty" });
    }

    // Normalize to OpenAI chat fine-tune format
    const toMessages = (p) => {
      const msgs = [];
      if (p.system && String(p.system).trim()) msgs.push({ role: "system", content: String(p.system).trim() });
      msgs.push({ role: "user", content: String(p.user || "").trim() });
      msgs.push({ role: "assistant", content: String(p.assistant || "").trim() });
      return { messages: msgs };
    };

    const existing = loadEntry(trainer_entry_id);
    const normalized = chatPairs
      .map(toMessages)
      .filter(x => x.messages?.length >= 2 && x.messages[0].content && x.messages[1].content);

    const updated = existing.concat(normalized);
    saveEntry(trainer_entry_id, updated);

    return res.json({
      ok: true,
      trainer_entry_id,
      added: normalized.length,
      total_examples_for_entry: updated.length
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// 2) Finalize & append entry to global JSONL
// body: { trainer_entry_id: string, appendToJsonl: boolean }
router.post("/trainer/finalize", (req, res) => {
  try {
    const { trainer_entry_id, appendToJsonl } = req.body || {};
    if (!trainer_entry_id) return res.status(400).json({ ok: false, error: "missing trainer_entry_id" });

    const examples = loadEntry(trainer_entry_id);
    if (!examples.length) {
      return res.status(400).json({ ok: false, error: "no examples saved for this entry" });
    }

    let appended = 0;
    if (appendToJsonl) {
      const stream = fs.createWriteStream(jsonlPath, { flags: "a", encoding: "utf8" });
      for (const ex of examples) {
        stream.write(JSON.stringify(ex) + "\n");
        appended++;
      }
      stream.end();
    }

    // Count total in JSONL after append
    let total = 0;
    if (fs.existsSync(jsonlPath)) {
      const buf = fs.readFileSync(jsonlPath, "utf8");
      total = buf.split(/\r?\n/).filter(Boolean).length;
    }

    return res.json({
      ok: true,
      trainer_entry_id,
      appended,
      jsonlPath,
      totalExamplesInFile: total
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
