// frontend/src/MainApp.jsx
import React, { useMemo, useState, useEffect } from 'react';
import './App.css';
import { Link } from 'react-router-dom';
import { Line } from 'react-chartjs-2';
import 'chart.js/auto';
import annotationPlugin from 'chartjs-plugin-annotation';
import { Chart } from 'chart.js';
import BoostSummary from './components/BoostSummary';

import {
  years, models, engines, injectors, mapSensors, throttles,
  powerAdders, transmissions, tireHeights, gearRatios, fuels
} from './ui/options';
import { deriveAdvice, SateraTone } from './ui/advice';

Chart.register(annotationPlugin);

const API_BASE = process.env.REACT_APP_API_BASE || '';

// ======= Tunables =======
// Fixed dyno proportionality (no user calibration). Good baseline for your 536 whp log.
const K_DYNO = 0.0001315; // HP = K_DYNO * RPM * dRPM/dt

const styles = {
  page: { backgroundColor: '#111', color: '#adff2f', minHeight: '100vh', fontFamily: 'Arial' },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, background: 'linear-gradient(to bottom, #00ff88, #007744)',
    color: '#000', fontSize: '2rem', fontWeight: 'bold',
    boxShadow: '0 4px 10px rgba(0,255,136,0.4)'
  },
  headerRight: { display: 'flex', gap: 10 },
  shell: { padding: 20 },
  grid2: { display: 'grid', gridTemplateColumns: '410px 1fr', gap: 16 },
  gridNarrow: { display: 'grid', gridTemplateColumns: '1fr', gap: 16 },
  card: { backgroundColor: '#1a1a1a', padding: 12, borderRadius: 8, border: '1px solid #2a2a2a' },
  button: { backgroundColor: '#00ff88', color: '#000', padding: '10px 16px', border: 'none', cursor: 'pointer', borderRadius: 6 },
  ghostBtn: { background:'transparent', border:'1px solid #1e2b1e', color:'#d9ffe0', padding:'8px 12px', borderRadius:8, cursor:'pointer' },
  input: {
    width: '100%', maxWidth: 360,
    background: '#0f130f', border: '1px solid #1e2b1e',
    borderRadius: 8, padding: '9px 11px', color: '#d9ffe0', outline: 'none'
  },
  select: {
    width: '100%', maxWidth: 360,
    background: '#0f130f', border: '1px solid #1e2b1e',
    borderRadius: 8, padding: '9px 11px', color: '#d9ffe0', outline: 'none',
    appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
    backgroundImage:
      'linear-gradient(45deg, transparent 50%, #28ff6a 50%), linear-gradient(135deg, #28ff6a 50%, transparent 50%), linear-gradient(to right, #1e2b1e, #1e2b1e)',
    backgroundPosition: 'calc(100% - 18px) calc(50% - 3px), calc(100% - 12px) calc(50% - 3px), calc(100% - 40px) 0',
    backgroundSize: '6px 6px, 6px 6px, 28px 100%',
    backgroundRepeat: 'no-repeat'
  },
  sidebarTitle: {
    marginTop: 0, marginBottom: 8, fontWeight: 700, fontSize: 26, letterSpacing: 0.4,
    backgroundImage: 'linear-gradient(180deg, #d6ffd9, #7dffa1 55%, #2fff6e)',
    WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'white',
    textShadow: '0 1px 0 #0c150c,0 2px 0 #0c150c,0 3px 0 #0c150c,0 0 16px rgba(61,255,118,.35),0 0 36px rgba(61,255,118,.18)',
    animation: 'st-pulseGlow 2.2s ease-in-out infinite'
  },
  fieldGrid: { display: 'grid', gap: 8, gridTemplateColumns: '1fr', marginTop: 8 },
  titleWrap: { display: 'grid', gap: 6, justifyItems: 'start', alignContent: 'center' },
  sectionTitleFancy: {
    margin: 0, fontWeight: 700, fontSize: 26, letterSpacing: 0.6, textTransform: 'uppercase',
    backgroundImage: 'linear-gradient(90deg, #caffd1, #69ff8a, #caffd1)',
    WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'white',
    textShadow: '0 1px 0 #0c150c,0 2px 0 #0c150c,0 3px 0 #0c150c,0 4px 0 #0c150c,0 0 12px rgba(52,255,120,.35),0 0 28px rgba(52,255,120,.18)',
    animation: 'st-pulseGlow 2.2s ease-in-out infinite'
  },
};

