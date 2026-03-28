// frontend/src/TrainerMode.jsx
import React, { useState, useMemo, useRef, useEffect } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';

const API_BASE = process.env.REACT_APP_API_BASE || '/api';
const TRAINING_SYSTEM_MSG = 'You are Satera Tuning AI trainer. Learn from this before/after comparison to improve future tune assessments.';

// ── Design tokens (matches site theme) ────────────────────
const T = {
  bg: '#090c09', card: '#111811', cardHi: '#141e14',
  border: '#1a281a', borderHi: '#274027',
  green: '#3dff7a', greenLo: 'rgba(61,255,122,0.07)',
  greenGlow: 'rgba(61,255,122,0.15)',
  amber: '#f5a623', red: '#ff5252', blue: '#4db8ff',
  purple: '#b48eff',
  text: '#dff0df', muted: '#5a8f5a', faint: '#2e4a2e',
};

const css = {
  page: { background: T.bg, color: T.text, minHeight: '100vh', fontFamily: "'Inter', system-ui, sans-serif" },
  card: { background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20, position: 'relative', overflow: 'hidden' },
  cardHi: { background: T.cardHi, border: `1px solid ${T.borderHi}`, borderRadius: 12, padding: 20, position: 'relative', overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.3)' },
  sectionTitle: { fontFamily: "'Rajdhani', sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: T.green, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 },
  input: { width: '100%', background: 'rgba(0,0,0,0.3)', border: `1px solid ${T.border}`, borderRadius: 7, padding: '9px 12px', color: T.text, fontFamily: "'Inter', sans-serif", fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  select: { width: '100%', background: 'rgba(0,0,0,0.3)', border: `1px solid ${T.border}`, borderRadius: 7, padding: '9px 12px', color: T.text, fontSize: 13, outline: 'none', appearance: 'none', backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'%233dff7a\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'calc(100% - 12px) 50%', paddingRight: 32, boxSizing: 'border-box', cursor: 'pointer' },
  label: { display: 'block', fontSize: 11, color: T.muted, marginBottom: 5, letterSpacing: 0.5 },
  btnPrimary: { fontFamily: "'Rajdhani', sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#000', background: T.green, border: 'none', borderRadius: 7, padding: '11px 24px', cursor: 'pointer', boxShadow: '0 0 20px rgba(61,255,122,0.2)', transition: 'all 0.2s' },
  btnGhost: { fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 500, color: T.muted, background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 7, padding: '8px 16px', cursor: 'pointer', transition: 'all 0.2s' },
  btnAmber: { fontFamily: "'Rajdhani', sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: '#000', background: T.amber, border: 'none', borderRadius: 7, padding: '10px 20px', cursor: 'pointer' },
  btnPurple: { fontFamily: "'Rajdhani', sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: '#000', background: T.purple, border: 'none', borderRadius: 7, padding: '10px 20px', cursor: 'pointer' },
  btnRed: { fontFamily: "'Rajdhani', sans-serif", fontSize: 13, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: '#fff', background: 'rgba(255,82,82,0.15)', border: '1px solid rgba(255,82,82,0.3)', borderRadius: 7, padding: '10px 20px', cursor: 'pointer' },
};

// ── Helpers ────────────────────────────────────────────────
function extractEntryId(data) {
  if (!data) return null;
  return [data?.trainingEntry?.id, data?.trainer_entry_id, data?.entryId, data?.entry_id, data?.entry?.id, data?.id].find(Boolean) || null;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fmtDeg = (v) => isNum(v) ? `${Number(v).toFixed(1)}°` : '—';
const fmtSec = (v) => isNum(v) ? `${Number(v).toFixed(2)}s` : '—';
const fmtKpa = (v) => isNum(v) ? `${Number(v).toFixed(0)} kPa` : '—';
const fmtPsi = (v) => isNum(v) ? `${Number(v).toFixed(1)} psi` : '—';
const fmtPlain = (v) => (isNum(v) ? String(Number(v).toFixed(1)) : (v ?? '—'));
const withSign = (v, digits = 2, unit = '') => {
  if (!isNum(v)) return '—';
  return (v > 0 ? `+${v.toFixed(digits)}` : v.toFixed(digits)) + (unit ? ` ${unit}` : '');
};
const deltaColor = (key, val) => {
  if (!isNum(val)) return T.muted;
  const lowerBetter = ['t_0_60_change','t_40_100_change','t_60_130_change','KR_max_change','KR_event_change','varSTFT_change','varLTFT_change'];
  const higherBetter = ['sparkMaxWOT_change'];
  if (lowerBetter.includes(key)) return val < 0 ? T.green : val > 0 ? T.red : T.muted;
  if (higherBetter.includes(key)) return val > 0 ? T.green : val < 0 ? T.red : T.muted;
  return T.muted;
};

function normalizeComparison(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const safeN = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const kb = raw.before?.KR || raw.before?.knock || {};
  const ka = raw.after?.KR  || raw.after?.knock  || {};
  const tb = raw.before?.times || {};
  const ta = raw.after?.times  || {};
  const wb = raw.before?.WOT  || {};
  const wa = raw.after?.WOT   || {};
  const d  = raw.deltas || {};
  return {
    before: { KR: { maxKR: safeN(kb.maxKR), krEvents: safeN(kb.krEvents) }, times: { zeroToSixty: safeN(tb.zeroToSixty), fortyToHundred: safeN(tb.fortyToHundred), sixtyToOneThirty: safeN(tb.sixtyToOneThirty) }, WOT: { sparkMaxWOT: safeN(wb.sparkMaxWOT), mapMinWOT: safeN(wb.mapMinWOT), mapMaxWOT: safeN(wb.mapMaxWOT) }, varSTFT: safeN(raw.before?.varSTFT), varLTFT: safeN(raw.before?.varLTFT) },
    after:  { KR: { maxKR: safeN(ka.maxKR), krEvents: safeN(ka.krEvents) }, times: { zeroToSixty: safeN(ta.zeroToSixty), fortyToHundred: safeN(ta.fortyToHundred), sixtyToOneThirty: safeN(ta.sixtyToOneThirty) }, WOT: { sparkMaxWOT: safeN(wa.sparkMaxWOT), mapMinWOT: safeN(wa.mapMinWOT), mapMaxWOT: safeN(wa.mapMaxWOT) }, varSTFT: safeN(raw.after?.varSTFT), varLTFT: safeN(raw.after?.varLTFT) },
    deltas: { KR_max_change: safeN(d.KR_max_change), KR_event_change: safeN(d.KR_event_change), t_0_60_change: safeN(d.t_0_60_change), t_40_100_change: safeN(d.t_40_100_change), t_60_130_change: safeN(d.t_60_130_change), sparkMaxWOT_change: safeN(d.sparkMaxWOT_change), mapMinWOT_change: safeN(d.mapMinWOT_change), mapMaxWOT_change: safeN(d.mapMaxWOT_change), varSTFT_change: safeN(d.varSTFT_change), varLTFT_change: safeN(d.varLTFT_change) }
  };
}

// ── Sub-components ─────────────────────────────────────────
function MetricRow({ label, before, after, delta, deltaKey }) {
  const dColor = deltaColor(deltaKey, delta);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, padding: '7px 0', borderBottom: `1px solid ${T.border}`, alignItems: 'center' }}>
      <span style={{ fontSize: 12, color: T.muted }}>{label}</span>
      <span style={{ fontSize: 13, fontFamily: 'monospace', textAlign: 'right' }}>{before}</span>
      <span style={{ fontSize: 13, fontFamily: 'monospace', textAlign: 'right' }}>{after}</span>
      <span style={{ fontSize: 13, fontFamily: 'monospace', textAlign: 'right', color: dColor, fontWeight: 600 }}>{delta !== '—' && delta !== undefined ? delta : '—'}</span>
    </div>
  );
}

function UploadZone({ label, sublabel, file, onChange, id, color = T.green }) {
  return (
    <div>
      <label style={{ ...css.label, color, fontSize: 12, fontWeight: 600, letterSpacing: 0.8 }}>{label}</label>
      <label htmlFor={id} style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '13px 16px', borderRadius: 8,
        border: file ? `1.5px solid ${color}33` : `1.5px dashed ${T.borderHi}`,
        background: file ? `${color}08` : 'transparent',
        cursor: 'pointer', transition: 'all 0.2s',
        color: file ? T.text : T.muted, fontSize: 13,
      }}>
        <span style={{ fontSize: 16 }}>📂</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {file ? file.name : `Choose HP Tuners CSV…`}
        </span>
        {file && <span style={{ color, flexShrink: 0, fontSize: 12, fontWeight: 700 }}>✓</span>}
      </label>
      <input id={id} type="file" accept=".csv" onChange={onChange} style={{ display: 'none' }}/>
      {sublabel && <p style={{ fontSize: 11, color: T.faint, margin: '4px 0 0' }}>{sublabel}</p>}
    </div>
  );
}

function ChatBubble({ role, content }) {
  const isAI = role === 'assistant';
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexDirection: isAI ? 'row' : 'row-reverse' }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: isAI ? T.greenLo : 'rgba(77,184,255,0.1)', border: `1px solid ${isAI ? T.borderHi : 'rgba(77,184,255,0.2)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>
        {isAI ? '🤖' : '👤'}
      </div>
      <div style={{ maxWidth: '82%' }}>
        <div style={{ fontSize: 10, color: T.muted, marginBottom: 4, textAlign: isAI ? 'left' : 'right', letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: 600 }}>
          {isAI ? 'Satera AI' : 'You'}
        </div>
        <div style={{
          background: isAI ? T.card : 'rgba(77,184,255,0.06)',
          border: `1px solid ${isAI ? T.border : 'rgba(77,184,255,0.15)'}`,
          borderRadius: isAI ? '4px 12px 12px 12px' : '12px 4px 12px 12px',
          padding: '10px 14px', fontSize: 13, lineHeight: 1.65,
          color: T.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {content}
        </div>
      </div>
    </div>
  );
}

function StepIndicator({ steps, current }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 24 }}>
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: 30, height: 30, borderRadius: '50%',
              background: i < current ? T.green : i === current ? T.greenLo : 'transparent',
              border: `2px solid ${i <= current ? T.green : T.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, color: i < current ? '#000' : i === current ? T.green : T.muted,
              transition: 'all 0.3s',
            }}>
              {i < current ? '✓' : i + 1}
            </div>
            <span style={{ fontSize: 10, color: i <= current ? T.green : T.muted, letterSpacing: 0.5, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{s}</span>
          </div>
          {i < steps.length - 1 && (
            <div style={{ flex: 1, height: 2, background: i < current ? T.green : T.border, margin: '0 6px', marginBottom: 18, transition: 'background 0.3s' }}/>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────
const dropdownOptions = {
  year: Array.from({ length: 21 }, (_, i) => `${2005 + i}`),
  model: ['Charger', 'Challenger', '300', 'Durango', 'Ram 1500', 'Ram 2500', 'Jeep Grand Cherokee'],
  engine: ['5.7L Pre-Eagle', '5.7L Eagle', '6.1L SRT', '6.4L (392)', '6.2L Hellcat', '6.2L Redeye', '6.2L Demon', '6.2L Jailbreak'],
  injectors: ['Stock', 'ID850x', 'ID1050x', 'ID1300x', 'ID1700x', 'Custom'],
  map: ['Stock (1 Bar)', '2 Bar', '3 Bar', '4 Bar', 'Custom'],
  throttle: ['Stock', '87mm', '92mm', '95mm', '102mm', '105mm', 'Custom'],
  power: ['N/A (Naturally Aspirated)', 'Centrifugal Supercharger', 'PD Blower (Whipple/Magnuson)', 'Twin Turbo', 'Single Turbo', 'Nitrous', 'Custom'],
  trans: ['TR6060 (6-speed Manual)', 'NAG1/WA580 (5-speed Auto)', '8HP70 (8-speed Auto)', '8HP90 (8-speed Auto)'],
  tire: ['26"','27"','28"','29"','30"','31"','32"','33"'],
  gear: ['3.06','3.09','3.23','3.55','3.73','3.90','4.10'],
  fuel: ['91 Octane', '93 Octane', 'E30', 'E50', 'E85', 'Race Gas'],
  cam: ['Stock', 'Aftermarket'],
  neural: ['Enabled', 'Disabled'],
};

export default function TrainerMode() {
  const [form, setForm] = useState({ vin:'', calid:'', year:'', model:'', engine:'', injectors:'', map:'', throttle:'', power:'', trans:'', tire:'', gear:'', fuel:'', cam:'', neural:'' });
  const [beforeLog, setBeforeLog] = useState(null);
  const [afterLog,  setAfterLog]  = useState(null);
  const [step, setStep]           = useState(0); // 0=setup, 1=analyzing, 2=results, 3=saved

  const [aiSummary, setAiSummary]   = useState('');
  const [comparison, setComparison] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const [trainerEntryId, setTrainerEntryId] = useState(null);

  const [chat, setChat]     = useState([{ role:'assistant', content:'Upload your before and after tune logs, fill in the vehicle details, and click Analyze. I will compare both logs and give you a full breakdown of what changed.' }]);
  const [message, setMessage] = useState('');
  const [notes, setNotes]     = useState('');

  const [loading, setLoading]         = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [status, setStatus]           = useState('');
  const [toast, setToast]             = useState({ text:'', type:'ok' });
  const [examplesTotal, setExamplesTotal] = useState(null);

  const chatEndRef = useRef(null);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat]);

  const showToast = (text, type = 'ok') => { setToast({ text, type }); setTimeout(() => setToast({ text:'', type:'ok' }), 6000); };

  const handleChange = (e) => setForm(p => ({ ...p, [e.target.name]: e.target.value }));

  const handleVCMPaste = (e) => {
    const text = e.target.value;
    const vinMatch  = text.match(/VIN:\s*(\w{17})/);
    const modelLine = text.split('\n').find(l => /\d{4}\s+Dodge/i.test(l));
    const osMatches = text.match(/OS:\s*(\w+)/g);
    setForm(p => ({
      ...p,
      vin:   vinMatch?.[1] || p.vin,
      year:  modelLine?.match(/(20\d{2})/)?.[1] || p.year,
      model: modelLine?.includes('Charger') ? 'Charger' : modelLine?.includes('Challenger') ? 'Challenger' : p.model,
      engine:modelLine?.includes('6.4') ? '6.4L (392)' : modelLine?.includes('6.2') ? '6.2L Hellcat' : p.engine,
      calid: osMatches?.[0]?.split(':')[1]?.trim() || p.calid,
    }));
  };

  // ── Analyze ──────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!beforeLog || !afterLog) { showToast('Please upload both Before and After CSV logs.', 'err'); return; }
    setLoading(true);
    setStep(1);
    setStatus('Uploading and analyzing logs…');
    try {
      const fd = new FormData();
      fd.append('beforeLog', beforeLog);
      fd.append('afterLog',  afterLog);
      fd.append('meta', JSON.stringify(form));

      const res = await axios.post(`${API_BASE}/trainer-ai`, fd);
      const data = res.data || {};

      setAiSummary(data.aiSummary || '');
      setComparison(normalizeComparison(data.comparison || data.metrics || null));
      setConversationId(data.conversationId || data.conversation_id || null);

      const id = extractEntryId(data);
      if (id) setTrainerEntryId(id);

      setChat([{ role:'assistant', content: data.aiSummary || 'Analysis complete.' }]);
      setStep(2);
      setStatus('');
      showToast('Analysis complete — review the summary and metrics below.', 'ok');
    } catch (err) {
      setStep(0);
      setStatus('');
      showToast(`Analysis failed: ${err?.response?.data?.error || err.message}`, 'err');
    } finally {
      setLoading(false);
    }
  };

  // ── Chat ─────────────────────────────────────────────────
  const sendChat = async () => {
    if (!conversationId) { showToast('Run an analysis first.', 'err'); return; }
    if (!message.trim()) return;
    const userMsg = { role:'user', content: message.trim() };
    setChat(p => [...p, userMsg]);
    setMessage('');
    setChatLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/trainer-chat`, { conversationId, message: userMsg.content });
      setChat(p => [...p, { role:'assistant', content: res.data.reply || 'No response.' }]);
    } catch (err) {
      setChat(p => [...p, { role:'assistant', content: `Chat error: ${err.message}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  // ── Training pairs ────────────────────────────────────────
  const chatPairs = useMemo(() => {
    const pairs = [];
    for (let i = 0; i < chat.length; i++) {
      if (chat[i].role === 'user') {
        const user = chat[i].content;
        for (let j = i + 1; j < chat.length; j++) {
          if (chat[j].role === 'assistant') {
            pairs.push({ system: TRAINING_SYSTEM_MSG, user, assistant: chat[j].content });
            break;
          }
        }
      }
    }
    return pairs;
  }, [chat]);

  const saveTraining = async () => {
    if (!trainerEntryId) { showToast('No entry ID — run analysis first.', 'err'); return; }
    if (!chatPairs.length) { showToast('No chat pairs to save yet — have a conversation first.', 'err'); return; }
    try {
      const res = await axios.post(`${API_BASE}/trainer/save-chat`, { trainer_entry_id: trainerEntryId, chatPairs, notes });
      const j = res.data;
      if (!j.ok) throw new Error(j.error);
      showToast(`Saved ${j.added} example(s). Total in session: ${j.total_examples_for_entry}`, 'ok');
    } catch (e) { showToast(`Save failed: ${e.message}`, 'err'); }
  };

  const finalizeTraining = async () => {
    if (!trainerEntryId) { showToast('No entry ID — run analysis first.', 'err'); return; }
    try {
      const res = await axios.post(`${API_BASE}/trainer/finalize`, { trainer_entry_id: trainerEntryId, appendToJsonl: true });
      const j = res.data;
      if (!j.ok) throw new Error(j.error);
      setExamplesTotal(j.totalExamplesInFile);
      setStep(3);
      showToast(`Committed ${j.appended} example(s) to training dataset. Total: ${j.totalExamplesInFile}${j.totalExamplesInFile < 10 ? ' (need ≥10 for fine-tune)' : ' ✅'}`, 'ok');
    } catch (e) { showToast(`Finalize failed: ${e.message}`, 'err'); }
  };

  const startFineTune = async () => {
    try {
      const res = await axios.post(`${API_BASE}/fine-tune-now`);
      showToast(`Fine-tune job started! Job ID: ${res.data.job?.id}`, 'ok');
    } catch (e) { showToast(`Fine-tune failed: ${e?.response?.data?.error || e.message}`, 'err'); }
  };

  // ── Render ────────────────────────────────────────────────
  const c = comparison;
  const steps = ['Vehicle Setup', 'Analysis', 'Review & Train', 'Complete'];

  return (
    <div style={css.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&family=Inter:wght@300;400;500&display=swap');
        * { box-sizing: border-box; }
        select option { background: #111811; }
        input[type=file] { display: none; }
        .st-input:focus { border-color: rgba(61,255,122,0.3) !important; box-shadow: 0 0 0 3px rgba(61,255,122,0.06); }
        .st-btn-primary:hover { box-shadow: 0 0 30px rgba(61,255,122,0.4); transform: translateY(-1px); }
        .st-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
        ::-webkit-scrollbar { width: 5px; } ::-webkit-scrollbar-thumb { background: #274027; border-radius: 3px; }
        @keyframes fadeInUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        .analyzing { animation: pulse 1.5s ease-in-out infinite; }
      `}</style>

      {/* ── HEADER ── */}
      <header style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0 32px', height:68, background:'rgba(9,12,9,0.95)', borderBottom:`1px solid ${T.borderHi}`, position:'sticky', top:0, zIndex:100, backdropFilter:'blur(12px)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, fontFamily:"'Rajdhani',sans-serif", fontSize:22, fontWeight:700, letterSpacing:1.5, textTransform:'uppercase', color:T.green }}>
          <div style={{ width:34, height:34, border:`1.5px solid ${T.green}`, borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <svg width="18" height="18" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="10" stroke="#3dff7a" strokeWidth="1.5"/><path d="M7 9l3 3 5-5" stroke="#3dff7a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          Satera Tuning
          <span style={{ fontFamily:"'Inter',sans-serif", fontSize:11, fontWeight:400, color:T.muted, textTransform:'none', letterSpacing:0 }}>Trainer Mode</span>
          <span style={{ fontSize:9, fontWeight:600, letterSpacing:1.5, textTransform:'uppercase', color:T.faint, background:T.greenLo, border:`1px solid rgba(61,255,122,0.1)`, borderRadius:4, padding:'2px 7px' }}>INTERNAL</span>
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <Link to="/ai-review" style={{ ...css.btnGhost, textDecoration:'none', display:'inline-block' }}>AI Review</Link>
          <Link to="/log-comparison" style={{ ...css.btnGhost, textDecoration:'none', display:'inline-block' }}>Log Comparison</Link>
        </div>
      </header>

      <div style={{ padding:'28px 32px', maxWidth:1400, margin:'0 auto' }}>

        {/* ── Page title + steps ── */}
        <div style={{ marginBottom:28 }}>
          <h1 style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:32, fontWeight:700, letterSpacing:1, margin:'0 0 6px', color:T.text }}>
            Tune Comparison Trainer
          </h1>
          <p style={{ fontSize:13, color:T.muted, margin:'0 0 24px', lineHeight:1.6 }}>
            Upload a before and after tune log for the same vehicle. The AI compares the two, identifies what changed, and learns from your corrections — building toward automated tune generation over time.
          </p>
          <StepIndicator steps={steps} current={step}/>
        </div>

        {/* ── Toast notification ── */}
        {toast.text && (
          <div style={{ padding:'12px 18px', borderRadius:8, marginBottom:20, fontSize:13, lineHeight:1.5, background: toast.type === 'err' ? 'rgba(255,82,82,0.08)' : 'rgba(61,255,122,0.06)', border:`1px solid ${toast.type === 'err' ? 'rgba(255,82,82,0.25)' : 'rgba(61,255,122,0.2)'}`, color: toast.type === 'err' ? T.red : T.green, animation:'fadeInUp 0.3s ease' }}>
            {toast.text}
          </div>
        )}

        <div style={{ display:'grid', gridTemplateColumns:'380px 1fr', gap:20, alignItems:'start' }}>

          {/* ── LEFT: Setup panel ── */}
          <div style={{ display:'grid', gap:16 }}>

            {/* VCM paste */}
            <div style={css.card}>
              <p style={css.sectionTitle}>Quick Fill from VCM Editor</p>
              <label style={css.label}>Paste VCM Editor info block (optional — auto-fills fields below)</label>
              <textarea
                onBlur={handleVCMPaste}
                placeholder="Copy and paste from VCM Editor's vehicle info screen…"
                rows={4}
                style={{ ...css.input, resize:'vertical', lineHeight:1.5 }}
              />
            </div>

            {/* Vehicle info */}
            <div style={css.card}>
              <p style={css.sectionTitle}>Vehicle Details</p>
              <div style={{ display:'grid', gap:10 }}>
                {/* VIN + CALID */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  <div><label style={css.label}>VIN</label><input name="vin" value={form.vin} onChange={handleChange} placeholder="1B3..." style={css.input}/></div>
                  <div><label style={css.label}>Calibration ID</label><input name="calid" value={form.calid} onChange={handleChange} placeholder="OS Cal ID" style={css.input}/></div>
                </div>
                {/* Year + Model */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  <div>
                    <label style={css.label}>Year</label>
                    <select name="year" value={form.year} onChange={handleChange} style={css.select}>
                      <option value="">Select…</option>{dropdownOptions.year.map(o=><option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={css.label}>Model</label>
                    <select name="model" value={form.model} onChange={handleChange} style={css.select}>
                      <option value="">Select…</option>{dropdownOptions.model.map(o=><option key={o}>{o}</option>)}
                    </select>
                  </div>
                </div>
                {/* Engine */}
                <div><label style={css.label}>Engine</label><select name="engine" value={form.engine} onChange={handleChange} style={css.select}><option value="">Select…</option>{dropdownOptions.engine.map(o=><option key={o}>{o}</option>)}</select></div>
                {/* Fuel + Power */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  <div><label style={css.label}>Fuel</label><select name="fuel" value={form.fuel} onChange={handleChange} style={css.select}><option value="">Select…</option>{dropdownOptions.fuel.map(o=><option key={o}>{o}</option>)}</select></div>
                  <div><label style={css.label}>Power Adder</label><select name="power" value={form.power} onChange={handleChange} style={css.select}><option value="">Select…</option>{dropdownOptions.power.map(o=><option key={o}>{o}</option>)}</select></div>
                </div>
                {/* Trans + Injectors */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  <div><label style={css.label}>Transmission</label><select name="trans" value={form.trans} onChange={handleChange} style={css.select}><option value="">Select…</option>{dropdownOptions.trans.map(o=><option key={o}>{o}</option>)}</select></div>
                  <div><label style={css.label}>Injectors</label><select name="injectors" value={form.injectors} onChange={handleChange} style={css.select}><option value="">Select…</option>{dropdownOptions.injectors.map(o=><option key={o}>{o}</option>)}</select></div>
                </div>
                {/* MAP + Throttle */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  <div><label style={css.label}>MAP Sensor</label><select name="map" value={form.map} onChange={handleChange} style={css.select}><option value="">Select…</option>{dropdownOptions.map.map(o=><option key={o}>{o}</option>)}</select></div>
                  <div><label style={css.label}>Throttle Body</label><select name="throttle" value={form.throttle} onChange={handleChange} style={css.select}><option value="">Select…</option>{dropdownOptions.throttle.map(o=><option key={o}>{o}</option>)}</select></div>
                </div>
                {/* Gear + Tire */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  <div><label style={css.label}>Rear Gear</label><select name="gear" value={form.gear} onChange={handleChange} style={css.select}><option value="">Select…</option>{dropdownOptions.gear.map(o=><option key={o}>{o}</option>)}</select></div>
                  <div><label style={css.label}>Tire Height</label><select name="tire" value={form.tire} onChange={handleChange} style={css.select}><option value="">Select…</option>{dropdownOptions.tire.map(o=><option key={o}>{o}</option>)}</select></div>
                </div>
                {/* Cam + Neural */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  <div><label style={css.label}>Aftermarket Cam</label><select name="cam" value={form.cam} onChange={handleChange} style={css.select}><option value="">Select…</option>{dropdownOptions.cam.map(o=><option key={o}>{o}</option>)}</select></div>
                  <div><label style={css.label}>Neural Network</label><select name="neural" value={form.neural} onChange={handleChange} style={css.select}><option value="">Select…</option>{dropdownOptions.neural.map(o=><option key={o}>{o}</option>)}</select></div>
                </div>
              </div>
            </div>

            {/* Log uploads */}
            <div style={css.cardHi}>
              <p style={css.sectionTitle}>Log Files</p>
              <div style={{ display:'grid', gap:12 }}>
                <UploadZone label="Before Log (CSV) — Stock / Pre-Tune" sublabel="The baseline — stock or before modifications" file={beforeLog} onChange={e=>setBeforeLog(e.target.files[0])} id="beforeInput" color={T.blue}/>
                <UploadZone label="After Log (CSV) — Tuned / Modified" sublabel="The result — after tune and/or modifications" file={afterLog} onChange={e=>setAfterLog(e.target.files[0])} id="afterInput" color={T.green}/>
              </div>
              <button
                onClick={handleAnalyze}
                disabled={loading || !beforeLog || !afterLog}
                className="st-btn-primary"
                style={{ ...css.btnPrimary, width:'100%', marginTop:16, opacity: (loading||!beforeLog||!afterLog) ? 0.4 : 1 }}
              >
                {loading ? (
                  <span className="analyzing">⚡ Analyzing Logs…</span>
                ) : '⚡ Analyze & Compare'}
              </button>
              {status && <p style={{ fontSize:12, color:T.muted, margin:'10px 0 0', textAlign:'center' }}>{status}</p>}
            </div>

            {/* Training counter */}
            {examplesTotal !== null && (
              <div style={{ ...css.card, textAlign:'center', animation:'fadeInUp 0.4s ease' }}>
                <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:11, fontWeight:700, letterSpacing:2, textTransform:'uppercase', color:T.muted, marginBottom:8 }}>Training Dataset</div>
                <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:48, fontWeight:700, color: examplesTotal >= 10 ? T.green : T.amber, lineHeight:1 }}>{examplesTotal}</div>
                <div style={{ fontSize:12, color:T.muted, marginTop:4 }}>examples collected</div>
                <div style={{ fontSize:11, color: examplesTotal >= 10 ? T.green : T.amber, marginTop:6 }}>
                  {examplesTotal >= 10 ? '✅ Ready for fine-tuning' : `Need ${10 - examplesTotal} more for fine-tune`}
                </div>
                {examplesTotal >= 10 && (
                  <button onClick={startFineTune} style={{ ...css.btnPurple, marginTop:14, width:'100%' }}>
                    🤖 Start Fine-Tune Job
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── RIGHT: Results panel ── */}
          <div style={{ display:'grid', gap:16 }}>

            {/* Placeholder when no results */}
            {!aiSummary && (
              <div style={{ ...css.card, minHeight:300, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, color:T.muted }}>
                <div style={{ fontSize:40 }}>📊</div>
                <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:16, fontWeight:600, letterSpacing:1 }}>No Analysis Yet</div>
                <div style={{ fontSize:13, textAlign:'center', maxWidth:340, lineHeight:1.6 }}>
                  Fill in vehicle details, upload your before and after logs, then click Analyze to see the full comparison.
                </div>
              </div>
            )}

            {/* AI Summary */}
            {aiSummary && (
              <div style={{ ...css.cardHi, animation:'fadeInUp 0.4s ease' }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
                  <span style={{ fontSize:20 }}>🧠</span>
                  <span style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:15, fontWeight:700, color:T.green, letterSpacing:1.5, textTransform:'uppercase' }}>AI Comparison Summary</span>
                </div>
                <div style={{ fontSize:14, lineHeight:1.8, color:T.text, whiteSpace:'pre-wrap' }}>
                  {aiSummary}
                </div>
              </div>
            )}

            {/* Metrics comparison table */}
            {c && (
              <div style={{ ...css.card, animation:'fadeInUp 0.5s ease' }}>
                <p style={css.sectionTitle}>Before vs After — Key Metrics</p>

                {/* Column headers */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:8, padding:'6px 0 10px', borderBottom:`2px solid ${T.borderHi}`, marginBottom:4 }}>
                  <span style={{ fontSize:11, color:T.muted, fontWeight:600, letterSpacing:0.8 }}>METRIC</span>
                  <span style={{ fontSize:11, color:T.blue, fontWeight:700, letterSpacing:0.8, textAlign:'right' }}>BEFORE</span>
                  <span style={{ fontSize:11, color:T.green, fontWeight:700, letterSpacing:0.8, textAlign:'right' }}>AFTER</span>
                  <span style={{ fontSize:11, color:T.muted, fontWeight:600, letterSpacing:0.8, textAlign:'right' }}>DELTA</span>
                </div>

                {/* Knock section */}
                <div style={{ fontSize:10, color:T.muted, fontWeight:700, letterSpacing:1.5, textTransform:'uppercase', margin:'12px 0 6px' }}>Knock Retard</div>
                <MetricRow label="Max KR" before={fmtDeg(c.before.KR.maxKR)} after={fmtDeg(c.after.KR.maxKR)} delta={withSign(c.deltas.KR_max_change,1,'°')} deltaKey="KR_max_change"/>
                <MetricRow label="KR Events" before={fmtPlain(c.before.KR.krEvents)} after={fmtPlain(c.after.KR.krEvents)} delta={withSign(c.deltas.KR_event_change,0)} deltaKey="KR_event_change"/>

                {/* Timing */}
                <div style={{ fontSize:10, color:T.muted, fontWeight:700, letterSpacing:1.5, textTransform:'uppercase', margin:'12px 0 6px' }}>WOT Timing</div>
                <MetricRow label="Peak Spark @WOT" before={fmtDeg(c.before.WOT.sparkMaxWOT)} after={fmtDeg(c.after.WOT.sparkMaxWOT)} delta={withSign(c.deltas.sparkMaxWOT_change,1,'°')} deltaKey="sparkMaxWOT_change"/>
                <MetricRow label="MAP min @WOT" before={fmtKpa(c.before.WOT.mapMinWOT)} after={fmtKpa(c.after.WOT.mapMinWOT)} delta={withSign(c.deltas.mapMinWOT_change,0,'kPa')} deltaKey="mapMinWOT_change"/>
                <MetricRow label="MAP max @WOT" before={fmtKpa(c.before.WOT.mapMaxWOT)} after={fmtKpa(c.after.WOT.mapMaxWOT)} delta={withSign(c.deltas.mapMaxWOT_change,0,'kPa')} deltaKey="mapMaxWOT_change"/>

                {/* Acceleration */}
                <div style={{ fontSize:10, color:T.muted, fontWeight:700, letterSpacing:1.5, textTransform:'uppercase', margin:'12px 0 6px' }}>Acceleration Times</div>
                <MetricRow label="0–60 mph" before={fmtSec(c.before.times.zeroToSixty)} after={fmtSec(c.after.times.zeroToSixty)} delta={withSign(c.deltas.t_0_60_change,2,'s')} deltaKey="t_0_60_change"/>
                <MetricRow label="40–100 mph" before={fmtSec(c.before.times.fortyToHundred)} after={fmtSec(c.after.times.fortyToHundred)} delta={withSign(c.deltas.t_40_100_change,2,'s')} deltaKey="t_40_100_change"/>
                <MetricRow label="60–130 mph" before={fmtSec(c.before.times.sixtyToOneThirty)} after={fmtSec(c.after.times.sixtyToOneThirty)} delta={withSign(c.deltas.t_60_130_change,2,'s')} deltaKey="t_60_130_change"/>

                {/* Fuel trims */}
                <div style={{ fontSize:10, color:T.muted, fontWeight:700, letterSpacing:1.5, textTransform:'uppercase', margin:'12px 0 6px' }}>Fuel Trims</div>
                <MetricRow label="STFT Variance" before={fmtPlain(c.before.varSTFT)} after={fmtPlain(c.after.varSTFT)} delta={withSign(c.deltas.varSTFT_change,2)} deltaKey="varSTFT_change"/>
                <MetricRow label="LTFT Variance" before={fmtPlain(c.before.varLTFT)} after={fmtPlain(c.after.varLTFT)} delta={withSign(c.deltas.varLTFT_change,2)} deltaKey="varLTFT_change"/>

                {/* Delta legend */}
                <div style={{ display:'flex', gap:16, marginTop:14, paddingTop:12, borderTop:`1px solid ${T.border}` }}>
                  <span style={{ fontSize:11, color:T.muted }}>Delta color key:</span>
                  <span style={{ fontSize:11, color:T.green }}>● Improvement</span>
                  <span style={{ fontSize:11, color:T.red }}>● Worse</span>
                  <span style={{ fontSize:11, color:T.muted }}>● No change</span>
                </div>
              </div>
            )}

            {/* Chat window */}
            {step >= 2 && (
              <div style={{ ...css.card, animation:'fadeInUp 0.6s ease' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
                  <p style={{ ...css.sectionTitle, margin:0 }}>Trainer Chat</p>
                  <span style={{ fontSize:11, color:T.muted }}>Correct, question, or add context to the AI assessment</span>
                </div>

                {/* Chat messages */}
                <div style={{ maxHeight:380, overflowY:'auto', padding:'4px 0', marginBottom:12 }}>
                  {chat.map((m,i) => <ChatBubble key={i} role={m.role} content={m.content}/>)}
                  {chatLoading && (
                    <div style={{ display:'flex', gap:10, marginBottom:14 }}>
                      <div style={{ width:28, height:28, borderRadius:'50%', background:T.greenLo, border:`1px solid ${T.borderHi}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13 }}>🤖</div>
                      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:'4px 12px 12px 12px', padding:'10px 14px', color:T.muted, fontSize:13 }}>
                        <span className="analyzing">Thinking…</span>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef}/>
                </div>

                {/* Chat input */}
                <div style={{ display:'flex', gap:8 }}>
                  <input
                    value={message}
                    onChange={e=>setMessage(e.target.value)}
                    onKeyDown={e=>{ if(e.key==='Enter' && !e.shiftKey) sendChat(); }}
                    placeholder="Ask about knock, timing, fuel trims, boost… or correct anything the AI got wrong"
                    style={{ ...css.input, flex:1 }}
                    disabled={chatLoading}
                  />
                  <button onClick={sendChat} disabled={chatLoading || !message.trim()} style={{ ...css.btnPrimary, padding:'9px 18px', flexShrink:0, opacity: (!message.trim()||chatLoading) ? 0.4 : 1 }}>
                    Send
                  </button>
                </div>
              </div>
            )}

            {/* Training controls */}
            {step >= 2 && (
              <div style={{ ...css.card, animation:'fadeInUp 0.7s ease' }}>
                <p style={css.sectionTitle}>Save to Training Dataset</p>
                <p style={{ fontSize:13, color:T.muted, margin:'0 0 14px', lineHeight:1.6 }}>
                  Once you've reviewed the AI summary and had a chat to correct anything, save this session as training data. Over time this builds the dataset used to fine-tune the model to sound and think like you.
                </p>

                <div>
                  <label style={css.label}>Session Notes (optional — describe what this vehicle/tune represents)</label>
                  <textarea
                    value={notes}
                    onChange={e=>setNotes(e.target.value)}
                    placeholder="e.g. 2019 Hellcat, stock to Stage 2 Whipple swap, E85 conversion, ID1050x injectors..."
                    rows={3}
                    style={{ ...css.input, resize:'vertical', lineHeight:1.5, marginBottom:14 }}
                  />
                </div>

                <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                  <button onClick={saveTraining} style={css.btnAmber}>
                    💾 Save Chat as Training
                  </button>
                  <button onClick={finalizeTraining} style={css.btnPrimary}>
                    ✅ Finalize & Commit to Dataset
                  </button>
                </div>

                {trainerEntryId && (
                  <p style={{ fontSize:11, color:T.faint, margin:'10px 0 0' }}>
                    Session ID: <code style={{ color:T.muted }}>{trainerEntryId}</code>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
