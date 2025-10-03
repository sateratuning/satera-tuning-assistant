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
const { buildMessages } = require('./prompt');
const parseCSV = require('./utils/parseCSV'); // compact parser → metrics

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

/* ------------------------
   CSV + AI REVIEW (merged)
------------------------- */
function analyzeCsvContent(content) {
  const lines = content.split(/\r?\n/).map(l => l.trim());
  if (!lines.length) throw new Error('CSV file empty');
  const headerRowIndex = lines.findIndex(r => r.toLowerCase().startsWith('offset'));
  if (headerRowIndex === -1) throw new Error('Could not locate header row');
  const headers = (lines[headerRowIndex] || '').split(',').map(h => h.trim());
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
  return { headers, parsed };
}

// Build structured checklist from metrics
function buildChecklist(metrics) {
  const out = [];

  // Knock
  if (metrics.knockEvents?.length) out.push(`❌ Knock detected (${metrics.knockEvents.length} events)`);
  else out.push(`✅ No knock detected.`);

  // Timing
  if (metrics.peakTiming)
    out.push(`📈 Peak timing under WOT: ${metrics.peakTiming}° @ ${metrics.peakTimingRPM} RPM`);

  // MAP
  if (metrics.mapMin != null && metrics.mapMax != null)
    out.push(`🌡 MAP under WOT: ${metrics.mapMin} – ${metrics.mapMax} kPa`);

  // Knock sensors
  if (metrics.ks1max != null) out.push(`✅ Knock Sensor 1 within safe range (Peak: ${metrics.ks1max}V)`);
  if (metrics.ks2max != null) out.push(`✅ Knock Sensor 2 within safe range (Peak: ${metrics.ks2max}V)`);

  // Fuel trims
  if (metrics.avgFT1 != null) out.push(`⚖️ Avg fuel correction (Bank 1): ${metrics.avgFT1}%`);
  if (metrics.avgFT2 != null) out.push(`⚖️ Avg fuel correction (Bank 2): ${metrics.avgFT2}%`);
  if (metrics.varFT != null) out.push(`⚖️ Fuel trim variance: ${metrics.varFT}%`);

  // Oil pressure
  if (metrics.oilMin != null) {
    if (metrics.oilMin < 20) out.push(`❌ Oil pressure dropped below safe threshold (${metrics.oilMin} psi)`);
    else out.push(`✅ Oil pressure safe (Min: ${metrics.oilMin} psi)`);
  }

  // Coolant temp
  if (metrics.ectMax != null) {
    if (metrics.ectMax > 230) out.push(`⚠️ Coolant temp peaked ${metrics.ectMax}°F (High)`);
    else out.push(`✅ Coolant temp safe (Max: ${metrics.ectMax}°F)`);
  }

  // Misfires
  if (metrics.misfires) {
    const total = Object.values(metrics.misfires).reduce((a, b) => a + b, 0);
    if (total > 0) out.push(`❌ Misfires detected: ${JSON.stringify(metrics.misfires)}`);
    else out.push(`✅ No misfires detected`);
  }

  // Acceleration timers
  if (metrics.zeroTo60) out.push(`🚀 0–60 mph: ${metrics.zeroTo60}s`);
  if (metrics.fortyTo100) out.push(`🚀 40–100 mph: ${metrics.fortyTo100}s`);
  if (metrics.sixtyTo130) out.push(`🚀 60–130 mph: ${metrics.sixtyTo130}s`);

  return out.join('\n');
}

// Combined AI Review route
app.post(['/ai-review', '/api/ai-review'], upload.single('log'), async (req, res) => {
  let filePath;
  try {
    if (!req.file) return res.status(400).send('No CSV file uploaded.');
    filePath = req.file.path;
    const content = fs.readFileSync(filePath, 'utf8');

    // Get structured metrics
    const metrics = parseCSV(content);
    if (!metrics) throw new Error('Parse failed');
    const checklist = buildChecklist(metrics);

    // Reduce dataset for AI
    const reduced = metrics.sampled || []; // parseCSV already down-samples

    const observations = checklist + '\n' + JSON.stringify(reduced.slice(0, 200), null, 2);
    const messages = buildMessages({ meta: {}, observations });

    let finalReview = '';
    try {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.3,
        messages
      });
      finalReview = completion.choices?.[0]?.message?.content?.trim() || '';
    } catch (e) {
      finalReview = 'Model unavailable. Showing checklist only.';
    }

    res.type('text/plain').send(checklist + '\n\n===SPLIT===\n' + finalReview);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to analyze log.');
  } finally {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

/* ------------------------
   REVIEW-LOG (metrics only)
------------------------- */
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

/* ------------------------
   AI TABLE (unchanged)
------------------------- */
app.post(['/ai-table', '/api/ai-table'], async (req, res) => {
  try {
    const { table, vehicleInfo, reducedLogData } = req.body || {};
    if (!table || !vehicleInfo) return res.status(400).send('Missing table or vehicleInfo.');
    const prompt = `You are a Gen 3 HEMI calibration expert. Return only corrected table:\n${table}`;
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
