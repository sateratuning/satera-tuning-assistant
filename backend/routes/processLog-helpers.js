// backend/routes/processLog.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const { parseLogFile } = require('./processLog-helpers');

// Ensure uploads dir exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const upload = multer({ dest: uploadsDir });

// Build text block
const block = (lines) => lines.filter(Boolean).join('\n');

router.post('/api/review-log', upload.single('log'), async (req, res) => {
  let filePath;
  try {
    if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded.' });
    filePath = req.file.path;

    const raw = fs.readFileSync(filePath, 'utf8');
    const { metrics, graphs } = parseLogFile(raw);

    if (!metrics) return res.status(400).json({ error: 'Failed to parse CSV / extract metrics.' });

    const summary = [];

    // Build summary from metrics
    if (metrics.peakKnock !== undefined) {
      summary.push(metrics.peakKnock > 0
        ? `⚠️ Knock detected: up to ${metrics.peakKnock.toFixed(1)}°`
        : '✅ No knock detected.');
    }

    if (metrics.peakTiming && metrics.peakTimingRPM) {
      summary.push(`📈 Peak timing under WOT: ${metrics.peakTiming.toFixed(1)}° @ ${metrics.peakTimingRPM.toFixed(0)} RPM`);
    }

    if (metrics.mapWOTmin !== undefined && metrics.mapWOTmax !== undefined) {
      summary.push(`🌡 MAP under WOT: ${metrics.mapWOTmin.toFixed(1)} – ${metrics.mapWOTmax.toFixed(1)} kPa`);
    }

    if (metrics.ks1max !== null) {
      summary.push(
        metrics.ks1max > 3.0
          ? `⚠️ Knock Sensor 1 exceeded 3.0V (Peak: ${metrics.ks1max.toFixed(2)}V)`
          : `✅ Knock Sensor 1 safe (Peak: ${metrics.ks1max.toFixed(2)}V)`
      );
    }
    if (metrics.ks2max !== null) {
      summary.push(
        metrics.ks2max > 3.0
          ? `⚠️ Knock Sensor 2 exceeded 3.0V (Peak: ${metrics.ks2max.toFixed(2)}V)`
          : `✅ Knock Sensor 2 safe (Peak: ${metrics.ks2max.toFixed(2)}V)`
      );
    }

    if (metrics.varFT !== null) {
      summary.push(metrics.varFT > 10
        ? '⚠️ Fuel trim variance > 10% between banks'
        : '✅ Fuel trim variance within 10%');
    }

    if (metrics.avgFT1 !== null) summary.push(`📊 Avg fuel correction (Bank 1): ${metrics.avgFT1.toFixed(1)}%`);
    if (metrics.avgFT2 !== null) summary.push(`📊 Avg fuel correction (Bank 2): ${metrics.avgFT2.toFixed(1)}%`);

    if (metrics.oilMin !== null) {
      summary.push(metrics.oilMin < 20
        ? '⚠️ Oil pressure dropped below 20 psi.'
        : '✅ Oil pressure within safe range.');
    }

    if (metrics.ectMax !== null) {
      summary.push(metrics.ectMax > 230
        ? '⚠️ Coolant temp exceeded 230°F.'
        : '✅ Coolant temp within safe limits.');
    }

    if (metrics.misfires && Object.keys(metrics.misfires).length) {
      const misfireReport = Object.entries(metrics.misfires)
        .map(([cyl, count]) => `- Cylinder ${cyl}: ${count} misfires`);
      summary.push(`🚨 Misfires detected:\n${misfireReport.join('\n')}`);
    } else {
      summary.push('✅ No misfires detected.');
    }

    if (metrics.zeroTo60) summary.push(`🚦 Best 0–60 mph: ${metrics.zeroTo60.toFixed(2)}s`);
    if (metrics.fortyTo100) summary.push(`🚀 Best 40–100 mph: ${metrics.fortyTo100.toFixed(2)}s`);
    if (metrics.sixtyTo130) summary.push(`🚀 Best 60–130 mph: ${metrics.sixtyTo130.toFixed(2)}s`);

    res.json({
      summaryText: block(summary),
      metrics,
      graphs,
      aiEligible: true
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Log processing failed.' });
  } finally {
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
  }
});

module.exports = router;
