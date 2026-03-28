// frontend/src/LogComparison.jsx — Drop-in replacement
import React, { useMemo, useState, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import 'chart.js/auto';
import './App.css';
import { Link } from 'react-router-dom';
import FeedbackModal from './FeedbackModal';
import { sendFeedback } from './api';
import {
  auth,
  onAuthStateChanged,
  signInWithGoogle,
  signOutUser,
} from './firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import {
  years, models, engines, injectors, mapSensors, throttles,
  powerAdders, transmissions, tireHeights, gearRatios, fuels
} from './ui/options';

const API_BASE = process.env.REACT_APP_API_BASE || '';

// ── Design tokens (matches MainApp) ───────────────────────
const T = {
  bg:        '#0c0f0c',
  panel:     '#111811',
  card:      '#141e14',
  border:    '#1f2d1f',
  borderHi:  '#2e472e',
  green:     '#3dff7a',
  greenDim:  '#1a7a38',
  greenLo:   'rgba(61,255,122,0.07)',
  greenGlow: 'rgba(61,255,122,0.15)',
  amber:     '#f5a623',
  amberLo:   'rgba(245,166,35,0.08)',
  red:       '#ff5252',
  blue:      '#4db8ff',
  blueLo:    'rgba(77,184,255,0.08)',
  orange:    '#ff9f40',
  text:      '#dff0df',
  muted:     '#6b9f6b',
  faint:     '#2e4a2e',
};

const css = {
  page:   { background: T.bg, color: T.text, minHeight: '100vh', fontFamily: "'Segoe UI', system-ui, Arial, sans-serif" },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '0 28px', height: 64,
    background: 'linear-gradient(135deg, #0a1a0a 0%, #0f280f 50%, #0a1a0a 100%)',
    borderBottom: `1px solid ${T.border}`,
    boxShadow: '0 1px 0 rgba(61,255,122,0.08)',
    flexWrap: 'wrap', gap: 10,
  },
  logo: {
    fontSize: 18, fontWeight: 700, color: T.green,
    letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 10,
  },
  headerRight: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  shell:  { padding: '24px', maxWidth: 1600, margin: '0 auto' },

  card: {
    background: T.card, border: `1px solid ${T.border}`,
    borderRadius: 10, padding: 18,
  },
  cardHighlight: {
    background: T.card, border: `1px solid ${T.borderHi}`,
    borderRadius: 10, padding: 18,
    boxShadow: `0 0 0 1px rgba(61,255,122,0.04) inset`,
  },

  sectionTitle: {
    margin: '0 0 14px', fontSize: 13, fontWeight: 600,
    letterSpacing: 1.2, textTransform: 'uppercase',
    color: T.green, opacity: 0.9,
  },

  input: {
    width: '100%', background: '#0a100a',
    border: `1px solid ${T.border}`, borderRadius: 7,
    padding: '9px 12px', color: T.text,
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
  },
  select: {
    width: '100%', background: '#0a100a',
    border: `1px solid ${T.border}`, borderRadius: 7,
    padding: '9px 12px', color: T.text, fontSize: 13,
    outline: 'none', appearance: 'none',
    backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'%233dff7a\'/%3E%3C/svg%3E")',
    backgroundRepeat: 'no-repeat', backgroundPosition: 'calc(100% - 12px) 50%',
    paddingRight: 32, boxSizing: 'border-box',
  },

  btnPrimary: {
    background: T.green, color: '#000', fontWeight: 700,
    border: 'none', borderRadius: 7, padding: '10px 20px',
    cursor: 'pointer', fontSize: 13, letterSpacing: 0.3,
    whiteSpace: 'nowrap',
  },
  btnGhost: {
    background: 'transparent', color: T.muted,
    border: `1px solid ${T.border}`, borderRadius: 7,
    padding: '8px 14px', cursor: 'pointer', fontSize: 13,
    whiteSpace: 'nowrap',
  },
  btnWarn: {
    background: T.amberLo, color: T.amber,
    border: `1px solid rgba(245,166,35,0.3)`, borderRadius: 7,
    padding: '8px 14px', cursor: 'pointer', fontSize: 13,
    whiteSpace: 'nowrap',
  },
  btnNav: {
    background: T.greenLo, color: T.green,
    border: `1px solid ${T.borderHi}`, borderRadius: 7,
    padding: '8px 16px', cursor: 'pointer', fontSize: 13,
    textDecoration: 'none', fontWeight: 600, letterSpacing: 0.3,
    whiteSpace: 'nowrap',
  },
  btnBlue: {
    background: T.blueLo, color: T.blue,
    border: `1px solid rgba(77,184,255,0.25)`, borderRadius: 7,
    padding: '7px 14px', cursor: 'pointer', fontSize: 13,
    whiteSpace: 'nowrap',
  },
  linkish: {
    background: 'transparent', border: 'none',
    color: T.green, cursor: 'pointer',
    textDecoration: 'underline', padding: 0, fontSize: 13,
  },
};

