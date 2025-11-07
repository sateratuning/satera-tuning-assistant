// backend/routes/aiReview.js
const express = require('express');
const router = express.Router();
const { OpenAI } = require('openai');
const multer = require('multer');

// ✅ adjust this path if your parseCSV.js is in a different folder
const parseCSV = require('../parseCSV');

const upload = multer({ storage: multer.memoryStorage() });

const REQUIRED_ENUMS = {
  engine: ['Pre-eagle 5.7L','6.1L','Eagle 5.7L','6.4L','Hellcat 6.2L','HO Hellcat 6.2L','Other'],
  power_adder: ['N/A','Centrifugal','PD Blower','Turbo','Nitrous'],
  fuel: ['91','93','E85','E70-E79','Race Gas','Other'],
  trans: ['Manual','5-speed auto','8-speed auto','Other'],
  nn: ['Enabled','Disabled'],
};

function validateMods(mods) {
  const missing = [];
  ['engine','power_adder','fuel','trans','nn'].forEach(k => { if (!mods?.[k]) missing.push(k); });
  Object.entries(REQUIRED_ENUMS).forEach(([k, list]) => {
    if (mods?.[k] && !list.includes(mods[k])) missing.push(`${k}:invalid`);
  });
  return missing;
}

function sanitizeTone(text) {
  if (!text) return text;
  const replacements = [
    [/the tune is (too|overly) aggressive/gi, 'the current timing/load behavior shows signs that may merit further review'],
    [/retard (timing|spark) by [\d\.\-]+°/gi, 'consider further investigation based on your process'],
    [/\bboost(ed)?\s?(?:psi|levels?)?\b/gi, 'intake pressure behavior'],
    [/you should/gi, 'it may be worth'],
    [/\bfix\b/gi, 'address'],
    [/\bincorrect\b/gi, 'inconsistent'],
  ];
  let out = text;
  for (const [re, rep] of replacements) out = out.replace(re, rep);
  return out;
}

function buildSystemPrompt({ mods }) {
  return [
`You are an automotive log *assessor* for Gen 3 HEMI vehicles.`,
`HARD RULES:`,
`- Do NOT recommend tuning changes. Do NOT provide prescriptive edits.`,
`- Use neutral, advisory language: “signals”, “indicates”, “may merit review”.`,
`- If power_adder = N/A, do NOT mention boost, psi, or boosted behavior.`,
`- Focus only on the metrics provided: knock, peak timing, knock sensor volts, fuel trims, avg fuel correction, oil pressure, coolant temp, misfires, acceleration intervals.`,
`- Output sections: Summary, Knock, Timing, Fueling, Sensors, Temps/Oil, Misfires, Acceleration, Next Steps.`,
`- Next Steps should be non-prescriptive suggestions (mechanical checks, more logging, sensor verification).`,
  ].join('\n');
}

function buildUserPrompt({ vehicle, mods, metrics }) {
  return [
`VEHICLE: ${vehicle?.year || ''} ${vehicle?.model || ''} | Engine: ${mods.engine} | Trans: ${mods.trans}`,
`MODS: Power Adder: ${mods.power_adder} | Fuel: ${mods.fuel} | NN: ${mods.nn}`,
`KEY METRICS:`,
`- Knock events: ${metrics?.knock?.length ? JSON.stringify(metrics.knock) : 'None'}`,
`- Peak timing: ${metrics?.peakTiming ?? 'N/A'}° @ ${metrics?.peakTimingRPM ?? 'N/A'} RPM`,
`- Knock Sensor Voltages: B1 ${metrics?.ks1max ?? 'N/A'} V, B2 ${metrics?.ks2max ?? 'N/A'} V`,
`- Fuel trim variance: ${typeof metrics?.varFT === 'number' ? metrics.varFT.toFixed(1) : 'N/A'}%`,
`- Avg Fuel Corr: B1 ${typeof metrics?.avgFT1 === 'number' ? metrics.avgFT1.toFixed(1) : 'N/A'}%, B2 ${typeof metrics?.avgFT2 === 'number' ? metrics.avgFT2.toFixed(1) : 'N/A'}%`,
`- Oil min: ${metrics?.oilMin ?? 'N/A'} psi`,
`- ECT max: ${metrics?.ectMax ?? 'N/A'} °F`,
`- Misfires: ${metrics?.misfires ? JSON.stringify(metrics.misfires) : 'N/A'}`,
`- 0–60 mph: ${metrics?.zeroTo60 || 'N/A'}`,
`- 40–100 mph: ${metrics?.fortyTo100 || 'N/A'}`,
`- 60–130 mph: ${metrics?.sixtyTo130 || 'N/A'}`,
`Please produce a neutral *assessment* using these values per the HARD RULES.`,
  ].join('\n');
}

// ---------- Simulated Dyno from parsed arrays ----------
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

