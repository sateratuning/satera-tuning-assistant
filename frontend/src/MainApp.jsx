import React, { useMemo, useState, useEffect } from 'react';
import './App.css';
import { Link } from 'react-router-dom';
import { Line } from 'react-chartjs-2';
import 'chart.js/auto';

import {
  years, models, engines, injectors, mapSensors, throttles,
  powerAdders, transmissions, tireHeights, gearRatios, fuels
} from './ui/options';

// ========= Config =========
const API_BASE = process.env.REACT_APP_API_BASE || '';

// Baseline dyno proportionality (calibrated to your 536whp)
const K_DYNO = 0.0001465;
// Reference overall ratio & tire for scale normalization
const REF_OVERALL = 1.29 * 3.09;   // 5th (1.29) × 3.09 rear
const REF_TIRE_IN = 28.0;

// ========= Styles (trimmed) =========
const styles = {
  page: { backgroundColor: '#111', color: '#adff2f', minHeight: '100vh', fontFamily: 'Arial' },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, background: 'linear-gradient(to bottom, #00ff88, #007744)',
    color: '#000', fontSize: '2rem', fontWeight: 'bold', boxShadow: '0 4px 10px rgba(0,255,136,0.4)'
  },
  headerRight: { display: 'flex', gap: 10 },
  shell: { padding: 20 },
  grid2: { display: 'grid', gridTemplateColumns: '410px 1fr', gap: 16 },
  gridNarrow: { display: 'grid', gridTemplateColumns: '1fr', gap: 16 },
  card: { backgroundColor: '#1a1a1a', padding: 12, borderRadius: 8, border: '1px solid #2a2a2a' },
  button: { backgroundColor: '#00ff88', color: '#000', padding: '10px 16px', border: 'none', cursor: 'pointer', borderRadius: 6 },
  ghostBtn: { background:'transparent', border:'1px solid #1e2b1e', color:'#d9ffe0', padding:'8px 12px', borderRadius:8, cursor:'pointer' },
  input: {
    width: '100%', maxWidth: 360, background: '#0f130f', border: '1px solid #1e2b1e',
    borderRadius: 8, padding: '9px 11px', color: '#d9ffe0', outline: 'none'
  },
  select: {
    width: '100%', maxWidth: 360, background: '#0f130f', border: '1px solid #1e2b1e',
    borderRadius: 8, padding: '9px 11px', color: '#d9ffe0', outline: 'none',
    appearance: 'none'
  },
  sectionTitleFancy: {
    margin: 0, fontWeight: 700, fontSize: 22, letterSpacing: 0.4, textTransform: 'uppercase',
    backgroundImage: 'linear-gradient(90deg, #caffd1, #69ff8a, #caffd1)',
    WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'white'
  },
};

// ========= Helpers =========
const isNum = (v) => Number.isFinite(v);
const comma = (n, d=1) => n.toLocaleString(undefined, { maximumFractionDigits: d });

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

// Flexible column finder
const findCol = (headers, candidates) => {
  for (const c of candidates) {
    const idx = headers.findIndex(h => h.toLowerCase() === c.toLowerCase());
    if (idx !== -1) return idx;
  }
  for (const c of candidates) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(c.toLowerCase()));
    if (idx !== -1) return idx;
  }
  return -1;
};

// Uniform resample for stable derivatives (linear interp)
// returns { t: [], y: [] }
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

