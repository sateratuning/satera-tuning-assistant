// backend/utils/httParser.js
// ============================================================
// HP Tuners .htt Template File Parser & Splicer
// Safely extracts tune tables, sends to AI, splices back.
// Binary sections are NEVER touched — only numeric data rows.
// ============================================================

const { OpenAI } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Table identification patterns ─────────────────────────
// Each table is identified by its characteristic header line
// The binary marker before the header is unique but we find
// tables by the readable axis values that follow

const TABLE_SIGNATURES = {
  wot_spark: {
    name: 'WOT Spark Table',
    // Header contains ° and RPM axis values 640-6208 with airmass rows 0.15-1.5
    headerPattern: /Â°\t\d+\t\d+.*\trpm/,
    rowPattern: /^(0\.\d+|1\.\d+|[12]\.\d*)\t/,   // airmass rows 0.xx to 1.5
    valueRange: [-10, 55],
    unit: '°',
    description: 'WOT Spark Advance (degrees vs airmass/rpm)',
  },
  ve: {
    name: 'VE Table',
    // Header contains mg and RPM axis values, rows are airmass in mg (150-1500)
    headerPattern: /mg.*Â°\t\d+\t\d+.*\trpm/,
    rowPattern: /^(\d{2,4}\.?\d*)\t/,              // airmass rows 150-1500 mg
    valueRange: [80, 160],
    unit: '%',
    description: 'Volumetric Efficiency (% vs airmass/rpm)',
  },
};

// ── Parse HTT file ────────────────────────────────────────
function parseHTT(buffer) {
  const text = buffer.toString('latin1');
  const lines = text.split('\n');

  const result = {
    raw: buffer,
    text,
    lines,
    tables: {},
  };

  // Find WOT Spark table
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // WOT Spark: header has ° + RPM cols, followed by airmass rows with degree values
    if (TABLE_SIGNATURES.wot_spark.headerPattern.test(line)) {
      const rows = extractDataRows(lines, i + 1, TABLE_SIGNATURES.wot_spark);
      if (rows.length >= 5) {
        // Verify values look like timing (not VE or other)
        const allVals = rows.flatMap(r => r.numericValues);
        const max = Math.max(...allVals);
        const min = Math.min(...allVals);
        if (max <= 55 && min >= -10) {
          if (!result.tables.wot_spark) {
            result.tables.wot_spark = {
              headerLine: i,
              headerText: line,
              rows,
              colHeaders: extractColHeaders(line),
              sig: TABLE_SIGNATURES.wot_spark,
            };
          }
        }
      }
    }

    // VE Table: mg header + ° axis, airmass rows in mg range
    if (TABLE_SIGNATURES.ve.headerPattern.test(line)) {
      const rows = extractDataRows(lines, i + 1, TABLE_SIGNATURES.ve);
      if (rows.length >= 5) {
        const allVals = rows.flatMap(r => r.numericValues);
        const max = Math.max(...allVals);
        if (max >= 100 && max <= 160) {
          if (!result.tables.ve) {
            result.tables.ve = {
              headerLine: i,
              headerText: line,
              rows,
              colHeaders: extractColHeaders(line),
              sig: TABLE_SIGNATURES.ve,
            };
          }
        }
      }
    }
  }

  return result;
}

function extractColHeaders(headerLine) {
  const parts = headerLine.trim().split('\t');
  const nums = parts.filter(p => /^[\d.]+$/.test(p.trim())).map(Number);
  return nums;
}

function extractDataRows(lines, startIdx, sig) {
  const rows = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.trim();

    if (!sig.rowPattern.test(stripped)) break;

    const parts = stripped.split('\t');
    const rowHeader = parts[0];
    const rawValues = parts.slice(1).filter(v => v.trim() !== '');

    const numericValues = [];
    for (const v of rawValues) {
      const n = parseFloat(v);
      if (!isFinite(n)) break;
      numericValues.push(n);
    }

    if (numericValues.length >= 2) {
      rows.push({
        lineIndex: i,
        rawLine: lines[i],
        rowHeader,
        rawValues,
        numericValues,
        trailingCR: lines[i].includes('\r'),
      });
    }
  }
  return rows;
}

