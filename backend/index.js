// backend/index.js
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors'); // kept import, not using the default middleware
const multer = require('multer');
const { OpenAI } = require('openai');
// backend/index.js  (only the new lines shown)
const trainerChat = require("./routes/trainerChat");
// after other requires
const trainerTrainer = require("./routes/trainerTrainer");

// Debug
const dumpRole = (k) => {
  try {
    const [h, p] = String(k || '').split('.');
    const payload = JSON.parse(Buffer.from((p || ''), 'base64url').toString('utf8'));
    return { len: (k || '').length, role: payload?.role };
  } catch { return { len: (k || '').length, role: 'unknown' }; }
};
console.log('SR check:', dumpRole(process.env.SUPABASE_SERVICE_ROLE_KEY));

// Route modules
const runDetail = require('./routes/runDetail');
const submitRunRoutes = require('./routes/submitRun');
const leaderboardRoutes = require('./routes/leaderboard');
const processLog = require('./routes/processLog');
const trainerAI = require('./routes/trainerAI');
const overlayRoutes = require('./routes/overlay');
const { buildMessages } = require('./prompt');

const app = express();
const PORT = Number(process.env.PORT || 5000);

// uploads dir
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({ dest: uploadsDir });

/* ------------------------
   CORS (strict) + Preflight
------------------------- */
// IMPORTANT: Put this BEFORE any routes to ensure headers on all responses
const ALLOWED_ORIGINS = [
  'https://app.sateratuning.com', // production frontend
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];



app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // If you use cookies in the future:
  // res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

/* ------------------------
   Body limits (avoid 502 on large payloads)
------------------------- */
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// feedback route first (as you had it)
app.use(require('./routes/feedback'));

// health
app.get(['/health', '/api/health'], (req, res) => {
  res.status(200).json({ ok: true, service: 'Satera API', time: new Date().toISOString() });
});

// mount other modules
app.use('/', runDetail);
app.use('/', leaderboardRoutes);
app.use('/', submitRunRoutes);
app.use('/', processLog);
app.use('/', trainerAI);
app.use('/', overlayRoutes);
app.use(trainerChat);
// app.use(trainerUploadDraft); // if used
// after app initialization & other routers
app.use("/api", trainerTrainer);

// OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ------------------------
   CSV PARSER (inline simple)
