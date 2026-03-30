// frontend/src/Portal.jsx
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { auth, signInWithGoogle, signOutUser, onAuthStateChanged } from './firebase';

const API_BASE = process.env.REACT_APP_API_BASE || '/api';

// ── Design tokens ──────────────────────────────────────────
const T = {
  bg: '#090c09', card: '#111811', cardHi: '#141e14',
  border: '#1a281a', borderHi: '#274027',
  green: '#3dff7a', greenLo: 'rgba(61,255,122,0.07)',
  amber: '#f5a623', red: '#ff5252', blue: '#4db8ff',
  text: '#dff0df', muted: '#5a8f5a', faint: '#2e4a2e',
};

const css = {
  page:    { background: T.bg, color: T.text, minHeight: '100vh', fontFamily: "'Inter', system-ui, sans-serif" },
  card:    { background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 20, position: 'relative' },
  cardHi:  { background: T.cardHi, border: `1px solid ${T.borderHi}`, borderRadius: 12, padding: 20, position: 'relative', boxShadow: '0 4px 24px rgba(0,0,0,0.3)' },
  title:   { fontFamily: "'Rajdhani',sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: T.green, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 },
  input:   { width: '100%', background: 'rgba(0,0,0,0.3)', border: `1px solid ${T.border}`, borderRadius: 7, padding: '9px 12px', color: T.text, fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: "'Inter',sans-serif" },
  select:  { width: '100%', background: 'rgba(0,0,0,0.3)', border: `1px solid ${T.border}`, borderRadius: 7, padding: '9px 12px', color: T.text, fontSize: 13, outline: 'none', appearance: 'none', backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'%233dff7a\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'calc(100% - 12px) 50%', paddingRight: 32, boxSizing: 'border-box', cursor: 'pointer' },
  label:   { display: 'block', fontSize: 11, color: T.muted, marginBottom: 5, letterSpacing: 0.5 },
  btnPrimary: { fontFamily: "'Rajdhani',sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#000', background: T.green, border: 'none', borderRadius: 7, padding: '11px 24px', cursor: 'pointer', boxShadow: '0 0 20px rgba(61,255,122,0.2)', transition: 'all 0.2s' },
  btnGhost:   { fontFamily: "'Inter',sans-serif", fontSize: 12, fontWeight: 500, color: T.muted, background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 7, padding: '8px 16px', cursor: 'pointer' },
};

const OPTS = {
  year: Array.from({ length: 21 }, (_, i) => `${2005 + i}`),
  model: ['Charger', 'Challenger', '300', 'Durango', 'Ram 1500', 'Ram 2500', 'Jeep Grand Cherokee'],
  engine: ['5.7L Pre-Eagle', '5.7L Eagle', '6.1L SRT', '6.4L (392)', '6.2L Hellcat', '6.2L Redeye', '6.2L Demon', '6.2L Jailbreak'],
  fuel: ['91 Octane', '93 Octane', 'E30', 'E50', 'E85', 'Race Gas'],
  power_adder: ['N/A (Naturally Aspirated)', 'Centrifugal Supercharger', 'PD Blower (Whipple/Magnuson)', 'Twin Turbo', 'Single Turbo', 'Nitrous'],
  transmission: ['TR6060 (6-speed Manual)', 'NAG1/WA580 (5-speed Auto)', '8HP70 (8-speed Auto)', '8HP90 (8-speed Auto)'],
  injectors: ['Stock', 'ID850x', 'ID1050x', 'ID1300x', 'ID1700x'],
  map_sensor: ['Stock (1 Bar)', '2 Bar', '3 Bar', '4 Bar'],
  throttle_body: ['Stock', '87mm', '92mm', '95mm', '102mm', '105mm'],
  rear_gear: ['3.06', '3.09', '3.23', '3.55', '3.73', '3.90', '4.10'],
  tire_height: ['26"', '27"', '28"', '29"', '30"', '31"', '32"', '33"'],
  cam: ['Stock', 'Aftermarket'],

};

const STAGE_INFO = {
  1: { name: 'Idle & Startup',      icon: '🔑', color: T.blue   },
  2: { name: 'Part Throttle Cruise', icon: '🛣️', color: T.amber  },
  3: { name: 'WOT — Low RPM',        icon: '⚡', color: T.amber  },
  4: { name: 'WOT — Full Pull',      icon: '🏁', color: T.green  },
};

// ── Auth helpers ──────────────────────────────────────────
function getAuthHeader(user) {
  if (!user) return {};
  return { 'x-user-id': user.uid, Authorization: `Bearer ${user.accessToken || ''}` };
}

// ── Sub-components ────────────────────────────────────────
function SectionTitle({ children }) {
  return (
    <p style={css.title}>
      {children}
      <span style={{ flex:1, height:1, background:`linear-gradient(90deg, ${T.borderHi}, transparent)` }}/>
    </p>
  );
}

function StageTracker({ currentStage, stagesPassed, sessionComplete }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:0, marginBottom:24 }}>
      {[1,2,3,4].map((s, i) => {
        const passed  = stagesPassed?.includes(s);
        const active  = s === currentStage && !sessionComplete;
        const locked  = s > currentStage && !passed;
        const info    = STAGE_INFO[s];
        return (
          <React.Fragment key={s}>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                background: passed ? T.green : active ? T.greenLo : 'transparent',
                border: `2px solid ${passed ? T.green : active ? T.green : T.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: passed ? 16 : 20,
                color: passed ? '#000' : locked ? T.faint : T.text,
                transition: 'all 0.3s',
              }}>
                {passed ? '✓' : info.icon}
              </div>
              <span style={{ fontSize:10, color: passed ? T.green : active ? T.green : T.muted, letterSpacing:0.5, textTransform:'uppercase', whiteSpace:'nowrap', textAlign:'center', maxWidth:80 }}>
                {info.name}
              </span>
            </div>
            {i < 3 && (
              <div style={{ flex:1, height:2, background: passed ? T.green : T.border, margin:'0 6px', marginBottom:22, transition:'background 0.3s' }}/>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function VehicleCard({ vehicle, onSelect, onDelete, selected }) {
  return (
    <div
      onClick={() => onSelect(vehicle)}
      style={{
        ...css.card,
        cursor: 'pointer',
        border: `1px solid ${selected ? T.green : T.border}`,
        background: selected ? 'rgba(61,255,122,0.04)' : T.card,
        transition: 'all 0.2s',
      }}
    >
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div>
          <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:16, fontWeight:700, color: selected ? T.green : T.text, marginBottom:4 }}>
            {vehicle.nickname || `${vehicle.year} ${vehicle.model}`}
          </div>
          <div style={{ fontSize:12, color:T.muted, lineHeight:1.7 }}>
            {vehicle.year} {vehicle.make} {vehicle.model} • {vehicle.engine}<br/>
            {vehicle.fuel} • {vehicle.power_adder}<br/>
            {vehicle.transmission && <span>{vehicle.transmission}</span>}
          </div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:6, alignItems:'flex-end' }}>
          {selected && (
            <span style={{ fontSize:10, fontWeight:700, color:T.green, letterSpacing:1, background:T.greenLo, border:`1px solid rgba(61,255,122,0.2)`, borderRadius:4, padding:'2px 8px' }}>SELECTED</span>
          )}
          <button
            onClick={e => { e.stopPropagation(); onDelete(vehicle.id); }}
            style={{ ...css.btnGhost, fontSize:11, padding:'4px 10px', color:T.red, borderColor:'rgba(255,82,82,0.2)' }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────
export default function Portal() {
  const [user, setUser]               = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView]               = useState('garage');   // garage | new-vehicle | session
  const [vehicles, setVehicles]       = useState([]);
  const [sessions, setSessions]       = useState([]);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [activeSession, setActiveSession]     = useState(null);
  const [stageLogs, setStageLogs]             = useState([]);

  const [vehicleForm, setVehicleForm] = useState({
    nickname:'', vin:'', year:'', make:'Dodge', model:'', engine:'', fuel:'', power_adder:'',
    transmission:'', rear_gear:'', tire_height:'', injectors:'', map_sensor:'',
    throttle_body:'', cam:'', calid:'', trans_calid:'', trans_model:'', notes:'',
  });

  const [logFile, setLogFile]       = useState(null);
  const [tableRevision, setTableRevision] = useState(null);
  const [showTableSubmit, setShowTableSubmit] = useState(false);
  const [injectorTable, setInjectorTable] = useState('');
  const [veTable, setVeTable]             = useState('');
  const [sparkTable, setSparkTable]       = useState('');
  const [submittingTables, setSubmittingTables] = useState(false);
  const [logFileName, setLogFileName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [stageResult, setStageResult] = useState(null);
  const [error, setError]           = useState('');
  const [toast, setToast]           = useState('');

  const fileRef = useRef();

  const showToast = (msg, type='ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(''), 5000);
  };

  // ── Auth ─────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      setUser(u);
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (user) {
      loadVehicles();
      loadSessions();
    }
  }, [user]);

  const signIn = async () => {
    try { await signInWithGoogle(); }
    catch (e) { setError(e.message); }
  };

  const handleSignOut = async () => {
    await signOutUser();
    setView('garage');
    setActiveSession(null);
    setSelectedVehicle(null);
  };

  // ── Data loading ──────────────────────────────────────────
  const loadVehicles = async () => {
    try {
      const res = await axios.get(`${API_BASE}/portal/vehicles`, { headers: getAuthHeader(user) });
      setVehicles(res.data.vehicles || []);
    } catch (e) { console.error('Load vehicles:', e); }
  };

  const loadSessions = async () => {
    try {
      const res = await axios.get(`${API_BASE}/portal/sessions`, { headers: getAuthHeader(user) });
      setSessions(res.data.sessions || []);
    } catch (e) { console.error('Load sessions:', e); }
  };

  const loadSession = async (id) => {
    try {
      const res = await axios.get(`${API_BASE}/portal/sessions/${id}`, { headers: getAuthHeader(user) });
      setActiveSession(res.data.session);
      setStageLogs(res.data.logs || []);
      setView('session');
      setStageResult(null);
      setLogFile(null);
      setLogFileName('');
      // Load latest table revision
      try {
        const tRes = await axios.get(`${API_BASE}/portal/sessions/${id}/tables`, { headers: getAuthHeader(user) });
        setTableRevision(tRes.data.tables || null);
      } catch {}
    } catch (e) { setError(e.message); }
  };

  // ── Vehicle CRUD ──────────────────────────────────────────
  const saveVehicle = async () => {
    const required = ['year','model','engine','fuel','power_adder'];
    const missing  = required.filter(k => !vehicleForm[k]);
    if (missing.length) { setError(`Please fill in: ${missing.join(', ')}`); return; }
    try {
      await axios.post(`${API_BASE}/portal/vehicles`,
        { ...vehicleForm, user_email: user?.email },
        { headers: getAuthHeader(user) }
      );
      await loadVehicles();
      setView('garage');
      setVehicleForm({ nickname:'', vin:'', year:'', make:'Dodge', model:'', engine:'', fuel:'', power_adder:'', transmission:'', rear_gear:'', tire_height:'', injectors:'', map_sensor:'', throttle_body:'', cam:'', calid:'', trans_calid:'', trans_model:'', notes:'' });
      showToast('Vehicle saved!');
    } catch (e) { setError(e.message); }
  };

  const deleteVehicle = async (id) => {
    if (!window.confirm('Delete this vehicle? All associated sessions will also be deleted.')) return;
    try {
      await axios.delete(`${API_BASE}/portal/vehicles/${id}`, { headers: getAuthHeader(user) });
      if (selectedVehicle?.id === id) setSelectedVehicle(null);
      await loadVehicles();
      showToast('Vehicle deleted.');
    } catch (e) { setError(e.message); }
  };

  // ── Session management ────────────────────────────────────
  const startSession = async () => {
    if (!selectedVehicle) { setError('Select a vehicle first.'); return; }
    try {
      const res = await axios.post(`${API_BASE}/portal/sessions`,
        { vehicle_id: selectedVehicle.id },
        { headers: getAuthHeader(user) }
      );
      await loadSessions();
      await loadSession(res.data.session.id);
    } catch (e) { setError(e.message); }
  };

  // ── Stage log submission ──────────────────────────────────
  const submitTables = async () => {
    if (!injectorTable && !veTable && !sparkTable) {
      setError('Please paste at least one table.'); return;
    }
    setSubmittingTables(true); setError('');
    try {
      const res = await axios.post(
        `${API_BASE}/portal/sessions/${activeSession.id}/submit-tables`,
        { injector_table: injectorTable, ve_table: veTable, spark_table: sparkTable },
        { headers: { ...getAuthHeader(user), 'Content-Type': 'application/json' } }
      );
      setTableRevision(res.data.revision);
      setShowTableSubmit(false);
      showToast('Revision 1 generated! Download your adjusted tables below.', 'ok');
    } catch(e) { setError(e?.response?.data?.error || e.message); }
    finally { setSubmittingTables(false); }
  };

  const downloadTable = (text, filename) => {
    if (!text) return;
    const blob = new Blob([text], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const submitStageLog = async () => {
    if (!logFile) { setError('Please upload your log file first.'); return; }
    setSubmitting(true);
    setError('');
    setStageResult(null);
    try {
      const fd = new FormData();
      fd.append('log', logFile);
      fd.append('stage', String(activeSession.current_stage));
      const res = await axios.post(
        `${API_BASE}/portal/sessions/${activeSession.id}/submit-stage`,
        fd,
        { headers: getAuthHeader(user) }
      );
      setStageResult(res.data);
      if (res.data.table_revision) setTableRevision(res.data.table_revision);
      setLogFile(null);
      setLogFileName('');
      // Reload session to get updated stage
      await loadSession(activeSession.id);
    } catch (e) {
      setError(e?.response?.data?.error || e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render helpers ────────────────────────────────────────
  const currentStageInfo = activeSession ? STAGE_INFO[activeSession.current_stage] : null;
  const lastPassedLog = stageLogs.filter(l => l.passed).slice(-1)[0];
  const currentStageLogs = stageLogs.filter(l => l.stage === activeSession?.current_stage);

  // ══════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════
  return (
    <div style={css.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&family=Inter:wght@300;400;500&display=swap');
        * { box-sizing: border-box; }
        select option { background: #111811; }
        input[type=file] { display: none; }
        @keyframes fadeInUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        .fade-in { animation: fadeInUp 0.4s ease both; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-thumb { background: #274027; border-radius: 3px; }
      `}</style>

      {/* ── HEADER ── */}
      <header style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0 32px', height:68, background:'rgba(9,12,9,0.95)', borderBottom:`1px solid ${T.borderHi}`, position:'sticky', top:0, zIndex:100, backdropFilter:'blur(12px)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, fontFamily:"'Rajdhani',sans-serif", fontSize:22, fontWeight:700, letterSpacing:1.5, textTransform:'uppercase', color:T.green }}>
          <div style={{ width:34, height:34, border:`1.5px solid ${T.green}`, borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <svg width="18" height="18" viewBox="0 0 22 22" fill="none">
              <circle cx="11" cy="11" r="10" stroke="#3dff7a" strokeWidth="1.5"/>
              <path d="M7 9l3 3 5-5" stroke="#3dff7a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          Satera Tuning
          <span style={{ fontFamily:"'Inter',sans-serif", fontSize:11, fontWeight:400, color:T.muted, textTransform:'none', letterSpacing:0 }}>Tune Portal</span>
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <Link to="/ai-review" style={{ ...css.btnGhost, textDecoration:'none', display:'inline-block' }}>AI Review</Link>
          <Link to="/log-comparison" style={{ ...css.btnGhost, textDecoration:'none', display:'inline-block' }}>Log Comparison</Link>
          {user && (
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ fontSize:12, color:T.muted }}>{user.displayName || user.email}</span>
              <button onClick={handleSignOut} style={{ ...css.btnGhost, fontSize:11 }}>Sign Out</button>
            </div>
          )}
        </div>
      </header>

      <div style={{ padding:'28px 32px', maxWidth:1200, margin:'0 auto' }}>

        {/* ── Toast ── */}
        {toast && (
          <div className="fade-in" style={{ padding:'12px 18px', borderRadius:8, marginBottom:20, fontSize:13, background: toast.type==='err' ? 'rgba(255,82,82,0.08)' : 'rgba(61,255,122,0.06)', border:`1px solid ${toast.type==='err' ? 'rgba(255,82,82,0.25)' : 'rgba(61,255,122,0.2)'}`, color: toast.type==='err' ? T.red : T.green }}>
            {toast.msg}
          </div>
        )}

        {/* ═══════════════════════════════════════
            NOT LOGGED IN
        ═══════════════════════════════════════ */}
        {authLoading && (
          <div style={{ textAlign:'center', padding:'80px 0', color:T.muted }}>Loading…</div>
        )}

        {!authLoading && !user && (
          <div className="fade-in" style={{ maxWidth:500, margin:'80px auto', textAlign:'center' }}>
            <div style={{ fontSize:48, marginBottom:20 }}>🏁</div>
            <h1 style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:32, fontWeight:700, color:T.text, margin:'0 0 12px' }}>
              Satera Tune Portal
            </h1>
            <p style={{ fontSize:14, color:T.muted, lineHeight:1.8, margin:'0 0 32px' }}>
              A step-by-step AI-guided tuning process. Upload your logs at each stage and the AI will evaluate your engine's health before advancing you to the next stage — from idle all the way to full WOT pulls.
            </p>
            <div style={{ ...css.card, marginBottom:24, textAlign:'left' }}>
              <SectionTitle>The 4-Stage Process</SectionTitle>
              {Object.entries(STAGE_INFO).map(([s, info]) => (
                <div key={s} style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 0', borderBottom:`1px solid ${T.border}` }}>
                  <span style={{ fontSize:20 }}>{info.icon}</span>
                  <div>
                    <div style={{ fontSize:13, fontWeight:600, color:T.text }}>Stage {s}: {info.name}</div>
                    <div style={{ fontSize:12, color:T.muted }}>
                      {s==='1' && 'Verify cold start, idle stability, and base fuel trims'}
                      {s==='2' && 'Check part-throttle fueling under load at cruise speeds'}
                      {s==='3' && 'Limited WOT pulls to 4500 RPM to verify low-end fueling'}
                      {s==='4' && 'Full WOT pulls — AI generates spark table recommendations'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={signIn} style={{ ...css.btnPrimary, width:'100%', fontSize:16, padding:'14px 24px' }}>
              Sign In with Google to Get Started
            </button>
          </div>
        )}

        {/* ═══════════════════════════════════════
            GARAGE VIEW
        ═══════════════════════════════════════ */}
        {!authLoading && user && view === 'garage' && (
          <div className="fade-in">
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:24 }}>
              <div>
                <h1 style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:30, fontWeight:700, margin:'0 0 4px' }}>My Garage</h1>
                <p style={{ fontSize:13, color:T.muted, margin:0 }}>Select a vehicle to start or continue a tune session</p>
              </div>
              <button onClick={() => setView('new-vehicle')} style={css.btnPrimary}>
                + Add Vehicle
              </button>
            </div>

            {/* Error */}
            {error && (
              <div style={{ padding:'10px 14px', borderRadius:8, marginBottom:16, background:'rgba(255,82,82,0.08)', border:'1px solid rgba(255,82,82,0.2)', color:T.red, fontSize:13 }}>
                {error} <button onClick={() => setError('')} style={{ background:'none', border:'none', color:T.red, cursor:'pointer', float:'right' }}>✕</button>
              </div>
            )}

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:24 }}>
              {vehicles.length === 0 && (
                <div style={{ ...css.card, gridColumn:'1/-1', textAlign:'center', padding:40, color:T.muted }}>
                  <div style={{ fontSize:32, marginBottom:12 }}>🚗</div>
                  <div style={{ fontSize:14 }}>No vehicles yet — add your first vehicle to get started</div>
                </div>
              )}
              {vehicles.map(v => (
                <VehicleCard
                  key={v.id}
                  vehicle={v}
                  selected={selectedVehicle?.id === v.id}
                  onSelect={setSelectedVehicle}
                  onDelete={deleteVehicle}
                />
              ))}
            </div>

            {/* Start session or resume */}
            {selectedVehicle && (
              <div style={{ ...css.cardHi, marginBottom:24 }} className="fade-in">
                <SectionTitle>Tune Sessions — {selectedVehicle.nickname || `${selectedVehicle.year} ${selectedVehicle.model}`}</SectionTitle>

                {/* Active sessions for this vehicle */}
                {sessions.filter(s => s.vehicle_id === selectedVehicle.id).map(s => (
                  <div key={s.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 0', borderBottom:`1px solid ${T.border}` }}>
                    <div>
                      <div style={{ fontSize:13, fontWeight:600, color:T.text }}>
                        Session started {new Date(s.created_at).toLocaleDateString()}
                      </div>
                      <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>
                        {s.status === 'complete' ? '✅ Complete' : `Stage ${s.current_stage} of 4`}
                        {s.stages_passed?.length > 0 && ` • Stages ${s.stages_passed.join(', ')} passed`}
                      </div>
                    </div>
                    <button onClick={() => loadSession(s.id)} style={{ ...css.btnPrimary, padding:'8px 18px', fontSize:13 }}>
                      {s.status === 'complete' ? 'View Report' : 'Continue →'}
                    </button>
                  </div>
                ))}

                <button onClick={startSession} style={{ ...css.btnPrimary, marginTop:16 }}>
                  ⚡ Start New Tune Session
                </button>
              </div>
            )}

            {/* Recent activity */}
            {sessions.length > 0 && (
              <div style={css.card}>
                <SectionTitle>All Sessions</SectionTitle>
                {sessions.slice(0, 5).map(s => (
                  <div key={s.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 0', borderBottom:`1px solid ${T.border}` }}>
                    <div>
                      <div style={{ fontSize:13, color:T.text }}>
                        {s.vehicles?.nickname || `${s.vehicles?.year} ${s.vehicles?.model}`}
                      </div>
                      <div style={{ fontSize:11, color:T.muted }}>
                        {s.status === 'complete' ? '✅ Complete' : `In progress — Stage ${s.current_stage}`} • {new Date(s.updated_at).toLocaleDateString()}
                      </div>
                    </div>
                    <button onClick={() => loadSession(s.id)} style={css.btnGhost}>
                      Open →
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════
            ADD VEHICLE VIEW
        ═══════════════════════════════════════ */}
        {!authLoading && user && view === 'new-vehicle' && (
          <div className="fade-in">
            <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:24 }}>
              <button onClick={() => setView('garage')} style={css.btnGhost}>← Back</button>
              <h1 style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:28, fontWeight:700, margin:0 }}>Add Vehicle</h1>
            </div>

            {error && (
              <div style={{ padding:'10px 14px', borderRadius:8, marginBottom:16, background:'rgba(255,82,82,0.08)', border:'1px solid rgba(255,82,82,0.2)', color:T.red, fontSize:13 }}>
                {error}
              </div>
            )}

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
              {/* Left col */}
              <div style={{ display:'grid', gap:16 }}>
                <div style={css.card}>
                  <SectionTitle>Vehicle Identity</SectionTitle>
                  <div style={{ display:'grid', gap:10 }}>
                    <div><label style={css.label}>Nickname (optional)</label><input placeholder="e.g. My Hellcat" style={css.input} value={vehicleForm.nickname} onChange={e => setVehicleForm(p => ({...p, nickname:e.target.value}))}/></div>
                    <div><label style={css.label}>VIN (optional)</label><input placeholder="17-digit VIN" style={css.input} value={vehicleForm.vin} onChange={e => setVehicleForm(p => ({...p, vin:e.target.value}))}/></div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                      <div><label style={css.label}>Year *</label><select style={css.select} value={vehicleForm.year} onChange={e => setVehicleForm(p => ({...p, year:e.target.value}))}><option value="">Select…</option>{OPTS.year.map(o=><option key={o}>{o}</option>)}</select></div>
                      <div><label style={css.label}>Model *</label><select style={css.select} value={vehicleForm.model} onChange={e => setVehicleForm(p => ({...p, model:e.target.value}))}><option value="">Select…</option>{OPTS.model.map(o=><option key={o}>{o}</option>)}</select></div>
                    </div>
                    <div><label style={css.label}>Engine *</label><select style={css.select} value={vehicleForm.engine} onChange={e => setVehicleForm(p => ({...p, engine:e.target.value}))}><option value="">Select…</option>{OPTS.engine.map(o=><option key={o}>{o}</option>)}</select></div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                      <div><label style={css.label}>Fuel *</label><select style={css.select} value={vehicleForm.fuel} onChange={e => setVehicleForm(p => ({...p, fuel:e.target.value}))}><option value="">Select…</option>{OPTS.fuel.map(o=><option key={o}>{o}</option>)}</select></div>
                      <div><label style={css.label}>Power Adder *</label><select style={css.select} value={vehicleForm.power_adder} onChange={e => setVehicleForm(p => ({...p, power_adder:e.target.value}))}><option value="">Select…</option>{OPTS.power_adder.map(o=><option key={o}>{o}</option>)}</select></div>
                    </div>
                  </div>
                </div>

                <div style={css.card}>
                  <SectionTitle>Drivetrain</SectionTitle>
                  <div style={{ display:'grid', gap:10 }}>
                    <div><label style={css.label}>Transmission</label><select style={css.select} value={vehicleForm.transmission} onChange={e => setVehicleForm(p => ({...p, transmission:e.target.value}))}><option value="">Select…</option>{OPTS.transmission.map(o=><option key={o}>{o}</option>)}</select></div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                      <div><label style={css.label}>Rear Gear</label><select style={css.select} value={vehicleForm.rear_gear} onChange={e => setVehicleForm(p => ({...p, rear_gear:e.target.value}))}><option value="">Select…</option>{OPTS.rear_gear.map(o=><option key={o}>{o}</option>)}</select></div>
                      <div><label style={css.label}>Tire Height</label><select style={css.select} value={vehicleForm.tire_height} onChange={e => setVehicleForm(p => ({...p, tire_height:e.target.value}))}><option value="">Select…</option>{OPTS.tire_height.map(o=><option key={o}>{o}</option>)}</select></div>
                    </div>
                  </div>
                </div>
                <div style={css.card}>
                  <SectionTitle>VCM Editor Auto-Fill</SectionTitle>
                  <label style={css.label}>Paste your HP Tuners VCM info block to auto-fill fields</label>
                  <textarea
                    rows={5}
                    placeholder={"VIN: 2C3CDXGJ4MH592923\n2021 Dodge Charger Scat Pack, 6.4 L, V8\nOS: 68501393AD\nHardware: ZF8HP, Dodge\nOS: 68501434AC"}
                    style={{ ...css.input, resize:'vertical', lineHeight:1.5, fontFamily:'monospace', fontSize:12 }}
                    onBlur={e => {
                      const text = e.target.value;
                      if (!text.trim()) return;
                      // VIN
                      const vinMatch = text.match(/VIN:\s*([A-Z0-9]{17})/i);
                      // Year, Make, Model
                      const modelLine = text.split('\n').find(l => /\d{4}\s+Dodge/i.test(l));
                      const yearMatch = modelLine?.match(/(20\d{2})/);
                      const modelMatch = modelLine?.match(/Charger|Challenger|Durango|Ram|300/i);
                      const engineMatch = modelLine?.match(/6\.4|6\.2|5\.7|6\.1/);
                      // OS Cal IDs
                      const osMatches = [...text.matchAll(/OS:\s*(\w+)/gi)];
                      // Trans model
                      const transMatch = text.match(/Hardware:\s*(ZF\w+|NAG\w+)/i);
                      setVehicleForm(p => ({
                        ...p,
                        vin:         vinMatch?.[1]          || p.vin,
                        year:        yearMatch?.[1]          || p.year,
                        model:       modelMatch?.[0]         ? (modelMatch[0].charAt(0).toUpperCase() + modelMatch[0].slice(1).toLowerCase()) : p.model,
                        engine:      engineMatch?.[0] === '6.4' ? '6.4L (392)' : engineMatch?.[0] === '6.2' ? '6.2L Hellcat' : engineMatch?.[0] === '5.7' ? '5.7L Eagle' : p.engine,
                        calid:       osMatches?.[0]?.[1]     || p.calid,
                        trans_calid: osMatches?.[1]?.[1]     || p.trans_calid,
                        trans_model: transMatch?.[1]         || p.trans_model,
                      }));
                      e.target.value = '';
                    }}
                  />
                  <p style={{ fontSize:11, color:T.faint, margin:'6px 0 0' }}>
                    Paste the info block from HP Tuners VCM Editor — VIN, year, model, engine and Cal IDs will be auto-filled. Clear the box after pasting.
                  </p>
                </div>
              </div>

              {/* Right col */}
              <div style={{ display:'grid', gap:16 }}>
                <div style={css.card}>
                  <SectionTitle>Modifications</SectionTitle>
                  <div style={{ display:'grid', gap:10 }}>
                    <div><label style={css.label}>Injectors</label><select style={css.select} value={vehicleForm.injectors} onChange={e => setVehicleForm(p => ({...p, injectors:e.target.value}))}><option value="">Select…</option>{OPTS.injectors.map(o=><option key={o}>{o}</option>)}</select></div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                      <div><label style={css.label}>MAP Sensor</label><select style={css.select} value={vehicleForm.map_sensor} onChange={e => setVehicleForm(p => ({...p, map_sensor:e.target.value}))}><option value="">Select…</option>{OPTS.map_sensor.map(o=><option key={o}>{o}</option>)}</select></div>
                      <div><label style={css.label}>Throttle Body</label><select style={css.select} value={vehicleForm.throttle_body} onChange={e => setVehicleForm(p => ({...p, throttle_body:e.target.value}))}><option value="">Select…</option>{OPTS.throttle_body.map(o=><option key={o}>{o}</option>)}</select></div>
                    </div>
                    <div><label style={css.label}>Aftermarket Cam</label><select style={css.select} value={vehicleForm.cam} onChange={e => setVehicleForm(p => ({...p, cam:e.target.value}))}><option value="">Select…</option>{OPTS.cam.map(o=><option key={o}>{o}</option>)}</select></div>
                  </div>
                </div>

                <div style={css.card}>
                  <SectionTitle>Calibration IDs (optional)</SectionTitle>
                  <div style={{ display:'grid', gap:10 }}>
                    <div><label style={css.label}>Engine Cal ID</label><input placeholder="ECM OS Cal ID" style={css.input} value={vehicleForm.calid} onChange={e => setVehicleForm(p => ({...p, calid:e.target.value}))}/></div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                      <div><label style={css.label}>Trans Cal ID</label><input placeholder="TCM Cal ID" style={css.input} value={vehicleForm.trans_calid} onChange={e => setVehicleForm(p => ({...p, trans_calid:e.target.value}))}/></div>
                      <div><label style={css.label}>Trans Model</label><input placeholder="e.g. ZF8HP70" style={css.input} value={vehicleForm.trans_model} onChange={e => setVehicleForm(p => ({...p, trans_model:e.target.value}))}/></div>
                    </div>
                  </div>
                </div>

                <div style={css.card}>
                  <SectionTitle>Notes (optional)</SectionTitle>
                  <textarea placeholder="Any other mods, history, or notes about this vehicle…" rows={4} style={{ ...css.input, resize:'vertical', lineHeight:1.6 }} value={vehicleForm.notes} onChange={e => setVehicleForm(p => ({...p, notes:e.target.value}))}/>
                </div>

                <div style={{ display:'flex', gap:10 }}>
                  <button onClick={saveVehicle} style={{ ...css.btnPrimary, flex:1 }}>💾 Save Vehicle</button>
                  <button onClick={() => setView('garage')} style={css.btnGhost}>Cancel</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════
            SESSION VIEW
        ═══════════════════════════════════════ */}
        {!authLoading && user && view === 'session' && activeSession && (
          <div className="fade-in">
            {/* Back + title */}
            <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:24 }}>
              <button onClick={() => { setView('garage'); setActiveSession(null); }} style={css.btnGhost}>← Garage</button>
              <div>
                <h1 style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:26, fontWeight:700, margin:'0 0 2px' }}>
                  {activeSession.vehicles?.nickname || `${activeSession.vehicles?.year} ${activeSession.vehicles?.model}`}
                </h1>
                <p style={{ fontSize:12, color:T.muted, margin:0 }}>
                  {activeSession.vehicles?.engine} • {activeSession.vehicles?.fuel} • {activeSession.vehicles?.power_adder}
                </p>
              </div>
            </div>

            {/* ── TABLE REVISION PANEL ── */}
            {!tableRevision && !showTableSubmit && (
              <div className="fade-in" style={{ ...css.cardHi, marginBottom:16, border:'1px solid rgba(245,166,35,0.3)', background:'rgba(245,166,35,0.04)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
                  <span style={{ fontSize:24 }}>📋</span>
                  <div>
                    <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:16, fontWeight:700, color:T.amber }}>Submit Your Current Tune Tables</div>
                    <div style={{ fontSize:12, color:T.muted, marginTop:2 }}>Required before logging. Paste your Injector, VE, and WOT Spark tables so the AI can generate your first revision.</div>
                  </div>
                </div>
                <button onClick={() => setShowTableSubmit(true)} style={{ ...css.btnPrimary, background:T.amber }}>
                  📋 Submit Tune Tables
                </button>
              </div>
            )}

            {/* Table submission form */}
            {showTableSubmit && (
              <div className="fade-in" style={{ ...css.cardHi, marginBottom:16 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                  <p style={{ ...css.title, margin:0 }}>Submit Tune Tables</p>
                  <button onClick={() => setShowTableSubmit(false)} style={css.btnGhost}>Cancel</button>
                </div>
                <p style={{ fontSize:13, color:T.muted, margin:'0 0 16px', lineHeight:1.7 }}>
                  In HP Tuners VCM Editor, right-click each table → <strong style={{ color:T.text }}>"Copy with Axis"</strong> → paste below.
                  You only need to do this once — the AI will track changes from here.
                </p>
                {[
                  { label:'Injector Flow Data Table', key:'injector', value:injectorTable, setter:setInjectorTable, hint:'Engine → Fuel → Injector Flow Data → Copy with Axis' },
                  { label:'VE Table (Volumetric Efficiency)', key:'ve', value:veTable, setter:setVeTable, hint:'Engine → Fuel → VE Table → Copy with Axis' },
                  { label:'WOT Spark Table', key:'spark', value:sparkTable, setter:setSparkTable, hint:'Engine → Spark → WOT Spark Table → Copy with Axis' },
                ].map(({ label, key, value, setter, hint }) => (
                  <div key={key} style={{ marginBottom:14 }}>
                    <label style={{ ...css.label, fontSize:12, fontWeight:600, color:T.green }}>{label}</label>
                    <div style={{ fontSize:11, color:T.faint, marginBottom:5 }}>{hint}</div>
                    <textarea
                      value={value}
                      onChange={e => setter(e.target.value)}
                      placeholder={`Paste your ${label} here…`}
                      rows={5}
                      style={{ ...css.input, fontFamily:'monospace', fontSize:11, lineHeight:1.5, resize:'vertical' }}
                      spellCheck={false}
                    />
                  </div>
                ))}
                {error && <div style={{ padding:'10px 14px', borderRadius:7, marginBottom:12, background:'rgba(255,82,82,0.08)', border:'1px solid rgba(255,82,82,0.2)', color:T.red, fontSize:13 }}>{error}</div>}
                <button onClick={submitTables} disabled={submittingTables || (!injectorTable && !veTable && !sparkTable)}
                  style={{ ...css.btnPrimary, width:'100%', opacity: submittingTables ? 0.5 : 1 }}>
                  {submittingTables ? <span style={{ animation:'pulse 1.5s infinite' }}>⏳ Generating Revision 1…</span> : '⚡ Generate Revision 1'}
                </button>
              </div>
            )}

            {/* Table revision download panel */}
            {tableRevision && (
              <div className="fade-in" style={{ ...css.card, marginBottom:16, border:'1px solid rgba(61,255,122,0.2)', background:'rgba(61,255,122,0.03)' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <span style={{ fontSize:20 }}>📥</span>
                    <div>
                      <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:15, fontWeight:700, color:T.green }}>
                        Revision {tableRevision.revision} Ready
                      </div>
                      <div style={{ fontSize:11, color:T.muted }}>Flash these tables, then upload a log for AI review</div>
                    </div>
                  </div>
                </div>
                {tableRevision.revision_notes && (
                  <p style={{ fontSize:13, color:T.text, lineHeight:1.75, margin:'0 0 14px', padding:'10px 14px', background:'rgba(0,0,0,0.2)', borderRadius:7 }}>
                    {tableRevision.revision_notes}
                  </p>
                )}
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  {tableRevision.injector_adjusted && (
                    <button onClick={() => downloadTable(tableRevision.injector_adjusted, `injector_rev${tableRevision.revision}.txt`)}
                      style={{ ...css.btnPrimary, fontSize:12, padding:'8px 16px' }}>
                      ⬇ Injector Table
                    </button>
                  )}
                  {tableRevision.ve_adjusted && (
                    <button onClick={() => downloadTable(tableRevision.ve_adjusted, `ve_rev${tableRevision.revision}.txt`)}
                      style={{ ...css.btnPrimary, fontSize:12, padding:'8px 16px' }}>
                      ⬇ VE Table
                    </button>
                  )}
                  {tableRevision.spark_adjusted && (
                    <button onClick={() => downloadTable(tableRevision.spark_adjusted, `spark_rev${tableRevision.revision}.txt`)}
                      style={{ ...css.btnPrimary, fontSize:12, padding:'8px 16px' }}>
                      ⬇ WOT Spark Table
                    </button>
                  )}
                  <button onClick={() => setShowTableSubmit(true)} style={css.btnGhost}>
                    Re-paste Tables
                  </button>
                </div>
              </div>
            )}

            {/* Stage tracker */}
            <div style={css.cardHi}>
              <StageTracker
                currentStage={activeSession.current_stage}
                stagesPassed={activeSession.stages_passed || []}
                sessionComplete={activeSession.status === 'complete'}
              />

              {/* Complete state */}
              {activeSession.status === 'complete' && (
                <div style={{ textAlign:'center', padding:'20px 0' }}>
                  <div style={{ fontSize:40, marginBottom:12 }}>🏆</div>
                  <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:24, fontWeight:700, color:T.green, marginBottom:8 }}>
                    All Stages Complete!
                  </div>
                  <p style={{ fontSize:14, color:T.muted }}>
                    Your vehicle has passed all 4 stages. Review your stage logs below for the full assessment and spark table recommendations.
                  </p>
                </div>
              )}

              {/* Current stage instructions */}
              {activeSession.status === 'active' && currentStageInfo && (
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
                    <span style={{ fontSize:24 }}>{currentStageInfo.icon}</span>
                    <div>
                      <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:16, fontWeight:700, color:T.text }}>
                        Stage {activeSession.current_stage}: {currentStageInfo.name}
                      </div>
                      <div style={{ fontSize:11, color:T.muted }}>
                        {currentStageLogs.length > 0 ? `Attempt ${currentStageLogs.length + 1}` : 'First attempt'}
                      </div>
                    </div>
                  </div>

                  {/* Instructions box */}
                  <div style={{ background:'rgba(61,255,122,0.04)', border:`1px solid ${T.border}`, borderRadius:8, padding:'14px 16px', marginBottom:14 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:T.green, marginBottom:8, letterSpacing:0.5 }}>📋 INSTRUCTIONS</div>
                    <p style={{ fontSize:13, color:T.text, lineHeight:1.75, margin:'0 0 12px' }}>
                      {activeSession.current_stage === 1 && 'Start the vehicle from a fully cold start and let it warm up to operating temperature completely. Log for at least 5-8 minutes at idle without revving or driving.'}
                      {activeSession.current_stage === 2 && 'Drive at varying speeds between 25-55 mph keeping throttle below 50% at all times. Include steady cruise, light acceleration, and deceleration. Log for 10-15 minutes.'}
                      {activeSession.current_stage === 3 && 'Make 2-3 wide open throttle pulls but STOP at 4500 RPM — do not rev past 4500 RPM. Let the car cool at least 5 minutes between each pull.'}
                      {activeSession.current_stage === 4 && 'Make 2-3 full wide open throttle pulls through the complete RPM range. Let the car fully cool between each pull. This is the final stage.'}
                    </p>
                    <div style={{ fontSize:11, color:T.muted, fontWeight:600, marginBottom:6, letterSpacing:0.5 }}>💡 TIPS</div>
                    <ul style={{ margin:0, paddingLeft:18, fontSize:12, color:T.muted, lineHeight:1.8 }}>
                      {activeSession.current_stage === 1 && <>
                        <li>Start from completely cold (engine off 4+ hours)</li>
                        <li>Do not touch the throttle during this log</li>
                        <li>Log until coolant temp stabilizes (180-200°F)</li>
                      </>}
                      {activeSession.current_stage === 2 && <>
                        <li>Keep throttle below 50% at all times</li>
                        <li>Vary your speed — include light on/off throttle transitions</li>
                        <li>Avoid hard stops and aggressive driving</li>
                      </>}
                      {activeSession.current_stage === 3 && <>
                        <li>Full throttle only — no partial throttle pulls</li>
                        <li>STOP at 4500 RPM — lift off completely</li>
                        <li>Use fresh 93 octane or E85 if calibrated for it</li>
                      </>}
                      {activeSession.current_stage === 4 && <>
                        <li>Full throttle all the way through the rev range</li>
                        <li>5-10 minutes cool-down between pulls</li>
                        <li>Safe straight road or closed course only</li>
                      </>}
                    </ul>
                  </div>

                  {/* Log upload */}
                  <div style={{ marginBottom:12 }}>
                    <label style={{ ...css.label, fontSize:12 }}>HP Tuners CSV Log File</label>
                    <label htmlFor="stageLog" style={{
                      display:'flex', alignItems:'center', gap:10, padding:'13px 16px',
                      borderRadius:8, border: logFile ? `1.5px solid ${T.green}33` : `1.5px dashed ${T.borderHi}`,
                      background: logFile ? 'rgba(61,255,122,0.04)' : 'transparent',
                      cursor:'pointer', fontSize:13, color: logFile ? T.text : T.muted, transition:'all 0.2s',
                    }}>
                      <span style={{ fontSize:16 }}>📂</span>
                      <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {logFileName || 'Choose HP Tuners CSV…'}
                      </span>
                      {logFile && <span style={{ color:T.green, fontWeight:700 }}>✓</span>}
                    </label>
                    <input id="stageLog" type="file" accept=".csv" onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) { setLogFile(f); setLogFileName(f.name); }
                    }}/>
                  </div>

                  {error && (
                    <div style={{ padding:'10px 14px', borderRadius:7, marginBottom:12, background:'rgba(255,82,82,0.08)', border:'1px solid rgba(255,82,82,0.2)', color:T.red, fontSize:13 }}>
                      {error}
                    </div>
                  )}

                  <button
                    onClick={submitStageLog}
                    disabled={submitting || !logFile}
                    style={{ ...css.btnPrimary, opacity: (submitting||!logFile) ? 0.4 : 1, width:'100%' }}
                  >
                    {submitting ? <span style={{ animation:'pulse 1.5s infinite' }}>⏳ Analyzing Log…</span> : '⚡ Submit Log for AI Review'}
                  </button>
                </div>
              )}
            </div>

            {/* Stage result */}
            {stageResult && (
              <div className="fade-in" style={{ ...css.cardHi, marginTop:16, border:`1px solid ${stageResult.passed ? 'rgba(61,255,122,0.3)' : 'rgba(255,82,82,0.3)'}` }}>
                <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
                  <span style={{ fontSize:32 }}>{stageResult.passed ? '✅' : '❌'}</span>
                  <div>
                    <div style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:18, fontWeight:700, color: stageResult.passed ? T.green : T.red }}>
                      Stage {stageResult.passed ? 'Passed' : 'Failed'}
                    </div>
                    <div style={{ fontSize:12, color:T.muted }}>
                      {stageResult.passed ? (stageResult.session_complete ? 'All stages complete!' : `Advancing to Stage ${stageResult.next_stage}…`) : 'Address the issues below and resubmit'}
                    </div>
                  </div>
                </div>
                <p style={{ fontSize:14, lineHeight:1.8, color:T.text, margin:'0 0 16px' }}>{stageResult.summary}</p>
                {stageResult.recommendations?.length > 0 && (
                  <div>
                    <div style={{ fontSize:12, fontWeight:600, color:T.muted, marginBottom:8, letterSpacing:0.5 }}>
                      {stageResult.passed ? '✅ KEY NOTES' : '🔧 FIX THESE BEFORE RESUBMITTING'}
                    </div>
                    <ul style={{ margin:0, paddingLeft:18, fontSize:13, color:T.text, lineHeight:1.9 }}>
                      {stageResult.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Previous stage logs */}
            {stageLogs.length > 0 && (
              <div style={{ ...css.card, marginTop:16 }}>
                <SectionTitle>Stage History</SectionTitle>
                {[1,2,3,4].map(s => {
                  const logs = stageLogs.filter(l => l.stage === s);
                  if (!logs.length) return null;
                  const info = STAGE_INFO[s];
                  const latestPass = logs.find(l => l.passed);
                  return (
                    <div key={s} style={{ marginBottom:16, paddingBottom:16, borderBottom:`1px solid ${T.border}` }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                        <span>{info.icon}</span>
                        <span style={{ fontFamily:"'Rajdhani',sans-serif", fontSize:13, fontWeight:700, color: latestPass ? T.green : T.muted, letterSpacing:1 }}>
                          Stage {s}: {info.name} {latestPass ? '✓ PASSED' : `(${logs.length} attempt${logs.length>1?'s':''})`}
                        </span>
                      </div>
                      {logs.slice(-1).map(l => (
                        <div key={l.id} style={{ fontSize:13, color:T.muted, lineHeight:1.7 }}>
                          {l.ai_summary}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
