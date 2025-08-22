// backend/routes/overlay.js
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Make sure we have an uploads dir under backend/
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const upload = multer({ dest: uploadsDir });

/** Basic CSV line parser with quote handling */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

/**
 * Parse HP Tuners CSV:
 * - Row 16 (index 15): headers
 * - Row 17 (index 16): units (ignored)
 * - Rows 18–19: blank
 * - Row 20+ (index 19+): data
 * Extracts { t: Offset seconds, v: Vehicle Speed (SAE) mph }
 */
function parseLog(filePath, label) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const headerRowIdx = 15; // row 16
  const dataStartIdx = 19; // row 20+

  const headers = parseCsvLine(lines[headerRowIdx] || '');
  if (!headers.length) throw new Error('CSV headers missing at row 16.');

  let speedIdx = headers.indexOf('Vehicle Speed (SAE)');
  if (speedIdx === -1) speedIdx = headers.findIndex(h => /vehicle\s*speed/i.test(h));

  let timeIdx = headers.indexOf('Offset');
  if (timeIdx === -1) timeIdx = headers.findIndex(h => /offset|time/i.test(h));

  if (speedIdx === -1 || timeIdx === -1) {
    throw new Error(
      `Required columns not found. Need "Vehicle Speed (SAE)" and "Offset". First headers: ${headers.slice(0, 10).join(', ')}`
    );
  }

  const points = [];
  for (let i = dataStartIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cols = parseCsvLine(line);
    const t = parseFloat(cols[timeIdx]);
    const v = parseFloat(cols[speedIdx]);
    if (Number.isFinite(t) && Number.isFinite(v)) points.push({ t, v });
  }

  return { label, points };
}

// POST /api/overlay — accepts FormData with fields log1, log2 (CSV files)
router.post(
  '/api/overlay',
  upload.fields([{ name: 'log1', maxCount: 1 }, { name: 'log2', maxCount: 1 }]),
  async (req, res) => {
    const toDelete = [];
    try {
      const f1 = req.files?.log1?.[0];
      const f2 = req.files?.log2?.[0];

      if (!f1 && !f2) {
        return res.status(400).json({ error: 'No logs uploaded. Provide log1 and/or log2.' });
      }
      if (f1) toDelete.push(f1.path);
      if (f2) toDelete.push(f2.path);

      const series = [];
      if (f1) series.push(parseLog(f1.path, f1.originalname || 'Run 1'));
      if (f2) series.push(parseLog(f2.path, f2.originalname || 'Run 2'));

      // Markers can be added later (e.g., best 60–130 window)
      return res.json({ ok: true, series, markers: [] });
    } catch (err) {
      console.error('Overlay processing error:', err);
      return res.status(500).json({
        error: 'Overlay processing failed',
        detail: String(err?.message || err),
      });
    } finally {
      // cleanup temp uploads
      for (const p of toDelete) {
        try { fs.unlinkSync(p); } catch {}
      }
    }
  }
);

module.exports = router;
