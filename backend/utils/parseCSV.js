// backend/utils/parseCSV.js
//
// Parses HP Tuners CSV logs into structured metrics
// Works for Gen 3 HEMI log analysis
//

function parseCSV(raw) {
  const rows = raw.split(/\r?\n/).map(r => r.trim());
  if (!rows.length) return null;

  // Locate header row with "Offset"
  const headerRowIndex = rows.findIndex(r => r.toLowerCase().startsWith('offset'));
  if (headerRowIndex === -1) return null;

  const headers = rows[headerRowIndex].split(',').map(h => h.trim());
  const dataStart = headerRowIndex + 4; // skip header + units + 2 blanks
  const dataRows = rows.slice(dataStart);

  const col = (name) => headers.findIndex(h => h === name);
  const idx = {
    time: col('Offset'),
    rpm: col('Engine RPM (SAE)'),
    speed: col('Vehicle Speed (SAE)'),
    knock: col('Total Knock Retard'),
    ks1: col('Knock Sensor 1 Voltage'),
    ks2: col('Knock Sensor 2 Voltage'),
    ft1: col('Long Term Fuel Trim Bank 1'),
    ft2: col('Long Term Fuel Trim Bank 2'),
    oil: col('Engine Oil Pressure'),
    ect: col('Engine Coolant Temp (SAE)'),
    map: col('Manifold Absolute Pressure (SAE)') // if available
  };

  const parsed = [];
  for (let row of dataRows) {
    if (!row.includes(',')) continue;
    const cols = row.split(',');
    const obj = {};
    for (let key in idx) {
      const i = idx[key];
      if (i >= 0) {
        const v = parseFloat(cols[i]);
        if (Number.isFinite(v)) obj[key] = v;
      }
    }
    if (Object.keys(obj).length) parsed.push(obj);
  }
  if (!parsed.length) return null;

  // ===== Metrics calculations =====
  const metrics = {};

  // Knock
  const knockVals = parsed.map(r => r.knock).filter(Number.isFinite);
  metrics.knockEvents = knockVals.filter(k => k > 0);
  metrics.knockMax = knockVals.length ? Math.max(...knockVals) : 0;

  // Peak timing placeholder (extend when spark col is available)
  metrics.peakTiming = null;
  metrics.peakTimingRPM = null;

  // MAP
  const maps = parsed.map(r => r.map).filter(Number.isFinite);
  metrics.mapMin = maps.length ? Math.min(...maps) : null;
  metrics.mapMax = maps.length ? Math.max(...maps) : null;

  // Knock sensors
  const ks1 = parsed.map(r => r.ks1).filter(Number.isFinite);
  const ks2 = parsed.map(r => r.ks2).filter(Number.isFinite);
  metrics.ks1max = ks1.length ? Math.max(...ks1) : null;
  metrics.ks2max = ks2.length ? Math.max(...ks2) : null;

  // Fuel trims
  const ft1 = parsed.map(r => r.ft1).filter(Number.isFinite);
  const ft2 = parsed.map(r => r.ft2).filter(Number.isFinite);
  metrics.avgFT1 = ft1.length ? +(ft1.reduce((a,b)=>a+b,0)/ft1.length).toFixed(1) : null;
  metrics.avgFT2 = ft2.length ? +(ft2.reduce((a,b)=>a+b,0)/ft2.length).toFixed(1) : null;
  metrics.varFT = (metrics.avgFT1 != null && metrics.avgFT2 != null)
    ? +(Math.abs(metrics.avgFT1 - metrics.avgFT2)).toFixed(1)
    : null;

  // Oil pressure
  const oils = parsed.map(r => r.oil).filter(Number.isFinite);
  metrics.oilMin = oils.length ? Math.min(...oils) : null;

  // Coolant temp
  const ects = parsed.map(r => r.ect).filter(Number.isFinite);
  metrics.ectMax = ects.length ? Math.max(...ects) : null;

  // Misfires (if columns exist)
  metrics.misfires = {};
  headers.forEach((h, i) => {
    if (/misfire/i.test(h)) {
      const vals = dataRows.map(row => {
        const cols = row.split(',');
        const v = parseFloat(cols[i]);
        return Number.isFinite(v) ? v : 0;
      });
      metrics.misfires[h] = vals.reduce((a,b)=>a+b,0);
    }
  });

  // Acceleration times
  function detectInterval(startMPH, endMPH) {
    let startT = null, endT = null;
    for (let i=0; i<parsed.length; i++) {
      const v = parsed[i].speed, t = parsed[i].time;
      if (!Number.isFinite(v) || !Number.isFinite(t)) continue;
      if (startT == null && v >= startMPH) startT = t;
      if (startT != null && v >= endMPH) { endT = t; break; }
    }
    return (startT != null && endT != null) ? +(endT-startT).toFixed(2) : null;
  }
  metrics.zeroTo60 = detectInterval(0, 60);
  metrics.fortyTo100 = detectInterval(40, 100);
  metrics.sixtyTo130 = detectInterval(60, 130);

  // Downsample for AI
  metrics.sampled = parsed.filter((_,i)=>i%400===0).map(r => ({
    rpm: r.rpm,
    airmass: r.airmass, // may be undefined if column missing
    knock: r.knock
  }));

  return metrics;
}

module.exports = parseCSV;
