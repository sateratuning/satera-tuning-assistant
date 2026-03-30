// backend/routes/portal.js
// ============================================================
// Satera Tuning Customer Portal
// Handles: vehicles, tune sessions, stage log submission & AI evaluation
// ============================================================
const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const fs       = require('fs');
const path     = require('path');
const { OpenAI } = require('openai');

const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const getSupabase = require('../Lib/supabase');
const supabase = getSupabase();
const parseCSV = require('../utils/parseCSV');

// ── Upload setup ──────────────────────────────────────────
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({ dest: uploadsDir, limits: { fileSize: 100 * 1024 * 1024 } });
function safeUnlink(p) { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {} }

// ── Auth helper ───────────────────────────────────────────
// Extracts Firebase UID from Authorization Bearer token or x-user-id header
function getUID(req) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (token) {
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
    instructions: `Start the vehicle from a fully cold start and let it warm up to operating temperature completely. Log for at least 5-8 minutes at idle without revving or driving. We need to see the full cold-start fuel enrichment, the transition to closed loop, and idle stabilization once the engine is fully warm.`,
    tips: [
      'Start from completely cold if possible (engine off for 4+ hours)',
      'Do not touch the throttle during this log',
      'Log until coolant temperature stabilizes (usually 180-200°F)',
      'Make sure the car is in park or neutral with parking brake on',
    ],
    passCriteria: {
      ltft_max: 5,        // % — both banks within ±5%
      misfires: false,    // no misfires allowed
      coolant_min: 180,   // must reach operating temp
    },
  },
  2: {
    name: 'Part Throttle Cruise',
    icon: '🛣️',
    instructions: `Drive at varying speeds between 25-55 mph keeping throttle position below 50% at all times. Include steady cruise, light acceleration, and deceleration. Log for at least 10-15 minutes of varied driving. No wide open throttle during this stage.`,
    tips: [
      'Keep throttle below 50% at all times',
      'Vary your speed — do not just cruise at one speed',
      'Include some light on/off throttle transitions',
      'Highway or low-traffic roads work best',
      'Avoid hard stops and aggressive driving',
    ],
    passCriteria: {
      ltft_max: 5,
      knock_max: 1.5,
      fuel_pressure_drop_max: 10,
      misfires: false,
    },
  },
  3: {
    name: 'WOT — Low RPM',
    icon: '⚡',
    instructions: `Make 2-3 wide open throttle pulls but STOP at 4500 RPM — do not rev past 4500 RPM. Let the car fully cool for at least 5 minutes between each pull. We are verifying fueling and knock in the low-mid RPM range before allowing full pulls.`,
    tips: [
      'Full throttle only — no partial throttle pulls',
      'STOP accelerating at 4500 RPM — lift off completely',
      'Wait at least 5 minutes between pulls',
      'Make sure the car is fully warmed up before pulling',
      'Use fresh fuel — 93 octane minimum or E85 if calibrated for it',
    ],
    passCriteria: {
      knock_max: 1.5,
      fuel_pressure_drop_max: 10,
      idc_max: 85,
    },
  },
  4: {
    name: 'WOT — Full Pull',
    icon: '🏁',
    instructions: `Make 2-3 full wide open throttle pulls through the complete RPM range. Let the car fully cool between each pull. This is the final stage — the AI will analyze the complete pull and generate spark table adjustment recommendations.`,
    tips: [
      'Full throttle all the way through the rev range',
      'At least 5-10 minutes cool-down between pulls',
      'Safe straight road or closed course only',
      'Make sure you have enough room to complete the pull safely',
      'Log at least 2 pulls so we have enough data',
    ],
    passCriteria: {
      knock_max: 2.0,
      fuel_pressure_drop_max: 15,
      idc_max: 90,
    },
  },
};

