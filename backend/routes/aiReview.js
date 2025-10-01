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
  // Required presence
  ['engine','power_adder','fuel','trans','nn'].forEach(k => { if (!mods?.[k]) missing.push(k); });
  // Enum checks
  Object.entries(REQUIRED_ENUMS).forEach(([k, list]) => {
    if (mods?.[k] && !list.includes(mods[k])) missing.push(`${k}:invalid`);
  });
  return missing;
}

function sanitizeTone(text) {
  if (!text) return text;
  // Convert blamey/reco language to neutral observations
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
  const isNA = mods.power_adder === 'N/A';
  return [
`You are an automotive log *assessor* for Gen 3 HEMI vehicles. Your job is to neutrally describe what the log shows.`,
`HARD RULES:`,
`- Do NOT recommend tuning changes. Do NOT provide degrees, percentages, or prescriptive edits.`,
`- Do NOT blame the tuner or owner. Use neutral language: “signals”, “indicates”, “may merit review”.`,
`- If the vehicle is Naturally Aspirated (power_adder = N/A), do NOT mention boost, psi, or boosted behavior. Interpret MAP only as atmospheric/reference.`,
`- If power_adder is not N/A, you may discuss boosted behavior, but still avoid prescriptive edits.`,
`- Focus on: knock events (amount/RPM), WOT timing peaks, MAP range when TPS>85%, knock sensor peak volts, fuel-trim variance, average fuel correction by RPM, oil pressure dips (RPM>500), coolant temp >230°F, misfire counts.`,
`- Output sections: Summary, Knock, Timing @ WOT, MAP @ High TPS, Fuel Trims, Sensor Flags, Temps/Oil, Misfires, Next Steps.`,
`- “Next Steps” should be *non-prescriptive* suggestions for further checks (mechanical, logging more channels, verifying sensors, etc.), never tune edits.`,
  ].join('\n');
}

function buildUserPrompt({ vehicle, mods, sample, columns }) {
  return [
`VEHICLE: ${vehicle?.year || ''} ${vehicle?.model || ''} | Engine: ${mods.engine} | Trans: ${mods.trans}`,
`MODS: Power Adder: ${mods.power_adder} | Fuel: ${mods.fuel} | Injectors: ${mods.injectors || 'Unknown'} | MAP: ${mods.map || 'OEM'} | TB: ${mods.throttle || 'OEM'} | NN: ${mods.nn}`,
`DATA COLUMNS (subset): ${columns.join(', ')}`,
`SAMPLED ROWS (every ~400th):`,
'```csv',
sample.map(r => r.join(',')).join('\n'),
'```',
`Please produce the neutral *assessment* per the HARD RULES.`,
  ].join('\n');
}

// util: thin CSV sampling already done upstream; keep interface compatible
function pickColumnsForAI(rows, headers) {
  // Only send what’s necessary
  const keep = ['Engine RPM','Cylinder Airmass','Knock Retard','Vehicle Speed (SAE)','Manifold Absolute Pressure','Throttle Position','Knock Sensor 1','Knock Sensor 2'];
  const idx = keep.map(name => headers.indexOf(name)).filter(i => i >= 0);
  const columns = idx.map(i => headers[i]);
  const sampled = rows.map(r => idx.map(i => r[i]));
  return { sampled, columns };
}

router.post('/ai-review', async (req, res) => {
  try {
    const { vehicle, mods, csvHeaders, sampledRows } = req.body || {};
    const missing = validateMods(mods);
    if (missing.length) return res.status(400).json({ error: 'Missing or invalid fields', fields: missing });

    const { sampled, columns } = pickColumnsForAI(sampledRows || [], csvHeaders || []);
    const system = buildSystemPrompt({ mods });
    const user = buildUserPrompt({ vehicle, mods, sample: sampled, columns });

    const openai = new OpenAI();
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_tokens: 900,
    });

    let text = resp.choices?.[0]?.message?.content || '';
    text = sanitizeTone(text);

    // Final guard: if N/A and model hallucinated boost language, strip lines containing “boost/psi”
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
