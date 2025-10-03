// backend/routes/processLog.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Ensure uploads dir exists (in case index.js didn’t run first)
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const upload = multer({ dest: uploadsDir });

// GET safe helpers
const toNum = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
};

const safeMax = (arr) => (arr.length ? Math.max(...arr) : undefined);
const safeMin = (arr) => (arr.length ? Math.min(...arr) : undefined);

// Build text block from an array of lines
const block = (lines) => lines.filter(Boolean).join('\n');

// =====================================================================
// /api/review-log  — Non‑AI review + timers + normalized graph arrays
// =====================================================================
router.post('/api/review-log', upload.single('log'), async (req, res) => {
  let filePath;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded.' });
    }
    filePath = req.file.path;

    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n').map(l => l.trimEnd());

    // Expected format (your confirmed structure):
    // index 15: headers
    // index 16: units
    // index 17–18: blank
    // index 19+: data
    const after15 = lines.slice(15);
    if (after15.length < 5) {
      return res.status(400).json({ error: 'CSV appears incomplete after header row.' });
    }
    const headers = (after15[0] || '').split(',').map(h => h.trim());
    const dataRows = after15.slice(4).filter(r => r && r.includes(','));

    if (!headers.length || !dataRows.length) {
      return res.status(400).json({ error: 'No headers or data rows found.' });
    }

    // Parse to array of objects
    const parsed = dataRows.map(row => {
      const values = row.split(',');
      const obj = {};
      headers.forEach((h, i) => (obj[h] = toNum(values[i])));
      return obj;
    });

    const hasCol = (name) => headers.includes(name);
    const getColumn = (name) => (hasCol(name)
      ? parsed.map(r => r[name]).filter(Number.isFinite)
      : []);

    // ======== Non‑AI diagnostics (text summary) ========
    const summary = [];

    // Knock
    const knockCol = getColumn('Total Knock Retard').map(v => Math.abs(v));
    const peakKnock = safeMax(knockCol);
    if (peakKnock !== undefined) {
      summary.push(peakKnock > 0 ? `⚠️ Knock detected: up to ${peakKnock.toFixed(1)}°` : '✅ No knock detected.');
    } else {
      summary.push('ℹ️ Knock column not found.');
    }

    // WOT group
    const accelName = 'Accelerator Position D (SAE)';
    const timingName = 'Timing Advance (SAE)';
    const rpmName = 'Engine RPM (SAE)';
    const mapName = 'Intake Manifold Absolute Pressure (SAE)';

    let wotRows = [];
    if (hasCol(accelName)) {
      wotRows = parsed.filter(r => Number.isFinite(r[accelName]) && r[accelName] > 86);
    }

    if (wotRows.length) {
      const peakTimingRow = wotRows.reduce((best, r) => {
        const c = r[timingName] ?? -Infinity;
        const b = best[timingName] ?? -Infinity;
        return c > b ? r : best;
      }, wotRows[0]);

      const peakTiming = peakTimingRow[timingName];
      const rpmAtPeak = peakTimingRow[rpmName];

      if (Number.isFinite(peakTiming) && Number.isFinite(rpmAtPeak)) {
        summary.push(`📈 Peak timing under WOT: ${peakTiming.toFixed(1)}° @ ${rpmAtPeak.toFixed(0)} RPM`);
      } else {
        summary.push('ℹ️ Could not determine peak timing @ RPM under WOT.');
      }

      const mapWOT = wotRows.map(r => r[mapName]).filter(Number.isFinite);
      if (mapWOT.length) {
        summary.push(`🌡 MAP under WOT: ${safeMin(mapWOT).toFixed(1)} – ${safeMax(mapWOT).toFixed(1)} kPa`);
      } else {
        summary.push('ℹ️ MAP data under WOT not found.');
      }
    } else {
      summary.push('ℹ️ No WOT conditions found.');
    }

    // Knock sensor volts
    ['Knock Sensor 1', 'Knock Sensor 2'].forEach(sensor => {
      const volts = getColumn(sensor);
      if (!volts.length) {
        summary.push(`ℹ️ ${sensor} not found.`);
        return;
      }
      const peak = safeMax(volts);
      if (peak !== undefined) {
        summary.push(
          peak > 3.0
            ? `⚠️ ${sensor} exceeded 3.0V threshold (Peak: ${peak.toFixed(2)}V)`
            : `✅ ${sensor} within safe range (Peak: ${peak.toFixed(2)}V)`
        );
      }
    });

    // Fuel trims variance
    const lt1 = getColumn('Long Term Fuel Trim Bank 1 (SAE)');
    const lt2 = getColumn('Long Term Fuel Trim Bank 2 (SAE)');
    if (lt1.length && lt2.length) {
      const variance = lt1
        .map((v, i) => (Number.isFinite(v) && Number.isFinite(lt2[i])) ? Math.abs(v - lt2[i]) : undefined)
        .filter(Number.isFinite);
      const tooHigh = variance.some(v => v > 10);
      summary.push(tooHigh ? '⚠️ Fuel trim variance > 10% between banks' : '✅ Fuel trim variance within 10%');
    } else {
      summary.push('ℹ️ One or both LTFT columns missing; variance check skipped.');
    }

    // Avg correction per bank (STFT+LTFT)
    const st1 = getColumn('Short Term Fuel Trim Bank 1 (SAE)');
    const st2 = getColumn('Short Term Fuel Trim Bank 2 (SAE)');
    const avg = (arr) => (arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : undefined);

    if (st1.length && lt1.length) {
      const combo1 = st1.map((v, i) => (Number.isFinite(v) ? v : 0) + (Number.isFinite(lt1[i]) ? lt1[i] : 0)).filter(Number.isFinite);
      const a1 = avg(combo1);
      if (a1 !== undefined) summary.push(`📊 Avg fuel correction (Bank 1): ${a1.toFixed(1)}%`);
    } else {
      summary.push('ℹ️ Could not compute avg fuel correction (Bank 1).');
    }

    if (st2.length && lt2.length) {
      const combo2 = st2.map((v, i) => (Number.isFinite(v) ? v : 0) + (Number.isFinite(lt2[i]) ? lt2[i] : 0)).filter(Number.isFinite);
      const a2 = avg(combo2);
      if (a2 !== undefined) summary.push(`📊 Avg fuel correction (Bank 2): ${a2.toFixed(1)}%`);
    } else {
      summary.push('ℹ️ Could not compute avg fuel correction (Bank 2).');
    }

    // Oil pressure (RPM > 500)
    const rpmCol = getColumn(rpmName);
    const oilCol = getColumn('Engine Oil Pressure');
    if (rpmCol.length && oilCol.length) {
      const oilRows = parsed.filter(r => Number.isFinite(r[rpmName]) && r[rpmName] > 500);
      const oilLow = oilRows.some(r => Number.isFinite(r['Engine Oil Pressure']) && r['Engine Oil Pressure'] < 20);
      summary.push(oilLow ? '⚠️ Oil pressure dropped below 20 psi.' : '✅ Oil pressure within safe range.');
    } else {
      summary.push('ℹ️ Oil pressure or RPM column missing; check skipped.');
    }

    // ECT
    const ect = getColumn('Engine Coolant Temp (SAE)');
    if (ect.length) {
      summary.push(ect.some(v => v > 230) ? '⚠️ Coolant temp exceeded 230°F.' : '✅ Coolant temp within safe limits.');
    } else {
      summary.push('ℹ️ Coolant temp column missing.');
    }

    // Misfires per cylinder
    const misfireReport = [];
    const firstRow = parsed[0] || {};
    Object.keys(firstRow).forEach(key => {
      if (key.includes('Misfire Current Cylinder')) {
        const cyl = key.split('#')[1] || '?';
        const values = getColumn(key);
        if (values.length) {
          let count = 0;
          for (let i = 1; i < values.length; i++) {
            const diff = values[i] - values[i - 1];
            if (Number.isFinite(diff) && diff > 0 && diff < 1000) count += diff;
          }
          if (count > 0) misfireReport.push(`- Cylinder ${cyl}: ${count} misfires`);
        }
      }
    });
    if (misfireReport.length) {
      summary.push(`🚨 Misfires detected:\n${misfireReport.join('\n')}`);
    } else {
      summary.push('✅ No misfires detected.');
    }

    // ===== Speed intervals + bests =====
    const speed = getColumn('Vehicle Speed (SAE)');
    const time = getColumn('Offset'); // seconds

    const findAllIntervals = (start, end) => {
      const times = [];
      let startTime = null;
      for (let i = 0; i < speed.length; i++) {
        const s = speed[i], t = time[i];
        if (!Number.isFinite(s) || !Number.isFinite(t)) continue;

        if (startTime === null && s >= start && s < end) startTime = t;
        if (startTime !== null && s >= end) {
          times.push((t - startTime).toFixed(2));
          startTime = null; // reset for next run
        }
        if (startTime !== null && s > end + 10) startTime = null;
      }
      return times;
    };

    const findAllZeroToSixty = () => {
      const times = [];
      let foundStop = false;
      let startTime = null;
      for (let i = 1; i < speed.length; i++) {
        const s = speed[i], t = time[i];
        if (!Number.isFinite(s) || !Number.isFinite(t)) continue;

        if (!foundStop && s < 1.5) foundStop = true;
        if (foundStop && startTime === null && s > 1.5) startTime = t;
        if (startTime !== null && s >= 60) {
          times.push((t - startTime).toFixed(2));
          startTime = null;
          foundStop = false;
        }
      }
      return times;
    };

    const runs0060 = findAllZeroToSixty();
    const runs40100 = findAllIntervals(40, 100);
    const runs60130 = findAllIntervals(60, 130);

    const best = (arr) => (arr.length ? Math.min(...arr.map(Number)) : null);
    const zeroToSixty = best(runs0060);
    const fortyToHundred = best(runs40100);
    const sixtyToOneThirty = best(runs60130);

    if (zeroToSixty) summary.push(`🚦 Best 0–60 mph: ${zeroToSixty.toFixed(2)}s`);
    if (fortyToHundred) summary.push(`🚀 Best 40–100 mph: ${fortyToHundred.toFixed(2)}s`);
    if (sixtyToOneThirty) summary.push(`🚀 Best 60–130 mph: ${sixtyToOneThirty.toFixed(2)}s`);

    // ===== Graph arrays (normalized) =====
    // Frontend overlay expects simple X/Y arrays: time[] (sec) and speed[] (mph)
    const timeArr = time;     // already seconds
    const speedArr = speed;   // mph

    // Response payload expected by the combined page
    res.json({
      summaryText: block(summary),
      metrics: {
        zeroToSixty: zeroToSixty ? Number(zeroToSixty.toFixed(2)) : null,
        fortyToHundred: fortyToHundred ? Number(fortyToHundred.toFixed(2)) : null,
        sixtyToOneThirty: sixtyToOneThirty ? Number(sixtyToOneThirty.toFixed(2)) : null
      },
      graphs: {
        time: timeArr,
        speed: speedArr
      },
      aiEligible: Boolean(
        hasCol('Total Knock Retard') &&
        hasCol('Engine RPM (SAE)') &&
        hasCol('Cylinder Airmass')
      )
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Log processing failed.' });
  } finally {
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {
      // swallow cleanup errors
    }
  }
});

module.exports = router;
