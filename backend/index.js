// backend/index.js
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { OpenAI } = require('openai');

// Debug (safe): show token length/role only
const dumpRole = (k) => {
  try {
    const [h, p] = String(k || '').split('.');
    const payload = JSON.parse(Buffer.from((p || ''), 'base64url').toString('utf8'));
    return { len: (k || '').length, role: payload?.role };
  } catch { return { len: (k || '').length, role: 'unknown' }; }
};
console.log('SR check:', dumpRole(process.env.SUPABASE_SERVICE_ROLE_KEY));

// Route modules
const runDetail = require('./routes/runDetail');
const submitRunRoutes = require('./routes/submitRun');
const leaderboardRoutes = require('./routes/leaderboard');
const processLog = require('./routes/processLog');
const trainerAI = require('./routes/trainerAI');
const overlayRoutes = require('./routes/overlay');

// NEW: style-guided prompt builder for AI reviews
const { buildMessages } = require('./prompt');

const app = express();
const PORT = Number(process.env.PORT || 5000);

// uploads dir
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({ dest: uploadsDir });

// middleware
app.use(cors());
app.use(express.json());
app.use(require('./routes/feedback'));

// health
app.get(['/health', '/api/health'], (req, res) => {
  res.status(200).json({ ok: true, service: 'Satera API', time: new Date().toISOString() });
});

// mount other modules
app.use('/', runDetail);
app.use('/', leaderboardRoutes);
app.use('/', submitRunRoutes);
app.use('/', processLog);
app.use('/', trainerAI);
app.use('/', overlayRoutes);

// OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Shared CSV analyzer (with header auto-detect)
 */
function analyzeCsvContent(content) {
  const lines = content.split(/\r?\n/).map(l => l.trim());
  if (!lines.length) throw new Error('CSV file empty');

  // 🔎 Find header row (must start with "Offset")
  const headerRowIndex = lines.findIndex(r => r.toLowerCase().startsWith('offset'));
  if (headerRowIndex === -1) throw new Error('Could not locate header row');

  const headers = (lines[headerRowIndex] || '').split(',').map(h => h.trim());

  // Skip header + units + 2 spacer rows
  const dataStart = headerRowIndex + 4;
  const dataRows = lines.slice(dataStart).filter(row => row && row.includes(','));

  const toNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; };

  const parsed = dataRows.map(row => {
    const values = row.split(',');
    const obj = {};
    headers.forEach((h, i) => { obj[h] = toNum(values[i]); });
    return obj;
  });

  if (!parsed.length) throw new Error('No data rows found in CSV.');

  const safeMax = (arr) => (arr.length ? Math.max(...arr) : undefined);
  const safeMin = (arr) => (arr.length ? Math.min(...arr) : undefined);
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : undefined);

  const out = [];

  // Knock
  const knockValues = parsed.map(r => r['Total Knock Retard']).filter(Number.isFinite).map(v => Math.abs(v));
  const peakKnock = safeMax(knockValues);
  if (peakKnock !== undefined) out.push(peakKnock > 0 ? `⚠️ Knock detected: up to ${peakKnock.toFixed(1)}°` : '✅ No knock detected.');

  // WOT
  const accel = parsed.map(r => r['Accelerator Position D (SAE)']).filter(Number.isFinite);
  const wotRows = accel.length ? parsed.filter(r => (r['Accelerator Position D (SAE)'] ?? 0) > 86) : [];
  const rpmCol = 'Engine RPM (SAE)';
  const timingCol = 'Timing Advance (SAE)';
  const mapCol = 'Intake Manifold Absolute Pressure (SAE)';

  if (wotRows.length) {
    const peakTimingRow = wotRows.reduce((best, r) => ((r[timingCol] ?? -Infinity) > (best[timingCol] ?? -Infinity) ? r : best), wotRows[0]);
    const peakTiming = peakTimingRow[timingCol], rpmAtPeak = peakTimingRow[rpmCol];
    if (Number.isFinite(peakTiming) && Number.isFinite(rpmAtPeak))
      out.push(`📈 Peak timing under WOT: ${peakTiming.toFixed(1)}° @ ${rpmAtPeak.toFixed(0)} RPM`);

    const mapWOT = wotRows.map(r => r[mapCol]).filter(Number.isFinite);
    if (mapWOT.length)
      out.push(`🌡 MAP under WOT: ${safeMin(mapWOT).toFixed(1)} – ${safeMax(mapWOT).toFixed(1)} kPa`);
  } else {
    out.push('ℹ️ No WOT conditions found.');
  }

  // Knock sensors
  ['Knock Sensor 1', 'Knock Sensor 2'].forEach(s => {
    const volts = parsed.map(r => r[s]).filter(Number.isFinite);
    if (volts.length) {
      const peak = safeMax(volts);
      out.push(peak > 3.0 ? `⚠️ ${s} exceeded 3.0V threshold (Peak: ${peak.toFixed(2)}V)` : `✅ ${s} within safe range (Peak: ${peak.toFixed(2)}V)`);
    }
  });

  // Fuel trims
  const lt1 = parsed.map(r => r['Long Term Fuel Trim Bank 1 (SAE)']).filter(Number.isFinite);
  const lt2 = parsed.map(r => r['Long Term Fuel Trim Bank 2 (SAE)']).filter(Number.isFinite);
  if (lt1.length && lt2.length) {
    const variance = lt1.map((v, i) => (Number.isFinite(v) && Number.isFinite(lt2[i])) ? Math.abs(v - lt2[i]) : undefined).filter(Number.isFinite);
    if (variance.some(v => v > 10)) out.push('⚠️ Fuel trim variance > 10% between banks');
  }

  const st1 = parsed.map(r => r['Short Term Fuel Trim Bank 1 (SAE)']).filter(Number.isFinite);
  const st2 = parsed.map(r => r['Short Term Fuel Trim Bank 2 (SAE)']).filter(Number.isFinite);
  if (st1.length && lt1.length) {
    const combo1 = st1.map((v, i) => (Number.isFinite(v) ? v : 0) + (Number.isFinite(lt1[i]) ? lt1[i] : 0)).filter(Number.isFinite);
    const a1 = avg(combo1); if (a1 !== undefined) out.push(`📊 Avg fuel correction (Bank 1): ${a1.toFixed(1)}%`);
  }
  if (st2.length && lt2.length) {
    const combo2 = st2.map((v, i) => (Number.isFinite(v) ? v : 0) + (Number.isFinite(lt2[i]) ? lt2[i] : 0)).filter(Number.isFinite);
    const a2 = avg(combo2); if (a2 !== undefined) out.push(`📊 Avg fuel correction (Bank 2): ${a2.toFixed(1)}%`);
  }

  // Oil pressure
  const oil = parsed.map(r => r['Engine Oil Pressure']).filter(Number.isFinite);
  if (oil.length && parsed.some(r => (r[rpmCol] ?? 0) > 500 && r['Engine Oil Pressure'] < 20)) {
    out.push('⚠️ Oil pressure dropped below 20 psi.');
  }

  // Coolant
  const ect = parsed.map(r => r['Engine Coolant Temp (SAE)']).filter(Number.isFinite);
  if (ect.length && ect.some(v => v > 230)) out.push('⚠️ Coolant temp exceeded 230°F.');

  return { headers, parsed, out };
}

