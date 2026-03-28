// frontend/src/MainApp.jsx  — Drop-in replacement
import React, { useMemo, useState, useEffect, useRef } from 'react';
import './App.css';
import { Link } from 'react-router-dom';
import { Line } from 'react-chartjs-2';
import 'chart.js/auto';
import annotationPlugin from 'chartjs-plugin-annotation';
import { Chart } from 'chart.js';
import BoostSummary from './components/BoostSummary';
import {
  years, models, engines, injectors, mapSensors, throttles,
  powerAdders, transmissions, tireHeights, gearRatios, fuels
} from './ui/options';
import { deriveAdvice, SateraTone } from './ui/advice';

Chart.register(annotationPlugin);
const API_BASE = process.env.REACT_APP_API_BASE || '';

// ── Dyno tunables (unchanged) ──────────────────────────────
const K_DYNO        = 0.000145;
const REF_TIRE_IN   = 28.0;
const REF_OVERALL   = 1.29 * 3.09;
const DYNO_REMOTE_TRIM = 0.96;
const TRACK_TRIM    = 1.2;
const FT_PER_MPH    = 1.4666667;
const G_FTPS2       = 32.174;
const HP_DEN        = 550;

// ── Design tokens ──────────────────────────────────────────
const T = {
  bg:       '#0c0f0c',
  panel:    '#111811',
  card:     '#141e14',
  border:   '#1f2d1f',
  borderHi: '#2e472e',
  green:    '#3dff7a',
  greenDim: '#1a7a38',
  greenLo:  'rgba(61,255,122,0.07)',
  amber:    '#f5a623',
  red:      '#ff5252',
  blue:     '#4db8ff',
  text:     '#dff0df',
  muted:    '#6b9f6b',
  faint:    '#2e4a2e',
};

const css = {
  page:   { background: T.bg, color: T.text, minHeight: '100vh', fontFamily: "'Inter', system-ui, sans-serif" },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '0 28px', height: 64,
    background: 'linear-gradient(135deg, #0a1a0a 0%, #0f280f 50%, #0a1a0a 100%)',
    borderBottom: `1px solid ${T.border}`,
    boxShadow: '0 1px 0 rgba(61,255,122,0.08)',
  },
  logo: { fontSize: 18, fontWeight: 700, color: T.green, letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 10 },
  shell:  { padding: '24px 24px', maxWidth: 1400, margin: '0 auto' },
  grid2:  { display: 'grid', gridTemplateColumns: '360px 1fr', gap: 20 },
  gridNarrow: { display: 'grid', gridTemplateColumns: '1fr', gap: 20 },

  // Cards
  card: {
    background: T.card, border: `1px solid ${T.border}`,
    borderRadius: 10, padding: 18,
  },
  cardHighlight: {
    background: T.card, border: `1px solid ${T.borderHi}`,
    borderRadius: 10, padding: 18,
    boxShadow: `0 0 0 1px rgba(61,255,122,0.04) inset`,
  },

  // Section titles
  sectionTitle: {
    margin: '0 0 14px', fontSize: 13, fontWeight: 600,
    letterSpacing: 1.2, textTransform: 'uppercase',
    color: T.green, opacity: 0.9,
  },

  // Inputs / selects
  input: {
    width: '100%', background: '#0a100a',
    border: `1px solid ${T.border}`, borderRadius: 7,
    padding: '9px 12px', color: T.text,
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
  },
  select: {
    width: '100%', background: '#0a100a',
    border: `1px solid ${T.border}`, borderRadius: 7,
    padding: '9px 12px', color: T.text,
    fontSize: 13, outline: 'none', appearance: 'none',
    backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'%233dff7a\'/%3E%3C/svg%3E")',
    backgroundRepeat: 'no-repeat', backgroundPosition: 'calc(100% - 12px) 50%',
    paddingRight: 32, boxSizing: 'border-box',
  },
  fieldGrid: { display: 'grid', gap: 8 },

  // Buttons
  btnPrimary: {
    background: T.green, color: '#000', fontWeight: 700,
    border: 'none', borderRadius: 7, padding: '11px 22px',
    cursor: 'pointer', fontSize: 14, letterSpacing: 0.3,
    transition: 'opacity 0.15s',
  },
  btnGhost: {
    background: 'transparent', color: T.muted,
    border: `1px solid ${T.border}`, borderRadius: 7,
    padding: '8px 14px', cursor: 'pointer', fontSize: 13,
    transition: 'border-color 0.15s, color 0.15s',
  },
  btnGhostActive: {
    background: T.greenLo, color: T.green,
    border: `1px solid ${T.green}`, borderRadius: 7,
    padding: '8px 14px', cursor: 'pointer', fontSize: 13,
  },
  btnNav: {
    background: T.greenLo, color: T.green,
    border: `1px solid ${T.borderHi}`, borderRadius: 7,
    padding: '8px 16px', cursor: 'pointer', fontSize: 13,
    textDecoration: 'none', fontWeight: 600, letterSpacing: 0.3,
  },
};

