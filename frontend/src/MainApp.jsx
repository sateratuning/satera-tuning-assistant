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

const styles = { /* ... your same styles unchanged ... */ };

// --- CSV parser (unchanged) ---
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
          metrics: metrics || {}
        }),
      });
      if (!reviewRes.ok) throw new Error('AI review failed');

      // ✅ FIX: handle text + ===SPLIT=== instead of JSON
      const rawText = await reviewRes.text();
      const [logReview, aiReview] = rawText.split('===SPLIT===');
      setAiResult(aiReview?.trim() || 'No AI assessment returned.');
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
          <Link to="/log-comparison" style={{ ...styles.button, textDecoration:'none', lineHeight:'normal' }}>
            Log Comparison
          </Link>
        </div>
      </header>

      <div style={styles.shell}>
        <div style={isNarrow ? styles.gridNarrow : styles.grid2}>
          {/* LEFT: Vehicle form (unchanged) */}
          <aside>
            {/* ... unchanged form fields ... */}
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
