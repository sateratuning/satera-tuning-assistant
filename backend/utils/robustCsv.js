// backend/utils/robustCsv.js
// ============================================================
// Tolerant HP Tuners CSV reader.
// Handles: BOM, comma/semicolon/tab delimiters, decimal commas,
// quoted fields, "Offset" vs "Time" headers, +signed numbers,
// timestamp columns, and arbitrary preamble/units rows.
// ============================================================

// Column names that identify the time axis across VCM Scanner versions
const TIME_ALIASES = [
  'offset', 'time', 'time (s)', 'timestamp', 'elapsed time',
  'session time', 'seconds', 'sae time',
];

// Strip a UTF-8 BOM if present
function stripBOM(s) {
  return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

// Split a line into fields, honouring double-quoted sections
function splitLine(line, delim) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // doubled quote inside a quoted field = literal quote
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === delim && !inQ) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(c => c.trim().replace(/^"|"$/g, '').trim());
}

// Pick the delimiter that yields the most consistent column count
function detectDelimiter(lines) {
  const candidates = [',', ';', '\t', '|'];
  let best = ',', bestScore = -1;
  for (const d of candidates) {
    const counts = lines
      .slice(0, 80)
      .map(l => splitLine(l, d).length)
      .filter(n => n > 1);
    if (counts.length < 2) continue;
    // reward many columns that repeat consistently
    const freq = {};
    counts.forEach(n => { freq[n] = (freq[n] || 0) + 1; });
    const [mode, hits] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    const score = Number(mode) * hits;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

// Is this token a number? Tolerates +, spaces, and decimal commas.
function looksNumeric(tok, decimalComma) {
  if (tok == null) return false;
  let t = String(tok).trim();
  if (!t) return false;
  if (decimalComma) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');            // thousands separators
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t);
}

function toNum(tok, decimalComma) {
  if (tok == null) return undefined;
  let t = String(tok).trim();
  if (!t) return undefined;
  if (decimalComma) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  t = t.replace(/^\+/, '');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : undefined;
}

// hh:mm:ss(.ms) -> seconds
function timeToSeconds(tok) {
  const m = String(tok).trim().match(/^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (!m) return undefined;
  return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
}

function analyzeCsvContent(content) {
  if (!content || !String(content).trim()) throw new Error('CSV file is empty.');

  const raw = stripBOM(String(content));
  const lines = raw.split(/\r?\n/).map(l => l.replace(/\s+$/, ''));
  const nonEmpty = lines.filter(l => l.trim());
  if (!nonEmpty.length) throw new Error('CSV file is empty.');

  const delim = detectDelimiter(nonEmpty);
  // Decimal commas only make sense when the delimiter isn't a comma
  const decimalComma = delim !== ',' &&
    nonEmpty.slice(0, 200).some(l => /\d+,\d+/.test(l));

  // ── Locate the header row ────────────────────────────────
  // 1st choice: a row containing a known time-axis column name.
  // 2nd choice: the last mostly-text row that is directly followed
  //             (within a few lines) by a mostly-numeric row.
  let headerRowIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim).map(c => c.toLowerCase());
    if (cells.length < 2) continue;
    if (cells.some(c => TIME_ALIASES.includes(c))) { headerRowIndex = i; break; }
  }

  if (headerRowIndex === -1) {
    for (let i = 0; i < lines.length; i++) {
      const cells = splitLine(lines[i], delim);
      if (cells.length < 3) continue;
      const textCells = cells.filter(c => c && !looksNumeric(c, decimalComma)).length;
      if (textCells < Math.max(3, cells.length * 0.6)) continue;
      // confirm a numeric row appears soon after
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const d = splitLine(lines[j], delim);
        if (d.length < 3) continue;
        const numCells = d.filter(c => looksNumeric(c, decimalComma) || timeToSeconds(c) !== undefined).length;
        if (numCells >= Math.max(2, d.length * 0.5)) { headerRowIndex = i; break; }
      }
      if (headerRowIndex !== -1) break;
    }
  }

  if (headerRowIndex === -1) {
    throw new Error(
      'Could not find the channel header row. Export from VCM Scanner using ' +
      'File -> Export Data Log as CSV (not a filtered or chart export).'
    );
  }

  const headers = splitLine(lines[headerRowIndex], delim)
    .map(h => h.trim())
    .map((h, i) => h || `col_${i}`);

  // ── Find the first real data row ─────────────────────────
  let dataStart = headerRowIndex + 1;
  for (; dataStart < lines.length; dataStart++) {
    const cells = splitLine(lines[dataStart], delim);
    if (cells.length < 2) continue;
    const usable = cells.filter(c => looksNumeric(c, decimalComma) || timeToSeconds(c) !== undefined).length;
    if (usable >= Math.max(2, Math.floor(cells.length * 0.4))) break;
  }

  const parsed = [];
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = splitLine(line, delim);
    if (cells.length < 2) continue;

    const obj = {};
    let numericCount = 0;
    headers.forEach((h, ci) => {
      const tok = cells[ci];
      let v = toNum(tok, decimalComma);
      if (v === undefined) {
        const t = timeToSeconds(tok);       // accept hh:mm:ss time columns
        if (t !== undefined) v = t;
      }
      obj[h] = v;
      if (v !== undefined) numericCount++;
    });
    if (numericCount >= 2) parsed.push(obj);
  }

  if (!parsed.length) {
    throw new Error(
      'No usable data rows were found. The file has a header but no numeric ' +
      'samples — make sure the log was recorded before exporting.'
    );
  }

  return { headers, parsed, delimiter: delim, decimalComma, headerRowIndex };
}

module.exports = { analyzeCsvContent, splitLine, detectDelimiter, toNum, timeToSeconds };
