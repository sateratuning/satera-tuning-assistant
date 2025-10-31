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

// ---------- Shared AI Review Parser (headline metrics) ----------
const parseCSV = require("../utils/parseCSV");

// ---------- In-memory chat store ----------
/**
 * Map<conversationId, {
 *   system: { role, content },
 *   context: {
 *     vehicle:any,
 *     comparison:any,
 *     samples:{before:[],after:[]},
 *     extended:{
 *       before:{ detected:any, samples:any[], rpmAirBins:any[] },
 *       after: { detected:any, samples:any[], rpmAirBins:any[] }
 *     }
 *   },
 *   messages: Array<{role:'user'|'assistant', content:string}>
 * }>
 */
const chatStore = new Map();

// ---------- Helpers ----------
function safeUnlink(p) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}

function d(x, y) { return (x == null || y == null) ? null : (y - x); }

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
      // parseCSV.js peakTiming is overall max; mirrors AI Review behavior.
      sparkMaxWOT: b.peakTiming ?? null,
      mapMinWOT: b.map?.min ?? null,
      mapMaxWOT: b.map?.max ?? null,
    },
    fuel: {
      stft1: null, stft2: null, // parseCSV.js doesn't output STFT avg
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

// ---------- Extended extractor (airflow/airmass/fueling/temps/etc.) ----------
function locateHeaderIndex(lines) {
  // Find the first row where ANY cell equals "Offset"
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split(/,|;|\t/).map(c => String(c).trim());
    if (cells.some(c => c === "Offset")) return i;
  }
  return -1;
}

function parseHeadersAndRows(raw) {
  const lines = String(raw || "").split(/\r?\n/).map(r => r.trim());
  const headerRowIndex = locateHeaderIndex(lines);
  if (headerRowIndex === -1) return null;
  const headers = lines[headerRowIndex].split(",").map(h => h.trim());
  const unitsRowIndex = headerRowIndex + 1;
  const firstData = headerRowIndex + 3; // usually a blank line after units then data; still robust below
  // Find first non-empty CSV row after the units row
  let dataStart = unitsRowIndex + 1;
  while (dataStart < lines.length && !lines[dataStart].includes(",")) dataStart++;
  const dataRows = lines.slice(Math.max(firstData, dataStart)).filter(r => r && r.includes(","));
  return { headers, dataRows };
}

function buildAliasIndex(headers) {
  const norm = s => String(s||'').toLowerCase().replace(/\s+/g,' ').trim();
  const H = headers.map(h => norm(h));
  const find = (aliases) => {
    const A = aliases.map(norm);
    for (let i=0;i<H.length;i++) if (A.includes(H[i])) return i;     // exact match
    for (let i=0;i<H.length;i++) for (const a of A) if (a && H[i].includes(a)) return i; // contains
    return -1;
  };

  // Include variants commonly seen in HP Tuners exports
  return {
    t:      find(['offset','time','elapsed time','time (s)','timestamp']),
    rpm:    find(['engine rpm (sae)','engine rpm','rpm']),
    mph:    find(['vehicle speed (sae)','vehicle speed','speed']),
    tb:     find(['throttle position (sae)','throttle position (%)','throttle body angle','throttle angle','tps']),
    pedal:  find(['accelerator position d (sae)','accelerator pedal position (%)','accel pedal pos (%)','accelerator pedal position']),
    map:    find(['manifold absolute pressure (sae)','intake manifold absolute pressure (sae)','manifold absolute pressure','map (kpa)','map']),
    baro:   find(['barometric pressure (sae)','barometric pressure','baro']),
    iat:    find(['intake air temperature (sae)','intake air temperature','iat']),
    cat:    find(['charge air temp','charge air temperature','manifold air temperature','intake manifold temperature','imt','cat']),
    maf:    find(['mass airflow (sae)','mass air flow (sae)','mass airflow','mass air flow','maf']),
    mafPer: find(['mass airflow period','maf period']),
    cylAir: find(['cylinder airmass','cylinder airmass (g)','cyl airmass','aircharge','air charge','cyl air (g)']),
    load:   find(['calculated load','engine load','load']),
    spark:  find(['timing advance (sae)','spark advance (sae)','spark advance','ignition timing advance for #1','ign adv']),
    kr:     find(['total knock retard','knock retard (sae)','knock retard','kr','knock retard short term']),
    injPw:  find(['injector pulse width','injector pulse width (ms)','inj pw']),
    injDuty:find(['injector duty','injector duty cycle','duty cycle']),
    frp:    find(['fuel rail pressure (sae)','fuel rail pressure','fuel pressure']),
    cmdEq:  find(['commanded equivalence ratio','equivalence ratio commanded','cmd eq','commanded lambda','lambda commanded']),
    wbEq: find([
  'wideband lambda',
  'lambda',
  'wb lambda',
  'measured equivalence ratio',
  'wb eq ratio 1 (sae)',
  'wb eq ratio 1 (sae) (2)',
  'wb eq ratio 5 (sae) (2)',
  'wideband eq ratio',
  'equivalence ratio (wb)',
]),
afr: find([
  'wideband afr',
  'afr',
  'air fuel ratio',
  'wideband afr 1 (sae)',
  'wideband afr 1 (sae) (2)',
  'wideband afr 5 (sae) (2)'
]),

    stft1:  find(['short term fuel trim bank 1','stft bank 1','stft1']),
    stft2:  find(['short term fuel trim bank 2','stft bank 2','stft2']),
    ltft1:  find(['long term fuel trim bank 1','ltft bank 1','ltft1']),
    ltft2:  find(['long term fuel trim bank 2','ltft bank 2','ltft2']),
  };
}

