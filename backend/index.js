// backend/index.js
require('dotenv').config();

// DEBUG: confirm we loaded the Service Role key and that it is a service token
const dumpRole = (k) => {
  try {
    const [h, p] = String(k || '').split('.');
    const payload = JSON.parse(Buffer.from((p || ''), 'base64url').toString('utf8'));
    return { len: (k || '').length, role: payload?.role };
  } catch { return { len: (k || '').length, role: 'unknown' }; }
};
console.log('SR check:', dumpRole(process.env.SUPABASE_SERVICE_ROLE_KEY));

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { OpenAI } = require('openai');

// Route modules
const runDetail = require('./routes/runDetail');
const submitRunRoutes = require('./routes/submitRun');     // exposes POST /api/submit-run
const leaderboardRoutes = require('./routes/leaderboard'); // exposes GET  /api/leaderboard
const processLog = require('./routes/processLog');
const trainerAI = require('./routes/trainerAI');
const overlayRoutes = require('./routes/overlay');         // POST /api/overlay

const app = express();
const port = 5000;

// ===== Ensure uploads directory exists =====
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const upload = multer({ dest: uploadsDir });

// ===== Core middleware BEFORE routes =====
app.use(cors());
app.use(express.json());
app.use(require('./routes/feedback'));

app.use('/', runDetail);

// ===== Health check =====
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, service: 'Satera API', time: new Date().toISOString() });
});

// ===== Mount route modules =====
app.use('/', leaderboardRoutes); // GET  /api/leaderboard
app.use('/', submitRunRoutes);   // POST /api/submit-run
app.use('/', processLog);
app.use('/', trainerAI);
app.use('/', overlayRoutes);     // POST /api/overlay (always JSON)

