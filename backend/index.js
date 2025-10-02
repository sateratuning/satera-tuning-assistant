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
 * Shared CSV analyzer (quick checks only)
 */
function analyzeCsvContent(content) {
  const lines = content.split('\n').map(l => l.trimEnd());
  const after15 = lines.slice(15);
  if (after15.length < 5) throw new Error('CSV appears incomplete.');

  const headers = (after15[0] || '').split(',').map(h => h.trim());
  const dataRows = after15.slice(4).filter(row => row && row.includes(','));
  const toNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; };

  const parsed = dataRows.map(row => {
    const values = row.split(',');
    const obj = {};
    headers.forEach((h, i) => { obj[h] = toNum(values[i]); });
    return obj;
  });
  if (!parsed.length) throw new Error('No data rows found in CSV.');

  const hasCol = (name) => headers.includes(name);
  const getColumn = (name) => (hasCol(name) ? parsed.map(r => r[name]).filter(Number.isFinite) : []);
  const safeMax = (arr) => (arr.length ? Math.max(...arr) : undefined);
  const safeMin = (arr) => (arr.length ? Math.min(...arr) : undefined);
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : undefined);

  const out = [];

  // Knock
  const knockValues = getColumn('Total Knock Retard').map(v => Math.abs(v));
  const peakKnock = safeMax(knockValues);
  if (peakKnock !== undefined) out.push(peakKnock > 0 ? `⚠️ Knock detected: up to ${peakKnock.toFixed(1)}°` : '✅ No knock detected.');
  else out.push('ℹ️ Knock column not found.');

  // WOT
  const accel = getColumn('Accelerator Position D (SAE)');
  const wotRows = accel.length ? parsed.filter(r => (r['Accelerator Position D (SAE)'] ?? 0) > 86) : [];
  const timingCol = 'Timing Advance (SAE)';
  const rpmCol = 'Engine RPM (SAE)';
  const mapCol = 'Intake Manifold Absolute Pressure (SAE)';

  if (wotRows.length) {
    const peakTimingRow = wotRows.reduce((best, r) => ((r[timingCol] ?? -Infinity) > (best[timingCol] ?? -Infinity) ? r : best), wotRows[0]);
    const peakTiming = peakTimingRow[timingCol], rpmAtPeak = peakTimingRow[rpmCol];
    if (Number.isFinite(peakTiming) && Number.isFinite(rpmAtPeak)) out.push(`📈 Peak timing under WOT: ${peakTiming.toFixed(1)}° @ ${rpmAtPeak.toFixed(0)} RPM`);
    const mapWOT = wotRows.map(r => r[mapCol]).filter(Number.isFinite);
    if (mapWOT.length) out.push(`🌡 MAP under WOT: ${safeMin(mapWOT).toFixed(1)} – ${safeMax(mapWOT).toFixed(1)} kPa`);
  } else {
    out.push('ℹ️ No WOT conditions found.');
  }

  // Knock sensors
  ['Knock Sensor 1', 'Knock Sensor 2'].forEach(s => {
    const volts = getColumn(s);
    if (!volts.length) out.push(`ℹ️ ${s} not found.`);
    else {
      const peak = safeMax(volts);
      out.push(peak > 3.0 ? `⚠️ ${s} exceeded 3.0V threshold (Peak: ${peak.toFixed(2)}V)` : `✅ ${s} within safe range (Peak: ${peak.toFixed(2)}V)`);
    }
  });

  // Fuel trims variance
  const lt1 = getColumn('Long Term Fuel Trim Bank 1 (SAE)');
  const lt2 = getColumn('Long Term Fuel Trim Bank 2 (SAE)');
  if (lt1.length && lt2.length) {
    const variance = lt1.map((v, i) => (Number.isFinite(v) && Number.isFinite(lt2[i])) ? Math.abs(v - lt2[i]) : undefined).filter(Number.isFinite);
    out.push(variance.some(v => v > 10) ? '⚠️ Fuel trim variance > 10% between banks' : '✅ Fuel trim variance within 10%');
  }

  // Avg fuel correction
  const st1 = getColumn('Short Term Fuel Trim Bank 1 (SAE)');
  const st2 = getColumn('Short Term Fuel Trim Bank 2 (SAE)');
  if (st1.length && lt1.length) {
    const combo1 = st1.map((v, i) => (Number.isFinite(v) ? v : 0) + (Number.isFinite(lt1[i]) ? lt1[i] : 0)).filter(Number.isFinite);
    const a1 = avg(combo1); if (a1 !== undefined) out.push(`📊 Avg fuel correction (Bank 1): ${a1.toFixed(1)}%`);
  }
  if (st2.length && lt2.length) {
    const combo2 = st2.map((v, i) => (Number.isFinite(v) ? v : 0) + (Number.isFinite(lt2[i]) ? lt2[i] : 0)).filter(Number.isFinite);
    const a2 = avg(combo2); if (a2 !== undefined) out.push(`📊 Avg fuel correction (Bank 2): ${a2.toFixed(1)}%`);
  }

  // Oil pressure
  const rpmSeries = getColumn(rpmCol);
  const oilSeries = getColumn('Engine Oil Pressure');
  if (rpmSeries.length && oilSeries.length) {
    const oilRows = parsed.filter(r => Number.isFinite(r[rpmCol]) && r[rpmCol] > 500);
    const oilLow = oilRows.some(r => Number.isFinite(r['Engine Oil Pressure']) && r['Engine Oil Pressure'] < 20);
    out.push(oilLow ? '⚠️ Oil pressure dropped below 20 psi.' : '✅ Oil pressure within safe range.');
  }

  // Coolant
  const ect = getColumn('Engine Coolant Temp (SAE)');
  if (ect.length) out.push(ect.some(v => v > 230) ? '⚠️ Coolant temp exceeded 230°F.' : '✅ Coolant temp within safe limits.');

  // Misfires
  const misfireReport = [];
  const firstRow = parsed[0] || {};
  Object.keys(firstRow).forEach(k => {
    if (k.includes('Misfire Current Cylinder')) {
      const cyl = k.split('#')[1] || '?';
      const vals = getColumn(k);
      if (vals.length) {
        let count = 0;
        for (let i = 1; i < vals.length; i++) {
          const d = vals[i] - vals[i - 1];
          if (Number.isFinite(d) && d > 0 && d < 1000) count += d;
        }
        if (count > 0) misfireReport.push(`- Cylinder ${cyl}: ${count} misfires`);
      }
    }
  });
  out.push(misfireReport.length ? `🚨 Misfires detected:\n${misfireReport.join('\n')}` : '✅ No misfires detected.');

  return { parsed, out };
}

// -------- REVIEW-LOG (non-AI quick checks) --------
app.post(['/review-log', '/api/review-log'], upload.single('log'), (req, res) => {
  try {
    if (!req.file) return res.status(400).send('No CSV file uploaded.');
    const content = fs.readFileSync(req.file.path, 'utf8');
    const { out } = analyzeCsvContent(content);
    res.type('text/plain').send(out.join('\n'));
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to analyze log.');
  } finally {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

// -------- AI REVIEW (already in place) --------
app.post(['/ai-review', '/api/ai-review'], upload.single('log'), async (req, res) => {
  let filePath;
  try {
    if (!req.file) return res.status(400).send('No CSV file uploaded.');
    filePath = req.file.path;
    const content = fs.readFileSync(filePath, 'utf8');

    const { parsed, out } = analyzeCsvContent(content);
    const quickChecks = out.join('\n');

    // Reduced telemetry sample
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

    // Keep format the same as before
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