function extractExtended(raw, step = 400) {
  const parsed = parseHeadersAndRows(raw);
  if (!parsed) return { detected:{}, samples:[], rpmAirBins:[] };

  const { headers, dataRows } = parsed;
  const idx = buildAliasIndex(headers);
  const pick = (arr, i) => (i>=0 && i<arr.length ? arr[i] : null);
  const num = v => v==null || v==='' ? null : Number(String(v).replace(',', '.'));

  // Downsampled samples for AI context
  const samples = [];
  for (let i=0;i<dataRows.length;i+=step) {
    const r = dataRows[i].split(',');
    samples.push({
      t:   num(pick(r, idx.t)),
      rpm: num(pick(r, idx.rpm)),
      mph: num(pick(r, idx.mph)),
      tb:  num(pick(r, idx.tb)),
      pedal:num(pick(r, idx.pedal)),
      map: num(pick(r, idx.map)),
      baro:num(pick(r, idx.baro)),
      iat: num(pick(r, idx.iat)),
      cat: num(pick(r, idx.cat)),
      maf: num(pick(r, idx.maf)),
      mafPer:num(pick(r, idx.mafPer)),
      cylAir:num(pick(r, idx.cylAir)),
      load: num(pick(r, idx.load)),
      spark:num(pick(r, idx.spark)),
      kr:  num(pick(r, idx.kr)),
      injPw: num(pick(r, idx.injPw)),
      injDuty: num(pick(r, idx.injDuty)),
      frp: num(pick(r, idx.frp)),
      cmdEq: num(pick(r, idx.cmdEq)),
      wbEq: num(pick(r, idx.wbEq)),
      afr: num(pick(r, idx.afr)),
      stft1:num(pick(r, idx.stft1)),
      stft2:num(pick(r, idx.stft2)),
      ltft1:num(pick(r, idx.ltft1)),
      ltft2:num(pick(r, idx.ltft2)),
    });
  }
  // include last row if not already included
  if (dataRows.length) {
    const r = dataRows[dataRows.length-1].split(',');
    const last = {
      t:   num(pick(r, idx.t)),
      rpm: num(pick(r, idx.rpm)),
      mph: num(pick(r, idx.mph)),
      tb:  num(pick(r, idx.tb)),
      pedal:num(pick(r, idx.pedal)),
      map: num(pick(r, idx.map)),
      baro:num(pick(r, idx.baro)),
      iat: num(pick(r, idx.iat)),
      cat: num(pick(r, idx.cat)),
      maf: num(pick(r, idx.maf)),
      mafPer:num(pick(r, idx.mafPer)),
      cylAir:num(pick(r, idx.cylAir)),
      load: num(pick(r, idx.load)),
      spark:num(pick(r, idx.spark)),
      kr:  num(pick(r, idx.kr)),
      injPw: num(pick(r, idx.injPw)),
      injDuty: num(pick(r, idx.injDuty)),
      frp: num(pick(r, idx.frp)),
      cmdEq: num(pick(r, idx.cmdEq)),
      wbEq: num(pick(r, idx.wbEq)),
      afr: num(pick(r, idx.afr)),
      stft1:num(pick(r, idx.stft1)),
      stft2:num(pick(r, idx.stft2)),
      ltft1:num(pick(r, idx.ltft1)),
      ltft2:num(pick(r, idx.ltft2)),
    };
    if (!samples.length || samples[samples.length-1].t !== last.t) samples.push(last);
  }

  // RPM × Cylinder Airmass bin summaries for timing vs aircharge learning
  const rows = dataRows.map(line => {
    const a = line.split(',');
    return {
      rpm: num(pick(a, idx.rpm)),
      cyl: num(pick(a, idx.cylAir)),
      spark: num(pick(a, idx.spark)),
      kr: num(pick(a, idx.kr)),
      iat: num(pick(a, idx.iat)),
      cat: num(pick(a, idx.cat)),
      map: num(pick(a, idx.map)),
      maf: num(pick(a, idx.maf)),
      cmdEq: num(pick(a, idx.cmdEq)),
      wbEq: num(pick(a, idx.wbEq)),
      afr: num(pick(a, idx.afr)),
      ltft1: num(pick(a, idx.ltft1)),
      ltft2: num(pick(a, idx.ltft2)),
    };
  }).filter(r => Number.isFinite(r.rpm));

  const rpmBins = [800,1200,1600,2000,2400,2800,3200,3600,4000,4400,4800,5200,5600,6000,6400,6800];
  const airBins = [0.20,0.25,0.30,0.35,0.40,0.45,0.50,0.55,0.60,0.65,0.70,0.75];

  const findBin = (v, arr) => {
    if (!Number.isFinite(v)) return -1;
    for (let i=0;i<arr.length;i++) if (v < arr[i]) return i;
    return arr.length; // top bin
  };

  const mat = new Map(); // key `${ri}:${ai}` -> accumulator
  const keyOf = (ri, ai) => `${ri}:${ai}`;
  const add = (k, obj) => {
    if (!mat.has(k)) mat.set(k, {
      n:0, sparkSum:0, sparkMax:null, krMax:0,
      iatSum:0, catSum:0, mapSum:0, mafSum:0,
      eqErrSum:0, eqCount:0, ltftVarSum:0, ltftCount:0
    });
    const m = mat.get(k);
    m.n++;
    if (Number.isFinite(obj.spark)) {
      m.sparkSum += obj.spark;
      m.sparkMax = m.sparkMax==null ? obj.spark : Math.max(m.sparkMax, obj.spark);
    }
    if (Number.isFinite(obj.kr)) m.krMax = Math.max(m.krMax, obj.kr);
    if (Number.isFinite(obj.iat)) m.iatSum += obj.iat;
    if (Number.isFinite(obj.cat)) m.catSum += obj.cat;
    if (Number.isFinite(obj.map)) m.mapSum += obj.map;
    if (Number.isFinite(obj.maf)) m.mafSum += obj.maf;

    // Lambda/AFR error: measured - commanded (equivalence ratio domain)
    let measuredEq = null;
    if (Number.isFinite(obj.wbEq)) measuredEq = obj.wbEq;
    else if (Number.isFinite(obj.afr) && obj.afr > 0) measuredEq = 14.7 / obj.afr; // gasoline approx
    if (Number.isFinite(measuredEq) && Number.isFinite(obj.cmdEq)) {
      m.eqErrSum += (measuredEq - obj.cmdEq);
      m.eqCount++;
    }

    // LTFT variance between banks
    if (Number.isFinite(obj.ltft1) && Number.isFinite(obj.ltft2)) {
      m.ltftVarSum += Math.abs(obj.ltft1 - obj.ltft2);
      m.ltftCount++;
    }
  };

  for (const r of rows) {
    const ri = findBin(r.rpm, rpmBins);
    const ai = findBin(r.cyl, airBins);
    if (ri < 0 || ai < 0) continue;
    add(keyOf(ri, ai), r);
  }

  const rpmAirBins = [];
  for (let ri=0; ri<=rpmBins.length; ri++) {
    for (let ai=0; ai<=airBins.length; ai++) {
      const k = keyOf(ri, ai);
      const m = mat.get(k);
      if (!m || m.n < 5) continue; // skip thin bins
      rpmAirBins.push({
        rpmBin: ri, airBin: ai, samples: m.n,
        sparkAvg: +(m.sparkSum / m.n).toFixed(2),
        sparkMax: m.sparkMax,
        krMax: m.krMax,
        iatAvg: +(m.iatSum / m.n).toFixed(1),
        catAvg: +(m.catSum / m.n).toFixed(1),
        mapAvg: +(m.mapSum / m.n).toFixed(1),
        mafAvg: +(m.mafSum / m.n).toFixed(2),
        eqErrAvg: m.eqCount ? +(m.eqErrSum / m.eqCount).toFixed(3) : null,
        ltftVarAvg: m.ltftCount ? +(m.ltftVarSum / m.ltftCount).toFixed(2) : null,
      });
    }
  }

  const detected = {};
  Object.entries(idx).forEach(([k, i]) => detected[k] = i >= 0 ? headers[i] : null);

  return { detected, samples: samples.filter(r => Number.isFinite(r.t) && Number.isFinite(r.mph)), rpmAirBins };
}

