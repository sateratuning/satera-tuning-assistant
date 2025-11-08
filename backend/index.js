// backend/index.js
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors'); // kept import, not using the default middleware
const multer = require('multer');
const { OpenAI } = require('openai');

// Route modules (yours)
const trainerChat = require("./routes/trainerChat");
const trainerTrainer = require("./routes/trainerTrainer");
const runDetail = require('./routes/runDetail');
const submitRunRoutes = require('./routes/submitRun');
const leaderboardRoutes = require('./routes/leaderboard');
const processLog = require('./routes/processLog');
const trainerAI = require('./routes/trainerAI');
const overlayRoutes = require('./routes/overlay');
const feedbackRoutes = require('./routes/feedback');
const { buildMessages } = require('./prompt');

// ---------- Debug ----------
const dumpRole = (k) => {
  try {
    const [h, p] = String(k || '').split('.');
    const payload = JSON.parse(Buffer.from((p || ''), 'base64url').toString('utf8'));
    return { len: (k || '').length, role: payload?.role };
  } catch { return { len: (k || '').length, role: 'unknown' }; }
};
console.log('SR check:', dumpRole(process.env.SUPABASE_SERVICE_ROLE_KEY));

const app = express();
const PORT = Number(process.env.PORT || 5000);

// ---------- Uploads ----------
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({ dest: uploadsDir });

// ---------- Strict CORS (before routes) ----------
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
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ---------- Body limits ----------
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// ---------- Health ----------
app.get(['/health', '/api/health'], (req, res) => {
  res.status(200).json({ ok: true, service: 'Satera API', time: new Date().toISOString() });
});

// ---------- Feedback first ----------
app.use(feedbackRoutes);

// ---------- Mount your existing modules ----------
app.use('/', runDetail);
app.use('/', leaderboardRoutes);
app.use('/', submitRunRoutes);
app.use('/', processLog);
app.use('/', trainerAI);
app.use('/', overlayRoutes);
app.use(trainerChat);
app.use("/api", trainerTrainer);

// ---------- OpenAI ----------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// =====================================================
// Gear Catalog (backend source of truth)
// =====================================================
const TRANS_RATIOS = {
  "8HP70": { "1st": 4.71, "2nd": 3.14, "3rd": 2.10, "4th": 1.67, "5th": 1.29, "6th": 1.00, "7th": 0.84, "8th": 0.67 },
  "8HP90": { "1st": 4.71, "2nd": 3.14, "3rd": 2.10, "4th": 1.67, "5th": 1.29, "6th": 1.00, "7th": 0.84, "8th": 0.67 },
  "TR6060": { "1st": 2.97, "2nd": 2.07, "3rd": 1.43, "4th": 1.00, "5th": 0.84, "6th": 0.57 },
  "NAG1/WA580": { "1st": 3.59, "2nd": 2.19, "3rd": 1.41, "4th": 1.00, "5th": 0.83 },
};

// GET /gear-catalog → full table
app.get('/gear-catalog', (req, res) => {
  res.json(TRANS_RATIOS);
});

