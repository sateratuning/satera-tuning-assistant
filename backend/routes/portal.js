// backend/routes/portal.js
// ============================================================
// Satera Tuning Customer Portal
// Reuses: analyzeCsvContent + formatChecklist from index.js logic,
//         buildMessages from prompt.js (full Gen 3 Hemi knowledge),
//         parseCSV from utils/parseCSV.js
// ============================================================
const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const fs       = require('fs');
const path     = require('path');
const { OpenAI } = require('openai');

const openai      = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const getSupabase = require('../Lib/supabase');
const supabase    = getSupabase();
const parseCSV    = require('../utils/parseCSV');
const { buildMessages } = require('../prompt');

// ── Upload setup ──────────────────────────────────────────
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({ dest: uploadsDir, limits: { fileSize: 100 * 1024 * 1024 } });
function safeUnlink(p) { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {} }

// ── Auth helper ───────────────────────────────────────────
function getUID(req) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (token && token.includes('.')) {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      return payload.user_id || payload.sub || payload.uid || null;
    }
  } catch {}
  return req.headers['x-user-id'] || null;
}
function requireAuth(req, res, next) {
  req.uid = getUID(req);
  if (!req.uid) return res.status(401).json({ error: 'Authentication required.' });
  next();
}

// ── Stage definitions ─────────────────────────────────────
const STAGES = {
  1: {
    name: 'Idle & Startup',
    icon: '🔑',
    instructions: 'Start the vehicle from a fully cold start and let it warm up to operating temperature completely. Log for at least 5-8 minutes at idle without revving or driving. We need to see the full cold-start fuel enrichment, the transition to closed loop, and idle stabilization once fully warm.',
    tips: [
      'Start from completely cold (engine off 4+ hours)',
      'Do not touch the throttle during this log',
      'Log until coolant temperature stabilizes (usually 180-200°F)',
      'Make sure the car is in park or neutral with parking brake on',
    ],
  },
  2: {
    name: 'Part Throttle Cruise',
    icon: '🛣️',
    instructions: 'Drive at varying speeds between 25-55 mph keeping throttle below 50% at all times. Include steady cruise, light acceleration, and deceleration. Log for at least 10-15 minutes of varied driving. No wide open throttle during this stage.',
    tips: [
      'Keep throttle below 50% at all times',
      'Vary your speed — include light on/off throttle transitions',
      'Highway or low-traffic roads work best',
      'Avoid hard stops and aggressive driving',
    ],
  },
  3: {
    name: 'WOT — Low RPM',
    icon: '⚡',
    instructions: 'Make 2-3 wide open throttle pulls but STOP at 4500 RPM. Do not rev past 4500 RPM. Let the car fully cool for at least 5 minutes between each pull. We are verifying fueling and knock in the low-mid RPM range before allowing full pulls.',
    tips: [
      'Full throttle only — no partial throttle pulls',
      'STOP accelerating at 4500 RPM — lift off completely',
      'Wait at least 5 minutes between pulls',
      'Use fresh 93 octane minimum or E85 if calibrated for it',
    ],
  },
  4: {
    name: 'WOT — Full Pull',
    icon: '🏁',
    instructions: 'Make 2-3 full wide open throttle pulls through the complete RPM range. Let the car fully cool between each pull. This is the final stage — the AI will analyze the complete pull and generate a full assessment.',
    tips: [
      'Full throttle all the way through the rev range',
      '5-10 minutes cool-down between pulls',
      'Safe straight road or closed course only',
      'Log at least 2 pulls so we have enough data',
    ],
  },
};

// ── Stage pass criteria ───────────────────────────────────
const PASS_CRITERIA = {
  1: { ltft_max: 5,  knock_max: 0,   misfires: false, desc: 'LTFT within ±5% on both banks, no misfires, coolant reaches operating temp' },
  2: { ltft_max: 5,  knock_max: 1.5, misfires: false, desc: 'LTFT within ±5% under load, knock below 1.5°, no misfires' },
  3: { ltft_max: 7,  knock_max: 1.5, idc_max: 85,     desc: 'Knock below 1.5° in 2000-4500 RPM, fuel pressure drop less than 10%, IDC below 85%' },
  4: { ltft_max: 7,  knock_max: 2.0, idc_max: 90,     desc: 'Knock below 2°, fuel pressure stable, IDC within safe range' },
};

