// backend/routes/sparkAdvisor.js
// ============================================================
// WOT Spark Table Advisor
// Takes: current spark table (CSV) + rpmAirBins from log analysis
// Returns: adjusted table CSV + cell-by-cell explanation
// ============================================================
const express = require('express');
const router  = express.Router();
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Safety limits ──────────────────────────────────────────
const MAX_REDUCTION_PER_PASS = 3.0;  // never pull more than 3° in one pass
const MAX_ADDITION_PER_PASS  = 1.0;  // never add more than 1° in one pass
const KR_MINOR_THRESHOLD     = 1.5;  // degrees — reduce lightly
const KR_MODERATE_THRESHOLD  = 3.5;  // degrees — reduce moderately
const KR_SEVERE_THRESHOLD    = 6.0;  // degrees — reduce aggressively

// ── Canonical Gen 3 Hemi WOT Spark Table axes (17x17) ────
const CANONICAL_RPM = [512, 672, 896, 1056, 1248, 1536, 1856, 2176, 2624, 3072, 3648, 4224, 4800, 5280, 5792, 6112, 7008];
const CANONICAL_AIR = [0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.675, 0.70, 0.725, 0.75, 0.80, 0.825, 0.85, 0.90, 0.95, 1.00];

// ── Parse HP Tuners "Copy with Axis" format ───────────────
// Format:
//   °  <tab> 512 <tab> 672 ... <tab> rpm   (header row)
//   0.35 <tab> 13.5 <tab> 14 ...           (data rows)
//   g                                       (optional last row)
//
// Also handles plain CSV and tab-delimited without axis labels.
function parseSparkTable(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const lines = raw.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  // Detect delimiter: prefer tab (HP Tuners default), fall back to comma
  const delim = lines[0].includes('\t') ? '\t' : ',';

  // ── Header row ──
  const headerCells = lines[0].split(delim).map(c => c.trim());

  // Strip leading axis label (°, empty, or any non-numeric)
  // Strip trailing axis label ('rpm' or any non-numeric at end)
  const rpmValues = headerCells
    .filter(c => Number.isFinite(parseFloat(c)))
    .map(c => parseFloat(c));

  if (!rpmValues.length) return null;

  // ── Data rows ──
  // Skip the last row if it's just 'g' (airmass unit label from HP Tuners)
  const dataLines = lines.slice(1).filter(l => {
    const trimmed = l.trim().toLowerCase();
    return trimmed !== 'g' && trimmed !== '' && Number.isFinite(parseFloat(l.split(delim)[0]));
  });

  const rows = [];
  for (const line of dataLines) {
    const cells = line.split(delim).map(c => c.trim());
    const airmass = parseFloat(cells[0]);
    if (!Number.isFinite(airmass)) continue;

    // Collect numeric values after the airmass column
    const values = cells.slice(1)
      .filter(c => Number.isFinite(parseFloat(c)))
      .map(c => parseFloat(c));

    // Allow rows that match rpmValues length (trim extras if HP Tuners adds trailing label)
    if (values.length >= rpmValues.length) {
      rows.push({ airmass, values: values.slice(0, rpmValues.length) });
    } else if (values.length > 0) {
      // Pad with last value if slightly short (edge case)
      while (values.length < rpmValues.length) values.push(values[values.length - 1]);
      rows.push({ airmass, values });
    }
  }

  if (!rows.length) return null;

  // Sort by airmass ascending
  rows.sort((a, b) => a.airmass - b.airmass);

  const warnings = [];
  if (rpmValues.length !== 17) warnings.push(`Expected 17 RPM columns, got ${rpmValues.length}. Use "Copy with Axis" in HP Tuners.`);
  if (rows.length !== 17)      warnings.push(`Expected 17 airmass rows, got ${rows.length}.`);

  return { rpmValues, rows, warnings };
}

// ── Find closest bin match ─────────────────────────────────
function findClosestBin(rpmAirBins, targetRpm, targetAir) {
  if (!rpmAirBins || !rpmAirBins.length) return null;
  let best = null, bestDist = Infinity;
  for (const bin of rpmAirBins) {
    // Bins use index-based system — convert to approximate values
    // rpmBins: [800,1200,1600,2000,2400,2800,3200,3600,4000,4400,4800,5200,5600,6000,6400,6800]
    // airBins: [0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75]
    const rpmBins = [800,1200,1600,2000,2400,2800,3200,3600,4000,4400,4800,5200,5600,6000,6400,6800];
    const airBins = [0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75];
    const binRpm = rpmBins[Math.min(bin.rpmBin, rpmBins.length - 1)] || targetRpm;
    const binAir = airBins[Math.min(bin.airBin, airBins.length - 1)] || targetAir;
    const dist = Math.abs(binRpm - targetRpm) / 1000 + Math.abs(binAir - targetAir) * 10;
    if (dist < bestDist) { bestDist = dist; best = { ...bin, approxRpm: binRpm, approxAir: binAir }; }
  }
  return bestDist < 3 ? best : null; // only use if reasonably close
}

