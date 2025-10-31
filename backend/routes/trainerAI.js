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
  limits: { fileSize: 100 * 1024 * 1024 },
});

// ---------- Shared AI Review Parser ----------
const parseCSV = require("../utils/parseCSV");

// ---------- Supabase (optional, graceful no-op if env missing) ----------
let supabase = null;
try {
  const { createClient } = require("@supabase/supabase-js");
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
} catch { /* ignore */ }

// ---------- In-memory chat store ----------
/**
 * Map<conversationId, {
 *   system, context, messages
 * }>
 */
const chatStore = new Map();

// ---------- Helpers ----------
const toNumber = (v) => v == null || v === "" ? null : Number(String(v).replace(",", "."));
function safeUnlink(p) { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {} }
const d = (x, y) => (x == null || y == null) ? null : (y - x);

function toFahrenheit(val, unitHint) {
  if (!Number.isFinite(val)) return val;
  const u = String(unitHint || "").toLowerCase();
  if (u.includes("°c") || u === "c" || u.includes("celsius")) return (val * 9/5) + 32;
  return val; // assume already °F
}
function toKPa(val, unitHint) {
  if (!Number.isFinite(val)) return val;
  const u = String(unitHint || "").toLowerCase();
  if (u.includes("psi")) return val / 0.1450377377;
  return val; // assume already kPa
}

