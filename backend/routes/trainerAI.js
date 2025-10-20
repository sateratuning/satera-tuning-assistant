// routes/trainerAI.js
require("dotenv").config();

const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const csvParser = require("csv-parser");
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

// ---------- Helpers ----------
function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

function safeUnlink(p) {
  try {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch {}
}

/**
 * Parse HPT "Copy with Axis" spark table pasted as tab-delimited text.
 * Accepts:
 *  - Header: [unit, 17 RPMs..., 'rpm']
 *  - Data rows:
 *      19 cells -> [airmass, 17 values, 'g']
 *      18 cells -> [airmass, 17 values]
 * Ignores lone trailing "g" lines.
 * Returns: { rpm:number[17], load:number[17], data:number[17][17], _debug }
 */
function parseHptSpark(text) {
  const rows = String(text || "").trim().split(/\r?\n/).filter(Boolean);
  if (rows.length < 2) throw new Error("Spark table appears empty.");

  // Prefer tabs; tolerate commas
  const split = (line) => line.split(/\t|,/).map((s) => s.trim());

  // ----- Header -----
  const header = split(rows[0]);
  const debug = { headerLen: header.length, dataRowLens: [] };

  if (header.length < 19) {
    const msg = `Header malformed (expected >= 19 columns including unit + 17 RPM + 'rpm', got ${header.length}).`;
    const e = new Error(msg);
    e._debug = debug;
    throw e;
  }

  // Remove first (unit) and last ("rpm"), keep 17 numbers
  const rpm = header.slice(1, 18).map(Number);
  if (rpm.length !== 17 || rpm.some((n) => !Number.isFinite(n))) {
    const msg = "RPM header parse failed — ensure 17 numeric RPM columns present.";
    const e = new Error(msg);
    e._debug = { ...debug, rpmPreview: header.slice(1, 18) };
    throw e;
  }

  // ----- Data rows -----
  const data = [];
  const load = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = split(rows[r]);
    if (!cells.length) continue;
    debug.dataRowLens.push(cells.length);

    // Skip lone trailing 'g'
    if (cells.length === 1 && (cells[0].toLowerCase?.() === "g")) continue;

    // Valid rows: >= 18
    if (cells.length < 18) continue;

    const rowLoad = Number(cells[0]);
    if (!Number.isFinite(rowLoad)) continue;

    // If last token is 'g', drop it (common when copying)
    const maybeUnit = cells[cells.length - 1];
    const valueSlice = (cells.length >= 19 && maybeUnit?.toLowerCase?.() === "g")
      ? cells.slice(1, 18)
      : cells.slice(1, 18);

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
    { name: "beforeLog", maxCount: 1 }, // files
    { name: "afterLog", maxCount: 1 },  // files
    // sparkTableStart/Final come from TEXTAREAS -> req.body
  ]),
  async (req, res) => {
    let beforePath = null;
    let afterPath = null;

    try {
      const form = req.body || {};

      // 1) Validate + parse spark tables (text)
      const rawStart = (form.sparkTableStart || "").trim();
      const rawFinal = (form.sparkTableFinal || "").trim();
      if (!rawStart || !rawFinal) {
        return res
          .status(400)
          .json({ error: "Missing sparkTableStart or sparkTableFinal in body." });
      }

      let startTbl, finalTbl;
      try {
        startTbl = parseHptSpark(rawStart);
        finalTbl = parseHptSpark(rawFinal);
      } catch (e) {
        return res
          .status(400)
          .json({ error: `Spark table parse failed: ${e.message}`, debug: e._debug || null });
      }

      // 2) Diff spark tables (wrap to avoid 500s on mismatch)
      let sparkChanges = [];
      try {
        sparkChanges = diffSparkTables(startTbl, finalTbl);
      } catch (e) {
        return res.status(400).json({ error: e.message, debug: e._debug || null });
      }

      // 3) Logs (optional) — parse CSVs if present
      beforePath = req.files?.beforeLog?.[0]?.path || null;
      afterPath  = req.files?.afterLog?.[0]?.path  || null;

      let beforeLogRows = [];
      let afterLogRows = [];
      try {
        if (beforePath) beforeLogRows = await parseCSV(beforePath);
        if (afterPath)  afterLogRows  = await parseCSV(afterPath);
      } catch (e) {
        console.warn("CSV parse warning:", e.message);
      }

      // Sample every 400th row for AI context
      const sample = (rows) => rows.filter((_, idx) => idx % 400 === 0);
      const beforeSample = sample(beforeLogRows).slice(0, 200);
      const afterSample  = sample(afterLogRows).slice(0, 200);

      // 4) Build AI prompt and get summary (non-fatal if model unavailable)
      const prompt = `You are a professional HEMI tuner training an AI. Given:

Vehicle Info:
${JSON.stringify(form, null, 2)}

Spark Table Changes (subset):
${JSON.stringify(sparkChanges.slice(0, 50), null, 2)}

Before Log (sampled):
${JSON.stringify(beforeSample.slice(0, 20), null, 2)}

After Log (sampled):
${JSON.stringify(afterSample.slice(0, 20), null, 2)}

Explain clearly what changed in the spark table and why (knock, throttle, airmass, airflow, fueling, torque, MAP scaling, injector data, NN on/off, etc.).`;

      let aiSummary = "";
      try {
        const chatResponse = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || "gpt-3.5-turbo-0125",
          messages: [
            { role: "system", content: "You are an expert HEMI tuning AI trainer." },
            { role: "user", content: prompt },
          ],
          temperature: 0.4,
        });
        aiSummary = chatResponse?.choices?.[0]?.message?.content || "";
      } catch (e) {
        console.warn("OpenAI summary skipped:", e.message);
        aiSummary = "Model unavailable. Table diff computed successfully.";
      }

      // 5) Build training entry
      const trainingEntry = {
        vehicle: form,
        axes: { rpm: startTbl.rpm, load: startTbl.load },
        sparkChanges,
        aiSummary,
        feedback: form.feedback || null,
        created_at: new Date().toISOString(),
      };

      // 6) Optional Supabase save (skip if env missing)
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

      // 7) Respond
      return res.json({ trainingEntry: insertedEntry, aiSummary, sparkChanges });
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