// ── AI Stage Evaluator ────────────────────────────────────
async function evaluateStageAI(stage, checklist, vehicle, attemptNum) {
  const def = STAGES[stage];
  const isNA = !vehicle.power_adder ||
    String(vehicle.power_adder).toLowerCase().includes('n/a') ||
    String(vehicle.power_adder).toLowerCase().includes('naturally');

  const vehicleStr = `${vehicle.year} ${vehicle.make || 'Dodge'} ${vehicle.model} — ${vehicle.engine} — ${vehicle.fuel}${isNA ? ' (Naturally Aspirated)' : `, ${vehicle.power_adder}`}. Injectors: ${vehicle.injectors || 'Stock'}. Transmission: ${vehicle.transmission || 'Unknown'}.`;

  const prompt = `You are Satera Tuning's AI evaluator for a step-by-step guided tuning process.

Vehicle: ${vehicleStr}
Stage ${stage}: ${def.name} (Attempt #${attemptNum})
Pass criteria: ${JSON.stringify(def.passCriteria)}

Log findings:
${checklist}

Your job:
1. Decide PASS or FAIL for this stage based on the pass criteria and log data
2. Write a 2-4 sentence plain-English summary of what you found
3. If FAIL — list specific things the customer needs to fix before resubmitting
4. If PASS — confirm what looks good and what to watch for in the next stage
${stage === 4 ? '5. Since this is the final WOT stage, also note the most important spark table areas that need attention based on the knock data.' : ''}

Rules:
- NEVER blame the tune or tuner
- ${isNA ? 'This is an NA vehicle — ignore any 0 psi boost readings, that is completely normal' : ''}
- Be encouraging but honest — safety first
- Keep the summary concise and in plain English the customer can understand

Respond in this exact JSON format:
{
  "verdict": "pass" or "fail",
  "summary": "2-4 sentence assessment",
  "recommendations": ["specific action item 1", "specific action item 2"],
  "readyForNextStage": true or false
}`;

  try {
    const res = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
    });
    const raw = res.choices?.[0]?.message?.content?.trim() || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error('Stage AI eval error:', e.message);
    return {
      verdict: 'fail',
      summary: 'AI evaluation unavailable. Please review the checklist manually.',
      recommendations: ['Review the checklist data above and resubmit if all checks pass.'],
      readyForNextStage: false,
    };
  }
}

// ══════════════════════════════════════════════════════════
// VEHICLES
// ══════════════════════════════════════════════════════════

