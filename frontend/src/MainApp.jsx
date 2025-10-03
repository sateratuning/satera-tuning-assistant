// frontend/src/MainApp.jsx
import React, { useMemo, useState, useEffect } from 'react';
import './App.css';
import { Link } from 'react-router-dom';
import { Line } from 'react-chartjs-2';
import 'chart.js/auto';

import {
  years, models, engines, injectors, mapSensors, throttles,
  powerAdders, transmissions, tireHeights, gearRatios, fuels
} from './ui/options';
import { deriveAdvice, SateraTone } from './ui/advice';

const API_BASE = process.env.REACT_APP_API_BASE || '';

const styles = {
  page: { backgroundColor: '#111', color: '#adff2f', minHeight: '100vh', fontFamily: 'Arial' },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, background: 'linear-gradient(to bottom, #00ff88, #007744)',
    color: '#000', fontSize: '2rem', fontWeight: 'bold',
    boxShadow: '0 4px 10px rgba(0,255,136,0.4)'
  },
  shell: { padding: 20 },
  grid2: { display: 'grid', gridTemplateColumns: '410px 1fr', gap: 16 },
  gridNarrow: { display: 'grid', gridTemplateColumns: '1fr', gap: 16 },
  card: { backgroundColor: '#1a1a1a', padding: 12, borderRadius: 8, border: '1px solid #2a2a2a' },
  button: { backgroundColor: '#00ff88', color: '#000', padding: '10px 16px', border: 'none', cursor: 'pointer', borderRadius: 6 },
  controlCard: { background: '#1a1a1a', padding: 18, borderRadius: 10, border: '1px solid #2a2a2a' },
  controlTitle: { fontSize: 32, fontWeight: 800, margin: 0, color: '#ffffff', textShadow: '0 0 6px rgba(173,255,47,0.25)', textAlign: 'center' },
  controlHelp: { marginTop: 6, fontSize: 14, color: '#4fff5b', opacity: 0.9, textAlign: 'center' },
  input: {
    width: '100%', maxWidth: 360, background: '#0f130f', border: '1px solid #1e2b1e',
    borderRadius: 8, padding: '9px 11px', color: '#d9ffe0', outline: 'none'
  },
  select: {
    width: '100%', maxWidth: 360, background: '#0f130f', border: '1px solid #1e2b1e',
    borderRadius: 8, padding: '9px 11px', color: '#d9ffe0', outline: 'none',
    appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
    backgroundImage:
      'linear-gradient(45deg, transparent 50%, #28ff6a 50%), linear-gradient(135deg, #28ff6a 50%, transparent 50%), linear-gradient(to right, #1e2b1e, #1e2b1e)',
    backgroundPosition: 'calc(100% - 18px) calc(50% - 3px), calc(100% - 12px) calc(50% - 3px), calc(100% - 40px) 0',
    backgroundSize: '6px 6px, 6px 6px, 28px 100%', backgroundRepeat: 'no-repeat'
  },
  sidebarTitle: {
    marginTop: 0, marginBottom: 8, fontWeight: 700, fontSize: 26, letterSpacing: 0.4,
    backgroundImage: 'linear-gradient(180deg, #d6ffd9, #7dffa1 55%, #2fff6e)',
    WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'white',
    textShadow: '0 1px 0 #0c150c, 0 2px 0 #0c150c, 0 3px 0 #0c150c, 0 0 16px rgba(61,255,118,.35), 0 0 36px rgba(61,255,118,.18)',
    animation: 'st-pulseGlow 2.2s ease-in-out infinite'
  },
  titleWrap: { display: 'grid', gap: 6, justifyItems: 'start', alignContent: 'center' },
  sectionTitleFancy: {
    margin: 0, fontWeight: 700, fontSize: 26, letterSpacing: 0.6, textTransform: 'uppercase',
    backgroundImage: 'linear-gradient(90deg, #caffd1, #69ff8a, #caffd1)',
    WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'white',
    textShadow: '0 1px 0 #0c150c, 0 2px 0 #0c150c, 0 3px 0 #0c150c, 0 4px 0 #0c150c, 0 0 12px rgba(52,255,120,.35), 0 0 28px rgba(52,255,120,.18)',
    animation: 'st-pulseGlow 2.2s ease-in-out infinite'
  },
  fieldGrid: { display: 'grid', gap: 8, gridTemplateColumns: '1fr', marginTop: 8 },
  badge: (variant) => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 999,
    fontSize: 12, marginRight: 8,
    background: variant === 'high' ? '#ff9a9a' : variant === 'med' ? '#ffc96b' : '#74ffb0',
    color: '#111', border: '1px solid #00000055'
  }),
  list: { margin: '8px 0 0 0', paddingLeft: 18, lineHeight: 1.5, color: '#d9ffe0' }
};

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
    setFormData((p) => ({ ...p, logFile: e.target.files?.[0] || null }));
  };

  const handleSubmit = async () => {
    if (!formData.logFile) {
      alert('Please upload a CSV log first.');
      return;
    }
    setStatus('Analyzing...');
    setAiResult('');
    setMetrics(null);
    setGraphs(null);

    try {
      // Step 1: parse log → metrics + graphs
      const fd = new FormData();
      fd.append('log', formData.logFile);
      const logRes = await fetch(`${API_BASE}/review-log`, { method: 'POST', body: fd });
      if (!logRes.ok) throw new Error('Log parsing failed');
      const logJson = await logRes.json();
      if (!logJson.ok) throw new Error('No metrics returned');
      setMetrics(logJson.metrics);
      setGraphs(logJson.graphs || null);

      // Step 2: send vehicle/mods + metrics to AI
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
          metrics: logJson.metrics
        }),
      });
      if (!reviewRes.ok) throw new Error('AI review failed');
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
    labels: graphs.time,
    datasets: [
      {
        label: 'Vehicle Speed (mph)',
        data: graphs.time.map((t, i) => ({ x: t, y: graphs.speed[i] })),
        borderColor: '#00ff88',
        backgroundColor: 'rgba(0,255,136,0.15)',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.2
      }
    ]
  } : null;

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { title: { display: true, text: 'Time (s)', color: '#adff2f' }, ticks: { color: '#adff2f' }, grid: { color: '#333' } },
      y: { title: { display: true, text: 'Speed (mph)', color: '#adff2f' }, ticks: { color: '#adff2f' }, grid: { color: '#333' } }
    },
    plugins: { legend: { labels: { color: '#adff2f' } } }
  };

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>Satera Tuning — AI Log Review (BETA)</div>
        <div style={{ display:'flex', gap:10 }}>
          <Link to="/log-comparison" style={{ ...styles.button, textDecoration:'none', lineHeight:'normal' }}>
            Log Comparison
          </Link>
        </div>
      </header>

      <div style={styles.shell}>
        <div style={isNarrow ? styles.gridNarrow : styles.grid2}>
          {/* LEFT: Vehicle / Run Details */}
          <aside>{/* ... unchanged form ... */}</aside>

          {/* CENTER: Upload + AI Diagnostic + Suggestions */}
          <main style={{ display: 'grid', gap: 16 }}>
            {/* Upload Card */}
            {/* ... unchanged upload card ... */}

            {/* Graph */}
            {graphs && (
              <div style={{ ...styles.card, height: 300 }}>
                <div style={styles.titleWrap}>
                  <h3 style={styles.sectionTitleFancy}>📈 Vehicle Speed vs Time</h3>
                </div>
                <Line data={chartData} options={chartOptions} />
              </div>
            )}

            {/* Parsed Metrics */}
            {metrics && (
              <div style={styles.card}>
                <div style={styles.titleWrap}>
                  <h3 style={styles.sectionTitleFancy}>📊 Parsed Metrics</h3>
                </div>
                <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', lineHeight: 1.4, background: '#0b0f0b', border: '1px solid #142014', borderRadius: 8, padding: 12, color: '#d9ffe0' }}>
                  {JSON.stringify(metrics, null, 2)}
                </pre>
              </div>
            )}

            {/* AI Assessment */}
            {aiResult && (
              <div style={styles.card}>
                <div style={styles.titleWrap}>
                  <h3 style={styles.sectionTitleFancy}>🧠 AI Assessment</h3>
                </div>
                <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', lineHeight: 1.4, background: '#0b0f0b', border: '1px solid #142014', borderRadius: 8, padding: 12, color: '#d9ffe0' }}>
                  {aiResult}
                </pre>
              </div>
            )}

            {/* AI Suggestions */}
            {/* ... unchanged suggestions card ... */}
          </main>
        </div>
      </div>
    </div>
  );
}
