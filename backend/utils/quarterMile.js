// backend/utils/quarterMile.js
// ============================================================
// Estimate 1/4 mile trap speed and ET from a 60-130 mph time.
//
// The trap-speed table is a transcription of Satera Tuning's
// reference chart. Values between rows are linearly interpolated;
// values outside the chart's 2.0-12.0 s span are reported as
// out-of-range rather than extrapolated.
//
// ET is derived from trap speed using the standard racer's
// approximation ET ~= 1326 / trap_mph. Because a 60-130 time
// excludes the launch entirely, the ET figure assumes the car
// hooks — it is a potential, not a prediction.
// ============================================================

// [ 60-130 time (s), 1/4 mile trap speed (mph) ]
const TRAP_TABLE = [
  [12.0,109  ],[11.9,109.5],[11.8,110  ],[11.7,110.5],[11.6,111  ],
  [11.5,111.5],[11.4,112  ],[11.3,112.5],[11.2,113  ],[11.1,113.5],
  [11.0,114  ],[10.9,114.5],[10.8,115  ],[10.7,115.5],[10.6,116  ],
  [10.5,116.5],[10.4,117  ],[10.3,117.5],[10.2,118  ],[10.1,118.5],
  [10.0,119  ],[ 9.9,119.5],[ 9.8,120  ],[ 9.7,120.5],[ 9.6,121  ],
  [ 9.5,121.5],[ 9.4,122  ],[ 9.3,122.5],[ 9.2,123  ],[ 9.1,123.5],
  [ 9.0,124  ],[ 8.9,124.5],[ 8.8,125  ],[ 8.7,125.5],[ 8.6,126  ],
  [ 8.5,126.5],[ 8.4,127  ],[ 8.3,127.5],[ 8.2,128  ],[ 8.1,128.5],
  [ 8.0,129  ],[ 7.9,129.5],[ 7.8,130  ],[ 7.7,130.5],[ 7.6,131  ],
  [ 7.5,131.5],[ 7.4,132  ],[ 7.3,132.5],[ 7.2,133  ],[ 7.1,133.5],
  [ 7.0,134  ],[ 6.9,134.5],[ 6.8,135  ],[ 6.7,135.5],[ 6.6,136  ],
  [ 6.5,136.5],[ 6.4,137  ],[ 6.3,137.5],[ 6.2,138  ],[ 6.1,138.5],
  [ 6.0,139  ],[ 5.9,140  ],[ 5.8,142  ],[ 5.7,143  ],[ 5.6,144  ],
  [ 5.5,145  ],[ 5.4,146  ],[ 5.3,147  ],[ 5.2,148  ],[ 5.1,148.5],
  [ 5.0,149  ],[ 4.9,149.5],[ 4.8,150  ],[ 4.7,151  ],[ 4.6,152  ],
  [ 4.5,153  ],[ 4.4,154.25],[4.3,155.5],[ 4.2,156  ],[ 4.1,157.5],
  [ 4.0,159  ],[ 3.9,160.5],[ 3.8,161.75],[3.7,163  ],[ 3.6,164.25],
  [ 3.5,165.5],[ 3.4,166.75],[3.3,168  ],[ 3.2,169.25],[3.1,170.5],
  [ 3.0,171.75],[2.9,173  ],[ 2.8,174.5],[ 2.7,176  ],[ 2.6,177.5],
  [ 2.5,180  ],[ 2.4,182  ],[ 2.3,184  ],[ 2.2,186  ],[ 2.1,188  ],
  [ 2.0,190  ],
];

const MIN_T = 2.0;
const MAX_T = 12.0;

/** Trap speed (mph) for a 60-130 time, linearly interpolated. */
function trapSpeedFor(seconds) {
  const t = Number(seconds);
  if (!Number.isFinite(t)) return null;
  if (t > MAX_T || t < MIN_T) return null;          // outside the chart

  // Table is ordered slowest -> quickest (12.0 down to 2.0)
  for (let i = 0; i < TRAP_TABLE.length - 1; i++) {
    const [tHi, mphLo] = TRAP_TABLE[i];      // slower time, lower mph
    const [tLo, mphHi] = TRAP_TABLE[i + 1];  // quicker time, higher mph
    if (t <= tHi && t >= tLo) {
      if (tHi === tLo) return mphLo;
      const f = (tHi - t) / (tHi - tLo);
      return mphLo + (mphHi - mphLo) * f;
    }
  }
  return null;
}

/** ET (s) from trap speed — standard racer's approximation. */
function etFromTrap(mph) {
  const m = Number(mph);
  if (!Number.isFinite(m) || m <= 0) return null;
  return 1326 / m;
}

// Spread applied to the charted trap speed. Weight, aero, gearing and
// density altitude all move the real number, so a point estimate would
// be false precision.
const TRAP_SPREAD_MPH = 1.5;
// Extra ET allowance on top of the trap-derived band: unlike trap speed,
// ET is sensitive to the launch, which a 60-130 never sees.
const ET_EXTRA_S = 0.10;

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Full estimate from a 60-130 mph time.
 * Trap and ET are both returned as ranges; the ET band is derived from
 * the trap band so the two can never disagree.
 */
function estimateQuarterMile(sixtyTo130) {
  const t = Number(sixtyTo130);
  if (!Number.isFinite(t)) return null;

  if (t > MAX_T) {
    return { sixtyTo130: t, trapMph: null, et: null, inRange: false,
      note: `A 60-130 of ${t.toFixed(2)}s is slower than the reference chart covers (12.0s max).` };
  }
  if (t < MIN_T) {
    return { sixtyTo130: t, trapMph: null, et: null, inRange: false,
      note: `A 60-130 of ${t.toFixed(2)}s is quicker than the reference chart covers (2.0s min).` };
  }

  const trapMid = trapSpeedFor(t);
  if (trapMid == null) return null;

  const trapLow  = trapMid - TRAP_SPREAD_MPH;
  const trapHigh = trapMid + TRAP_SPREAD_MPH;

  // A faster trap implies a quicker ET, so the bounds cross over.
  const etLow  = etFromTrap(trapHigh) - ET_EXTRA_S;
  const etHigh = etFromTrap(trapLow)  + ET_EXTRA_S;
  const etMid  = etFromTrap(trapMid);

  return {
    sixtyTo130: t,
    trapMph:    r1(trapMid),
    trapLow:    r1(trapLow),
    trapHigh:   r1(trapHigh),
    trapRange:  `${r1(trapLow).toFixed(1)}-${r1(trapHigh).toFixed(1)} mph`,
    et:         r2(etMid),
    etLow:      r2(etLow),
    etHigh:     r2(etHigh),
    etRange:    `${r2(etLow).toFixed(2)}-${r2(etHigh).toFixed(2)}s`,
    inRange:    true,
    note:       'Estimated from the 60-130 time, which excludes the launch — assumes the car hooks.',
  };
}

/** One-line checklist string, or null. */
function quarterMileStat(sixtyTo130) {
  const e = estimateQuarterMile(sixtyTo130);
  if (!e || !e.inRange) return null;
  return `STAT: Estimated 1/4 mile: ${e.trapRange} trap, ${e.etRange} ET`;
}

module.exports = { estimateQuarterMile, trapSpeedFor, etFromTrap, quarterMileStat, TRAP_TABLE };