// CSV parser (Offset header anchored; HP Tuners layout)
function parseCSV(raw) {
  const rows = raw.split(/\r?\n/).map(r => r.trim());
  if (!rows.length) return null;

  const headerRowIndex = rows.findIndex(r => /(^|,)\s*offset\s*(,|$)/i.test(r));
  if (headerRowIndex === -1) return null;

  const headers = rows[headerRowIndex].split(',').map(h => h.trim());
  const dataStart = headerRowIndex + 4;
  const dataRows = rows.slice(dataStart);

  const speedIndex = findCol(headers, ['Vehicle Speed (SAE)', 'Vehicle Speed', 'Speed (SAE)', 'Speed']);
  const timeIndex  = findCol(headers, ['Offset', 'Time', 'Time (s)']);
  const pedalIndex = findCol(headers, [
    'Accelerator Position D (SAE)', 'Accelerator Position (SAE)',
    'Throttle Position (SAE)', 'Throttle Position (%)', 'TPS', 'Relative Accelerator Position'
  ]);
  const rpmIndex   = findCol(headers, [
    'Engine RPM', 'Engine RPM (SAE)', 'RPM', 'RPM (SAE)', 'Engine Speed (RPM)', 'Engine Speed', 'Engine Speed (SAE)'
  ]);
  const tpsIndex = findCol(headers, ['Throttle Position (SAE)', 'Throttle Position (%)', 'TPS']);

  if (speedIndex === -1 || timeIndex === -1 || pedalIndex === -1) return null;

  const points = [];
  for (let row of dataRows) {
    if (!row.includes(',')) continue;
    const cols = row.split(',');
    const s = parseFloat(cols[speedIndex]);
    const t = parseFloat(cols[timeIndex]);
    const p = parseFloat(cols[pedalIndex]);
    const r = rpmIndex !== -1 ? parseFloat(cols[rpmIndex]) : undefined;
    const tp = tpsIndex !== -1 ? parseFloat(cols[tpsIndex]) : undefined;
    if (isNum(s) && isNum(t) && isNum(p)) {
      points.push({ s, t, p, r: isNum(r) ? r : null, tp: isNum(tp) ? tp : null });
    }
  }
  if (!points.length) return null;

  // True-WOT gating: pedal & TPS ≥ 86% (if TPS exists)
  const wot = (row) => {
    const pedalOK = isNum(row.p) && row.p >= 86;
    const tpsOK = !isNum(row.tp) || row.tp >= 86;
    return pedalOK && tpsOK;
  };

  // Segment by WOT
  let segments = [];
  let current = [];
  for (let pt of points) {
    if (wot(pt)) current.push(pt);
    else if (current.length) { segments.push(current); current = []; }
  }
  if (current.length) segments.push(current);

  const pack = (arr) => ({
    time: arr.map(p => +p.t.toFixed(3)),
    speed: arr.map(p => +p.s.toFixed(2)),
    rpm: arr.map(p => p.r).some(v => v !== null) ? arr.map(p => p.r ?? null) : null,
    pedal: arr.map(p => p.p),
    tps: arr.map(p => p.tp ?? null),
  });

  if (!segments.length) return pack(points);
  segments = segments.filter(seg => seg.length > 8);
  if (!segments.length) return pack(points);

  // Choose *shortest* WOT window (most like a pull)
  segments.sort((a, b) => (a.at(-1).t - a[0].t) - (b.at(-1).t - b[0].t));
  const best = segments[0];

  // Trim launch (ignore idle creep)
  const launchIdx = best.findIndex(p => p.s > 0.5);
  const trimmed = launchIdx >= 0 ? best.slice(launchIdx) : best;

  const t0 = trimmed[0].t;
  const norm = trimmed.map(p => ({ ...p, t: +(p.t - t0).toFixed(3) }));
  return pack(norm);
}

// Single-gear sweep finder (RPM/Mph ratio stability)
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

// Auto pull-gear detection (frontend mirror of backend)
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

