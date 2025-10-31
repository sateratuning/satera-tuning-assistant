// routes/trainerAI.js
require("dotenv").config();

const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { OpenAI } = require("openai");

// ---------- OpenAI ----------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------- Uploads (disk) ----------
const uploadsDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB/file
});

// ---------- Shared AI Review Parser ----------
/**
 * We reuse your existing AI Review parser to ensure identical behavior:
 * backend/utils/parseCSV.js  -> returns a "metrics" object (or null on failure)
 */
const parseCSV = require("../utils/parseCSV");

// ---------- In-memory chat store ----------
/**
 * Map<conversationId, {
 *   system: { role, content },
 *   context: { vehicle:any, comparison:any, samples:{before:[],after:[]} },
 *   messages: Array<{role:'user'|'assistant', content:string}>
 * }>
 */
const chatStore = new Map();

// ---------- Helpers ----------
function safeUnlink(p) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}

// Build comparison object from parseCSV.js metrics
function buildComparisonFromMetrics(b, a) {
  const countKREvents = (knockArr) =>
    Array.isArray(knockArr) ? knockArr.filter(v => Number.isFinite(v) && v > 0).length : 0;

  const before = {
    KR: {
      maxKR: Array.isArray(b.knock) && b.knock.length ? Math.max(...b.knock) : 0,
      krEvents: countKREvents(b.knock),
    },
    times: {
      zeroToSixty: b.zeroTo60 ?? null,
      fortyToHundred: b.fortyTo100 ?? null,
      sixtyToOneThirty: b.sixtyTo130 ?? null,
    },
    WOT: {
      // parseCSV.js "peakTiming" is global max; mirrors AI Review if that's what's used.
      sparkMaxWOT: b.peakTiming ?? null,
      mapMinWOT: b.map?.min ?? null,
      mapMaxWOT: b.map?.max ?? null,
    },
    fuel: {
      stft1: null, stft2: null, // not provided by parseCSV.js
      ltft1: b.avgFT1 ?? null,
      ltft2: b.avgFT2 ?? null,
      varSTFT: null,
      varLTFT: b.varFT ?? null,
    },
    misfires: [
      b.misfires?.Cyl1 ?? 0, b.misfires?.Cyl2 ?? 0,
      b.misfires?.Cyl3 ?? 0, b.misfires?.Cyl4 ?? 0,
      b.misfires?.Cyl5 ?? 0, b.misfires?.Cyl6 ?? 0,
      b.misfires?.Cyl7 ?? 0, b.misfires?.Cyl8 ?? 0,
    ],
  };

  const after = {
    KR: {
      maxKR: Array.isArray(a.knock) && a.knock.length ? Math.max(...a.knock) : 0,
      krEvents: countKREvents(a.knock),
    },
    times: {
      zeroToSixty: a.zeroTo60 ?? null,
      fortyToHundred: a.fortyTo100 ?? null,
      sixtyToOneThirty: a.sixtyTo130 ?? null,
    },
    WOT: {
      sparkMaxWOT: a.peakTiming ?? null,
      mapMinWOT: a.map?.min ?? null,
      mapMaxWOT: a.map?.max ?? null,
    },
    fuel: {
      stft1: null, stft2: null,
      ltft1: a.avgFT1 ?? null,
      ltft2: a.avgFT2 ?? null,
      varSTFT: null,
      varLTFT: a.varFT ?? null,
    },
    misfires: [
      a.misfires?.Cyl1 ?? 0, a.misfires?.Cyl2 ?? 0,
      a.misfires?.Cyl3 ?? 0, a.misfires?.Cyl4 ?? 0,
      a.misfires?.Cyl5 ?? 0, a.misfires?.Cyl6 ?? 0,
      a.misfires?.Cyl7 ?? 0, a.misfires?.Cyl8 ?? 0,
    ],
  };

  const d = (x, y) => (x == null || y == null) ? null : (y - x);

  const deltas = {
    KR_max_change: d(before.KR.maxKR, after.KR.maxKR),
    KR_event_change: d(before.KR.krEvents, after.KR.krEvents),
    t_0_60_change: d(before.times.zeroToSixty, after.times.zeroToSixty),
    t_40_100_change: d(before.times.fortyToHundred, after.times.fortyToHundred),
    t_60_130_change: d(before.times.sixtyToOneThirty, after.times.sixtyToOneThirty),
    sparkMaxWOT_change: d(before.WOT.sparkMaxWOT, after.WOT.sparkMaxWOT),
    mapMinWOT_change: d(before.WOT.mapMinWOT, after.WOT.mapMinWOT),
    mapMaxWOT_change: d(before.WOT.mapMaxWOT, after.WOT.mapMaxWOT),
    varSTFT_change: d(before.fuel.varSTFT, after.fuel.varSTFT),
    varLTFT_change: d(before.fuel.varLTFT, after.fuel.varLTFT),
  };

  return { before, after, deltas };
}

