// backend/index.js
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { OpenAI } = require('openai');

const runDetail = require('./routes/runDetail');
const submitRunRoutes = require('./routes/submitRun');
const leaderboardRoutes = require('./routes/leaderboard');
const processLog = require('./routes/processLog');
const trainerAI = require('./routes/trainerAI');
const overlayRoutes = require('./routes/overlay');
const { buildMessages } = require('./prompt');
const parseCSV = require('./utils/parseCSV'); // NEW metrics parser

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
   HELPERS
------------------------- */
function formatChecklist(m) {
  const out = [];
  // Knock
  if (m.knockMax > 0) out.push(`⚠️ Knock detected (max ${m.knockMax}°)`);
  else out.push(`✅ No knock detected`);

  // Timing
  if (m.peakTiming) {
    out.push(`✅ Peak timing under WOT: ${m.peakTiming}° @ ${m.peakTimingRPM} RPM`);
  }

  // MAP
  if (m.mapMin != null && m.mapMax != null) {
    out.push(`✅ MAP under WOT: ${m.mapMin} – ${m.mapMax} kPa`);
  }

  // Knock sensors
  if (m.ks1max != null) out.push(`KS1 peak voltage: ${m.ks1max}V`);
  if (m.ks2max != null) out.push(`KS2 peak voltage: ${m.ks2max}V`);

  // Fuel trims
  if (m.avgFT1 != null && m.avgFT2 != null) {
    out.push(`Avg fuel correction: B1 ${m.avgFT1}%, B2 ${m.avgFT2}%`);
    out.push(`Fuel trim variance: ${m.varFT}%`);
  }

  // Oil
  if (m.oilMin != null) out.push(`${m.oilMin < 20 ? '❌' : '✅'} Oil pressure min: ${m.oilMin} psi`);

  // ECT
  if (m.ectMax != null) out.push(`${m.ectMax > 230 ? '⚠️' : '✅'} Coolant temp max: ${m.ectMax}°F`);

  // Misfires
  if (m.misfires && Object.keys(m.misfires).length) {
    Object.entries(m.misfires).forEach(([cyl, count]) => {
      out.push(`${count > 0 ? '❌' : '✅'} Misfires ${cyl}: ${count}`);
    });
  }

  // Accel times
  if (m.zeroTo60) out.push(`🚀 0–60: ${m.zeroTo60}s`);
  if (m.fortyTo100) out.push(`🚀 40–100: ${m.fortyTo100}s`);
  if (m.sixtyTo130) out.push(`🚀 60–130: ${m.sixtyTo130}s`);

  return out.join('\n');
}

/* ------------------------
   REVIEW-LOG (metrics only)
------------------------- */
app.post('/review-log', upload.single('log'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const raw = fs.readFileSync(req.file.path, 'utf8');
    fs.unlinkSync(req.file.path);

    const metrics = parseCSV(raw);
    if (!metrics) return res.status(400).json({ error: 'Parse failed' });

    res.json({ ok: true, metrics });
  } catch (err) {
    console.error('review-log error', err);
    res.status(500).json({ error: 'Failed to process log' });
  }
});

/* ------------------------
   AI REVIEW (full checklist + AI narrative)
------------------------- */
app.post(['/ai-review', '/api/ai-review'], upload.single('log'), async (req, res) => {
  let filePath;
  try {
    if (!req.file) return res.status(400).send('No CSV file uploaded.');
    filePath = req.file.path;
    const raw = fs.readFileSync(filePath, 'utf8');
    fs.unlinkSync(filePath);

    const metrics = parseCSV(raw);
    if (!metrics) return res.status(400).send('Parse failed');

    const checklist = formatChecklist(metrics);

    // AI narrative
    let aiText = '';
    try {
      const reduced = JSON.stringify(metrics.sampled.slice(0, 200), null, 2);
      const messages = buildMessages({
        meta: { vehicle: 'Uploaded CSV' },
        observations: checklist + '\n\nSampled Data:\n' + reduced
      });
      const resp = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 600,
        messages
      });
      aiText = resp.choices?.[0]?.message?.content?.trim() || '';
    } catch (err) {
      console.error('AI error', err);
      aiText = '⚠️ AI unavailable. Showing checklist only.';
    }

    res.type('text/plain').send(checklist + '\n===SPLIT===\n' + aiText);
  } catch (err) {
    console.error('ai-review error', err);
    res.status(500).send('Failed to analyze log.');
  } finally {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

/* ------------------------
   AI TABLE (unchanged)
------------------------- */
app.post(['/ai-table', '/api/ai-table'], async (req, res) => {
  try {
    const { table, vehicleInfo } = req.body || {};
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