// ===== OpenAI client =====
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// =====================================================================
// /ai-review  (returns "non-AI review text ===SPLIT=== AI text")
// =====================================================================
app.post('/ai-review', upload.single('log'), async (req, res) => {
  let filePath;
  try {
    if (!req.file) {
      return res.status(400).send('No CSV file uploaded.');
    }
    filePath = req.file.path;

    const content = fs.readFileSync(filePath, 'utf8');

    // Confirmed CSV structure:
    // Row 16 (index 15) headers
    // Row 17 (index 16) units
    // Row 18–19 (index 17–18) blank
    // Row 20+ (index 19+) data
    const lines = content.split('\n').map(l => l.trimEnd());
    const after15 = lines.slice(15);
    if (after15.length < 5) {
      return res.status(400).send('CSV appears incomplete (not enough rows after header).');
    }

    const headers = (after15[0] || '').split(',').map(h => h.trim());
    // Skip the next 3 rows (units + 2 blanks) → start at index 4
    const dataRows = after15.slice(4).filter(row => row && row.includes(','));

    const toNum = (v) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : undefined;
    };

    const parsed = dataRows.map(row => {
      const values = row.split(',');
      const obj = {};
      headers.forEach((h, i) => { obj[h] = toNum(values[i]); });
      return obj;
    });

    if (!parsed.length) {
      return res.status(400).send('No data rows found in CSV.');
    }

    // === Column helpers (define ONCE) ===
    const hasCol = (name) => headers.includes(name);
    const getColumn = (name) => {
      if (!hasCol(name)) return [];
      return parsed.map(r => r[name]).filter(v => Number.isFinite(v));
    };

    const safeMax = (arr) => (arr.length ? Math.max(...arr) : undefined);
    const safeMin = (arr) => (arr.length ? Math.min(...arr) : undefined);

    const result = [];

    // ======== NON-AI LOG REVIEW ========
    // Knock summary
    const knockValues = getColumn('Total Knock Retard').map(v => Math.abs(v));
    const peakKnock = safeMax(knockValues);
    if (peakKnock !== undefined) {
      result.push(peakKnock > 0 ? `⚠️ Knock detected: up to ${peakKnock.toFixed(1)}°` : '✅ No knock detected.');
    } else {
      result.push('ℹ️ Knock column not found.');
    }

    // WOT-based checks
    const accelCol = getColumn('Accelerator Position D (SAE)');
    let wotRows = [];
    if (accelCol.length) {
      wotRows = parsed.filter(r => Number.isFinite(r['Accelerator Position D (SAE)']) && r['Accelerator Position D (SAE)'] > 86);
    }

    const timingColName = 'Timing Advance (SAE)';
    const rpmColName = 'Engine RPM (SAE)';
    const mapColName = 'Intake Manifold Absolute Pressure (SAE)';

    if (wotRows.length) {
      // Peak timing under WOT
      const peakTimingRow = wotRows.reduce((best, r) => {
        const curr = r[timingColName] ?? -Infinity;
        const prev = best[timingColName] ?? -Infinity;
        return curr > prev ? r : best;
      }, wotRows[0]);

      const peakTiming = peakTimingRow[timingColName];
      const rpmAtPeak = peakTimingRow[rpmColName];

      if (Number.isFinite(peakTiming) && Number.isFinite(rpmAtPeak)) {
        result.push(`📈 Peak timing under WOT: ${peakTiming.toFixed(1)}° @ ${rpmAtPeak.toFixed(0)} RPM`);
      } else {
        result.push('ℹ️ Could not determine peak timing @ RPM under WOT.');
      }

      // MAP under WOT
      const mapWOT = wotRows.map(r => r[mapColName]).filter(Number.isFinite);
      if (mapWOT.length) {
        result.push(`🌡 MAP under WOT: ${safeMin(mapWOT).toFixed(1)} – ${safeMax(mapWOT).toFixed(1)} kPa`);
      } else {
        result.push('ℹ️ MAP data under WOT not found.');
      }
    } else {
      result.push('ℹ️ No WOT conditions found.');
    }

    // Knock sensor volts
    ['Knock Sensor 1', 'Knock Sensor 2'].forEach(sensor => {
      const volts = getColumn(sensor);
      if (!volts.length) {
        result.push(`ℹ️ ${sensor} not found.`);
        return;
      }
      const peak = safeMax(volts);
      if (peak !== undefined) {
        result.push(peak > 3.0
          ? `⚠️ ${sensor} exceeded 3.0V threshold (Peak: ${peak.toFixed(2)}V)`
          : `✅ ${sensor} within safe range (Peak: ${peak.toFixed(2)}V)`);
      }
    });

    // Fuel trim variance > 10%
    const lt1 = getColumn('Long Term Fuel Trim Bank 1 (SAE)');
    const lt2 = getColumn('Long Term Fuel Trim Bank 2 (SAE)');
    if (lt1.length && lt2.length) {
      const variance = lt1.map((v, i) =>
        (Number.isFinite(v) && Number.isFinite(lt2[i])) ? Math.abs(v - lt2[i]) : undefined
      ).filter(Number.isFinite);
      const tooHigh = variance.some(v => v > 10);
      result.push(tooHigh ? '⚠️ Fuel trim variance > 10% between banks' : '✅ Fuel trim variance within 10%');
    } else {
      result.push('ℹ️ One or both LTFT columns missing; variance check skipped.');
    }

    // Avg fuel correction per bank (STFT + LTFT)
    const st1 = getColumn('Short Term Fuel Trim Bank 1 (SAE)');
    const st2 = getColumn('Short Term Fuel Trim Bank 2 (SAE)');
    const avg = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : undefined;

    if (st1.length && lt1.length) {
      const combo1 = st1.map((v, i) => (Number.isFinite(v) ? v : 0) + (Number.isFinite(lt1[i]) ? lt1[i] : 0)).filter(Number.isFinite);
      const avg1 = avg(combo1);
      if (avg1 !== undefined) result.push(`📊 Avg fuel correction (Bank 1): ${avg1.toFixed(1)}%`);
    } else {
      result.push('ℹ️ Could not compute avg fuel correction (Bank 1).');
    }

    if (st2.length && lt2.length) {
      const combo2 = st2.map((v, i) => (Number.isFinite(v) ? v : 0) + (Number.isFinite(lt2[i]) ? lt2[i] : 0)).filter(Number.isFinite);
      const avg2 = avg(combo2);
      if (avg2 !== undefined) result.push(`📊 Avg fuel correction (Bank 2): ${avg2.toFixed(1)}%`);
    } else {
      result.push('ℹ️ Could not compute avg fuel correction (Bank 2).');
    }

    // Oil pressure (RPM > 500) < 20 psi
    const rpmCol = getColumn(rpmColName);
    const oilCol = getColumn('Engine Oil Pressure');
    if (rpmCol.length && oilCol.length) {
      const oilRows = parsed.filter(r => Number.isFinite(r[rpmColName]) && r[rpmColName] > 500);
      const oilLow = oilRows.some(r => Number.isFinite(r['Engine Oil Pressure']) && r['Engine Oil Pressure'] < 20);
      result.push(oilLow ? '⚠️ Oil pressure dropped below 20 psi.' : '✅ Oil pressure within safe range.');
    } else {
      result.push('ℹ️ Oil pressure or RPM column missing; check skipped.');
    }

    // ECT > 230F
    const ect = getColumn('Engine Coolant Temp (SAE)');
    if (ect.length) {
      result.push(ect.some(v => v > 230) ? '⚠️ Coolant temp exceeded 230°F.' : '✅ Coolant temp within safe limits.');
    } else {
      result.push('ℹ️ Coolant temp column missing.');
    }

    // Misfires per cylinder
    const misfireReport = [];
    const firstRow = parsed[0] || {};
    Object.keys(firstRow).forEach(key => {
      if (key.includes('Misfire Current Cylinder')) {
        const cyl = key.split('#')[1] || '?';
        const values = getColumn(key);
        if (values.length) {
          let count = 0;
          for (let i = 1; i < values.length; i++) {
            const diff = values[i] - values[i - 1];
            if (Number.isFinite(diff) && diff > 0 && diff < 1000) count += diff;
          }
          if (count > 0) misfireReport.push(`- Cylinder ${cyl}: ${count} misfires`);
        }
      }
    });
    if (misfireReport.length) {
      result.push(`🚨 Misfires detected:\n${misfireReport.join('\n')}`);
    } else {
      result.push('✅ No misfires detected.');
    }

    // ===== Speed interval analysis =====
    const speed = getColumn('Vehicle Speed (SAE)');
    const time = getColumn('Offset');

    const findAllIntervals = (start, end) => {
      const times = [];
      let startTime = null;
      for (let i = 0; i < speed.length; i++) {
        const s = speed[i];
        if (!Number.isFinite(s) || !Number.isFinite(time[i])) continue;
        if (startTime === null && s >= start && s < end) startTime = time[i];
        if (startTime !== null && s >= end) {
          times.push((time[i] - startTime).toFixed(2));
          startTime = null;
        }
        if (startTime !== null && s > end + 10) startTime = null;
      }
      return times;
    };

    const findAllZeroToSixty = () => {
      const times = [];
      let foundStop = false;
      let startTime = null;
      for (let i = 1; i < speed.length; i++) {
        const s = speed[i], t = time[i];
        if (!Number.isFinite(s) || !Number.isFinite(t)) continue;
        if (!foundStop && s < 1.5) foundStop = true;
        if (foundStop && startTime === null && s > 1.5) startTime = t;
        if (startTime !== null && s >= 60) {
          times.push((t - startTime).toFixed(2));
          startTime = null;
          foundStop = false;
        }
      }
      return times;
    };

    const runs0060 = findAllZeroToSixty();
    const runs40100 = findAllIntervals(40, 100);
    const runs60130 = findAllIntervals(60, 130);

    const best = (arr) => (arr.length ? Math.min(...arr.map(Number)).toFixed(2) : null);
    const best0060 = best(runs0060);
    const best40100 = best(runs40100);
    const best60130 = best(runs60130);

    if (best0060) result.push(`🚦 Best 0–60 mph: ${best0060}s`);
    if (best40100) result.push(`🚀 Best 40–100 mph: ${best40100}s`);
    if (best60130) result.push(`🚀 Best 60–130 mph: ${best60130}s`);

    // ===== AI summary (reduced payload) =====
    const reduced = parsed
      .filter((_, i) => i % 400 === 0)
      .map(row => ({
        rpm: row[rpmColName],
        airmass: row['Cylinder Airmass'],
        knock: row['Total Knock Retard']
      }))
      .filter(r => Number.isFinite(r.rpm) && Number.isFinite(r.airmass) && Number.isFinite(r.knock));

    const userPrompt =
      `You are a Gen 3 HEMI tuning assistant. Based on the table below (RPM, airmass, and knock), ` +
      `summarize where timing should be reduced. Only reduce timing where knock is detected. ` +
      `Return a concise, actionable summary with RPM ranges and approximate deltas.\n\n` +
      `${JSON.stringify(reduced, null, 2)}`;

    let aiOutput = 'AI summary unavailable.';
    try {
      const aiResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.3
      });
      aiOutput = aiResponse?.choices?.[0]?.message?.content?.trim() || aiOutput;
    } catch (e) {
      console.warn('AI summary failed:', e.message);
    }

    res.send(`${result.join('\n')}===SPLIT===${aiOutput}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to analyze log.');
  } finally {
    try {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    } catch (e) {
      console.warn('Failed to delete upload:', e.message);
    }
  }
});

// =====================================================================
// /ai-table  (returns ONLY the corrected table text)
// =====================================================================
app.post('/ai-table', async (req, res) => {
  try {
    const { table, vehicleInfo } = req.body || {};
    if (!table || !vehicleInfo) {
      return res.status(400).send('Missing table or vehicleInfo.');
    }

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
      temperature: 0.2
    });

    const correctedTable = (aiResponse.choices?.[0]?.message?.content || '').trim();
    if (!correctedTable) {
      return res.status(500).send('AI returned empty table.');
    }
    res.send(correctedTable);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to generate updated table.');
  }
});

// =====================================================================
// JSON 404 guard for unknown /api/* routes (prevents HTML responses)
// =====================================================================
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// =====================================================================
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
