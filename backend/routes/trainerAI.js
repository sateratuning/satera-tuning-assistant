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

// ---------- In-memory chat store (replace with DB if you want persistence) ----------
/**
 * Map<conversationId, {
 *   system: { role, content },
 *   context: { vehicle:any, comparison:any, samples:{before:[],after:[]} },
 *   messages: Array<{role:'user'|'assistant', content:string}>
 * }>
 */
const chatStore = new Map();

// ============================================================================
// CSV HELPERS — dynamic "offset-locate" + multi-delim support
// ============================================================================

function normalizeNewlines(s) {
  return String(s || "").replace(/\r\n/g, "\n");
}
function splitLines(s) {
  return normalizeNewlines(s).split("\n");
}
function smartSplit(line) {
  // prefer comma; fallback to semicolon; fallback to tab
  if (line.includes(",")) return line.split(",");
  if (line.includes(";")) return line.split(";");
  return line.split("\t");
}
function locateHeaderIndex(lines) {
  // Find the first row where one of the cells is EXACTLY "Offset"
  for (let i = 0; i < lines.length; i++) {
    const cells = smartSplit(lines[i]).map(c => String(c).trim());
    if (cells.some(c => c === "Offset")) return i;
  }
  return -1;
}
function nextNonEmptyIndex(lines, startIdx) {
  for (let i = startIdx; i < lines.length; i++) {
    const cells = smartSplit(lines[i]).map(c => String(c).trim());
    const any = cells.some(c => c.length > 0);
    if (any) return i;
  }
  return -1;
}

function parseCSVDynamic(content) {
  const lines = splitLines(content);
  if (!lines.length) throw new Error("CSV file empty");

  const headerRowIndex = locateHeaderIndex(lines);
  if (headerRowIndex === -1) throw new Error('Could not locate header row containing "Offset".');

  const headers = smartSplit(lines[headerRowIndex]).map(h => h.trim());
  const unitsRowIndex = headerRowIndex + 1;
  const dataStartIndex = nextNonEmptyIndex(lines, unitsRowIndex + 1);
  if (dataStartIndex === -1) throw new Error("No data rows found in CSV.");

  // helper to pick a numeric if possible
  const toNum = (v) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : s; // keep string if not numeric (rare)
  };

  const indexOf = (name) => headers.findIndex(h => h === name);

  const cols = {
    t: indexOf("Offset"),
    mph: indexOf("Vehicle Speed (SAE)"),
    tps: indexOf("Throttle Position (%)"),
    pedal: indexOf("Accelerator Pedal Position (%)"),
    map: indexOf("Manifold Absolute Pressure (SAE)"),
    spark: indexOf("Spark Advance"),
    kr: indexOf("Knock Retard (SAE)"),
    ect: indexOf("Engine Coolant Temperature"),
    oil: indexOf("Engine Oil Pressure"),
    stft1: indexOf("Short Term Fuel Trim Bank 1"),
    stft2: indexOf("Short Term Fuel Trim Bank 2"),
    ltft1: indexOf("Long Term Fuel Trim Bank 1"),
    ltft2: indexOf("Long Term Fuel Trim Bank 2"),
    mis1: indexOf("Misfire Cylinder 1"),
    mis2: indexOf("Misfire Cylinder 2"),
    mis3: indexOf("Misfire Cylinder 3"),
    mis4: indexOf("Misfire Cylinder 4"),
    mis5: indexOf("Misfire Cylinder 5"),
    mis6: indexOf("Misfire Cylinder 6"),
    mis7: indexOf("Misfire Cylinder 7"),
    mis8: indexOf("Misfire Cylinder 8"),
  };

  if (cols.t === -1 || cols.mph === -1) {
    throw new Error('Required columns missing: need "Offset" and "Vehicle Speed (SAE)".');
  }

  const rows = [];
  for (let i = dataStartIndex; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    const arr = smartSplit(raw);

    const pick = (idx) => {
      if (idx === -1 || idx >= arr.length) return null;
      return toNum(arr[idx]);
    };

    const misVals = [
      pick(cols.mis1), pick(cols.mis2), pick(cols.mis3), pick(cols.mis4),
      pick(cols.mis5), pick(cols.mis6), pick(cols.mis7), pick(cols.mis8),
    ].filter(v => v !== null && v !== undefined);

    rows.push({
      t: Number(pick(cols.t)),
      mph: Number(pick(cols.mph)),
      tps: typeof pick(cols.tps) === 'number' ? Number(pick(cols.tps)) : pick(cols.tps),
      pedal: typeof pick(cols.pedal) === 'number' ? Number(pick(cols.pedal)) : pick(cols.pedal),
      map: typeof pick(cols.map) === 'number' ? Number(pick(cols.map)) : pick(cols.map),
      spark: typeof pick(cols.spark) === 'number' ? Number(pick(cols.spark)) : pick(cols.spark),
      kr: typeof pick(cols.kr) === 'number' ? Number(pick(cols.kr)) : pick(cols.kr),
      ect: typeof pick(cols.ect) === 'number' ? Number(pick(cols.ect)) : pick(cols.ect),
      oil: typeof pick(cols.oil) === 'number' ? Number(pick(cols.oil)) : pick(cols.oil),
      stft1: typeof pick(cols.stft1) === 'number' ? Number(pick(cols.stft1)) : pick(cols.stft1),
      stft2: typeof pick(cols.stft2) === 'number' ? Number(pick(cols.stft2)) : pick(cols.stft2),
      ltft1: typeof pick(cols.ltft1) === 'number' ? Number(pick(cols.ltft1)) : pick(cols.ltft1),
      ltft2: typeof pick(cols.ltft2) === 'number' ? Number(pick(cols.ltft2)) : pick(cols.ltft2),
      mis: misVals.map(v => Number(v)).filter(n => Number.isFinite(n)),
    });
  }

  if (!rows.length) throw new Error("No data rows parsed.");
  return { headers, data: rows, cols };
}

