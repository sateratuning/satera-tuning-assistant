import React, { useState } from 'react';
import axios from 'axios';

const TrainerMode = () => {
  const [form, setForm] = useState({
    vin: '', calid: '', transCalid: '', transModel: '', year: '', model: '', engine: '', injectors: '', map: '',
    throttle: '', power: '', trans: '', tire: '', gear: '', fuel: '', cam: '', neural: '',
    sparkTableStart: '', sparkTableFinal: ''
  });
  const [beforeLog, setBeforeLog] = useState(null);
  const [afterLog, setAfterLog] = useState(null);
  const [status, setStatus] = useState('');
  const [sparkChanges, setSparkChanges] = useState([]);
  const [customFields, setCustomFields] = useState({});
  const [aiSummary, setAiSummary] = useState('');
  const [notes, setNotes] = useState('');
  const [trainingEntry, setTrainingEntry] = useState(null);

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('⏳ Uploading...');
    if (!beforeLog || !afterLog || !form.sparkTableStart || !form.sparkTableFinal) {
      return setStatus('❌ Please fill out all required fields and upload both logs.');
    }

    const formData = new FormData();
    Object.entries(form).forEach(([key, value]) => formData.append(key, value));
    formData.append('beforeLog', beforeLog);
    formData.append('afterLog', afterLog);
    formData.append('feedback', notes); // ✅ send the trainer notes as feedback


    try {
      const res = await axios.post('http://localhost:5000/trainer-ai', formData);
      const data = res.data;
      setAiSummary(data.aiSummary || '');
      setSparkChanges(data.sparkChanges || []);
      setTrainingEntry(data.trainingEntry || null);
      setStatus('✅ Upload complete.');
    } catch (err) {
      console.error("❌ Upload error:", err);
      setStatus('❌ Upload failed.');
    }
  };

  const exportJSONL = () => {
    if (!trainingEntry) return;
    const blob = new Blob([JSON.stringify(trainingEntry) + '\n'], { type: 'application/jsonl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${form.vin || 'entry'}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
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

  const renderInput = (label, name) => (
    <div style={{ marginBottom: '12px' }}>
      <label>{label}</label>
      <input name={name} value={form[name]} onChange={handleChange}
        style={{ width: '100%', padding: '8px', borderRadius: '4px', background: '#333', color: '#fff' }} />
    </div>
  );

  const renderDropdown = (label, name, options) => (
    <div style={{ marginBottom: '12px' }}>
      <label>{label}</label>
      <select name={name} value={form[name]} onChange={handleChange}
        style={{ width: '100%', padding: '8px', borderRadius: '4px', background: '#333', color: '#fff' }}>
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

  return (
    <div style={{ padding: '30px', backgroundColor: '#111', color: '#adff2f', minHeight: '100vh', fontFamily: 'Arial, sans-serif' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '20px' }}>Trainer Mode Upload</h1>

      <div style={{ marginBottom: '20px' }}>
        <label>Paste VCM Info</label>
        <textarea onBlur={handleVCMPaste} placeholder="Paste copied VCM Editor info here"
          rows="4" style={{ width: '100%', padding: '10px', borderRadius: '4px', background: '#222', color: '#fff' }} />
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

        <div style={{ gridColumn: '1 / -1' }}>
          <label>Spark Table — Starting (Paste full 17x17 with axes)</label>
          <textarea name="sparkTableStart" rows="6" value={form.sparkTableStart} onChange={handleChange}
            style={{ width: '100%', padding: '10px', borderRadius: '4px', background: '#222', color: '#fff' }}></textarea>
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <label>Spark Table — Final (Paste full 17x17 with axes)</label>
          <textarea name="sparkTableFinal" rows="6" value={form.sparkTableFinal} onChange={handleChange}
            style={{ width: '100%', padding: '10px', borderRadius: '4px', background: '#222', color: '#fff' }}></textarea>
        </div>

        <div>
          <label>Before Log (CSV)</label>
          <input type="file" accept=".csv" onChange={e => setBeforeLog(e.target.files[0])}
            style={{ width: '100%', padding: '10px', background: '#333', color: '#fff', borderRadius: '4px' }} />
        </div>

        <div>
          <label>After Log (CSV)</label>
          <input type="file" accept=".csv" onChange={e => setAfterLog(e.target.files[0])}
            style={{ width: '100%', padding: '10px', background: '#333', color: '#fff', borderRadius: '4px' }} />
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <button type="submit" style={{ backgroundColor: '#00ff88', color: '#000', padding: '12px 20px', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Upload Training Data
          </button>
        </div>
      </form>

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

      {sparkChanges.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <h2 style={{ color: '#00FF90', marginBottom: '10px' }}>🔥 Spark Table Changes</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#222', color: '#fff' }}>
            <thead>
              <tr>
                <th style={{ padding: '8px', borderBottom: '1px solid #444' }}>RPM</th>
                <th style={{ padding: '8px', borderBottom: '1px solid #444' }}>Airmass</th>
                <th style={{ padding: '8px', borderBottom: '1px solid #444' }}>Before</th>
                <th style={{ padding: '8px', borderBottom: '1px solid #444' }}>After</th>
              </tr>
            </thead>
            <tbody>
              {sparkChanges.map((row, idx) => (
                <tr key={idx}>
                  <td style={{ padding: '8px', borderBottom: '1px solid #333' }}>{row.rpm}</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #333' }}>{row.airmass}</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #333' }}>{row.before}</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #333' }}>{row.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {trainingEntry && (
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
      const res = await axios.post('http://localhost:5000/update-feedback', {
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


          <button
  onClick={async () => {
    try {
      const res = await axios.post('http://localhost:5000/fine-tune-now');
      alert(`✅ Fine-tune started. Job ID: ${res.data.job.id}`);
    } catch (err) {
      console.error('❌ Fine-tune failed:', err);
      alert('❌ Fine-tune failed.');
    }
  }}
  style={{
    marginTop: '10px',
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
      )}

      <pre style={{ marginTop: '20px', background: '#222', padding: '20px', color: '#adff2f', borderRadius: '6px' }}>{status}</pre>
    </div>
  );
};

export default TrainerMode;
