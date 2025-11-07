// backend/routes/aiReview.js
const express = require('express');
const router = express.Router();
const { OpenAI } = require('openai');
const multer = require('multer');

// ✅ adjust this path if your parseCSV.js lives elsewhere
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

// ---------- Dyno helpers (correct physics) ----------
const g = 32.174;           // ft/s^2
const MPH_TO_FTPS = 1.4666667;
const HP_PER_FTLBPS = 550;

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

// Pick a single-gear RPM sweep: longest contiguous region of *increasing* RPM
function selectRpmSweep(time, rpm, throttleOrPedal = null) {
  if (!rpm || rpm.length < 5) return null;

  // Optional: require WOT-ish if we have it
  const isWOT = (i) => {
    if (!throttleOrPedal) return true;
    const v = throttleOrPedal[i];
    return isNum(v) ? v >= 86 : true;
  };

  let segments = [];
  let start = 0;
  for (let i = 1; i < rpm.length; i++) {
    const rising = isNum(rpm[i]) && isNum(rpm[i-1]) && rpm[i] > rpm[i-1] && isWOT(i);
    if (!rising) {
      if (i - 1 - start >= 10) segments.push([start, i - 1]);
      start = i;
    }
  }
  if (rpm.length - 1 - start >= 10) segments.push([start, rpm.length - 1]);
  if (!segments.length) return null;

  // choose longest segment
  segments.sort((a, b) => (b[1]-b[0]) - (a[1]-a[0]));
  return segments[0]; // [i0, i1]
}

function buildDynoFromParsed(parsed, weightLbs = 0) {
  if (!parsed) return { error: 'No parsed data' };
  const { time, speed, rpm, throttle, pedal } = parsed;

  if (!time || !speed || time.length < 3) return { error: 'Need time & speed' };
  const hasRPM = Array.isArray(rpm) && rpm.some(r => isNum(r) && r > 0);
  if (!hasRPM) return { error: 'RPM column required for dyno' };

  // Prefer throttle/pedal if available to help sweep selection
  const control = (throttle && throttle.length === time.length) ? throttle
                 : (pedal && pedal.length === time.length) ? pedal
                 : null;

  // Find single-gear sweep using RPM monotonic increase (and WOT if present)
  const sweep = selectRpmSweep(time, rpm, control);
  if (!sweep) return { error: 'Could not find a clean RPM sweep' };
  const [i0, i1] = sweep;

  // Slice arrays to sweep window
  const T = time.slice(i0, i1 + 1);
  const RPM = rpm.slice(i0, i1 + 1);
  const MPH = speed.slice(i0, i1 + 1); // mph

  // Convert to ft/s and compute acceleration in ft/s^2
  const V = MPH.map(v => v * MPH_TO_FTPS);
  const A = V.map((_, i) => {
    const i0c = Math.max(0, i-1);
    const i1c = Math.min(V.length-1, i+1);
    const dv = V[i1c] - V[i0c];
    const dt = T[i1c] - T[i0c];
    return dt > 0 ? dv / dt : 0;
  });

  // Smooth v and a
  const Vsm = movAvg(V, 5);
  const Asm = movAvg(A, 5);

  // Mass (slugs) = weight (lbf) / g
  const mass = weightLbs > 0 ? (weightLbs / g) : null;

  // Instantaneous power (ft·lbf/s) = m * a * v   (ignores aero/rolling; WOT pull proxy)
  const P = Vsm.map((v, i) => {
    const base = Asm[i] * v;
    if (mass) return Math.max(0, mass * base);
    // If weight unknown: return relative power scaled to 1 at peak later
    return Math.max(0, base);
  });

  // HP
  let HP = P.map(p => mass ? (p / HP_PER_FTLBPS) : p);
  if (!mass) {
    // scale relative so peak ~ 100 for readability when weight missing
    const peak = Math.max(...HP, 1e-6);
    HP = HP.map(v => 100 * v / peak);
  }

  // Bin by 50 RPM for a clean curve
  const pts = [];
  for (let i = 0; i < RPM.length; i++) if (isNum(RPM[i]) && RPM[i] > 0 && isNum(HP[i])) pts.push({ x: RPM[i], hp: HP[i] });
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

  const X = series.map(p => p.x);
  const HPs = movAvg(series.map(p => p.hp), 5);
  const TQ = X.map((r, i) => (r > 0 ? (HPs[i] * 5252) / r : null));

  let iHP = 0; for (let i=1;i<HPs.length;i++) if (HPs[i] > HPs[iHP]) iHP = i;
  let iTQ = 0; for (let i=1;i<TQ.length;i++) if (TQ[i] > TQ[iTQ]) iTQ = i;

  return {
    usedRPM: true,
    xLabel: 'RPM',
    x: X,
    hp: HPs,
    tq: TQ,
    peakHP: HPs.length ? { rpm: X[iHP], value: +HPs[iHP].toFixed(1) } : null,
    peakTQ: TQ.length ? { rpm: X[iTQ], value: +TQ[iTQ].toFixed(1) } : null,
    hasWeight: !!mass,
  };
}

// NOTE: This route accepts multipart FormData: fields { vehicle, mods, metrics, weight } and file { log }
router.post('/ai-review', upload.single('log'), async (req, res) => {
  try {
    // Parse JSON-ish fields (stringified in multipart)
    let vehicle = req.body?.vehicle;
    let mods = req.body?.mods;
    let metrics = req.body?.metrics;
    try { if (typeof vehicle === 'string') vehicle = JSON.parse(vehicle); } catch {}
    try { if (typeof mods === 'string') mods = JSON.parse(mods); } catch {}
    try { if (typeof metrics === 'string') metrics = JSON.parse(metrics); } catch {}

    const weightLbs = Number(req.body?.weight ?? 0); // may be NaN/0

    const missing = validateMods(mods);
    if (missing.length) {
      return res.status(400).send(`❌ Missing or invalid fields: ${missing.join(', ') }===SPLIT===`);
    }

    // Parse CSV using shared parser
    let parsed = null;
    if (req.file && req.file.buffer) {
      const rawCSV = req.file.buffer.toString('utf8');
      try {
        // Expect parsed to include at least { time, speed, rpm }, optionally { throttle, pedal }
        parsed = parseCSV(rawCSV);
      } catch (e) {
        console.error('parseCSV error:', e);
      }
    }

    // Build dyno (proper physics)
    let dynoData = null;
    if (parsed) {
      dynoData = buildDynoFromParsed(parsed, isNum(weightLbs) && weightLbs > 0 ? weightLbs : 0);
      if (dynoData?.error) {
        // Keep error text for frontend diagnostics
        dynoData = { error: dynoData.error };
      }
    }

    // ---- AI Assessment (unchanged policy) ----
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

    const quickChecks = ''; // your non-AI quick checks can populate this later

    // TEXT payload + DYNO JSON appended
    const payload = `${quickChecks}===SPLIT===${assessment}===DYNO===${JSON.stringify(dynoData || null)}`;
    return res.status(200).send(payload);
  } catch (e) {
    console.error('ai-review error', e);
    return res.status(500).send(`❌ AI review failed===SPLIT===An error occurred.===DYNO===${JSON.stringify({ error: 'server error' })}`);
  }
});

module.exports = router;
