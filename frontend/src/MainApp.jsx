// frontend/src/MainApp.jsx
import React, { useMemo, useState, useEffect } from 'react';
import './App.css';
import { Link } from 'react-router-dom';
import { Line } from 'react-chartjs-2';
import 'chart.js/auto';
import annotationPlugin from 'chartjs-plugin-annotation';

import {
  years, models, engines, injectors, mapSensors, throttles,
  powerAdders, transmissions, tireHeights, gearRatios, fuels
} from './ui/options';
import { deriveAdvice, SateraTone } from './ui/advice';

const API_BASE = process.env.REACT_APP_API_BASE || '';
// Register annotation plugin
import { Chart } from 'chart.js';
Chart.register(annotationPlugin);

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
  titleWrap: { display: 'grid', gap: 6, justifyItems: 'start', alignContent: 'center' },
  sectionTitleFancy: {
    margin: 0, fontWeight: 700, fontSize: 26, letterSpacing: 0.6, textTransform: 'uppercase',
    backgroundImage: 'linear-gradient(90deg, #caffd1, #69ff8a, #caffd1)',
    WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'white',
    textShadow: '0 1px 0 #0c150c, 0 2px 0 #0c150c, 0 3px 0 #0c150c, 0 4px 0 #0c150c, 0 0 12px rgba(52,255,120,.35), 0 0 28px rgba(52,255,120,.18)',
    animation: 'st-pulseGlow 2.2s ease-in-out infinite'
  },
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
      const fd = new FormData();
      fd.append('log', formData.logFile);
      const logRes = await fetch(`${API_BASE}/review-log`, { method: 'POST', body: fd });
      if (!logRes.ok) throw new Error('Log parsing failed');
      const logJson = await logRes.json();
      if (!logJson.metrics) throw new Error('No metrics returned');
      setMetrics(logJson.metrics);
      setGraphs(logJson.graphs || null);

      // FIXED: Use /ai-review instead of /ai-review-json
      const reviewRes = await fetch(`${API_BASE}/ai-review`, {
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

  const annotations = metrics ? {
    annotations: {
      zeroToSixty: metrics.zeroTo60 ? {
        type: 'line',
        xMin: metrics.zeroTo60,
        xMax: metrics.zeroTo60,
        borderColor: '#ff9a9a',
        borderWidth: 2,
        label: {
          enabled: true,
          content: `0–60: ${metrics.zeroTo60}s`,
          position: 'start',
          backgroundColor: 'rgba(255,154,154,0.2)',
          color: '#ff9a9a'
        }
      } : null,
      fortyToHundred: metrics.fortyTo100 ? {
        type: 'line',
        xMin: metrics.fortyTo100,
        xMax: metrics.fortyTo100,
        borderColor: '#ffc96b',
        borderWidth: 2,
        label: {
          enabled: true,
          content: `40–100: ${metrics.fortyTo100}s`,
          position: 'start',
          backgroundColor: 'rgba(255,201,107,0.2)',
          color: '#ffc96b'
        }
      } : null,
      sixtyToOneThirty: metrics.sixtyTo130 ? {
        type: 'line',
        xMin: metrics.sixtyTo130,
        xMax: metrics.sixtyTo130,
        borderColor: '#74ffb0',
        borderWidth: 2,
        label: {
          enabled: true,
          content: `60–130: ${metrics.sixtyTo130}s`,
          position: 'start',
          backgroundColor: 'rgba(116,255,176,0.2)',
          color: '#74ffb0'
        }
      } : null
    }
  } : {};

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    parsing: false,
    scales: {
      x: { type: 'linear', title: { display: true, text: 'Time (s)', color: '#adff2f' }, ticks: { color: '#adff2f' }, grid: { color: '#333' } },
      y: { title: { display: true, text: 'Speed (mph)', color: '#adff2f' }, ticks: { color: '#adff2f' }, grid: { color: '#333' } }
    },
    plugins: {
      legend: { labels: { color: '#adff2f' } },
      annotation: annotations
    }
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
          {/* LEFT: vehicle details form (unchanged) */}

          {/* CENTER: Upload + Graph + AI Results */}
          <main style={{ display: 'grid', gap: 16 }}>
            {/* Upload card */}
            <div style={styles.card}>
              <h3 style={styles.sectionTitleFancy}>Upload a Datalog</h3>
              <input type="file" accept=".csv" onChange={handleFileChange} />
              <button onClick={handleSubmit} style={{ ...styles.button, marginTop: 8 }}>Analyze</button>
              {status && <div style={{ marginTop: 8 }}>{status}</div>}
            </div>

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
                <h3 style={styles.sectionTitleFancy}>📊 Parsed Metrics</h3>
                <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                  {JSON.stringify(metrics, null, 2)}
                </pre>
              </div>
            )}

            {/* AI Assessment */}
            {aiResult && (
              <div style={styles.card}>
                <h3 style={styles.sectionTitleFancy}>🧠 AI Assessment</h3>
                <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                  {aiResult}
                </pre>
              </div>
            )}

            {/* AI Suggestions */}
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
                    <ul>
                      {s.bullets.map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                  </div>
                ))}
                {!suggestions.length && (
                  <div style={{ opacity: .9, marginTop: 8 }}>No additional suggestions.</div>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