// Lightweight sampler for AI context (keeps token usage small)
// Follows the same header/offset positioning style your parseCSV uses.
function sampleRowsForAI_fromRaw(raw, step = 400) {
  const rows = raw.split(/\r?\n/).map(r => r.trim());
  const headerRowIndex = rows.findIndex(r => r.toLowerCase().startsWith("offset"));
  if (headerRowIndex === -1) return [];
  const headers = rows[headerRowIndex].split(",").map(h => h.trim());
  const dataStart = headerRowIndex + 4;
  const dataRows = rows.slice(dataStart).filter(r => r && r.includes(","));

  const col = (name) => headers.findIndex(h => h === name);
  const idx = {
    t: col("Offset"),
    mph: col("Vehicle Speed (SAE)"),
    tps: col("Throttle Position (%)"),
    pedal: col("Accelerator Pedal Position (%)"),
    map: col("Manifold Absolute Pressure (SAE)"),
    spark: col("Spark Advance"),
    kr: col("Total Knock Retard") !== -1 ? col("Total Knock Retard") : col("Knock Retard (SAE)"),
  };

  const parsed = [];
  for (let i = 0; i < dataRows.length; i += step) {
    const r = dataRows[i].split(",");
    const pick = (i) => (i >= 0 && i < r.length) ? r[i] : null;
    const num = (v) => v == null ? null : Number(v);
    parsed.push({
      t: num(pick(idx.t)),
      mph: num(pick(idx.mph)),
      tps: num(pick(idx.tps)),
      pedal: num(pick(idx.pedal)),
      map: num(pick(idx.map)),
      spark: num(pick(idx.spark)),
      kr: num(pick(idx.kr)),
    });
  }
  // ensure last row is included
  if (dataRows.length) {
    const r = dataRows[dataRows.length - 1].split(",");
    const pick = (i) => (i >= 0 && i < r.length) ? r[i] : null;
    const num = (v) => v == null ? null : Number(v);
    const last = {
      t: num(pick(idx.t)),
      mph: num(pick(idx.mph)),
      tps: num(pick(idx.tps)),
      pedal: num(pick(idx.pedal)),
      map: num(pick(idx.map)),
      spark: num(pick(idx.spark)),
      kr: num(pick(idx.kr)),
    };
    if (!parsed.length || parsed[parsed.length - 1].t !== last.t) parsed.push(last);
  }
  return parsed.filter(r => Number.isFinite(r.t) && Number.isFinite(r.mph));
}

// ---------- System prompt ----------
function trainerSystemPrompt() {
  return `
You are Satera Trainer (Gen3 HEMI). Compare BEFORE and AFTER logs using the metrics provided.
- If a time target wasn't reached (e.g., car never hit 100 mph), say: "not achieved in this log".
- If a channel isn't present, say: "not logged".
- Be precise, mechanics-friendly, and do not request tune tables.
`.trim();
}

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /trainer-ai
 * form-data:
 *   - beforeLog (file, CSV)
 *   - afterLog  (file, CSV)
 *   - meta (stringified JSON) optional vehicle info
 *
 * Returns: { conversationId, comparison, aiSummary, meta, logs:{beforeSampleCount, afterSampleCount} }
 */
router.post(
  "/trainer-ai",
  upload.fields([
    { name: "beforeLog", maxCount: 1 },
    { name: "afterLog", maxCount: 1 },
    { name: "meta", maxCount: 1 },
  ]),
  async (req, res) => {
    let beforePath = null, afterPath = null;
    try {
      // meta
      let meta = {};
      try { meta = req.body?.meta ? JSON.parse(req.body.meta) : {}; } catch { meta = {}; }

      // require logs
      beforePath = req.files?.beforeLog?.[0]?.path || null;
      afterPath  = req.files?.afterLog?.[0]?.path  || null;
      if (!beforePath || !afterPath) {
        return res.status(400).json({ error: "Please upload both beforeLog and afterLog CSV files." });
      }

      // Parse with the SAME parser as AI Review
      const beforeRaw = fs.readFileSync(beforePath, "utf8");
      const afterRaw  = fs.readFileSync(afterPath, "utf8");

      const beforeMetrics = parseCSV(beforeRaw);
      const afterMetrics  = parseCSV(afterRaw);
      if (!beforeMetrics || !afterMetrics) {
        return res.status(400).json({ error: "CSV could not be parsed by parseCSV.js" });
      }

      // Build comparison
      const comparison = buildComparisonFromMetrics(beforeMetrics, afterMetrics);

      // Sample rows for chat context (every 400th)
      const samples = {
        before: sampleRowsForAI_fromRaw(beforeRaw, 400),
        after:  sampleRowsForAI_fromRaw(afterRaw, 400),
      };

      // Seed conversation
      const conversationId = crypto.randomUUID();
      const systemMsg = { role: "system", content: trainerSystemPrompt() };
      const seedUser = {
        role: "user",
        content: JSON.stringify({ vehicle: meta, comparison, samples }, null, 2),
      };

      let aiSummary = "No summary generated.";
      try {
        const chat = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          messages: [systemMsg, seedUser],
          temperature: 0.3,
        });
        aiSummary = chat?.choices?.[0]?.message?.content || aiSummary;
      } catch (e) {
        console.warn("OpenAI summary error:", e.message);
      }

      chatStore.set(conversationId, {
        system: systemMsg,
        context: { vehicle: meta, comparison, samples },
        messages: [seedUser, { role: "assistant", content: aiSummary }],
      });

      // Optional: store a shell entry in Supabase for feedback/fine-tune continuity
      try {
        const { createClient } = require("@supabase/supabase-js");
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (supabaseUrl && supabaseKey) {
          const supabase = createClient(supabaseUrl, supabaseKey);
          await supabase.from("trainer_entries").insert([{
            vehicle: meta,
            sparkChanges: [], // log-only mode; keep column for compatibility
            aiSummary,
            created_at: new Date().toISOString(),
          }]);
        }
      } catch (e) {
        console.warn("Supabase insert skipped:", e.message);
      }

      return res.json({
        conversationId,
        comparison,
        aiSummary,
        meta,
        logs: {
          beforeSampleCount: samples.before.length,
          afterSampleCount: samples.after.length,
        }
      });
    } catch (err) {
      console.error("trainer-ai error:", err);
      return res.status(500).json({ error: err.message || "AI training failed." });
    } finally {
      safeUnlink(beforePath);
      safeUnlink(afterPath);
    }
  }
);