function readCsvFileParsed(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return parseCSVDynamic(content);
}

function safeUnlink(p) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}

// ============================================================================
// ANALYSIS HELPERS
// ============================================================================

function bestIntervalTime(rows, mphStart, mphEnd) {
  // Fastest segment from mphStart->mphEnd (simple crossing detection).
  let best = null;
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1], c = rows[i];
    if (p.mph < mphStart && c.mph >= mphStart) {
      const tStart = c.t;
      for (let j = i; j < rows.length; j++) {
        const p2 = rows[j - 1] || rows[j], c2 = rows[j];
        if (p2.mph < mphEnd && c2.mph >= mphEnd) {
          const tEnd = c2.t;
          const dt = tEnd - tStart;
          if (dt > 0 && (best === null || dt < best)) best = dt;
          break;
        }
      }
    }
  }
  return best;
}

function summarizeKR(rows) {
  let maxKR = 0;
  let krEvents = 0;
  for (const r of rows) {
    const k = Number(r.kr);
    if (Number.isFinite(k)) {
      if (k > maxKR) maxKR = k;
      if (k > 0) krEvents++;
    }
  }
  return { maxKR, krEvents };
}

function wotFilter(rows) {
  const hasTPS = rows.some(r => Number.isFinite(r.tps));
  return rows.filter(r => {
    if (hasTPS) return Number.isFinite(r.tps) && r.tps > 85;
    return Number.isFinite(r.pedal) && r.pedal > 85;
  });
}

function summarizeWOT(rows) {
  const wot = wotFilter(rows);
  let sparkMaxWOT = null, mapMinWOT = null, mapMaxWOT = null;
  for (const r of wot) {
    if (Number.isFinite(r.spark)) {
      sparkMaxWOT = sparkMaxWOT === null ? r.spark : Math.max(sparkMaxWOT, r.spark);
    }
    if (Number.isFinite(r.map)) {
      mapMinWOT = mapMinWOT === null ? r.map : Math.min(mapMinWOT, r.map);
      mapMaxWOT = mapMaxWOT === null ? r.map : Math.max(mapMaxWOT, r.map);
    }
  }
  return { sparkMaxWOT, mapMinWOT, mapMaxWOT };
}

