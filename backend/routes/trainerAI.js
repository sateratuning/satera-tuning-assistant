// routes/trainerAI.js
require("dotenv").config();

const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const path = require("path");
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

// ---------- Helpers (match backend/index.js parsing) ----------
function analyzeCsvContent(content) {
  const lines = String(content).split(/\r?\n/).map(l => l.trim());
  if (!lines.length) throw new Error('CSV file empty');
  const headerRowIndex = lines.findIndex(r => r.toLowerCase().startsWith('offset'));
  if (headerRowIndex === -1) throw new Error('Could not locate header row');
  const headers = (lines[headerRowIndex] || '').split(',').map(h => h.trim());
  const dataStart = headerRowIndex + 4;
  const dataRows = lines.slice(dataStart).filter(row => row && row.includes(','));
  const toNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; };
  const parsed = dataRows.map(row => {
    const values = row.split(',');
    const obj = {};
    headers.forEach((h, i) => { obj[h] = toNum(values[i]); });
    return obj;
  });
  if (!parsed.length) throw new Error('No data rows found in CSV.');
  return { headers, parsed };
}

function readCsvAsParsed(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return analyzeCsvContent(content);
}

function safeUnlink(p) {
  try {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch {}
}

/**
 * Parse HPT "Copy with Axis" spark table pasted as tab-delimited text.
 * Returns: { rpm:number[17], load:number[17], data:number[17][17], _debug }
 */
function parseHptSpark(text) {
  const rows = String(text || "").trim().split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) throw new Error("Spark table appears empty.");

  const split = (line) => line.split(/\t|,/).map((s) => s.trim());

  // Header
  const header = split(rows[0]);
  const debug = { headerLen: header.length, dataRowLens: [] };

  if (header.length < 19) {
    const msg = `Header malformed (expected >= 19 columns including unit + 17 RPM + 'rpm', got ${header.length}).`;
    const e = new Error(msg);
    e._debug = debug;
    throw e;
  }

  const rpm = header.slice(1, 18).map(Number);
  if (rpm.length !== 17 || rpm.some((n) => !Number.isFinite(n))) {
    const msg = "RPM header parse failed — ensure 17 numeric RPM columns present.";
    const e = new Error(msg);
    e._debug = { ...debug, rpmPreview: header.slice(1, 18) };
    throw e;
  }

  // Data rows
  const data = [];
  const load = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = split(rows[r]);
    if (!cells.length) continue;
    debug.dataRowLens.push(cells.length);

    if (cells.length === 1 && (cells[0].toLowerCase?.() === "g")) continue; // trailing unit

    if (cells.length < 18) continue;

    const rowLoad = Number(cells[0]);
    if (!Number.isFinite(rowLoad)) continue;

    const valueSlice = cells.slice(1, 18);
    const rowVals = valueSlice.map(Number);
    if (rowVals.length !== 17 || rowVals.some((n) => !Number.isFinite(n))) continue;

    load.push(rowLoad);
    data.push(rowVals);
  }

  if (data.length !== 17) {
    const msg = `Expected 17 load rows; got ${data.length}. Paste full 17×17 with axes.`;
    const e = new Error(msg);
    e._debug = { ...debug, loadCount: data.length };
    throw e;
  }

  return { rpm, load, data, _debug: debug };
}

/**
 * Diffs two parsed tables by aligned axes.
 * Returns [{ rpm, airmass, before, after, delta }]
 */
function diffSparkTables(startTbl, finalTbl) {
  const { rpm, load, data: A } = startTbl;
  const { rpm: rpm2, load: load2, data: B } = finalTbl;

  const sameRpm =
    rpm.length === rpm2.length && rpm.every((v, i) => v === rpm2[i]);
  const sameLoad =
    load.length === load2.length && load.every((v, i) => v === load2[i]);

  if (!sameRpm || !sameLoad) {
    const e = new Error("Axes mismatch between Start and Final spark tables.");
    e._debug = {
      start: { rpm, load },
      final: { rpm: rpm2, load: load2 },
    };
    throw e;
  }

  const out = [];
  for (let r = 0; r < load.length; r++) {
    for (let c = 0; c < rpm.length; c++) {
      const before = A[r][c];
      const after = B[r][c];
      if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
      if (before === after) continue;
      out.push({
        rpm: rpm[c],
        airmass: load[r],
        before,
        after,
        delta: Number((after - before).toFixed(2)),
      });
    }
  }
  return out;
}

