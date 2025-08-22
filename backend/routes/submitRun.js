// backend/routes/submitRun.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

// ✅ Use the shared Supabase client (default export) — normalized to lowercase "lib"
const getSupabase = require('../Lib/supabase');
const supabase = getSupabase();

// ---- Ensure uploads dir exists ----
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const upload = multer({ dest: uploadsDir });

// ---- helpers ----
const toNum = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
};

// parse HPT CSV: headers at index 15, then units, 2 blanks, then data
function parseHPTCsv(raw) {
  const lines = raw.split('\n').map(l => l.trimEnd());
  const after15 = lines.slice(15);
  if (after15.length < 5) throw new Error('CSV incomplete after header row.');

  const headers = (after15[0] || '').split(',').map(h => h.trim());
  const dataRows = after15.slice(4).filter(r => r && r.includes(','));
  if (!headers.length || !dataRows.length) throw new Error('No headers or data rows found.');

  const parsed = dataRows.map(row => {
    const values = row.split(',');
    const obj = {};
    headers.forEach((h, i) => (obj[h] = toNum(values[i])));
    return obj;
  });
  return { headers, rows: parsed };
}

function sampleReduced(rows) {
  // every 400th row -> keep RPM, Airmass, Knock, and Offset for debugging/traceability
  const rpmKey = 'Engine RPM (SAE)';
  const airKey = 'Cylinder Airmass';
  const krKey = 'Total Knock Retard';
  const tKey = 'Offset';

  return rows
    .filter((_, i) => i % 400 === 0)
    .map(r => ({
      rpm: r[rpmKey],
      airmass: r[airKey],
      knock: r[krKey],
      t: r[tKey],
    }))
    .filter(r =>
      Number.isFinite(r.rpm) &&
      Number.isFinite(r.airmass) &&
      Number.isFinite(r.knock) &&
      Number.isFinite(r.t)
    );
}

// small retry wrapper, helps during brief pool hiccups
async function withRetry(fn, tries = 3, delayMs = 250) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { lastErr = e; }
    await new Promise(r => setTimeout(r, delayMs * (i + 1)));
  }
  throw lastErr;
}

// Accepts multipart/form-data:
// - file field: "log" (CSV)
// - text field: "vehicleInfo" (JSON string) OR individual fields below
// Optional leaderboard fields: "interval", "timeSeconds", "vin"
// Optional flat vehicle fields (handy for leaderboard filters):
//   name, year, model, engine, injectors, map, throttle, power, trans, tire, gear, fuel
router.post('/api/submit-run', upload.single('log'), async (req, res) => {
  let filePath;
  try {
    if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded.' });
    filePath = req.file.path;

    // ---- Gather inputs ----
    // A) vehicleInfo JSON (preferred)
    let vehicleInfo = {};
    if (req.body?.vehicleInfo) {
      try {
        vehicleInfo = JSON.parse(req.body.vehicleInfo);
      } catch {
        return res.status(400).json({ error: 'Invalid vehicleInfo JSON.' });
      }
    }

    // B) Allow individual flat fields as fallback/override (useful for simple forms)
    const flat = {
      name: (req.body.name ?? vehicleInfo.name ?? '').toString().trim(),
      year: req.body.year ?? vehicleInfo.year ?? null,
      model: req.body.model ?? vehicleInfo.model ?? null,
      engine: req.body.engine ?? vehicleInfo.engine ?? null,
      injectors: req.body.injectors ?? vehicleInfo.injectors ?? null,
      map: req.body.map ?? vehicleInfo.map ?? null,
      throttle: req.body.throttle ?? vehicleInfo.throttle ?? null,
      power: req.body.power ?? vehicleInfo.power ?? null,
      trans: req.body.trans ?? vehicleInfo.trans ?? null,
      tire: req.body.tire ?? vehicleInfo.tire ?? null,
      gear: req.body.gear ?? vehicleInfo.gear ?? null,
      fuel: req.body.fuel ?? vehicleInfo.fuel ?? null,
      vin: (req.body.vin ?? vehicleInfo.vin ?? '').toString().trim() || null,
    };

    // Leaderboard fields
    const interval = (req.body.interval ?? vehicleInfo.interval ?? '').toString().trim(); // e.g., "0-60", "40-100", "60-130"
    const timeSeconds = toNum(req.body.timeSeconds ?? vehicleInfo.timeSeconds);

    // Consent (for training/retention)
    const consent = String(req.body?.consent || vehicleInfo?.consent || '').toLowerCase() === 'true';

    // ---- Read & parse CSV ----
    const raw = fs.readFileSync(filePath, 'utf8');
    const { rows } = parseHPTCsv(raw);
    const sampled_log = sampleReduced(rows);

    // ---- Optional: upload raw CSV to Supabase Storage (bucket: logs) ----
    let log_path = null;
    try {
      if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        const fileBytes = fs.readFileSync(filePath);
        const unique = crypto.randomUUID();
        const objectPath = `logs/${unique}-${(req.file.originalname || 'log.csv').replace(/\s+/g, '_')}`;

        const { error: upErr } = await supabase.storage
          .from('logs')
          .upload(objectPath, fileBytes, {
            contentType: req.file.mimetype || 'text/csv',
            upsert: false
          });

        if (upErr) {
          console.warn('Storage upload failed:', upErr.message);
        } else {
          log_path = objectPath;
        }
      }
    } catch (e) {
      console.warn('Storage step skipped/failed:', e.message);
    }

    // ---- Build payload for "runs" table ----
    // Keep your existing structure AND add leaderboard-friendly fields.
    const payload = {
      // existing
      user_alias: flat.name || null,
      vehicle_info: vehicleInfo && Object.keys(vehicleInfo).length ? vehicleInfo : null,
      sampled_log,
      consented: consent,
      log_path, // may be null if storage skipped

      // leaderboard-specific
      interval: interval || null,            // e.g., "0-60", "40-100", "60-130"
      time_seconds: timeSeconds ?? null,     // numeric (seconds)
      vin: flat.vin,

      // convenient flat vehicle fields for filtering/sorting
      vehicle_year: flat.year || null,
      vehicle_model: flat.model || null,
      vehicle_engine: flat.engine || null,
      vehicle_injectors: flat.injectors || null,
      vehicle_map: flat.map || null,
      vehicle_throttle: flat.throttle || null,
      vehicle_power: flat.power || null,
      vehicle_trans: flat.trans || null,
      vehicle_tire: flat.tire || null,
      vehicle_gear: flat.gear || null,
      vehicle_fuel: flat.fuel || null,
    };

    // ---- Insert ----
    const { data, error } = await withRetry(() =>
      supabase.from('runs').insert(payload).select('id').single()
    );
    if (error) {
      console.error('Insert error:', error);
      return res.status(502).json({ error: 'Failed to store run.' });
    }

    res.json({
      runId: data.id,
      stored: true,
      leaderboard: !!(interval && Number.isFinite(timeSeconds)),
      trainingQueued: !!consent
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'submit-run failed.' });
  } finally {
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
  }
});

module.exports = router;
