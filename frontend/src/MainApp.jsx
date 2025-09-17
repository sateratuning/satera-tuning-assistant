// frontend/src/MainApp.jsx
import React, { useMemo, useState, useEffect } from 'react';
import './App.css';
import { Link } from 'react-router-dom';
import {
  years, models, engines, injectors, mapSensors, throttles,
  powerAdders, transmissions, tireHeights, gearRatios, fuels
} from './ui/options';

/* Match LogComparison’s API_BASE behavior:
   - Use REACT_APP_API_BASE if set (e.g., https://satera-backend.onrender.com)
   - Or leave empty to rely on same-origin/proxy in local dev */
const API_BASE = process.env.REACT_APP_API_BASE || '';




/* ===== styles (lifted from LogComparison, trimmed for this page) ===== */
const styles = {
  page: { backgroundColor: '#111', color: '#adff2f', minHeight: '100vh', fontFamily: 'Arial' },

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    background: 'linear-gradient(to bottom, #00ff88, #007744)',
    color: '#000',
    fontSize: '2rem',
    fontWeight: 'bold',
    boxShadow: '0 4px 10px rgba(0,255,136,0.4)'
  },

  shell: { padding: 20 },

  // This page has 2 columns: LEFT (vehicle), CENTER (upload + results)
  grid2: { display: 'grid', gridTemplateColumns: '410px 1fr', gap: 16 },
  gridNarrow: { display: 'grid', gridTemplateColumns: '1fr', gap: 16 },

  card: { backgroundColor: '#1a1a1a', padding: 12, borderRadius: 8, border: '1px solid #2a2a2a' },

  // Buttons / labels
  button: { backgroundColor: '#00ff88', color: '#000', padding: '10px 16px', border: 'none', cursor: 'pointer', borderRadius: 6 },

  label: { marginRight: 8 },
  tableWrap: { overflow: 'auto', borderRadius: 8, border: '1px solid #333' },

  // Controls pad (top of center column)
  controlCard: { background: '#1a1a1a', padding: 18, borderRadius: 10, border: '1px solid #2a2a2a' },
  controlTitle: { fontSize: 32, fontWeight: 800, margin: 0, color: '#ffffff', textShadow: '0 0 6px rgba(173,255,47,0.25)', textAlign: 'center' },
  controlHelp: { marginTop: 6, fontSize: 14, color: '#4fff5b', opacity: 0.9, textAlign: 'center' },

  // Themed inputs/selects (same look as LogComparison)
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

  /* ======= FANCY TITLES ======= */
  sidebarTitle: {
    marginTop: 0,
    marginBottom: 8,
    fontWeight: 700,
    fontSize: 26,
    letterSpacing: 0.4,
    backgroundImage: 'linear-gradient(180deg, #d6ffd9, #7dffa1 55%, #2fff6e)',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'white',
    textShadow:
      '0 1px 0 #0c150c, 0 2px 0 #0c150c, 0 3px 0 #0c150c,' +
      '0 0 16px rgba(61,255,118,.35), 0 0 36px rgba(61,255,118,.18)',
    animation: 'st-pulseGlow 2.2s ease-in-out infinite'
  },
  titleWrap: { display: 'grid', gap: 6, justifyItems: 'start', alignContent: 'center' },
  sectionTitleFancy: {
    margin: 0,
    fontWeight: 700,
    fontSize: 26,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    backgroundImage: 'linear-gradient(90deg, #caffd1, #69ff8a, #caffd1)',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'white',
    textShadow:
      '0 1px 0 #0c150c, 0 2px 0 #0c150c, 0 3px 0 #0c150c, 0 4px 0 #0c150c,' +
      '0 0 12px rgba(52,255,120,.35), 0 0 28px rgba(52,255,120,.18)',
    animation: 'st-pulseGlow 2.2s ease-in-out infinite'
  },

  fieldGrid: { display: 'grid', gap: 8, gridTemplateColumns: '1fr', marginTop: 8 }
};