// Alias with optional query: /ratios or /ratios?trans=8HP70
app.get('/ratios', (req, res) => {
  const trans = String(req.query.trans || '').trim();
  if (!trans) return res.json({ ok: true, transmissions: Object.keys(TRANS_RATIOS) });

  const data = TRANS_RATIOS[trans];
  if (!data) return res.status(404).json({ ok: false, error: 'Unknown transmission' });

  const entries = Object.entries(data).sort((a,b)=> {
    const na = parseInt(a[0], 10), nb = parseInt(b[0], 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a[0].localeCompare(b[0]);
  });

  res.json({
    ok: true,
    transmission: trans,
    gears: entries.map(([label, ratio]) => ({ label, ratio }))
  });
});

// =====================================================
// CSV Parsing + Helpers
// =====================================================
function analyzeCsvContent(content) {
  const lines = content.split(/\r?\n/).map(l => l.trim());
  if (!lines.length) throw new Error('CSV file empty');

  // Find the header row containing "Offset"
  const headerRowIndex = lines.findIndex(r => /(^|,)\s*offset\s*(,|$)/i.test(r));
  if (headerRowIndex === -1) throw new Error('Could not locate header row');

  const headers = (lines[headerRowIndex] || '').split(',').map(h => h.trim());
  // HP Tuners typical: headers row, then units row, two blanks, then data
  const dataStart = headerRowIndex + 4;

  const dataRows = lines.slice(dataStart).filter(row => row && row.includes(','));

  const toNum = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const parsed = dataRows.map(row => {
    const values = row.split(',');
    const obj = {};
    headers.forEach((h, i) => { obj[h] = toNum(values[i]); });
    return obj;
  });

  if (!parsed.length) throw new Error('No data rows found in CSV.');
  return { headers, parsed };
}

const isNum = (v) => Number.isFinite(v);
const movAvg = (arr, win=5) => {
  if (!arr || !arr.length) return [];
  const half = Math.floor(win/2);
  return arr.map((_, i) => {
    const s = Math.max(0, i-half);
    const e = Math.min(arr.length-1, i+half);
    const n = e - s + 1;
    let sum = 0;
    for (let k=s;k<=e;k++) sum += arr[k];
    return sum / n;
  });
};
const zeroPhaseMovAvg = (arr, win=5) => {
  if (!arr || arr.length === 0) return [];
  const fwd = movAvg(arr, win);
  const rev = movAvg([...fwd].reverse(), win).reverse();
  return rev;
};
function resampleUniform(T, Y, targetHz = 60) {
  if (!T || !Y || T.length !== Y.length || T.length < 3) return { t: [], y: [] };
  const t0 = T[0], tN = T[T.length - 1];
  const dt = 1 / targetHz;
  const N = Math.max(3, Math.floor((tN - t0) / dt));
  const tU = new Array(N);
  const yU = new Array(N);
  let j = 1;
  for (let i = 0; i < N; i++) {
    const t = t0 + i * dt;
    tU[i] = t;
    while (j < T.length && T[j] < t) j++;
    const aIdx = Math.max(0, j - 1);
    const bIdx = Math.min(T.length - 1, j);
    const Ta = T[aIdx], Tb = T[bIdx];
    const Ya = Y[aIdx], Yb = Y[bIdx];
    const f = (Tb - Ta) !== 0 ? Math.min(1, Math.max(0, (t - Ta) / (Tb - Ta))) : 0;
    yU[i] = (isNum(Ya) && isNum(Yb)) ? (Ya + (Yb - Ya) * f) : NaN;
  }
  return { t: tU, y: yU };
}

// Single-gear sweep finder (same logic as frontend)
function selectRpmSweep(time, rpm, mph, pedal = null) {
  if (!rpm || !mph || rpm.length < 20 || mph.length !== rpm.length) return null;

  const PEDAL_MIN = 80, MIN_MPH = 5, RATIO_TOL = 0.12, RPM_DIP = 75, MIN_LEN = 20;

  const isWOT = (i) => {
    if (!pedal || pedal.length !== rpm.length) return true;
    const v = pedal[i];
    return Number.isFinite(v) ? v >= PEDAL_MIN : true;
  };

  const ratio = rpm.map((r, i) => {
    const v = mph[i];
    if (!Number.isFinite(r) || !Number.isFinite(v) || v < MIN_MPH) return null;
    return r / Math.max(v, 1e-6);
  });

  const okRise = (i) =>
    Number.isFinite(rpm[i]) &&
    Number.isFinite(rpm[i - 1]) &&
    rpm[i] >= rpm[i - 1] - RPM_DIP;

  const good = (i) => okRise(i) && isWOT(i) && ratio[i] !== null;

  const coarse = [];
  let s = 1;
  for (let i = 1; i < rpm.length; i++) {
    if (!good(i)) {
      if (i - 1 - s >= MIN_LEN) coarse.push([s, i - 1]);
      s = i;
    }
  }
  if (rpm.length - 1 - s >= MIN_LEN) coarse.push([s, rpm.length - 1]);
  if (!coarse.length) return null;

  const keepWindows = [];
  for (const [a, b] of coarse) {
    let i = a;
    while (i <= b) {
      const start = i;
      let j = i;
      const medBuf = [];
      while (j <= b && ratio[j] !== null) {
        medBuf.push(ratio[j]);
        const sorted = [...medBuf].sort((x, y) => x - y);
        const med = sorted[Math.floor(sorted.length / 2)];
        const dev = Math.abs(ratio[j] - med) / Math.max(med, 1e-6);
        if (dev > RATIO_TOL) break;
        j++;
      }
      const end = j - 1;
      if (end - start + 1 >= MIN_LEN) keepWindows.push([start, end]);
      i = Math.max(start + 1, j);
    }
  }
  if (!keepWindows.length) return null;

  keepWindows.sort((u, v) => (v[1] - v[0]) - (u[1] - u[0]));
  let [i0, i1] = keepWindows[0];
  const LOOSE = RATIO_TOL * 1.5;

  let k = i0 - 1;
  while (k > 0 && isWOT(k) && mph[k] >= MIN_MPH && rpm[k] >= rpm[k + 1] - RPM_DIP) {
    const med = (ratio[i0] + ratio[i1]) / 2;
    const dev = Math.abs(ratio[k] - med) / Math.max(med, 1e-6);
    if (dev > LOOSE) break;
    i0 = k; k--;
  }
  k = i1 + 1;
  while (k < rpm.length && isWOT(k) && mph[k] >= MIN_MPH && rpm[k] >= rpm[k - 1] - RPM_DIP) {
    const med = (ratio[i0] + ratio[i1]) / 2;
    const dev = Math.abs(ratio[k] - med) / Math.max(med, 1e-6);
    if (dev > LOOSE) break;
    i1 = k; k++;
  }
  return [i0, i1];
}

// Auto pull-gear detection (returns {gear, confidence})
function detectPullGear({ rpm, mph, tireIn, rear }) {
  if (!rpm || !mph || rpm.length < 12) return { gear: null, confidence: 0 };
  if (!isNum(tireIn) || tireIn <= 0 || !isNum(rear) || rear <= 0) return { gear: null, confidence: 0 };

  const samples = [];
  for (let i = 0; i < rpm.length; i++) {
    const R = rpm[i], V = mph[i];
    if (!isNum(R) || !isNum(V) || V < 5) continue;
    const overall = (R * tireIn) / (V * 336);
    if (!isNum(overall) || overall <= 0) continue;
    const tg = overall / rear;
    if (isNum(tg) && tg > 0.3 && tg < 6.5) samples.push(tg);
  }
  if (samples.length < 6) return { gear: null, confidence: 0 };

  const sorted = [...samples].sort((a,b)=>a-b);
  const med = sorted[Math.floor(sorted.length/2)];
  const devs = sorted.map(v => Math.abs(v - med)).sort((a,b)=>a-b);
  const mad  = devs[Math.floor(devs.length/2)] || 0;

  const kept = samples.filter(v => Math.abs(v - med) <= 3 * (mad || 0.01));
  if (kept.length < 6) return { gear: null, confidence: 0 };

  const mean = kept.reduce((a,c)=>a+c,0)/kept.length;
  const variance = kept.reduce((a,c)=>a + Math.pow(c-mean,2),0)/kept.length;
  const std = Math.sqrt(variance);
  const conf = Math.max(0, Math.min(1, 1 - (std / 0.10)));

  const est = kept.sort((a,b)=>a-b)[Math.floor(kept.length/2)];
  return { gear: Math.round(est * 100) / 100, confidence: conf };
}

// =====================================================
// Checklist (unchanged, with TPS+Pedal WOT and Boost PSI)
// =====================================================
function formatChecklist(parsed, headers) {
  const summary = [];
  const safeMax = (arr) => arr.length ? Math.max(...arr) : undefined;
  const getColumn = (name) => parsed.map(r => r[name]).filter(Number.isFinite);
  const hasCol = (name) => headers.includes(name);

  // Knock (Dodge negative → magnitude)
  const knockCol = getColumn('Total Knock Retard').map(v => Math.abs(v));
  const peakKnock = safeMax(knockCol);
  if (peakKnock !== undefined) {
    summary.push(peakKnock > 0 ? `⚠️ Knock detected: up to ${peakKnock.toFixed(1)}°` : '✅ No knock detected.');
  } else {
    summary.push('ℹ️ Knock column not found.');
  }

  // WOT gating: Pedal + TPS ≥ 86% if TPS exists
  const accelName = 'Accelerator Position D (SAE)';
  const throttleName = 'Throttle Position (SAE)';
  const timingName = 'Timing Advance (SAE)';
  const rpmName = 'Engine RPM (SAE)';
  const mapName = 'Intake Manifold Absolute Pressure (SAE)';
  const timeName = 'Offset';
  const speedName = 'Vehicle Speed (SAE)';

  let wotRows = [];
  if (hasCol(accelName)) {
    wotRows = parsed.filter(r => {
      const pedalOK = Number.isFinite(r[accelName]) && r[accelName] > 86;
      const tpsOK = !hasCol(throttleName) || (Number.isFinite(r[throttleName]) && r[throttleName] > 86);
      return pedalOK && tpsOK;
    });
  }

  if (wotRows.length) {
    // Peak timing @ RPM (true WOT)
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
      summary.push('ℹ️ Could not determine peak timing @ RPM under true WOT.');
    }

    // Boost (psi) inside true WOT window
    const PSI_PER_KPA = 0.1450377377;
    const baroCandidates = [
      'Barometric Pressure (SAE)',
      'Baro Pressure (SAE)',
      'Ambient Pressure (SAE)'
    ];
    const baroName = baroCandidates.find(hasCol);
    const defaultBaroKpa = 101.325;
    const computeBoostPsi = (mapKpa, baroKpa) => {
      const boost = (Number(mapKpa) - Number(baroKpa)) * PSI_PER_KPA;
      if (!Number.isFinite(boost)) return 0;
      return Math.max(0, Number(boost.toFixed(2)));
    };

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
      let peakBoostPsi = -Infinity;
      let peakIdx = -1;
      for (let i = 0; i < wotBoostPsi.length; i++) {
        if (wotBoostPsi[i] > peakBoostPsi) {
          peakBoostPsi = wotBoostPsi[i];
          peakIdx = i;
        }
      }
      const peakBoostRpm = Number.isFinite(wotRpm[peakIdx]) ? Math.round(wotRpm[peakIdx]) : null;

      const avg = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
      const avgBoostPsiWot = Number(avg(wotBoostPsi).toFixed(2));

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

      summary.push(`🌀 Peak Boost (Pedal & TPS ≥ 86%): ${peakBoostPsi.toFixed(2)} psi${peakBoostRpm ? ` @ ${peakBoostRpm} RPM` : ''}`);
      summary.push(`📊 Average Boost (Pedal & TPS ≥ 86%): ${avgBoostPsiWot.toFixed(2)} psi`);
      summary.push(`🎯 Boost @ Highest RPM (Pedal & TPS ≥ 86%)${highestRpmRounded ? ` (${highestRpmRounded} RPM)` : ''}: ${boostAtHighestRpm.toFixed(2)} psi`);
    } else {
      summary.push('ℹ️ Boost (PSI) could not be computed in true WOT window.');
    }
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
    const peak = Math.max(...volts);
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

  // Timers (pedal WOT gating)
  const speed = getColumn(speedName);
  const time = getColumn(timeName);
  const accel = getColumn(accelName);

  const findAllIntervals = (start, end) => {
    const times = [];
    let startTime = null;
    for (let i = 0; i < speed.length; i++) {
      const s = speed[i], t = time[i], ap = accel[i];
      if (!Number.isFinite(s) || !Number.isFinite(t) || !Number.isFinite(ap)) continue;
      if (ap < 86) continue;
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
      const s = speed[i], t = time[i], ap = accel[i];
      if (!Number.isFinite(s) || !Number.isFinite(t) || !Number.isFinite(ap)) continue;
      if (ap < 86) continue;
      if (!foundStop && s < 1.5) foundStop = true;
      if (foundStop && startTime === null && s > 1.5) startTime = t;
      if (startTime !== null && s >= 60) {
        times.push((t - startTime).toFixed(2));
        startTime = null; foundStop = false;
      }
    }
    return times;
  };

  const best = (arr) => (arr.length ? Math.min(...arr.map(Number)) : null);
  const z60 = best(findAllZeroToSixty());
  const f100 = best(findAllIntervals(40, 100));
  const s130 = best(findAllIntervals(60, 130));
  if (z60) summary.push(`🚦 Best 0–60 mph: ${Number(z60).toFixed(2)}s`);
  if (f100) summary.push(`🚀 Best 40–100 mph: ${Number(f100).toFixed(2)}s`);
  if (s130) summary.push(`🚀 Best 60–130 mph: ${Number(s130).toFixed(2)}s`);

  return summary.join('\n');
}

