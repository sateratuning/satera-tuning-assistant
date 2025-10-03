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
   CHECKLIST FORMATTER
------------------------- */
function formatChecklist(metrics) {
  const out = [];

  // Knock
  if (metrics.knock && metrics.knock.some((v) => v > 0))
    out.push(`⚠️ Knock detected`);
  else out.push(`✅ No knock detected`);

  // Timing
  out.push(
    `✅ Peak timing under WOT: ${metrics.peakTiming ?? '—'}° @ ${
      metrics.peakTimingRPM ?? '—'
    } RPM`
  );

  // MAP
  out.push(
    `✅ MAP range: ${metrics.map?.min ?? '—'} – ${metrics.map?.max ?? '—'} kPa`
  );

  // Knock sensor volts
  out.push(`✅ Knock Sensor 1 peak: ${metrics.ks1max ?? '—'} V`);
  out.push(`✅ Knock Sensor 2 peak: ${metrics.ks2max ?? '—'} V`);

  // Fuel trims
  out.push(`✅ Avg fuel trim B1: ${metrics.avgFT1?.toFixed?.(1) ?? '—'}%`);
  out.push(`✅ Avg fuel trim B2: ${metrics.avgFT2?.toFixed?.(1) ?? '—'}%`);
  out.push(
    `✅ Fuel trim variance: ${metrics.varFT?.toFixed?.(1) ?? '—'}%`
  );

  // Oil
  if (metrics.oilMin != null) {
    if (metrics.oilMin < 20)
      out.push(`❌ Oil pressure low: ${metrics.oilMin} psi`);
    else out.push(`✅ Oil pressure min: ${metrics.oilMin} psi (safe)`);
  }

  // Coolant
  if (metrics.ectMax != null) {
    if (metrics.ectMax > 230)
      out.push(`⚠️ Coolant temp max: ${metrics.ectMax}°F (high)`);
    else out.push(`✅ Coolant temp max: ${metrics.ectMax}°F`);
  }

  // Misfires
  const misfires = metrics.misfires || {};
  Object.entries(misfires).forEach(([cyl, count]) => {
    if (count > 0) out.push(`❌ Misfires ${cyl}: ${count}`);
    else out.push(`✅ Misfires ${cyl}: 0`);
  });

  // Accel timers
  if (metrics.zeroTo60 != null) out.push(`🚀 0–60: ${metrics.zeroTo60}s`);
  if (metrics.fortyTo100 != null) out.push(`🚀 40–100: ${metrics.fortyTo100}s`);
  if (metrics.sixtyTo130 != null) out.push(`🚀 60–130: ${metrics.sixtyTo130}s`);

  return out.join('\n');
}

/* ------------------------
   AI REVIEW (CSV upload + AI narrative)
------------------------- */
app.post(['/ai-review', '/api/ai-review'], upload.single('log'), async (req, res) => {
  let filePath;
  try {
    if (!req.file) return res.status(400).send('No CSV uploaded.');
    filePath = req.file.path;
    const raw = fs.readFileSync(filePath, 'utf8');
    const metrics = parseCSV(raw);

    const checklist = formatChecklist(metrics);

    // Reduced knock data for AI context
    const reduced = (metrics.knock || [])
      .filter((_, i) => i % 400 === 0)
      .slice(0, 200);

    const messages = buildMessages({
      meta: {},
      observations: checklist + '\n' + JSON.stringify(reduced, null, 2),
    });

    let aiPart = '';
    try {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.3,
        messages,
      });
      aiPart = completion.choices?.[0]?.message?.content?.trim() || '';
    } catch {
      aiPart = 'Model unavailable. Showing checklist only.';
    }

    res.type('text/plain').send(checklist + '\n===SPLIT===\n' + aiPart);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to analyze log.');
  } finally {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

/* ------------------------
   REVIEW-LOG JSON METRICS
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
    if (!correctedTable)
      return res.status(500).send('AI returned empty table.');
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
