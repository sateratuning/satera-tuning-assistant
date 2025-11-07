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

// --- CSV parser with WOT trimming (captures optional Engine RPM & Pedal) ---
function parseCSV(raw) {
  const rows = raw.split(/\r?\n/).map(r => r.trim());
  if (!rows.length) return null;

  const headerRowIndex = rows.findIndex(r => r.toLowerCase().startsWith('offset'));
  if (headerRowIndex === -1) return null;

  const headers = rows[headerRowIndex].split(',').map(h => h.trim());
  const dataStart = headerRowIndex + 4;
  const dataRows = rows.slice(dataStart);

  const col = (name) => headers.findIndex(h => h === name);
  const speedIndex = col('Vehicle Speed (SAE)');
  const timeIndex = col('Offset');
  const pedalIndex = col('Accelerator Position D (SAE)');
  const rpmIndex = col('Engine RPM'); // optional

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

  // Detect WOT segments
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

  // choose the shortest WOT segment (typical single pass)
  segments.sort((a, b) => (a.at(-1).t - a[0].t) - (b.at(-1).t - b[0].t));
  const best = segments[0];

  // Trim to launch (moving + WOT)
  const launchIdx = best.findIndex(p => p.p >= 86 && p.s > 0.5);
  const trimmed = launchIdx >= 0 ? best.slice(launchIdx) : best;

  const t0 = trimmed[0].t;
  const norm = trimmed.map(p => ({ ...p, t: +(p.t - t0).toFixed(3) }));
  return pack(norm);
}

