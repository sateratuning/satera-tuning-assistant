// backend/utils/parseCSV.js
module.exports = function parseCSV(raw) {
  const rows = raw.split(/\r?\n/).map(r => r.trim());
  if (!rows.length) return null;

  // Find header row that contains "Offset" anywhere (handles BOM/whitespace)
  const headerRowIndex = rows.findIndex(r => /(^|,)\s*offset\s*(,|$)/i.test(r));
  if (headerRowIndex === -1) return null;

  const headers = rows[headerRowIndex].split(',').map(h => h.trim());
  const dataStart = headerRowIndex + 4;
  const dataRows = rows.slice(dataStart).filter(r => r && r.includes(','));

  // ---- helpers ----
  const findCol = (candidates) => {
    // exact case-insensitive
    for (const c of candidates) {
      const idx = headers.findIndex(h => h.toLowerCase() === c.toLowerCase());
      if (idx !== -1) return idx;
    }
    // loose contains match
    for (const c of candidates) {
      const idx = headers.findIndex(h => h.toLowerCase().includes(c.toLowerCase()));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const valuesByIndex = (i) => {
    if (i === -1) return [];
    return dataRows.map(r => {
      const cols = r.split(',');
      const v = parseFloat(cols[i]);
      return Number.isFinite(v) ? v : null;
    }).filter(v => v !== null);
  };

  const valuesByNames = (candidates) => valuesByIndex(findCol(candidates));

  const minMaxByNames = (candidates) => {
    const vals = valuesByNames(candidates);
    if (!vals.length) return { min: null, max: null };
    return { min: Math.min(...vals), max: Math.max(...vals) };
  };

  const metrics = {};

  // Common header candidates
  const RPM_NAMES = [
    'Engine RPM (SAE)', 'Engine RPM', 'RPM', 'RPM (SAE)', 'Engine Speed (RPM)', 'Engine Speed', 'Engine Speed (SAE)'
  ];
  const SPEED_NAMES = ['Vehicle Speed (SAE)', 'Vehicle Speed', 'Speed (SAE)', 'Speed'];
  const TIME_NAMES  = ['Offset', 'Time', 'Time (s)'];
  const PEDAL_NAMES = [
    'Accelerator Position D (SAE)', 'Accelerator Position (SAE)',
    'Throttle Position (SAE)', 'Throttle Position (%)', 'TPS', 'Relative Accelerator Position'
  ];
  const MAP_NAMES   = ['Manifold Absolute Pressure (SAE)', 'MAP', 'MAP (SAE)'];
  const ECT_NAMES   = ['Engine Coolant Temp (SAE)', 'Coolant Temp', 'ECT'];
  const OIL_NAMES   = ['Oil Pressure', 'Engine Oil Pressure'];

  // Knock
  metrics.knock = valuesByNames(['Total Knock Retard']);

  // Timing peak
  const timing = valuesByNames(['Spark Advance', 'Ignition Timing', 'Spark']);
  if (timing.length) {
    const maxT = Math.max(...timing);
    const idx = timing.indexOf(maxT);
    metrics.peakTiming = maxT;

    const rpmSeries = valuesByNames(RPM_NAMES);
    metrics.peakTimingRPM = rpmSeries[idx] ?? null;
  }

  // MAP under WOT
  metrics.map = minMaxByNames(MAP_NAMES);

  // Knock sensor volts
  const ks1 = valuesByNames(['Knock Sensor 1', 'Knock Sensor Bank 1', 'Knock Sensor Voltage 1']);
  const ks2 = valuesByNames(['Knock Sensor 2', 'Knock Sensor Bank 2', 'Knock Sensor Voltage 2']);
  metrics.ks1max = ks1.length ? Math.max(...ks1) : null;
  metrics.ks2max = ks2.length ? Math.max(...ks2) : null;

  // Fuel trims
  const ft1 = valuesByNames(['Long Term Fuel Trim Bank 1', 'LTFT Bank 1', 'LTFT1']);
  const ft2 = valuesByNames(['Long Term Fuel Trim Bank 2', 'LTFT Bank 2', 'LTFT2']);
  const avg = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : null;
  metrics.avgFT1 = avg(ft1);
  metrics.avgFT2 = avg(ft2);
  if (metrics.avgFT1 != null && metrics.avgFT2 != null) {
    metrics.varFT = Math.abs(metrics.avgFT1 - metrics.avgFT2);
  }

  // Oil pressure
  const oilVals = valuesByNames(OIL_NAMES);
  metrics.oilMin = oilVals.length ? Math.min(...oilVals) : null;

  // Coolant temp
  const ectVals = valuesByNames(ECT_NAMES);
  metrics.ectMax = ectVals.length ? Math.max(...ectVals) : null;

  // Misfires (increment-only)
  metrics.misfires = {};
  for (let c = 1; c <= 8; c++) {
    const nameVariants = [
      `Total Misfires Cylinder ${c}`,
      `Misfires Cylinder ${c}`,
      `Total Misfire Cylinder ${c}`
    ];
    const i = findCol(nameVariants);
    if (i !== -1) {
      let prev = 0;
      let total = 0;
      for (let row of dataRows) {
        const cols = row.split(',');
        const v = parseFloat(cols[i]);
        if (Number.isFinite(v)) {
          if (v > prev) total += (v - prev);
          prev = v;
        }
      }
      metrics.misfires[`Cyl${c}`] = total;
    }
  }

  // Acceleration timers
  const timeIdx = findCol(TIME_NAMES);
  const mphIdx  = findCol(SPEED_NAMES);
  if (timeIdx !== -1 && mphIdx !== -1) {
    const times = dataRows.map(r => {
      const cols = r.split(',');
      return {
        t: parseFloat(cols[timeIdx]),
        v: parseFloat(cols[mphIdx])
      };
    }).filter(r => Number.isFinite(r.t) && Number.isFinite(r.v));

    function measure(start, end) {
      let startT = null;
      for (let r of times) {
        if (startT === null && r.v >= start) startT = r.t;
        if (startT !== null && r.v >= end) {
          return +(r.t - startT).toFixed(2);
        }
      }
      return null;
    }

    metrics.zeroTo60   = measure(0, 60);
    metrics.fortyTo100 = measure(40, 100);
    metrics.sixtyTo130 = measure(60, 130);
  }

  // Helpful flag (for dyno features downstream)
  const rpmSeries = valuesByNames(RPM_NAMES);
  metrics.hasRPM = rpmSeries.length > 0;

  return metrics;
};
