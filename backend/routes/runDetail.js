// backend/routes/runDetail.js
const express = require('express');
const router = express.Router();
const getSupabase = require('../Lib/supabase');
const supabase = getSupabase();

// parse HPT CSV: headers at index 15, then units, 2 blanks, then data
function parseHPTCsv(raw) {
  const lines = raw.split('\n').map(l => l.trimEnd());
  const after15 = lines.slice(15);
  if (after15.length < 5) throw new Error('CSV incomplete after header row.');

  const headers = (after15[0] || '').split(',').map(h => h.trim());
  const dataRows = after15.slice(4).filter(r => r && r.includes(','));
  if (!headers.length || !dataRows.length) throw new Error('No headers or data rows found.');

  const colIndex = (name) => headers.findIndex(h => h === name);
  const speedIdx = colIndex('Vehicle Speed (SAE)');
  const timeIdx  = colIndex('Offset');

  if (speedIdx === -1 || timeIdx === -1) throw new Error('Required columns missing (Vehicle Speed (SAE), Offset).');

  const speed = [];
  const time = [];
  for (const row of dataRows) {
    const cols = row.split(',');
    const s = parseFloat(cols[speedIdx]);
    const t = parseFloat(cols[timeIdx]);
    if (Number.isFinite(s) && Number.isFinite(t)) {
      speed.push(s);
      time.push(t);
    }
  }
  return { speed, time };
}

function findAllRuns(speed, time, startMPH, endMPH) {
  const runs = [];
  let startTime = null;
  let foundStop = false;

  for (let i = 1; i < speed.length; i++) {
    const v = speed[i];

    if (startMPH === 0) {
      if (!foundStop && v < 1.5) foundStop = true;
      if (foundStop && startTime === null && v > 1.5) startTime = time[i];
    } else {
      if (startTime === null && v >= startMPH && v < endMPH) startTime = time[i];
    }

    if (startTime !== null && v >= endMPH) {
      const endTime = time[i];
      const duration = +(endTime - startTime).toFixed(3);
      const seg = { startTime, endTime, duration, data: [] };
      for (let j = 0; j < speed.length; j++) {
        if (time[j] >= startTime && time[j] <= endTime) {
          seg.data.push({ x: +(time[j] - startTime).toFixed(3), y: speed[j] });
        }
      }
      runs.push(seg);
      startTime = null;
      if (startMPH === 0) foundStop = false;
    }

    if (startTime !== null && v > endMPH + 10) startTime = null;
  }
  return runs;
}

function bestForInterval(speed, time, interval) {
  const ranges = { '0-60': [0, 60], '40-100': [40, 100], '60-130': [60, 130] };
  const [startMPH, endMPH] = ranges[interval] || [60, 130];
  const runs = findAllRuns(speed, time, startMPH, endMPH);
  if (!runs.length) return null;
  return runs.reduce((min, r) => (r.duration < min.duration ? r : min));
}

/**
 * GET /api/run/:id?interval=60-130
 * Returns { meta..., trace: [{x,y}], timeSeconds }
 */
router.get('/api/run/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const interval = (req.query.interval || '60-130').toString();

    // load minimal row incl. storage path
    const { data: row, error } = await supabase
      .from('runs')
      .select(`
        id, user_alias, created_at, interval, time_seconds,
        log_path,
        vehicle_year, vehicle_model, vehicle_engine, vehicle_injectors,
        vehicle_map, vehicle_throttle, vehicle_power, vehicle_trans,
        vehicle_tire, vehicle_gear, vehicle_fuel
      `)
      .eq('id', id)
      .single();

    if (error || !row) {
      return res.status(404).json({ error: 'Run not found' });
    }

    if (!row.log_path) {
      return res.status(400).json({ error: 'Run has no stored CSV' });
    }

    // download CSV bytes from storage
    const { data: file, error: dErr } = await supabase.storage
      .from('logs')
      .download(row.log_path);

    if (dErr || !file) {
      return res.status(502).json({ error: 'Failed to download log CSV' });
    }

    const raw = await file.text();
    const { speed, time } = parseHPTCsv(raw);
    const best = bestForInterval(speed, time, interval);

    if (!best) {
      return res.status(200).json({
        meta: row,
        trace: [],
        timeSeconds: null,
        interval
      });
    }

    return res.json({
      meta: row,
      trace: best.data,          // [{x, y}] time-from-launch vs mph
      timeSeconds: best.duration,
      interval
    });
  } catch (e) {
    console.error('run detail failed:', e.message);
    res.status(500).json({ error: 'run-detail failed' });
  }
});

module.exports = router;