// =====================================================
// Backend dyno computation (adds ===DYNO=== payload)
// =====================================================
const K_DYNO = 0.0001465;         // matched to your front-end tuning
const REF_OVERALL = 1.29 * 3.09;  // 3.9861 (5th × rear from your 536whp baseline)
const REF_TIRE_IN = 28.0;

function buildDynoPayload(parsed, { mode = 'dyno', rear, tireIn, pullGear, trans }) {
  try {
    // Extract time/rpm/mph/pedal
    const T = parsed.map(r => r['Offset']).filter(isNum);
    const RPM = parsed.map(r => r['Engine RPM (SAE)']);
    const MPH = parsed.map(r => r['Vehicle Speed (SAE)']);
    const Ped = parsed.map(r => r['Accelerator Position D (SAE)']);
    if (!RPM.some(isNum) || !MPH.some(isNum) || !T.some(isNum)) {
      return { error: 'Missing RPM/MPH/Time columns' };
    }

    // Use same windowing as frontend
    const sweep = selectRpmSweep(T, RPM, MPH, Ped);
    if (!sweep) return { error: 'No single-gear WOT window detected' };
    const [i0, i1] = sweep;

    const time = T.slice(i0, i1 + 1).filter(isNum);
    const rpm  = RPM.slice(i0, i1 + 1);
    const mph  = MPH.slice(i0, i1 + 1);

    const tire = isNum(tireIn) && tireIn > 0 ? tireIn : REF_TIRE_IN;
    const rearGear = isNum(rear) && rear > 0 ? rear : 3.09;

    // Auto-detect pull gear if not given
    let usedPull = isNum(pullGear) ? pullGear : null;
    let detectConf = 0;

    if (!isNum(usedPull)) {
      const det = detectPullGear({ rpm, mph, tireIn: tire, rear: rearGear });
      usedPull = det.gear;
      detectConf = det.confidence || 0;

      // Snap to catalog if close (and we know transmission)
      if (isNum(usedPull) && trans && TRANS_RATIOS[trans]) {
        let nearest = null, dn = Infinity;
        for (const [label, ratio] of Object.entries(TRANS_RATIOS[trans])) {
          const d = Math.abs(ratio - usedPull);
          if (d < dn) { dn = d; nearest = { label, ratio }; }
        }
        if (nearest && dn <= 0.06) usedPull = nearest.ratio;
      }
    }

    // Resample & smooth RPM for derivative stability
    const { t: Tu, y: RPMu } = resampleUniform(time, rpm, 60);
    if (!RPMu.length) return { error: 'Resampling failed' };
    const RPMs = zeroPhaseMovAvg(RPMu, 7);
    const dRPMdt = RPMs.map((_, i, arr) => {
      if (i === 0 || i === arr.length - 1) return 0;
      return (arr[i + 1] - arr[i - 1]) * (60 / 2); // RPM/s at 60Hz
    });
    const dRPMdtS = zeroPhaseMovAvg(dRPMdt, 7);

    let HP;
    if (mode === 'track') {
      // Road-load model
      const MPH_TO_FTPS = 1.4666667, HP_DEN = 550, G = 32.174;
      const { y: MPHu } = resampleUniform(time, mph, 60);
      const Vs = zeroPhaseMovAvg(MPHu.map(v => v * MPH_TO_FTPS), 5);
      const As = Vs.map((_, i, arr) => {
        if (i === 0 || i === arr.length - 1) return 0;
        return (arr[i + 1] - arr[i - 1]) * (60 / 2);
      });

      const weight = 0; // not provided by FE today for backend dyno; FE handles track mode locally
      const mass = weight / G;
      const crr = 0.015, cda = 8.5, rho = 0.00238;
      const P_inert = Vs.map((v, i) => mass * As[i] * v);
      const P_roll  = Vs.map(v => (crr * weight * v));
      const P_aero  = Vs.map(v => (0.5 * rho * cda * v * v * v));
      const P_tot   = P_inert.map((p, i) => p + P_roll[i] + P_aero[i]);
      HP = P_tot.map(p => p / HP_DEN);
    } else {
      // Dyno model with ratio/tire scaling
      const pull = isNum(usedPull) ? usedPull : 1.29;
      const overall = pull * rearGear;
      const s_overall = Math.pow(REF_OVERALL / overall, 2);
      const s_tire    = Math.pow(REF_TIRE_IN / tire, 2);
      const scale = s_overall * s_tire;
      HP = RPMs.map((r, i) => Math.max(0, K_DYNO * r * dRPMdtS[i] * scale));
    }

    // Build RPM vs HP/TQ (100 rpm bin, smoothed)
    const pts = [];
    for (let i = 0; i < RPMs.length; i++) if (isNum(RPMs[i]) && RPMs[i] > 0 && isNum(HP[i])) pts.push({ x: RPMs[i], hp: HP[i] });
    if (!pts.length) return { error: 'Insufficient dyno points' };
    pts.sort((a, b) => a.x - b.x);

    const bin = 100;
    const bins = new Map();
    for (const p of pts) {
      const key = Math.round(p.x / bin) * bin;
      const cur = bins.get(key);
      if (!cur) bins.set(key, { x: key, hp: [p.hp] });
      else cur.hp.push(p.hp);
    }
    const series = Array.from(bins.values())
      .map(b => ({ x: b.x, hp: b.hp.reduce((a, c) => a + c, 0) / b.hp.length }))
      .sort((a, b) => a.x - b.x);

    const X  = series.map(p => p.x);
    const HPs = zeroPhaseMovAvg(series.map(p => p.hp), 9);
    const TQ  = X.map((r, i) => (r > 0 ? (HPs[i] * 5252) / r : null));

    // Peaks
    let iHP = 0; for (let i=1;i<HPs.length;i++) if (HPs[i] > HPs[iHP]) iHP = i;
    let iTQ = 0; for (let i=1;i<TQ.length;i++) if (TQ[i] > TQ[iTQ]) iTQ = i;

    return {
      mode,
      xLabel: 'RPM',
      x: X,
      hp: HPs,
      tq: TQ,
      peakHP: HPs.length ? { rpm: X[iHP], value: +HPs[iHP].toFixed(1) } : null,
      peakTQ: TQ.length ? { rpm: X[iTQ], value: +TQ[iTQ].toFixed(1) } : null,
      pullGearUsed: isNum(usedPull) ? +usedPull.toFixed(2) : null,
      detectConf: detectConf
    };
  } catch (e) {
    return { error: 'Dyno compute failed' };
  }
}

