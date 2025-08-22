// backend/routes/feedback.js
const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');

// --- Supabase (optional: keeps your previous insert) ---
let supabase = null;
try {
  const getSupabase = require('../Lib/supabase'); // ← keep this path/casing consistent with your repo
  supabase = getSupabase();
} catch (e) {
  console.warn('Supabase client not loaded (continuing without DB insert).');
}

// --- Mail transport (SMTP) ---
// Set these in your server env (or hosting provider’s dashboard):
// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_TO, MAIL_FROM (optional)
const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  MAIL_TO,
  MAIL_FROM,
} = process.env;

const smtpPort = Number(SMTP_PORT || 587);
const mailer = nodemailer.createTransport({
  host: SMTP_HOST,
  port: smtpPort,
  secure: smtpPort === 465, // true for 465, false for 587/25
  auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
});

// Util to safely stringify meta
const pretty = (obj) => {
  try { return JSON.stringify(obj ?? {}, null, 2); }
  catch { return String(obj); }
};

// Table schema suggestion (if you keep Supabase insert):
// create table if not exists feedback (
//   id uuid primary key default gen_random_uuid(),
//   message text not null,
//   meta jsonb,
//   user_agent text,
//   ip text,
//   created_at timestamptz default now()
// );

router.post('/api/feedback', async (req, res) => {
  try {
    const { message, meta = {} } = req.body || {};
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    const userAgent = req.get('user-agent') || null;
    const ip =
      (req.headers['x-forwarded-for'] || '')
        .toString()
        .split(',')[0]
        .trim() ||
      req.socket?.remoteAddress ||
      null;

    // 1) (Optional) Save to Supabase
    let savedId = null;
    if (supabase) {
      const { error, data } = await supabase
        .from('feedback')
        .insert([{ message, meta, user_agent: userAgent, ip }])
        .select()
        .single();

      if (error) {
        console.error('Supabase insert error:', error);
      } else {
        savedId = data?.id || null;
      }
    }

    // 2) Send email notification
    // Pull email & page from meta if provided by the frontend
    const reporterEmail = meta?.email || meta?.userEmail || null;
    const page = meta?.page || 'Unknown page';
    const interval = meta?.interval ? ` | interval: ${meta.interval}` : '';
    const maskedUser = meta?.user || 'Guest';

    if (!SMTP_HOST || !MAIL_TO) {
      console.warn('SMTP not configured (missing SMTP_HOST or MAIL_TO). Skipping email send.');
    } else {
      const fromAddr = MAIL_FROM || SMTP_USER || 'no-reply@sateratuning.com';
      const subject = `New feedback from ${maskedUser} — ${page}${interval}`;

      const text = [
        `New feedback received:`,
        ``,
        `From:  ${maskedUser}${reporterEmail ? ` <${reporterEmail}>` : ''}`,
        `Page:  ${page}`,
        interval ? `Info:  ${interval.replace(' | ', '')}` : '',
        `IP:    ${ip}`,
        `Agent: ${userAgent}`,
        ``,
        `Message:`,
        `${message}`,
        ``,
        `Meta:`,
        `${pretty(meta)}`,
        ``,
        savedId ? `DB Row ID: ${savedId}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const html = `
        <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;line-height:1.45">
          <h2 style="margin:0 0 10px">New feedback received</h2>
          <table cellpadding="6" style="border-collapse:collapse;background:#f8f9fa;border:1px solid #e6e8eb">
            <tr><td><b>From</b></td><td>${maskedUser}${reporterEmail ? ` &lt;${reporterEmail}&gt;` : ''}</td></tr>
            <tr><td><b>Page</b></td><td>${page}</td></tr>
            ${interval ? `<tr><td><b>Interval</b></td><td>${meta.interval}</td></tr>` : ''}
            <tr><td><b>IP</b></td><td>${ip || ''}</td></tr>
            <tr><td><b>User Agent</b></td><td>${userAgent || ''}</td></tr>
            ${savedId ? `<tr><td><b>DB Row ID</b></td><td>${savedId}</td></tr>` : ''}
          </table>
          <h3 style="margin:16px 0 6px">Message</h3>
          <pre style="white-space:pre-wrap;background:#0f130f;color:#d9ffe0;border:1px solid #1e2b1e;border-radius:6px;padding:10px">${message}</pre>
          <h3 style="margin:16px 0 6px">Meta</h3>
          <pre style="white-space:pre-wrap;background:#0f130f;color:#d9ffe0;border:1px solid #1e2b1e;border-radius:6px;padding:10px">${pretty(meta)}</pre>
        </div>
      `;

      await mailer.sendMail({
        from: fromAddr,
        to: MAIL_TO,
        subject,
        text,
        html,
        replyTo: reporterEmail || undefined,
      });
    }

    return res.json({ ok: true, id: savedId, emailed: Boolean(SMTP_HOST && MAIL_TO) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