// ── Build stage-specific observations for AI ─────────────
function buildStageObservations(metrics, stage, vehicle) {
  const isNA = !vehicle.power_adder ||
    String(vehicle.power_adder).toLowerCase().includes('n/a') ||
    String(vehicle.power_adder).toLowerCase().includes('naturally');

  const lines = [];

  // Knock
  const knockVals = (metrics.knock || []).map(v => Math.abs(v)).filter(Number.isFinite);
  const peakKnock = knockVals.length ? Math.max(...knockVals) : 0;
  const criteria  = PASS_CRITERIA[stage];

  if (peakKnock > criteria.knock_max) {
    lines.push(`CRITICAL: Knock detected — up to ${peakKnock.toFixed(1)}° of timing retard. This exceeds the ${criteria.knock_max}° threshold for Stage ${stage}.`);
  } else if (peakKnock > 0) {
    lines.push(`OK: Minor knock detected (${peakKnock.toFixed(1)}°) — within acceptable range for Stage ${stage}.`);
  } else {
    lines.push('OK: No knock detected — timing looks clean.');
  }

  // Timing
  if (metrics.peakTiming) {
    lines.push(`STAT: Peak timing advance (WOT): ${metrics.peakTiming.toFixed(1)}°`);
  }

  // Fuel trims
  const ft1 = metrics.avgFT1, ft2 = metrics.avgFT2;
  if (ft1 !== undefined && ft2 !== undefined) {
    const ftMax = Math.max(Math.abs(ft1), Math.abs(ft2));
    if (ftMax > criteria.ltft_max) {
      lines.push(`WARN: Fuel trim variance is elevated — Bank 1: ${ft1.toFixed(1)}%, Bank 2: ${ft2.toFixed(1)}%. This exceeds the ±${criteria.ltft_max}% threshold.`);
    } else {
      lines.push(`OK: Fuel trims are balanced — Bank 1: ${ft1.toFixed(1)}%, Bank 2: ${ft2.toFixed(1)}%.`);
    }
  }

  // Misfires
  const misfires = metrics.misfires || {};
  const totalMisfires = Object.values(misfires).reduce((a, b) => a + b, 0);
  if (totalMisfires > 0) {
    const detail = Object.entries(misfires).filter(([,c]) => c > 0).map(([cyl,c]) => `Cylinder ${cyl}: ${c} misfires`).join(', ');
    lines.push(`WARN: Misfires were detected in this log — ${detail}. Misfires mean one or more cylinders are not firing correctly. This is typically caused by spark plugs, ignition coils, or fuel delivery issues.`);
  } else {
    lines.push('OK: No misfires detected.');
  }

  // Boost (only if not NA and stage has boost relevance)
  if (!isNA && stage >= 3 && metrics.boost?.max >= 2) {
    lines.push(`STAT: Peak boost (WOT): ${metrics.boost.max.toFixed(1)} psi`);
  }

  // Acceleration timers (stages 3 and 4)
  if (stage >= 3) {
    if (metrics.zeroTo60)   lines.push(`STAT: Best 0-60 mph: ${metrics.zeroTo60.toFixed(2)}s`);
    if (metrics.fortyTo100) lines.push(`STAT: Best 40-100 mph: ${metrics.fortyTo100.toFixed(2)}s`);
    if (metrics.sixtyTo130) lines.push(`STAT: Best 60-130 mph: ${metrics.sixtyTo130.toFixed(2)}s`);
  }

  // Stage-specific context note for AI
  lines.push(`INFO: This is a Stage ${stage} log (${STAGES[stage].name}). Pass criteria: ${criteria.desc}.`);
  lines.push(`INFO: Vehicle is ${isNA ? 'naturally aspirated' : `forced induction (${vehicle.power_adder})`}.`);

  return lines.join('\n');
}