// =====================================================
// AI REVIEW (now includes ===DYNO=== JSON tail)
// =====================================================
app.post(['/ai-review', '/api/ai-review'], upload.single('log'), async (req, res) => {
  let filePath;
  try {
    if (!req.file) return res.status(400).send('No CSV file uploaded.');
    filePath = req.file.path;
    const content = fs.readFileSync(filePath, 'utf8');
    const { headers, parsed } = analyzeCsvContent(content);

    const checklist = formatChecklist(parsed, headers);

    // Reduced data for AI (token-friendly)
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

    // Optional dyno parameters from multipart form (if FE sends them)
    const mode = (req.body.mode || 'dyno').toString();
    const trans = req.body.trans ? String(req.body.trans) : undefined;
    const rear = req.body.rear ? parseFloat(req.body.rear) : undefined;
    const tireIn = req.body.tire ? parseFloat(req.body.tire) : undefined;
    const pullGear = req.body.pullGear ? parseFloat(req.body.pullGear) : undefined;

    const dynoJSON = buildDynoPayload(parsed, { mode, rear, tireIn, pullGear, trans });

    res.type('text/plain').send(
      checklist + '\n===SPLIT===\n' + finalReview + '\n===DYNO===\n' + JSON.stringify(dynoJSON)
    );
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to analyze log.');
  } finally {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

// ---------- 404 guard ----------
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// ---------- Global error handler ----------
app.use((err, req, res, next) => {
  console.error('GLOBAL ERROR:', err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
