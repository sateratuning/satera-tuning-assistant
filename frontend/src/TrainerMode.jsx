import React, { useState } from 'react';
import axios from 'axios';

// Use same-origin API by default; allow override via REACT_APP_API_BASE
const API_BASE = process.env.REACT_APP_API_BASE || '/api';

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
  const [trainingEntry, setTrainingEntry] = useState(null); // may remain null if backend doesn't return it
  const [chat, setChat] = useState([
    { role: 'assistant', content: 'Upload BEFORE and AFTER logs (CSV), click Upload/Analyze, then chat about the results.' }
  ]);
  const [message, setMessage] = useState('');

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
      const data = res.data;

      setAiSummary(data.aiSummary || '');
      setComparison(data.comparison || null);
      setConversationId(data.conversationId || null);
      setTrainingEntry(data.trainingEntry || null); // will be null unless backend returns it

      setChat([{ role: 'assistant', content: data.aiSummary || 'Analysis complete.' }]);
      setStatus('✅ Done.');
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

  const KV = ({ k, v, suf='' }) => (
    <div style={{ display:'flex', justifyContent:'space-between', gap:12 }}>
      <div style={{ opacity:.8 }}>{k}</div>
      <div>{v == null || Number.isNaN(v) ? '—' : `${v}${suf}`}</div>
    </div>
  );

  const TimeBlock = ({ t }) => (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
      <KV k="0–60" v={t?.zeroToSixty?.toFixed ? t.zeroToSixty.toFixed(2) : t?.zeroToSixty} suf=" s" />
      <KV k="40–100" v={t?.fortyToHundred?.toFixed ? t.fortyToHundred.toFixed(2) : t?.fortyToHundred} suf=" s" />
      <KV k="60–130" v={t?.sixtyToOneThirty?.toFixed ? t.sixtyToOneThirty.toFixed(2) : t?.sixtyToOneThirty} suf=" s" />
    </div>
  );

  const KRBlock = ({ kr }) => (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
      <KV k="Max KR" v={kr?.maxKR} suf="°" />
      <KV k="KR Events" v={kr?.krEvents} />
    </div>
  );

  const WOTBlock = ({ w }) => (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
      <KV k="Peak Spark @WOT" v={w?.sparkMaxWOT} suf="°" />
      <KV k="MAP min @WOT" v={w?.mapMinWOT} suf=" kPa" />
      <KV k="MAP max @WOT" v={w?.mapMaxWOT} suf=" kPa" />
    </div>
  );

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
            <div style={{ background:'#202020', padding:12, borderRadius:8 }}>
              <h3 style={{ marginTop:0 }}>Before</h3>
              <KRBlock kr={comparison.before?.KR} />
              <div style={{ height:10 }} />
              <TimeBlock t={comparison.before?.times} />
              <div style={{ height:10 }} />
              <WOTBlock w={comparison.before?.WOT} />
            </div>
            <div style={{ background:'#202020', padding:12, borderRadius:8 }}>
              <h3 style={{ marginTop:0 }}>After</h3>
              <KRBlock kr={comparison.after?.KR} />
              <div style={{ height:10 }} />
              <TimeBlock t={comparison.after?.times} />
              <div style={{ height:10 }} />
              <WOTBlock w={comparison.after?.WOT} />
            </div>
            <div style={{ background:'#202020', padding:12, borderRadius:8 }}>
              <h3 style={{ marginTop:0 }}>Deltas</h3>
              <div style={{ display:'grid', gap:8 }}>
                <KV k="Δ Max KR" v={comparison.deltas?.KR_max_change} suf="°" />
                <KV k="Δ KR Events" v={comparison.deltas?.KR_event_change} />
                <KV k="Δ 0–60" v={comparison.deltas?.t_0_60_change?.toFixed ? comparison.deltas.t_0_60_change.toFixed(2) : comparison.deltas?.t_0_60_change} suf=" s" />
                <KV k="Δ 40–100" v={comparison.deltas?.t_40_100_change?.toFixed ? comparison.deltas.t_40_100_change.toFixed(2) : comparison.deltas?.t_40_100_change} suf=" s" />
                <KV k="Δ 60–130" v={comparison.deltas?.t_60_130_change?.toFixed ? comparison.deltas.t_60_130_change.toFixed(2) : comparison.deltas?.t_60_130_change} suf=" s" />
                <KV k="Δ Peak Spark @WOT" v={comparison.deltas?.sparkMaxWOT_change} suf="°" />
                <KV k="Δ MAP min @WOT" v={comparison.deltas?.mapMinWOT_change} suf=" kPa" />
                <KV k="Δ MAP max @WOT" v={comparison.deltas?.mapMaxWOT_change} suf=" kPa" />
                <KV k="Δ STFT Var" v={comparison.deltas?.varSTFT_change} />
                <KV k="Δ LTFT Var" v={comparison.deltas?.varLTFT_change} />
              </div>
            </div>
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
      </div>

      {/* Optional: Feedback + Fine-tune (feedback hidden unless we have an ID) */}
      {trainingEntry?.id && (
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
                  id: trainingEntry?.id,
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