// ── AI Stage Evaluator — uses buildMessages from prompt.js ─
async function evaluateStageAI(stage, observations, vehicle, attemptNum) {
  const meta = {
    year:    vehicle.year,
    model:   vehicle.model,
    engine:  vehicle.engine,
    fuel:    vehicle.fuel,
    power:   vehicle.power_adder,
    trans:   vehicle.transmission,
    cam:     vehicle.cam,
    nn:      vehicle.neural_network,
    injectors: vehicle.injectors,
  };

  // Use the real buildMessages with our full Gen 3 Hemi prompt knowledge
  const messages = buildMessages({ meta, observations });

  // Append stage-specific instruction to the last user message
  const stageInstruction = `

This log is from Stage ${stage} of the tuning process (${STAGES[stage].name}).
Pass criteria for this stage: ${PASS_CRITERIA[stage].desc}.
This is attempt #${attemptNum}.

After your normal Summary and What This Means For You sections, add a third section:
"Stage ${stage} Verdict: PASS" or "Stage ${stage} Verdict: FAIL"
Then on the next line explain in one sentence why it passed or failed.
If it failed, list 1-3 specific things the customer needs to fix before resubmitting.
Keep everything in plain English — the customer will read this directly.`;

  // Append to the last user message
  const lastMsg = messages[messages.length - 1];
  messages[messages.length - 1] = {
    ...lastMsg,
    content: lastMsg.content + stageInstruction,
  };

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      messages,
      max_tokens: 600,
    });
    const text = completion.choices?.[0]?.message?.content?.trim() || '';

    // Parse verdict from response
    const verdictMatch = text.match(/Stage \d+ Verdict:\s*(PASS|FAIL)/i);
    const verdict = verdictMatch ? verdictMatch[1].toLowerCase() : 'fail';

    // Extract recommendations — lines after FAIL verdict
    const recommendations = [];
    if (verdict === 'fail') {
      const afterVerdict = text.split(/Stage \d+ Verdict:/i)[1] || '';
      const lines = afterVerdict.split('\n').map(l => l.trim()).filter(l => l && !l.match(/^FAIL/i));
      recommendations.push(...lines.slice(0, 3).filter(l => l.length > 10));
    }

    return { verdict, fullText: text, recommendations };
  } catch (e) {
    console.error('Stage AI eval error:', e.message);
    return {
      verdict: 'fail',
      fullText: 'AI evaluation unavailable. Please review the checklist and resubmit.',
      recommendations: ['Review your log data and ensure the vehicle is operating correctly before resubmitting.'],
    };
  }
}

// ── AI Table Revision Generator ──────────────────────────
async function generateTableRevision({ vehicle, sparkTable, checklist, triggerReason, revisionNum }) {
  const isNA = !vehicle.power_adder ||
    String(vehicle.power_adder).toLowerCase().includes('n/a') ||
    String(vehicle.power_adder).toLowerCase().includes('naturally');

  const vehicleStr = `${vehicle.year} ${vehicle.make || 'Dodge'} ${vehicle.model} — ${vehicle.engine} — ${vehicle.fuel}${isNA ? ' (Naturally Aspirated)' : `, ${vehicle.power_adder}`}
Injectors: ${vehicle.injectors || 'Stock'} | Cam: ${vehicle.cam || 'Stock'} | Transmission: ${vehicle.transmission || 'Unknown'}
Throttle: ${vehicle.throttle_body || 'Stock'} | MAP: ${vehicle.map_sensor || 'Stock'}`;

  const prompt = `You are Satera Tuning generating Revision ${revisionNum} of the WOT Spark Table for this vehicle:
${vehicleStr}

Reason for this revision: ${triggerReason}

${checklist ? `Log findings:\n${checklist}\n` : ''}

Current WOT Spark Table (HP Tuners "Copy with Axis" format, tab-delimited):
${sparkTable || 'Not provided'}

Generate a revised WOT Spark Table. Rules:
- Output ONLY the adjusted table in the exact same tab-delimited format as the input
- Header row: degree symbol then tab then RPM values then tab then rpm
- Data rows: airmass value then tab-separated spark values
- Footer row: g
- Never reduce more than 3 degrees per revision in any single cell
- Never add more than 1 degree per revision in any single cell
- Never go below 0 degrees in any cell
- If knock was detected: reduce timing in the affected RPM/load cells
- If no knock and timing has headroom: small additions are acceptable
- ${isNA ? 'This is an NA vehicle' : `This is a forced induction vehicle (${vehicle.power_adder})`}
- NEVER blame the tune — frame all changes as responses to hardware/fuel/load conditions

Respond in this EXACT format with no extra text:
===SPARK_REVISED===
[revised WOT spark table in exact HP Tuners Copy with Axis format]
===NOTES===
[2-3 plain English sentences explaining what was changed and why]`;

  try {
    const res = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 3000,
    });
    const text = res.choices?.[0]?.message?.content?.trim() || '';

    const extract = (tag) => {
      const match = text.match(new RegExp(`===${tag}===\n([\s\S]*?)(?:===|$)`));
      return match?.[1]?.trim() || null;
    };

    return {
      spark_adjusted: extract('SPARK_REVISED'),
      revision_notes: extract('NOTES') || 'Spark table revised based on vehicle specifications and log data.',
    };
  } catch(e) {
    console.error('Table revision AI error:', e.message);
    return { spark_adjusted: null, revision_notes: 'AI revision unavailable.' };
  }
}