// --- Single-gear sweep finder: longest monotonic RPM region under WOT if available ---
function selectRpmSweep(time, rpm, pedal = null) {
  if (!rpm || rpm.length < 5) return null;

  const isWOT = (i) => {
    if (!pedal || pedal.length !== rpm.length) return true;
    const v = pedal[i];
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

  // choose the longest segment
  segments.sort((a, b) => (b[1]-b[0]) - (a[1]-a[0]));
  return segments[0]; // [i0, i1]
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
    weight: '',      // used for HP calc
    logFile: null,
  });

  const [leftText, setLeftText] = useState('');
  const [aiText, setAiText] = useState('');

  const [metrics, setMetrics] = useState(null);
  const [graphs, setGraphs] = useState(null);       // local parse
  const [aiResult, setAiResult] = useState('');
  const [status, setStatus] = useState('');

  // Prefer backend dyno
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
      form.append('weight', String(formData.weight || '')); // harmless if backend ignores

      const reviewRes = await fetch(`${API_BASE}/ai-review`, {
        method: 'POST',
        body: form,
      });
      if (!reviewRes.ok) throw new Error(`AI review failed: ${reviewRes.status}`);

      const text = await reviewRes.text();

      // Split out DYNO section if present
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

  // -------- Base speed chart (client-side parsed) --------
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

  // -------- Dyno (prefer backend; fallback with correct physics) --------
  const dyno = useMemo(() => {
    // If backend sent a dyno payload and it's not an error, use it.
    if (dynoRemote && !dynoRemote.error) return dynoRemote;

    // If backend reported error or we have no local RPM, don't show dyno.
    if ((dynoRemote && dynoRemote.error) || !graphs || !graphs.rpm || !graphs.rpm.some(v => isNum(v) && v > 0)) {
      return null;
    }

    // Build a single-gear sweep from local arrays
    const time = graphs.time;
    const rpm = graphs.rpm;
    const mph = graphs.speed;
    const pedal = graphs.pedal || null;

    const sweep = selectRpmSweep(time, rpm, pedal);
    if (!sweep) return null;
    const [i0, i1] = sweep;

    const T = time.slice(i0, i1 + 1);
    const RPM = rpm.slice(i0, i1 + 1);
    const MPH = mph.slice(i0, i1 + 1);

    // Physics-correct power:
    // Convert mph -> ft/s and compute accel in ft/s^2
    const MPH_TO_FTPS = 1.4666667;
    const G = 32.174; // ft/s^2
    const HP_DEN = 550; // ft·lbf/s per HP

    const V = MPH.map(v => v * MPH_TO_FTPS);
    const A = V.map((_, i) => {
      const a = Math.max(0, i - 1);
      const b = Math.min(V.length - 1, i + 1);
      const dv = V[b] - V[a];
      const dt = T[b] - T[a];
      return dt > 0 ? dv / dt : 0;
    });

    const Vsm = movAvg(V, 5);
    const Asm = movAvg(A, 5);

    const weight = parseFloat(formData.weight || '0'); // lbs
    const hasWeight = isNum(weight) && weight > 0;
    const mass = hasWeight ? (weight / G) : null; // slugs

    // Power(ft·lbf/s) = mass * a * v  -> HP = / 550
    let P = Vsm.map((v, i) => {
      const base = Asm[i] * v;
      return mass ? Math.max(0, mass * base) : Math.max(0, base);
    });
    let HP = P.map(p => mass ? (p / HP_DEN) : p);

    // If weight missing, normalize to relative scale (peak = 100)
    if (!mass) {
      const peak = Math.max(...HP, 1e-6);
      HP = HP.map(v => 100 * v / peak);
    }

    // Bin by ~50 rpm for a clean curve and compute torque: TQ = HP * 5252 / RPM
    const pts = [];
    for (let i = 0; i < RPM.length; i++) if (isNum(RPM[i]) && RPM[i] > 0 && isNum(HP[i])) pts.push({ x: RPM[i], hp: HP[i] });
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
      hasWeight
    };
  }, [dynoRemote, graphs, formData.weight]);

  // -------- Dyno chart config --------
  const dynoChartData = useMemo(() => {
    if (!dyno) return null;

    const datasets = [];
    datasets.push({
      label: 'Horsepower',
      data: dyno.x.map((v, i) => ({ x: v, y: dyno.hp[i] })),
      borderColor: '#74ffb0',
      backgroundColor: 'rgba(116,255,176,0.18)',
      yAxisID: 'yHP',
      borderWidth: 2, pointRadius: 0, tension: 0.25,
    });

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
          grid: { color: '#333' }
        },
        yTQ: dyno.tq ? {
          position: 'right',
          title: { display: true, text: 'Torque (lb-ft)', color: '#adff2f' },
          ticks: { color: '#adff2f' },
          grid: { drawOnChartArea: false }
        } : undefined
      },
      plugins: {
        legend: { labels: { color: '#adff2f' } },
        tooltip: { mode: 'index', intersect: false }
      },
      interaction: { mode: 'index', intersect: false }
    };
  }, [dyno]);

  // --- Dyno setup status card ---
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

                {/* Vehicle Weight input (lbs) */}
                <input
                  name="weight"
                  type="number"
                  min="0"
                  step="10"
                  placeholder="Vehicle Weight (lbs)"
                  value={formData.weight}
                  onChange={handleChange}
                  style={styles.input}
                />
              </div>
            </div>
          </aside>

          {/* RIGHT: Upload + Graphs + AI Results */}
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

            {/* Simulated Dyno setup status */}
            <div style={styles.card}>
              <h3 style={styles.sectionTitleFancy}>🏁 Simulated Dyno (setup)</h3>
              <div style={{ lineHeight: 1.6 }}>
                <div>
                  Weight provided:{' '}
                  <strong style={{ color: dynoSetup.hasWeight ? '#74ffb0' : '#ff9a9a' }}>
                    {dynoSetup.hasWeight ? `${formData.weight} lbs` : 'No'}
                  </strong>
                </div>
                <div>
                  Engine RPM available:{' '}
                  <strong style={{ color: dynoSetup.hasRPM ? '#74ffb0' : '#ffc96b' }}>
                    {dynoSetup.hasRPM ? 'Detected' : 'Not found (dyno hidden)'}
                  </strong>
                </div>
              </div>
            </div>

            {/* Dyno chart (requires RPM) */}
            {dyno && dynoChartData && dynoChartOptions && (
              <div style={{ ...styles.card, height: 340 }}>
                <div style={styles.titleWrap}>
                  <h3 style={styles.sectionTitleFancy}>🧪 Simulated Dyno Sheet</h3>
                </div>
                <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>
                  HP (left) / TQ (right) vs RPM — single-gear sweep (smoothed)
                </div>
                <Line data={dynoChartData} options={dynoChartOptions} />

                <div style={{ display:'flex', gap:16, marginTop:10, flexWrap:'wrap' }}>
                  {dyno.peakHP && (
                    <div style={{ background:'#0f130f', border:'1px solid #1e2b1e', borderRadius:8, padding:'8px 10px' }}>
                      <div style={{ fontSize:12, opacity:.85 }}>Peak HP</div>
                      <div style={{ fontWeight:700, color:'#eaff9c' }}>
                        {dyno.peakHP.value} hp @ {Math.round(dyno.peakHP.rpm)} rpm
                      </div>
                    </div>
                  )}
                  {dyno.peakTQ && (
                    <div style={{ background:'#0f130f', border:'1px solid #1e2b1e', borderRadius:8, padding:'8px 10px' }}>
                      <div style={{ fontSize:12, opacity:.85 }}>Peak TQ</div>
                      <div style={{ fontWeight:700, color:'#eaff9c' }}>
                        {dyno.peakTQ.value} lb-ft @ {Math.round(dyno.peakTQ.rpm)} rpm
                      </div>
                    </div>
                  )}
                  {!dyno.peakTQ && (
                    <div style={{ opacity:.85 }}>Torque curve could not be computed.</div>
                  )}
                </div>

                {dyno.hasWeight === false && (
                  <div style={{ marginTop:8, fontSize:12, opacity:.8 }}>
                    Tip: enter vehicle weight (lbs) for **absolute** HP. Without weight, the curve is normalized (peak=100).
                  </div>
                )}
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
                {suggestions.map(s => (
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
                {!suggestions.length && <div style={{ opacity: .9, marginTop: 8 }}>No additional suggestions.</div>}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
