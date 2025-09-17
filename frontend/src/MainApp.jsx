// frontend/src/MainApp.jsx
import React, { useMemo, useState, useEffect } from 'react';
import './App.css';
import { Link } from 'react-router-dom';
import {
  years, models, engines, injectors, mapSensors, throttles,
  powerAdders, transmissions, tireHeights, gearRatios, fuels
} from './ui/options';

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
    backgroundSize: '6px 6px, 6px 6px, 28px 100%', backgroundRepeat: 'no-repeat'
  },

  sidebarTitle: {
    marginTop: 0, marginBottom: 8, fontWeight: 700, fontSize: 26, letterSpacing: 0.4,
    backgroundImage: 'linear-gradient(180deg, #d6ffd9, #7dffa1 55%, #2fff6e)',
    WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'white',
    textShadow:
      '0 1px 0 #0c150c, 0 2px 0 #0c150c, 0 3px 0 #0c150c,' +
      '0 0 16px rgba(61,255,118,.35), 0 0 36px rgba(61,255,118,.18)',
    animation: 'st-pulseGlow 2.2s ease-in-out infinite'
  },
  titleWrap: { display: 'grid', gap: 6, justifyItems: 'start', alignContent: 'center' },
  sectionTitleFancy: {
    margin: 0, fontWeight: 700, fontSize: 26, letterSpacing: 0.6, textTransform: 'uppercase',
    backgroundImage: 'linear-gradient(90deg, #caffd1, #69ff8a, #caffd1)',
    WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'white',
    textShadow:
      '0 1px 0 #0c150c, 0 2px 0 #0c150c, 0 3px 0 #0c150c, 0 4px 0 #0c150c,' +
      '0 0 12px rgba(52,255,120,.35), 0 0 28px rgba(52,255,120,.18)',
    animation: 'st-pulseGlow 2.2s ease-in-out infinite'
  },
  fieldGrid: { display: 'grid', gap: 8, gridTemplateColumns: '1fr', marginTop: 8 },

  // suggestions styling
  badge: (variant) => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 999,
    fontSize: 12, marginRight: 8,
    background: variant === 'high' ? '#ff9a9a' : variant === 'med' ? '#ffc96b' : '#74ffb0',
    color: '#111', border: '1px solid #00000055'
  }),
  list: { margin: '8px 0 0 0', paddingLeft: 18, lineHeight: 1.5, color: '#d9ffe0' }
};

/** Heuristic suggestion rules — v1: client-only, no extra API */
const RULES = [
  {
    id: 'knock',
    match: /(knock|kr|knock retard|timing pulled|detonation)/i,
    title: 'Knock Retard Detected',
    severity: 'high',
    tips: [
      'Verify fuel quality and octane; consider fresh 93/E85 if applicable.',
      'Reduce spark advance in the affected RPM/load cells.',
      'Check IATs; excessive heat can induce knock — inspect intake/IC/heat soak.',
      'Inspect plugs (heat range & gap) and coil performance.',
    ],
  },
  {
    id: 'lean',
    match: /(lean|afr.*(>|\bhigh\b)|lambda.*high|p0171|p0174|stft.*(>|high)|ltft.*(>|high))/i,
    title: 'Lean Condition / High AFR',
    severity: 'high',
    tips: [
      'Check for vacuum/boost leaks (couplers, PCV, brake booster lines).',
      'Verify injector data (flow rate, offsets) and fuel pump capacity.',
      'Log fuel pressure under load; ensure regulator and filter are healthy.',
      'Dial in MAF/VE in the affected airflow ranges.',
    ],
  },
  {
    id: 'rich',
    match: /(rich|afr.*(<|\blow\b)|lambda.*low)/i,
    title: 'Rich Condition / Low AFR',
    severity: 'med',
    tips: [
      'Confirm injector scaling and short pulse adder.',
      'MAF/VE may be over-reporting; re-cal in those cells.',
      'Check for leaking injector(s) or excessive fuel pressure.',
    ],
  },
  {
    id: 'iat',
    match: /(iat|intake air temp|charge temp|heat soak)/i,
    title: 'High Intake Air Temps',
    severity: 'med',
    tips: [
      'Improve airflow/heat extraction; ensure fans/intercooler are working.',
      'Consider lower IAT spark modifiers or reduce base timing at high IAT.',
      'Verify closed hood heat soak vs. road airflow.',
    ],
  },
  {
    id: 'boost',
    match: /(map.*kpa|boost|overboost|underboost|wastegate|bov)/i,
    title: 'Boost / MAP Irregularities',
    severity: 'med',
    tips: [
      'Pressure test charge system for leaks; inspect clamps/couplers.',
      'Verify wastegate spring and duty; check BOV operation.',
      'Confirm MAP sensor type/scaling matches tune.',
    ],
  },
  {
    id: 'fuel_press',
    match: /(fuel pressure|rail pressure|low side|high side|hpfp|lpfp)/i,
    title: 'Fuel Pressure Concerns',
    severity: 'high',
    tips: [
      'Log commanded vs. actual pressure at WOT.',
      'Replace clogged filter; inspect pump wiring/voltage drop.',
      'Scale injectors correctly; reduce demand until pressure holds.',
    ],
  },
  {
    id: 'misfire',
    match: /(misfire|p03\d\d|p0300|ignition)/i,
    title: 'Misfires Detected',
    severity: 'med',
    tips: [
      'Inspect plugs (condition, gap, heat range) and coils/boots.',
      'Check for lean cylinders (fuel trims/cylinder balance).',
      'Look for mechanical issues (compression/leakdown if persistent).',
    ],
  },
  {
    id: 'throttle',
    match: /(throttle close|torque management|driver demand|airflow limit|throttle limit)/i,
    title: 'Throttle Closure / Torque Limiting',
    severity: 'low',
    tips: [
      'Increase driver demand limits and airflow limits in the affected regions.',
      'Verify torque model & predicted torque; reduce over-reporting.',
      'Check traction control or trans torque intervention.',
    ],
  },
  {
    id: 'idle',
    match: /(idle.*hunt|stall|surge)/i,
    title: 'Idle Instability',
    severity: 'low',
    tips: [
      'Adjust base running airflow and proportional/integral terms.',
      'Check for vacuum leaks and correct spark at idle.',
      'Verify injector data at low pulse widths.',
    ],
  },
];

