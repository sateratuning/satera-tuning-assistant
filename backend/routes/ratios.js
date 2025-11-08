// backend/routes/ratios.js
const express = require('express');
const router = express.Router();
const TABLE = require('../ratios/ratios');

router.get('/', (req, res) => {
  const trans = String(req.query.trans || '').trim();
  if (!trans) return res.json({ ok: true, transmissions: Object.keys(TABLE) });

  const data = TABLE[trans];
  if (!data) return res.status(404).json({ ok: false, error: 'Unknown transmission' });

  // Return in a stable order, plus a flat list for convenience
  const entries = Object.entries(data).sort((a,b)=> {
    // numeric sort by the leading number in "5th", "6th", etc. fallback alpha
    const na = parseInt(a[0], 10), nb = parseInt(b[0], 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a[0].localeCompare(b[0]);
  });

  res.json({
    ok: true,
    transmission: trans,
    gears: entries.map(([label, ratio]) => ({ label, ratio }))
  });
});

module.exports = router;
