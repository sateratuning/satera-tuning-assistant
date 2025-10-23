import React from 'react';

/**
 * BoostSummary
 * Parses the "checklist" text returned by /ai-review (left side before ===SPLIT===)
 * and displays Peak Boost, Average Boost (WOT), and Boost @ Highest RPM.
 *
 * Usage:
 *   <BoostSummary checklistText={leftText} />
 */
export default function BoostSummary({ checklistText = '' }) {
  if (typeof checklistText !== 'string' || !checklistText.trim()) return null;

  // Robust regexes to match what backend emits (including emojis and optional RPMs)
  const peakMatch = checklistText.match(/Peak Boost.*?:\s*([\d.]+)\s*psi(?:\s*@\s*(\d+)\s*RPM)?/i);
  const avgMatch = checklistText.match(/Average Boost.*?:\s*([\d.]+)\s*psi/i);
  const highestMatch = checklistText.match(/Boost\s*@\s*Highest RPM(?:\s*\((\d+)\s*RPM\))?:\s*([\d.]+)\s*psi/i);

  const peakPsi = peakMatch ? Number(peakMatch[1]) : null;
  const peakRpm = peakMatch && peakMatch[2] ? Number(peakMatch[2]) : null;

  const avgPsi = avgMatch ? Number(avgMatch[1]) : null;

  const highestRpm = highestMatch && highestMatch[1] ? Number(highestMatch[1]) : null;
  const highestPsi = highestMatch ? Number(highestMatch[2]) : null;

  const hasAny =
    (Number.isFinite(peakPsi)) ||
    (Number.isFinite(avgPsi)) ||
    (Number.isFinite(highestPsi));

  if (!hasAny) return null;

  // Simple, framework-agnostic styling so it looks good without touching your CSS
  const card = {
    borderRadius: 12,
    padding: '12px 14px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
  };
  const grid = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 12,
    marginTop: 12,
    marginBottom: 8,
  };
  const label = { fontSize: 12, opacity: 0.75, letterSpacing: 0.3, marginBottom: 6 };
  const value = { fontSize: 20, fontWeight: 700 };
  const sub = { fontSize: 12, opacity: 0.7, marginTop: 2 };

  return (
    <section aria-label="Boost Summary">
      <h3 style={{ fontSize: 16, fontWeight: 700, marginTop: 8, marginBottom: 4 }}>
        Boost (PSI)
      </h3>
      <div style={grid}>
        {Number.isFinite(peakPsi) && (
          <div style={card}>
            <div style={label}>Peak Boost</div>
            <div style={value}>
              {peakPsi.toFixed(2)} <span style={{ opacity: 0.7, fontSize: 14 }}>psi</span>
            </div>
            {Number.isFinite(peakRpm) && (
              <div style={sub}>at {peakRpm.toFixed(0)} RPM</div>
            )}
          </div>
        )}
        {Number.isFinite(avgPsi) && (
          <div style={card}>
            <div style={label}>Average Boost (WOT ≥ 86% TPS)</div>
            <div style={value}>
              {avgPsi.toFixed(2)} <span style={{ opacity: 0.7, fontSize: 14 }}>psi</span>
            </div>
          </div>
        )}
        {Number.isFinite(highestPsi) && (
          <div style={card}>
            <div style={label}>Boost @ Highest RPM</div>
            <div style={value}>
              {highestPsi.toFixed(2)} <span style={{ opacity: 0.7, fontSize: 14 }}>psi</span>
            </div>
            {Number.isFinite(highestRpm) && (
              <div style={sub}>({highestRpm.toFixed(0)} RPM)</div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