// ── Auth helpers ───────────────────────────────────────────
const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const maskNameString = (raw) => {
  if (!raw) return 'User';
  let s = raw.trim().replace(/@.*$/, '');
  const parts = s.split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return 'User';
  const first = capitalize(parts[0]);
  const lastInitial = parts[1] ? parts[1][0].toUpperCase() + '.' : '';
  return lastInitial ? `${first} ${lastInitial}` : first;
};
const maskedDisplayName = (u) => {
  if (!u) return '';
  if (u.displayName) return maskNameString(u.displayName);
  if (u.email) return maskNameString(u.email);
  return 'User';
};

// ── CSV parser ─────────────────────────────────────────────
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
  const timeIndex  = col('Offset');
  if (speedIndex === -1 || timeIndex === -1) return null;
  const speed = [], time = [];
  for (let row of dataRows) {
    if (!row.includes(',')) continue;
    const cols = row.split(',');
    const s = parseFloat(cols[speedIndex]);
    const t = parseFloat(cols[timeIndex]);
    if (Number.isFinite(s) && Number.isFinite(t)) { speed.push(s); time.push(t); }
  }
  return (speed.length && time.length) ? { speed, time } : null;
}

// ── Run finder ─────────────────────────────────────────────
function findAllRuns(log, startMPH, endMPH) {
  const { time, speed } = log;
  const runs = [];
  let startTime = null, foundStop = false;
  for (let i = 1; i < speed.length; i++) {
    const v = speed[i];
    if (startMPH === 0) {
      if (!foundStop && v < 1.5) foundStop = true;
      if (foundStop && startTime === null && v > 1.5) startTime = time[i];
    } else {
      if (startTime === null && v >= startMPH && v < endMPH) startTime = time[i];
    }
    if (startTime !== null && v >= endMPH) {
      const endTime = time[i];
      const duration = +(endTime - startTime).toFixed(3);
      const seg = { startTime, endTime, duration, data: [] };
      for (let j = 0; j < speed.length; j++) {
        if (time[j] >= startTime && time[j] <= endTime)
          seg.data.push({ x: +(time[j] - startTime).toFixed(3), y: speed[j] });
      }
      runs.push(seg);
      startTime = null;
      if (startMPH === 0) foundStop = false;
    }
    if (startTime !== null && v > endMPH + 10) startTime = null;
  }
  return runs;
}

function getBestRun(log, startMPH, endMPH) {
  const runs = findAllRuns(log, startMPH, endMPH);
  if (!runs.length) return null;
  return runs.reduce((min, r) => (r.duration < min.duration ? r : min));
}

// ── Skeleton ───────────────────────────────────────────────
function Skeleton({ height = 16, width = '100%', style = {} }) {
  return (
    <div style={{
      height, width, borderRadius: 4,
      background: 'linear-gradient(90deg, #151e15 25%, #1e2d1e 50%, #151e15 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
      ...style,
    }} />
  );
}

// ── Badge pill ─────────────────────────────────────────────
function Pill({ children, color = T.green, bg = T.greenLo }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 99,
      fontSize: 11, fontWeight: 600, letterSpacing: 0.4,
      background: bg, color, border: `1px solid ${color}22`,
    }}>
      {children}
    </span>
  );
}

// ── Rank medal ─────────────────────────────────────────────
function RankMedal({ rank }) {
  if (rank === 1) return <span title="1st">🥇</span>;
  if (rank === 2) return <span title="2nd">🥈</span>;
  if (rank === 3) return <span title="3rd">🥉</span>;
  return <span style={{ color: T.muted, fontSize: 12 }}>#{rank}</span>;
}