// ── Core adjustment logic ──────────────────────────────────
function computeAdjustments(table, rpmAirBins) {
  const adjustments = [];
  const adjustedRows = table.rows.map(row => ({ ...row, values: [...row.values] }));

  for (let ri = 0; ri < table.rows.length; ri++) {
    const row = table.rows[ri];
    for (let ci = 0; ci < table.rpmValues.length; ci++) {
      const rpm     = table.rpmValues[ci];
      const airmass = row.airmass;
      const current = row.values[ci];
      if (!Number.isFinite(current)) continue;

      const match = findClosestBin(rpmAirBins, rpm, airmass);

      let delta     = 0;
      let reason    = 'No log data for this cell — no change.';
      let severity  = 'none';

      if (match && match.samples >= 5) {
        const kr = match.krMax || 0;

        if (kr <= 0) {
          // No knock — consider small timing addition if spark is well below max safe
          if (current < 28 && match.iatAvg && match.iatAvg < 130) {
            delta  = Math.min(MAX_ADDITION_PER_PASS, 0.5);
            reason = `No knock detected (${match.samples} samples). IAT is ${match.iatAvg?.toFixed(0)}°F. Minor timing addition possible.`;
            severity = 'add';
          } else {
            reason = `No knock (${match.samples} samples). Timing looks good — no change needed.`;
            severity = 'ok';
          }
        } else if (kr > 0 && kr <= KR_MINOR_THRESHOLD) {
          delta    = -Math.min(MAX_REDUCTION_PER_PASS, parseFloat((kr * 1.5).toFixed(1)));
          reason   = `Minor knock detected: ${kr.toFixed(1)}° KR at ~${match.approxRpm} RPM / ${match.approxAir}g airmass. Reducing timing slightly.`;
          severity = 'minor';
        } else if (kr <= KR_MODERATE_THRESHOLD) {
          delta    = -Math.min(MAX_REDUCTION_PER_PASS, parseFloat((kr * 1.8).toFixed(1)));
          reason   = `Moderate knock: ${kr.toFixed(1)}° KR at ~${match.approxRpm} RPM / ${match.approxAir}g airmass. Meaningful timing reduction recommended.`;
          severity = 'moderate';
        } else if (kr <= KR_SEVERE_THRESHOLD) {
          delta    = -MAX_REDUCTION_PER_PASS;
          reason   = `Significant knock: ${kr.toFixed(1)}° KR at ~${match.approxRpm} RPM / ${match.approxAir}g airmass. Maximum single-pass reduction applied.`;
          severity = 'severe';
        } else {
          delta    = -MAX_REDUCTION_PER_PASS;
          reason   = `⚠️ SEVERE knock: ${kr.toFixed(1)}° KR at ~${match.approxRpm} RPM / ${match.approxAir}g airmass. Maximum reduction applied — further investigation needed.`;
          severity = 'critical';
        }
      }

      // Clamp: never go below 0° or above current + MAX_ADDITION
      const newValue = Math.max(0, Math.min(current + MAX_ADDITION_PER_PASS, current + delta));
      adjustedRows[ri].values[ci] = parseFloat(newValue.toFixed(1));

      if (delta !== 0 || severity === 'ok' || severity === 'add') {
        adjustments.push({
          rpm, airmass, current: parseFloat(current.toFixed(1)),
          adjusted: parseFloat(newValue.toFixed(1)),
          delta: parseFloat(delta.toFixed(1)),
          reason, severity,
          samples: match?.samples || 0,
          krMax: match?.krMax || 0,
        });
      }
    }
  }

  return { adjustedRows, adjustments };
}

// ── "Copy with Axis" format — includes headers, for saving/reference ──
function buildCopyWithAxis(table, adjustedRows) {
  const header   = ['°', ...table.rpmValues, 'rpm'].join('\t');
  const dataRows = adjustedRows.map(row =>
    [row.airmass, ...row.values.map(v => Number.isFinite(v) ? v.toFixed(1) : '')].join('\t')
  );
  return [header, ...dataRows, 'g'].join('\n');
}

// ── "Paste Ready" format — VALUES ONLY, no headers ──────────
// Select all 17x17 cells in HP Tuners then paste this directly.
// Tab-delimited, 17 columns x 17 rows, 1 decimal place.
// DO NOT include axis labels — HP Tuners will reject the paste.
function buildPasteReady(table, adjustedRows) {
  // Enforce exactly 17 RPM cols x 17 airmass rows
  const rows = adjustedRows.slice(0, 17).map(row =>
    row.values.slice(0, 17).map(v => Number.isFinite(v) ? v.toFixed(1) : '0.0').join('\t')
  );
  // Pad to 17 rows if needed (shouldn't happen but safety net)
  while (rows.length < 17) rows.push(Array(17).fill('0.0').join('\t'));
  return rows.join('\n');
}

