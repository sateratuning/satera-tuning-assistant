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

const API_BASE = process.env.REACT_APP_API_BASE || ''; // same-origin proxy or full URL

// ===== Styling =====
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
  input: {
    width: '100%', maxWidth: 360,
    background: '#0f130f', border: '1px solid #1e2b1e',
    borderRadius: 8, padding: '9px 11px', color: '#d9ffe0', outline: 'none'
  },
  select: {
    width: '100%', maxWidth: 360,
    background: '#0f130f', border: '1px solid #1e2b1e',
    borderRadius: 8, padding: '9px 11px', color: '#d9ffe0', outline: 'none'
  },
};

// ===== Helpers: Mask display name =====
const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const maskNameString = (raw) => {
  if (!raw) return 'User';
  let s = raw.trim();
  s = s.replace(/@.*$/, '');
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

// ===== Component =====
export default function LogComparison() {
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1100);
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 1100);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 🔐 AUTH state
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('');
  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u || null)), []);

  // Logs & files
  const [log1, setLog1] = useState(null);
  const [log2, setLog2] = useState(null);
  const [log1File, setLog1File] = useState(null);
  const [log2File, setLog2File] = useState(null);

  // Graph, review
  const [graphData, setGraphData] = useState(null);
  const [summary, setSummary] = useState({});
  const [interval, setInterval] = useState('60-130');
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewText, setReviewText] = useState('');
  const [reviewError, setReviewError] = useState('');

  // ====== FIXED: review runner (/ai-review) ======
  const runLogReview = async (file) => {
    if (!file) return;
    setReviewLoading(true);
    setReviewText('');
    setReviewError('');
    try {
      const form = new FormData();
      form.append('log', file);
      const res = await fetch(`${API_BASE}/ai-review`, { method: 'POST', body: form });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `Review failed with status ${res.status}`);
      }
      const text = await res.text();
      setReviewText(text || 'No output returned.');
    } catch (err) {
      setReviewError(err?.message || 'Log review failed.');
    } finally {
      setReviewLoading(false);
    }
  };

  // ====== FIXED: CSV parsing (looser matching) ======
  const parseCSV = (raw) => {
    const rows = raw.trim().split('\n');
    if (rows.length < 20) return null;
    const headers = rows[15].split(',').map(h => h.trim().toLowerCase());
    const dataRows = rows.slice(19);

    const colIndex = (needle) => headers.findIndex(h => h.includes(needle.toLowerCase()));
    const speedIndex = colIndex('vehicle speed');
    const timeIndex  = colIndex('offset');

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
      setStatus(parsed ? 'CSV parsed.' : 'Failed to parse CSV (check format).');
      if (setParsed === setLog1 && file) runLogReview(file); // auto-run review on Log1
    };
    reader.readAsText(file);
  };

  // ====== Runs and Graph ======
  const ranges = useMemo(() => ({ '0-60':[0,60],'40-100':[40,100],'60-130':[60,130] }), []);
  const getBestRun = (log, startMPH, endMPH) => {
    if (!log) return null;
    const { time, speed } = log;
    let startTime = null;
    for (let i=1;i<speed.length;i++){
      const v = speed[i];
      if (startTime===null && v>=startMPH && v<endMPH) startTime=time[i];
      if (startTime!==null && v>=endMPH) return {duration: +(time[i]-startTime).toFixed(3),data:[]};
    }
    return null;
  };
  const computeBestForInterval = (logObj) => {
    if (!logObj) return null;
    const [start,end] = ranges[interval];
    const best = getBestRun(logObj,start,end);
    return best ? best.duration : null;
  };
  const handleGenerateGraph = () => {
    if (!log1 && !log2) { alert('Upload at least Log 1'); return; }
    const [startMPH,endMPH]=ranges[interval];
    const r1 = log1?getBestRun(log1,startMPH,endMPH):null;
    const r2 = log2?getBestRun(log2,startMPH,endMPH):null;
    if (!r1 && !r2) { alert(`No valid ${interval} run found.`); return; }
    const datasets=[];
    if(r1)datasets.push({label:`Log 1: ${r1.duration}s`,data:r1.data||[],parsing:false});
    if(r2)datasets.push({label:`Log 2: ${r2.duration}s`,data:r2.data||[],parsing:false});
    setGraphData({datasets,options:{scales:{x:{title:{display:true,text:'Time (s)',color:'#adff2f'}},y:{title:{display:true,text:'Speed (mph)',color:'#adff2f'}}}}});
    setSummary({'Log 1':r1?.duration||null,'Log 2':r2?.duration||null});
  };

  // ====== Render ======
  return (
    <div style={styles.page}>
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

      <div style={styles.shell}>
        <div style={styles.card}>
          <h3>Upload Logs</h3>
          <input type="file" accept=".csv" onChange={(e)=>handleFileChange(e,setLog1,setLog1File)} />
          <input type="file" accept=".csv" onChange={(e)=>handleFileChange(e,setLog2,setLog2File)} />
          <button onClick={handleGenerateGraph} style={styles.button}>Generate Graph</button>
          <span>{status}</span>
        </div>

        {graphData && (
          <div style={styles.card}>
            <Line data={graphData} options={graphData.options}/>
            <div>
              <strong>Best Acceleration Times:</strong><br/>
              {summary['Log 1'] && <>🚀 {interval} (L1): {summary['Log 1']}s<br/></>}
              {summary['Log 2'] && <>🚀 {interval} (L2): {summary['Log 2']}s</>}
            </div>
          </div>
        )}

        <div style={styles.card}>
          <h3>Log Review (Primary Log)</h3>
          <button onClick={()=>log1File && runLogReview(log1File)} disabled={!log1File || reviewLoading} style={styles.smallBtn}>
            {reviewLoading?'Reviewing…':'Re-run Review'}
          </button>
          {reviewError && <p style={{color:'#f88'}}>{reviewError}</p>}
          {reviewText && <pre style={{whiteSpace:'pre-wrap'}}>{reviewText}</pre>}
        </div>
      </div>

      <FeedbackModal open={false} onClose={()=>{}} onSubmit={()=>{}} defaultPage="/log-comparison"/>
    </div>
  );
}