// ── Math helpers (unchanged from original) ─────────────────
const isNum = (v) => Number.isFinite(v);
const movAvg = (arr, win=5) => {
  if (!arr || !arr.length) return [];
  const half = Math.floor(win/2);
  return arr.map((_, i) => {
    const s = Math.max(0, i-half), e = Math.min(arr.length-1, i+half);
    let sum = 0;
    for (let k=s;k<=e;k++) sum += arr[k];
    return sum/(e-s+1);
  });
};
const zeroPhaseMovAvg = (arr, win=5) => {
  if (!arr || !arr.length) return [];
  return movAvg([...movAvg(arr, win)].reverse(), win).reverse();
};
const findCol = (headers, candidates) => {
  for (const c of candidates) {
    const idx = headers.findIndex(h => h.toLowerCase() === c.toLowerCase());
    if (idx !== -1) return idx;
  }
  for (const c of candidates) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(c.toLowerCase()));
    if (idx !== -1) return idx;
  }
  return -1;
};
function parseCSV(raw) {
  const rows = raw.split(/\r?\n/).map(r => r.trim());
  if (!rows.length) return null;
  const headerRowIndex = rows.findIndex(r => /(^|,)\s*offset\s*(,|$)/i.test(r));
  if (headerRowIndex === -1) return null;
  const headers = rows[headerRowIndex].split(',').map(h => h.trim());
  const dataStart = headerRowIndex + 4;
  const dataRows = rows.slice(dataStart);
  const speedIndex = findCol(headers, ['Vehicle Speed (SAE)', 'Vehicle Speed', 'Speed (SAE)', 'Speed']);
  const timeIndex  = findCol(headers, ['Offset', 'Time', 'Time (s)']);
  const pedalIndex = findCol(headers, ['Accelerator Position D (SAE)', 'Accelerator Position (SAE)', 'Throttle Position (SAE)', 'Throttle Position (%)', 'TPS', 'Relative Accelerator Position']);
  const rpmIndex   = findCol(headers, ['Engine RPM', 'Engine RPM (SAE)', 'RPM', 'RPM (SAE)', 'Engine Speed (RPM)', 'Engine Speed', 'Engine Speed (SAE)']);
  if (speedIndex === -1 || timeIndex === -1 || pedalIndex === -1) return null;
  const points = [];
  for (let row of dataRows) {
    if (!row.includes(',')) continue;
    const cols = row.split(',');
    const s = parseFloat(cols[speedIndex]);
    const t = parseFloat(cols[timeIndex]);
    const p = parseFloat(cols[pedalIndex]);
    const r = rpmIndex !== -1 ? parseFloat(cols[rpmIndex]) : undefined;
    if (isNum(s) && isNum(t) && isNum(p)) points.push({ s, t, p, r: isNum(r) ? r : null });
  }
  if (!points.length) return null;
  let segments = [], current = [];
  for (let pt of points) {
    if (pt.p >= 86) current.push(pt);
    else if (current.length) { segments.push(current); current = []; }
  }
  if (current.length) segments.push(current);
  const pack = (arr) => ({
    time: arr.map(p => +p.t.toFixed(3)),
    speed: arr.map(p => +p.s.toFixed(2)),
    rpm: arr.map(p => p.r).some(v => v !== null) ? arr.map(p => p.r ?? null) : null,
    pedal: arr.map(p => p.p)
  });
  if (!segments.length) return pack(points);
  segments = segments.filter(seg => seg.length > 5);
  if (!segments.length) return pack(points);
  segments.sort((a, b) => (a.at(-1).t - a[0].t) - (b.at(-1).t - b[0].t));
  const best = segments[0];
  const launchIdx = best.findIndex(p => p.p >= 86 && p.s > 0.5);
  const trimmed = launchIdx >= 0 ? best.slice(launchIdx) : best;
  const t0 = trimmed[0].t;
  const norm = trimmed.map(p => ({ ...p, t: +(p.t - t0).toFixed(3) }));
  return pack(norm);
}
function selectRpmSweep(time, rpm, mph, pedal = null) {
  if (!rpm || !mph || rpm.length < 20 || mph.length !== rpm.length) return null;
  const PEDAL_MIN=80, MIN_MPH=5, RATIO_TOL=0.12, RPM_DIP=75, MIN_LEN=20;
  const isWOT = (i) => { if (!pedal || pedal.length !== rpm.length) return true; const v=pedal[i]; return Number.isFinite(v)?v>=PEDAL_MIN:true; };
  const ratio = rpm.map((r,i) => { const v=mph[i]; if(!Number.isFinite(r)||!Number.isFinite(v)||v<MIN_MPH) return null; return r/Math.max(v,1e-6); });
  const okRise = (i) => Number.isFinite(rpm[i])&&Number.isFinite(rpm[i-1])&&rpm[i]>=rpm[i-1]-RPM_DIP;
  const good=(i)=>okRise(i)&&isWOT(i)&&ratio[i]!==null;
  const coarse=[]; let s=1;
  for(let i=1;i<rpm.length;i++){if(!good(i)){if(i-1-s>=MIN_LEN)coarse.push([s,i-1]);s=i;}}
  if(rpm.length-1-s>=MIN_LEN)coarse.push([s,rpm.length-1]);
  if(!coarse.length)return null;
  const keepWindows=[];
  for(const[a,b]of coarse){let i=a;while(i<=b){const start=i;let j=i;const medBuf=[];while(j<=b&&ratio[j]!==null){medBuf.push(ratio[j]);const sorted=[...medBuf].sort((x,y)=>x-y);const med=sorted[Math.floor(sorted.length/2)];const dev=Math.abs(ratio[j]-med)/Math.max(med,1e-6);if(dev>RATIO_TOL)break;j++;}const end=j-1;if(end-start+1>=MIN_LEN)keepWindows.push([start,end]);i=Math.max(start+1,j);}}
  if(!keepWindows.length)return null;
  keepWindows.sort((u,v)=>(v[1]-v[0])-(u[1]-u[0]));
  let[i0,i1]=keepWindows[0];const LOOSE=RATIO_TOL*1.5;
  let k=i0-1;while(k>0&&isWOT(k)&&mph[k]>=MIN_MPH&&rpm[k]>=rpm[k+1]-RPM_DIP){const med=(ratio[i0]+ratio[i1])/2;const dev=Math.abs(ratio[k]-med)/Math.max(med,1e-6);if(dev>LOOSE)break;i0=k;k--;}
  k=i1+1;while(k<rpm.length&&isWOT(k)&&mph[k]>=MIN_MPH&&rpm[k]>=rpm[k-1]-RPM_DIP){const med=(ratio[i0]+ratio[i1])/2;const dev=Math.abs(ratio[k]-med)/Math.max(med,1e-6);if(dev>LOOSE)break;i1=k;k++;}
  return[i0,i1];
}
function detectPullGear({ rpm, mph, tireIn, rear }) {
  if(!rpm||!mph||rpm.length<12)return{gear:null,confidence:0};
  if(!isNum(tireIn)||tireIn<=0||!isNum(rear)||rear<=0)return{gear:null,confidence:0};
  const samples=[];
  for(let i=0;i<rpm.length;i++){const R=rpm[i],V=mph[i];if(!isNum(R)||!isNum(V)||V<5)continue;const overall=(R*tireIn)/(V*336);if(!isNum(overall)||overall<=0)continue;const tg=overall/rear;if(isNum(tg)&&tg>0.3&&tg<6.5)samples.push(tg);}
  if(samples.length<6)return{gear:null,confidence:0};
  const sorted=[...samples].sort((a,b)=>a-b);const med=sorted[Math.floor(sorted.length/2)];
  const devs=sorted.map(v=>Math.abs(v-med)).sort((a,b)=>a-b);const mad=devs[Math.floor(devs.length/2)]||0;
  const kept=samples.filter(v=>Math.abs(v-med)<=3*(mad||0.01));if(kept.length<6)return{gear:null,confidence:0};
  const mean=kept.reduce((a,c)=>a+c,0)/kept.length;const variance=kept.reduce((a,c)=>a+Math.pow(c-mean,2),0)/kept.length;
  const std=Math.sqrt(variance);const conf=Math.max(0,Math.min(1,1-(std/0.10)));
  const est=kept.sort((a,b)=>a-b)[Math.floor(kept.length/2)];
  return{gear:Math.round(est*100)/100,confidence:conf};
}
function pickPullGear({ autoDetect, detected, catalog, selectedGearLabel, manualValue }) {
  if(autoDetect&&Number.isFinite(detected)&&catalog?.length){let nearest=null,dn=Infinity;for(const g of catalog){const d=Math.abs(g.ratio-detected);if(d<dn){dn=d;nearest=g;}}if(nearest&&dn<=0.06)return{ratio:nearest.ratio,source:`auto+snap (${nearest.label})`};return{ratio:detected,source:'auto-estimated'};}
  if(selectedGearLabel&&catalog?.length&&selectedGearLabel!=='__custom__'){const found=catalog.find(g=>g.label===selectedGearLabel);if(found)return{ratio:found.ratio,source:`catalog (${found.label})`};}
  const v=parseFloat(manualValue);if(Number.isFinite(v)&&v>0.3&&v<6.5)return{ratio:v,source:'manual'};
  return{ratio:1.29,source:'default'};
}
const comma=(n,d=1)=>n.toLocaleString(undefined,{maximumFractionDigits:d});
function resampleUniform(T,Y,targetHz=60){
  if(!T||!Y||T.length!==Y.length||T.length<3)return{t:[],y:[]};
  const t0=T[0],tN=T[T.length-1],dt=1/targetHz,N=Math.max(3,Math.floor((tN-t0)/dt));
  const tU=new Array(N),yU=new Array(N);let j=1;
  for(let i=0;i<N;i++){const t=t0+i*dt;tU[i]=t;while(j<T.length&&T[j]<t)j++;const aIdx=Math.max(0,j-1),bIdx=Math.min(T.length-1,j);const Ta=T[aIdx],Tb=T[bIdx],Ya=Y[aIdx],Yb=Y[bIdx];const f=(Tb-Ta)!==0?Math.min(1,Math.max(0,(t-Ta)/(Tb-Ta))):0;yU[i]=(isNum(Ya)&&isNum(Yb))?(Ya+(Yb-Ya)*f):NaN;}
  return{t:tU,y:yU};
}

