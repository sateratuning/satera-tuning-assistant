// backend/routes/leaderboard.js
const express = require('express');
const router = express.Router();

const getSupabase = require('../Lib/supabase');
const supabase = getSupabase();

/**
 * GET /api/leaderboard
 *
 * Query params:
 * - interval: "0-60" | "40-100" | "60-130" (required)
 * - limit: number (default 20, max 100)
 * - offset: number (default 0)
 * - name: string (optional; partial match on user_alias)
 * - year, model, engine, injectors, map, throttle, power, trans, tire, gear, fuel, vin (optional exact matches)
 * - sort: "time_seconds" | "created_at" (default "time_seconds")
 * - dir: "asc" | "desc"
 *
 * Deduplication: only the BEST run per user_alias is shown.
 * If a user has submitted multiple times with identical filters,
 * only their fastest time appears on the leaderboard.
 */
router.get('/api/leaderboard', async (req, res) => {
  try {
    const {
      interval,
      limit = '50',
      offset = '0',
      name,
      year, model, engine, injectors, map, throttle, power, trans, tire, gear, fuel, vin,
      sort = 'time_seconds',
      dir
    } = req.query;

    if (!interval || typeof interval !== 'string' || !interval.trim()) {
      return res.status(400).json({ error: 'Missing required query param: interval' });
    }

    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const off = Math.max(parseInt(offset, 10) || 0, 0);

    const validSort = ['time_seconds', 'created_at'];
    const sortCol = validSort.includes(String(sort)) ? String(sort) : 'time_seconds';
    let sortDir = (dir || '').toLowerCase();
    if (sortCol === 'time_seconds' && !['asc', 'desc'].includes(sortDir)) sortDir = 'asc';
    if (sortCol === 'created_at'  && !['asc', 'desc'].includes(sortDir)) sortDir = 'desc';

    // ── Fetch a larger pool so deduplication doesn't starve the page ──
    // We fetch up to 500 rows, deduplicate, then slice to the requested limit.
    const FETCH_LIMIT = 500;

    let query = supabase
      .from('runs')
      .select(`
        id,
        created_at,
        user_alias,
        interval,
        time_seconds,
        vin,
        vehicle_year,
        vehicle_model,
        vehicle_engine,
        vehicle_injectors,
        vehicle_map,
        vehicle_throttle,
        vehicle_power,
        vehicle_trans,
        vehicle_tire,
        vehicle_gear,
        vehicle_fuel
      `)
      .eq('interval', interval);

    // Exact-match filters
    const exactFilters = {
      vehicle_year:     year,
      vehicle_model:    model,
      vehicle_engine:   engine,
      vehicle_injectors:injectors,
      vehicle_map:      map,
      vehicle_throttle: throttle,
      vehicle_power:    power,
      vehicle_trans:    trans,
      vehicle_tire:     tire,
      vehicle_gear:     gear,
      vehicle_fuel:     fuel,
      vin:              vin
    };
    for (const [col, val] of Object.entries(exactFilters)) {
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        query = query.eq(col, String(val).trim());
      }
    }

    if (name && String(name).trim() !== '') {
      query = query.ilike('user_alias', `%${String(name).trim()}%`);
    }

    // Always fetch sorted by time asc first so best runs come first naturally
    query = query
      .order('time_seconds', { ascending: true, nullsFirst: false })
      .order('created_at',   { ascending: true })
      .range(0, FETCH_LIMIT - 1);

    const { data, error } = await query;

    if (error) {
      console.error('Leaderboard query error:', error);
      return res.status(502).json({ error: 'Leaderboard query failed.' });
    }

    const rows = data || [];

    // ── Deduplicate: keep only best run per user_alias ──
    // Since rows are already sorted time_seconds ASC, the first occurrence
    // of each user is always their best run.
    const seen = new Set();
    const deduped = [];
    for (const row of rows) {
      const key = (row.user_alias || '__anon__').toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(row);
      }
    }

    // ── Re-sort deduplicated results per requested sort ──
    if (sortCol === 'created_at') {
      deduped.sort((a, b) => {
        const da = new Date(a.created_at).getTime();
        const db = new Date(b.created_at).getTime();
        return sortDir === 'asc' ? da - db : db - da;
      });
    } else {
      // time_seconds (default)
      deduped.sort((a, b) => {
        const ta = a.time_seconds ?? Infinity;
        const tb = b.time_seconds ?? Infinity;
        return sortDir === 'desc' ? tb - ta : ta - tb;
      });
    }

    // ── Paginate ──
    const total   = deduped.length;
    const results = deduped.slice(off, off + lim);

    res.json({
      ok: true,
      interval,
      sort: sortCol,
      dir: sortDir,
      total,
      offset: off,
      limit: lim,
      results
    });
  } catch (err) {
    console.error('Leaderboard handler failed:', err);
    res.status(500).json({ error: 'leaderboard failed.' });
  }
});

module.exports = router;