/**
 * POST /trainer-chat
 * JSON: { conversationId, message }
 * Returns: { reply }
 */
router.post("/trainer-chat", express.json(), async (req, res) => {
  try {
    const { conversationId, message } = req.body || {};
    if (!conversationId || !message) {
      return res.status(400).json({ error: "conversationId and message are required." });
    }
    const convo = chatStore.get(conversationId);
    if (!convo) return res.status(404).json({ error: "Conversation not found. Start with /trainer-ai." });

    // Keep context bounded
    const contextReminder = {
      role: "system",
      content: `Context (log-only; do not request tables): ${JSON.stringify(convo.context).slice(0, 12000)}`
    };

    const recent = convo.messages.slice(-10);
    const msgs = [convo.system, contextReminder, ...recent, { role: "user", content: message }];

    const chat = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: msgs,
      temperature: 0.3,
    });

    const reply = chat?.choices?.[0]?.message?.content || "No response.";
    convo.messages.push({ role: "user", content: message });
    convo.messages.push({ role: "assistant", content: reply });
    chatStore.set(conversationId, convo);

    return res.json({ reply });
  } catch (err) {
    console.error("trainer-chat error:", err);
    return res.status(500).json({ error: err.message || "Chat failed." });
  }
});

// ============================================================================
// Feedback + Fine-tune (same interfaces you already had)
// ============================================================================

router.use(express.json());

router.post("/update-feedback", async (req, res) => {
  try {
    const { id, feedback } = req.body || {};
    if (!id || !feedback) {
      return res.status(400).json({ error: "Missing id or feedback" });
    }

    const { createClient } = require("@supabase/supabase-js");
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { error } = await supabase
      .from("trainer_entries")
      .update({ feedback })
      .eq("id", id);

    if (error) {
      console.error("Feedback update error:", error.message);
      return res.status(500).json({ error: "Update failed" });
    }

    res.json({ success: true });
  } catch (e) {
    console.error("update-feedback error:", e.message);
    res.status(500).json({ error: "Update failed" });
  }
});

router.post("/fine-tune-now", async (req, res) => {
  try {
    const { createClient } = require("@supabase/supabase-js");
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const entriesResp = await supabase
      .from("trainer_entries")
      .select("*")
      .order("created_at", { ascending: true });

    if (entriesResp.error) throw new Error("Failed to fetch trainer entries");
    const entries = entriesResp.data || [];

    const fineTuneData = entries
      .filter((e) => e?.aiSummary && e?.vehicle)
      .map((entry) => {
        const context =
          `Vehicle Info:\n${JSON.stringify(entry.vehicle, null, 2)}\n\n` +
          `Spark Table Changes:\n${JSON.stringify(entry.sparkChanges || [], null, 2)}`;
        const feedbackNote = entry.feedback ? `\n\nTrainer Feedback:\n${entry.feedback}` : "";
        return { prompt: context, completion: (entry.aiSummary || "") + feedbackNote };
      });

    if (!fineTuneData.length) {
      return res.status(400).json({ error: "No valid entries found to fine-tune on." });
    }

    const tempFilePath = path.join(__dirname, "fine-tune-upload.jsonl");
    const jsonlContent = fineTuneData.map((e) => JSON.stringify(e)).join("\n");
    fs.writeFileSync(tempFilePath, jsonlContent);

    const file = await openai.files.create({
      file: fs.createReadStream(tempFilePath),
      purpose: "fine-tune",
    });

    const job = await openai.fineTuning.jobs.create({
      training_file: file.id,
      model: process.env.OPENAI_FINETUNE_MODEL || "gpt-3.5-turbo-0125",
    });

    return res.json({ message: "Fine-tuning started", job });
  } catch (err) {
    console.error("fine-tune-now error:", err.message);
    res.status(500).json({ error: "Fine-tuning failed" });
  }
});

module.exports = router;