// ---------- Main Trainer Endpoint ----------
router.post(
  "/trainer-ai",
  upload.fields([
    { name: "beforeLog", maxCount: 1 }, // files (optional)
    { name: "afterLog", maxCount: 1 },  // files (optional)
    // sparkTableStart/Final come from TEXTAREAS -> req.body (optional now)
    { name: "meta", maxCount: 1 },      // optional metadata JSON from frontend
  ]),
  async (req, res) => {
    let beforePath = null;
    let afterPath = null;

    try {
      const form = req.body || {};

      // 0) Parse meta (if sent as JSON string)
      let meta = {};
      try {
        meta = form.meta ? JSON.parse(form.meta) : {};
      } catch {
        meta = {};
      }

      // 1) Spark tables (now OPTIONAL)
      const rawStart = (form.sparkTableStart || "").trim();
      const rawFinal = (form.sparkTableFinal || "").trim();

      let startTbl = null, finalTbl = null, sparkChanges = [];
      if (rawStart && rawFinal) {
        try {
          startTbl = parseHptSpark(rawStart);
          finalTbl = parseHptSpark(rawFinal);
          sparkChanges = diffSparkTables(startTbl, finalTbl);
        } catch (e) {
          return res
            .status(400)
            .json({ error: `Spark table parse/diff failed: ${e.message}`, debug: e._debug || null });
        }
      }

      // 2) Logs (optional) — parse with SAME logic as AI Review
      beforePath = req.files?.beforeLog?.[0]?.path || null;
      afterPath  = req.files?.afterLog?.[0]?.path  || null;

      let beforeParsed = null;
      let afterParsed  = null;
      try {
        if (beforePath) beforeParsed = readCsvAsParsed(beforePath);
        if (afterPath)  afterParsed  = readCsvAsParsed(afterPath);
      } catch (e) {
        console.warn("CSV parse warning:", e.message);
      }

      // Sample every 400th row for AI context (same as AI Review)
      const sample = (arr) => Array.isArray(arr) ? arr.filter((_, i) => i % 400 === 0).slice(0, 200) : [];

      const beforeSample = beforeParsed ? sample(beforeParsed.parsed) : [];
      const afterSample  = afterParsed  ? sample(afterParsed.parsed)  : [];

      // 3) Build AI prompt (non-fatal if model unavailable)
      const prompt = `You are a professional HEMI tuner training an AI. Given:

Vehicle Info:
${JSON.stringify(meta, null, 2)}

Spark Table Changes (subset, may be empty):
${JSON.stringify((sparkChanges || []).slice(0, 50), null, 2)}

Before Log (sampled, may be empty):
${JSON.stringify(beforeSample.slice(0, 20), null, 2)}

After Log (sampled, may be empty):
${JSON.stringify(afterSample.slice(0, 20), null, 2)}

Explain clearly what changed in the spark table and/or what the logs imply for spark corrections (knock behavior, airmass, airflow, fueling, torque, MAP scaling, injector data, NN on/off, etc.).`;

      let aiSummary = "";
      try {
        const chatResponse = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are an expert HEMI tuning AI trainer." },
            { role: "user", content: prompt },
          ],
          temperature: 0.4,
        });
        aiSummary = chatResponse?.choices?.[0]?.message?.content || "";
      } catch (e) {
        console.warn("OpenAI summary skipped:", e.message);
        aiSummary = "Model unavailable. Entry saved with logs/tables.";
      }

      // 4) Build training entry
      const trainingEntry = {
        vehicle: meta,                   // use parsed meta object
        axes: startTbl ? { rpm: startTbl.rpm, load: startTbl.load } : null,
        sparkChanges,
        aiSummary,
        created_at: new Date().toISOString(),
      };

      // 5) Optional Supabase save
      let insertedEntry = trainingEntry;
      try {
        const { createClient } = require("@supabase/supabase-js");
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (supabaseUrl && supabaseKey) {
          const supabase = createClient(supabaseUrl, supabaseKey);
          const { data, error } = await supabase
            .from("trainer_entries")
            .insert([trainingEntry])
            .select()
            .single();

          if (error) {
            console.warn("Supabase insert warning:", error.message);
          } else {
            insertedEntry = data;
          }
        } else {
          console.warn("Supabase env missing — skipping DB insert.");
        }
      } catch (e) {
        console.warn("Supabase save skipped:", e.message);
      }

      // 6) Respond
      return res.json({
        trainingEntry: insertedEntry,
        aiSummary,
        sparkChanges,
        meta,
        logs: {
          beforeSampleCount: beforeSample.length,
          afterSampleCount: afterSample.length,
        }
      });
    } catch (err) {
      console.error("trainer-ai error:", err);
      return res.status(500).json({ error: err.message || "AI training failed." });
    } finally {
      // Cleanup files
      safeUnlink(beforePath);
      safeUnlink(afterPath);
    }
  }
);

// ---------- Feedback update ----------
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

// ---------- Fine-tune trigger (optional) ----------
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

    if (entriesResp.error) {
      throw new Error("Failed to fetch trainer entries");
    }
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