function buildDyno(data, weightLbs = 0) {
  if (!data) return null;
  const { time, speed, rpm } = data;
  if (!time || !speed || time.length < 2 || speed.length !== time.length) return null;

  // accel in mph/s (central difference)
  const accel = [];
  for (let i = 0; i < speed.length; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(speed.length - 1, i + 1);
    const dv = speed[i1] - speed[i0];
    const dt = time[i1] - time[i0];
    accel.push(dt > 0 ? dv / dt : 0);
  }

  const mph_s = movAvg(speed, 5);
  const acc_s = movAvg(accel, 5);

  // HP ≈ (Weight * mph * d(mph)/dt) / 375 ; if no weight, return relative curve
  const hpRaw = mph_s.map((v, i) => {
    const base = Math.max(0, v * acc_s[i]);
    return weightLbs > 0 ? (weightLbs * base) / 375 : base;
  });

  // If RPM present → build HP/TQ vs RPM (binned at ~50 rpm)
  const hasRPM = Array.isArray(rpm) && rpm.some(r => isNum(r) && r > 0);
  if (hasRPM) {
    const pts = [];
    for (let i = 0; i < rpm.length; i++) {
      const r = rpm[i];
      const hp = hpRaw[i];
      if (isNum(r) && r > 0 && isNum(hp)) pts.push({ x: r, hp });
    }
    if (!pts.length) {
      const hp = movAvg(hpRaw, 5);
      return { usedRPM: false, xLabel: 'Speed (mph)', x: mph_s, hp, tq: null };
    }

    pts.sort((a, b) => a.x - b.x);
    const bin = 50;
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

    const x = series.map(p => p.x);
    const hp = movAvg(series.map(p => p.hp), 5);
    const tq = x.map((r, i) => (r > 0 ? (hp[i] * 5252) / r : null));

    // peaks
    let iHP = 0; for (let i=1;i<hp.length;i++) if (hp[i] > hp[iHP]) iHP = i;
    let iTQ = 0; for (let i=1;i<tq.length;i++) if (tq[i] > tq[iTQ]) iTQ = i;

    return {
      usedRPM: true, xLabel: 'RPM',
      x, hp, tq,
      peakHP: hp.length ? { rpm: x[iHP], value: +hp[iHP].toFixed(1) } : null,
      peakTQ: tq.length ? { rpm: x[iTQ], value: +tq[iTQ].toFixed(1) } : null,
      hasWeight: weightLbs > 0
    };
  }

  const hp = movAvg(hpRaw, 5);
  let iHP = 0; for (let i=1;i<hp.length;i++) if (hp[i] > hp[iHP]) iHP = i;

  return {
    usedRPM: false, xLabel: 'Speed (mph)',
    x: mph_s, hp, tq: null,
    peakHP: hp.length ? { speed: +mph_s[iHP].toFixed(1), value: +hp[iHP].toFixed(1) } : null,
    peakTQ: null,
    hasWeight: weightLbs > 0
  };
}

// NOTE: This route accepts multipart FormData: fields { vehicle, mods, metrics } and file { log }
router.post('/ai-review', upload.single('log'), async (req, res) => {
  try {
    // Parse JSON fields that arrived as strings in multipart
    let vehicle = req.body?.vehicle;
    let mods = req.body?.mods;
    let metrics = req.body?.metrics;

    try { if (typeof vehicle === 'string') vehicle = JSON.parse(vehicle); } catch {}
    try { if (typeof mods === 'string') mods = JSON.parse(mods); } catch {}
    try { if (typeof metrics === 'string') metrics = JSON.parse(metrics); } catch {}

    const missing = validateMods(mods);
    if (missing.length) {
      return res.status(400).send(`❌ Missing or invalid fields: ${missing.join(', ') }===SPLIT===`);
    }

    // --- Parse CSV if present using your shared backend parser ---
    let parsed = null;
    if (req.file && req.file.buffer) {
      const rawCSV = req.file.buffer.toString('utf8');
      try {
        parsed = parseCSV(rawCSV); // expects { time, speed, rpm, ... }
      } catch (e) {
        console.error('parseCSV error:', e);
      }
    }

    // Build dyno data (default weight can be overridden later via a dedicated route if you want)
    const defaultWeightLbs = 0; // keep 0 to show "relative" HP unless you later pass weight from frontend
    const dynoData = parsed ? buildDyno(parsed, defaultWeightLbs) : null;

    // --- AI Assessment (unchanged) ---
    const system = buildSystemPrompt({ mods });
    const user = buildUserPrompt({ vehicle, mods, metrics });

    const openai = new OpenAI();
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_tokens: 600,
    });

    let assessment = resp.choices?.[0]?.message?.content || '';
    assessment = sanitizeTone(assessment);
    if (mods.power_adder === 'N/A') {
      assessment = assessment
        .split('\n')
        .filter(line => !/\b(boost|psi|boosted)\b/i.test(line))
        .join('\n');
    }

    // quickChecks left blank here; your other non-AI logic can populate later if desired
    const quickChecks = '';

    // 👉 Return TEXT the way your MainApp expects, with a DYNO segment appended
    const dynoJSON = JSON.stringify(dynoData || null);
    const payload = `${quickChecks}===SPLIT===${assessment}===DYNO===${dynoJSON}`;
    return res.status(200).send(payload);
  } catch (e) {
    console.error('ai-review error', e);
    // Still return in the split format so frontend doesn't break
    return res.status(500).send(`❌ AI review failed===SPLIT===${'An error occurred.'}===DYNO===null`);
  }
});

module.exports = router;