// ── Format table for AI ───────────────────────────────────
function tableToText(table) {
  if (!table) return 'NOT_FOUND';
  const colHeaderStr = table.colHeaders.join('\t');
  const header = `${table.sig.unit}\t${colHeaderStr}\trpm`;
  const rows = table.rows.map(r =>
    `${r.rowHeader}\t${r.numericValues.join('\t')}`
  );
  return [header, ...rows].join('\n');
}

// ── AI Table Revision ─────────────────────────────────────
async function generateHTTRevision({ vehicle, parsed, checklist, triggerReason, revisionNum }) {
  const isNA = !vehicle.power_adder ||
    String(vehicle.power_adder).toLowerCase().includes('n/a') ||
    String(vehicle.power_adder).toLowerCase().includes('naturally');

  const vehicleStr = `${vehicle.year} ${vehicle.make || 'Dodge'} ${vehicle.model}
Engine: ${vehicle.engine} | Fuel: ${vehicle.fuel} | Power: ${isNA ? 'Naturally Aspirated' : vehicle.power_adder}
Injectors: ${vehicle.injectors || 'Stock'} | Cam: ${vehicle.cam || 'Stock'}
Throttle Body: ${vehicle.throttle_body || 'Stock'} | MAP Sensor: ${vehicle.map_sensor || 'Stock'}`;

  const wotSparkText = tableToText(parsed.tables.wot_spark);
  const veText = tableToText(parsed.tables.ve);

  const prompt = `You are Satera Tuning generating Revision ${revisionNum} of tune tables for:
${vehicleStr}

Reason for revision: ${triggerReason}
${checklist ? `\nLog findings:\n${checklist}` : ''}

Current WOT Spark Table:
${wotSparkText}

Current VE Table:
${veText}

Generate revised tables. Rules for WOT Spark:
- Keep exact same format: first column is airmass, remaining columns are RPM values
- Never reduce more than 3° per revision in any cell
- Never add more than 1° per revision in any cell  
- Never go below -5° in any cell
- If knock detected: reduce timing in affected RPM/airmass cells
- ${isNA ? 'NA vehicle — base timing on cam specs and fuel quality' : `Forced induction (${vehicle.power_adder}) — be conservative at high boost cells`}

Rules for VE Table:
- Keep exact same format: first column is airmass in mg, remaining are RPM values
- If fuel trims are positive (lean): increase VE values in those cells proportionally
- If fuel trims are negative (rich): decrease VE values in those cells
- Max change ±5% per revision
- Values should stay between 80-160%

NEVER blame the tune. Frame changes as responses to hardware/fuel/load data.

Respond in EXACTLY this format with no extra text:
===WOT_SPARK===
[revised WOT spark table — same row/column count as input]
===VE===
[revised VE table — same row/column count as input]
===NOTES===
[2-3 plain English sentences explaining what changed and why]`;

  try {
    const res = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4000,
    });
    const text = res.choices?.[0]?.message?.content?.trim() || '';

    const extract = (tag) => {
      const marker = `===${tag}===`;
      const idx = text.indexOf(marker);
      if (idx === -1) return null;
      const after = text.slice(idx + marker.length).trim();
      const endIdx = after.indexOf('===');
      return (endIdx === -1 ? after : after.slice(0, endIdx)).trim() || null;
    };

    return {
      wot_spark_text: extract('WOT_SPARK'),
      ve_text:        extract('VE'),
      notes:          extract('NOTES') || 'Tables revised based on vehicle specs and log data.',
    };
  } catch(e) {
    console.error('[httParser] AI revision error:', e.message);
    return { wot_spark_text: null, ve_text: null, notes: 'AI revision unavailable.' };
  }
}