export default function MainApp() {
  // responsive: match LogComparison behavior
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1100);
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 1100);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // form + result
  const [formData, setFormData] = useState({
    vin: '', year: '', model: '', engine: '', injectors: '', map: '',
    throttle: '', power: '', trans: '', tire: '', gear: '', fuel: '', logFile: null,
  });
  const [result, setResult] = useState('');
  const [status, setStatus] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((p) => ({ ...p, [name]: value }));
  };

  const handleFileChange = (e) => {
    setFormData((p) => ({ ...p, logFile: e.target.files?.[0] || null }));
  };

  const handleSubmit = async () => {
    setStatus('');
    const data = new FormData();
    Object.entries(formData).forEach(([k, v]) => {
      if (k === 'logFile' && v) data.append('log', v);
      else data.append(k, v ?? '');
    });

    try {
      const res = await fetch(`${API_BASE}/ai-review`, { method: 'POST', body: data });
      if (!res.ok) throw new Error(`AI review failed (${res.status})`);
      const text = await res.text();
      const [review/*, ai*/] = text.split('===SPLIT===');
      setResult((review || '').trim());
    } catch (e) {
      setResult(`❌ Error analyzing log. ${e.message || ''}`);
    }
  };

  return (
    <div style={styles.page}>
      {/* same glow anim as LogComparison */}
      <style>{`
        @keyframes st-pulseGlow {
          0%, 100% { text-shadow: 0 1px 0 #0c150c, 0 2px 0 #0c150c, 0 3px 0 #0c150c, 0 0 10px rgba(61,255,118,.18), 0 0 22px rgba(61,255,118,.12); }
          50%      { text-shadow: 0 1px 0 #0c150c, 0 2px 0 #0c150c, 0 3px 0 #0c150c, 0 0 18px rgba(61,255,118,.42), 0 0 36px rgba(61,255,118,.22); }
        }
      `}</style>

      {/* HEADER (matches the vibe & spacing) */}
      <header style={styles.header}>
        <div>Satera Tuning — AI Log Review (BETA)</div>
        <div style={{ display:'flex', gap:10 }}>
          <Link
  to="/ai-review"
  style={{
    ...styles.button,              // use the full green button style
    textDecoration: 'none',
    display: 'inline-block',
    textAlign: 'center',
    lineHeight: 'normal'
  }}
>
  AI Log Review
</Link>

        </div>
      </header>

      <div style={styles.shell}>
        <div style={isNarrow ? styles.gridNarrow : styles.grid2}>
          {/* LEFT: Vehicle / Run Details (same styled inputs/selects as LogComparison) */}
          <aside>
            <div style={styles.card}>
              <h3 style={styles.sidebarTitle}>Vehicle / Run Details</h3>

              <div style={styles.fieldGrid}>
                <input
                  name="vin"
                  placeholder="VIN (optional)"
                  value={formData.vin}
                  onChange={handleChange}
                  style={styles.input}
                />

                <select name="year" value={formData.year} onChange={handleChange} style={styles.select}>
                  <option value="">Year</option>
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>

                <select name="model" value={formData.model} onChange={handleChange} style={styles.select}>
                  <option value="">Model</option>
                  {models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>

                <select name="engine" value={formData.engine} onChange={handleChange} style={styles.select}>
                  <option value="">Engine</option>
                  {engines.map(e => <option key={e} value={e}>{e}</option>)}
                </select>

                <select name="injectors" value={formData.injectors} onChange={handleChange} style={styles.select}>
                  <option value="">Injectors</option>
                  {injectors.map(i => <option key={i} value={i}>{i}</option>)}
                </select>

                <select name="map" value={formData.map} onChange={handleChange} style={styles.select}>
                  <option value="">MAP Sensor</option>
                  {mapSensors.map(m => <option key={m} value={m}>{m}</option>)}
                </select>

                <select name="throttle" value={formData.throttle} onChange={handleChange} style={styles.select}>
                  <option value="">Throttle Body</option>
                  {throttles.map(t => <option key={t} value={t}>{t}</option>)}
                </select>

                <select name="power" value={formData.power} onChange={handleChange} style={styles.select}>
                  <option value="">Power Adder</option>
                  {powerAdders.map(p => <option key={p} value={p}>{p}</option>)}
                </select>

                <select name="trans" value={formData.trans} onChange={handleChange} style={styles.select}>
                  <option value="">Transmission</option>
                  {transmissions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>

                <select name="tire" value={formData.tire} onChange={handleChange} style={styles.select}>
                  <option value="">Tire Height</option>
                  {tireHeights.map(t => <option key={t} value={t}>{t}</option>)}
                </select>

                <select name="gear" value={formData.gear} onChange={handleChange} style={styles.select}>
                  <option value="">Rear Gear</option>
                  {gearRatios.map(g => <option key={g} value={g}>{g}</option>)}
                </select>

                <select name="fuel" value={formData.fuel} onChange={handleChange} style={styles.select}>
                  <option value="">Fuel</option>
                  {fuels.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>
          </aside>

          {/* CENTER: Upload + AI Diagnostic Summary */}
          <main style={{ display: 'grid', gap: 16 }}>
            <div style={styles.controlCard}>
              <h3 style={styles.controlTitle}>Upload a Datalog for AI Review</h3>
              <div style={styles.controlHelp}>
                Export your HP Tuners VCM Scanner log as <b>.csv</b>, then click <b>Analyze</b>.
              </div>

              <div style={{ marginTop: 16, display:'grid', gap:10, justifyItems:'center' }}>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  style={{ maxWidth: 360, width: '100%' }}
                />
                <button onClick={handleSubmit} style={styles.button}>Analyze</button>
                {status && <div style={{ opacity:.9 }}>{status}</div>}
              </div>
            </div>

            {result && (
              <div style={styles.card}>
                <div style={styles.titleWrap}>
                  <h3 style={styles.sectionTitleFancy}>📋 Diagnostic Summary</h3>
                </div>
                <pre style={{
                  marginTop: 12,
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.4,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                  background: '#0b0f0b',
                  border: '1px solid #142014',
                  borderRadius: 8,
                  padding: 12,
                  color: '#d9ffe0'
                }}>
                  {result}
                </pre>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
