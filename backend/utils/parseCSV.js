// backend/utils/parseCSV.js
module.exports = function parseCSV(raw) {
  const rows = raw.split(/\r?\n/).map(r => r.trim());
  if (!rows.length) return null;

  // Find header row with "Offset"
  const headerRowIndex = rows.findIndex(r => r.toLowerCase().startsWith('offset'));
  if (headerRowIndex === -1) return null;

  const headers = rows[headerRowIndex].split(',').map(h => h.trim());
  const dataStart = headerRowIndex + 4;
  const dataRows = rows.slice(dataStart).filter(r => r && r.includes(','));

  const col = (name) => headers.findIndex(h => h === name);

  const getColValues = (name) => {
    const i = col(name);
    if (i === -1) return [];
    return dataRows.map(r => {
      const cols = r.split(',');
      const v = parseFloat(cols[i]);
      return Number.isFinite(v) ? v : null;
    }).filter(v => v !== null);
  };

  const getColMinMax = (name) => {
    const vals = getColValues(name);
    if (!vals.length) return { min: null, max: null };
    return { min: Math.min(...vals), max: Math.max(...vals) };
  };

  const metrics = {};

  // Knock
  metrics.knock = getColValues('Total Knock Retard');

  // Timing (WOT placeholder – may need enrichment)
  const timing = getColValues('Spark Advance');
  if (timing.length) {
    const maxT = Math.max(...timing);
    const idx = timing.indexOf(maxT);
    metrics.peakTiming = maxT;
    metrics.peakTimingRPM = getColValues('Engine RPM (SAE)')[idx] || null;
  }

  // MAP under WOT
  metrics.map = getColMinMax('Manifold Absolute Pressure (SAE)');

  // Knock sensor volts
  metrics.ks1max = Math.max(...getColValues('Knock Sensor 1'), 0) || null;
  metrics.ks2max = Math.max(...getColValues('Knock Sensor 2'), 0) || null;

  // Fuel trims
  const ft1 = getColValues('Long Term Fuel Trim Bank 1');
  const ft2 = getColValues('Long Term Fuel Trim Bank 2');
  const avg = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : null;
  metrics.avgFT1 = avg(ft1);
  metrics.avgFT2 = avg(ft2);
  if (metrics.avgFT1 != null && metrics.avgFT2 != null) {
    metrics.varFT = Math.abs(metrics.avgFT1 - metrics.avgFT2);
  }

  // Oil pressure
  metrics.oilMin = Math.min(...getColValues('Oil Pressure'), Infinity);
  if (!Number.isFinite(metrics.oilMin)) metrics.oilMin = null;

  // Coolant temp
  metrics.ectMax = Math.max(...getColValues('Engine Coolant Temp (SAE)'), -Infinity);
  if (!Number.isFinite(metrics.ectMax)) metrics.ectMax = null;

  // Misfires (increment-only method)
  metrics.misfires = {};
  for (let c = 1; c <= 8; c++) {
    const colName = `Total Misfires Cylinder ${c}`;
    const i = col(colName);
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
  const timeIdx = col('Offset');
  const mphIdx = col('Vehicle Speed (SAE)');
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

    metrics.zeroTo60 = measure(0, 60);
    metrics.fortyTo100 = measure(40, 100);
    metrics.sixtyTo130 = measure(60, 130);
  }

  return metrics;
};
