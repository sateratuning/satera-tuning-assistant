// frontend/src/ui/advice.js
// Keep it short, shop-voice, no fluff. You can tweak this file anytime.

export const SateraTone = {
  // global knobs if you want a different tone later
  maxBulletsPerIssue: 3,   // keep it concise
  showSeverityBadges: true // hide if you want a cleaner look
};

export const ADVICE_RULES = [
  {
    id: 'knock',
    label: 'Knock / KR',
    severity: 'high',
    match: /(knock|kr|knock retard|timing pulled|detonation)/i,
    bullets: [
      'Lower spark where KR shows up (same RPM/load).',
      'Fresh fuel / higher octane if borderline.',
      'High IATs? Improve cooling or reduce IAT timing adders.'
    ],
  },
  {
    id: 'lean',
    label: 'Lean / High AFR',
    severity: 'high',
    match: /(lean|afr.*(>|\bhigh\b)|lambda.*high|p0171|p0174|stft.*(>|high)|ltft.*(>|high))/i,
    bullets: [
      'Pressure test for leaks (vacuum/charge).',
      'Log fuel pressure under load; confirm pump/regulator.',
      'Correct injector data and MAF/VE where it happens.'
    ],
  },
  {
    id: 'rich',
    label: 'Rich / Low AFR',
    severity: 'med',
    match: /(rich|afr.*(<|\blow\b)|lambda.*low)/i,
    bullets: [
      'MAF/VE likely high in those cells; trim down.',
      'Check injector scaling & short pulse adders.',
      'Verify fuel pressure isn’t excessive.'
    ],
  },
  {
    id: 'iat',
    label: 'High IAT',
    severity: 'med',
    match: /(iat|intake air temp|charge temp|heat soak)/i,
    bullets: [
      'Improve airflow/IC; watch heat soak between pulls.',
      'Reduce IAT timing adders where needed.'
    ],
  },
  {
    id: 'boost',
    label: 'Boost / MAP',
    severity: 'med',
    match: /(map.*kpa|boost|overboost|underboost|wastegate|bov)/i,
    bullets: [
      'Pressure test charge pipes/couplers.',
      'Verify WG spring/duty & BOV function.',
      'Confirm MAP sensor scaling matches tune.'
    ],
  },
  {
    id: 'fuel_press',
    label: 'Fuel Pressure',
    severity: 'high',
    match: /(fuel pressure|rail pressure|low side|high side|hpfp|lpfp)/i,
    bullets: [
      'Compare commanded vs actual at WOT.',
      'Check filter and wiring/voltage drop.',
      'Reduce demand until pressure is stable.'
    ],
  },
  {
    id: 'misfire',
    label: 'Misfires',
    severity: 'med',
    match: /(misfire|p03\d\d|p0300|ignition)/i,
    bullets: [
      'Plugs: heat range, gap, condition. Check coils/boots.',
      'Lean cylinder? Inspect trims & cylinder balance.',
      'If persistent: compression/leakdown.'
    ],
  },
  {
    id: 'throttle',
    label: 'Throttle/Torque Limit',
    severity: 'low',
    match: /(throttle close|torque management|driver demand|airflow limit|throttle limit)/i,
    bullets: [
      'Raise driver demand & airflow limits in the area.',
      'Fix torque model if over-reporting.',
      'Check TC or trans torque intervention.'
    ],
  },
  {
    id: 'idle',
    label: 'Idle Hunt/Surge',
    severity: 'low',
    match: /(idle.*hunt|stall|surge)/i,
    bullets: [
      'Set base running airflow; tweak P/I.',
      'Vacuum leaks? Fix first.',
      'Verify injector data at low PW.'
    ],
  },
];

export function deriveAdvice(reviewText) {
  const t = (reviewText || '').toLowerCase();
  const hits = ADVICE_RULES.filter(r => r.match.test(t));
  if (!hits.length && reviewText?.trim()) {
    return [{
      id: 'ok',
      label: 'No Critical Flags',
      severity: 'low',
      bullets: [
        'Timing/airflow smoothing in active cells usually helps.',
        'Keep trims within ±5% and confirm WOT AFR target.',
        'Watch IATs for consistent repeatability.'
      ]
    }];
  }
  return hits.map(r => ({
    id: r.id,
    label: r.label,
    severity: r.severity,
    bullets: r.bullets.slice(0, SateraTone.maxBulletsPerIssue)
  }));
}
