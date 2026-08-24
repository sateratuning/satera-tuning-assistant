// backend/utils/channelMap.js
// ============================================================
// Tiered channel resolver.
//
// Matching runs in strict-to-loose order and stops at the first
// hit, so any log that resolves today resolves identically:
//
//   1. exact alias           (case-sensitive)
//   2. exact alias           (case-insensitive)
//   3. normalised alias      ("(SAE)", punctuation, spacing removed)
//   4. token containment     (every keyword must appear)
//
// Two guards keep loose matching from doing damage:
//   • metadata columns ("... Source", "... State") are excluded
//   • a candidate is rejected if its sampled values fall outside
//     a physically plausible range for that channel
// ============================================================

// Columns describing HOW a value was derived, not the value itself.
const META_SUFFIX = /\b(source|state|status|mode|flag|enable[d]?|type|id|units?)\b\s*$/i;

// Normalise a header for comparison: lowercase, drop (SAE)/(sae) style
// qualifiers and all punctuation, collapse whitespace.
function norm(h) {
  return String(h)
    .toLowerCase()
    .replace(/\((?:sae|obd|calc|calculated|actual|desired)\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Every token in the set must be present for a token match to count.
function hasAllTokens(header, tokens) {
  const n = ' ' + norm(header) + ' ';
  return tokens.every(t => n.includes(' ' + t + ' ') || n.includes(t));
}

// ── Channel definitions ──────────────────────────────────────
// aliases : tried first, in order — these preserve current behaviour
// tokens  : keyword sets for fuzzy fallback (ALL must match)
// range   : plausible [min,max]; a candidate failing this is rejected
// reject  : substrings that disqualify a header outright
const CHANNELS = {
  time: {
    aliases: ['Offset','Time (s)','Time','Timestamp','Elapsed Time','Session Time','SAE Time'],
    tokens : [['offset'], ['elapsed','time'], ['session','time'], ['time']],
    range  : [-1, 100000],
  },
  rpm: {
    aliases: ['Engine RPM (SAE)','Engine RPM','RPM (SAE)','RPM','Engine Speed (SAE)','Engine Speed (RPM)','Engine Speed'],
    tokens : [['engine','rpm'], ['engine','speed'], ['rpm']],
    range  : [0, 12000],
    reject : ['desired','target','commanded','limit','max','idle'],
  },
  speed: {
    aliases: ['Vehicle Speed (SAE)','Vehicle Speed','Speed (SAE)','Vehicle Speed (VSS)','VSS','Speed'],
    tokens : [['vehicle','speed'], ['vss'], ['speed']],
    range  : [0, 300],
    reject : ['engine','wheel slip','desired','fan','turbo','shaft'],
  },
  pedal: {
    aliases: [
      'Accelerator Position D (SAE)','Accelerator Pedal Position (SAE)','Accelerator Pedal Position',
      'Accelerator Position (SAE)','Accelerator Position','Relative Accelerator Position',
      'Pedal Position (SAE)','Pedal Position','APP',
    ],
    tokens : [['accelerator','position'], ['accelerator','pedal'], ['pedal','position'], ['app']],
    range  : [0, 105],
    reject : ['source','learned','minimum','maximum'],
  },
  throttle: {
    aliases: [
      'Throttle Position (SAE)','Throttle Position (%)','Throttle Position',
      'Relative Throttle Position (SAE)','Relative Throttle Position',
      'Throttle Blade Angle','Throttle Angle','TPS',
    ],
    tokens : [['throttle','position'], ['throttle','blade'], ['throttle','angle'], ['tps']],
    range  : [0, 105],
    reject : ['desired','commanded','source','learned','closed','minimum','maximum','area'],
  },
  knock: {
    aliases: ['Total Knock Retard','Knock Retard (SAE)','Knock Retard','Total Spark Retard','Knock Sensor Retard','KR'],
    tokens : [['knock','retard'], ['total','knock']],
    range  : [-40, 40],
    reject : ['sensor voltage','volt','noise','threshold','cyl'],
  },
  timing: {
    aliases: ['Timing Advance (SAE)','Spark Advance (SAE)','Spark Advance','Timing Advance','Ignition Timing Advance','Spark'],
    tokens : [['timing','advance'], ['spark','advance'], ['ignition','timing']],
    range  : [-40, 70],
    reject : ['desired','commanded','base','target','cyl','knock'],
  },
  map: {
    aliases: [
      'Intake Manifold Absolute Pressure (SAE)','Manifold Absolute Pressure (SAE)',
      'Manifold Absolute Pressure','Intake Manifold Pressure','MAP (SAE)','MAP',
    ],
    tokens : [['manifold','absolute','pressure'], ['manifold','pressure'], ['map']],
    range  : [0, 500],
    reject : ['desired','commanded','ratio','temp','vacuum'],
  },
  baro: {
    aliases: ['Barometric Pressure (SAE)','Barometric Pressure','Baro Pressure (SAE)','Baro Pressure','Ambient Pressure (SAE)','Baro'],
    tokens : [['barometric','pressure'], ['baro','pressure'], ['ambient','pressure'], ['baro']],
    range  : [0, 200],
  },
  boost: {
    aliases: ['Boost Pressure (SAE)','Boost Pressure','Boost (SAE)','Boost'],
    tokens : [['boost','pressure'], ['boost']],
    range  : [-30, 80],
    reject : ['desired','commanded','target','error','limit'],
  },
  coolant: {
    aliases: ['Engine Coolant Temp (SAE)','Engine Coolant Temp','Coolant Temperature (SAE)','Coolant Temperature','ECT'],
    tokens : [['coolant','temp'], ['ect']],
    range  : [-60, 300],
    reject : ['desired','fan','request'],
  },
  iat: {
    aliases: ['Intake Air Temperature (SAE)','Intake Air Temp (SAE)','Intake Air Temp','Manifold Charge Temp','IAT'],
    tokens : [['intake','air','temp'], ['charge','temp'], ['iat']],
    range  : [-60, 300],
  },
  maf: {
    aliases: ['Mass Airflow A (SAE)','Mass Airflow (SAE)','Mass Air Flow (SAE)','Mass Airflow','Mass Air Flow','MAF'],
    tokens : [['mass','airflow'], ['mass','air','flow'], ['maf']],
    range  : [0, 3000],
    reject : ['desired','frequency','period','sensor volt'],
  },
  fuelPressure: {
    aliases: ['Fuel Rail Pressure Actual','Fuel Rail Pressure (SAE)','Fuel Rail Pressure','Fuel Pressure (SAE)','Fuel Pressure'],
    tokens : [['fuel','rail','pressure'], ['fuel','pressure']],
    range  : [0, 5000],
    reject : ['desired','commanded','target','error'],
  },
  ltft1: {
    aliases: ['Long Term Fuel Trim Bank 1 (SAE)','Long Term Fuel Trim Bank 1','LTFT Bank 1','LTFT1'],
    tokens : [['long','term','fuel','trim','1'], ['ltft','1']],
    range  : [-60, 60],
  },
  ltft2: {
    aliases: ['Long Term Fuel Trim Bank 2 (SAE)','Long Term Fuel Trim Bank 2','LTFT Bank 2','LTFT2'],
    tokens : [['long','term','fuel','trim','2'], ['ltft','2']],
    range  : [-60, 60],
  },
  stft1: {
    aliases: ['Short Term Fuel Trim Bank 1 (SAE)','Short Term Fuel Trim Bank 1','STFT Bank 1','STFT1'],
    tokens : [['short','term','fuel','trim','1'], ['stft','1']],
    range  : [-60, 60],
  },
  stft2: {
    aliases: ['Short Term Fuel Trim Bank 2 (SAE)','Short Term Fuel Trim Bank 2','STFT Bank 2','STFT2'],
    tokens : [['short','term','fuel','trim','2'], ['stft','2']],
    range  : [-60, 60],
  },
  airmass: {
    aliases: ['Cylinder Airmass','Cyl Airmass','Air Mass per Cylinder','Aircharge','Air Charge'],
    tokens : [['cylinder','airmass'], ['cyl','airmass'], ['aircharge'], ['air','charge']],
    range  : [0, 5000],
    reject : ['desired','temp'],
  },
  injDuty: {
    aliases: ['Injector Duty Cycle (SAE)','Injector Duty Cycle','Injector Duty','Duty Cycle'],
    tokens : [['injector','duty'], ['duty','cycle']],
    range  : [0, 200],
    reject : ['desired','fan','purge','boost','wastegate'],
  },
};

// Sample a column's values to check they're physically plausible.
function valuesPlausible(rows, header, range, sample = 200) {
  if (!range || !rows || !rows.length) return true;
  const step = Math.max(1, Math.floor(rows.length / sample));
  let seen = 0, inRange = 0;
  for (let i = 0; i < rows.length; i += step) {
    const v = rows[i] && rows[i][header];
    if (!Number.isFinite(v)) continue;
    seen++;
    if (v >= range[0] && v <= range[1]) inRange++;
  }
  if (seen < 3) return true;              // not enough data to judge
  return (inRange / seen) >= 0.9;         // allow a few spikes/dropouts
}

/**
 * Resolve one logical channel to an actual header name.
 * @param {string[]} headers  header row from the CSV
 * @param {string}   key      a key of CHANNELS
 * @param {object[]} rows     optional parsed rows, enables range validation
 * @returns {string|null}
 */
function resolveChannel(headers, key, rows) {
  const def = CHANNELS[key];
  if (!def || !headers || !headers.length) return null;

  const rejects = def.reject || [];
  const eligible = headers.filter(h => {
    if (!h) return false;
    if (META_SUFFIX.test(h)) return false;
    const n = norm(h);
    return !rejects.some(r => n.includes(r));
  });

  const accept = (h) => (h && valuesPlausible(rows, h, def.range)) ? h : null;

  // 1 — exact, case-sensitive
  for (const a of def.aliases) {
    if (eligible.includes(a)) { const r = accept(a); if (r) return r; }
  }
  // 2 — exact, case-insensitive
  for (const a of def.aliases) {
    const h = eligible.find(x => x.toLowerCase() === a.toLowerCase());
    if (h) { const r = accept(h); if (r) return r; }
  }
  // 3 — normalised (drops "(SAE)", punctuation, spacing differences)
  for (const a of def.aliases) {
    const na = norm(a);
    const h = eligible.find(x => norm(x) === na);
    if (h) { const r = accept(h); if (r) return r; }
  }
  // 4 — token containment; prefer the shortest header (least qualified)
  for (const tokenSet of (def.tokens || [])) {
    const hits = eligible
      .filter(h => hasAllTokens(h, tokenSet))
      .sort((a, b) => norm(a).length - norm(b).length);
    for (const h of hits) { const r = accept(h); if (r) return r; }
  }
  return null;
}

/** Resolve every known channel at once. */
function resolveAll(headers, rows) {
  const out = {};
  for (const key of Object.keys(CHANNELS)) out[key] = resolveChannel(headers, key, rows);
  return out;
}

module.exports = { CHANNELS, resolveChannel, resolveAll, norm, META_SUFFIX };
