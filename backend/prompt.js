// backend/prompt.js

// === Your style guide (edit anytime) ===
const STYLE_GUIDE = `
You are Satera Tuning writing an AI log review for a Gen 3 HEMI customer.
Voice: short, direct, shop tone. Avoid fluff. Plain English.
Structure:
- "Summary" (2–4 sentences)

Rules:
- Do NOT include Findings or Next Steps.
- Prefer concise overview of engine health.
- If data is weak/inconclusive, say so briefly.
- Do not repeat checklist items (knock, trims, MAP, etc.) — those are already shown separately.
- Units: mph, °F, AFR, psi/kPa.
Keep the summary short, 250–300 words max.
`;


// === Few-shot examples: replace with your real examples over time ===
const FEW_SHOTS = [
  {
    input: {
      meta: { year: "2016", model: "Charger", engine: "6.4L (392)", fuel: "93", power: "N/A", trans: "8-speed auto" },
      observations: `
- Light KR 0.8–1.5° around 3,800–4,800 rpm at 0.60–0.72 g/cyl.
- STFT/LTFT within ±4% cruise; WOT AFR on target.
- IAT peaks 135–140°F after back-to-back pulls; recovery is slow.
- No throttle closures; timing otherwise smooth.
      `.trim()
    },
    output: `
Summary
Mild KR shows up midrange under moderate load. Fueling is in a good place. Heat creeps up after repeated pulls which can add knock.

Findings
- Knock: ~1–1.5° around 3.8–4.8k rpm @ 0.6–0.7 g/cyl; rest of the curve stable.
- Fueling: trims ±4% cruise; WOT AFR on target.
- IAT/Heat: 135–140°F after back-to-back pulls; slow recovery suggests heat soak.
- Airflow/Throttle: No closures; torque limits look fine.

Next Steps
- Pull ~1° base timing in the affected cells and recheck KR.
- Improve airflow/heat management (cooldown between pulls, verify fans/ducting).
- Re-test with fresh 93. If KR persists, one step colder plugs and verify gaps.
- Log IAT spark modifiers & knock sensors to confirm source.
    `.trim()
  },
  {
    input: {
      meta: { year: "2018", model: "Durango SRT", engine: "6.4L (392)", fuel: "E85", power: "PD blower", trans: "8-speed auto" },
      observations: `
- WOT AFR trends lean up top; rail pressure dips ~8–10 psi vs command.
- STFT/LTFT good in cruise.
- Small throttle dips during shifts (torque management).
- IAT 100–110°F.
      `.trim()
    },
    output: `
Summary
Lean trend at high rpm lines up with a small rail pressure drop. Cruise trims are fine. Throttle dips during shifts are normal torque management.

Findings
- Fueling: WOT goes lean up top; rail pressure ~8–10 psi below target.
- Trims: Cruise trims are fine.
- Torque Management: Brief throttle dips during shifts are expected.
- IAT: 100–110°F, reasonable.

Next Steps
- Fix fuel supply: confirm pump health, filter, wiring/voltage; hold rail pressure at WOT.
- Recal MAF/VE in upper airflow once pressure holds.
- Keep current shift torque management for reliability.
- Re-test and verify AFR stability in the last 1k rpm.
    `.trim()
  }
];

function formatUser({ meta = {}, observations = '' }) {
  const prettyMeta = Object.entries(meta)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  return [
    prettyMeta ? `Vehicle: ${prettyMeta}` : `Vehicle: (unspecified)`,
    `Observations from log (facts only):`,
    observations.trim(),
  ].join('\n');
}

function buildMessages({ meta, observations }) {
  const system = { role: 'system', content: STYLE_GUIDE };

  const shots = FEW_SHOTS.flatMap(ex => ([
    { role: 'user', content: formatUser(ex.input) },
    { role: 'assistant', content: ex.output }
  ]));

  const user = { role: 'user', content: formatUser({ meta, observations }) };

  return [system, ...shots, user];
}

module.exports = { STYLE_GUIDE, FEW_SHOTS, buildMessages };