// -------- AI REVIEW (CSV upload) --------
app.post(['/ai-review', '/api/ai-review'], upload.single('log'), async (req, res) => {
  let filePath;
  try {
    if (!req.file) return res.status(400).send('No CSV file uploaded.');
    filePath = req.file.path;
    const content = fs.readFileSync(filePath, 'utf8');

    const { headers, parsed, out } = analyzeCsvContent(content);
    const quickChecks = out.join('\n');

    const rpmCol = 'Engine RPM (SAE)';
    const reduced = parsed
      .filter((_, i) => i % 400 === 0)
      .map(row => ({
        rpm: row[rpmCol],
        airmass: row['Cylinder Airmass'],
        knock: row['Total Knock Retard'],
      }))
      .filter(r => Number.isFinite(r.rpm) && Number.isFinite(r.airmass) && Number.isFinite(r.knock));

    const observations = [
      'Quick checks:',
      quickChecks,
      '',
      'Reduced telemetry sample (rpm, airmass, knock):',
      JSON.stringify(reduced.slice(0, 200), null, 2)
    ].join('\n');

    const meta = {
      year: req.body.year || '',
      model: req.body.model || '',
      engine: req.body.engine || '',
      fuel: req.body.fuel || '',
      power: req.body.power || '',
      trans: req.body.trans || ''
    };
    const messages = buildMessages({ meta, observations });

    let finalReview = '';
    try {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.3,
        messages
      });
      finalReview = completion.choices?.[0]?.message?.content?.trim() || '';
    } catch (e) {
      console.warn('AI review failed:', e.message);
      finalReview = 'Model unavailable. Showing quick checks only.';
    }

    res.type('text/plain').send(`${quickChecks}\n===SPLIT===\n${finalReview}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to analyze log.');
  } finally {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

// -------- AI TABLE (unchanged) --------
app.post(['/ai-table', '/api/ai-table'], async (req, res) => {
  try {
    const { table, vehicleInfo, reducedLogData } = req.body || {};
    if (!table || !vehicleInfo) return res.status(400).send('Missing table or vehicleInfo.');

    const prompt = `
You are a Gen 3 HEMI calibration expert.
Given the timing table (copied from HP Tuners, includes axis) and vehicle setup${reducedLogData ? ' (plus a small sample of RPM/knock/airmass)' : ''},
return ONLY the corrected table in tab-delimited format. No explanations.

Vehicle Setup:
${JSON.stringify(vehicleInfo, null, 2)}

${reducedLogData ? `Telemetry Sample:\n${JSON.stringify(reducedLogData, null, 2)}\n` : ''}

Original Table:
${table}

ONLY return the corrected table (no headers, no notes):
`.trim();

    const aiResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    });

    const correctedTable = (aiResponse.choices?.[0]?.message?.content || '').trim();
    if (!correctedTable) return res.status(500).send('AI returned empty table.');
    res.send(correctedTable);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to generate updated table.');
  }
});

// 404 guard
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
