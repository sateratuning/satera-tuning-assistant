import React, { useState } from 'react';
import './App.css';
import { Link } from 'react-router-dom';

/* FORCE LIVE API BASE (bypasses localhost/env issues) */
const API_BASE = 'https://satera-backend.onrender.com'; // ← your Render URL (no trailing slash)

async function postApi(path, init) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return fetch(`${API_BASE}${p}`, init);
}

export default function MainApp() {
  const [formData, setFormData] = useState({
    vin: '', year: '', model: '', engine: '', injectors: '', map: '',
    throttle: '', power: '', trans: '', tire: '', gear: '', fuel: '', logFile: null,
  });
  const [result, setResult] = useState('');
  const [aiTable, setAiTable] = useState('');
  const [aiNeeded, setAiNeeded] = useState(false);
  const [logData, setLogData] = useState([]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((p) => ({ ...p, [name]: value }));
  };

  const handleFileChange = (e) => {
    setFormData((p) => ({ ...p, logFile: e.target.files[0] }));
  };

  const handleSubmit = async () => {
    const data = new FormData();
    Object.entries(formData).forEach(([k, v]) => {
      if (k === 'logFile' && v) data.append('log', v);
      else data.append(k, v ?? '');
    });

    try {
      const res = await postApi('/ai-review', { method: 'POST', body: data });
      if (!res.ok) throw new Error(`AI review failed (${res.status})`);
      const text = await res.text();
      const [review, ai] = text.split('===SPLIT===');
      setResult(review || '');
      try {
        const parsed = JSON.parse(ai);
        if (Array.isArray(parsed) && parsed[0]?.rpm !== undefined) {
          setLogData(parsed);
          setAiNeeded(true);
        } else if (parsed && typeof parsed === 'object') {
          setAiNeeded(true);
        } else {
          setAiNeeded(false);
        }
      } catch {
        setAiNeeded(typeof ai === 'string' && ai.toLowerCase().includes('timing'));
      }
    } catch (e) {
      setResult(`❌ Error analyzing log. ${e.message || ''}`);
      setAiNeeded(false);
    }
  };

  const handleTableSubmit = async () => {
    const tableInput = prompt('Paste your spark table from HPT (use Copy with Axis):');
    if (!tableInput) return;

    const vehicleInfo = {
      vin: formData.vin, year: formData.year, model: formData.model, engine: formData.engine,
      injectors: formData.injectors, map: formData.map, throttle: formData.throttle,
      power: formData.power, trans: formData.trans, tire: formData.tire, gear: formData.gear, fuel: formData.fuel,
    };

    try {
      const res = await postApi('/ai-table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: tableInput, vehicleInfo, reducedLogData: logData }),
      });
      if (!res.ok) throw new Error(`AI table failed (${res.status})`);
      const text = await res.text();
      setAiTable(text.trim());
    } catch (e) {
      alert(`❌ Error generating corrected table. ${e.message || ''}`);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(aiTable);
      alert('✅ Copied.');
    } catch {
      alert('❌ Failed to copy.');
    }
  };

  const dropdownOptions = {
    year: ['2005','2006','2007','2008','2009','2010','2011','2012','2013','2014','2015','2016','2017','2018','2019','2020','2021','2022','2023','2024','2025'],
    model: ['Charger','Challenger','300C','Durango','Ram','Magnum'],
    engine: ['Pre-Eagle 5.7L','Eagle 5.7L','6.1L','6.4L (392)','Hellcat 6.2L','Hellcat HO 6.2L'],
    injectors: ['Stock','ID1050x','ID1300x','ID1700x','FIC 1000','FIC 1200','Other'],
    map: ['OEM 1 Bar','2 Bar','3 Bar','Custom'],
    throttle: ['OEM','85mm','90mm','95mm','102mm'],
    power: ['Naturally Aspirated','Centrifugal Supercharger','Roots Supercharger','Turbocharged','Nitrous'],
    trans: ['Manual','5-Speed Auto','8-Speed Auto'],
    tire: ['26','27','28','29','30','31','32','33'],
    gear: ['3.06','3.09','3.23','3.55','3.73','3.90','4.10'],
    fuel: ['91 Octane','93 Octane','E85','Race Gas'],
  };

  return (
    <div
      className="App"
      style={{
        display: 'flex', flexDirection: 'column', backgroundColor: '#111',
        color: '#adff2f', minHeight: '100vh', fontFamily: 'Arial, sans-serif',
      }}
    >
      <header
        style={{
          padding: '20px', textAlign: 'center',
          background: 'linear-gradient(to bottom, #00ff88, #007744)',
          color: 'black', fontSize: '2.8rem', fontWeight: 'bold', letterSpacing: '2px',
          boxShadow: '0 4px 10px rgba(0, 255, 136, 0.4)',
        }}
      >
        <span style={{ textShadow: '0 0 10px #00ff88, 0 0 20px #00ff88' }}>
          Satera Tuning AI-ssistant
        </span>
        <div style={{ fontSize: '1rem', marginTop: '10px' }}>
          <Link to="/log-comparison" style={{ color: 'black', textDecoration: 'underline' }}>
            Go to Log Comparison
          </Link>
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1 }}>
        {/* LEFT: Vehicle Info */}
        <div style={{ flex: '0 0 300px', padding: '20px', backgroundColor: '#222', borderRight: '1px solid #333' }}>
          <h2 style={{ color: '#00ff88' }}>Vehicle Info</h2>
          {['vin','year','model','engine','injectors','map','throttle','power','trans','tire','gear','fuel'].map((name) => (
            <div key={name} style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px' }}>
                Select {name.charAt(0).toUpperCase() + name.slice(1)}:
              </label>
              {name === 'vin' ? (
                <input name={name} value={formData[name]} onChange={handleChange} style={{ width: '100%' }} />
              ) : (
                <select name={name} value={formData[name]} onChange={handleChange} style={{ width: '100%' }}>
                  <option value="">Select {name}</option>
                  {dropdownOptions[name]?.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              )}
            </div>
          ))}
        </div>

        {/* CENTER: Upload + Results */}
        <div style={{ flex: 1, padding: '20px' }}>
          <div style={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', padding: '20px', marginBottom: '20px' }}>
            <h2 style={{ color: '#00ff88' }}>Upload Datalog (.csv)</h2>
            <input type="file" accept=".csv" onChange={handleFileChange} style={{ display: 'block', marginBottom: '12px' }} />
            <button onClick={handleSubmit} style={{ backgroundColor: '#00ff88', color: '#000', padding: '10px 20px', border: 'none', cursor: 'pointer' }}>
              Analyze
            </button>
          </div>

          {result && (
            <div style={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', padding: '20px', marginBottom: '20px' }}>
              <h2 style={{ color: '#00ff88', fontSize: '1.8rem' }}>📋 Diagnostic Summary</h2>
              <pre style={{ fontSize: '1.2rem', color: '#adff2f', whiteSpace: 'pre-wrap' }}>{result}</pre>
            </div>
          )}
        </div>

        {/* RIGHT: AI Revision */}
        <div style={{ flex: '0 0 300px', padding: '20px', backgroundColor: '#222', borderLeft: '1px solid #333' }}>
          <h2 style={{ color: '#00ff88' }}>🧠 S-AI-TERA Revision</h2>
          {aiNeeded && (
            <button onClick={handleTableSubmit} style={{ marginBottom: '15px', backgroundColor: '#00ff88', color: '#000', padding: '8px 16px', border: 'none', cursor: 'pointer' }}>
              Generate Updated Table
            </button>
          )}
          {aiTable && (
            <button onClick={handleCopy} style={{ backgroundColor: '#00ff88', color: '#000', padding: '8px 16px', border: 'none', cursor: 'pointer' }}>
              📋 Copy Corrected Table
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