function deriveSuggestions(reviewText = '') {
  const text = reviewText.toLowerCase();
  const hits = RULES
    .filter(r => r.match.test(text))
    .map(r => ({ id: r.id, title: r.title, severity: r.severity, tips: r.tips }));
  // If nothing matched, provide a gentle default
  if (!hits.length && reviewText.trim()) {
    return [{
      id: 'general',
      title: 'No Critical Flags Detected',
      severity: 'low',
      tips: [
        'Consider fine-tuning spark in the most active cells to smooth transitions.',
        'Verify trims are within ±5% in cruise and WOT target AFR is met.',
        'Keep IATs in check for consistent repeatability.',
      ],
    }];
  }
  return hits;
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
  const [result, setResult] = useState('');
  const [status, setStatus] = useState('');
  const suggestions = useMemo(() => deriveSuggestions(result), [result]);

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
      <style>{`
        @keyframes st-pulseGlow {
          0%, 100% { text-shadow: 0 1px 0 #0c150c, 0 2px 0 #0c150c, 0 3px 0 #0c150c, 0 0 10px rgba(61,255,118,.18), 0 0 22px rgba(61,255,118,.12); }
          50%      { text-shadow: 0 1px 0 #0c150c, 0 2px 0 #0c150c, 0 3px 0 #0c150c, 0 0 18px rgba(61,255,118,.42), 0 0 36px rgba(61,255,118,.22); }
        }
      `}</style>

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
          <aside>
            <div style={styles.card}>
              <h3 style={styles.sidebarTitle}>Vehicle / Run Details</h3>
              <div style={styles.fieldGrid}>
                <input name="vin" placeholder="VIN (optional)" value={formData.vin} onChange={handleChange} style={styles.input} />
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

          {/* CENTER: Upload + AI Diagnostic + Suggestions */}
          <main style={{ display: 'grid', gap: 16 }}>
            <div style={styles.controlCard}>
              <h3 style={styles.controlTitle}>Upload a Datalog for AI Review</h3>
              <div style={styles.controlHelp}>
                Export your HP Tuners VCM Scanner log as <b>.csv</b>, then click <b>Analyze</b>.
              </div>
              <div style={{ marginTop: 16, display:'grid', gap:10, justifyItems:'center' }}>
                <input type="file" accept=".csv" onChange={handleFileChange} style={{ maxWidth: 360, width: '100%' }} />
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
                  marginTop: 12, whiteSpace: 'pre-wrap', lineHeight: 1.4,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                  background: '#0b0f0b', border: '1px solid #142014', borderRadius: 8, padding: 12, color: '#d9ffe0'
                }}>
                  {result}
                </pre>
              </div>
            )}

            {result && (
              <div style={styles.card}>
                <div style={styles.titleWrap}>
                  <h3 style={styles.sectionTitleFancy}>🧠 AI Suggestions</h3>
                </div>
                {suggestions.map(s => (
                  <div key={s.id} style={{ marginTop: 12 }}>
                    <span style={styles.badge(s.severity)}>
                      {s.severity === 'high' ? 'High Priority' : s.severity === 'med' ? 'Medium' : 'Info'}
                    </span>
                    <strong style={{ marginLeft: 4, color: '#eaff9c' }}>{s.title}</strong>
                    <ul style={styles.list}>
                      {s.tips.map((t, i) => <li key={i}>{t}</li>)}
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
