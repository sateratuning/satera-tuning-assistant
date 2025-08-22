// frontend/src/LogComparison.jsx
import React, { useMemo, useState, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import 'chart.js/auto';
import './App.css';

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

const API_BASE = process.env.REACT_APP_API_BASE || ''; // same-origin proxy or full http://localhost:5000

// ===== dropdown data =====
const years = Array.from({ length: 21 }, (_, i) => String(2005 + i)); // 2005–2025
const models = ['Charger','Challenger','Durango SRT','Jeep SRT8','Trackhawk','Ram TRX','300C SRT8','Magnum SRT8','Other'];
const engines = ['Pre-eagle 5.7L','Eagle 5.7L','6.1L','6.4L (392)','Hellcat 6.2L','HO Hellcat 6.2L','Other'];
const injectors = ['Stock','ID1050x','ID1300x','ID1700x','Other'];
const mapSensors = ['OEM 1 bar','2 bar','3 bar','Other'];
const throttles = ['Stock','84mm','90mm','95mm','105mm','108mm','112mm','120mm','130mm','Other'];
const powerAdders = ['N/A','PD blower','Centrifugal','Turbo','Nitrous'];
const transmissions = ['Manual','5-speed auto','6-speed auto','8-speed auto'];
const tireHeights = ['26"','27"','28"','29"','30"','31"','32"','Other'];
const gearRatios = ['2.62','2.82','3.09','3.23','3.55','3.73','3.92','4.10','Other'];
const fuels = ['91','93','E85','Race Gas'];

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
  headerRight: { display: 'flex', gap: 10, alignItems: 'center' },
  headerHi: { fontSize: 14, background:'#0c120d', border:'1px solid #1b4f2a', color:'#8bf58b', padding:'6px 10px', borderRadius:999 },

  shell: { padding: 20 },

  /* 3-col layout: LEFT (vehicle), CENTER (graph), RIGHT (leaderboard) */
  grid3: { display: 'grid', gridTemplateColumns: '410px 2.5fr 4fr', gap: 16 },
  gridNarrow: { display: 'grid', gridTemplateColumns: '1fr', gap: 16 },

  card: { backgroundColor: '#1a1a1a', padding: 12, borderRadius: 8, border: '1px solid #2a2a2a' },

  // Leaderboard-only tweaks
  lbCard: { padding: 5, fontSize: 20 },
  thSmall: { position: 'sticky', top: 0, background: '#151621', textAlign: 'left', padding: '7px 9px', borderBottom: '1px solid #333', fontSize: 13 },
  tdSmall: { padding: '7px 9px', borderBottom: '1px solid #222', fontSize: 14 },

  // Buttons / labels
  button: { backgroundColor: '#00ff88', color: '#000', padding: '10px 16px', border: 'none', cursor: 'pointer', borderRadius: 6 },
  smallBtn: { backgroundColor: '#00ff88', color: '#000', padding: '7px 11px', border: 'none', cursor: 'pointer', borderRadius: 6 },

  // 🔵 Sign-in buttons
  signInBtn: { backgroundColor: '#3db8ff', color: '#000', padding: '7px 11px', border: '1px solid #000000ff', cursor: 'pointer', borderRadius: 6 },

  warnBtn: { backgroundColor: '#ffc107', color: '#000', padding: '10px 16px', border: 'none', cursor: 'pointer', borderRadius: 6 },

  label: { marginRight: 8 },
  tableWrap: { overflow: 'auto', borderRadius: 8, border: '1px solid #333' },
  table: { width: '100%', borderCollapse: 'separate', borderSpacing: 0 },
  th: { position: 'sticky', top: 0, background: '#151621', textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #333' },
  td: { padding: '8px 10px', borderBottom: '1px solid #222' },
  topRow: { fontWeight: 700, color: '#eaff9c', textShadow: '0 0 8px rgba(173,255,47,0.35)' },

  // Controls pad (top)
  controlCard: { background: '#1a1a1a', padding: 18, borderRadius: 10, border: '1px solid #2a2a2a' },
  controlTitle: { fontSize: 40, fontWeight: 800, margin: 0, color: '#ffffff', textShadow: '0 0 6px rgba(173,255,47,0.25)', textAlign: 'center' },
  controlHelp: { marginTop: 6, fontSize: 14, color: '#4fff5b', opacity: 0.9, textAlign: 'center' },

  /* Centered, tighter row for Interval + Log1 + Log2 */
  controlGrid: {
    display: 'grid',
    gap: 8,
    gridTemplateColumns: '380px 380px 380px',
    alignItems: 'end',
    marginTop: 20,
    justifyContent: 'center',
    justifyItems: 'center',
    textAlign: 'center'
  },

  /* ======= FANCY LABELS (top card titles) ======= */
  labelWrap: { display: 'grid', placeItems: 'center', gap: 6 },
  controlLabelFancy: {
    fontWeight: 900,
    fontSize: 20,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#b7ffbf',
    textShadow:
      '0 1px 0 #0c150c, 0 2px 0 #0c150c, 0 3px 0 #0c150c, 0 4px 0 #0c150c,' +
      '0 0 12px rgba(52,255,120,.35), 0 0 28px rgba(52,255,120,.18)',
    backgroundImage: 'linear-gradient(90deg, #caffd1, #69ff8a, #caffd1)',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text'
  },

  controlHint: { fontSize: 12, opacity: 0.75, marginTop: 4 },

  /* Themed inputs/selects */
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

  /* Bigger Interval dropdown */
  selectInterval: {
    width: 380,
    height: 50,
    fontSize: 16,
    background: '#0f130f',
    border: '1px solid #1e2b1e',
    borderRadius: 10,
    color: '#d9ffe0',
    padding: '10px 14px',
    outline: 'none',
    appearance: 'none',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
    backgroundImage:
      'linear-gradient(45deg, transparent 50%, #28ff6a 50%), linear-gradient(135deg, #28ff6a 50%, transparent 50%), linear-gradient(to right, #1e2b1e, #1e2b1e)',
    backgroundPosition: 'calc(100% - 18px) calc(50% - 3px), calc(100% - 12px) calc(50% - 3px), calc(100% - 40px) 0',
    backgroundSize: '6px 6px, 6px 6px, 28px 100%',
    backgroundRepeat: 'no-repeat',
  },

  /* file input column width so items sit closely */
  fileWrap: { width: 380, maxWidth: '100%' },

  /* Row below for buttons */
  controlButtonsRow: {
    marginTop: 10,
    display: 'flex',
    justifyContent: 'center',
    gap: 10,
    flexWrap: 'wrap'
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

  fieldGrid: { display: 'grid', gap: 8, gridTemplateColumns: '1fr', marginTop: 8 },

  // 🔐 Email form
  authForm: { display:'grid', gridTemplateColumns:'1fr 1fr auto auto', gap:8, alignItems:'end' },
  linkish: { background:'transparent', border:'none', color:'#8bf58b', cursor:'pointer', textDecoration:'underline', padding:0 }
};

// ===== Helpers: mask display name to "First L."
const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const maskNameString = (raw) => {
  if (!raw) return 'User';
  let s = raw.trim();
  s = s.replace(/@.*$/, ''); // strip domain if email
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

  // 🔐 Email/password state
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  // 📨 Feedback modal state
  const [showFeedback, setShowFeedback] = useState(false);

  // logs & files
  const [log1, setLog1] = useState(null);
  const [log2, setLog2] = useState(null);
  const [log1File, setLog1File] = useState(null);
  const [log2File, setLog2File] = useState(null);

  // UI
  const [graphData, setGraphData] = useState(null);
  const [leaderOverlay, setLeaderOverlay] = useState(null); // {label, data:[{x,y}]}
  const [summary, setSummary] = useState({});
  const [interval, setInterval] = useState('60-130');

  // vehicle (only name is free text; locked to masked auth name when signed in)
  const [vehicle, setVehicle] = useState({
    name: '', year: '', model: '', engine: '', injectors: '', map: '',
    throttle: '', power: '', trans: '', tire: '', gear: '', fuel: ''
  });

  const parseCSV = (raw) => {
    const rows = raw.trim().split('\n');
    if (rows.length < 20) return null;
    const headers = rows[15].split(',').map(h => h.trim());
    const dataRows = rows.slice(19);
    const col = (name) => headers.findIndex(h => h === name);
    const speedIndex = col('Vehicle Speed (SAE)');
    const timeIndex  = col('Offset');
    if (speedIndex === -1 || timeIndex === -1) return null;

    const speed = [], time = [];
    for (let row of dataRows) {
      if (!row || !row.includes(',')) continue;
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
    };
    reader.readAsText(file);
  };

  const ranges = useMemo(() => ({
    '0-60': [0, 60],
    '40-100': [40, 100],
    '60-130': [60, 130]
  }), []);

  const findAllRuns = (log, startMPH, endMPH) => {
    const { time, speed } = log;
    const runs = [];
    let startTime = null;
    let foundStop = false;

    for (let i = 1; i < speed.length; i++) {
      const v = speed[i];

      if (startMPH === 0) {
        // Allow slight staging creep then detect clean launch
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
          if (time[j] >= startTime && time[j] <= endTime) {
            seg.data.push({ x: +(time[j] - startTime).toFixed(3), y: speed[j] });
          }
        }
        runs.push(seg);
        startTime = null;
        if (startMPH === 0) foundStop = false; // look for next clean stop->go segment
      }

      // Reset if the run blew past the target by too much
      if (startTime !== null && v > endMPH + 10) startTime = null;
    }
    return runs;
  };

  const getBestRun = (log, startMPH, endMPH) => {
    const runs = findAllRuns(log, startMPH, endMPH);
    if (!runs.length) return null;
    return runs.reduce((min, r) => (r.duration < min.duration ? r : min));
  };

  const computeBestForInterval = (logObj) => {
    if (!logObj) return null;
    const [start, end] = ranges[interval];
    const best = getBestRun(logObj, start, end);
    return best ? best.duration : null;
  };

  // 🔐 Google sign-in
  const handleGoogleLogin = async () => {
    try {
      await signInWithGoogle();
      setStatus('');
    } catch (e) {
      if (e?.code === 'auth/popup-closed-by-user') {
        setStatus('Sign-in canceled.');
      } else {
        setStatus(`Sign-in error: ${e?.message || e}`);
      }
    }
  };

  // 🔐 Email/password handlers
  const handleEmailSignIn = async () => {
    if (!email || !pw) { setStatus('Enter email and password.'); return; }
    try {
      setAuthBusy(true);
      await signInWithEmailAndPassword(auth, email.trim(), pw);
      setStatus('Signed in.');
      setPw('');
      setShowEmailForm(false);
    } catch (e) {
      setStatus(e?.message || 'Sign-in failed.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleEmailSignUp = async () => {
    if (!email || !pw) { setStatus('Enter email and password.'); return; }
    try {
      setAuthBusy(true);
      await createUserWithEmailAndPassword(auth, email.trim(), pw);
      setStatus('Account created & signed in.');
      setPw('');
      setShowEmailForm(false);
    } catch (e) {
      setStatus(e?.message || 'Sign-up failed.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) { setStatus('Enter your email to reset password.'); return; }
    try {
      setAuthBusy(true);
      await sendPasswordResetEmail(auth, email.trim());
      setStatus('Password reset email sent.');
    } catch (e) {
      setStatus(e?.message || 'Could not send reset email.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGenerateGraph = (forcedOverlay = undefined) => {
    if (!log1 && !log2 && !leaderOverlay && !forcedOverlay) {
      alert('Upload at least Log 1 or use Overlay on a leaderboard row.');
      return;
    }
    const [startMPH, endMPH] = ranges[interval];
    const r1 = log1 ? getBestRun(log1, startMPH, endMPH) : null;
    const r2 = log2 ? getBestRun(log2, startMPH, endMPH) : null;

    if (!r1 && !r2 && !leaderOverlay && !forcedOverlay) {
      alert(`No valid ${interval} run found in your logs.`);
      return;
    }

    const datasets = [];
    let xEnd = 0;

    if (r1) {
      datasets.push({ label: 'Log 1', data: r1.data, borderColor: '#00ff88', tension: 0.1, parsing: false });
      datasets.push({
        label: `${startMPH}–${endMPH}: ${r1.duration}s`,
        data: [{ x: r1.data.at(-1).x, y: r1.data.at(-1).y }],
        pointBackgroundColor: '#ffff00', pointRadius: 6, pointStyle: 'triangle', showLine: false
      });
      xEnd = Math.max(xEnd, r1.duration);
    }
    if (r2) {
      datasets.push({ label: 'Log 2', data: r2.data, borderColor: '#ff00aa', tension: 0.1, parsing: false });
      datasets.push({
        label: `${startMPH}–${endMPH} (L2): ${r2.duration}s`,
        data: [{ x: r2.data.at(-1).x, y: r2.data.at(-1).y }],
        pointBackgroundColor: '#ffff00', pointRadius: 6, pointStyle: 'triangle', showLine: false
      });
      xEnd = Math.max(xEnd, r2.duration);
    }

    const overlayToUse = forcedOverlay !== undefined ? forcedOverlay : leaderOverlay;
    if (overlayToUse) {
      datasets.push({
        label: overlayToUse.label,
        data: overlayToUse.data || [],
        borderColor: '#ffd700',
        borderDash: [6, 4],
        tension: 0.1,
        parsing: false
      });
      const lastX = overlayToUse.data?.length ? overlayToUse.data.at(-1).x : 0;
      xEnd = Math.max(xEnd, lastX);
    }

    xEnd += 0.5;

    setGraphData({
      datasets,
      options: {
        responsive: true,
        plugins: {
          tooltip: { callbacks: { label: ctx => `Speed: ${ctx.parsed.y} mph @ ${ctx.parsed.x}s` } },
          legend: { labels: { color: '#adff2f' } }
        },
        scales: {
          x: { type: 'linear', min: 0, max: xEnd, title: { display: true, text: 'Time (s)', color: '#adff2f' }, ticks: { color: '#adff2f' }, grid: { color: '#333' } },
          y: { min: startMPH - 5, max: endMPH + 5, title: { display: true, text: 'Speed (mph)', color: '#adff2f' }, ticks: { color: '#adff2f' }, grid: { color: '#333' } }
        }
      }
    });

    setSummary({ 'Log 1': r1?.duration || null, 'Log 2': r2?.duration || null });
  };

  const handleVehicleChange = (e) => {
    const { name, value } = e.target;
    setVehicle(v => ({ ...v, [name]: value }));
  };

  const [leaderboard, setLeaderboard] = useState({ results: [], total: 0 });
  const [loadingLB, setLoadingLB] = useState(false);
  const [filters, setFilters] = useState({ year: '', model: '', engine: '', power: '', fuel: '', trans: '' });
  const [sort, setSort] = useState('time_seconds:asc');

  const fetchLeaderboard = async () => {
    try {
      setLoadingLB(true);
      const params = new URLSearchParams({ interval, limit: '50' });
      if (filters.year)  params.set('year',  filters.year);
      if (filters.model) params.set('model', filters.model);
      if (filters.engine)params.set('engine',filters.engine);
      if (filters.power) params.set('power', filters.power);
      if (filters.fuel)  params.set('fuel',  filters.fuel);
      if (filters.trans) params.set('trans', filters.trans);
      const [sortCol, sortDir] = (sort || 'time_seconds:asc').split(':');
      params.set('sort', sortCol);
      params.set('dir',  sortDir);

      const res = await fetch(`${API_BASE}/api/leaderboard?${params.toString()}`);
      const json = await res.json();
      setLeaderboard({ results: json.results || [], total: json.total ?? (json.results?.length || 0) });
    } catch (e) {
      console.error(e);
      setLeaderboard({ results: [], total: 0 });
    } finally {
      setLoadingLB(false);
    }
  };

  useEffect(() => { fetchLeaderboard(); /* eslint-disable-next-line */ }, [interval, sort]);
  useEffect(() => { fetchLeaderboard(); /* eslint-disable-next-line */ }, [filters.year, filters.model, filters.engine, filters.power, filters.fuel, filters.trans]);

  const overlayLeader = async (runId, label) => {
    try {
      const res = await fetch(`${API_BASE}/api/run/${runId}?interval=${encodeURIComponent(interval)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to fetch run');
      const trace = json.trace || [];
      if (!trace.length) { setStatus('Leader has no valid trace for this interval.'); return; }

      const overlayObj = { label: `${label} (Leader)`, data: trace };
      setLeaderOverlay(overlayObj);
      handleGenerateGraph(overlayObj);
    } catch (e) {
      console.error(e);
      setStatus(`Overlay error: ${String(e.message || e)}`);
    }
  };
  const clearOverlay = () => { setLeaderOverlay(null); handleGenerateGraph(null); };

  const [submitting, setSubmitting] = useState(false);
  const submitToLeaderboard = async () => {
    try {
      setStatus('');

      // 🔐 require sign in
      if (!user) {
        setStatus('Please sign in to submit your run.');
        return;
      }

      const file = log1File || log2File;
      const parsed = log1 || log2;

      if (!file || !parsed) { setStatus('Upload a CSV (Log 1 or Log 2) first.'); return; }
      const best = computeBestForInterval(parsed);
      if (best == null) { setStatus(`No valid ${interval} run found in the uploaded CSV.`); return; }

      // Use masked auth name
      const alias = maskedDisplayName(user);

      const vehicleInfo = {
        ...vehicle,
        name: alias,
        interval,
        timeSeconds: best
      };

      const fd = new FormData();
      fd.append('log', file, file.name || 'log.csv');
      fd.append('vehicleInfo', JSON.stringify(vehicleInfo));
      fd.append('consent', 'true');

      setSubmitting(true);
      setStatus('Submitting run…');

      const idToken = await user.getIdToken();
      const res = await fetch(`${API_BASE}/api/submit-run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: fd
      });

      if (!res.ok) { const t = await res.text(); throw new Error(t || 'Submission failed.'); }
      const json = await res.json();
      setStatus(`Submitted! Run ID: ${json.runId} • ${interval} = ${best.toFixed(2)}s`);
      await fetchLeaderboard();
    } catch (err) {
      console.error(err);
      setStatus(`Error: ${String(err.message || err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  // 📨 Feedback handlers (match your FeedbackModal API)
  const openFeedback = () => {
    setShowFeedback(true);
  };

  // Must return true/false so the modal can show success state
  const handleSubmitFeedback = async ({ email, page, message }) => {
    try {
      await sendFeedback({
        message,
        meta: {
          page: page || 'LogComparison',
          interval,
          user: user ? maskedDisplayName(user) : 'Guest',
          email: email || null,
          status,
        },
      });
      setStatus('Thanks! Your feedback was sent.');
      return true; // tell modal to show "Thanks!" view
    } catch (e) {
      console.error(e);
      setStatus(`Feedback error: ${e?.message || e}`);
      return false; // keep modal on form (it will show alert in your component)
    }
  };

  return (
    <div style={styles.page}>
      {/* Keyframes for fancy headings */}
      <style>{`
        @keyframes st-pulseGlow {
          0%, 100% { text-shadow: 0 1px 0 #0c150c, 0 2px 0 #0c150c, 0 3px 0 #0c150c, 0 0 10px rgba(61,255,118,.18), 0 0 22px rgba(61,255,118,.12); }
          50%      { text-shadow: 0 1px 0 #0c150c, 0 2px 0 #0c150c, 0 3px 0 #0c150c, 0 0 18px rgba(61,255,118,.42), 0 0 36px rgba(61,255,118,.22); }
        }
      `}</style>

      {/* HEADER with sign-in buttons */}
      <header style={styles.header}>
        <div>Satera Tuning — Log Comparison (BETA)</div>

        <div style={styles.headerRight}>
          <button className="feedback-btn" style={styles.smallBtn} onClick={openFeedback}>
            Report a Bug / Send Feedback
          </button>
          {!user ? (
            <>
              <button style={styles.signInBtn} onClick={handleGoogleLogin}>Sign in with Google</button>
              <button
                style={styles.signInBtn}
                onClick={() => { setShowEmailForm(v=>!v); setStatus(''); }}
              >
                {showEmailForm ? 'Hide Email Login' : 'Sign in with Email'}
              </button>
            </>
          ) : (
            <>
              <span style={styles.headerHi}>Hi, {maskedDisplayName(user)}</span>
              <button style={styles.smallBtn} onClick={signOutUser}>Sign out</button>
            </>
          )}
        </div>
      </header>

      <div style={styles.shell}>
        {/* Email/password form (appears below header when toggled) */}
        {!user && showEmailForm && (
          <div style={{ ...styles.card, marginBottom: 12 }}>
            <div style={styles.authForm}>
              <div>
                <label style={{ display:'block', fontSize:12, marginBottom:4, opacity:.8 }}>Email</label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e)=>setEmail(e.target.value)}
                  style={styles.input}
                  autoComplete="email"
                />
              </div>
              <div>
                <label style={{ display:'block', fontSize:12, marginBottom:4, opacity:.8 }}>Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={pw}
                  onChange={(e)=>setPw(e.target.value)}
                  style={styles.input}
                  autoComplete="current-password"
                />
              </div>
              <button disabled={authBusy} onClick={handleEmailSignIn} style={styles.button}>
                {authBusy ? 'Working…' : 'Sign in'}
              </button>
              <button disabled={authBusy} onClick={handleEmailSignUp} style={styles.warnBtn}>
                {authBusy ? 'Working…' : 'Create account'}
              </button>
            </div>
            <div style={{ marginTop:8 }}>
              <button disabled={authBusy} onClick={handleForgotPassword} style={styles.linkish}>
                Forgot password?
              </button>
              {status && <span style={{ marginLeft:12, opacity:.9 }}>{status}</span>}
            </div>
          </div>
        )}

        {/* Controls row */}
        <div style={{ ...styles.controlCard, marginBottom: 20 }}>
          <h3 style={styles.controlTitle}>Upload Logs & Compare to Leaderboard</h3>
          <div style={styles.controlHelp}>
            <b>Step 1:</b> Choose the interval • <b>Step 2:</b> Upload <b>Log 1</b> (required) and <b>Log 2</b> (optional) • <b>Step 3:</b> Click <b>Generate Graph</b> or use <b>Overlay</b> to compare to leaderboard times.
          </div>

          <div style={styles.controlGrid}>
            <div>
              <div style={styles.labelWrap}>
                <span style={styles.controlLabelFancy}>Interval</span>
              </div>
              <select id="intervalSel" value={interval} onChange={(e) => setInterval(e.target.value)} style={styles.selectInterval}>
                <option value="0-60">0–60 mph</option>
                <option value="40-100">40–100 mph</option>
                <option value="60-130">60–130 mph</option>
              </select>
              <div style={styles.controlHint}>Select the interval you want to measure.</div>
            </div>

            <div style={styles.fileWrap}>
              <div style={styles.labelWrap}>
                <span style={styles.controlLabelFancy}>Log 1 (CSV) — Required</span>
              </div>
              <input id="log1Input" type="file" accept=".csv" onChange={(e) => handleFileChange(e, setLog1, setLog1File)} style={{ maxWidth: 360, width: '100%' }} />
              <div style={styles.controlHint}>Export from HP Tuners VCM Scanner as CSV.</div>
            </div>

            <div style={styles.fileWrap}>
              <div style={styles.labelWrap}>
                <span style={styles.controlLabelFancy}>Log 2 (CSV) — Optional</span>
              </div>
              <input id="log2Input" type="file" accept=".csv" onChange={(e) => handleFileChange(e, setLog2, setLog2File)} style={{ maxWidth: 360, width: '100%' }} />
              <div style={styles.controlHint}>Add a second log to compare against Log 1 (optional).</div>
            </div>
          </div>

          <div style={styles.controlButtonsRow}>
            <button onClick={() => handleGenerateGraph()} style={styles.button}>Generate Graph</button>
            {leaderOverlay && <button onClick={clearOverlay} style={styles.warnBtn}>Clear Overlay</button>}
          </div>

          <div style={{ marginTop: 6, textAlign: 'center' }}>
            <span style={{ opacity: 0.9 }}>{status}</span>
          </div>
        </div>

        {/* 3-COLUMN LAYOUT */}
        <div style={isNarrow ? styles.gridNarrow : styles.grid3}>
          {/* LEFT SIDEBAR: Vehicle / Run Details */}
          <aside>
            <div style={styles.card}>
              <h3 style={styles.sidebarTitle}>Vehicle / Run Details</h3>

              <div style={styles.fieldGrid}>
                {/* 🔐 When signed in, lock name and use masked name */}
                <input
                  name="name"
                  placeholder={user ? maskedDisplayName(user) : "Display Name"}
                  value={user ? maskedDisplayName(user) : vehicle.name}
                  onChange={user ? undefined : handleVehicleChange}
                  readOnly={!!user}
                  style={{
                    ...styles.input,
                    ...(user ? { opacity: 0.7, cursor: 'not-allowed' } : null)
                  }}
                />

                <select name="year" value={vehicle.year} onChange={handleVehicleChange} style={styles.select}>
                  <option value="">Year</option>
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>

                <select name="model" value={vehicle.model} onChange={handleVehicleChange} style={styles.select}>
                  <option value="">Model</option>
                  {models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>

                <select name="engine" value={vehicle.engine} onChange={handleVehicleChange} style={styles.select}>
                  <option value="">Engine</option>
                  {engines.map(e => <option key={e} value={e}>{e}</option>)}
                </select>

                <select name="injectors" value={vehicle.injectors} onChange={handleVehicleChange} style={styles.select}>
                  <option value="">Injectors</option>
                  {injectors.map(i => <option key={i} value={i}>{i}</option>)}
                </select>

                <select name="map" value={vehicle.map} onChange={handleVehicleChange} style={styles.select}>
                  <option value="">MAP Sensor</option>
                  {mapSensors.map(m => <option key={m} value={m}>{m}</option>)}
                </select>

                <select name="throttle" value={vehicle.throttle} onChange={handleVehicleChange} style={styles.select}>
                  <option value="">Throttle Body</option>
                  {throttles.map(t => <option key={t} value={t}>{t}</option>)}
                </select>

                <select name="power" value={vehicle.power} onChange={handleVehicleChange} style={styles.select}>
                  <option value="">Power Adder</option>
                  {powerAdders.map(p => <option key={p} value={p}>{p}</option>)}
                </select>

                <select name="trans" value={vehicle.trans} onChange={handleVehicleChange} style={styles.select}>
                  <option value="">Transmission</option>
                  {transmissions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>

                <select name="tire" value={vehicle.tire} onChange={handleVehicleChange} style={styles.select}>
                  <option value="">Tire Height</option>
                  {tireHeights.map(t => <option key={t} value={t}>{t}</option>)}
                </select>

                <select name="gear" value={vehicle.gear} onChange={handleVehicleChange} style={styles.select}>
                  <option value="">Rear Gear</option>
                  {gearRatios.map(g => <option key={g} value={g}>{g}</option>)}
                </select>

                <select name="fuel" value={vehicle.fuel} onChange={handleVehicleChange} style={styles.select}>
                  <option value="">Fuel</option>
                  {fuels.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>

              <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button onClick={submitToLeaderboard} disabled={submitting} style={styles.button}>
                  {submitting ? 'Submitting…' : 'Submit to Leaderboard'}
                </button>
                <span style={{ opacity: 0.9 }}>{status}</span>
              </div>
            </div>
          </aside>

          {/* CENTER: Graph */}
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ ...styles.card }}>
              <div style={styles.titleWrap}>
                <h3 style={styles.sectionTitleFancy}>Speed vs Time ({interval} mph)</h3>
              </div>

              {graphData ? (
                <div style={{ height: 500 }}>
                  <Line data={graphData} options={graphData.options} />
                </div>
              ) : (
                <div style={{ opacity: 0.8 }}>Upload logs and click “Generate Graph”.</div>
              )}
              {graphData && (
                <div style={{ marginTop: 12 }}>
                  <strong>Best Acceleration Times:</strong><br />
                  {summary['Log 1'] && <>🚀 {interval} (L1): {summary['Log 1']}s<br /></>}
                  {summary['Log 2'] && <>🚀 {interval} (L2): {summary['Log 2']}s</>}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Leaderboard */}
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ ...styles.card, ...styles.lbCard }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <div style={styles.titleWrap}>
                    <span style={styles.sectionTitleFancy}>Leaderboard — {interval}</span>
                  </div>
                </div>
                <button onClick={fetchLeaderboard} disabled={loadingLB} style={styles.button}>
                  {loadingLB ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>

              {/* Filters */}
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', marginTop: 10 }}>
                <select value={filters.year}  onChange={(e)=>setFilters(f=>({...f,year: e.target.value}))}  style={styles.select}><option value="">Year</option>{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
                <select value={filters.model} onChange={(e)=>setFilters(f=>({...f,model:e.target.value}))} style={styles.select}><option value="">Model</option>{models.map(m => <option key={m} value={m}>{m}</option>)}</select>
                <select value={filters.engine}onChange={(e)=>setFilters(f=>({...f,engine:e.target.value}))} style={styles.select}><option value="">Engine</option>{engines.map(x => <option key={x} value={x}>{x}</option>)}</select>
                <select value={filters.power} onChange={(e)=>setFilters(f=>({...f,power:e.target.value}))}  style={styles.select}><option value="">Power</option>{powerAdders.map(x => <option key={x} value={x}>{x}</option>)}</select>
                <select value={filters.fuel}  onChange={(e)=>setFilters(f=>({...f,fuel: e.target.value}))}   style={styles.select}><option value="">Fuel</option>{fuels.map(x => <option key={x} value={x}>{x}</option>)}</select>
                <select value={filters.trans} onChange={(e)=>setFilters(f=>({...f,trans:e.target.value}))} style={styles.select}><option value="">Trans</option>{transmissions.map(x => <option key={x} value={x}>{x}</option>)}</select>
                <select value={sort} onChange={(e)=>setSort(e.target.value)} style={styles.select}>
                  <option value="time_seconds:asc">Fastest first</option>
                  <option value="time_seconds:desc">Slowest first</option>
                  <option value="created_at:desc">Newest first</option>
                </select>
              </div>

              {/* Table */}
              <div style={{ marginTop: 10, ...styles.tableWrap, maxHeight: 560 }}>
                {(leaderboard.results || []).length ? (
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={{ ...styles.thSmall, width: 36, textAlign: 'right' }}>#</th>
                        <th style={{ ...styles.thSmall, width: 160 }}>Name</th>
                        <th style={{ ...styles.thSmall, width: 72 }}>Year</th>
                        <th style={{ ...styles.thSmall, width: 160 }}>Model</th>
                        <th style={{ ...styles.thSmall, width: 130 }}>Trans</th>
                        <th style={{ ...styles.thSmall, width: 120 }}>Power</th>
                        <th style={{ ...styles.thSmall, width: 90 }}>Fuel</th>
                        <th style={{ ...styles.thSmall, width: 100, textAlign: 'right' }}>Time (s)</th>
                        <th style={{ ...styles.thSmall, width: 190 }}>Date</th>
                        <th style={{ ...styles.thSmall, width: 96 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {(leaderboard.results || []).map((r, idx) => {
                        const isTop3 = idx < 3;
                        const rowStyle = isTop3 ? styles.topRow : undefined;

                        const name  = r.user_alias || 'Anonymous';
                        const year  = r.vehicle_year || r.year || '';
                        const model = r.vehicle_model || r.model || '';
                        const trans = r.vehicle_trans || r.trans || '';
                        const power = r.vehicle_power || r.power || '';
                        const fuel  = r.vehicle_fuel || r.fuel || '';

                        return (
                          <tr key={r.id} style={rowStyle}>
                            <td style={{ ...styles.tdSmall, textAlign: 'right' }}>{idx + 1}</td>
                            <td style={styles.tdSmall}>{name}</td>
                            <td style={styles.tdSmall}>{year || '—'}</td>
                            <td style={styles.tdSmall}>{model || '—'}</td>
                            <td style={styles.tdSmall}>{trans || '—'}</td>
                            <td style={styles.tdSmall}>{power || '—'}</td>
                            <td style={styles.tdSmall}>{fuel || '—'}</td>
                            <td style={{ ...styles.tdSmall, textAlign: 'right' }}>
                              {Number.isFinite(r.time_seconds) ? Number(r.time_seconds).toFixed(2) : '—'}
                            </td>
                            <td style={styles.tdSmall}>{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</td>
                            <td style={styles.tdSmall}>
                              <button
                                style={styles.smallBtn}
                                onClick={() => overlayLeader(r.id, name)}
                              >
                                Overlay
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ padding: 12, opacity: 0.8 }}>No runs yet for this interval.</div>
                )}
              </div>
            </div>
          </div>
        </div>
        {/* /3-COLUMN */}
      </div>

      {/* 📨 Feedback Modal (matches your component's props & return contract) */}
      <FeedbackModal
        open={showFeedback}
        onClose={() => setShowFeedback(false)}
        onSubmit={handleSubmitFeedback}
        defaultPage="/log-comparison"
      />
    </div>
  );
}
