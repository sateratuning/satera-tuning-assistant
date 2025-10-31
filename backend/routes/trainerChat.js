// routes/trainerChat.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

const {
  createOrLoadEntry,
  loadEntry,
  saveEntry,
} = require("./trainerStore");

// Where we append final chat-format examples
const CHAT_JSONL = path.join(__dirname, "fine-tune-upload-chat.jsonl");

// Health: GET list (optional)
router.get("/trainer/entries", (_req, res) => {
  try {
    const { listEntries } = require("./trainerStore");
    const entries = listEntries();
    res.json({ ok: true, entries });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// POST /trainer/save-chat
// Body: { trainer_entry_id, chatPairs: [{system?, user, assistant, notes?}], notes? }
router.post("/trainer/save-chat", express.json({ limit: "5mb" }), (req, res) => {
  try {
    const { trainer_entry_id, chatPairs = [], notes } = req.body || {};
    if (!trainer_entry_id) return res.status(400).json({ ok: false, error: "trainer_entry_id required" });
    if (!Array.isArray(chatPairs) || chatPairs.length === 0) {
      return res.status(400).json({ ok: false, error: "chatPairs[] required" });
    }

    const { id, data } = loadEntry(trainer_entry_id);

    let added = 0;
    const cleaned = chatPairs.map(p => {
      const system = (p.system || "").toString().trim();
      const user = (p.user || "").toString().trim();
      const assistant = (p.assistant || "").toString().trim();
      const notesP = (p.notes || "").toString();

      if (!user || !assistant) return null;
      return { system, user, assistant, notes: notesP };
    }).filter(Boolean);

    if (cleaned.length === 0) {
      return res.status(400).json({ ok: false, error: "All chatPairs missing user/assistant" });
    }

    data.chatPairs.push(...cleaned);
    if (typeof notes === "string") data.notes = notes;

    saveEntry(id, data);
    added = cleaned.length;

    res.json({ ok: true, trainer_entry_id: id, added, total_examples_for_entry: data.chatPairs.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// POST /trainer/finalize
// Body: { trainer_entry_id, appendToJsonl: true }
// Behavior: append entry.chatPairs as chat-format {"messages":[...]} to fine-tune-upload-chat.jsonl
router.post("/trainer/finalize", express.json({ limit: "2mb" }), (req, res) => {
  try {
    const { trainer_entry_id, appendToJsonl } = req.body || {};
    if (!trainer_entry_id) return res.status(400).json({ ok: false, error: "trainer_entry_id required" });

    const { id, data } = loadEntry(trainer_entry_id);
    const pairs = Array.isArray(data.chatPairs) ? data.chatPairs : [];
    if (pairs.length === 0) return res.status(400).json({ ok: false, error: "No chatPairs to finalize" });

    if (appendToJsonl) {
      const stream = fs.createWriteStream(CHAT_JSONL, { flags: "a", encoding: "utf8" });
      let appended = 0;

      for (const p of pairs) {
        const messages = [];
        if (p.system && p.system.trim()) {
          messages.push({ role: "system", content: p.system.trim() });
        }
        messages.push({ role: "user", content: p.user });
        messages.push({ role: "assistant", content: p.assistant });

        // Minimal validation
        if (!messages.find(m => m.role === "user") || !messages.find(m => m.role === "assistant")) {
          continue;
        }
        const row = JSON.stringify({ messages });
        stream.write(row + "\n");
        appended++;
      }
      stream.end();

      // Count lines in file for total
      let total = 0;
      if (fs.existsSync(CHAT_JSONL)) {
        const fileTxt = fs.readFileSync(CHAT_JSONL, "utf8");
        total = fileTxt.split("\n").filter(Boolean).length;
      }

      return res.json({
        ok: true,
        trainer_entry_id: id,
        appended,
        jsonlPath: CHAT_JSONL,
        totalExamplesInFile: total
      });
    }

    res.json({ ok: true, trainer_entry_id: id, appended: 0, message: "appendToJsonl was false — nothing written." });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

module.exports = router;