// ── Checklist line parser ──────────────────────────────────
function parseChecklistLines(text) {
  if (!text) return [];
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    let type = 'info', body = line;
    if (line.startsWith('CRITICAL:')) { type = 'critical'; body = line.slice(9).trim(); }
    else if (line.startsWith('WARN:'))     { type = 'warn';     body = line.slice(5).trim(); }
    else if (line.startsWith('OK:'))       { type = 'ok';       body = line.slice(3).trim(); }
    else if (line.startsWith('STAT:'))     { type = 'stat';     body = line.slice(5).trim(); }
    else if (line.startsWith('INFO:'))     { type = 'info';     body = line.slice(5).trim(); }
    // legacy emoji fallback
    else if (line.startsWith('⚠️') || line.startsWith('🚨')) { type = 'warn'; }
    else if (line.startsWith('✅')) { type = 'ok'; }
    else if (['📈','🚀','🚦','📊','🌀','🎯'].some(e => line.startsWith(e))) { type = 'stat'; }
    return { type, body };
  });
}

// ── Loading skeleton ───────────────────────────────────────
function Skeleton({ height = 18, width = '100%', style = {} }) {
  return (
    <div style={{
      height, width, borderRadius: 4,
      background: 'linear-gradient(90deg, #151e15 25%, #1e2d1e 50%, #151e15 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
      ...style
    }} />
  );
}