// GET /api/portal/vehicles
router.get('/api/portal/vehicles', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vehicles')
      .select('*')
      .eq('user_id', req.uid)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ ok: true, vehicles: data || [] });
  } catch (e) {
    console.error('GET vehicles error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/portal/vehicles
router.post('/api/portal/vehicles', requireAuth, express.json(), async (req, res) => {
  try {
    const v = req.body;
    if (!v.year || !v.model || !v.engine || !v.fuel || !v.power_adder) {
      return res.status(400).json({ ok: false, error: 'Missing required fields: year, model, engine, fuel, power_adder' });
    }
    const { data, error } = await supabase
      .from('vehicles')
      .insert([{
        user_id:        req.uid,
        user_email:     v.user_email     || null,
        nickname:       v.nickname       || null,
        vin:            v.vin            || null,
        year:           v.year,
        make:           v.make           || 'Dodge',
        model:          v.model,
        engine:         v.engine,
        fuel:           v.fuel,
        power_adder:    v.power_adder,
        transmission:   v.transmission   || null,
        rear_gear:      v.rear_gear      || null,
        tire_height:    v.tire_height    || null,
        injectors:      v.injectors      || null,
        map_sensor:     v.map_sensor     || null,
        throttle_body:  v.throttle_body  || null,
        cam:            v.cam            || null,
        neural_network: v.neural_network || null,
        calid:          v.calid          || null,
        trans_calid:    v.trans_calid    || null,
        trans_model:    v.trans_model    || null,
        notes:          v.notes          || null,
      }])
      .select()
      .single();
    if (error) throw error;
    res.json({ ok: true, vehicle: data });
  } catch (e) {
    console.error('POST vehicle error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /api/portal/vehicles/:id
router.put('/api/portal/vehicles/:id', requireAuth, express.json(), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vehicles')
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', req.uid)
      .select()
      .single();
    if (error) throw error;
    res.json({ ok: true, vehicle: data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /api/portal/vehicles/:id
router.delete('/api/portal/vehicles/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('vehicles')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.uid);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ══════════════════════════════════════════════════════════
// TUNE SESSIONS
// ══════════════════════════════════════════════════════════

// GET /api/portal/sessions
router.get('/api/portal/sessions', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tune_sessions')
      .select('*, vehicles(*)')
      .eq('user_id', req.uid)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    res.json({ ok: true, sessions: data || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/portal/sessions/:id
router.get('/api/portal/sessions/:id', requireAuth, async (req, res) => {
  try {
    const { data: session, error: sErr } = await supabase
      .from('tune_sessions')
      .select('*, vehicles(*)')
      .eq('id', req.params.id)
      .eq('user_id', req.uid)
      .single();
    if (sErr) throw sErr;

    const { data: logs, error: lErr } = await supabase
      .from('stage_logs')
      .select('*')
      .eq('session_id', req.params.id)
      .order('created_at', { ascending: true });
    if (lErr) throw lErr;

    res.json({ ok: true, session, logs: logs || [], stages: STAGES });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/portal/sessions — start new session
router.post('/api/portal/sessions', requireAuth, express.json(), async (req, res) => {
  try {
    const { vehicle_id } = req.body;
    if (!vehicle_id) return res.status(400).json({ error: 'vehicle_id required' });

    // Verify vehicle belongs to user
    const { data: vehicle, error: vErr } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', vehicle_id)
      .eq('user_id', req.uid)
      .single();
    if (vErr || !vehicle) return res.status(404).json({ error: 'Vehicle not found.' });

    const { data, error } = await supabase
      .from('tune_sessions')
      .insert([{ user_id: req.uid, vehicle_id, current_stage: 1, status: 'active' }])
      .select('*, vehicles(*)')
      .single();
    if (error) throw error;

    res.json({ ok: true, session: data, stages: STAGES });
  } catch (e) {
    console.error('POST session error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/portal/stages — get stage definitions (no auth needed)
router.get('/api/portal/stages', (req, res) => {
  res.json({ ok: true, stages: STAGES });
});

// ══════════════════════════════════════════════════════════
// STAGE LOG SUBMISSION
// ══════════════════════════════════════════════════════════

// POST /api/portal/sessions/:id/submit-stage
router.post(
  '/api/portal/sessions/:id/submit-stage',
  requireAuth,
  upload.single('log'),
  async (req, res) => {
    let filePath = null;
    try {
      // ── Validate inputs ──
      if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded.' });
      filePath = req.file.path;

      const sessionId = req.params.id;
      const stage = parseInt(req.body.stage || '1', 10);
      if (!STAGES[stage]) return res.status(400).json({ error: `Invalid stage: ${stage}` });

      // ── Fetch session + vehicle ──
      const { data: session, error: sErr } = await supabase
        .from('tune_sessions')
        .select('*, vehicles(*)')
        .eq('id', sessionId)
        .eq('user_id', req.uid)
        .single();
      if (sErr || !session) return res.status(404).json({ error: 'Session not found.' });
      if (session.status !== 'active') return res.status(400).json({ error: 'Session is not active.' });
      if (stage !== session.current_stage) {
        return res.status(400).json({
          error: `You must complete Stage ${session.current_stage} first.`,
          current_stage: session.current_stage,
        });
      }

      const vehicle = session.vehicles;

      // ── Count previous attempts for this stage ──
      const { count: prevAttempts } = await supabase
        .from('stage_logs')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .eq('stage', stage);
      const attemptNum = (prevAttempts || 0) + 1;

      // ── Parse CSV ──
      const raw = fs.readFileSync(filePath, 'utf8');
      const metrics = parseCSV(raw);
      if (!metrics) return res.status(400).json({ error: 'Could not parse CSV. Make sure it is an HP Tuners export.' });

      // ── Build checklist for this stage ──
      // Use the existing formatChecklist logic via index.js approach
      // We pass raw text to the AI evaluator
      const isNA = !vehicle.power_adder ||
        String(vehicle.power_adder).toLowerCase().includes('n/a');

      const checklistItems = [];

      // Knock
      const knockVals = (metrics.knock || []).map(v => Math.abs(v)).filter(Number.isFinite);
      const peakKnock = knockVals.length ? Math.max(...knockVals) : 0;
      checklistItems.push(`Peak knock retard: ${peakKnock.toFixed(1)}°`);

      // Timing
      if (metrics.peakTiming) checklistItems.push(`Peak timing advance (WOT): ${metrics.peakTiming.toFixed(1)}°`);

      // Fuel trims
      if (metrics.avgFT1 !== undefined) checklistItems.push(`Avg fuel correction Bank 1: ${metrics.avgFT1.toFixed(1)}%`);
      if (metrics.avgFT2 !== undefined) checklistItems.push(`Avg fuel correction Bank 2: ${metrics.avgFT2.toFixed(1)}%`);

      // Misfires
      const misfires = metrics.misfires || {};
      const totalMisfires = Object.values(misfires).reduce((a, b) => a + b, 0);
      checklistItems.push(`Total misfires: ${totalMisfires}`);
      if (totalMisfires > 0) {
        Object.entries(misfires).forEach(([cyl, count]) => {
          if (count > 0) checklistItems.push(`  Cylinder ${cyl}: ${count} misfires`);
        });
      }

      // Boost (only if not NA)
      if (!isNA && metrics.boost) {
        const peakBoost = metrics.boost.max || 0;
        if (peakBoost >= 2) {
          checklistItems.push(`Peak boost: ${peakBoost.toFixed(1)} psi`);
        }
      }

      // Timers
      if (metrics.zeroTo60)  checklistItems.push(`Best 0-60 mph: ${metrics.zeroTo60.toFixed(2)}s`);
      if (metrics.fortyTo100) checklistItems.push(`Best 40-100 mph: ${metrics.fortyTo100.toFixed(2)}s`);
      if (metrics.sixtyTo130) checklistItems.push(`Best 60-130 mph: ${metrics.sixtyTo130.toFixed(2)}s`);

      const checklistText = checklistItems.join('\n');

      // ── AI Evaluation ──
      const aiResult = await evaluateStageAI(stage, checklistText, vehicle, attemptNum);

      // ── Save stage log ──
      const { data: stageLog, error: lErr } = await supabase
        .from('stage_logs')
        .insert([{
          session_id:         sessionId,
          user_id:            req.uid,
          vehicle_id:         vehicle.id,
          stage,
          attempt:            attemptNum,
          passed:             aiResult.verdict === 'pass',
          ai_verdict:         aiResult.verdict,
          ai_summary:         aiResult.summary,
          ai_recommendations: aiResult.recommendations || [],
          checklist_raw:      checklistText,
          metrics:            metrics,
        }])
        .select()
        .single();
      if (lErr) throw lErr;

      // ── Advance session if passed ──
      let sessionUpdate = { updated_at: new Date().toISOString() };
      if (aiResult.verdict === 'pass') {
        const newPassed = [...(session.stages_passed || []), stage];
        const nextStage = stage + 1;
        const isComplete = nextStage > 4;
        sessionUpdate = {
          ...sessionUpdate,
          stages_passed: newPassed,
          current_stage: isComplete ? stage : nextStage,
          status: isComplete ? 'complete' : 'active',
        };
      }

      await supabase
        .from('tune_sessions')
        .update(sessionUpdate)
        .eq('id', sessionId);

      res.json({
        ok: true,
        stage_log: stageLog,
        verdict: aiResult.verdict,
        summary: aiResult.summary,
        recommendations: aiResult.recommendations || [],
        passed: aiResult.verdict === 'pass',
        next_stage: aiResult.verdict === 'pass' ? (stage < 4 ? stage + 1 : null) : stage,
        session_complete: aiResult.verdict === 'pass' && stage === 4,
        checklist: checklistText,
      });

    } catch (e) {
      console.error('submit-stage error:', e);
      res.status(500).json({ ok: false, error: e.message });
    } finally {
      safeUnlink(filePath);
    }
  }
);

module.exports = router;
