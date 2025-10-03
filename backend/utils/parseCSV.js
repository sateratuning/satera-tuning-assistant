const parseCSV = require('../utils/parseCSV');

app.post('/review-log', upload.single('log'), (req, res) => {
  const raw = req.file.buffer.toString('utf-8');
  const metrics = parseCSV(raw);
  if (!metrics) return res.status(400).json({ error: 'Parse failed' });

  // Forward to AI review
  res.json({ ok: true, metrics });
});
