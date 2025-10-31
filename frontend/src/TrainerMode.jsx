import React, { useState, useMemo } from 'react';
import axios from 'axios';

// Use same-origin API by default; allow override via REACT_APP_API_BASE
const API_BASE = process.env.REACT_APP_API_BASE || '/api';

// Global system instruction for training examples (optional)
const TRAINING_SYSTEM_MSG =
  'Answer only with corrected spark table or concise tuning result. No explanations, no prose.';

const TrainerMode = () => {
  const [form, setForm] = useState({
    vin: '', calid: '', transCalid: '', transModel: '',
    year: '', model: '', engine: '', injectors: '', map: '',
    throttle: '', power: '', trans: '', tire: '', gear: '',
    fuel: '', cam: '', neural: ''
  });

  const [beforeLog, setBeforeLog] = useState(null);
  const [afterLog, setAfterLog] = useState(null);

  const [status, setStatus] = useState('');
  const [aiSummary, setAiSummary] = useState('');
  const [conversationId, setConversationId] = useState(null);
  const [comparison, setComparison] = useState(null);

  const [customFields, setCustomFields] = useState({});
  const [notes, setNotes] = useState('');

  // backend may return { id, ... } or just an id elsewhere
  const [trainingEntry, setTrainingEntry] = useState(null);
  const [trainerEntryId, setTrainerEntryId] = useState(null); // resilient id we use everywhere

  const [chat, setChat] = useState([
    { role: 'assistant', content: 'Upload BEFORE and AFTER logs (CSV), click Upload/Analyze, then chat about the results.' }
  ]);
  const [message, setMessage] = useState('');

  // UI for trainer buttons
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [examplesTotal, setExamplesTotal] = useState(null);

  // ---------- formatting helpers for metrics ----------
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const fmtDeg = (v) => isNum(v) ? `${Number(v).toFixed(1)}°` : '—';
  const fmtSec = (v) => isNum(v) ? `${Number(v).toFixed(2)} s` : '—';
  const fmtKpa = (v) => isNum(v) ? `${Number(v).toFixed(0)} kPa` : '—';
  const fmtPlain = (v) => (isNum(v) ? String(v) : (v ?? '—'));
  const withSign = (v, digits = 2, unit = '') => {
    if (!isNum(v)) return '—';
    const s = (v > 0 ? `+${v.toFixed(digits)}` : v.toFixed(digits));
    return unit ? `${s} ${unit}` : s;
  };
  const deltaColor = (key, val) => {
    if (!isNum(val)) return '';
    const lowerIsBetter = [
      't_0_60_change','t_40_100_change','t_60_130_change',
      'KR_max_change','KR_event_change','varSTFT_change','varLTFT_change',
      'mapMinWOT_change','mapMaxWOT_change',
    ];
    const higherIsBetter = ['sparkMaxWOT_change'];
    const good = lowerIsBetter.includes(key) ? (val < 0)
               : higherIsBetter.includes(key) ? (val > 0)
               : null;
    return good == null ? '' : (good ? '#39e58c' : '#ff6b6b');
  };

  const dropdownOptions = {
    year: Array.from({ length: 21 }, (_, i) => `${2005 + i}`),
    model: ['Charger', 'Challenger', '300', 'Durango', 'Ram'],
    engine: ['5.7L Pre-Eagle', '5.7L Eagle', '6.1L', '6.4L (392)', '6.2L HC', '6.2L HC HO'],
    injectors: ['Stock', 'ID1050x', 'ID1300x'],
    map: ['1 Bar OEM', '2 Bar', '3 Bar'],
    throttle: ['Stock', '87mm', '95mm', '105mm'],
    power: ['N/A', 'Centrifugal', 'PD Blower', 'Turbo', 'Nitrous'],
    trans: ['Manual', '5-Speed Auto', '8-Speed Auto'],
    tire: ['26','27','28','29','30','31','32','33'],
    gear: ['3.06','3.09','3.23','3.55','3.73','3.90','4.10'],
    fuel: ['91', '93', 'E85'],
    cam: ['Yes', 'No'],
    neural: ['Enabled', 'Disabled']
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleCustomChange = (name, value) => {
    setCustomFields(prev => ({ ...prev, [name]: value }));
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleVCMPaste = (e) => {
    const text = e.target.value;
    const vinMatch = text.match(/VIN:\s*(\w{17})/);
    const modelLine = text.split('\n').find(line => /\d{4}\s+Dodge/i.test(line));
    const osMatches = text.match(/OS:\s*(\w+)/g);
    const transModelMatch = text.match(/Hardware:\s*(ZF\w+)/i);

    const extracted = {
      vin: vinMatch?.[1] || '',
      year: modelLine?.match(/(20\d{2})/)?.[1] || '',
      model: modelLine?.includes('Charger') ? 'Charger' : modelLine?.includes('Challenger') ? 'Challenger' : '',
      engine: modelLine?.includes('6.4') ? '6.4L (392)' : '',
      calid: osMatches?.[0]?.split(':')[1]?.trim() || '',
      transCalid: osMatches?.[1]?.split(':')[1]?.trim() || '',
      transModel: transModelMatch?.[1] || ''
    };

    setForm(prev => ({ ...prev, ...extracted }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('⏳ Uploading & analyzing…');

    if (!beforeLog || !afterLog) {
      setStatus('❌ Please upload BOTH before and after CSV logs.');
      return;
    }

    try {
      const meta = { ...form };
      const fd = new FormData();
      fd.append('beforeLog', beforeLog);
      fd.append('afterLog', afterLog);
      fd.append('meta', JSON.stringify(meta));
      fd.append('feedback', notes || '');

      const res = await axios.post(`${API_BASE}/trainer-ai`, fd);
      const data = res.data || {};

      setAiSummary(data.aiSummary || '');
      setComparison(data.comparison || null);
      setConversationId(data.conversationId || null);

      // Capture id regardless of key name
      const idFromResponse =
        data?.trainingEntry?.id ||
        data?.trainer_entry_id ||
        data?.entryId ||
        data?.entry?.id ||
        null;

      setTrainerEntryId(idFromResponse);
      setTrainingEntry(data.trainingEntry || (idFromResponse ? { id: idFromResponse } : null));

      setChat([{ role: 'assistant', content: data.aiSummary || 'Analysis complete.' }]);
      setStatus(idFromResponse ? `✅ Done. Entry: ${idFromResponse}` : '✅ Done.');
    } catch (err) {
      console.error('❌ Upload error:', err);
      setStatus('❌ Upload failed.');
    }
  };

  const sendChat = async () => {
    if (!conversationId) {
      alert('No conversation yet. Please upload/analyze logs first.');
      return;
    }
    if (!message.trim()) return;

    const userMsg = { role: 'user', content: message.trim() };
    setChat(prev => [...prev, userMsg]);
    setMessage('');

    try {
      const res = await axios.post(`${API_BASE}/trainer-chat`, {
        conversationId,
        message: userMsg.content
      });
      setChat(prev => [...prev, { role: 'assistant', content: res.data.reply || 'No response.' }]);
    } catch (err) {
      console.error('❌ Chat error:', err);
      setChat(prev => [...prev, { role: 'assistant', content: `Chat failed: ${err.message}` }]);
    }
  };

  // === Trainer Flow Helpers ===

  // Build {system?, user, assistant} pairs from the chat timeline.
  // Pair each 'user' with the next 'assistant'. Leading assistant-only messages are ignored.
  const chatPairs = useMemo(() => {
    const pairs = [];
    for (let i = 0; i < chat.length; i++) {
      if (chat[i].role === 'user') {
        const user = chat[i].content || '';
        let assistant = '';
        for (let j = i + 1; j < chat.length; j++) {
          if (chat[j].role === 'assistant') {
            assistant = chat[j].content || '';
            break;
          }
        }
        if (user && assistant) {
          pairs.push({
            system: TRAINING_SYSTEM_MSG,
            user,
            assistant,
            notes: ''
          });
        }
      }
    }
    return pairs;
  }, [chat]);

  const saveChatAsTraining = async () => {
    try {
      setBusy(true);
      setToast('');

      const id = trainerEntryId || trainingEntry?.id || null;
      if (!id) {
        setToast('No trainer_entry_id. Upload logs first to create an entry.');
        return;
      }
      if (!chatPairs.length) {
        setToast('No (user→assistant) pairs found. Send a message and get a reply first.');
        return;
      }

      const res = await axios.post(`${API_BASE}/trainer/save-chat`, {
        trainer_entry_id: id,
        chatPairs,
        notes
      });

      const j = res.data || {};
      if (!j.ok) throw new Error(j.error || 'Save chat failed');
      setToast(`Saved ${j.added} example(s) to entry ${j.trainer_entry_id}. Total in entry: ${j.total_examples_for_entry}`);
    } catch (e) {
      setToast(`❌ ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const finalizeAppendJsonl = async () => {
    try {
      setBusy(true);
      setToast('');

      const id = trainerEntryId || trainingEntry?.id || null;
      if (!id) {
        setToast('No trainer_entry_id. Upload logs first to create an entry.');
        return;
      }

      const res = await axios.post(`${API_BASE}/trainer/finalize`, {
        trainer_entry_id: id,
        appendToJsonl: true
      });
      const j = res.data || {};
      if (!j.ok) throw new Error(j.error || 'Finalize failed');
      setExamplesTotal(j.totalExamplesInFile ?? null);
      setToast(
        `Appended ${j.appended} example(s) → ${j.jsonlPath}. ` +
        `Total in file: ${j.totalExamplesInFile}` +
        `${(j.totalExamplesInFile ?? 0) < 10 ? ' (need ≥ 10 for fine-tune)' : ' ✅'}`
      );
    } catch (e) {
      setToast(`❌ ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const renderInput = (label, name) => (
    <div style={{ marginBottom: '12px' }}>
      <label>{label}</label>
      <input
        name={name}
        value={form[name]}
        onChange={handleChange}
        style={{ width: '100%', padding: '8px', borderRadius: '4px', background: '#333', color: '#fff' }}
      />
    </div>
  );

  const renderDropdown = (label, name, options) => (
    <div style={{ marginBottom: '12px' }}>
      <label>{label}</label>
      <select
        name={name}
        value={form[name]}
        onChange={handleChange}
        style={{ width: '100%', padding: '8px', borderRadius: '4px', background: '#333', color: '#fff' }}
      >
        <option value="">Select...</option>
        {options.concat('Custom').map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
      {form[name] === 'Custom' && (
        <input
          placeholder={`Enter custom ${label.toLowerCase()}`}
          value={customFields[name] || ''}
          onChange={e => handleCustomChange(name, e.target.value)}
          style={{ marginTop: '8px', width: '100%', padding: '8px', borderRadius: '4px', background: '#333', color: '#fff' }}
        />
      )}
    </div>
  );

  const Row = ({ label, value, color }) => (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: 12,
      alignItems: 'baseline',
      padding: '6px 0',
      borderBottom: '1px dashed rgba(255,255,255,0.06)'
    }}>
      <div style={{ opacity: .85 }}>{label}</div>
      <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color }}>{value}</div>
    </div>
  );

  const BeforeAfterCard = ({ title, data }) => {
    const KR = data?.KR || {};
    const T = data?.times || {};
    const W = data?.WOT || {};
    return (
      <div style={{ background:'#202020', padding:12, borderRadius:8, boxShadow:'0 0 0 1px rgba(0,255,136,0.08) inset' }}>
        <h3 style={{ marginTop:0, color:'#adff2f' }}>{title}</h3>
        <Row label="Max KR" value={fmtDeg(KR?.maxKR)} />
        <Row label="KR Events" value={fmtPlain(KR?.krEvents)} />
        <Row label="0–60" value={fmtSec(T?.zeroToSixty)} />
        <Row label="40–100" value={fmtSec(T?.fortyToHundred)} />
        <Row label="60–130" value={fmtSec(T?.sixtyToOneThirty)} />
        <Row label="Peak Spark @WOT" value={fmtDeg(W?.sparkMaxWOT)} />
        <Row label="MAP min @WOT" value={fmtKpa(W?.mapMinWOT)} />
        <Row label="MAP max @WOT" value={fmtKpa(W?.mapMaxWOT)} />
        <Row label="STFT Var" value={fmtPlain(data?.varSTFT)} />
        <Row label="LTFT Var" value={fmtPlain(data?.varLTFT)} />
      </div>
    );
  };

  const DeltasCard = ({ deltas }) => {
    const d = deltas || {};
    const paint = (key, label, v, digits, unit) => (
      <Row label={label} value={withSign(v, digits, unit)} color={deltaColor(key, v)} />
    );
    return (
      <div style={{ background:'#202020', padding:12, borderRadius:8, boxShadow:'0 0 0 1px rgba(0,255,136,0.08) inset' }}>
        <h3 style={{ marginTop:0, color:'#adff2f' }}>Deltas</h3>
        {paint('KR_max_change','Δ Max KR', d.KR_max_change, 1, '°')}
        {paint('KR_event_change','Δ KR Events', d.KR_event_change, 0, '')}
        {paint('t_0_60_change','Δ 0–60', d.t_0_60_change, 2, 's')}
        {paint('t_40_100_change','Δ 40–100', d.t_40_100_change, 2, 's')}
        {paint('t_60_130_change','Δ 60–130', d.t_60_130_change, 2, 's')}
        {paint('sparkMaxWOT_change','Δ Peak Spark @WOT', d.sparkMaxWOT_change, 1, '°')}
        {paint('mapMinWOT_change','Δ MAP min @WOT', d.mapMinWOT_change, 0, 'kPa')}
        {paint('mapMaxWOT_change','Δ MAP max @WOT', d.mapMaxWOT_change, 0, 'kPa')}
        {paint('varSTFT_change','Δ STFT Var', d.varSTFT_change, 2, '')}
        {paint('varLTFT_change','Δ LTFT Var', d.varLTFT_change, 2, '')}
      </div>
    );
  };

  return (
    <div style={{ padding: '30px', backgroundColor: '#111', color: '#adff2f', minHeight: '100vh', fontFamily: 'Arial, sans-serif' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '20px' }}>Trainer Mode — Log Only</h1>

      <div style={{ marginBottom: '20px' }}>
        <label>Paste VCM Info</label>
        <textarea
          onBlur={handleVCMPaste}
          placeholder="Paste copied VCM Editor info here"
          rows="4"
          style={{ width: '100%', padding: '10px', borderRadius: '4px', background: '#222', color: '#fff' }}
        />
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {renderInput('VIN', 'vin')}
        {renderInput('Calibration ID', 'calid')}
        {renderInput('Transmission Cal ID', 'transCalid')}
        {renderInput('Transmission Model', 'transModel')}
        {renderDropdown('Year', 'year', dropdownOptions.year)}
        {renderDropdown('Model', 'model', dropdownOptions.model)}
        {renderDropdown('Engine', 'engine', dropdownOptions.engine)}
        {renderDropdown('Injectors', 'injectors', dropdownOptions.injectors)}
        {renderDropdown('MAP Sensor', 'map', dropdownOptions.map)}
        {renderDropdown('Throttle Body', 'throttle', dropdownOptions.throttle)}
        {renderDropdown('Power Adder', 'power', dropdownOptions.power)}
        {renderDropdown('Transmission', 'trans', dropdownOptions.trans)}
        {renderDropdown('Tire Height (inches)', 'tire', dropdownOptions.tire)}
        {renderDropdown('Rear Gear Ratio', 'gear', dropdownOptions.gear)}
        {renderDropdown('Fuel Type', 'fuel', dropdownOptions.fuel)}
        {renderDropdown('Aftermarket Camshaft Installed?', 'cam', dropdownOptions.cam)}
        {renderDropdown('Neural Network Status', 'neural', dropdownOptions.neural)}

        {/* Logs only — no spark tables */}
        <div>
          <label>Before Log (CSV)</label>
          <input
            type="file"
            accept=".csv"
            onChange={e => setBeforeLog(e.target.files[0])}
            style={{ width: '100%', padding: '10px', background: '#333', color: '#fff', borderRadius: '4px' }}
          />
        </div>

        <div>
          <label>After Log (CSV)</label>
          <input
            type="file"
            accept=".csv"
            onChange={e => setAfterLog(e.target.files[0])}
            style={{ width: '100%', padding: '10px', background: '#333', color: '#fff', borderRadius: '4px' }}
          />
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <button
            type="submit"
            style={{ backgroundColor: '#00ff88', color: '#000', padding: '12px 20px', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            Upload / Analyze
          </button>
        </div>
      </form>

      {/* AI summary */}
      {aiSummary && (
        <div
          style={{
            marginTop: '2rem',
            padding: '1.5rem',
            backgroundColor: '#111',
            borderRadius: '12px',
            boxShadow: '0 0 15px rgba(0,255,0,0.3)',
            color: '#00FF90',
            fontFamily: 'monospace',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap'
          }}
        >
          <h2 style={{ color: '#00FF90', marginBottom: '1rem' }}>📘 AI Summary</h2>
          {aiSummary}
        </div>
      )}

      {/* Before vs After Metrics */}
      {comparison && (
        <div style={{ marginTop: '2rem', background:'#1a1a1a', padding:'16px', borderRadius:'10px' }}>
          <h2 style={{ color:'#00FF90', marginBottom: '10px' }}>Before vs After — Key Metrics</h2>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16 }}>
            <BeforeAfterCard title="Before" data={comparison.before} />
            <BeforeAfterCard title="After" data={comparison.after} />
            <DeltasCard deltas={comparison.deltas} />
          </div>
        </div>
      )}

      {/* Trainer Chat */}
      <div style={{ marginTop: '2rem', background:'#1a1a1a', padding:'16px', borderRadius:'10px' }}>
        <h2 style={{ color:'#00FF90', marginBottom: '10px' }}>Trainer Chat</h2>
        <div style={{ maxHeight: 340, overflowY: 'auto', padding: '10px', background: '#181818', borderRadius: 8 }}>
          {chat.map((m, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ fontSize:12, opacity:.7 }}>{m.role === 'assistant' ? 'Satera' : 'You'}</div>
              <div style={{ background: m.role === 'assistant' ? '#0b2' : '#333', color:'#fff', padding:'8px 10px', borderRadius:8, whiteSpace:'pre-wrap' }}>
                {m.content}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', gap:8, marginTop:10 }}>
          <input
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') sendChat(); }}
            placeholder="Ask about KR, WOT timing, trims, misfires…"
            style={{ flex:1, padding:'10px', borderRadius:6, background:'#222', color:'#fff', border:'1px solid #333' }}
          />
        <button onClick={sendChat} style={{ background:'#00ff88', color:'#000', border:'none', borderRadius:6, padding:'10px 16px', cursor:'pointer' }}>
            Send
          </button>
        </div>

        {/* Trainer save/finalize controls */}
        <div style={{ display:'flex', gap:10, marginTop:14, flexWrap:'wrap' }}>
          <button
            disabled={busy}
            onClick={saveChatAsTraining}
            style={{ background:'#66ffcc', color:'#000', border:'none', borderRadius:6, padding:'10px 16px', cursor:'pointer' }}
          >
            Save Chat as Training
          </button>
          <button
            disabled={busy}
            onClick={finalizeAppendJsonl}
            style={{ background:'#a78bfa', color:'#000', border:'none', borderRadius:6, padding:'10px 16px', cursor:'pointer' }}
          >
            Finalize & Append JSONL
          </button>
        </div>

        {(trainerEntryId || trainingEntry?.id) && (
          <div style={{ marginTop:8, fontSize:12, opacity:.8 }}>
            trainer_entry_id: <code>{trainerEntryId || trainingEntry?.id}</code>
          </div>
        )}

        {examplesTotal !== null && (
          <div style={{ marginTop:6, fontSize:12, opacity:.85 }}>
            Examples in JSONL: <b>{examplesTotal}</b> {examplesTotal < 10 ? ' (need ≥ 10 for fine-tune)' : ' ✅'}
          </div>
        )}

        {toast && (
          <div style={{ marginTop:10, background:'#111', border:'1px solid #2a2a2a', borderRadius:8, padding:'8px 10px', color:'#e0ffe8' }}>
            {toast}
          </div>
        )}
      </div>

      {/* Feedback + Fine-tune (works with either trainingEntry.id or trainerEntryId) */}
      {(trainingEntry?.id || trainerEntryId) && (
        <div style={{ marginTop: '2rem' }}>
          <label>📝 Trainer Notes:</label>
          <textarea
            rows="4"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Leave feedback or explanation for this correction..."
            style={{ width: '100%', marginTop: '10px', padding: '12px', backgroundColor: '#222', color: '#fff', borderRadius: '6px' }}
          />
          <button
            onClick={async () => {
              try {
                await axios.post(`${API_BASE}/update-feedback`, {
                  id: trainingEntry?.id || trainerEntryId,
                  feedback: notes
                });
                alert('✅ Feedback submitted!');
              } catch (err) {
                console.error('❌ Feedback submit failed:', err);
                alert('❌ Feedback failed to submit.');
              }
            }}
            style={{
              marginTop: '10px',
              backgroundColor: '#ffaa00',
              padding: '10px 16px',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              color: '#000'
            }}
          >
            💬 Submit Feedback
          </button>
        </div>
      )}

      <div style={{ marginTop: '1rem' }}>
        <button
          onClick={async () => {
            try {
              const res = await axios.post(`${API_BASE}/fine-tune-now`);
              alert(`✅ Fine-tune started. Job ID: ${res.data.job.id}`);
            } catch (err) {
              console.error('❌ Fine-tune failed:', err);
              alert('❌ Fine-tune failed.');
            }
          }}
          style={{
            backgroundColor: '#ff00cc',
            padding: '10px 16px',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            color: '#000'
          }}
        >
          🤖 Fine-Tune GPT-4 Now
        </button>
      </div>

      <pre style={{ marginTop: '20px', background: '#222', padding: '20px', color: '#adff2f', borderRadius: '6px' }}>{status}</pre>
    </div>
  );
};

export default TrainerMode;
