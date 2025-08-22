const express = require('express');
const router = express.Router();

// quick test route so you can verify in a browser
router.get('/api/feedback/ping', (req, res) => {
  res.json({ ok: true, route: '/api/feedback' });
});

router.post('/api/feedback', (req, res) => {
  const { email, page, message } = req.body || {};
  const clamp = (s, n = 8000) => (s || '').toString().replace(/\0/g, '').slice(0, n);

  const payload = {
    email: clamp(email, 200) || null,
    page: clamp(page, 200) || null,
    message: clamp(message),
    at: new Date().toISOString(),
  };

  // For now we just log it; email sending comes next step
  console.log('[feedback]', payload);

  return res.json({ ok: true, delivered: false });
});

module.exports = router;