------------------------- */
function analyzeCsvContent(content) {
  const lines = content.split(/\r?\n/).map(l => l.trim());
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

/* ------------------------
   CHECKLIST BUILDER
------------------------- */
function formatChecklist(parsed, headers) {
  const summary = [];

  const safeMax = (arr) => arr.length ? Math.max(...arr) : undefined;
  const safeMin = (arr) => arr.length ? Math.min(...arr) : undefined;
  const getColumn = (name) => parsed.map(r => r[name]).filter(Number.isFinite);
  const hasCol = (name) => headers.includes(name);

  // Knock
  const knockCol = getColumn('Total Knock Retard').map(v => Math.abs(v));
  const peakKnock = safeMax(knockCol);
  if (peakKnock !== undefined) {
    summary.push(peakKnock > 0 ? `⚠️ Knock detected: up to ${peakKnock.toFixed(1)}°` : '✅ No knock detected.');
  } else {
    summary.push('ℹ️ Knock column not found.');
  }

  // WOT group
  const accelName = 'Accelerator Position D (SAE)'; // pedal
  const throttleName = 'Throttle Position (SAE)';    // TPS (blade)
  const timingName = 'Timing Advance (SAE)';
  const rpmName = 'Engine RPM (SAE)';
  const mapName = 'Intake Manifold Absolute Pressure (SAE)';

  let wotRows = [];
  if (hasCol(accelName)) {
    // ✅ NEW: require BOTH Pedal and TPS > 86% (if TPS column exists)
    wotRows = parsed.filter(r => {
      const pedalOK = Number.isFinite(r[accelName]) && r[accelName] > 86;
      const tpsOK = !hasCol(throttleName) || (Number.isFinite(r[throttleName]) && r[throttleName] > 86);
      return pedalOK && tpsOK;
    });
  }

  if (wotRows.length) {
    const peakTimingRow = wotRows.reduce((best, r) => {
      const c = r[timingName] ?? -Infinity;
      const b = best[timingName] ?? -Infinity;
      return c > b ? r : best;
    }, wotRows[0]);

    const peakTiming = peakTimingRow[timingName];
    const rpmAtPeak = peakTimingRow[rpmName];

    if (Number.isFinite(peakTiming) && Number.isFinite(rpmAtPeak)) {
      summary.push(`📈 Peak timing (Pedal & TPS ≥ 86%): ${peakTiming.toFixed(1)}° @ ${rpmAtPeak.toFixed(0)} RPM`);
    } else {
      summary.push('ℹ️ Could not determine peak timing @ RPM under true WOT (pedal & TPS).');
    }

    /* ------------------------
       Boost (PSI) metrics — computed within the same true-WOT window
    ------------------------- */
    const PSI_PER_KPA = 0.1450377377;
    const baroCandidates = [
      'Barometric Pressure (SAE)',
      'Baro Pressure (SAE)',
      'Ambient Pressure (SAE)'
    ];

    // Pick the first BARO column that exists; default to sea level if none
    const baroName = baroCandidates.find(hasCol);
    const defaultBaroKpa = 101.325;

    // Helper
    const computeBoostPsi = (mapKpa, baroKpa) => {
      const boost = (Number(mapKpa) - Number(baroKpa)) * PSI_PER_KPA;
      if (!Number.isFinite(boost)) return 0;
      return Math.max(0, Number(boost.toFixed(2))); // clamp vacuum to 0 for customer display
    };

    // Build arrays for WOT rows
    const wotBoostPsi = [];
    const wotRpm = [];

    for (const r of wotRows) {
      const mapKpa = r[mapName];
      const baroKpa = baroName ? r[baroName] : defaultBaroKpa;
      if (!Number.isFinite(mapKpa)) continue;
      const boostPsi = computeBoostPsi(mapKpa, Number.isFinite(baroKpa) ? baroKpa : defaultBaroKpa);
      wotBoostPsi.push(boostPsi);
      wotRpm.push(Number.isFinite(r[rpmName]) ? r[rpmName] : NaN);
    }

    if (wotBoostPsi.length) {
      // Peak boost + RPM at that point
      let peakBoostPsi = -Infinity;
      let peakIdx = -1;
      for (let i = 0; i < wotBoostPsi.length; i++) {
        if (wotBoostPsi[i] > peakBoostPsi) {
          peakBoostPsi = wotBoostPsi[i];
          peakIdx = i;
        }
      }
      const peakBoostRpm = Number.isFinite(wotRpm[peakIdx]) ? Math.round(wotRpm[peakIdx]) : null;

      // Average boost during true WOT
      const avg = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
      const avgBoostPsiWot = Number(avg(wotBoostPsi).toFixed(2));

      // Boost at highest RPM within true WOT
      let highestRpm = -Infinity;
      let highestRpmIdx = -1;
      for (let i = 0; i < wotRpm.length; i++) {
        if (Number.isFinite(wotRpm[i]) && wotRpm[i] > highestRpm) {
          highestRpm = wotRpm[i];
          highestRpmIdx = i;
        }
      }
      const boostAtHighestRpm = highestRpmIdx !== -1 ? Number(wotBoostPsi[highestRpmIdx].toFixed(2)) : 0;
      const highestRpmRounded = Number.isFinite(highestRpm) && highestRpm !== -Infinity ? Math.round(highestRpm) : null;

      // Customer-facing lines
      summary.push(`🌀 Peak Boost (Pedal & TPS ≥ 86%): ${peakBoostPsi.toFixed(2)} psi${peakBoostRpm ? ` @ ${peakBoostRpm} RPM` : ''}`);
      summary.push(`📊 Average Boost (Pedal & TPS ≥ 86%): ${avgBoostPsiWot.toFixed(2)} psi`);
      summary.push(`🎯 Boost @ Highest RPM (Pedal & TPS ≥ 86%)${highestRpmRounded ? ` (${highestRpmRounded} RPM)` : ''}: ${boostAtHighestRpm.toFixed(2)} psi`);
    } else {
      summary.push('ℹ️ Boost (PSI) could not be computed in true WOT window.');
    }
    /* ---------------------- END ---------------------- */

  } else {
    summary.push('ℹ️ No true WOT conditions found (pedal & TPS).');
  }

  // Knock sensor volts
  ['Knock Sensor 1', 'Knock Sensor 2'].forEach(sensor => {
    const volts = getColumn(sensor);
    if (!volts.length) {
      summary.push(`ℹ️ ${sensor} not found.`);
      return;
    }
    const peak = safeMax(volts);
    if (peak !== undefined) {
      summary.push(
        peak > 3.0
          ? `⚠️ ${sensor} exceeded 3.0V threshold (Peak: ${peak.toFixed(2)}V)`
          : `✅ ${sensor} within safe range (Peak: ${peak.toFixed(2)}V)`
      );
    }
  });

  // Fuel trims variance
  const lt1 = getColumn('Long Term Fuel Trim Bank 1 (SAE)');
  const lt2 = getColumn('Long Term Fuel Trim Bank 2 (SAE)');
  if (lt1.length && lt2.length) {
    const variance = lt1
      .map((v, i) => (Number.isFinite(v) && Number.isFinite(lt2[i])) ? Math.abs(v - lt2[i]) : undefined)
      .filter(Number.isFinite);
    const tooHigh = variance.some(v => v > 10);
    summary.push(tooHigh ? '⚠️ Fuel trim variance > 10% between banks' : '✅ Fuel trim variance within 10%');
  } else {
    summary.push('ℹ️ One or both LTFT columns missing; variance check skipped.');
  }

  // Avg correction per bank
  const st1 = getColumn('Short Term Fuel Trim Bank 1 (SAE)');
  const st2 = getColumn('Short Term Fuel Trim Bank 2 (SAE)');
  const avg = (arr) => (arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : undefined);

  if (st1.length && lt1.length) {
    const combo1 = st1.map((v, i) => (Number.isFinite(v) ? v : 0) + (Number.isFinite(lt1[i]) ? lt1[i] : 0)).filter(Number.isFinite);
    const a1 = avg(combo1);
    if (a1 !== undefined) summary.push(`📊 Avg fuel correction (Bank 1): ${a1.toFixed(1)}%`);
  }
  if (st2.length && lt2.length) {
    const combo2 = st2.map((v, i) => (Number.isFinite(v) ? v : 0) + (Number.isFinite(lt2[i]) ? lt2[i] : 0)).filter(Number.isFinite);
    const a2 = avg(combo2);
    if (a2 !== undefined) summary.push(`📊 Avg fuel correction (Bank 2): ${a2.toFixed(1)}%`);
  }

  // Oil pressure (RPM > 500)
  const rpmCol = getColumn(rpmName);
  const oilCol = getColumn('Engine Oil Pressure');
  if (rpmCol.length && oilCol.length) {
    const oilRows = parsed.filter(r => Number.isFinite(r[rpmName]) && r[rpmName] > 500);
    const oilLow = oilRows.some(r => Number.isFinite(r['Engine Oil Pressure']) && r['Engine Oil Pressure'] < 20);
    summary.push(oilLow ? '⚠️ Oil pressure dropped below 20 psi.' : '✅ Oil pressure within safe range.');
  }

  // ECT
  const ect = getColumn('Engine Coolant Temp (SAE)');
  if (ect.length) {
    summary.push(ect.some(v => v > 230) ? '⚠️ Coolant temp exceeded 230°F.' : '✅ Coolant temp within safe limits.');
  }

  // Misfires per cylinder
  const misfireReport = [];
  const firstRow = parsed[0] || {};
  Object.keys(firstRow).forEach(key => {
    if (key.includes('Misfire Current Cylinder')) {
      const cyl = key.split('#')[1] || '?';
      const values = getColumn(key);
      if (values.length) {
        let count = 0;
        for (let i = 1; i < values.length; i++) {
          const diff = values[i] - values[i - 1];
          if (Number.isFinite(diff) && diff > 0 && diff < 1000) count += diff;
        }
        if (count > 0) misfireReport.push(`- Cylinder ${cyl}: ${count.toFixed(2)} misfires`);
      }
    }
  });
  if (misfireReport.length) {
    summary.push(`🚨 Misfires detected:\n${misfireReport.join('\n')}`);
  } else {
    summary.push('✅ No misfires detected.');
  }

  // Timers (unchanged: still use pedal WOT; tell me if you want TPS enforced here too)
  const speed = getColumn('Vehicle Speed (SAE)');
  const time = getColumn('Offset');

  const findAllIntervals = (start, end) => {
    const times = [];
    let startTime = null;
    for (let i = 0; i < speed.length; i++) {
      const s = speed[i], t = time[i], accel = parsed[i][accelName];
      if (!Number.isFinite(s) || !Number.isFinite(t) || !Number.isFinite(accel)) continue;
      if (accel < 86) continue; // require WOT (pedal only). Say the word and I'll gate on TPS here too.
      if (startTime === null && s >= start && s < end) startTime = t;
      if (startTime !== null && s >= end) {
        times.push((t - startTime).toFixed(2));
        startTime = null;
      }
    }
    return times;
  };

  const findAllZeroToSixty = () => {
    const times = [];
    let foundStop = false;
    let startTime = null;
    for (let i = 1; i < speed.length; i++) {
      const s = speed[i], t = time[i], accel = parsed[i][accelName];
      if (!Number.isFinite(s) || !Number.isFinite(t) || !Number.isFinite(accel)) continue;
      if (accel < 86) continue; // pedal only
      if (!foundStop && s < 1.5) foundStop = true;
      if (foundStop && startTime === null && s > 1.5) startTime = t;
      if (startTime !== null && s >= 60) {
        times.push((t - startTime).toFixed(2));
        startTime = null;
        foundStop = false;
      }
    }
    return times;
  };

  const best = (arr) => (arr.length ? Math.min(...arr.map(Number)) : null);
  const zeroToSixty = best(findAllZeroToSixty());
  const fortyToHundred = best(findAllIntervals(40, 100));
  const sixtyToOneThirty = best(findAllIntervals(60, 130));

  if (zeroToSixty) summary.push(`🚦 Best 0–60 mph: ${zeroToSixty.toFixed(2)}s`);
  if (fortyToHundred) summary.push(`🚀 Best 40–100 mph: ${fortyToHundred.toFixed(2)}s`);
  if (sixtyToOneThirty) summary.push(`🚀 Best 60–130 mph: ${sixtyToOneThirty.toFixed(2)}s`);

  return summary.join('\n');
}

/* ------------------------
   AI REVIEW ROUTE
------------------------- */
app.post(['/ai-review', '/api/ai-review'], upload.single('log'), async (req, res) => {
  let filePath;
  try {
    if (!req.file) return res.status(400).send('No CSV file uploaded.');
    filePath = req.file.path;
    const content = fs.readFileSync(filePath, 'utf8');
    const { headers, parsed } = analyzeCsvContent(content);

    const checklist = formatChecklist(parsed, headers);

    // Reduced data for AI
    const reduced = parsed.filter((_, i) => i % 400 === 0).map(r => ({
      rpm: r['Engine RPM (SAE)'],
      airmass: r['Cylinder Airmass'],
      knock: r['Total Knock Retard'],
    }));

    const observations = checklist + '\n' + JSON.stringify(reduced.slice(0, 200), null, 2);
    const messages = buildMessages({ meta: {}, observations });

    let finalReview = '';
    try {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.3,
        messages
      });
      finalReview = completion.choices?.[0]?.message?.content?.trim() || '';
    } catch (e) {
      finalReview = 'Model unavailable. Showing checklist only.';
    }

    res.type('text/plain').send(checklist + '\n===SPLIT===\n' + finalReview);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to analyze log.');
  } finally {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

// 404 guard
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

/* ------------------------
   Global error handler (LAST)
------------------------- */
app.use((err, req, res, next) => {
  console.error('GLOBAL ERROR:', err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
