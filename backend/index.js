// backend/index.js
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { OpenAI } = require('openai');

// Debug: show SR key length only
const dumpRole = (k) => {
  try {
    const [h, p] = String(k || '').split('.');
    const payload = JSON.parse(Buffer.from((p || ''), 'base64url').toString('utf8'));
    return { len: (k || '').length, role: payload?.role };
  } catch {
    return { len: (k || '').length, role: 'unknown' };
  }
};
console.log('SR check:', dumpRole(process.env.SUPABASE_SERVICE_ROLE_KEY));

// Route modules
const runDetail = require('./routes/runDetail');
const submitRunRoutes = require('./routes/submitRun');
const leaderboardRoutes = require('./routes/leaderboard');
const processLog = require('./routes/processLog');
const trainerAI = require('./routes/trainerAI');
const overlayRoutes = require('./routes/overlay');
const { buildMessages } = require('./prompt');
const parseCSV = require('./utils/parseCSV');

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
  res
    .status(200)
    .json({ ok: true, service: 'Satera API', time: new Date().toISOString() });
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

/* ------------------------
   LEGACY CSV AI REVIEW (upload)
------------------------- */
function analyzeCsvContent(content) {
  const lines = content.split(/\r?\n/).map((l) => l.trim());
  if (!lines.length) throw new Error('CSV file empty');
  const headerRowIndex = lines.findIndex((r) =>
    r.toLowerCase().startsWith('offset')
  );
  if (headerRowIndex === -1) throw new Error('Could not locate header row');
  const headers = (lines[headerRowIndex] || '').split(',').map((h) => h.trim());
  const dataStart = headerRowIndex + 4;
  const dataRows = lines
    .slice(dataStart)
    .filter((row) => row && row.includes(','));
  const toNum = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const parsed = dataRows.map((row) => {
    const values = row.split(',');
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = toNum(values[i]);
    });
    return obj;
  });
  if (!parsed.length) throw new Error('No data rows found in CSV.');
  return { headers, parsed };
}