function summarizeTrims(rows) {
  const acc = { stft1: [], stft2: [], ltft1: [], ltft2: [] };
  for (const r of rows) {
    if (Number.isFinite(r.stft1)) acc.stft1.push(r.stft1);
    if (Number.isFinite(r.stft2)) acc.stft2.push(r.stft2);
    if (Number.isFinite(r.ltft1)) acc.ltft1.push(r.ltft1);
    if (Number.isFinite(r.ltft2)) acc.ltft2.push(r.ltft2);
  }
  const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const stft1 = avg(acc.stft1), stft2 = avg(acc.stft2);
  const ltft1 = avg(acc.ltft1), ltft2 = avg(acc.ltft2);
  const varSTFT = (Number.isFinite(stft1) && Number.isFinite(stft2)) ? Math.abs(stft1 - stft2) : null;
  const varLTFT = (Number.isFinite(ltft1) && Number.isFinite(ltft2)) ? Math.abs(ltft1 - ltft2) : null;
  return { stft1, stft2, ltft1, ltft2, varSTFT, varLTFT };
}

function summarizeMisfires(rows) {
  const totals = new Array(8).fill(0);
  for (const r of rows) {
    if (Array.isArray(r.mis) && r.mis.length) {
      r.mis.forEach((v, i) => { if (Number.isFinite(v)) totals[i] += v; });
    }
  }
  return totals;
}

function sampleRowsForAI(rows, step = 400) {
  const out = [];
  for (let i = 0; i < rows.length; i += step) {
    const r = rows[i];
    out.push({
      t: r.t, mph: r.mph, tps: r.tps, pedal: r.pedal, map: r.map, spark: r.spark, kr: r.kr,
    });
  }
  // ensure last row is included
  if (rows.length && out[out.length - 1]?.t !== rows[rows.length - 1].t) {
    const r = rows[rows.length - 1];
    out.push({ t: r.t, mph: r.mph, tps: r.tps, pedal: r.pedal, map: r.map, spark: r.spark, kr: r.kr });
  }
  return out;
}

function buildComparison(before, after) {
  const bRows = before.data, aRows = after.data;

  const bKR = summarizeKR(bRows), aKR = summarizeKR(aRows);
  const bTimes = {
    zeroToSixty: bestIntervalTime(bRows, 0, 60),
    fortyToHundred: bestIntervalTime(bRows, 40, 100),
    sixtyToOneThirty: bestIntervalTime(bRows, 60, 130),
  };
  const aTimes = {
    zeroToSixty: bestIntervalTime(aRows, 0, 60),
    fortyToHundred: bestIntervalTime(aRows, 40, 100),
    sixtyToOneThirty: bestIntervalTime(aRows, 60, 130),
  };
  const bWOT = summarizeWOT(bRows), aWOT = summarizeWOT(aRows);
  const bTrim = summarizeTrims(bRows), aTrim = summarizeTrims(aRows);
  const bMis = summarizeMisfires(bRows), aMis = summarizeMisfires(aRows);

  return {
    before: { KR: bKR, times: bTimes, WOT: bWOT, fuel: bTrim, misfires: bMis },
    after:  { KR: aKR, times: aTimes, WOT: aWOT, fuel: aTrim, misfires: aMis },
    deltas: {
      KR_max_change: (aKR.maxKR ?? 0) - (bKR.maxKR ?? 0),
      KR_event_change: (aKR.krEvents ?? 0) - (bKR.krEvents ?? 0),
      t_0_60_change: (aTimes.zeroToSixty ?? NaN) - (bTimes.zeroToSixty ?? NaN),
      t_40_100_change: (aTimes.fortyToHundred ?? NaN) - (bTimes.fortyToHundred ?? NaN),
      t_60_130_change: (aTimes.sixtyToOneThirty ?? NaN) - (bTimes.sixtyToOneThirty ?? NaN),
      sparkMaxWOT_change: (aWOT.sparkMaxWOT ?? NaN) - (bWOT.sparkMaxWOT ?? NaN),
      mapMinWOT_change: (aWOT.mapMinWOT ?? NaN) - (bWOT.mapMinWOT ?? NaN),
      mapMaxWOT_change: (aWOT.mapMaxWOT ?? NaN) - (bWOT.mapMaxWOT ?? NaN),
      varSTFT_change: (aTrim.varSTFT ?? NaN) - (bTrim.varSTFT ?? NaN),
      varLTFT_change: (aTrim.varLTFT ?? NaN) - (bTrim.varLTFT ?? NaN),
    },
  };
}