// ---------- helpers ----------
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
const comma = (n, d=1) => n.toLocaleString(undefined, { maximumFractionDigits: d });

// ---------- flexible col finder ----------
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

// --- CSV parse with WOT trimming & optional RPM/Pedal ---
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

  if (speedIndex === -1 || timeIndex === -1 || pedalIndex === -1) return null;

  const points = [];
  for (let row of dataRows) {
    if (!row.includes(',')) continue;
    const cols = row.split(',');
    const s = parseFloat(cols[speedIndex]);
    const t = parseFloat(cols[timeIndex]);
    const p = parseFloat(cols[pedalIndex]);
    const r = rpmIndex !== -1 ? parseFloat(cols[rpmIndex]) : undefined;
    if (isNum(s) && isNum(t) && isNum(p)) {
      points.push({ s, t, p, r: isNum(r) ? r : null });
    }
  }
  if (!points.length) return null;

  // WOT segments
  let segments = [];
  let current = [];
  for (let pt of points) {
    if (pt.p >= 86) current.push(pt);
    else if (current.length) { segments.push(current); current = []; }
  }
  if (current.length) segments.push(current);

  const pack = (arr) => ({
    time: arr.map(p => +p.t.toFixed(3)),
    speed: arr.map(p => +p.s.toFixed(2)),
    rpm: arr.map(p => p.r).some(v => v !== null) ? arr.map(p => p.r ?? null) : null,
    pedal: arr.map(p => p.p)
  });

  if (!segments.length) return pack(points);
  segments = segments.filter(seg => seg.length > 5);
  if (!segments.length) return pack(points);

  // choose shortest WOT window (most like a pull)
  segments.sort((a, b) => (a.at(-1).t - a[0].t) - (b.at(-1).t - b[0].t));
  const best = segments[0];

  // trim from launch
  const launchIdx = best.findIndex(p => p.p >= 86 && p.s > 0.5);
  const trimmed = launchIdx >= 0 ? best.slice(launchIdx) : best;

  const t0 = trimmed[0].t;
  const norm = trimmed.map(p => ({ ...p, t: +(p.t - t0).toFixed(3) }));
  return pack(norm);
}

