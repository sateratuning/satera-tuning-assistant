// backend/routes/aiReview.js
const express = require('express');
const router = express.Router();
const { OpenAI } = require('openai');

const REQUIRED_ENUMS = {
  engine: ['Pre-eagle 5.7L','6.1L','Eagle 5.7L','6.4L','Hellcat 6.2L','HO Hellcat 6.2L','Other'],
  power_adder: ['N/A','Centrifugal','PD Blower','Turbo','Nitrous'],
  fuel: ['91','93','E85','E70-E79','Race Gas','Other'],
  trans: ['Manual','5-speed auto','8-speed auto','Other'],
  nn: ['Enabled','Disabled'],
};

function validateMods(mods) {
  const missing = [];
  ['engine','power_adder','fuel','trans','nn'].forEach(k => { if (!mods?.[k]) missing.push(k); });
  Object.entries(REQUIRED_ENUMS).forEach(([k, list]) => {
    if (mods?.[k] && !list.includes(mods[k])) missing.push(`${k}:invalid`);
  });
  return missing;
}

function sanitizeTone(text) {
  if (!text) return text;
  const replacements = [
    [/the tune is (too|overly) aggressive/gi, 'the current timing/load behavior shows signs that may merit further review'],
    [/retard (timing|spark) by [\d\.\-]+°/gi, 'consider further investigation based on your process'],
    [/\bboost(ed)?\s?(?:psi|levels?)?\b/gi, 'intake pressure behavior'],
    [/you should/gi, 'it may be worth'],
    [/\bfix\b/gi, 'address'],
    [/\bincorrect\b/gi, 'inconsistent'],
  ];
  let out = text;
  for (const [re, rep] of replacements) out = out.replace(re, rep);
  return out;
}

function buildSystemPrompt({ mods }) {
  return [
`You are an automotive log *assessor* for Gen 3 HEMI vehicles.`,
`HARD RULES:`,
`- Do NOT recommend tuning changes. Do NOT provide prescriptive edits.`,
`- Use neutral, advisory language: “signals”, “indicates”, “may merit review”.`,
`- If power_adder = N/A, do NOT mention boost, psi, or boosted behavior.`,
`- Focus only on these 10 checks, in this order:`,
`  1. Knock events (amount and RPM)`,
`  2. Peak spark timing under WOT (Throttle >85%) with RPM`,
`  3. MAP sensor range under WOT`,
`  4. Knock sensor voltages > 3.0V`,
`  5. Fuel trim variance between banks (>10%)`,
`  6. Average fuel correction per bank`,
`  7. Oil pressure drops (below 20 psi when RPM > 500)`,
`  8. Coolant temperature (above 230°F)`,
`  9. Misfires per cylinder`,
` 10. Best acceleration times (0–60, 40–100, 60–130 mph)`,
`- Output sections: Summary, then the 10 items above in order, then Next Steps.`,
`- Next Steps: only neutral suggestions (mechanical checks, further logging, sensor verification).`,
  ].join('\n');
}

function buildUserPrompt({ vehicle, mods, metrics }) {
  return [
`VEHICLE: ${vehicle?.year || ''} ${vehicle?.model || ''} | Engine: ${mods.engine} | Trans: ${mods.trans}`,
`MODS: Power Adder: ${mods.power_adder} | Fuel: ${mods.fuel} | NN: ${mods.nn}`,
`KEY METRICS:`,
`- Knock events: ${metrics.knock?.length ? JSON.stringify(metrics.knock) : 'None'}`,
`- Peak timing: ${metrics.peakTiming}° @ ${metrics.peakTimingRPM} RPM`,
`- MAP under WOT: ${metrics.mapWOTmin || 'N/A'} – ${metrics.mapWOTmax || 'N/A'} kPa`,
`- Knock Sensor Voltages: B1 ${metrics.ks1max} V, B2 ${metrics.ks2max} V`,
`- Fuel trim variance: ${metrics.varFT?.toFixed(1)}%`,
`- Avg Fuel Corr: B1 ${metrics.avgFT1?.toFixed(1)}%, B2 ${metrics.avgFT2?.toFixed(1)}%`,
`- Oil min: ${metrics.oilMin} psi`,
`- ECT max: ${metrics.ectMax} °F`,
`- Misfires: ${JSON.stringify(metrics.misfires)}`,
`- 0–60 mph: ${metrics.zeroTo60 || 'N/A'}`,
`- 40–100 mph: ${metrics.fortyTo100 || 'N/A'}`,
`- 60–130 mph: ${metrics.sixtyTo130 || 'N/A'}`,
`Please produce a neutral assessment using these values, following the 10-item checklist strictly.`,
  ].join('\n');
}

router.post('/ai-review', async (req, res) => {
  try {
    const { vehicle, mods, metrics } = req.body || {};
    const missing = validateMods(mods);
    if (missing.length) return res.status(400).json({ error: 'Missing or invalid fields', fields: missing });

    const system = buildSystemPrompt({ mods });
    const user = buildUserPrompt({ vehicle, mods, metrics });

    const openai = new OpenAI();
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_tokens: 600,
    });

    let text = resp.choices?.[0]?.message?.content || '';
    text = sanitizeTone(text);

    if (mods.power_adder === 'N/A') {
      text = text
        .split('\n')
        .filter(line => !/\b(boost|psi|boosted)\b/i.test(line))
        .join('\n');
    }

    return res.json({ ok: true, assessment: text });
  } catch (e) {
    console.error('ai-review error', e);
    return res.status(500).json({ error: 'AI review failed' });
  }
});

module.exports = router;