// Legacy AI review (CSV upload) – kept for backward compatibility
app.post(['/ai-review', '/api/ai-review'], upload.single('log'), async (req, res) => {
  let filePath;
  try {
    if (!req.file) return res.status(400).send('No CSV file uploaded.');
    filePath = req.file.path;
    const content = fs.readFileSync(filePath, 'utf8');
    const { headers, parsed } = analyzeCsvContent(content);

    const out = [`⚡ Legacy checks enabled (CSV upload mode)`];
    const rpmCol = 'Engine RPM (SAE)';
    const knockCol = 'Total Knock Retard';
    const knockVals = parsed.map((r) => r[knockCol]).filter(Number.isFinite);
    if (knockVals.length && Math.max(...knockVals) > 0)
      out.push(`⚠️ Knock detected`);
    else out.push('✅ No knock detected');

    const reduced = parsed
      .filter((_, i) => i % 400 === 0)
      .map((r) => ({
        rpm: r[rpmCol],
        airmass: r['Cylinder Airmass'],
        knock: r[knockCol],
      }));

    const observations =
      out.join('\n') + '\n' + JSON.stringify(reduced.slice(0, 200), null, 2);
    const messages = buildMessages({ meta: {}, observations });

    let finalReview = '';
    try {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.3,
        messages,
      });
      finalReview =
        completion.choices?.[0]?.message?.content?.trim() || '';
    } catch (e) {
      finalReview = 'Model unavailable. Showing quick checks only.';
    }

    res
      .type('text/plain')
      .send(out.join('\n') + '\n===SPLIT===\n' + finalReview);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to analyze log.');
  } finally {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

/* ------------------------
   NEW METRICS-BASED AI REVIEW
------------------------- */

// Validation + tone helpers
function sanitizeTone(text) {
  if (!text) return text;
  return text
    .replace(/the tune is (too|overly) aggressive/gi, 'the timing/load behavior may merit review')
    .replace(/\bfix\b/gi, 'address')
    .replace(/\bincorrect\b/gi, 'inconsistent');
}

function buildSystemPrompt({ mods }) {
  return [
    `You are an automotive log assessor for Gen 3 HEMI vehicles.`,
    `Rules: neutral, no tuning edits, no blame.`,
    mods?.power_adder === 'N/A'
      ? `Do not mention boost, psi, wastegates, superchargers, or boost controllers.`
      : ``,
    mods?.power_adder?.toLowerCase().includes('nitrous')
      ? `Only mention nitrous-specific checks if relevant.`
      : ``,
    `Always output in structured sections:`,
    `Summary, Knock, Timing, Fueling, Sensors, Temps/Oil, Misfires, Acceleration, Next Steps.`,
  ].join('\n');
}

function buildUserPrompt({ vehicle, mods, metrics }) {
  return [
    `VEHICLE: ${vehicle?.year || ''} ${vehicle?.model || ''} | Engine: ${mods.engine} | Trans: ${mods.trans}`,
    `Mods: ${mods.power_adder}, Fuel: ${mods.fuel}, Injectors: ${mods.injectors}, Throttle: ${mods.throttle}, MAP: ${mods.map}`,
    `Metrics (observed from log):`,
    `Knock events: ${metrics.knock?.length ? JSON.stringify(metrics.knock) : 'None'}`,
    `Peak timing: ${metrics.peakTiming}° @ ${metrics.peakTimingRPM} RPM`,
    `MAP WOT range: ${metrics.mapWOTmin}–${metrics.mapWOTmax} kPa`,
    `KS volts: B1 ${metrics.ks1max}, B2 ${metrics.ks2max}`,
    `Fuel trims: variance ${metrics.varFT}, Avg B1 ${metrics.avgFT1}, Avg B2 ${metrics.avgFT2}`,
    `Oil min: ${metrics.oilMin}, ECT max: ${metrics.ectMax}`,
    `Misfires: ${JSON.stringify(metrics.misfires)}`,
    `Accel timers: 0–60: ${metrics.zeroTo60}, 40–100: ${metrics.fortyTo100}, 60–130: ${metrics.sixtyTo130}`,
    `Always report these sections in order, even if values are normal or missing.`,
  ].join('\n');
}

// Parse CSV → metrics (raw values)
app.post('/review-log', upload.single('log'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const raw = fs.readFileSync(req.file.path, 'utf8');
    const metrics = parseCSV(raw);
    fs.unlinkSync(req.file.path);
    if (!metrics) return res.status(400).json({ error: 'Parse failed' });
    res.json({ ok: true, metrics });
  } catch (err) {
    console.error('review-log error', err);
    res.status(500).json({ error: 'Failed to process log' });
  }
});

// Token-efficient AI review (dropdown-aware)
app.post('/ai-review-json', async (req, res) => {
  try {
    const { vehicle, mods, metrics } = req.body || {};
    const system = buildSystemPrompt({ mods });
    const user = buildUserPrompt({ vehicle, mods, metrics });
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    let text = resp.choices?.[0]?.message?.content || '';
    text = sanitizeTone(text);
    // Drop boost talk if N/A
    if (mods?.power_adder === 'N/A') {
      text = text.split('\n').filter((l) => !/\b(boost|psi)\b/i.test(l)).join('\n');
    }
    res.json({ ok: true, assessment: text });
  } catch (e) {
    console.error('ai-review-json error', e);
    res.status(500).json({ error: 'AI review failed' });
  }
});

/* ------------------------
   AI TABLE (unchanged)
------------------------- */
app.post(['/ai-table', '/api/ai-table'], async (req, res) => {
  try {
    const { table, vehicleInfo, reducedLogData } = req.body || {};
    if (!table || !vehicleInfo)
      return res.status(400).send('Missing table or vehicleInfo.');
    const prompt = `You are a Gen 3 HEMI calibration expert. Return only corrected table:\n${table}`;
    const aiResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    });
    const correctedTable =
      (aiResponse.choices?.[0]?.message?.content || '').trim();
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
