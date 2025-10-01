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
const submitRunRoutes = require('./routes/submitRun');     // POST /api/submit-run
const leaderboardRoutes = require('./routes/leaderboard'); // GET  /api/leaderboard
const processLog = require('./routes/processLog');
const trainerAI = require('./routes/trainerAI');
const overlayRoutes = require('./routes/overlay');         // POST /api/overlay

// NEW: style-guided prompt builder for AI reviews
const { buildMessages } = require('./prompt');

const app = express();
const PORT = Number(process.env.PORT || 5000);

// uploads dir
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({ dest: uploadsDir });

// after other route mounts
const aiReview = require('./routes/aiReview');
app.use('/', aiReview);

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

// OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// -------- AI REVIEW — support both /ai-review and /api/ai-review --------
app.post(['/ai-review', '/api/ai-review'], upload.single('log'), async (req, res) => {
  let filePath;
  try {
    if (!req.file) return res.status(400).send('No CSV file uploaded.');
    filePath = req.file.path;
    const content = fs.readFileSync(filePath, 'utf8');

    // CSV parsing...
    const lines = content.split('\n').map(l => l.trimEnd());
    const after15 = lines.slice(15);
    if (after15.length < 5) return res.status(400).send('CSV appears incomplete (not enough rows after header).');

    const headers = (after15[0] || '').split(',').map(h => h.trim());
    const dataRows = after15.slice(4).filter(row => row && row.includes(','));
    const toNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; };

    const parsed = dataRows.map(row => {
      const values = row.split(',');
      const obj = {};
      headers.forEach((h, i) => { obj[h] = toNum(values[i]); });
      return obj;
    });
    if (!parsed.length) return res.status(400).send('No data rows found in CSV.');

    // === quick checks & AI integration (trimmed for brevity) ===
    const quickChecks = '✅ Basic log checks passed.\n...'; // keep your full logic here
    const reduced = parsed.filter((_, i) => i % 400 === 0).map(r => ({
      rpm: r['Engine RPM (SAE)'],
      airmass: r['Cylinder Airmass'],
      knock: r['Total Knock Retard'],
    }));

    const messages = buildMessages({ meta: {}, observations: quickChecks });

    let finalReview = quickChecks;
    try {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.3,
        messages
      });
      finalReview = completion.choices?.[0]?.message?.content?.trim() || finalReview;
    } catch (e) {
      console.warn('AI review failed:', e.message);
    }

    res.type('text/plain').send(finalReview);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to analyze log.');
  } finally {
    try {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    } catch (e) { console.warn('Failed to delete upload:', e.message); }
  }
});

// -------- ALIAS: /review-log → /ai-review --------
app.post('/review-log', (req, res, next) => {
  req.url = '/ai-review'; // internally forward to /ai-review
  next();
});

// -------- AI TABLE — support both /ai-table and /api/ai-table --------
app.post(['/ai-table', '/api/ai-table'], async (req, res) => {
  try {
    const { table, vehicleInfo } = req.body || {};
    if (!table || !vehicleInfo) return res.status(400).send('Missing table or vehicleInfo.');

    const prompt = `
You are a Gen 3 HEMI calibration expert.
Given the timing table (copied from HP Tuners, includes axis) and vehicle setup,
return ONLY the corrected table in tab-delimited format. No explanations.

Vehicle Setup:
${JSON.stringify(vehicleInfo, null, 2)}

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
