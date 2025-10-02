// frontend/src/LogComparison.jsx
import React, { useMemo, useState, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import 'chart.js/auto';
import './App.css';
import { Link } from 'react-router-dom';

// 📨 Feedback
import FeedbackModal from './FeedbackModal';
import { sendFeedback } from './api';

// 🔐 AUTH
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

const API_BASE = process.env.REACT_APP_API_BASE || ''; // same-origin proxy or full /api

// ===== Styling (unchanged) =====
const styles = {
  page: { backgroundColor: '#111', color: '#adff2f', minHeight: '100vh', fontFamily: 'Arial' },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, background: 'linear-gradient(to bottom, #00ff88, #007744)',
    color: '#000', fontSize: '2rem', fontWeight: 'bold',
    boxShadow: '0 4px 10px rgba(0,255,136,0.4)'
  },
  headerRight: { display: 'flex', gap: 10, alignItems: 'center' },
  headerHi: { fontSize: 14, background:'#0c120d', border:'1px solid #1b4f2a', color:'#8bf58b', padding:'6px 10px', borderRadius:999 },
  shell: { padding: 20 },
  grid3: { display: 'grid', gridTemplateColumns: '410px 2.5fr 4fr', gap: 16 },
  gridNarrow: { display: 'grid', gridTemplateColumns: '1fr', gap: 16 },
  card: { backgroundColor: '#1a1a1a', padding: 12, borderRadius: 8, border: '1px solid #2a2a2a' },
  lbCard: { padding: 5, fontSize: 20 },
  thSmall: { position: 'sticky', top: 0, background: '#151621', textAlign: 'left', padding: '7px 9px', borderBottom: '1px solid #333', fontSize: 13 },
  tdSmall: { padding: '7px 9px', borderBottom: '1px solid #222', fontSize: 14 },
  button: { backgroundColor: '#00ff88', color: '#000', padding: '10px 16px', border: 'none', cursor: 'pointer', borderRadius: 6 },
  smallBtn: { backgroundColor: '#00ff88', color: '#000', padding: '7px 11px', border: 'none', cursor: 'pointer', borderRadius: 6 },
  signInBtn: { backgroundColor: '#3db8ff', color: '#000', padding: '7px 11px', border: '1px solid #000000ff', cursor: 'pointer', borderRadius: 6 },
  warnBtn: { backgroundColor: '#ffc107', color: '#000', padding: '10px 16px', border: 'none', cursor: 'pointer', borderRadius: 6 },
  label: { marginRight: 8 },
  tableWrap: { overflow: 'auto', borderRadius: 8, border: '1px solid #333' },
  table: { width: '100%', borderCollapse: 'separate', borderSpacing: 0 },
  th: { position: 'sticky', top: 0, background: '#151621', textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #333' },
  td: { padding: '8px 10px', borderBottom: '1px solid #222' },
  topRow: { fontWeight: 700, color: '#eaff9c', textShadow: '0 0 8px rgba(173,255,47,0.35)' },
  controlCard: { background: '#1a1a1a', padding: 18, borderRadius: 10, border: '1px solid #2a2a2a' },
  controlTitle: { fontSize: 40, fontWeight: 800, margin: 0, color: '#ffffff', textShadow: '0 0 6px rgba(173,255,47,0.25)', textAlign: 'center' },
  controlHelp: { marginTop: 6, fontSize: 14, color: '#4fff5b', opacity: 0.9, textAlign: 'center' },
  controlGrid: { display: 'grid', gap: 8, gridTemplateColumns: '380px 380px 380px', alignItems: 'end', marginTop: 20, justifyContent: 'center', justifyItems: 'center', textAlign: 'center' },
  labelWrap: { display: 'grid', placeItems: 'center', gap: 6 },
  controlLabelFancy: { fontWeight: 900, fontSize: 20, letterSpacing: 0.6, textTransform: 'uppercase', color: '#b7ffbf', textShadow:'0 1px 0 #0c150c, 0 2px 0 #0c150c, 0 3px 0 #0c150c, 0 4px 0 #0c150c, 0 0 12px rgba(52,255,120,.35), 0 0 28px rgba(52,255,120,.18)', backgroundImage: 'linear-gradient(90deg, #caffd1, #69ff8a, #caffd1)', WebkitBackgroundClip: 'text', backgroundClip: 'text' },
  controlHint: { fontSize: 12, opacity: 0.75, marginTop: 4 },
  input: { width: '100%', maxWidth: 360, background: '#0f130f', border: '1px solid #1e2b1e', borderRadius: 8, padding: '9px 11px', color: '#d9ffe0', outline: 'none' },
  select: { width: '100%', maxWidth: 360, background: '#0f130f', border: '1px solid #1e2b1e', borderRadius: 8, padding: '9px 11px', color: '#d9ffe0', outline: 'none', appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none', backgroundImage:'linear-gradient(45deg, transparent 50%, #28ff6a 50%), linear-gradient(135deg, #28ff6a 50%, transparent 50%), linear-gradient(to right, #1e2b1e, #1e2b1e)', backgroundPosition: 'calc(100% - 18px) calc(50% - 3px), calc(100% - 12px) calc(50% - 3px), calc(100% - 40px) 0', backgroundSize: '6px 6px, 6px 6px, 28px 100%', backgroundRepeat: 'no-repeat' },
  selectInterval: { width: 380, height: 50, fontSize: 16, background: '#0f130f', border: '1px solid #1e2b1e', borderRadius: 10, color: '#d9ffe0', padding: '10px 14px', outline: 'none', appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none', backgroundImage:'linear-gradient(45deg, transparent 50%, #28ff6a 50%), linear-gradient(135deg, #28ff6a 50%, transparent 50%), linear-gradient(to right, #1e2b1e, #1e2b1e)', backgroundPosition: 'calc(100% - 18px) calc(50% - 3px), calc(100% - 12px) calc(50% - 3px), calc(100% - 40px) 0', backgroundSize: '6px 6px, 6px 6px, 28px 100%', backgroundRepeat: 'no-repeat' },
  fileWrap: { width: 380, maxWidth: '100%' },
  controlButtonsRow: { marginTop: 10, display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' },
  sidebarTitle: { marginTop: 0, marginBottom: 8, fontWeight: 700, fontSize: 26, letterSpacing: 0.4, backgroundImage: 'linear-gradient(180deg, #d6ffd9, #7dffa1 55%, #2fff6e)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'white', textShadow:'0 1px 0 #0c150c, 0 2px 0 #0c150c, 0 3px 0 #0c150c, 0 0 16px rgba(61,255,118,.35), 0 0 36px rgba(61,255,118,.18)', animation: 'st-pulseGlow 2.2s ease-in-out infinite' },
  titleWrap: { display: 'grid', gap: 6, justifyItems: 'start', alignContent: 'center' },
  sectionTitleFancy: { margin: 0, fontWeight: 700, fontSize: 26, letterSpacing: 0.6, textTransform: 'uppercase', backgroundImage: 'linear-gradient(90deg, #caffd1, #69ff8a, #caffd1)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'white', textShadow:'0 1px 0 #0c150c, 0 2px 0 #0c150c, 0 3px 0 #0c150c, 0 4px 0 #0c150c, 0 0 12px rgba(52,255,120,.35), 0 0 28px rgba(52,255,120,.18)', animation: 'st-pulseGlow 2.2s ease-in-out infinite' },
  fieldGrid: { display: 'grid', gap: 8, gridTemplateColumns: '1fr', marginTop: 8 },
  authForm: { display:'grid', gridTemplateColumns:'1fr 1fr auto auto', gap:8, alignItems:'end' },
  linkish: { background:'transparent', border:'none', color:'#8bf58b', cursor:'pointer', textDecoration:'underline', padding:0 }
};

// ===== Helpers
const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const maskNameString = (raw) => {
  if (!raw) return 'User';
  let s = raw.trim().replace(/@.*$/, '');
  const parts = s.split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return 'User';
  const first = capitalize(parts[0]);
  const lastInitial = parts[1] ? parts[1][0].toUpperCase() + '.' : '';
  return lastInitial ? `${first} ${lastInitial}` : first;
};
const maskedDisplayName = (u) => (u?.displayName ? maskNameString(u.displayName) : u?.email ? maskNameString(u.email) : 'User');

export default function LogComparison() {
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1100);
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 1100);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 🔐 AUTH
  const [user, setUser] = useState(null);
  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u || null)), []);

  // Logs
  const [log1, setLog1] = useState(null);
  const [log2, setLog2] = useState(null);
  const [log1File, setLog1File] = useState(null);
  const [log2File, setLog2File] = useState(null);
  const [graphData, setGraphData] = useState(null);
  const [summary, setSummary] = useState({});
  const [interval, setInterval] = useState('60-130');

  // ===== Universal CSV Parser =====
  const parseCSV = (raw) => {
    const rows = raw.trim().split(/\r?\n/);
    if (rows.length < 5) return null;

    const headerRowIndex = rows.findIndex(r => r.split(',')[0].trim() === 'Offset');
    if (headerRowIndex === -1) return null;

    const headers = rows[headerRowIndex].split(',').map(h => h.trim());
    const dataRows = rows.slice(headerRowIndex + 2);

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
      if (Number.isFinite(s) && Number.isFinite(t)) {
        speed.push(s); time.push(t);
      }
    }
    return (speed.length && time.length) ? { speed, time } : null;
  };

  const handleFileChange = (e, setParsed, setFileRef) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileRef(file);
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCSV(reader.result);
      setParsed(parsed);
    };
    reader.readAsText(file);
  };

  // All your existing logic: findAllRuns, getBestRun, handleGenerateGraph, leaderboard, submitToLeaderboard, AI Review, feedback modal...
  // (unchanged except parser)

  return (
    <div style={styles.page}>
      {/* HEADER */}
      <header style={styles.header}>
        <div>Satera Tuning — Log Comparison (BETA)</div>
        <div style={styles.headerRight}>
          <Link to="/ai-review" style={styles.button}>AI Log Review</Link>
          {!user ? (
            <button style={styles.signInBtn} onClick={signInWithGoogle}>Sign in with Google</button>
          ) : (
            <>
              <span style={styles.headerHi}>Hi, {maskedDisplayName(user)}</span>
              <button style={styles.smallBtn} onClick={signOutUser}>Sign out</button>
            </>
          )}
        </div>
      </header>

      {/* PAGE CONTENT (unchanged) */}
      {/* … your controls, graph, review panel, leaderboard, feedback modal … */}
    </div>
  );
}