// ══════════════════════════════════════════════════════════
// TUNE TABLE SUBMISSION & REVISIONS
// ══════════════════════════════════════════════════════════

// POST /portal/sessions/:id/submit-tables — initial spark table paste
router.post('/portal/sessions/:id/submit-tables', requireAuth, express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const { spark_table } = req.body || {};
    const injector_table = null, ve_table = null;
    if (!spark_table)
      return res.status(400).json({ error: 'WOT Spark Table is required.' });

    // Fetch session + vehicle
    const { data: session, error: sErr } = await supabase
      .from('tune_sessions').select('*, vehicles(*)').eq('id', req.params.id).eq('user_id', req.uid).single();
    if (sErr || !session) return res.status(404).json({ error: 'Session not found.' });
    const vehicle = session.vehicles;

    // Generate Revision 1 based on mods alone
    const revision = await generateTableRevision({
      vehicle,
      sparkTable:  spark_table,
      checklist:   null,
      triggerReason: `Initial WOT Spark Table submission. Vehicle mods: Injectors=${vehicle.injectors||'Stock'}, Cam=${vehicle.cam||'Stock'}, Power=${vehicle.power_adder}, Fuel=${vehicle.fuel}. Generate baseline spark timing adjustments for these modifications.`,
      revisionNum: 1,
    });

    // Save to tune_tables
    const { data: tableRev, error: tErr } = await supabase
      .from('tune_tables')
      .insert([{
        session_id:         req.params.id,
        user_id:            req.uid,
        revision:           1,
        injector_table,
        ve_table,
        spark_table,
        injector_adjusted:  revision.injector_adjusted,
        ve_adjusted:        revision.ve_adjusted,
        spark_adjusted:     revision.spark_adjusted,
        revision_notes:     revision.revision_notes,
        triggered_by:       'initial_submission',
      }])
      .select().single();
    if (tErr) throw tErr;

    // Mark session as having tables submitted
    await supabase.from('tune_sessions').update({
      updated_at: new Date().toISOString(),
      notes: 'Tables submitted — Revision 1 generated',
    }).eq('id', req.params.id);

    res.json({ ok: true, revision: tableRev });
  } catch(e) {
    console.error('submit-tables error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /portal/sessions/:id/tables — get latest revision
router.get('/portal/sessions/:id/tables', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tune_tables')
      .select('*')
      .eq('session_id', req.params.id)
      .eq('user_id', req.uid)
      .order('revision', { ascending: false })
      .limit(1)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    res.json({ ok: true, tables: data || null });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ══════════════════════════════════════════════════════════
// VEHICLES
// ══════════════════════════════════════════════════════════

router.get('/portal/vehicles', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('vehicles').select('*').eq('user_id', req.uid).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ ok: true, vehicles: data || [] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/portal/vehicles', requireAuth, express.json(), async (req, res) => {
  try {
    const v = req.body;
    if (!v.year || !v.model || !v.engine || !v.fuel || !v.power_adder)
      return res.status(400).json({ ok: false, error: 'Missing required fields: year, model, engine, fuel, power_adder' });
    const { data, error } = await supabase.from('vehicles').insert([{
      user_id: req.uid, user_email: v.user_email || null,
      nickname: v.nickname || null, vin: v.vin || null,
      year: v.year, make: v.make || 'Dodge', model: v.model,
      engine: v.engine, fuel: v.fuel, power_adder: v.power_adder,
      transmission: v.transmission || null, rear_gear: v.rear_gear || null,
      tire_height: v.tire_height || null, injectors: v.injectors || null,
      map_sensor: v.map_sensor || null, throttle_body: v.throttle_body || null,
      cam: v.cam || null, neural_network: v.neural_network || null,
      calid: v.calid || null, trans_calid: v.trans_calid || null,
      trans_model: v.trans_model || null, notes: v.notes || null,
    }]).select().single();
    if (error) throw error;
    res.json({ ok: true, vehicle: data });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.put('/portal/vehicles/:id', requireAuth, express.json(), async (req, res) => {
  try {
    const { data, error } = await supabase.from('vehicles').update({ ...req.body, updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', req.uid).select().single();
    if (error) throw error;
    res.json({ ok: true, vehicle: data });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete('/portal/vehicles/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase.from('vehicles').delete().eq('id', req.params.id).eq('user_id', req.uid);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ══════════════════════════════════════════════════════════
// TUNE SESSIONS
// ══════════════════════════════════════════════════════════

router.get('/portal/sessions', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('tune_sessions').select('*, vehicles(*)').eq('user_id', req.uid).order('updated_at', { ascending: false });
    if (error) throw error;
    res.json({ ok: true, sessions: data || [] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/portal/sessions/:id', requireAuth, async (req, res) => {
  try {
    const { data: session, error: sErr } = await supabase.from('tune_sessions').select('*, vehicles(*)').eq('id', req.params.id).eq('user_id', req.uid).single();
    if (sErr) throw sErr;
    const { data: logs, error: lErr } = await supabase.from('stage_logs').select('*').eq('session_id', req.params.id).order('created_at', { ascending: true });
    if (lErr) throw lErr;
    res.json({ ok: true, session, logs: logs || [], stages: STAGES });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/portal/sessions', requireAuth, express.json(), async (req, res) => {
  try {
    const { vehicle_id } = req.body;
    if (!vehicle_id) return res.status(400).json({ error: 'vehicle_id required' });
    const { data: vehicle, error: vErr } = await supabase.from('vehicles').select('*').eq('id', vehicle_id).eq('user_id', req.uid).single();
    if (vErr || !vehicle) return res.status(404).json({ error: 'Vehicle not found.' });
    const { data, error } = await supabase.from('tune_sessions').insert([{ user_id: req.uid, vehicle_id, current_stage: 1, status: 'active' }]).select('*, vehicles(*)').single();
    if (error) throw error;
    res.json({ ok: true, session: data, stages: STAGES });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// DELETE /portal/sessions/:id
router.delete('/portal/sessions/:id', requireAuth, async (req, res) => {
  try {
    // Delete stage logs first
    await supabase.from('stage_logs').delete().eq('session_id', req.params.id).eq('user_id', req.uid);
    // Delete tune tables
    await supabase.from('tune_tables').delete().eq('session_id', req.params.id).eq('user_id', req.uid);
    // Delete session
    const { error } = await supabase.from('tune_sessions').delete().eq('id', req.params.id).eq('user_id', req.uid);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// PATCH /portal/sessions/:id/restart — reset back to stage 1
router.patch('/portal/sessions/:id/restart', requireAuth, async (req, res) => {
  try {
    // Clear all stage logs for this session
    await supabase.from('stage_logs').delete().eq('session_id', req.params.id).eq('user_id', req.uid);
    // Clear all table revisions
    await supabase.from('tune_tables').delete().eq('session_id', req.params.id).eq('user_id', req.uid);
    // Reset session to stage 1
    const { data, error } = await supabase
      .from('tune_sessions')
      .update({ current_stage: 1, stages_passed: [], status: 'active', notes: null, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', req.uid)
      .select('*, vehicles(*)')
      .single();
    if (error) throw error;
    res.json({ ok: true, session: data });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get('/portal/stages', (req, res) => {
  res.json({ ok: true, stages: STAGES });
});

// ══════════════════════════════════════════════════════════
// STAGE LOG SUBMISSION
// ══════════════════════════════════════════════════════════

router.post('/portal/sessions/:id/submit-stage', requireAuth, upload.single('log'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded.' });
    filePath = req.file.path;

    const sessionId = req.params.id;
    const stage = parseInt(req.body.stage || '1', 10);
    if (!STAGES[stage]) return res.status(400).json({ error: `Invalid stage: ${stage}` });

    // Fetch session + vehicle
    const { data: session, error: sErr } = await supabase.from('tune_sessions').select('*, vehicles(*)').eq('id', sessionId).eq('user_id', req.uid).single();
    if (sErr || !session) return res.status(404).json({ error: 'Session not found.' });
    if (session.status !== 'active') return res.status(400).json({ error: 'Session is not active.' });
    if (stage !== session.current_stage) return res.status(400).json({ error: `You must complete Stage ${session.current_stage} first.`, current_stage: session.current_stage });

    const vehicle = session.vehicles;

    // Count previous attempts
    const { count: prevAttempts } = await supabase.from('stage_logs').select('id', { count: 'exact', head: true }).eq('session_id', sessionId).eq('stage', stage);
    const attemptNum = (prevAttempts || 0) + 1;

    // Parse CSV using the same parseCSV utility used everywhere else
    const raw = fs.readFileSync(filePath, 'utf8');
    const metrics = parseCSV(raw);
    if (!metrics) return res.status(400).json({ error: 'Could not parse CSV. Make sure it is an HP Tuners export.' });

    // Build observations using our stage-aware logic
    const observations = buildStageObservations(metrics, stage, vehicle);

    // Evaluate using the real prompt system (buildMessages from prompt.js)
    const aiResult = await evaluateStageAI(stage, observations, vehicle, attemptNum);

    // Determine pass/fail
    const passed = aiResult.verdict === 'pass';

    // Save stage log to Supabase
    const { data: stageLog, error: lErr } = await supabase.from('stage_logs').insert([{
      session_id:         sessionId,
      user_id:            req.uid,
      vehicle_id:         vehicle.id,
      stage,
      attempt:            attemptNum,
      passed,
      ai_verdict:         aiResult.verdict,
      ai_summary:         aiResult.fullText,
      ai_recommendations: aiResult.recommendations || [],
      checklist_raw:      observations,
      metrics,
    }]).select().single();
    if (lErr) throw lErr;

    // Generate table revision only if stage failed
    if (!passed) {
      try {
        // Get latest table revision for this session
        const { data: latestTables } = await supabase
          .from('tune_tables')
          .select('*')
          .eq('session_id', sessionId)
          .order('revision', { ascending: false })
          .limit(1)
          .single();

        if (latestTables) {
          const revNum = (latestTables.revision || 1) + 1;
          const triggerReason = `Stage ${stage} failed. Log findings: ${observations}`;

          const newRevision = await generateTableRevision({
            vehicle,
            sparkTable:  latestTables.spark_adjusted || latestTables.spark_table,
            checklist:   observations,
            triggerReason,
            revisionNum: revNum,
          });

          await supabase.from('tune_tables').insert([{
            session_id:     sessionId,
            user_id:        req.uid,
            revision:       revNum,
            spark_table:    latestTables.spark_adjusted || latestTables.spark_table,
            spark_adjusted: newRevision.spark_adjusted,
            revision_notes: newRevision.revision_notes,
            triggered_by:   `stage_${stage}_${passed ? 'pass' : 'fail'}`,
          }]);
        }
      } catch(revErr) {
        console.warn('Table revision generation failed:', revErr.message);
      }
    }

    // Advance session if passed
    if (passed) {
      const newPassed  = [...(session.stages_passed || []), stage];
      const nextStage  = stage + 1;
      const isComplete = nextStage > 4;
      await supabase.from('tune_sessions').update({
        stages_passed: newPassed,
        current_stage: isComplete ? stage : nextStage,
        status:        isComplete ? 'complete' : 'active',
        updated_at:    new Date().toISOString(),
      }).eq('id', sessionId);
    } else {
      await supabase.from('tune_sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId);
    }

    // Fetch the latest table revision to include in response
    let latestRev = null;
    try {
      const { data: lr } = await supabase
        .from('tune_tables')
        .select('id, revision, revision_notes, spark_adjusted, triggered_by')
        .eq('session_id', sessionId)
        .order('revision', { ascending: false })
        .limit(1)
        .single();
      latestRev = lr;
    } catch {}

    res.json({
      ok:               true,
      stage_log:        stageLog,
      verdict:          aiResult.verdict,
      fullText:         aiResult.fullText,
      recommendations:  aiResult.recommendations || [],
      passed,
      next_stage:       passed ? (stage < 4 ? stage + 1 : null) : stage,
      session_complete: passed && stage === 4,
      checklist:        observations,
      table_revision:   latestRev || null,
    });

  } catch (e) {
    console.error('submit-stage error:', e);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    safeUnlink(filePath);
  }
});

// Export both the router and an init function that accepts the express app
module.exports = router;
module.exports.init = function(app) {
  app.use('/', router);
  console.log('[portal] initialized on express app');
};
