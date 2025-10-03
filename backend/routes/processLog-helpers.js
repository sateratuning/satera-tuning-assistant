// backend/routes/processLog-helpers.js
function parseLogFile(raw) {
  const lines = raw.split(/\r?\n/).map(l => l.trim());
  if (!lines.length) return { metrics: null, graphs: null };

  // 🔎 Locate the header row dynamically by finding "Offset"
  const headerRowIndex = lines.findIndex(r => r.toLowerCase().startsWith('offset'));
  if (headerRowIndex === -1) return { metrics: null, graphs: null };

  const headers = lines[headerRowIndex].split(',').map(h => h.trim());

  // Data starts after: header + units + 2 spacer rows
  const dataStart = headerRowIndex + 4;
  const dataRows = lines.slice(dataStart).filter(r => r && r.includes(','));

  const toNum = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  // Parse rows into objects
  const parsed = dataRows.map(row => {
    const cols = row.split(',');
    const obj = {};
    headers.forEach((h, i) => { obj[h] = toNum(cols[i]); });
    return obj;
  });

  const hasCol = (name) => headers.includes(name);
  const getCol = (name) => hasCol(name) ? parsed.map(r => r[name]).filter(Number.isFinite) : [];

  const safeMax = (arr) => arr.length ? Math.max(...arr) : null;
  const safeMin = (arr) => arr.length ? Math.min(...arr) : null;
  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  // ===== Metrics =====
  const knockCol = getCol('Total Knock Retard').map(v => Math.abs(v));
  const peakKnock = safeMax(knockCol);

  // WOT rows
  const accelName = 'Accelerator Position D (SAE)';
  const timingName = 'Timing Advance (SAE)';
  const rpmName = 'Engine RPM (SAE)';
  const mapName = 'Intake Manifold Absolute Pressure (SAE)';
  let wotRows = hasCol(accelName) ? parsed.filter(r => r[accelName] > 86) : [];

  let peakTiming = null, peakTimingRPM = null;
  if (wotRows.length) {
    const peakRow = wotRows.reduce((best, r) =>
      (r[timingName] ?? -Infinity) > (best[timingName] ?? -Infinity) ? r : best, wotRows[0]);
    peakTiming = peakRow[timingName];
    peakTimingRPM = peakRow[rpmName];
  }
  const mapWOT = wotRows.map(r => r[mapName]).filter(Number.isFinite);

  // Knock sensors
  const ks1max = safeMax(getCol('Knock Sensor 1'));
  const ks2max = safeMax(getCol('Knock Sensor 2'));

  // Fuel trims
  const lt1 = getCol('Long Term Fuel Trim Bank 1 (SAE)');
  const lt2 = getCol('Long Term Fuel Trim Bank 2 (SAE)');
  let varFT = null;
  if (lt1.length && lt2.length) {
    const diffs = lt1.map((v, i) => (Number.isFinite(v) && Number.isFinite(lt2[i])) ? Math.abs(v - lt2[i]) : null)
      .filter(Number.isFinite);
    varFT = diffs.length ? Math.max(...diffs) : null;
  }
  const st1 = getCol('Short Term Fuel Trim Bank 1 (SAE)');
  const st2 = getCol('Short Term Fuel Trim Bank 2 (SAE)');
  const avgFT1 = avg(st1.map((v, i) => v + (lt1[i] || 0)).filter(Number.isFinite));
  const avgFT2 = avg(st2.map((v, i) => v + (lt2[i] || 0)).filter(Number.isFinite));

  // Oil & coolant
  const oilRows = parsed.filter(r => (r[rpmName] || 0) > 500);
  const oilMin = oilRows.length ? safeMin(oilRows.map(r => r['Engine Oil Pressure']).filter(Number.isFinite)) : null;
  const ectMax = safeMax(getCol('Engine Coolant Temp (SAE)'));

  // Misfires
  const misfires = {};
  if (parsed[0]) {
    Object.keys(parsed[0]).forEach(key => {
      if (key.includes('Misfire Current Cylinder')) {
        const cyl = key.split('#')[1];
        const vals = getCol(key);
        let count = 0;
        for (let i = 1; i < vals.length; i++) {
          const diff = vals[i] - vals[i - 1];
          if (diff > 0 && diff < 1000) count += diff;
        }
        if (count > 0) misfires[cyl] = count;
      }
    });
  }

  // Acceleration intervals
  const speed = getCol('Vehicle Speed (SAE)');
  const time = getCol('Offset');
  const findAllIntervals = (start, end) => {
    const times = [];
    let startTime = null;
    for (let i = 0; i < speed.length; i++) {
      const s = speed[i], t = time[i];
      if (!Number.isFinite(s) || !Number.isFinite(t)) continue;
      if (startTime === null && s >= start && s < end) startTime = t;
      if (startTime !== null && s >= end) {
        times.push(t - startTime);
        startTime = null;
      }
    }
    return times;
  };
  const best = (arr) => arr.length ? Math.min(...arr) : null;
  const runs0060 = (() => {
    const times = [];
    let foundStop = false, startTime = null;
    for (let i = 1; i < speed.length; i++) {
      const s = speed[i], t = time[i];
      if (!Number.isFinite(s) || !Number.isFinite(t)) continue;
      if (!foundStop && s < 1.5) foundStop = true;
      if (foundStop && startTime === null && s > 1.5) startTime = t;
      if (startTime !== null && s >= 60) {
        times.push(t - startTime);
        startTime = null;
        foundStop = false;
      }
    }
    return times;
  })();

  const zeroTo60 = best(runs0060);
  const fortyTo100 = best(findAllIntervals(40, 100));
  const sixtyTo130 = best(findAllIntervals(60, 130));

  return {
    metrics: {
      peakKnock, peakTiming, peakTimingRPM,
      mapWOTmin: safeMin(mapWOT), mapWOTmax: safeMax(mapWOT),
      ks1max, ks2max,
      varFT, avgFT1, avgFT2,
      oilMin, ectMax,
      misfires,
      zeroTo60, fortyTo100, sixtyTo130
    },
    graphs: { time, speed }
  };
}

module.exports = { parseLogFile };