// ═══════════════════════════════════════════════════════════
export default function LogComparison() {
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < 1200);
  useEffect(() => {
    const fn = () => setIsNarrow(window.innerWidth < 1200);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);

  // Auth
  const [user, setUser]               = useState(null);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail]             = useState('');
  const [pw, setPw]                   = useState('');
  const [authBusy, setAuthBusy]       = useState(false);
  const [status, setStatus]           = useState('');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => setUser(u || null));
    return () => unsub();
  }, []);

  // Feedback
  const [showFeedback, setShowFeedback] = useState(false);

  // Logs
  const [log1, setLog1]         = useState(null);
  const [log2, setLog2]         = useState(null);
  const [log1File, setLog1File] = useState(null);
  const [log2File, setLog2File] = useState(null);
  const [log1Name, setLog1Name] = useState('');
  const [log2Name, setLog2Name] = useState('');

  // Graph
  const [graphData, setGraphData]       = useState(null);
  const [leaderOverlay, setLeaderOverlay] = useState(null);
  const [summary, setSummary]           = useState({});
  const [interval, setInterval]         = useState('60-130');

  // Vehicle
  const [vehicle, setVehicle] = useState({
    name: '', year: '', model: '', engine: '', injectors: '', map: '',
    throttle: '', power: '', trans: '', tire: '', gear: '', fuel: ''
  });

  // AI Review
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewText, setReviewText]       = useState('');
  const [reviewError, setReviewError]     = useState('');

  // Leaderboard
  const [leaderboard, setLeaderboard]   = useState({ results: [], total: 0 });
  const [loadingLB, setLoadingLB]       = useState(false);
  const [filters, setFilters]           = useState({ year:'', model:'', engine:'', power:'', fuel:'', trans:'' });
  const [sort, setSort]                 = useState('time_seconds:asc');
  const [submitting, setSubmitting]     = useState(false);

  const ranges = useMemo(() => ({
    '0-60': [0, 60], '40-100': [40, 100], '60-130': [60, 130]
  }), []);

  // ── AI Review ─────────────────────────────────────────
  const runLogReview = async (file) => {
    if (!file) return;
    setReviewLoading(true);
    setReviewText('');
    setReviewError('');
    try {
      const form = new FormData();
      form.append('log', file);
      const res = await fetch(`${API_BASE}/ai-review`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Review failed (${res.status})`);
      const text = await res.text();
      const [quickChecks, aiPart] = text.split('===SPLIT===');
      const combined = (quickChecks||'').trim() + (aiPart ? `\n\nAI Review:\n${aiPart.trim()}` : '');
      setReviewText(combined || 'No output returned.');
    } catch (err) {
      setReviewError(err?.message || 'Log review failed.');
    } finally {
      setReviewLoading(false);
    }
  };

  // ── File handling ──────────────────────────────────────
  const handleFileChange = (e, setParsed, setFileRef, setName, isLog1) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileRef(file);
    setName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCSV(reader.result);
      setParsed(parsed);
      setStatus(parsed ? '' : '❌ Failed to parse CSV — check format.');
      if (isLog1 && file) runLogReview(file);
    };
    reader.readAsText(file);
  };

  // ── Graph generation ───────────────────────────────────
  const computeBestForInterval = (logObj) => {
    if (!logObj) return null;
    const [start, end] = ranges[interval];
    const best = getBestRun(logObj, start, end);
    return best ? best.duration : null;
  };

  const handleGenerateGraph = (forcedOverlay = undefined) => {
    if (!log1 && !log2 && !leaderOverlay && !forcedOverlay) {
      setStatus('Upload at least one log file first.'); return;
    }
    const [startMPH, endMPH] = ranges[interval];
    const r1 = log1 ? getBestRun(log1, startMPH, endMPH) : null;
    const r2 = log2 ? getBestRun(log2, startMPH, endMPH) : null;
    if (!r1 && !r2 && !leaderOverlay && !forcedOverlay) {
      setStatus(`No valid ${interval} run found.`); return;
    }

    const datasets = [];
    let xEnd = 0;

    if (r1) {
      datasets.push({ label: log1Name || 'Log 1', data: r1.data, tension: 0.1, parsing: false, borderColor: T.green, backgroundColor: 'rgba(61,255,122,0.1)', borderWidth: 2, pointRadius: 0 });
      datasets.push({ label: `${startMPH}–${endMPH}: ${r1.duration}s`, data: [{ x: r1.data.at(-1).x, y: r1.data.at(-1).y }], pointRadius: 7, pointStyle: 'triangle', showLine: false, borderColor: T.green });
      xEnd = Math.max(xEnd, r1.duration);
    }
    if (r2) {
      datasets.push({ label: log2Name || 'Log 2', data: r2.data, tension: 0.1, parsing: false, borderColor: T.blue, backgroundColor: 'rgba(77,184,255,0.1)', borderWidth: 2, pointRadius: 0 });
      datasets.push({ label: `${startMPH}–${endMPH} (L2): ${r2.duration}s`, data: [{ x: r2.data.at(-1).x, y: r2.data.at(-1).y }], pointRadius: 7, pointStyle: 'triangle', showLine: false, borderColor: T.blue });
      xEnd = Math.max(xEnd, r2.duration);
    }
    const overlayToUse = forcedOverlay !== undefined ? forcedOverlay : leaderOverlay;
    if (overlayToUse) {
      datasets.push({ label: overlayToUse.label, data: overlayToUse.data || [], borderDash: [6, 4], tension: 0.1, parsing: false, borderColor: T.orange, backgroundColor: 'rgba(255,159,64,0.1)', borderWidth: 2, pointRadius: 0 });
      const lastX = overlayToUse.data?.length ? overlayToUse.data.at(-1).x : 0;
      xEnd = Math.max(xEnd, lastX);
    }

    setGraphData({
      datasets,
      options: {
        responsive: true, maintainAspectRatio: false, parsing: false,
        plugins: {
          tooltip: { callbacks: { label: ctx => `Speed: ${ctx.parsed.y} mph @ ${ctx.parsed.x}s` } },
          legend: { labels: { color: T.muted, font: { size: 12 } } }
        },
        scales: {
          x: { type: 'linear', min: 0, max: xEnd + 0.5, title: { display: true, text: 'Time (s)', color: T.muted }, ticks: { color: T.muted }, grid: { color: '#1a221a' } },
          y: { min: startMPH - 5, max: endMPH + 5, title: { display: true, text: 'Speed (mph)', color: T.muted }, ticks: { color: T.muted }, grid: { color: '#1a221a' } }
        }
      }
    });
    setSummary({ 'Log 1': r1?.duration || null, 'Log 2': r2?.duration || null });
    setStatus('');
  };

  // ── Leaderboard ────────────────────────────────────────
  const fetchLeaderboard = async () => {
    try {
      setLoadingLB(true);
      const params = new URLSearchParams({ interval, limit: '50' });
      if (filters.year)   params.set('year',   filters.year);
      if (filters.model)  params.set('model',  filters.model);
      if (filters.engine) params.set('engine', filters.engine);
      if (filters.power)  params.set('power',  filters.power);
      if (filters.fuel)   params.set('fuel',   filters.fuel);
      if (filters.trans)  params.set('trans',  filters.trans);
      const [sortCol, sortDir] = (sort || 'time_seconds:asc').split(':');
      params.set('sort', sortCol);
      params.set('dir',  sortDir);
      const res = await fetch(`${API_BASE}/api/leaderboard?${params.toString()}`);
      const json = await res.json();
      setLeaderboard({ results: json.results || [], total: json.total ?? (json.results?.length || 0) });
    } catch { setLeaderboard({ results: [], total: 0 }); }
    finally { setLoadingLB(false); }
  };

  useEffect(() => { fetchLeaderboard(); /* eslint-disable-next-line */ }, [interval, sort]);
  useEffect(() => { fetchLeaderboard(); /* eslint-disable-next-line */ }, [filters.year, filters.model, filters.engine, filters.power, filters.fuel, filters.trans]);

  const overlayLeader = async (runId, label) => {
    try {
      const res = await fetch(`${API_BASE}/api/run/${runId}?interval=${encodeURIComponent(interval)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to fetch run');
      const trace = json.trace || [];
      if (!trace.length) { setStatus('Leader has no trace for this interval.'); return; }
      const overlayObj = { label: `${label} (Leader)`, data: trace };
      setLeaderOverlay(overlayObj);
      handleGenerateGraph(overlayObj);
    } catch (e) { setStatus(`Overlay error: ${String(e.message || e)}`); }
  };

  const clearOverlay = () => { setLeaderOverlay(null); handleGenerateGraph(null); };

  const submitToLeaderboard = async () => {
    setStatus('');
    if (!user) { setStatus('⚠ Please sign in to submit your run.'); return; }
    const file = log1File || log2File;
    const parsed = log1 || log2;
    if (!file || !parsed) { setStatus('Upload a CSV first.'); return; }
    const best = computeBestForInterval(parsed);
    if (best == null) { setStatus(`No valid ${interval} run found.`); return; }
    const alias = maskedDisplayName(user);
    const vehicleInfo = { ...vehicle, name: alias, interval, timeSeconds: best };
    const fd = new FormData();
    fd.append('log', file, file.name || 'log.csv');
    fd.append('vehicleInfo', JSON.stringify(vehicleInfo));
    fd.append('consent', 'true');
    try {
      setSubmitting(true);
      setStatus('Submitting…');
      const idToken = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/submit-run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: fd
      });
      if (!res.ok) { const t = await res.text(); throw new Error(t || 'Submission failed.'); }
      const json = await res.json();
      setStatus(`✅ Submitted! ${interval} = ${best.toFixed(2)}s`);
      await fetchLeaderboard();
    } catch (err) { setStatus(`❌ ${String(err.message || err)}`); }
    finally { setSubmitting(false); }
  };

  // ── Auth handlers ──────────────────────────────────────
  const handleGoogleLogin = async () => {
    try { await signInWithGoogle(); setStatus(''); }
    catch (e) { if (e?.code !== 'auth/popup-closed-by-user') setStatus(`Sign-in error: ${e?.message || e}`); }
  };

  const handleEmailSignIn = async () => {
    if (!email || !pw) { setStatus('Enter email and password.'); return; }
    try { setAuthBusy(true); await signInWithEmailAndPassword(auth, email.trim(), pw); setStatus(''); setPw(''); setShowEmailForm(false); }
    catch (e) { setStatus(e?.message || 'Sign-in failed.'); }
    finally { setAuthBusy(false); }
  };

  const handleEmailSignUp = async () => {
    if (!email || !pw) { setStatus('Enter email and password.'); return; }
    try { setAuthBusy(true); await createUserWithEmailAndPassword(auth, email.trim(), pw); setStatus('Account created.'); setPw(''); setShowEmailForm(false); }
    catch (e) { setStatus(e?.message || 'Sign-up failed.'); }
    finally { setAuthBusy(false); }
  };

  const handleForgotPassword = async () => {
    if (!email) { setStatus('Enter your email first.'); return; }
    try { setAuthBusy(true); await sendPasswordResetEmail(auth, email.trim()); setStatus('Reset email sent.'); }
    catch (e) { setStatus(e?.message || 'Could not send reset email.'); }
    finally { setAuthBusy(false); }
  };

  const handleSubmitFeedback = async ({ email: fbEmail, page, message }) => {
    try {
      await sendFeedback({ message, meta: { page: page || 'LogComparison', interval, user: user ? maskedDisplayName(user) : 'Guest', email: fbEmail || null, status } });
      setStatus('Feedback sent — thanks!');
      return true;
    } catch (e) { setStatus(`Feedback error: ${e?.message || e}`); return false; }
  };

  // ── Review text parser (reuse from MainApp style) ──────
  const reviewLines = useMemo(() => {
    if (!reviewText) return [];
    return reviewText.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      let type = 'info';
      if (line.startsWith('⚠️') || line.startsWith('🚨')) type = 'warn';
      else if (line.startsWith('✅')) type = 'ok';
      else if (['📈','🚀','🚦','📊','🌀','🎯'].some(e => line.startsWith(e))) type = 'stat';
      return { type, line };
    });
  }, [reviewText]);

  // ── Layout breakpoints ─────────────────────────────────
  // 3-col on wide, 1-col on narrow
  const layoutStyle = isNarrow
    ? { display: 'grid', gridTemplateColumns: '1fr', gap: 16 }
    : { display: 'grid', gridTemplateColumns: '340px 1fr 380px', gap: 16 };

  return (
    <div style={css.page}>
      <style>{`
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes fadeIn  { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        select option { background: #111811; }
        input[type=file] { display: none; }
        .upload-label {
          display: flex; align-items: center; gap: 8px;
          padding: 9px 14px; border-radius: 7px; width: 100%;
          border: 2px dashed ${T.border}; cursor: pointer;
          color: ${T.muted}; font-size: 13px;
          transition: border-color 0.2s, color 0.2s; box-sizing: border-box;
        }
        .upload-label:hover { border-color: ${T.green}; color: ${T.green}; }
        .upload-label.has-file { border-color: ${T.borderHi}; color: ${T.text}; border-style: solid; }
        .lb-row:hover { background: rgba(61,255,122,0.04); }
        .lb-row td { padding: 9px 10px; border-bottom: 1px solid ${T.border}; font-size: 13px; }
        .lb-row-top td { color: #eaff9c; }
        .lb-row-top { background: rgba(61,255,122,0.03); }
      `}</style>

      {/* ── HEADER ─────────────────────────────────────── */}
      <header style={css.header}>
        <div style={css.logo}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="11" cy="11" r="10" stroke={T.green} strokeWidth="1.5"/>
            <path d="M7 11 L10 14 L15 8" stroke={T.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Satera Tuning
          <span style={{ fontSize: 11, fontWeight: 400, color: T.muted }}>Log Comparison</span>
          <span style={{ fontSize: 10, color: T.greenDim, background: T.greenLo, border: `1px solid ${T.faint}`, borderRadius: 4, padding: '1px 6px' }}>BETA</span>
        </div>

        <div style={css.headerRight}>
          <Link to="/ai-review" style={css.btnNav}>AI Log Review →</Link>
          <button style={css.btnGhost} onClick={() => setShowFeedback(true)}>Report a Bug</button>

          {!user ? (
            <>
              <button style={css.btnBlue} onClick={handleGoogleLogin}>Sign in with Google</button>
              <button style={css.btnGhost} onClick={() => { setShowEmailForm(v => !v); setStatus(''); }}>
                {showEmailForm ? 'Hide login' : 'Email login'}
              </button>
            </>
          ) : (
            <>
              <span style={{ fontSize: 12, background: '#0c180c', border: `1px solid ${T.border}`, color: T.green, padding: '5px 10px', borderRadius: 99 }}>
                {maskedDisplayName(user)}
              </span>
              <button style={css.btnGhost} onClick={signOutUser}>Sign out</button>
            </>
          )}
        </div>
      </header>

      {/* ── EMAIL AUTH FORM ─────────────────────────────── */}
      {!user && showEmailForm && (
        <div style={{ background: '#0e160e', borderBottom: `1px solid ${T.border}`, padding: '14px 28px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: 8, alignItems: 'end', maxWidth: 700 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: T.muted, marginBottom: 4 }}>Email</label>
              <input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} style={css.input} autoComplete="email"/>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: T.muted, marginBottom: 4 }}>Password</label>
              <input type="password" placeholder="••••••••" value={pw} onChange={e => setPw(e.target.value)} style={css.input} autoComplete="current-password"/>
            </div>
            <button disabled={authBusy} onClick={handleEmailSignIn} style={css.btnPrimary}>
              {authBusy ? 'Working…' : 'Sign in'}
            </button>
            <button disabled={authBusy} onClick={handleEmailSignUp} style={{ ...css.btnGhost, color: T.amber, borderColor: 'rgba(245,166,35,0.3)' }}>
              {authBusy ? 'Working…' : 'Create account'}
            </button>
          </div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 16 }}>
            <button disabled={authBusy} onClick={handleForgotPassword} style={css.linkish}>Forgot password?</button>
            {status && <span style={{ fontSize: 13, color: status.startsWith('❌') ? T.red : T.muted }}>{status}</span>}
          </div>
        </div>
      )}

      <div style={css.shell}>

        {/* ── UPLOAD CONTROLS ─────────────────────────── */}
        <div style={{ ...css.cardHighlight, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            <p style={{ ...css.sectionTitle, margin: 0 }}>Upload & Compare</p>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: T.muted }}>Interval:</span>
              {['0-60', '40-100', '60-130'].map(iv => (
                <button key={iv} onClick={() => setInterval(iv)}
                  style={{
                    ...css.btnGhost,
                    padding: '5px 12px', fontSize: 12,
                    ...(interval === iv ? { background: T.greenLo, color: T.green, borderColor: T.green } : {}),
                  }}>
                  {iv} mph
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 14 }}>
            {/* Log 1 */}
            <div>
              <label style={{ display: 'block', fontSize: 11, color: T.green, marginBottom: 6, fontWeight: 600, letterSpacing: 0.8 }}>
                LOG 1 — Required
              </label>
              <label htmlFor="log1Input" className={`upload-label${log1 ? ' has-file' : ''}`}>
                <span>📂</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {log1Name || 'Choose HP Tuners CSV…'}
                </span>
                {log1 && <span style={{ marginLeft: 'auto', color: T.green, flexShrink: 0 }}>✓</span>}
              </label>
              <input id="log1Input" type="file" accept=".csv"
                onChange={e => handleFileChange(e, setLog1, setLog1File, setLog1Name, true)}/>
              <p style={{ fontSize: 11, color: T.faint, marginTop: 4 }}>Auto-triggers AI review on upload</p>
            </div>

            {/* Log 2 */}
            <div>
              <label style={{ display: 'block', fontSize: 11, color: T.muted, marginBottom: 6, fontWeight: 600, letterSpacing: 0.8 }}>
                LOG 2 — Optional
              </label>
              <label htmlFor="log2Input" className={`upload-label${log2 ? ' has-file' : ''}`}>
                <span>📂</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {log2Name || 'Choose comparison CSV…'}
                </span>
                {log2 && <span style={{ marginLeft: 'auto', color: T.blue, flexShrink: 0 }}>✓</span>}
              </label>
              <input id="log2Input" type="file" accept=".csv"
                onChange={e => handleFileChange(e, setLog2, setLog2File, setLog2Name, false)}/>
              <p style={{ fontSize: 11, color: T.faint, marginTop: 4 }}>Compare against Log 1 on graph</p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => handleGenerateGraph()} style={css.btnPrimary} disabled={!log1 && !log2}>
              Generate Graph
            </button>
            {leaderOverlay && (
              <button onClick={clearOverlay} style={css.btnWarn}>✕ Clear Overlay</button>
            )}
            {status && (
              <span style={{ fontSize: 13, color: status.startsWith('❌') || status.startsWith('⚠') ? T.amber : T.muted }}>
                {status}
              </span>
            )}
          </div>
        </div>

        {/* ── 3-COLUMN LAYOUT ─────────────────────────── */}
        <div style={layoutStyle}>

          {/* ── COL 1: Vehicle / Submit ───────────────── */}
          <aside style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
            <div style={css.card}>
              <p style={css.sectionTitle}>Vehicle Details</p>
              <div style={{ display: 'grid', gap: 8 }}>
                <input
                  name="name"
                  placeholder={user ? maskedDisplayName(user) : 'Display name'}
                  value={user ? maskedDisplayName(user) : vehicle.name}
                  onChange={user ? undefined : e => setVehicle(v => ({ ...v, name: e.target.value }))}
                  readOnly={!!user}
                  style={{ ...css.input, opacity: user ? 0.6 : 1, cursor: user ? 'not-allowed' : 'text' }}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <select name="year" value={vehicle.year} onChange={e => setVehicle(v => ({ ...v, year: e.target.value }))} style={css.select}>
                    <option value="">Year</option>{years.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <select name="model" value={vehicle.model} onChange={e => setVehicle(v => ({ ...v, model: e.target.value }))} style={css.select}>
                    <option value="">Model</option>{models.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <select name="engine" value={vehicle.engine} onChange={e => setVehicle(v => ({ ...v, engine: e.target.value }))} style={css.select}>
                  <option value="">Engine</option>{engines.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
                <select name="trans" value={vehicle.trans} onChange={e => setVehicle(v => ({ ...v, trans: e.target.value }))} style={css.select}>
                  <option value="">Transmission</option>{transmissions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <select name="power" value={vehicle.power} onChange={e => setVehicle(v => ({ ...v, power: e.target.value }))} style={css.select}>
                    <option value="">Power</option>{powerAdders.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <select name="fuel" value={vehicle.fuel} onChange={e => setVehicle(v => ({ ...v, fuel: e.target.value }))} style={css.select}>
                    <option value="">Fuel</option>{fuels.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <select name="gear" value={vehicle.gear} onChange={e => setVehicle(v => ({ ...v, gear: e.target.value }))} style={css.select}>
                    <option value="">Rear Gear</option>{gearRatios.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                  <select name="tire" value={vehicle.tire} onChange={e => setVehicle(v => ({ ...v, tire: e.target.value }))} style={css.select}>
                    <option value="">Tire Height</option>{tireHeights.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button onClick={submitToLeaderboard} disabled={submitting} style={{ ...css.btnPrimary, width: '100%', textAlign: 'center' }}>
                  {submitting ? 'Submitting…' : '🏆 Submit to Leaderboard'}
                </button>
                {!user && (
                  <p style={{ fontSize: 11, color: T.amber, margin: 0, textAlign: 'center' }}>
                    Sign in required to submit
                  </p>
                )}
                {status && !showEmailForm && (
                  <p style={{ fontSize: 12, color: status.startsWith('✅') ? T.green : status.startsWith('❌') ? T.red : T.muted, margin: 0, textAlign: 'center' }}>
                    {status}
                  </p>
                )}
              </div>
            </div>
          </aside>

          {/* ── COL 2: Graph + AI Review ──────────────── */}
          <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>

            {/* Speed graph */}
            <div style={css.card}>
              <p style={css.sectionTitle}>Speed vs Time — {interval} mph</p>
              {graphData ? (
                <>
                  <div style={{ height: 280 }}>
                    <Line data={graphData} options={graphData.options}/>
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {summary['Log 1'] && (
                      <span style={{ fontSize: 12, padding: '4px 12px', background: 'rgba(61,255,122,0.08)', borderRadius: 99, color: T.green }}>
                        🚀 {log1Name || 'Log 1'}: {summary['Log 1']}s
                      </span>
                    )}
                    {summary['Log 2'] && (
                      <span style={{ fontSize: 12, padding: '4px 12px', background: 'rgba(77,184,255,0.08)', borderRadius: 99, color: T.blue }}>
                        🚀 {log2Name || 'Log 2'}: {summary['Log 2']}s
                      </span>
                    )}
                    {summary['Log 1'] && summary['Log 2'] && (
                      <span style={{ fontSize: 12, padding: '4px 12px', background: T.amberLo, borderRadius: 99, color: T.amber }}>
                        Δ {Math.abs(summary['Log 1'] - summary['Log 2']).toFixed(3)}s difference
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.faint, fontSize: 13, flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 28 }}>📈</span>
                  Upload a log and click Generate Graph
                </div>
              )}
            </div>

            {/* AI Review panel */}
            <div style={css.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                <p style={{ ...css.sectionTitle, margin: 0 }}>AI Log Review — Log 1</p>
                <button
                  onClick={() => log1File && runLogReview(log1File)}
                  disabled={!log1File || reviewLoading}
                  style={{ ...css.btnGhost, fontSize: 12, opacity: (!log1File || reviewLoading) ? 0.5 : 1 }}>
                  {reviewLoading ? '⏳ Reviewing…' : '↻ Re-run'}
                </button>
              </div>

              {!log1File && (
                <div style={{ padding: '24px 0', textAlign: 'center', color: T.faint, fontSize: 13 }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>🤖</div>
                  Upload Log 1 to generate an AI review
                </div>
              )}

              {reviewLoading && (
                <div style={{ display: 'grid', gap: 8 }}>
                  {[85, 65, 75, 55, 80].map((w, i) => (
                    <Skeleton key={i} height={14} width={`${w}%`} style={{ animationDelay: `${i * 0.12}s` }}/>
                  ))}
                </div>
              )}

              {reviewError && !reviewLoading && (
                <div style={{ padding: '10px 14px', background: 'rgba(255,82,82,0.08)', borderRadius: 7, border: `1px solid rgba(255,82,82,0.2)`, fontSize: 13, color: T.red }}>
                  {reviewError}
                </div>
              )}

              {!reviewLoading && reviewLines.length > 0 && (
                <div>
                  {reviewLines.map((l, i) => {
                    const colors = { ok: T.green, warn: T.amber, stat: T.blue, info: T.muted };
                    const bgs    = { ok: 'rgba(61,255,122,0.05)', warn: 'rgba(245,166,35,0.06)', stat: 'rgba(77,184,255,0.05)', info: 'transparent' };
                    return (
                      <div key={i} style={{ padding: '6px 10px', borderRadius: 6, background: bgs[l.type], marginBottom: 3 }}>
                        <span style={{ fontSize: 13, lineHeight: 1.5, color: colors[l.type], whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {l.line}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── COL 3: Leaderboard ────────────────────── */}
          <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
            <div style={css.card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 8 }}>
                <p style={{ ...css.sectionTitle, margin: 0 }}>Leaderboard — {interval}</p>
                <button onClick={fetchLeaderboard} disabled={loadingLB} style={{ ...css.btnGhost, fontSize: 12 }}>
                  {loadingLB ? '⏳' : '↻ Refresh'}
                </button>
              </div>

              {/* Filters */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
                <select value={filters.year} onChange={e => setFilters(f => ({ ...f, year: e.target.value }))} style={{ ...css.select, fontSize: 12 }}>
                  <option value="">Year</option>{years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <select value={filters.model} onChange={e => setFilters(f => ({ ...f, model: e.target.value }))} style={{ ...css.select, fontSize: 12 }}>
                  <option value="">Model</option>{models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <select value={filters.engine} onChange={e => setFilters(f => ({ ...f, engine: e.target.value }))} style={{ ...css.select, fontSize: 12 }}>
                  <option value="">Engine</option>{engines.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
                <select value={filters.power} onChange={e => setFilters(f => ({ ...f, power: e.target.value }))} style={{ ...css.select, fontSize: 12 }}>
                  <option value="">Power</option>{powerAdders.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
                <select value={filters.fuel} onChange={e => setFilters(f => ({ ...f, fuel: e.target.value }))} style={{ ...css.select, fontSize: 12 }}>
                  <option value="">Fuel</option>{fuels.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
                <select value={sort} onChange={e => setSort(e.target.value)} style={{ ...css.select, fontSize: 12 }}>
                  <option value="time_seconds:asc">Fastest first</option>
                  <option value="time_seconds:desc">Slowest first</option>
                  <option value="created_at:desc">Newest first</option>
                </select>
              </div>

              {/* Table */}
              {loadingLB ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  {[1,2,3,4,5].map(i => <Skeleton key={i} height={36}/>)}
                </div>
              ) : leaderboard.results.length ? (
                <div style={{ overflowX: 'auto', borderRadius: 8, border: `1px solid ${T.border}`, maxHeight: 520, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                    <thead>
                      <tr style={{ background: '#0d150d' }}>
                        {['#','Name','Year','Model','Power','Time',''].map((h, i) => (
                          <th key={i} style={{
                            position: 'sticky', top: 0, background: '#0d150d',
                            textAlign: i === 5 ? 'right' : i === 6 ? 'center' : 'left',
                            padding: '8px 10px', fontSize: 11, color: T.muted,
                            fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase',
                            borderBottom: `1px solid ${T.border}`,
                            width: [36, 100, 50, 90, 80, 70, 80][i],
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.results.map((r, idx) => {
                        const isTop = idx < 3;
                        return (
                          <tr key={r.id} className={`lb-row${isTop ? ' lb-row-top' : ''}`}>
                            <td style={{ width: 36, textAlign: 'center' }}><RankMedal rank={idx + 1}/></td>
                            <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.user_alias || 'Anon'}
                            </td>
                            <td style={{ color: T.muted }}>{r.vehicle_year || r.year || '—'}</td>
                            <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.muted }}>
                              {r.vehicle_model || r.model || '—'}
                            </td>
                            <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.muted }}>
                              {r.vehicle_power || r.power || '—'}
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 700, color: isTop ? T.green : T.text, fontVariantNumeric: 'tabular-nums' }}>
                              {Number.isFinite(r.time_seconds) ? Number(r.time_seconds).toFixed(2) : '—'}s
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <button style={{ ...css.btnGhost, padding: '4px 10px', fontSize: 11 }}
                                onClick={() => overlayLeader(r.id, r.user_alias || 'Leader')}>
                                Overlay
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '32px 0', color: T.faint, fontSize: 13 }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>🏁</div>
                  No runs yet for this interval
                </div>
              )}

              {leaderboard.total > 0 && (
                <p style={{ fontSize: 11, color: T.faint, marginTop: 8, textAlign: 'right' }}>
                  {leaderboard.total} total run{leaderboard.total !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          </div>

        </div>{/* /3-col */}
      </div>

      <FeedbackModal
        open={showFeedback}
        onClose={() => setShowFeedback(false)}
        onSubmit={handleSubmitFeedback}
        defaultPage="/log-comparison"
      />
    </div>
  );
}