// ── Checklist row ──────────────────────────────────────────
const CHECK_STYLE = {
  critical: { icon: '🚨', label: 'Critical',  color: '#ff5252', bg: 'rgba(255,82,82,0.06)',    border: 'rgba(255,82,82,0.25)'    },
  warn:     { icon: '⚠️',  label: 'Warning',   color: '#f5a623', bg: 'rgba(245,166,35,0.06)',  border: 'rgba(245,166,35,0.25)'   },
  ok:       { icon: '✅',  label: 'Good',      color: '#3dff7a', bg: 'rgba(61,255,122,0.05)',  border: 'rgba(61,255,122,0.2)'    },
  stat:     { icon: '📊',  label: 'Data',      color: '#4db8ff', bg: 'rgba(77,184,255,0.05)',  border: 'rgba(77,184,255,0.2)'    },
  info:     { icon: 'ℹ️',  label: 'Info',      color: '#6b9f6b', bg: 'transparent',            border: 'rgba(107,159,107,0.15)'  },
};
function CheckRow({ type, body }) {
  const s = CHECK_STYLE[type] || CHECK_STYLE.info;
  // Split "Subject — description" or "Subject: description" into headline + detail
  const dashIdx = body.indexOf(' — ');
  const colonIdx = body.indexOf('. ');
  let headline = null, detail = body;
  if (dashIdx !== -1 && dashIdx < 80) {
    headline = body.slice(0, dashIdx).trim();
    detail   = body.slice(dashIdx + 3).trim();
  } else if (colonIdx !== -1 && colonIdx < 80 && (type === 'critical' || type === 'warn')) {
    headline = body.slice(0, colonIdx + 1).trim();
    detail   = body.slice(colonIdx + 2).trim();
  }
  return (
    <div style={{
      display: 'flex', gap: 10, padding: '9px 12px',
      borderRadius: 7, background: s.bg, marginBottom: 4,
      borderLeft: `3px solid ${s.color}`,
      alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{s.icon}</span>
      <div style={{ flex: 1 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
          color: s.color, display: 'block', marginBottom: 4, opacity: 0.9,
        }}>{s.label}</span>
        {headline && (
          <span style={{
            fontSize: 14, fontWeight: 700, color: s.color,
            display: 'block', marginBottom: 5, lineHeight: 1.4,
          }}>{headline}</span>
        )}
        <span style={{ fontSize: 13, lineHeight: 1.6, color: '#dff0df', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {detail}
        </span>
      </div>
    </div>
  );
}

// ── Severity badge ─────────────────────────────────────────
function SeverityBadge({ severity }) {
  const map = {
    high: { label: 'High Priority', bg: 'rgba(255,82,82,0.12)', color: T.red },
    med:  { label: 'Medium',        bg: 'rgba(245,166,35,0.12)', color: T.amber },
    low:  { label: 'Info',          bg: 'rgba(61,255,122,0.08)', color: T.green },
  };
  const s = map[severity] || map.low;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 99,
      fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
      background: s.bg, color: s.color, marginRight: 8,
      textTransform: 'uppercase',
    }}>
      {s.label}
    </span>
  );
}

// ── Metric tile ────────────────────────────────────────────
function MetricTile({ label, value, sub, accent }) {
  return (
    <div style={{
      background: '#0e160e', border: `1px solid ${accent ? T.borderHi : T.border}`,
      borderRadius: 8, padding: '12px 16px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent || T.text, letterSpacing: -0.5 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: T.muted, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ── Step badge ─────────────────────────────────────────────
function StepBadge({ n, label, done }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 24, height: 24, borderRadius: '50%',
        background: done ? T.green : T.border,
        color: done ? '#000' : T.muted,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, flexShrink: 0,
      }}>{done ? '✓' : n}</div>
      <span style={{ fontSize: 12, color: done ? T.green : T.muted }}>{label}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
export default function MainApp() {
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < 1100);
  useEffect(() => {
    const fn = () => setIsNarrow(window.innerWidth < 1100);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);

  const [formData, setFormData] = useState({
    vin:'', year:'', model:'', engine:'', injectors:'', map:'',
    throttle:'', power:'', trans:'', tire:'', gear:'', fuel:'',
    weight:'', pullLabel:'', pullGear:'', logFile: null,
  });
  const [dynoMode, setDynoMode]             = useState('dyno');
  const [autoDetectGear, setAutoDetectGear] = useState(true);
  const [showAdv, setShowAdv]               = useState(false);
  const [crr, setCrr] = useState(0.015);
  const [cda, setCda] = useState(8.5);
  const [rho, setRho] = useState(0.00238);

  const [leftText, setLeftText]   = useState('');
  const [aiText, setAiText]       = useState('');
  const [graphs, setGraphs]       = useState(null);
  const [aiResult, setAiResult]   = useState('');
  const [status, setStatus]       = useState('');
  const [loading, setLoading]     = useState(false);
  const [dynoRemote, setDynoRemote] = useState(null);
  const [cachedDetectedPull, setCachedDetectedPull] = useState(null);
  const [catalogGears, setCatalogGears]             = useState([]);
  const [fileName, setFileName]   = useState('');
  const fileRef = useRef();

  useEffect(() => {
    const name = formData.trans?.trim();
    if (!name) { setCatalogGears([]); return; }
    fetch(`${API_BASE}/ratios?trans=${encodeURIComponent(name)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(j => setCatalogGears(Array.isArray(j.gears) ? j.gears : []))
      .catch(() => setCatalogGears([]));
  }, [formData.trans]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(p => ({ ...p, [name]: value }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0] || null;
    if (!file) return;
    setFileName(file.name);
    setFormData(p => ({ ...p, logFile: file }));
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCSV(reader.result);
      if (!parsed) { setStatus('❌ Failed to parse CSV — check format.'); setCachedDetectedPull(null); return; }
      setStatus('');
      setGraphs(parsed);
      try {
        const { time, rpm, speed, pedal } = parsed;
        if (rpm && speed && time) {
          const rearGear = isNum(parseFloat(formData.gear)) ? parseFloat(formData.gear) : 3.09;
          const tireIn = parseFloat(String(formData.tire || '').replace(/[^0-9.]/g,'')) || REF_TIRE_IN;
          const sweep = selectRpmSweep(time, rpm, speed, pedal||null);
          if (sweep) {
            const [i0, i1] = sweep;
            const det = detectPullGear({ rpm: rpm.slice(i0,i1+1), mph: speed.slice(i0,i1+1), tireIn, rear: rearGear });
            setCachedDetectedPull(isNum(det.gear) ? det.gear : null);
          } else setCachedDetectedPull(null);
        } else setCachedDetectedPull(null);
      } catch { setCachedDetectedPull(null); }
    };
    reader.readAsText(file);
  };

  const handleSubmit = async () => {
    const required = ['engine', 'power', 'fuel', 'trans', 'year', 'model'];
    const missing  = required.filter(k => !formData[k]);
    if (missing.length) {
      setStatus(`❌ Fill in required fields: ${missing.join(', ')}`);
      return;
    }
    if (!formData.logFile) { setStatus('❌ Please upload a CSV log first.'); return; }

    setLoading(true);
    setStatus('');
    setAiResult('');
    setLeftText('');
    setAiText('');
    setDynoRemote(null);

    try {
      const form = new FormData();
      form.append('log', formData.logFile);
      form.append('vehicle', JSON.stringify({ year: formData.year, model: formData.model }));
      form.append('mods', JSON.stringify({
        engine: formData.engine, injectors: formData.injectors, map: formData.map,
        throttle: formData.throttle, power_adder: formData.power,
        trans: formData.trans, fuel: formData.fuel, nn: 'Enabled'
      }));
      form.append('mode', dynoMode);
      const rearVal = parseFloat(formData.gear||'');
      if (isNum(rearVal) && rearVal>0) form.append('rear', String(rearVal));
      const tireIn = parseFloat(String(formData.tire||`${REF_TIRE_IN}`).replace(/[^0-9.]/g,''));
      if (isNum(tireIn) && tireIn>0) form.append('tile', String(tireIn));
      if (formData.trans) form.append('trans', formData.trans);
      if (!autoDetectGear) {
        if (formData.pullLabel && formData.pullLabel !== '__custom__' && catalogGears.length) {
          const found = catalogGears.find(g => g.label === formData.pullLabel);
          if (found) form.append('pullGear', String(found.ratio));
        } else {
          const v = parseFloat(formData.pullGear||'');
          if (isNum(v) && v>0.3 && v<6.5) form.append('pullGear', String(v));
        }
      }

      const res = await fetch(`${API_BASE}/ai-review`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Server error ${res.status}`);

      const text = await res.text();
      const [mainPart, dynoPart] = text.split('===DYNO===');
      const [quickChecks, aiPart] = (mainPart||'').split('===SPLIT===');

      let dynoJSON = null;
      try { if (dynoPart) dynoJSON = JSON.parse(dynoPart); } catch {}

      
      const combined = (quickChecks||'').trim();
      setAiResult(combined || 'No AI assessment returned.');
      setLeftText((quickChecks||'').trim());
      setAiText((aiPart||'').trim());
      setDynoRemote(null);
    } catch (err) {
      setStatus(`❌ ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ── Charts ─────────────────────────────────────────────
  const chartData = graphs ? {
    datasets: [{
      label: 'Vehicle Speed (mph)',
      data: graphs.time.map((t,i) => ({ x:t, y:graphs.speed[i] })),
      borderColor: T.green, backgroundColor: 'rgba(61,255,122,0.1)',
      borderWidth: 2, pointRadius: 0, tension: 0.25
    }]
  } : null;

  const chartOptions = {
    responsive: true, maintainAspectRatio: false, parsing: false,
    scales: {
      x: { type:'linear', min:0, title:{display:true,text:'Time (s)',color:T.muted}, ticks:{color:T.muted}, grid:{color:'#1a221a'} },
      y: { title:{display:true,text:'Speed (mph)',color:T.muted}, ticks:{color:T.muted}, grid:{color:'#1a221a'} }
    },
    plugins: { legend:{labels:{color:T.muted}} }
  };

  // ── Dyno ───────────────────────────────────────────────
  const dyno = useMemo(() => {
    if (dynoMode==='dyno' && dynoRemote && !dynoRemote.error && dynoRemote.hp?.length) {
      const hp = dynoRemote.hp.map(v=>v*DYNO_REMOTE_TRIM);
      const tq = dynoRemote.tq ? dynoRemote.tq.map(v=>v*DYNO_REMOTE_TRIM) : null;
      let peakHP=null, peakTQ=null;
      if (hp.length) { let iHP=0; for(let i=1;i<hp.length;i++) if(hp[i]>hp[iHP]) iHP=i; peakHP={rpm:dynoRemote.x[iHP],value:+hp[iHP].toFixed(1)}; }
      if (tq?.length) { let iTQ=0; for(let i=1;i<tq.length;i++) if(tq[i]>tq[iTQ]) iTQ=i; peakTQ={rpm:dynoRemote.x[iTQ],value:+tq[iTQ].toFixed(1)}; }
      return { ...dynoRemote, hp, tq, peakHP, peakTQ, usedRPM:true, mode:dynoMode };
    }
    if (!graphs?.rpm?.some(v=>isNum(v)&&v>0)) return null;
    const { time, rpm, speed, pedal } = graphs;
    const sweep = selectRpmSweep(time, rpm, speed, pedal||null);
    if (!sweep) return null;
    const [i0,i1] = sweep;
    const T2=time.slice(i0,i1+1), RPM=rpm.slice(i0,i1+1), MPH=speed.slice(i0,i1+1);
    const {t:Tu, y:RPMu} = (() => { const s=T2.every((v,i)=>i===0||v>T2[i-1]); return s?resampleUniform(T2,RPM,60):{t:[...T2],y:[...RPM]}; })();
    const RPMs=zeroPhaseMovAvg(RPMu,7);
    const dRPMdt=RPMs.map((_,i,arr)=>{ if(i===0||i===arr.length-1)return 0; return(arr[i+1]-arr[i-1])*(60/2); });
    const dRPMdtS=zeroPhaseMovAvg(dRPMdt,7);
    const rear=parseFloat(formData.gear||'')||3.09;
    const tireIn=parseFloat(String(formData.tire||`${REF_TIRE_IN}`).replace(/[^0-9.]/g,''))||REF_TIRE_IN;
    let detectedGear=null;
    if (autoDetectGear) {
      detectedGear=isNum(cachedDetectedPull)?cachedDetectedPull:null;
      if(!isNum(detectedGear)){const det=detectPullGear({rpm:RPMs,mph:MPH,tireIn,rear});detectedGear=det.gear;}
    }
    const chosen=pickPullGear({autoDetect:autoDetectGear,detected:detectedGear,catalog:catalogGears,selectedGearLabel:formData.pullLabel||null,manualValue:formData.pullGear});
    const pull=chosen.ratio;
    let HP;
    if (dynoMode==='dyno') {
      const overall=pull*rear, s_overall=Math.pow(REF_OVERALL/overall,2), s_tire=Math.pow(REF_TIRE_IN/tireIn,2);
      HP=RPMs.map((r,i)=>Math.max(0,K_DYNO*r*dRPMdtS[i]*s_overall*s_tire));
    } else {
      const Vfts=MPH.map(v=>v*FT_PER_MPH), Vs=zeroPhaseMovAvg(Vfts,5);
      const As=Vs.map((_,i)=>{ if(i===0||i===Vs.length-1)return 0; const dv=Vs[i+1]-Vs[i-1],dt=(T2[i+1]-T2[i-1]); return dt?dv/dt:0; });
      const Asm=zeroPhaseMovAvg(As,5);
      const weight=parseFloat(formData.weight||'0')||0, mass=isNum(weight)&&weight>0?weight/G_FTPS2:0;
      HP=Vs.map((v,i)=>((mass*Asm[i]*v)+(crr*weight*v)+(0.5*rho*cda*v*v*v))/HP_DEN*TRACK_TRIM);
    }
    const pts=[];
    for(let i=0;i<RPMs.length;i++) if(isNum(RPMs[i])&&RPMs[i]>0&&isNum(HP[i])) pts.push({x:RPMs[i],hp:HP[i]});
    if(!pts.length)return null;
    pts.sort((a,b)=>a.x-b.x);
    const bins=new Map();
    for(const p of pts){const key=Math.round(p.x/100)*100;const cur=bins.get(key);if(!cur)bins.set(key,{x:key,hp:[p.hp]});else cur.hp.push(p.hp);}
    const series=Array.from(bins.values()).map(b=>({x:b.x,hp:b.hp.reduce((a,c)=>a+c,0)/b.hp.length})).sort((a,b)=>a.x-b.x);
    const X=series.map(p=>p.x), HPs=zeroPhaseMovAvg(series.map(p=>p.hp),9), TQ=X.map((r,i)=>r>0?(HPs[i]*5252)/r:null);
    let iHP=0; for(let i=1;i<HPs.length;i++) if(HPs[i]>HPs[iHP]) iHP=i;
    let iTQ=0; for(let i=1;i<TQ.length;i++) if(TQ[i]>TQ[iTQ]) iTQ=i;
    return {
      usedRPM:true, xLabel:'RPM', x:X, hp:HPs, tq:TQ,
      peakHP:HPs.length?{rpm:X[iHP],value:+HPs[iHP].toFixed(1)}:null,
      peakTQ:TQ.length?{rpm:X[iTQ],value:+TQ[iTQ].toFixed(1)}:null,
      mode:dynoMode, pullGearUsed:isNum(pull)?+pull.toFixed(2):null,
      pullGearSource:chosen?.source||null,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dynoRemote,graphs,formData.weight,dynoMode,crr,cda,rho,autoDetectGear,formData.pullLabel,formData.pullGear,formData.trans,formData.tire,formData.gear,catalogGears,cachedDetectedPull]);

  const dynoChartOptions = useMemo(() => {
    if (!dyno) return null;
    const maxFinite=(arr)=>{if(!arr)return 0;const f=arr.filter(Number.isFinite);return f.length?Math.max(...f):0;};
    const niceMax=Math.ceil(Math.max(maxFinite(dyno.hp),maxFinite(dyno.tq))/10)*10||10;
    return {
      responsive:true, maintainAspectRatio:false, parsing:false,
      scales:{
        x:{type:'linear',title:{display:true,text:'RPM',color:T.muted},ticks:{color:T.muted},grid:{color:'#1a221a'}},
        yHP:{position:'left',title:{display:true,text:'Horsepower',color:T.muted},ticks:{color:T.muted},grid:{color:'#1a221a'},min:0,max:niceMax},
        yTQ:dyno.tq?{position:'right',title:{display:true,text:'Torque (lb-ft)',color:T.muted},ticks:{color:T.muted},grid:{drawOnChartArea:false},min:0,max:niceMax}:undefined
      },
      plugins:{legend:{labels:{color:T.muted}},tooltip:{mode:'index',intersect:false}},
      interaction:{mode:'index',intersect:false}
    };
  }, [dyno]);

  // ── Derived state ──────────────────────────────────────
  const checklistLines = useMemo(() => parseChecklistLines(leftText), [leftText]);
  const suggestions    = useMemo(() => deriveAdvice(aiText), [aiText]);
  const hasRPM = !!(dyno?.usedRPM || graphs?.rpm?.some(v=>v!==null));
  const steps = [
    { n:1, label:'Fill vehicle details', done: !!(formData.year && formData.engine && formData.fuel) },
    { n:2, label:'Upload datalog CSV',   done: !!graphs },
    { n:3, label:'Run AI Analysis',      done: !!aiResult },
  ];

  return (
    <div style={css.page} className="st-page">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&family=Inter:wght@300;400;500&display=swap');
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        .st-animate { animation: fadeIn 0.35s ease both; }
        select option { background: #111811; }
        input[type=file] { display:none; }
        .upload-label {
          display: flex; align-items: center; gap: 10;
          padding: 11px 16px; border-radius: 7px;
          border: 2px dashed ${T.border}; cursor: pointer;
          color: ${T.muted}; font-size: 13px; transition: border-color 0.2s, color 0.2s;
        }
        .upload-label:hover { border-color: ${T.green}; color: ${T.green}; }
        .upload-label.has-file { border-color: ${T.borderHi}; color: ${T.text}; border-style: solid; }
        .btn-primary:hover { opacity: 0.88; }
        .btn-primary:active { opacity: 0.75; }
        .btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
      `}</style>

      {/* ── HEADER ───────────────────────────────────── */}
      <header className="st-header">
        <div className="st-logo">
          <div className="st-logo-icon">
            <svg width="18" height="18" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="11" r="10" stroke="#3dff7a" strokeWidth="1.5"/>
              <path d="M7 11 L10 14 L15 8" stroke="#3dff7a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          Satera Tuning
          <span className="st-logo-sub">AI Log Review</span>
          <span className="st-beta">Beta</span>
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <Link to="/log-comparison" className="st-btn-nav">
            Log Comparison →
          </Link>
        </div>
      </header>

      <div style={css.shell}>
        {/* ── Progress steps (mobile / desktop) ──────── */}
        <div style={{ display:'flex', gap:20, marginBottom:20, flexWrap:'wrap' }}>
          {steps.map(s => <StepBadge key={s.n} {...s} />)}
        </div>

        <div style={isNarrow ? css.gridNarrow : css.grid2}>
          {/* ── LEFT SIDEBAR ─────────────────────────── */}
          <aside style={{ display:'grid', gap:16, alignContent:'start' }}>
            {/* Vehicle form */}
            <div style={css.card}>
              <p style={css.sectionTitle}>Vehicle Details</p>
              <div style={css.fieldGrid}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  <select name="year" value={formData.year} onChange={handleChange} style={css.select}>
                    <option value="">Year *</option>{years.map(y=><option key={y} value={y}>{y}</option>)}
                  </select>
                  <select name="model" value={formData.model} onChange={handleChange} style={css.select}>
                    <option value="">Model *</option>{models.map(m=><option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <select name="engine" value={formData.engine} onChange={handleChange} style={css.select}>
                  <option value="">Engine *</option>{engines.map(e=><option key={e} value={e}>{e}</option>)}
                </select>
                <select name="fuel" value={formData.fuel} onChange={handleChange} style={css.select}>
                  <option value="">Fuel *</option>{fuels.map(f=><option key={f} value={f}>{f}</option>)}
                </select>
                <select name="trans" value={formData.trans} onChange={handleChange} style={css.select}>
                  <option value="">Transmission *</option>{transmissions.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
                <select name="power" value={formData.power} onChange={handleChange} style={css.select}>
                  <option value="">Power Adder *</option>{powerAdders.map(p=><option key={p} value={p}>{p}</option>)}
                </select>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  <select name="injectors" value={formData.injectors} onChange={handleChange} style={css.select}>
                    <option value="">Injectors</option>{injectors.map(i=><option key={i} value={i}>{i}</option>)}
                  </select>
                  <select name="map" value={formData.map} onChange={handleChange} style={css.select}>
                    <option value="">MAP Sensor</option>{mapSensors.map(m=><option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  <select name="throttle" value={formData.throttle} onChange={handleChange} style={css.select}>
                    <option value="">Throttle Body</option>{throttles.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                  <select name="gear" value={formData.gear} onChange={handleChange} style={css.select}>
                    <option value="">Rear Gear</option>{gearRatios.map(g=><option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <select name="tire" value={formData.tire} onChange={handleChange} style={css.select}>
                  <option value="">Tire Height</option>{tireHeights.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            {/* Dyno mode */}
            <div style={css.card}>
              <p style={css.sectionTitle}>Dyno Mode</p>
              <div style={{ display:'flex', gap:8 }}>
                {['dyno','track'].map(m => (
                  <button key={m} onClick={()=>setDynoMode(m)}
                    style={dynoMode===m ? css.btnGhostActive : css.btnGhost}>
                    {m === 'dyno' ? '⚡ Dyno' : '🏁 Track'}
                  </button>
                ))}
              </div>
              <p style={{ fontSize:12, color:T.muted, marginTop:8 }}>
                {dynoMode==='dyno' ? 'Chassis dyno model — no weight needed.' : 'Road-load model — enter vehicle weight below.'}
              </p>
              {dynoMode==='track' && (
                <>
                  <input name="weight" type="number" min="0" step="10"
                    placeholder="Vehicle weight (lbs)"
                    value={formData.weight} onChange={handleChange}
                    style={{ ...css.input, marginTop:8 }} />
                  <button onClick={()=>setShowAdv(s=>!s)} style={{ ...css.btnGhost, marginTop:8, fontSize:12 }}>
                    {showAdv ? '▲ Hide' : '▼ Show'} advanced (Crr, CdA, Air density)
                  </button>
                  {showAdv && (
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginTop:8 }}>
                      {[{l:'Crr',v:crr,s:0.001,fn:setCrr},{l:'CdA (ft²)',v:cda,s:0.1,fn:setCda},{l:'Air (slug/ft³)',v:rho,s:0.0001,fn:setRho}].map(({l,v,s,fn})=>(
                        <div key={l}>
                          <div style={{ fontSize:11,color:T.muted,marginBottom:4 }}>{l}</div>
                          <input type="number" step={s} value={v} onChange={e=>fn(parseFloat(e.target.value||v))} style={css.input}/>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Pull gear */}
            <div style={css.card}>
              <p style={css.sectionTitle}>Pull Gear</p>
              <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer' }}>
                <input type="checkbox" checked={autoDetectGear} onChange={e=>setAutoDetectGear(e.target.checked)}
                  style={{ accentColor: T.green }}/>
                Auto-detect from log
              </label>
              {!autoDetectGear && (
                <div style={{ marginTop:8, display:'grid', gap:8 }}>
                  {catalogGears.length > 0 && (
                    <select name="pullLabel" value={formData.pullLabel||''} onChange={handleChange} style={css.select}>
                      <option value="">Select from catalog</option>
                      {catalogGears.map(g=><option key={g.label} value={g.label}>{g.label} — {g.ratio.toFixed(2)}</option>)}
                      <option value="__custom__">Custom / Manual</option>
                    </select>
                  )}
                  {(catalogGears.length===0||formData.pullLabel==='__custom__'||!formData.pullLabel) && (
                    <input name="pullGear" type="number" min="0.50" max="6.00" step="0.01"
                      placeholder="Custom pull gear ratio"
                      value={formData.pullGear} onChange={handleChange} style={css.input}/>
                  )}
                </div>
              )}
              {dyno?.pullGearUsed && (
                <div style={{ marginTop:8, fontSize:12, color:T.muted }}>
                  Using gear: <span style={{ color:T.green }}>{dyno.pullGearUsed.toFixed(2)}</span>
                  {dyno.pullGearSource && <span style={{ opacity:.7 }}> ({dyno.pullGearSource})</span>}
                </div>
              )}
            </div>
          </aside>

          {/* ── RIGHT MAIN AREA ───────────────────────── */}
          <main style={{ display:'grid', gap:16, alignContent:'start' }}>

            {/* How it works */}
            <div className="st-how-it-works">
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
                <span style={{ fontSize:14 }}>⚡</span>
                <span style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:13, fontWeight:600, letterSpacing:2, textTransform:'uppercase', color:'#3dff7a' }}>How It Works</span>
              </div>
              <div className="st-how-it-works-steps">
                <div className="st-step">
                  <div className="st-step-num">1</div>
                  <div className="st-step-text"><strong>Fill Vehicle Info</strong>Engine, fuel, mods on the left</div>
                </div>
                <span className="st-step-arrow">›</span>
                <div className="st-step">
                  <div className="st-step-num">2</div>
                  <div className="st-step-text"><strong>Upload Your Log</strong>HP Tuners CSV export only</div>
                </div>
                <span className="st-step-arrow">›</span>
                <div className="st-step">
                  <div className="st-step-num">3</div>
                  <div className="st-step-text"><strong>Click Analyze</strong>AI reviews knock, boost, fuel &amp; more</div>
                </div>
                <span className="st-step-arrow">›</span>
                <div className="st-step">
                  <div className="st-step-num">4</div>
                  <div className="st-step-text"><strong>Read Your Results</strong>Instant tuner-grade assessment</div>
                </div>
              </div>
            </div>

            {/* Upload + Analyze */}
            <div className="st-card-highlight">
              <p className="st-section-title">Datalog Upload</p>
              <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
                <label htmlFor="logInput" className={`upload-label${graphs ? ' has-file' : ''}`}>
                  <span style={{ fontSize:16 }}>📂</span>
                  {fileName || 'Choose HP Tuners CSV…'}
                </label>
                <input id="logInput" ref={fileRef} type="file" accept=".csv" onChange={handleFileChange}/>
                <button
                  className="btn-primary"
                  onClick={handleSubmit}
                  disabled={loading || !graphs}
                  style={{ ...css.btnPrimary, minWidth:130, opacity: (loading||!graphs) ? 0.45 : 1 }}>
                  {loading ? (
                    <span style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ display:'inline-block', width:14,height:14, borderRadius:'50%', border:`2px solid #000`, borderTopColor:'transparent', animation:'spin 0.7s linear infinite' }}/>
                      Analyzing…
                    </span>
                  ) : '⚡ Analyze'}
                </button>
              </div>
              {status && <p style={{ marginTop:10, fontSize:13, color: status.startsWith('❌') ? T.red : T.muted }}>{status}</p>}
              <p style={{ margin:'10px 0 0', fontSize:12, color:'#2e4a2e' }}>
                Export from HP Tuners VCM Scanner → File → Export Data Log as CSV
              </p>
            </div>

            {/* Speed chart */}
            {graphs && (
              <div style={{ ...css.card, ...{ animation:'fadeIn 0.3s ease' } }}>
                <p style={css.sectionTitle}>Vehicle Speed vs Time</p>
                <div style={{ height:220 }}>
                  <Line data={chartData} options={chartOptions}/>
                </div>
              </div>
            )}

            {/* Loading skeleton */}
            {loading && (
              <div style={css.card}>
                <p style={css.sectionTitle}>Running AI Analysis…</p>
                <div style={{ display:'grid', gap:10 }}>
                  {[80,65,90,55,75].map((w,i)=>(
                    <Skeleton key={i} height={16} width={`${w}%`} style={{ animationDelay:`${i*0.12}s` }}/>
                  ))}
                </div>
              </div>
            )}

            {/* Checklist */}
            {!loading && checklistLines.length > 0 && (() => {
              const criticals = checklistLines.filter(l => l.type === 'critical');
              const warns     = checklistLines.filter(l => l.type === 'warn');
              const oks       = checklistLines.filter(l => l.type === 'ok');
              const stats     = checklistLines.filter(l => l.type === 'stat');
              const infos     = checklistLines.filter(l => l.type === 'info');
              return (
                <div style={{ display:'grid', gap:12, animation:'fadeIn 0.4s ease' }}>
                  {/* Alert banner for criticals */}
                  {criticals.length > 0 && (
                    <div style={{ background:'rgba(255,82,82,0.07)', border:'1px solid rgba(255,82,82,0.25)', borderRadius:10, padding:16 }}>
                      <p style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:12, fontWeight:700, color:'#ff5252', letterSpacing:2, textTransform:'uppercase', margin:'0 0 10px' }}>⚠ Needs Immediate Attention</p>
                      {criticals.map((l,i) => <CheckRow key={i} {...l}/>)}
                    </div>
                  )}
                  {/* Warnings */}
                  {warns.length > 0 && (
                    <div style={{ background:'rgba(245,166,35,0.04)', border:'1px solid rgba(245,166,35,0.15)', borderRadius:10, padding:16 }}>
                      <p style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:12, fontWeight:700, color:'#f5a623', letterSpacing:2, textTransform:'uppercase', margin:'0 0 10px' }}>Attention Needed</p>
                      {warns.map((l,i) => <CheckRow key={i} {...l}/>)}
                    </div>
                  )}
                  {/* Stats row */}
                  {stats.length > 0 && (
                    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:16 }}>
                      <p style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:12, fontWeight:700, color:'#3dff7a', letterSpacing:2, textTransform:'uppercase', margin:'0 0 10px', display:'flex', alignItems:'center', gap:8 }}>Performance Data</p>
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px,1fr))', gap:8 }}>
                        {stats.map((l,i) => {
                          const parts = l.body.split(':');
                          const label = parts[0]?.trim();
                          const value = parts.slice(1).join(':').trim();
                          const isTimer = /0.60|40.100|60.130/i.test(label);
                          return (
                            <div key={i} style={{
                              background: isTimer ? 'rgba(61,255,122,0.06)' : '#0e160e',
                              border: isTimer ? `1px solid rgba(61,255,122,0.25)` : `1px solid ${T.border}`,
                              borderRadius:8, padding:'10px 14px',
                              gridColumn: isTimer ? 'span 1' : 'span 1',
                            }}>
                              <div style={{ fontSize:11, color: isTimer ? T.green : T.muted, textTransform:'uppercase', letterSpacing:0.8, marginBottom:4, fontWeight: isTimer ? 700 : 400 }}>{label}</div>
                              <div style={{ fontSize: isTimer ? 22 : 16, fontWeight:700, color: isTimer ? T.green : '#4db8ff', fontVariantNumeric:'tabular-nums' }}>{value}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* All clear */}
                  {oks.length > 0 && (
                    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:16 }}>
                      <p style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:12, fontWeight:700, color:'#3dff7a', letterSpacing:2, textTransform:'uppercase', margin:'0 0 10px' }}>All Clear</p>
                      {oks.map((l,i) => <CheckRow key={i} {...l}/>)}
                    </div>
                  )}
                  {/* Info items */}
                  {infos.length > 0 && (
                    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:16 }}>
                      <p style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:12, fontWeight:700, color:'#5a8f5a', letterSpacing:2, textTransform:'uppercase', margin:'0 0 10px' }}>Notes</p>
                      {infos.map((l,i) => <CheckRow key={i} {...l}/>)}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Dyno setup status */}
            {graphs && !loading && (
              <div style={css.card}>
                <p style={css.sectionTitle}>Simulated Dyno — Setup Status</p>
                <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                  <span style={{ fontSize:12, padding:'4px 10px', borderRadius:99, background: hasRPM ? 'rgba(61,255,122,0.1)' : 'rgba(255,82,82,0.1)', color: hasRPM ? T.green : T.red }}>
                    {hasRPM ? '✓ RPM detected' : '✗ No RPM data'}
                  </span>
                  <span style={{ fontSize:12, padding:'4px 10px', borderRadius:99, background:'rgba(61,255,122,0.08)', color:T.muted }}>
                    Mode: {dynoMode === 'dyno' ? 'Dyno' : 'Track'}
                  </span>
                  {dynoMode==='track' && (
                    <span style={{ fontSize:12, padding:'4px 10px', borderRadius:99, background: formData.weight ? 'rgba(61,255,122,0.08)' : 'rgba(245,166,35,0.08)', color: formData.weight ? T.muted : T.amber }}>
                      {formData.weight ? `${formData.weight} lbs` : '⚠ Weight not set'}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Dyno chart */}
            {dyno && !loading && (
              <div className='st-card' style={{ animation:'fadeInUp 0.5s ease both' }}>
                <p style={css.sectionTitle}>Simulated Dyno Sheet</p>
                <p style={{ fontSize:12, color:T.muted, marginTop:-8, marginBottom:12 }}>
                  Single-gear WOT • Mode: {dynoMode} • Results are estimates (early BETA)
                </p>

                {/* Peak metrics */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:16 }}>
                  {dyno.peakHP && <MetricTile label="Peak HP" value={comma(dyno.peakHP.value)} sub={`@ ${comma(dyno.peakHP.rpm,0)} RPM`} accent={T.green}/>}
                  {dyno.peakTQ && <MetricTile label="Peak Torque" value={comma(dyno.peakTQ.value)} sub={`@ ${comma(dyno.peakTQ.rpm,0)} RPM`} accent={T.amber}/>}
                </div>

                {/* Chart */}
                <div style={{ height:260 }}>
                  <Line
                    data={{
                      datasets: [
                        {
                          label: 'Horsepower',
                          data: dyno.x.map((v,i)=>({x:v,y:dyno.hp[i]})).filter(p=>isNum(p.x)&&isNum(p.y)),
                          borderColor:'#3dff7a', backgroundColor:'rgba(61,255,122,0.12)',
                          yAxisID:'yHP', borderWidth:2, pointRadius:0, tension:0.25,
                        },
                        ...(dyno.tq ? [{
                          label: 'Torque (lb-ft)',
                          data: dyno.x.map((v,i)=>({x:v,y:dyno.tq[i]})).filter(p=>isNum(p.x)&&isNum(p.y)),
                          borderColor:T.amber, backgroundColor:'rgba(245,166,35,0.12)',
                          yAxisID:'yTQ', borderWidth:2, pointRadius:0, tension:0.25,
                        }] : []),
                      ]
                    }}
                    options={dynoChartOptions}
                  />
                </div>

                {/* Boost */}
                <div style={{ marginTop:16 }}>
                  <BoostSummary boostData={dynoRemote?.boost||null} checklistText={leftText}/>
                </div>
              </div>
            )}

            {/* AI Assessment — two clean cards, no INFO segmentation */}
            {!loading && aiText && (() => {
              // Strip any "AI Review:" prefix the backend might prepend
              const cleaned = aiText.replace(/^AI Review:\s*/i, '').trim();
              // Split on "What This Means For You" heading
              const summaryMatch = cleaned.match(/^(?:Summary\s*[:\n]?\s*)?([\s\S]*?)(?=What This Means For You|$)/i);
              const actionMatch  = cleaned.match(/What This Means For You\s*[:\n]?\s*([\s\S]+?)$/i);
              // Strip the word "Summary" if it appears as a standalone first line
              let summaryText = summaryMatch ? summaryMatch[1].trim() : cleaned;
              summaryText = summaryText.replace(/^Summary\s*[:\n]?\s*/i, '').trim();
              const actionText = actionMatch ? actionMatch[1].trim() : null;
              if (!summaryText && !actionText) return null;
              return (
                <div style={{ display:'grid', gap:12, animation:'fadeIn 0.55s ease' }}>
                  {summaryText && (
                    <div style={{ background:T.card, border:`1px solid ${T.borderHi}`, borderRadius:10, padding:20 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
                        <span style={{ fontSize:20 }}>🧠</span>
                        <span style={{ fontSize:14, fontWeight:700, color:T.green, letterSpacing:0.3 }}>Summary</span>
                      </div>
                      <p style={{ fontSize:14, lineHeight:1.8, color:T.text, margin:0 }}>{summaryText}</p>
                    </div>
                  )}
                  {actionText && (
                    <div className='st-ai-card st-ai-card-action'>
                      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
                        <span style={{ fontSize:20 }}>🔧</span>
                        <span style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:15, fontWeight:700, color:'#4db8ff', letterSpacing:1.5, textTransform:'uppercase' }}>What This Means For You</span>
                      </div>
                      <p style={{ fontSize:14, lineHeight:1.8, color:T.text, margin:0 }}>{actionText}</p>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* AI Suggestions */}
            {!loading && suggestions.length > 0 && (
              <div className='st-card' style={{ animation:'fadeInUp 0.6s ease both' }}>
                <p style={css.sectionTitle}>Tuning Suggestions</p>
                <div style={{ display:'grid', gap:12 }}>
                  {suggestions.map(s => (
                    <div key={s.id} style={{
                      background:'#0a100a', border:`1px solid ${T.border}`,
                      borderRadius:8, padding:14,
                    }}>
                      <div style={{ display:'flex', alignItems:'center', marginBottom:8 }}>
                        {SateraTone.showSeverityBadges && <SeverityBadge severity={s.severity}/>}
                        <strong style={{ fontSize:13, color:'#eaff9c' }}>{s.label}</strong>
                      </div>
                      <ul style={{ margin:0, paddingLeft:18, fontSize:13, color:T.muted, lineHeight:1.65 }}>
                        {s.bullets.map((b,i)=><li key={i} style={{ marginBottom:3 }}>{b}</li>)}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </main>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