// --- Single-gear sweep finder (WOT + near-monotonic rpm + near-constant rpm/mph ratio) ---
function selectRpmSweep(time, rpm, mph, pedal = null) {
  if (!rpm || !mph || rpm.length < 20 || mph.length !== rpm.length) return null;

  const PEDAL_MIN = 80;
  const MIN_MPH   = 5;
  const RATIO_TOL = 0.12;
  const RPM_DIP   = 75;
  const MIN_LEN   = 20;

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

  // coarse windows
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

  // refine by rolling median of ratio
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

  // longest window then gentle expand
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

export default function MainApp() {
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1100);
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 1100);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [formData, setFormData] = useState({
    vin: '', year: '', model: '', engine: '', injectors: '', map: '',
    throttle: '', power: '', trans: '', tire: '', gear: '', fuel: '',
    weight: '', // lbs (Track mode only)
    logFile: null,
  });

  // Mode toggle
  const [dynoMode, setDynoMode] = useState('dyno'); // default to dyno for your testing

  // Advanced parameters (Track mode only)
  const [showAdv, setShowAdv] = useState(false);
  const [crr, setCrr] = useState(0.015);
  const [cda, setCda] = useState(8.5);      // ft^2
  const [rho, setRho] = useState(0.00238);  // slug/ft^3

  const [leftText, setLeftText] = useState('');
  const [aiText, setAiText] = useState('');
  const [metrics, setMetrics] = useState(null);
  const [graphs, setGraphs] = useState(null);
  const [aiResult, setAiResult] = useState('');
  const [status, setStatus] = useState('');
  const [dynoRemote, setDynoRemote] = useState(null);

  const suggestions = useMemo(() => deriveAdvice(aiText), [aiText]);

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
        setMetrics({ zeroTo60: null, fortyTo100: null, sixtyTo130: null });
      }
    };
    reader.readAsText(file);
  };

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
      form.append('vehicle', JSON.stringify({ year: formData.year, model: formData.model }));
      form.append('mods', JSON.stringify({
        engine: formData.engine, injectors: formData.injectors, map: formData.map,
        throttle: formData.throttle, power_adder: formData.power,
        trans: formData.trans, fuel: formData.fuel, nn: 'Enabled'
      }));
      form.append('metrics', JSON.stringify(metrics || {}));
      form.append('weight', String(formData.weight || ''));
      form.append('mode', dynoMode);

      const reviewRes = await fetch(`${API_BASE}/ai-review`, {
        method: 'POST',
        body: form,
      });
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

  // -------- Speed chart (for context) --------
  const chartData = graphs ? {
    datasets: [{
      label: 'Vehicle Speed (mph)',
      data: graphs.time.map((t, i) => ({ x: t, y: graphs.speed[i] })),
      borderColor: '#00ff88',
      backgroundColor: 'rgba(0,255,136,0.15)',
      borderWidth: 2, pointRadius: 0, tension: 0.2
    }]
  } : null;

  const chartOptions = {
    responsive: true, maintainAspectRatio: false, parsing: false,
    scales: {
      x: { type: 'linear', min: 0, title: { display: true, text: 'Time (s)', color: '#adff2f' }, ticks: { color: '#adff2f' }, grid: { color: '#333' } },
      y: { title: { display: true, text: 'Speed (mph)', color: '#adff2f' }, ticks: { color: '#adff2f' }, grid: { color: '#333' } }
    },
    plugins: { legend: { labels: { color: '#adff2f' } } }
  };

  // -------- Dyno (prefer backend; else local compute) --------
  const dyno = useMemo(() => {
    // Prefer backend precomputed arrays if present
    if (dynoRemote && !dynoRemote.error && dynoRemote.hp?.length) {
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
      return { ...dynoRemote, hp, tq, peakHP, peakTQ, usedRPM: true, mode: dynoMode };
    }

    // Local compute needs RPM
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
    const MPH = mph.slice(i0, i1 + 1);

    // Smooth RPM a touch to reduce noise in derivative
    const RPMs = movAvg(RPM, 7);

    // Centered derivative of RPM (rev/min per second)
    const dRPMdt = RPMs.map((_, i) => {
      const a = Math.max(0, i - 1);
      const b = Math.min(RPMs.length - 1, i + 1);
      const dv = RPMs[b] - RPMs[a];
      const dt = T[b] - T[a];
      return dt > 0 ? dv / dt : 0;
    });
    const dRPMdtS = movAvg(dRPMdt, 7);

    let HP;
    if (dynoMode === 'dyno') {
      // === New dyno model: HP = K_DYNO * RPM * dRPM/dt (no weight) ===
      HP = RPMs.map((r, i) => Math.max(0, K_DYNO * r * dRPMdtS[i]));
    } else {
      // Track model: road-load (weight + rolling + aero)
      const MPH_TO_FTPS = 1.4666667;
      const HP_DEN = 550;
      const G = 32.174;
      const V = MPH.map(v => v * MPH_TO_FTPS);
      const Vs = movAvg(V, 5);
      const A = Vs.map((_, i) => {
        const a = Math.max(0, i - 1);
        const b = Math.min(Vs.length - 1, i + 1);
        const dv = Vs[b] - Vs[a];
        const dt = T[b] - T[a];
        return dt > 0 ? dv / dt : 0;
      });
      const As = movAvg(A, 5);

      const weight = parseFloat(formData.weight || '0');
      const mass = isNum(weight) && weight > 0 ? (weight / G) : 0;
      const P_inert = Vs.map((v, i) => mass * As[i] * v);
      const P_roll  = Vs.map(v => (crr * weight * v));
      const P_aero  = Vs.map(v => (0.5 * rho * cda * v * v * v));
      const P_tot   = P_inert.map((p, i) => p + P_roll[i] + P_aero[i]);
      HP = P_tot.map(p => p / HP_DEN);
    }

    // Build RPM vs HP curve (bin by 50 rpm, smooth)
    const pts = [];
    for (let i = 0; i < RPMs.length; i++) if (isNum(RPMs[i]) && RPMs[i] > 0 && isNum(HP[i])) pts.push({ x: RPMs[i], hp: HP[i] });
    if (!pts.length) return null;
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

    const X  = series.map(p => p.x);
    const HPs = movAvg(series.map(p => p.hp), 5);
    const TQ  = X.map((r, i) => (r > 0 ? (HPs[i] * 5252) / r : null));

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
      hasWeight: dynoMode === 'track' ? (isNum(parseFloat(formData.weight)) && parseFloat(formData.weight) > 0) : false,
      mode: dynoMode
    };
  }, [dynoRemote, graphs, formData.weight, dynoMode, crr, cda, rho]);

  // -------- Dyno chart (equal Y scales for HP & TQ) --------
  const dynoChartData = useMemo(() => {
    if (!dyno) return null;

    const datasets = [{
      label: 'Horsepower',
      data: dyno.x.map((v, i) => ({ x: v, y: dyno.hp[i] })),
      borderColor: '#74ffb0',
      backgroundColor: 'rgba(116,255,176,0.18)',
      yAxisID: 'yHP',
      borderWidth: 2, pointRadius: 0, tension: 0.25,
    }];

    if (dyno.tq) {
      datasets.push({
        label: 'Torque (lb-ft)',
        data: dyno.x.map((v, i) => ({ x: v, y: dyno.tq[i] })),
        borderColor: '#ffc96b',
        backgroundColor: 'rgba(255,201,107,0.18)',
        yAxisID: 'yTQ',
        borderWidth: 2, pointRadius: 0, tension: 0.25,
      });
    }

    // Peak markers
    if (dyno.peakHP) {
      datasets.push({
        label: 'Peak HP',
        data: [{ x: dyno.peakHP.rpm, y: dyno.peakHP.value }],
        yAxisID: 'yHP',
        borderColor: '#74ffb0',
        backgroundColor: '#74ffb0',
        pointRadius: 4, showLine: false,
      });
    }
    if (dyno.peakTQ) {
      datasets.push({
        label: 'Peak TQ',
        data: [{ x: dyno.peakTQ.rpm, y: dyno.peakTQ.value }],
        yAxisID: 'yTQ',
        borderColor: '#ffc96b',
        backgroundColor: '#ffc96b',
        pointRadius: 4, showLine: false,
      });
    }

    return { datasets };
  }, [dyno]);

  const dynoChartOptions = useMemo(() => {
    if (!dyno) return null;

    const maxHP = dyno.hp?.length ? Math.max(...dyno.hp) : 0;
    const maxTQ = dyno.tq?.length ? Math.max(...dyno.tq) : 0;
    const maxY  = Math.max(maxHP, maxTQ);
    const niceMax = Math.ceil(maxY / 10) * 10;

    return {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'RPM', color: '#adff2f' },
          ticks: { color: '#adff2f' },
          grid: { color: '#333' }
        },
        yHP: {
          position: 'left',
          title: { display: true, text: 'Horsepower', color: '#adff2f' },
          ticks: { color: '#adff2f' },
          grid: { color: '#333' },
          min: 0,
          max: niceMax
        },
        yTQ: dyno.tq ? {
          position: 'right',
          title: { display: true, text: 'Torque (lb-ft)', color: '#adff2f' },
          ticks: { color: '#adff2f' },
          grid: { drawOnChartArea: false },
          min: 0,
          max: niceMax
        } : undefined
      },
      plugins: {
        legend: { labels: { color: '#adff2f' } },
        tooltip: { mode: 'index', intersect: false }
      },
      interaction: { mode: 'index', intersect: false }
    };
  }, [dyno]);

  // --- Dyno setup status
  const dynoSetup = (() => {
    const hasWeight = !!formData.weight && !isNaN(parseFloat(formData.weight)) && parseFloat(formData.weight) > 0;
    const hasRPM = !!(
      (dyno && dyno.usedRPM) ||
      (graphs && graphs.rpm && graphs.rpm.some(v => v !== null))
    );
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
          {/* LEFT: Vehicle form */}
          <aside>
            <div style={styles.card}>
              <h3 style={styles.sidebarTitle}>Vehicle / Run Details</h3>
              <div style={styles.fieldGrid}>
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
                <select name="power" value={formData.power} onChange={handleChange} style={styles.select}>
                  <option value="">Power Adder</option>{powerAdders.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <select name="trans" value={formData.trans} onChange={handleChange} style={styles.select}>
                  <option value="">Transmission</option>{transmissions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <select name="tire" value={formData.tire} onChange={handleChange} style={styles.select}>
                  <option value="">Tire Height</option>{tireHeights.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <select name="gear" value={formData.gear} onChange={handleChange} style={styles.select}>
                  <option value="">Rear Gear</option>{gearRatios.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <select name="fuel" value={formData.fuel} onChange={handleChange} style={styles.select}>
                  <option value="">Fuel</option>{fuels.map(f => <option key={f} value={f}>{f}</option>)}
                </select>

                {/* Mode toggle */}
                <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:10, flexWrap:'wrap' }}>
                  <button
                    onClick={()=> setDynoMode('dyno')}
                    style={{ ...styles.ghostBtn, borderColor: dynoMode==='dyno' ? '#00ff88' : '#1e2b1e', color: dynoMode==='dyno' ? '#00ff88' : '#d9ffe0' }}
                  >Dyno</button>
                  <button
                    onClick={()=> setDynoMode('track')}
                    style={{ ...styles.ghostBtn, borderColor: dynoMode==='track' ? '#00ff88' : '#1e2b1e', color: dynoMode==='track' ? '#00ff88' : '#d9ffe0' }}
                  >Track</button>
                  <span style={{ fontSize:12, opacity:.8 }}>
                    {dynoMode==='dyno'
                      ? 'Chassis dyno model (no weight).'
                      : 'Road-load model (uses weight + drag).'}
                  </span>
                </div>

                {/* Weight (Track mode only) */}
                <input
                  name="weight"
                  type="number"
                  min="0"
                  step="10"
                  placeholder="Vehicle Weight (lbs)"
                  value={formData.weight}
                  onChange={handleChange}
                  style={{ ...styles.input, marginTop:8, opacity: dynoMode==='track' ? 1 : 0.6 }}
                  disabled={dynoMode !== 'track'}
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
                <div style={styles.titleWrap}>
                  <h3 style={styles.sectionTitleFancy}>📈 Vehicle Speed vs Time</h3>
                </div>
                <Line data={chartData} options={chartOptions} />
              </div>
            )}

            {/* Setup status */}
            <div style={styles.card}>
              <h3 style={styles.sectionTitleFancy}>🏁 Simulated Dyno (setup)</h3>
              <div style={{ lineHeight: 1.6 }}>
                <div>Mode: <strong style={{ color:'#eaff9c' }}>{dynoMode === 'dyno' ? 'Dyno' : 'Track'}</strong></div>
                <div>
                  Weight considered:{' '}
                  <strong style={{ color: dynoMode==='track' && dynoSetup.hasWeight ? '#74ffb0' : (dynoMode==='track' ? '#ffc96b' : '#74ffb0') }}>
                    {dynoMode==='track' ? (dynoSetup.hasWeight ? `${formData.weight} lbs` : 'No (enter weight)') : 'No (Dyno mode)'}
                  </strong>
                </div>
                <div>
                  Engine RPM available:{' '}
                  <strong style={{ color: dynoSetup.hasRPM ? '#74ffb0' : '#ff9a9a' }}>
                    {dynoSetup.hasRPM ? 'Detected' : 'Not found (dyno hidden)'}
                  </strong>
                </div>
              </div>
            </div>

            {/* Dyno chart */}
            {dyno && (
              <div style={{ ...styles.card, height: 360 }}>
                <div style={styles.titleWrap}>
                  <h3 style={styles.sectionTitleFancy}>🧪 Simulated Dyno Sheet</h3>
                </div>
                <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>
                  HP (left) / TQ (right) vs RPM — single-gear WOT • Mode: <b>{dynoMode}</b>
                </div>
                <Line data={{
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
                    ...(dyno.peakHP ? [{
                      label: 'Peak HP',
                      data: [{ x: dyno.peakHP.rpm, y: dyno.peakHP.value }],
                      yAxisID: 'yHP', borderColor: '#74ffb0', backgroundColor: '#74ffb0',
                      pointRadius: 4, showLine: false,
                    }] : []),
                    ...(dyno.peakTQ ? [{
                      label: 'Peak TQ',
                      data: [{ x: dyno.peakTQ.rpm, y: dyno.peakTQ.value }],
                      yAxisID: 'yTQ', borderColor: '#ffc96b', backgroundColor: '#ffc96b',
                      pointRadius: 4, showLine: false,
                    }] : []),
                  ]
                }} options={(() => {
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
                })()} />

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
                  {dyno.peakTQ && (
                    <div style={{ background:'#0f130f', border:'1px solid #1e2b1e', borderRadius:8, padding:'8px 10px' }}>
                      <div style={{ fontSize:12, opacity:.85 }}>Peak TQ</div>
                      <div style={{ fontWeight:700, color:'#eaff9c' }}>
                        {comma(dyno.peakTQ.value)} lb-ft @ {comma(dyno.peakTQ.rpm,0)} rpm
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {!!leftText && (
              <div style={styles.card}>
                <BoostSummary checklistText={leftText} />
              </div>
            )}

            {aiResult && (
              <div style={styles.card}>
                <h3 style={styles.sectionTitleFancy}>🧠 AI Assessment</h3>
                <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{aiResult}</pre>
              </div>
            )}

            {aiResult && (
              <div style={styles.card}>
                <h3 style={styles.sectionTitleFancy}>🔍 AI Suggestions</h3>
                {deriveAdvice(aiText).map(s => (
                  <div key={s.id} style={{ marginTop: 12 }}>
                    {SateraTone.showSeverityBadges && (
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 999,
                        fontSize: 12, marginRight: 8,
                        background: s.severity === 'high' ? '#ff9a9a' : s.severity === 'med' ? '#ffc96b' : '#74ffb0',
                        color: '#111'
                      }}>
                        {s.severity === 'high' ? 'High Priority' : s.severity === 'med' ? 'Medium' : 'Info'}
                      </span>
                    )}
                    <strong style={{ marginLeft: 4, color: '#eaff9c' }}>{s.label}</strong>
                    <ul>{s.bullets.map((t, i) => <li key={i}>{t}</li>)}</ul>
                  </div>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