// ========= Component =========
export default function MainApp() {
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1100);
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 1100);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [formData, setFormData] = useState({
    year: '', model: '', engine: '', injectors: '', map: '',
    throttle: '', power: '', trans: '', tire: '28', gear: '3.09', fuel: '93',
    weight: '', // lbs (Track mode only)
    logFile: null,
  });

  const [dynoMode, setDynoMode] = useState('dyno'); // 'dyno' | 'track'
  const [showAdv, setShowAdv] = useState(false);
  const [crr, setCrr] = useState(0.015);
  const [cda, setCda] = useState(8.5);      // ft^2
  const [rho, setRho] = useState(0.00238);  // slug/ft^3

  // Gear detection controls
  const [autoGear, setAutoGear] = useState(true);
  const [catalogRatios, setCatalogRatios] = useState([]); // [{label, ratio}]
  const [pullGear, setPullGear] = useState('');           // manual fallback (ratio)
  const [detectMeta, setDetectMeta] = useState({ est: null, conf: 0 });

  const [graphs, setGraphs] = useState(null);
  const [status, setStatus] = useState('');
  const [aiResult, setAiResult] = useState('');
  const [leftText, setLeftText] = useState('');
  const [aiText, setAiText] = useState('');
  const [dynoRemote, setDynoRemote] = useState(null);

  // Load gear catalog for selected transmission
  useEffect(() => {
    const t = formData.trans;
    setCatalogRatios([]);
    if (!t) return;
    fetch(`${API_BASE}/ratios?trans=${encodeURIComponent(t)}`)
      .then(r => r.json())
      .then(j => {
        if (j && j.ok && Array.isArray(j.gears)) setCatalogRatios(j.gears);
      })
      .catch(() => {});
  }, [formData.trans]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((p) => ({ ...p, [name]: value }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0] || null;
    if (!file) return;
    setFormData((p) => ({ ...p, logFile: file }));

    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCSV(reader.result);
      if (!parsed) {
        setStatus('❌ Failed to parse CSV (check format).');
      } else {
        setStatus('CSV parsed.');
        setGraphs(parsed);

        // Auto-detect gear if we have rpm + needed vehicle bits
        try {
          const tireIn = parseFloat(formData.tire || '0');
          const rear = parseFloat(formData.gear || '0');
          if (parsed.rpm && parsed.rpm.some(isNum) && isNum(tireIn) && isNum(rear) && tireIn > 0 && rear > 0) {
            const est = detectPullGear({ rpm: parsed.rpm, mph: parsed.speed, tireIn, rear });
            setDetectMeta({ est: est.gear, conf: est.confidence });
          } else {
            setDetectMeta({ est: null, conf: 0 });
          }
        } catch {
          setDetectMeta({ est: null, conf: 0 });
        }
      }
    };
    reader.readAsText(file);
  };

  // ---------- Submit to backend ----------
  const handleSubmit = async () => {
    const required = ['engine', 'power', 'fuel', 'trans', 'year', 'model'];
    const missing = required.filter(k => !formData[k]);
    if (missing.length) {
      setAiResult(`❌ Please fill in all required fields before running AI Review: ${missing.join(', ')}`);
      return;
    }
    if (!formData.logFile) {
      alert('Please upload a CSV log first.');
      return;
    }

    setStatus('Analyzing...');
    setAiResult('');
    setLeftText('');
    setAiText('');
    setDynoRemote(null);

    try {
      const form = new FormData();
      form.append('log', formData.logFile);

      // Dyno hints for backend (gear/tire/rear)
      form.append('mode', dynoMode);
      form.append('trans', formData.trans);
      form.append('rear', formData.gear || '');
      form.append('tire', formData.tire || '');
      if (!autoGear && pullGear) form.append('pullGear', pullGear);

      const reviewRes = await fetch(`${API_BASE}/ai-review`, { method: 'POST', body: form });
      if (!reviewRes.ok) throw new Error(`AI review failed: ${reviewRes.status}`);

      const text = await reviewRes.text();
      const [mainPart, dynoPart] = text.split('===DYNO===');
      const [quickChecks, aiPart] = (mainPart || '').split('===SPLIT===');

      let dynoJSON = null;
      try { if (dynoPart) dynoJSON = JSON.parse(dynoPart); } catch {}

      const combined =
        (quickChecks || '').trim() +
        (aiPart ? `\n\nAI Review:\n${aiPart.trim()}` : '');
      setAiResult(combined || 'No AI assessment returned.');
      setLeftText((quickChecks || '').trim());
      setAiText((aiPart || '').trim());
      setDynoRemote(dynoJSON || null);

      setStatus('');
    } catch (err) {
      console.error(err);
      setStatus('');
      setAiResult(`❌ Error: ${err.message}`);
    }
  };

  // ---------- Charts ----------
  const speedChart = useMemo(() => {
    if (!graphs) return null;
    return {
      data: {
        datasets: [{
          label: 'Vehicle Speed (mph)',
          data: graphs.time.map((t, i) => ({ x: t, y: graphs.speed[i] })),
          borderColor: '#00ff88',
          backgroundColor: 'rgba(0,255,136,0.15)',
          borderWidth: 2, pointRadius: 0, tension: 0.25
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, parsing: false,
        scales: {
          x: { type: 'linear', min: 0, title: { display: true, text: 'Time (s)', color: '#adff2f' }, ticks: { color: '#adff2f' }, grid: { color: '#333' } },
          y: { title: { display: true, text: 'Speed (mph)', color: '#adff2f' }, ticks: { color: '#adff2f' }, grid: { color: '#333' } }
        },
        plugins: { legend: { labels: { color: '#adff2f' } } }
      }
    };
  }, [graphs]);

  // ---------- Dyno compute (prefer backend) ----------
  const dyno = useMemo(() => {
    if (dynoRemote && !dynoRemote.error && dynoRemote.hp?.length) {
      // Backend produced normalized, smoothed series
      const hp = [...dynoRemote.hp];
      const tq = dynoRemote.tq ? [...dynoRemote.tq] : null;
      let peakHP = null, peakTQ = null;
      if (hp.length) {
        let iHP = 0; for (let i=1;i<hp.length;i++) if (hp[i] > hp[iHP]) iHP = i;
        peakHP = { rpm: dynoRemote.x[iHP], value: +hp[iHP].toFixed(1) };
      }
      if (tq && tq.length) {
        let iTQ = 0; for (let i=1;i<tq.length;i++) if (tq[i] > tq[iTQ]) iTQ = i;
        peakTQ = { rpm: dynoRemote.x[iTQ], value: +tq[iTQ].toFixed(1) };
      }
      return { ...dynoRemote, hp, tq, peakHP, peakTQ };
    }

    // Local fallback (Dyno mode only; Track handled below in chart)
    if (!graphs || !graphs.rpm || !graphs.rpm.some(v => isNum(v) && v > 0)) return null;

    const time = graphs.time;
    const rpm  = graphs.rpm;
    const mph  = graphs.speed;
    const pedal = graphs.pedal || null;

    const sweep = selectRpmSweep(time, rpm, mph, pedal);
    if (!sweep) return null;
    const [i0, i1] = sweep;

    const T = time.slice(i0, i1 + 1);
    const RPM = rpm.slice(i0, i1 + 1);

    // Resample and smooth
    const { t: Tu, y: RPMu } = resampleUniform(T, RPM, 60);
    if (!RPMu.length) return null;
    const RPMs = zeroPhaseMovAvg(RPMu, 7);
    const dRPMdt = RPMs.map((_, i, arr) => {
      if (i === 0 || i === arr.length - 1) return 0;
      return (arr[i + 1] - arr[i - 1]) * (60 / 2); // RPM/s at 60Hz
    });
    const dRPMdtS = zeroPhaseMovAvg(dRPMdt, 7);

    // Ratio/tire scaling
    const tireIn = parseFloat(formData.tire || '28');
    const rear = parseFloat(formData.gear || '3.09');
    // Use auto gear if available; else manual pullGear; else assume 1.29
    const pull = autoGear && isNum(detectMeta.est) ? detectMeta.est
               : (!autoGear && pullGear ? parseFloat(pullGear) : 1.29);

    const overall = (isNum(pull) ? pull : 1.29) * (isNum(rear) ? rear : 3.09);
    const scale = Math.pow(REF_OVERALL / overall, 2) * Math.pow(REF_TIRE_IN / (isNum(tireIn) ? tireIn : 28), 2);

    const HPi = RPMs.map((r, i) => Math.max(0, K_DYNO * r * dRPMdtS[i] * scale));

    // Bin to 100 rpm and smooth for “dyno sheet” look
    const pts = [];
    for (let i = 0; i < RPMs.length; i++) if (isNum(RPMs[i]) && RPMs[i] > 0 && isNum(HPi[i])) pts.push({ x: RPMs[i], hp: HPi[i] });
    if (!pts.length) return null;
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

    let iHP = 0; for (let i=1;i<HPs.length;i++) if (HPs[i] > HPs[iHP]) iHP = i;
    let iTQ = 0; for (let i=1;i<TQ.length;i++) if (TQ[i] > TQ[iTQ]) iTQ = i;

    return {
      mode: dynoMode,
      xLabel: 'RPM',
      x: X,
      hp: HPs,
      tq: TQ,
      peakHP: HPs.length ? { rpm: X[iHP], value: +HPs[iHP].toFixed(1) } : null,
      peakTQ: TQ.length ? { rpm: X[iTQ], value: +TQ[iTQ].toFixed(1) } : null,
      pullGearUsed: isNum(pull) ? +pull.toFixed(2) : null,
      detectConf: detectMeta.conf || 0,
    };
  }, [dynoRemote, graphs, formData.tire, formData.gear, dynoMode, autoGear, pullGear, detectMeta]);

  // ---------- Track-mode instantaneous WHP chart (physics model) ----------
  const trackChart = useMemo(() => {
    if (dynoMode !== 'track' || !graphs) return null;
    const T = graphs.time;
    const MPH = graphs.speed;
    if (!T?.length || !MPH?.length) return null;

    // Use the same true-WOT window if RPM exists, else WOT segment by pedal/TPS
    let i0 = 0, i1 = T.length - 1;
    if (graphs.rpm && graphs.rpm.some(isNum)) {
      const window = selectRpmSweep(T, graphs.rpm, MPH, graphs.pedal);
      if (window) [i0, i1] = window;
    }

    const t = T.slice(i0, i1 + 1);
    const vMph = MPH.slice(i0, i1 + 1);

    // Resample uniformly for derivative stability
    const { t: Tu, y: MPHu } = resampleUniform(t, vMph, 60);
    if (!MPHu.length) return null;

    const MPH_s = zeroPhaseMovAvg(MPHu, 5);
    const V = MPH_s.map(v => v * 1.4666667); // ft/s

    const A = V.map((_, i, arr) => {
      if (i === 0 || i === arr.length - 1) return 0;
      return (arr[i + 1] - arr[i - 1]) * (60 / 2); // ft/s^2 at 60Hz
    });
    const As = zeroPhaseMovAvg(A, 5);

    const weight = parseFloat(formData.weight || '0'); // lb_f
    const mass = isNum(weight) && weight > 0 ? (weight / 32.174) : 0; // slugs
    const crr_ = isNum(crr) ? crr : 0.015;
    const cda_ = isNum(cda) ? cda : 8.5;
    const rho_ = isNum(rho) ? rho : 0.00238;

    // Power terms (ft·lbf/s)
    const P_inert = V.map((v, i) => mass * As[i] * v);
    const P_roll  = V.map(v => crr_ * weight * v);
    const P_aero  = V.map(v => 0.5 * rho_ * cda_ * v * v * v);
    const P_tot   = P_inert.map((p, i) => p + P_roll[i] + P_aero[i]);

    // Convert to hp
    const HP = P_tot.map(p => p / 550);

    // Smooth slightly for readability
    const HPs = zeroPhaseMovAvg(HP, 9);

    // Build chart data (time-domain, since RPM is optional)
    const data = {
      datasets: [{
        label: 'Track WHP (physics model)',
        data: Tu.map((tt, i) => ({ x: +(tt - Tu[0]).toFixed(2), y: HPs[i] })),
        borderColor: '#9cf', backgroundColor: 'rgba(153,204,255,0.18)',
        borderWidth: 2, pointRadius: 0, tension: 0.25
      }]
    };
    const maxHP = HPs.length ? Math.max(...HPs) : 0;
    const nice = Math.ceil(maxHP / 10) * 10;

    const options = {
      responsive: true, maintainAspectRatio: false, parsing: false,
      scales: {
        x: { type: 'linear', title: { display: true, text: 'Time (s)', color: '#adff2f' }, ticks: { color: '#adff2f' }, grid: { color: '#333' } },
        y: { title: { display: true, text: 'Horsepower', color: '#adff2f' }, ticks: { color: '#adff2f' }, grid: { color: '#333' }, min: 0, max: nice }
      },
      plugins: { legend: { labels: { color: '#adff2f' } } }
    };
    return { data, options, peakHP: HPs.length ? Math.max(...HPs) : null };
  }, [graphs, dynoMode, formData.weight, crr, cda, rho]);

  // ---------- UI computed status ----------
  const dynoSetup = (() => {
    const hasWeight = !!formData.weight && !isNaN(parseFloat(formData.weight)) && parseFloat(formData.weight) > 0;
    const hasRPM = !!(graphs && graphs.rpm && graphs.rpm.some(v => v !== null));
    return { hasWeight, hasRPM };
  })();

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>Satera Tuning — AI Log Review (BETA)</div>
        <div style={styles.headerRight}>
          <Link to="/log-comparison" style={{ ...styles.button, textDecoration:'none', lineHeight:'normal' }}>
            Log Comparison
          </Link>
        </div>
      </header>

      <div style={styles.shell}>
        <div style={isNarrow ? styles.gridNarrow : styles.grid2}>
          {/* LEFT */}
          <aside>
            <div style={styles.card}>
              <h3 style={styles.sectionTitleFancy}>Vehicle / Run Details</h3>
              <div style={{ display:'grid', gap:8 }}>
                <select name="year" value={formData.year} onChange={handleChange} style={styles.select}>
                  <option value="">Year</option>{years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <select name="model" value={formData.model} onChange={handleChange} style={styles.select}>
                  <option value="">Model</option>{models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <select name="engine" value={formData.engine} onChange={handleChange} style={styles.select}>
                  <option value="">Engine</option>{engines.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
                <select name="injectors" value={formData.injectors} onChange={handleChange} style={styles.select}>
                  <option value="">Injectors</option>{injectors.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
                <select name="map" value={formData.map} onChange={handleChange} style={styles.select}>
                  <option value="">MAP Sensor</option>{mapSensors.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <select name="throttle" value={formData.throttle} onChange={handleChange} style={styles.select}>
                  <option value="">Throttle Body</option>{throttles.map(t => <option key={t} value={t}>{t}</option>)}
                </select>

                {/* ✅ Specific transmissions to match backend */}
                <select name="trans" value={formData.trans} onChange={handleChange} style={styles.select}>
                  <option value="">Transmission</option>
                  {transmissions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>

                {/* Rear gear & tire height (affect auto-detect + scaling) */}
                <select name="gear" value={formData.gear} onChange={handleChange} style={styles.select}>
                  <option value="">Rear Gear</option>{gearRatios.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <select name="tire" value={formData.tire} onChange={handleChange} style={styles.select}>
                  <option value="">Tire Height (in)</option>{tireHeights.map(t => <option key={t} value={t}>{t}"</option>)}
                </select>

                <select name="power" value={formData.power} onChange={handleChange} style={styles.select}>
                  <option value="">Power Adder</option>{powerAdders.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <select name="fuel" value={formData.fuel} onChange={handleChange} style={styles.select}>
                  <option value="">Fuel</option>{fuels.map(f => <option key={f} value={f}>{f}</option>)}
                </select>

                {/* Mode toggle */}
                <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:6, flexWrap:'wrap' }}>
                  <button onClick={()=> setDynoMode('dyno')}
                          style={{ ...styles.ghostBtn, borderColor: dynoMode==='dyno' ? '#00ff88' : '#1e2b1e', color: dynoMode==='dyno' ? '#00ff88' : '#d9ffe0' }}>
                    Dyno
                  </button>
                  <button onClick={()=> setDynoMode('track')}
                          style={{ ...styles.ghostBtn, borderColor: dynoMode==='track' ? '#00ff88' : '#1e2b1e', color: dynoMode==='track' ? '#00ff88' : '#d9ffe0' }}>
                    Track
                  </button>
                  <span style={{ fontSize:12, opacity:.8 }}>
                    {dynoMode==='dyno' ? 'Chassis dyno model (no weight).' : 'Road-load model (uses weight + drag).'}
                  </span>
                </div>

                {/* Weight (Track only) */}
                <input
                  name="weight" type="number" min="0" step="10" placeholder="Vehicle Weight (lbs)"
                  value={formData.weight} onChange={handleChange}
                  style={{ ...styles.input, opacity: dynoMode==='track' ? 1 : 0.6 }} disabled={dynoMode !== 'track'}
                />

                {/* Advanced drag params */}
                {dynoMode === 'track' && (
                  <div style={{ marginTop:8 }}>
                    <button onClick={()=> setShowAdv(s=>!s)} style={styles.ghostBtn}>
                      {showAdv ? 'Hide' : 'Show'} Advanced (Crr, CdA, Air)
                    </button>
                    {showAdv && (
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8, marginTop:8 }}>
                        <div>
                          <div style={{ fontSize:12, opacity:.8, marginBottom:4 }}>Crr</div>
                          <input type="number" step="0.001" value={crr} onChange={e=> setCrr(parseFloat(e.target.value||'0.015'))} style={styles.input}/>
                        </div>
                        <div>
                          <div style={{ fontSize:12, opacity:.8, marginBottom:4 }}>CdA (ft²)</div>
                          <input type="number" step="0.1" value={cda} onChange={e=> setCda(parseFloat(e.target.value||'8.5'))} style={styles.input}/>
                        </div>
                        <div>
                          <div style={{ fontSize:12, opacity:.8, marginBottom:4 }}>Air Density (slug/ft³)</div>
                          <input type="number" step="0.0001" value={rho} onChange={e=> setRho(parseFloat(e.target.value||'0.00238'))} style={styles.input}/>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Auto-gear vs manual selection */}
                <div style={{ marginTop:8, display:'grid', gap:6 }}>
                  <label style={{ fontSize:13 }}>
                    <input type="checkbox" checked={autoGear} onChange={e=> setAutoGear(e.target.checked)} />
                    <span style={{ marginLeft:8 }}>Auto-detect pull gear from log</span>
                  </label>

                  {autoGear ? (
                    <div style={{ fontSize:12, opacity:.85 }}>
                      {detectMeta.est
                        ? <>Detected ≈ <b>{detectMeta.est.toFixed(2)}</b> (confidence {(detectMeta.conf*100).toFixed(0)}%)</>
                        : <>Upload log with RPM + set Tire/Rear to improve detection.</>}
                    </div>
                  ) : (
                    <div style={{ display:'grid', gap:6 }}>
                      <div style={{ fontSize:12, opacity:.85 }}>Select pull gear (ratio):</div>
                      <select value={pullGear} onChange={e=> setPullGear(e.target.value)} style={styles.select}>
                        <option value="">Choose Gear</option>
                        {catalogRatios.length
                          ? catalogRatios.map(g => <option key={g.label} value={String(g.ratio)}>{g.label} — {g.ratio}</option>)
                          : ['0.57','0.67','0.84','1.00','1.29','1.41','1.67','2.10','2.97','3.14','3.59','4.71']
                              .map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </aside>

          {/* RIGHT */}
          <main style={{ display: 'grid', gap: 16 }}>
            <div style={styles.card}>
              <h3 style={styles.sectionTitleFancy}>Upload a Datalog</h3>
              <input type="file" accept=".csv" onChange={handleFileChange} />
              <button onClick={handleSubmit} style={{ ...styles.button, marginTop: 8 }}>Analyze</button>
              {status && <div style={{ marginTop: 8 }}>{status}</div>}
            </div>

            {graphs && (
              <div style={{ ...styles.card, height: 300 }}>
                <h3 style={styles.sectionTitleFancy}>Vehicle Speed vs Time</h3>
                <Line data={speedChart.data} options={speedChart.options} />
              </div>
            )}

            {/* Setup status */}
            <div style={styles.card}>
              <h3 style={styles.sectionTitleFancy}>Simulated Dyno — Setup</h3>
              <div style={{ lineHeight: 1.6 }}>
                <div>Mode: <strong style={{ color:'#eaff9c' }}>{dynoMode === 'dyno' ? 'Dyno' : 'Track'}</strong></div>
                <div>Transmission: <strong style={{ color:'#eaff9c' }}>{formData.trans || '—'}</strong></div>
                <div>Rear gear: <strong style={{ color:'#eaff9c' }}>{formData.gear || '—'}</strong> • Tire: <strong style={{ color:'#eaff9c' }}>{formData.tire || '—'}"</strong></div>
                <div>
                  Engine RPM available:{' '}
                  <strong style={{ color: (graphs && graphs.rpm && graphs.rpm.some(v => v !== null)) ? '#74ffb0' : '#ff9a9a' }}>
                    {(graphs && graphs.rpm && graphs.rpm.some(v => v !== null)) ? 'Detected' : 'Not found'}
                  </strong>
                </div>
                <div>
                  Track weight input:{' '}
                  <strong style={{ color: dynoMode==='track' && dynoSetup.hasWeight ? '#74ffb0' : (dynoMode==='track' ? '#ffc96b' : '#74ffb0') }}>
                    {dynoMode==='track' ? (dynoSetup.hasWeight ? `${formData.weight} lbs` : 'Enter weight for accuracy') : 'N/A (Dyno mode)'}
                  </strong>
                </div>
              </div>
            </div>

            {/* Dyno chart (RPM domain) */}
            {dyno && (
              <div style={{ ...styles.card, height: 360 }}>
                <h3 style={styles.sectionTitleFancy}>Simulated Dyno Sheet</h3>
                <Line
                  data={{
                    datasets: [
                      {
                        label: 'Horsepower',
                        data: dyno.x.map((v, i) => ({ x: v, y: dyno.hp[i] })),
                        borderColor: '#74ffb0', backgroundColor: 'rgba(116,255,176,0.18)',
                        yAxisID: 'yHP', borderWidth: 2, pointRadius: 0, tension: 0.25,
                      },
                      ...(dyno.tq ? [{
                        label: 'Torque (lb-ft)',
                        data: dyno.x.map((v, i) => ({ x: v, y: dyno.tq[i] })),
                        borderColor: '#ffc96b', backgroundColor: 'rgba(255,201,107,0.18)',
                        yAxisID: 'yTQ', borderWidth: 2, pointRadius: 0, tension: 0.25,
                      }] : []),
                    ]
                  }}
                  options={(() => {
                    const maxHP = dyno.hp?.length ? Math.max(...dyno.hp) : 0;
                    const maxTQ = dyno.tq?.length ? Math.max(...dyno.tq) : 0;
                    const niceMax = Math.ceil(Math.max(maxHP, maxTQ) / 10) * 10;
                    return {
                      responsive: true, maintainAspectRatio: false, parsing: false,
                      scales: {
                        x: { type: 'linear', title: { display: true, text: 'RPM', color: '#adff2f' }, ticks: { color: '#adff2f' }, grid: { color: '#333' } },
                        yHP: { position: 'left', title: { display: true, text: 'Horsepower', color: '#adff2f' }, ticks: { color: '#adff2f' }, grid: { color: '#333' }, min: 0, max: niceMax },
                        yTQ: dyno.tq ? { position: 'right', title: { display: true, text: 'Torque (lb-ft)', color: '#adff2f' }, ticks: { color: '#adff2f' }, grid: { drawOnChartArea: false }, min: 0, max: niceMax } : undefined
                      },
                      plugins: { legend: { labels: { color: '#adff2f' } }, tooltip: { mode: 'index', intersect: false } },
                      interaction: { mode: 'index', intersect: false }
                    };
                  })()}
                />

                {/* Stats */}
                <div style={{ display:'flex', gap:16, marginTop:10, flexWrap:'wrap' }}>
                  {dyno.peakHP && (
                    <div style={{ background:'#0f130f', border:'1px solid #1e2b1e', borderRadius:8, padding:'8px 10px' }}>
                      <div style={{ fontSize:12, opacity:.85 }}>Peak HP</div>
                      <div style={{ fontWeight:700, color:'#eaff9c' }}>
                        {comma(dyno.peakHP.value)} hp @ {comma(dyno.peakHP.rpm,0)} rpm
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ fontSize:12, opacity:.75, marginTop:6 }}>
                  Pull gear used: <b>{dyno.pullGearUsed ?? '—'}</b>{' '}
                  {isNum(dyno.detectConf) ? `(auto conf ${(dyno.detectConf*100).toFixed(0)}%)` : ''}
                </div>
              </div>
            )}

            {/* Track WHP chart (time domain) */}
            {trackChart && (
              <div style={{ ...styles.card, height: 320 }}>
                <h3 style={styles.sectionTitleFancy}>Track Mode — Instantaneous WHP</h3>
                <Line data={trackChart.data} options={trackChart.options} />
                {isNum(trackChart.peakHP) && (
                  <div style={{ marginTop:8, fontSize:13 }}>
                    Peak track WHP (window): <b>{comma(trackChart.peakHP)}</b>
                  </div>
                )}
              </div>
            )}

            {/* Checklist + AI sections (unchanged display) */}
            {!!leftText && (
              <div style={styles.card}>
                <h3 style={styles.sectionTitleFancy}>Quick Checks</h3>
                <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{leftText}</pre>
              </div>
            )}
            {aiResult && (
              <div style={styles.card}>
                <h3 style={styles.sectionTitleFancy}>AI Assessment</h3>
                <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{aiResult}</pre>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