// ---------- System prompt ----------
function trainerSystemPrompt() {
  return `
You are Satera Trainer (Gen3 HEMI). Compare BEFORE and AFTER logs using the metrics and extended context provided.
- Distinguish "not achieved in this log" (vehicle didn't reach target mph) vs "not logged" (channel absent).
- Correlate spark/knock with cylinder airmass and temperature (IAT/CAT), and note fueling delivery (cmd vs measured lambda/AFR), injector PW/duty, FRP, trims.
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
 * Returns: {
 *   conversationId, comparison, aiSummary, meta,
 *   logs:{
 *     beforeSampleCount, afterSampleCount
 *   }
 * }
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

      // Read raw text
      const beforeRaw = fs.readFileSync(beforePath, "utf8");
      const afterRaw  = fs.readFileSync(afterPath, "utf8");

      // Headline metrics: reuse AI Review parser (keeps parity)
      const beforeMetrics = parseCSV(beforeRaw);
      const afterMetrics  = parseCSV(afterRaw);
      if (!beforeMetrics || !afterMetrics) {
        return res.status(400).json({ error: "CSV could not be parsed by utils/parseCSV.js" });
      }

      // Build comparison
      const comparison = buildComparisonFromMetrics(beforeMetrics, afterMetrics);

      // Extended context (airflow/airmass/fueling/temps/etc.) + binned summaries
      const extBefore = extractExtended(beforeRaw, 400);
      const extAfter  = extractExtended(afterRaw, 400);

      // Seed conversation with everything needed
      const conversationId = crypto.randomUUID();
      const systemMsg = { role: "system", content: trainerSystemPrompt() };
      const seedUser = {
        role: "user",
        content: JSON.stringify({
          vehicle: meta,
          comparison,
          samples: {
            // keep legacy for any existing UI
            before: extBefore.samples,
            after:  extAfter.samples,
          },
          extended: {
            before: { detected: extBefore.detected, samples: extBefore.samples, rpmAirBins: extBefore.rpmAirBins },
            after:  { detected: extAfter.detected,  samples: extAfter.samples,  rpmAirBins: extAfter.rpmAirBins  },
          }
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

      chatStore.set(conversationId, {
        system: systemMsg,
        context: {
          vehicle: meta,
          comparison,
          samples: { before: extBefore.samples, after: extAfter.samples },
          extended: {
            before: { detected: extBefore.detected, samples: extBefore.samples, rpmAirBins: extBefore.rpmAirBins },
            after:  { detected: extAfter.detected,  samples: extAfter.samples,  rpmAirBins: extAfter.rpmAirBins  },
          }
        },
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
          beforeSampleCount: extBefore.samples.length,
          afterSampleCount:  extAfter.samples.length,
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