// ---------- Comparison (from parseCSV headline metrics) ----------
function buildComparisonFromMetrics(b, a) {
  const countKREvents = (arr) => Array.isArray(arr) ? arr.filter(v => Number.isFinite(v) && v > 0).length : 0;

  const before = {
    KR: { maxKR: Array.isArray(b.knock) && b.knock.length ? Math.max(...b.knock) : 0, krEvents: countKREvents(b.knock) },
    times: { zeroToSixty: b.zeroTo60 ?? null, fortyToHundred: b.fortyTo100 ?? null, sixtyToOneThirty: b.sixtyTo130 ?? null },
    WOT: { sparkMaxWOT: b.peakTiming ?? null, mapMinWOT: b.map?.min ?? null, mapMaxWOT: b.map?.max ?? null },
    fuel: { stft1: null, stft2: null, ltft1: b.avgFT1 ?? null, ltft2: b.avgFT2 ?? null, varSTFT: null, varLTFT: b.varFT ?? null },
    misfires: [
      b.misfires?.Cyl1 ?? 0, b.misfires?.Cyl2 ?? 0, b.misfires?.Cyl3 ?? 0, b.misfires?.Cyl4 ?? 0,
      b.misfires?.Cyl5 ?? 0, b.misfires?.Cyl6 ?? 0, b.misfires?.Cyl7 ?? 0, b.misfires?.Cyl8 ?? 0,
    ],
  };

  const after = {
    KR: { maxKR: Array.isArray(a.knock) && a.knock.length ? Math.max(...a.knock) : 0, krEvents: countKREvents(a.knock) },
    times: { zeroToSixty: a.zeroTo60 ?? null, fortyToHundred: a.fortyTo100 ?? null, sixtyToOneThirty: a.sixtyTo130 ?? null },
    WOT: { sparkMaxWOT: a.peakTiming ?? null, mapMinWOT: a.map?.min ?? null, mapMaxWOT: a.map?.max ?? null },
    fuel: { stft1: null, stft2: null, ltft1: a.avgFT1 ?? null, ltft2: a.avgFT2 ?? null, varSTFT: null, varLTFT: a.varFT ?? null },
    misfires: [
      a.misfires?.Cyl1 ?? 0, a.misfires?.Cyl2 ?? 0, a.misfires?.Cyl3 ?? 0, a.misfires?.Cyl4 ?? 0,
      a.misfires?.Cyl5 ?? 0, a.misfires?.Cyl6 ?? 0, a.misfires?.Cyl7 ?? 0, a.misfires?.Cyl8 ?? 0,
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

// ---------- Extended extractor ----------
function locateHeaderIndex(lines) {
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
  const units = (lines[headerRowIndex + 1] || "").split(",").map(u => u.trim());

  let dataStart = headerRowIndex + 2;
  while (dataStart < lines.length && !lines[dataStart].includes(",")) dataStart++;
  const dataRows = lines.slice(dataStart).filter(r => r && r.includes(","));
  return { headers, units, dataRows };
}
function buildAliasIndex(headers) {
  const norm = s => String(s||'').toLowerCase().replace(/\s+/g,' ').trim();
  const H = headers.map(h => norm(h));
  const find = (aliases) => {
    const A = aliases.map(norm);
    for (let i=0;i<H.length;i++) if (A.includes(H[i])) return i;
    for (let i=0;i<H.length;i++) for (const a of A) if (a && H[i].includes(a)) return i;
    return -1;
  };
  return {
    t:      find(['offset','time','elapsed time','time (s)','timestamp']),
    rpm:    find(['engine rpm (sae)','engine rpm','rpm']),
    mph:    find(['vehicle speed (sae)','vehicle speed','speed']),
    tb:     find(['throttle position (sae)','throttle position (%)','throttle body angle','throttle angle','tps']),
    pedal:  find(['accelerator position d (sae)','accelerator pedal position (%)','accel pedal pos (%)','accelerator pedal position']),
    map:    find(['manifold absolute pressure (sae)','intake manifold absolute pressure (sae)','manifold absolute pressure','map (kpa)','map']),
    baro:   find(['barometric pressure (sae)','barometric pressure','baro']),
    iat:    find(['intake air temperature (sae)','intake air temperature','intake air temp (sae)','intake air temp','iat (sae)','iat']),
    cat:    find(['charge air temp','charge air temperature','manifold air temperature','intake manifold temperature','imt','cat','aircharge temperature']),
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
    wbEq:   find([
      'wideband lambda','lambda','wb lambda','measured equivalence ratio',
      'wb eq ratio 1 (sae)','wb eq ratio 1 (sae) (2)','wb eq ratio 5 (sae) (2)','wideband eq ratio','equivalence ratio (wb)'
    ]),
    afr:    find(['wideband afr','afr','air fuel ratio','wideband afr 1 (sae)','wideband afr 1 (sae) (2)','wideband afr 5 (sae) (2)']),
    stft1:  find(['short term fuel trim bank 1','stft bank 1','stft1']),
    stft2:  find(['short term fuel trim bank 2','stft bank 2','stft2']),
    ltft1:  find(['long term fuel trim bank 1','ltft bank 1','ltft1']),
    ltft2:  find(['long term fuel trim bank 2','ltft bank 2','ltft2']),
  };
}
function extractExtended(raw, step = 400) {
  const parsed = parseHeadersAndRows(raw);
  if (!parsed) return { detected:{}, samples:[], rpmAirBins:[] };

  const { headers, units, dataRows } = parsed;
  const idx = buildAliasIndex(headers);
  const pick = (arr, i) => (i>=0 && i<arr.length ? arr[i] : null);
  const numAt = (arr, i) => toNumber(pick(arr, i));
  const tempAtF = (arr, i) => toFahrenheit(numAt(arr, i), pick(units, i));
  const mapAtKPa = (arr, i) => toKPa(numAt(arr, i), pick(units, i));

  // Samples (downsampled)
  const samples = [];
  for (let i=0;i<dataRows.length;i+=step) {
    const r = dataRows[i].split(",");
    const mapK = mapAtKPa(r, idx.map), baroK = mapAtKPa(r, idx.baro);
    samples.push({
      t: numAt(r, idx.t),
      rpm: numAt(r, idx.rpm),
      mph: numAt(r, idx.mph),
      tb: numAt(r, idx.tb),
      pedal: numAt(r, idx.pedal),
      map: mapK,
      baro: baroK,
      boostPsi: (Number.isFinite(mapK) && Number.isFinite(baroK)) ? (mapK - baroK) * 0.1450377 : null,
      iat: tempAtF(r, idx.iat),
      cat: tempAtF(r, idx.cat),
      maf: numAt(r, idx.maf),
      mafPer: numAt(r, idx.mafPer),
      cylAir: numAt(r, idx.cylAir),
      load: numAt(r, idx.load),
      spark: numAt(r, idx.spark),
      kr: numAt(r, idx.kr),
      injPw: numAt(r, idx.injPw),
      injDuty: numAt(r, idx.injDuty),
      frp: numAt(r, idx.frp),
      cmdEq: numAt(r, idx.cmdEq),
      wbEq: numAt(r, idx.wbEq),
      afr: numAt(r, idx.afr),
      stft1: numAt(r, idx.stft1),
      stft2: numAt(r, idx.stft2),
      ltft1: numAt(r, idx.ltft1),
      ltft2: numAt(r, idx.ltft2),
    });
  }
  if (dataRows.length) {
    const r = dataRows[dataRows.length - 1].split(",");
    const mapK = mapAtKPa(r, idx.map), baroK = mapAtKPa(r, idx.baro);
    const last = {
      t: numAt(r, idx.t),
      rpm: numAt(r, idx.rpm),
      mph: numAt(r, idx.mph),
      tb: numAt(r, idx.tb),
      pedal: numAt(r, idx.pedal),
      map: mapK,
      baro: baroK,
      boostPsi: (Number.isFinite(mapK) && Number.isFinite(baroK)) ? (mapK - baroK) * 0.1450377 : null,
      iat: tempAtF(r, idx.iat),
      cat: tempAtF(r, idx.cat),
      maf: numAt(r, idx.maf),
      mafPer: numAt(r, idx.mafPer),
      cylAir: numAt(r, idx.cylAir),
      load: numAt(r, idx.load),
      spark: numAt(r, idx.spark),
      kr: numAt(r, idx.kr),
      injPw: numAt(r, idx.injPw),
      injDuty: numAt(r, idx.injDuty),
      frp: numAt(r, idx.frp),
      cmdEq: numAt(r, idx.cmdEq),
      wbEq: numAt(r, idx.wbEq),
      afr: numAt(r, idx.afr),
      stft1: numAt(r, idx.stft1),
      stft2: numAt(r, idx.stft2),
      ltft1: numAt(r, idx.ltft1),
      ltft2: numAt(r, idx.ltft2),
    };
    if (!samples.length || samples[samples.length - 1].t !== last.t) samples.push(last);
  }

  // RPM × Cylinder Airmass bins
  const rows = dataRows.map(line => {
    const a = line.split(",");
    return {
      rpm: numAt(a, idx.rpm),
      cyl: numAt(a, idx.cylAir),
      spark: numAt(a, idx.spark),
      kr: numAt(a, idx.kr),
      iat: tempAtF(a, idx.iat),
      cat: tempAtF(a, idx.cat),
      map: mapAtKPa(a, idx.map),
      baro: mapAtKPa(a, idx.baro),
      maf: numAt(a, idx.maf),
      cmdEq: numAt(a, idx.cmdEq),
      wbEq: numAt(a, idx.wbEq),
      afr: numAt(a, idx.afr),
      ltft1: numAt(a, idx.ltft1),
      ltft2: numAt(a, idx.ltft2),
    };
  }).filter(r => Number.isFinite(r.rpm));

  const rpmBins = [800,1200,1600,2000,2400,2800,3200,3600,4000,4400,4800,5200,5600,6000,6400,6800];
  const airBins = [0.20,0.25,0.30,0.35,0.40,0.45,0.50,0.55,0.60,0.65,0.70,0.75];

  const findBin = (v, arr) => {
    if (!Number.isFinite(v)) return -1;
    for (let i=0;i<arr.length;i++) if (v < arr[i]) return i;
    return arr.length;
  };

  const mat = new Map();
  const keyOf = (ri, ai) => `${ri}:${ai}`;
  const add = (k, obj) => {
    if (!mat.has(k)) mat.set(k, {
      n:0, sparkSum:0, sparkMax:null, krMax:0,
      iatSum:0, catSum:0, mapSum:0, mafSum:0,
      eqErrSum:0, eqCount:0, ltftVarSum:0, ltftCount:0, boostSum:0
    });
    const m = mat.get(k);
    m.n++;
    if (Number.isFinite(obj.spark)) {
      m.sparkSum += obj.spark;
      m.sparkMax = m.sparkMax == null ? obj.spark : Math.max(m.sparkMax, obj.spark);
    }
    if (Number.isFinite(obj.kr)) m.krMax = Math.max(m.krMax, obj.kr);
    if (Number.isFinite(obj.iat)) m.iatSum += obj.iat;
    if (Number.isFinite(obj.cat)) m.catSum += obj.cat;
    if (Number.isFinite(obj.map) && Number.isFinite(obj.baro)) {
      m.mapSum += obj.map;
      const boostPsi = (obj.map - obj.baro) * 0.1450377;
      if (Number.isFinite(boostPsi)) m.boostSum += boostPsi;
    }
    if (Number.isFinite(obj.maf)) m.mafSum += obj.maf;

    let measuredEq = null;
    if (Number.isFinite(obj.wbEq)) measuredEq = obj.wbEq;
    else if (Number.isFinite(obj.afr) && obj.afr > 0) measuredEq = 14.7 / obj.afr;
    if (Number.isFinite(measuredEq) && Number.isFinite(obj.cmdEq)) {
      m.eqErrSum += (measuredEq - obj.cmdEq);
      m.eqCount++;
    }
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
      if (!m || m.n < 5) continue;
      rpmAirBins.push({
        rpmBin: ri, airBin: ai, samples: m.n,
        sparkAvg: +(m.sparkSum / m.n).toFixed(2),
        sparkMax: m.sparkMax,
        krMax: m.krMax,
        iatAvg: +(m.iatSum / m.n).toFixed(1),
        catAvg: +(m.catSum / m.n).toFixed(1),
        mapAvg: +(m.mapSum / m.n).toFixed(1),
        boostAvgPsi: +((m.boostSum / m.n) || 0).toFixed(2),
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

// ---------- Knowledge pack (persistent memory) ----------
async function fetchKnowledgePack(meta) {
  if (!supabase) return { notes: [], history: [] };

  const scopes = [];
  if (meta?.vin) scopes.push(`vin:${meta.vin}`);
  if (meta?.model || meta?.engine) scopes.push(`model:${meta?.model || ''}|engine:${meta?.engine || ''}`);
  scopes.push("global");

  const notes = [];
  for (const s of scopes) {
    const { data, error } = await supabase
      .from("trainer_memory")
      .select("note, created_at")
      .eq("scope", s)
      .order("created_at", { ascending: false });
    if (!error && Array.isArray(data)) notes.push(...data.map(r => r.note));
  }

  // pull last 10 trainer_entries for same VIN (or same model/engine if VIN missing)
  let history = [];
  if (meta?.vin) {
    const { data } = await supabase
      .from("trainer_entries")
      .select("vehicle, aiSummary, created_at")
      .contains("vehicle", { vin: meta.vin })
      .order("created_at", { ascending: false })
      .limit(10);
    if (Array.isArray(data)) history = data;
  } else if (meta?.model || meta?.engine) {
    const { data } = await supabase
      .from("trainer_entries")
      .select("vehicle, aiSummary, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (Array.isArray(data)) {
      history = data.filter(e =>
        String(e?.vehicle?.model || "").toLowerCase() === String(meta?.model || "").toLowerCase() &&
        String(e?.vehicle?.engine || "").toLowerCase() === String(meta?.engine || "").toLowerCase()
      ).slice(0, 10);
    }
  }

  return { notes, history };
}

function trainerSystemPrompt() {
  return `
You are Satera Trainer (Gen3 HEMI). Use the Knowledge Pack, headline comparison, and extended context.
- Distinguish "not achieved in this log" vs "not logged".
- Correlate spark/knock with cyl airmass & IAT/CAT, include fueling (cmd vs measured lambda/AFR), injector PW/duty, FRP, trims.
- Use persistent notes and prior entries as remembered baselines or shop policies. Do not request tune tables.
`.trim();
}

// ============================================================================
// Routes
// ============================================================================

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
      let meta = {};
      try { meta = req.body?.meta ? JSON.parse(req.body.meta) : {}; } catch { meta = {}; }

      beforePath = req.files?.beforeLog?.[0]?.path || null;
      afterPath  = req.files?.afterLog?.[0]?.path  || null;
      if (!beforePath || !afterPath) return res.status(400).json({ error: "Please upload both beforeLog and afterLog CSV files." });

      const beforeRaw = fs.readFileSync(beforePath, "utf8");
      const afterRaw  = fs.readFileSync(afterPath, "utf8");

      const beforeMetrics = parseCSV(beforeRaw);
      const afterMetrics  = parseCSV(afterRaw);
      if (!beforeMetrics || !afterMetrics) return res.status(400).json({ error: "CSV could not be parsed by utils/parseCSV.js" });

      const comparison = buildComparisonFromMetrics(beforeMetrics, afterMetrics);

      const extBefore = extractExtended(beforeRaw, 400);
      const extAfter  = extractExtended(afterRaw, 400);

      const knowledgePack = await fetchKnowledgePack(meta);

      const conversationId = crypto.randomUUID();
      const systemMsg = { role: "system", content: trainerSystemPrompt() };
      const seedUser = {
        role: "user",
        content: JSON.stringify({
          vehicle: meta,
          knowledgePack,
          comparison,
          samples: { before: extBefore.samples, after: extAfter.samples },
          extended: {
            before: { detected: extBefore.detected, samples: extBefore.samples, rpmAirBins: extBefore.rpmAirBins },
            after:  { detected: extAfter.detected,  samples: extAfter.samples,  rpmAirBins: extAfter.rpmAirBins },
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
          knowledgePack,
          comparison,
          samples: { before: extBefore.samples, after: extAfter.samples },
          extended: {
            before: { detected: extBefore.detected, samples: extBefore.samples, rpmAirBins: extBefore.rpmAirBins },
            after:  { detected: extAfter.detected,  samples: extAfter.samples,  rpmAirBins: extAfter.rpmAirBins },
          }
        },
        messages: [seedUser, { role: "assistant", content: aiSummary }],
      });

      // Optional: store a shell entry for continuity
      try {
        if (supabase) {
          await supabase.from("trainer_entries").insert([{
            vehicle: meta,
            sparkChanges: [],
            aiSummary,
            created_at: new Date().toISOString(),
          }]);
        }
      } catch (e) { console.warn("Supabase insert skipped:", e.message); }

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

// Chat with same conversation (uses knowledge from seed)
router.post("/trainer-chat", express.json(), async (req, res) => {
  try {
    const { conversationId, message } = req.body || {};
    if (!conversationId || !message) return res.status(400).json({ error: "conversationId and message are required." });

    const convo = chatStore.get(conversationId);
    if (!convo) return res.status(404).json({ error: "Conversation not found. Start with /trainer-ai." });

    const contextReminder = {
      role: "system",
      content: `Context: ${JSON.stringify(convo.context).slice(0, 12000)}`
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

// ---------- Memory management ----------
router.post("/trainer-remember", express.json(), async (req, res) => {
  try {
    if (!supabase) return res.status(400).json({ error: "Supabase not configured." });
    const { scope, note } = req.body || {};
    if (!scope || !note) return res.status(400).json({ error: "scope and note are required." });
    const { error } = await supabase.from("trainer_memory").insert([{ scope, note }]);
    if (error) return res.status(500).json({ error: "Insert failed." });
    res.json({ success: true });
  } catch (e) {
    console.error("trainer-remember error:", e);
    res.status(500).json({ error: "Remember failed." });
  }
});

router.post("/trainer-forget", express.json(), async (req, res) => {
  try {
    if (!supabase) return res.status(400).json({ error: "Supabase not configured." });
    const { scope, contains } = req.body || {};
    if (!scope) return res.status(400).json({ error: "scope is required." });
    if (contains) {
      const { data } = await supabase.from("trainer_memory").select("id,note").eq("scope", scope);
      const ids = (data || []).filter(r => r.note.includes(contains)).map(r => r.id);
      if (!ids.length) return res.json({ success: true, deleted: 0 });
      const { error } = await supabase.from("trainer_memory").delete().in("id", ids);
      if (error) return res.status(500).json({ error: "Delete failed." });
      return res.json({ success: true, deleted: ids.length });
    } else {
      const { error } = await supabase.from("trainer_memory").delete().eq("scope", scope);
      if (error) return res.status(500).json({ error: "Delete failed." });
      res.json({ success: true });
    }
  } catch (e) {
    console.error("trainer-forget error:", e);
    res.status(500).json({ error: "Forget failed." });
  }
});

// ---------- Feedback + Fine-tune (unchanged) ----------
router.use(express.json());

router.post("/update-feedback", async (req, res) => {
  try {
    const { id, feedback } = req.body || {};
    if (!id || !feedback) return res.status(400).json({ error: "Missing id or feedback" });

    if (!supabase) return res.status(400).json({ error: "Supabase not configured." });
    const { error } = await supabase.from("trainer_entries").update({ feedback }).eq("id", id);
    if (error) return res.status(500).json({ error: "Update failed" });
    res.json({ success: true });
  } catch (e) {
    console.error("update-feedback error:", e.message);
    res.status(500).json({ error: "Update failed" });
  }
});

router.post("/fine-tune-now", async (req, res) => {
  try {
    if (!supabase) return res.status(400).json({ error: "Supabase not configured." });
    const { data: entries, error: e1 } = await supabase
      .from("trainer_entries")
      .select("*")
      .order("created_at", { ascending: true });

    if (e1) throw new Error("Failed to fetch trainer entries");
    const fineTuneData = (entries || [])
      .filter((e) => e?.aiSummary && e?.vehicle)
      .map((entry) => {
        const context =
          `Vehicle Info:\n${JSON.stringify(entry.vehicle, null, 2)}\n\n` +
          `Spark Table Changes:\n${JSON.stringify(entry.sparkChanges || [], null, 2)}`;
        const feedbackNote = entry.feedback ? `\n\nTrainer Feedback:\n${entry.feedback}` : "";
        return { prompt: context, completion: (entry.aiSummary || "") + feedbackNote };
      });

    if (!fineTuneData.length) return res.status(400).json({ error: "No valid entries found to fine-tune on." });

    const tempFilePath = path.join(__dirname, "fine-tune-upload.jsonl");
    fs.writeFileSync(tempFilePath, fineTuneData.map((e) => JSON.stringify(e)).join("\n"));

    const file = await openai.files.create({ file: fs.createReadStream(tempFilePath), purpose: "fine-tune" });
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
