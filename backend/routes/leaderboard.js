// backend/routes/leaderboard.js
const express = require('express');
const router = express.Router();

// ✅ Shared Supabase client (keep lowercase "lib")
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
 * - dir: "asc" | "desc" (default "asc" for time, "desc" for created_at if specified)
 */
router.get('/api/leaderboard', async (req, res) => {
  try {
    const {
      interval,
      limit = '20',
      offset = '0',
      name,
      year, model, engine, injectors, map, throttle, power, trans, tire, gear, fuel, vin,
      sort = 'time_seconds',
      dir
    } = req.query;

    // Required for meaningful leaderboard
    if (!interval || typeof interval !== 'string' || !interval.trim()) {
      return res.status(400).json({ error: 'Missing required query param: interval' });
    }

    // sanitize pagination
    const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const off = Math.max(parseInt(offset, 10) || 0, 0);

    // sanitize sort
    const validSort = ['time_seconds', 'created_at'];
    const sortCol = validSort.includes(String(sort)) ? String(sort) : 'time_seconds';
    // default dir per column
    let sortDir = (dir || '').toLowerCase();
    if (sortCol === 'time_seconds' && !['asc', 'desc'].includes(sortDir)) sortDir = 'asc';
    if (sortCol === 'created_at' && !['asc', 'desc'].includes(sortDir)) sortDir = 'desc';

    // Build base query
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
      `, { count: 'exact' })
      .eq('interval', interval);

    // exact-match filters (if provided)
    const exactFilters = {
      vehicle_year: year,
      vehicle_model: model,
      vehicle_engine: engine,
      vehicle_injectors: injectors,
      vehicle_map: map,
      vehicle_throttle: throttle,
      vehicle_power: power,
      vehicle_trans: trans,
      vehicle_tire: tire,
      vehicle_gear: gear,
      vehicle_fuel: fuel,
      vin: vin
    };
    for (const [col, val] of Object.entries(exactFilters)) {
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        query = query.eq(col, String(val).trim());
      }
    }

    // partial match on alias
    if (name && String(name).trim() !== '') {
      query = query.ilike('user_alias', `%${String(name).trim()}%`);
    }

    // order + pagination
    query = query
      .order(sortCol, {
        ascending: sortDir !== 'desc',
        // for time_seconds, we do NULLS LAST; for created_at, default nulls first true is fine,
        // but we’ll set explicitly for consistency:
        nullsFirst: sortCol === 'time_seconds' ? false : true
      })
      // tiebreaker for stable order:
      .order('created_at', { ascending: true })
      .range(off, off + lim - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('Leaderboard query error:', error);
      return res.status(502).json({ error: 'Leaderboard query failed.' });
    }

    res.json({
      ok: true,
      interval,
      sort: sortCol,
      dir: sortDir,
      total: count ?? data?.length ?? 0,
      offset: off,
      limit: lim,
      results: data || []
    });
  } catch (err) {
    console.error('Leaderboard handler failed:', err);
    res.status(500).json({ error: 'leaderboard failed.' });
  }
});

module.exports = router;