// ── AI narrative summary ───────────────────────────────────
async function buildAINarrative(adjustments, meta) {
  const criticalCells = adjustments.filter(a => a.severity === 'critical' || a.severity === 'severe');
  const moderateCells = adjustments.filter(a => a.severity === 'moderate');
  const addCells      = adjustments.filter(a => a.severity === 'add');
  const okCells       = adjustments.filter(a => a.severity === 'ok');

  const summary = [
    `Vehicle: ${meta?.year || ''} ${meta?.model || ''} ${meta?.engine || ''} — ${meta?.fuel || ''} — ${meta?.power || ''}`,
    `Total cells analyzed: ${adjustments.length}`,
    `Critical/Severe knock cells: ${criticalCells.length}`,
    `Moderate knock cells: ${moderateCells.length}`,
    `Cells with timing addition potential: ${addCells.length}`,
    `Cells with no change needed: ${okCells.length}`,
    '',
    'Notable issues:',
    ...criticalCells.map(a => `- ${a.reason}`),
    ...moderateCells.slice(0, 5).map(a => `- ${a.reason}`),
  ].join('\n');

  const prompt = `You are Satera Tuning reviewing a WOT spark table adjustment recommendation.

${summary}

Write a brief tuner's assessment (3-5 sentences) of these spark table changes. Be specific about which RPM/load areas need attention. Use plain English — this is for a professional tuner reviewing the AI's work. Do NOT suggest the table is ready to flash — always recommend the tuner reviews each cell before applying. Do NOT blame the tune.`;

  try {
    const res = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
    });
    return res.choices?.[0]?.message?.content?.trim() || '';
  } catch {
    return 'AI narrative unavailable — review the cell-by-cell adjustments below.';
  }
}

// ── Route ──────────────────────────────────────────────────
router.post('/api/spark-advisor', express.json({ limit: '5mb' }), async (req, res) => {
  try {
    const { tableText, rpmAirBins, meta } = req.body || {};

    if (!tableText || typeof tableText !== 'string') {
      return res.status(400).json({ ok: false, error: 'tableText is required — paste your WOT spark table.' });
    }

    const table = parseSparkTable(tableText);
    if (!table) {
      return res.status(400).json({ ok: false, error: 'Could not parse the spark table. Make sure it is in CSV or tab-delimited format with RPM columns and airmass rows.' });
    }

    if (!rpmAirBins || !Array.isArray(rpmAirBins) || !rpmAirBins.length) {
      return res.status(400).json({ ok: false, error: 'No log data (rpmAirBins) provided. Run a log analysis first.' });
    }

    // Compute adjustments
    const { adjustedRows, adjustments } = computeAdjustments(table, rpmAirBins);

    // Build both output formats
    const adjustedCopyWithAxis = buildCopyWithAxis(table, adjustedRows);
    const originalCopyWithAxis = buildCopyWithAxis(table, table.rows);
    const adjustedPasteReady   = buildPasteReady(table, adjustedRows);
    const originalPasteReady   = buildPasteReady(table, table.rows);
    // Warn if not 17x17
    const parseWarnings = table.warnings || [];

    // AI narrative
    const narrative = await buildAINarrative(adjustments, meta);

    // Stats summary
    const stats = {
      totalCells:    adjustments.length,
      critical:      adjustments.filter(a => a.severity === 'critical').length,
      severe:        adjustments.filter(a => a.severity === 'severe').length,
      moderate:      adjustments.filter(a => a.severity === 'moderate').length,
      minor:         adjustments.filter(a => a.severity === 'minor').length,
      additions:     adjustments.filter(a => a.severity === 'add').length,
      noChange:      adjustments.filter(a => a.severity === 'ok' || a.severity === 'none').length,
      maxKrFound:    Math.max(0, ...adjustments.map(a => a.krMax || 0)),
      maxReduction:  Math.min(0, ...adjustments.map(a => a.delta)),
    };

    return res.json({
      ok: true,
      narrative,
      stats,
      adjustments,
      warnings: parseWarnings,
      // "Copy with Axis" format — includes headers, use for saving/reference
      originalCopyWithAxis,
      adjustedCopyWithAxis,
      // "Paste Ready" format — values only, select 17x17 cells in HP Tuners then paste
      originalPasteReady,
      adjustedPasteReady,
      tableShape: {
        rows: table.rows.length,
        cols: table.rpmValues.length,
        rpmValues: table.rpmValues,
        airmassValues: table.rows.map(r => r.airmass),
        is17x17: table.rows.length === 17 && table.rpmValues.length === 17,
      },
    });

  } catch (err) {
    console.error('spark-advisor error:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Spark advisor failed.' });
  }
});

module.exports = router;
