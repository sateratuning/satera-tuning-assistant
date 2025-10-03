// frontend/src/MainApp.jsx
import React, { useMemo, useState, useEffect } from 'react';
import './App.css';
import { Link } from 'react-router-dom';
import { Line } from 'react-chartjs-2';
import 'chart.js/auto';
import annotationPlugin from 'chartjs-plugin-annotation';
import { Chart } from 'chart.js';

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

// --- CSV parser ---
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
  if (speedIndex === -1 || timeIndex === -1) return null;

  const speed = [], time = [];
  for (let row of dataRows) {
    if (!row.includes(',')) continue;
    const cols = row.split(',');
    const s = parseFloat(cols[speedIndex]);
    const t = parseFloat(cols[timeIndex]);
    if (Number.isFinite(s) && Number.isFinite(t)) {
      speed.push(s); time.push(t);
    }
  }
  return (speed.length && time.length) ? { speed, time } : null;
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
    throttle: '', power: '', trans: '', tire: '', gear: '', fuel: '', logFile: null,
  });
  const [metrics, setMetrics] = useState(null);
  const [graphs, setGraphs] = useState(null);
  const [aiResult, setAiResult] = useState('');
  const [status, setStatus] = useState('');
  const suggestions = useMemo(() => deriveAdvice(aiResult), [aiResult]);

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

    try {
      const reviewRes = await fetch(`${API_BASE}/ai-review-json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle: { year: formData.year, model: formData.model },
          mods: {
            engine: formData.engine, injectors: formData.injectors, map: formData.map,
            throttle: formData.throttle, power_adder: formData.power,
            trans: formData.trans, fuel: formData.fuel, nn: 'Enabled'
          },
          metrics: metrics || {}
        }),
      });
      if (!reviewRes.ok) throw new Error(`AI review failed: ${reviewRes.status}`);

      const reviewJson = await reviewRes.json();
      setAiResult(reviewJson.assessment || 'No AI assessment returned.');
      setStatus('');
    } catch (err) {
      console.error(err);
      setStatus('');
      setAiResult(`❌ Error: ${err.message}`);
    }
  };

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
      x: { type: 'linear', title: { display: true, text: 'Time (s)', color: '#adff2f' }, ticks: { color: '#adff2f' }, grid: { color: '#333' } },
      y: { title: { display: true, text: 'Speed (mph)', color: '#adff2f' }, ticks: { color: '#adff2f' }, grid: { color: '#333' } }
    },
    plugins: { legend: { labels: { color: '#adff2f' } } }
  };

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>Satera Tuning — AI Log Review (BETA)</div>
        <div style={styles.headerRight}>
          <Link to="/log-comparison" style={{ ...styles.button, textDecoration: 'none', lineHeight: 'normal' }}>
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
              </div>
            </div>
          </aside>

          {/* RIGHT: Upload + Graph + AI Results */}
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