// ── Parse AI table text back into numeric matrix ──────────
function parseAITable(tableText) {
  if (!tableText) return null;
  const lines = tableText.trim().split('\n');
  const rows = [];
  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith('°') || stripped.startsWith('Â°') || stripped.includes('rpm')) continue;
    const parts = stripped.split('\t');
    if (parts.length < 2) continue;
    const rowHeader = parts[0];
    const values = parts.slice(1).map(v => {
      const n = parseFloat(v);
      return isFinite(n) ? n : null;
    }).filter(v => v !== null);
    if (values.length > 0) rows.push({ rowHeader, values });
  }
  return rows;
}

// ── Splice revised tables back into HTT file ──────────────
function spliceHTT(parsed, aiRevision) {
  const lines = [...parsed.lines];

  // Splice WOT Spark
  if (aiRevision.wot_spark_text && parsed.tables.wot_spark) {
    const aiRows = parseAITable(aiRevision.wot_spark_text);
    const origRows = parsed.tables.wot_spark.rows;
    if (aiRows && aiRows.length === origRows.length) {
      for (let i = 0; i < origRows.length; i++) {
        const orig = origRows[i];
        const aiRow = aiRows[i];
        if (!aiRow || aiRow.values.length !== orig.numericValues.length) continue;
        const cr = orig.trailingCR ? '\r' : '';
        lines[orig.lineIndex] = `${orig.rowHeader}\t${aiRow.values.join('\t')}${cr}\n`;
      }
      console.log('[httParser] WOT Spark spliced successfully');
    } else {
      console.warn(`[httParser] WOT Spark row count mismatch: orig=${origRows.length} ai=${aiRows?.length}`);
    }
  }

  // Splice VE
  if (aiRevision.ve_text && parsed.tables.ve) {
    const aiRows = parseAITable(aiRevision.ve_text);
    const origRows = parsed.tables.ve.rows;
    if (aiRows && aiRows.length === origRows.length) {
      for (let i = 0; i < origRows.length; i++) {
        const orig = origRows[i];
        const aiRow = aiRows[i];
        if (!aiRow || aiRow.values.length !== orig.numericValues.length) continue;
        const cr = orig.trailingCR ? '\r' : '';
        lines[orig.lineIndex] = `${orig.rowHeader}\t${aiRow.values.join('\t')}${cr}\n`;
      }
      console.log('[httParser] VE spliced successfully');
    } else {
      console.warn(`[httParser] VE row count mismatch: orig=${origRows.length} ai=${aiRows?.length}`);
    }
  }

  // Return modified file as buffer
  const modifiedText = lines.join('\n');
  return Buffer.from(modifiedText, 'latin1');
}

// ── Get human-readable table summary ─────────────────────
function getTableSummary(parsed) {
  const summary = {};
  if (parsed.tables.wot_spark) {
    const t = parsed.tables.wot_spark;
    const allVals = t.rows.flatMap(r => r.numericValues);
    summary.wot_spark = {
      rows: t.rows.length,
      cols: t.colHeaders.length,
      min: Math.min(...allVals).toFixed(1),
      max: Math.max(...allVals).toFixed(1),
      airmassRange: `${t.rows[0]?.rowHeader} – ${t.rows[t.rows.length-1]?.rowHeader}`,
      rpmRange: `${t.colHeaders[0]} – ${t.colHeaders[t.colHeaders.length-1]} RPM`,
    };
  }
  if (parsed.tables.ve) {
    const t = parsed.tables.ve;
    const allVals = t.rows.flatMap(r => r.numericValues);
    summary.ve = {
      rows: t.rows.length,
      cols: t.colHeaders.length,
      min: Math.min(...allVals).toFixed(1),
      max: Math.max(...allVals).toFixed(1),
    };
  }
  return summary;
}

module.exports = { parseHTT, generateHTTRevision, spliceHTT, tableToText, getTableSummary };