// ============================================================================
// PROMPTS
// ============================================================================
function systemPrompt() {
  return `
You are Satera Trainer, a Gen 3 HEMI datalog expert. Compare BEFORE and AFTER logs and explain changes in:
- KR behavior (max & frequency), WOT timing peak, WOT MAP range, 0–60 / 40–100 / 60–130 times,
- Fuel trim variance (bank-to-bank) and any misfire totals if available.
Be concise, mechanics-friendly, and say plainly when data is missing. Never ask for tables; rely only on logs and provided metrics.
`.trim();
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /trainer-ai
 * form-data:
 *   - beforeLog (file, CSV)
 *   - afterLog  (file, CSV)
 *   - meta (stringified JSON) optional (vehicle info, etc.)
 *
 * Returns: { conversationId, comparison, aiSummary, meta, logs:{beforeSampleCount, afterSampleCount} }
 */
router.post(
  "/trainer-ai",
  upload.fields([
    { name: "beforeLog", maxCount: 1 },
    { name: "afterLog", maxCount: 1 },
    { name: "meta", maxCount: 1 }, // stringified JSON
  ]),
  async (req, res) => {
    let beforePath = null, afterPath = null;
    try {
      // Parse meta
      let meta = {};
      try { meta = req.body?.meta ? JSON.parse(req.body.meta) : {}; } catch { meta = {}; }

      // Logs (required for this log-only trainer)
      beforePath = req.files?.beforeLog?.[0]?.path || null;
      afterPath  = req.files?.afterLog?.[0]?.path  || null;
      if (!beforePath || !afterPath) {
        return res.status(400).json({ error: "Please upload both beforeLog and afterLog CSV files." });
      }

      const beforeParsed = readCsvFileParsed(beforePath);
      const afterParsed  = readCsvFileParsed(afterPath);

      const comparison = buildComparison(beforeParsed, afterParsed);
      const samples = {
        before: sampleRowsForAI(beforeParsed.data, 400),
        after:  sampleRowsForAI(afterParsed.data, 400),
      };

      // Seed conversation
      const conversationId = crypto.randomUUID();
      const systemMsg = { role: "system", content: systemPrompt() };
      const seedUser = {
        role: "user",
        content: JSON.stringify({
          vehicle: meta,
          comparison,
          samples
        }, null, 2),
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

      // store convo in memory
      chatStore.set(conversationId, {
        system: systemMsg,
        context: { vehicle: meta, comparison, samples },
        messages: [seedUser, { role: "assistant", content: aiSummary }],
      });

      // Optional: save training entry shell to Supabase (kept compatible with your fine-tune path)
      try {
        const { createClient } = require("@supabase/supabase-js");
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (supabaseUrl && supabaseKey) {
          const supabase = createClient(supabaseUrl, supabaseKey);
          await supabase
            .from("trainer_entries")
            .insert([{
              vehicle: meta,
              sparkChanges: [],         // no tables now; keep column compatibility
              aiSummary,
              created_at: new Date().toISOString(),
            }]);
        } else {
          console.warn("Supabase env missing — skipping trainer_entries insert.");
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

    // Keep context fresh but bounded
    const contextReminder = {
      role: "system",
      content: `Context (do not request tables; rely on logs): ${JSON.stringify(convo.context).slice(0, 12000)}`
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
// FEEDBACK + FINE-TUNE (UNCHANGED INTERFACES)
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
          // Keep compatibility: sparkChanges may be empty in log-only mode
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
