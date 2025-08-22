    // routes/trainerAI.js
    require('dotenv').config(); // force-load .env locally

    const express = require('express');
    const router = express.Router();
    const multer = require('multer');
    const fs = require('fs');
    const path = require('path');
    const csvParser = require('csv-parser');
    const { OpenAI } = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });



    const upload = multer({ dest: 'uploads/' });

    function parseCSV(filePath) {
    return new Promise((resolve, reject) => {
        const rows = [];
        fs.createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (row) => rows.push(row))
        .on('end', () => resolve(rows))
        .on('error', reject);
    });
    }

    function cleanSparkTable(text) {
    const lines = text.trim().split('\n');
    const table = lines.slice(1).map(line =>
        line.trim().split('\t').slice(1, -1)
    );
    return table;
    }

    function compareTables(startTable, finalTable) {
    const changes = [];
    for (let i = 0; i < finalTable.length; i++) {
        for (let j = 0; j < finalTable[i].length; j++) {
        const start = parseFloat(startTable[i][j]);
        const end = parseFloat(finalTable[i][j]);
        if (!isNaN(start) && !isNaN(end) && start !== end) {
            changes.push({ row: i, col: j, from: start, to: end });
        }
        }
    }
    return changes;
    }

    router.post('/trainer-ai', upload.fields([
    { name: 'beforeLog', maxCount: 1 },
    { name: 'afterLog', maxCount: 1 }
    ]), async (req, res) => {
    try {
        const form = req.body;
        const startSpark = cleanSparkTable(form.sparkTableStart);
        const finalSpark = cleanSparkTable(form.sparkTableFinal);
        const changes = compareTables(startSpark, finalSpark);

        const beforeLogPath = req.files.beforeLog[0].path;
        const afterLogPath = req.files.afterLog[0].path;
        const beforeLogRows = await parseCSV(beforeLogPath);
        const afterLogRows = await parseCSV(afterLogPath);

        // Sample every 400th row for AI context
        const sample = (rows) => rows.filter((_, idx) => idx % 400 === 0);
        const beforeSample = sample(beforeLogRows);
        const afterSample = sample(afterLogRows);

        const prompt = `You are a professional HEMI tuner training an AI. Given the following:

    Vehicle Info:
    ${JSON.stringify(form, null, 2)}

    Spark Table Changes:
    ${JSON.stringify(changes.slice(0, 30), null, 2)}

    Before Log (sampled):
    ${JSON.stringify(beforeSample.slice(0, 10), null, 2)}

    After Log (sampled):
    ${JSON.stringify(afterSample.slice(0, 10), null, 2)}

    Explain in human terms what changed in the spark table and why. Include logic around knock, throttle, airmass, airflow, fueling, torque, MAP scaling, injector changes, neural network logic, etc. Be clear and thorough for model training purposes.`;

        const chatResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo-0125', // ✅ Supported

        messages: [
            { role: 'system', content: 'You are an expert HEMI tuning AI trainer.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.4
        });

        const aiSummary = chatResponse.choices[0].message.content;

        const trainingEntry = {
  vehicle: form,
  sparkChanges: changes,
  aiSummary,
  feedback: form.feedback || null,
  created_at: new Date().toISOString()
};

// ✅ Initialize Supabase client inside route (safe env timing)
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('❌ Supabase environment variables not loaded');
}

const supabase = createClient(supabaseUrl, supabaseKey);


// ✅ Insert into Supabase
const { data, error } = await supabase
  .from('trainer_entries')
  .insert([trainingEntry])
  .select(); // ✅ return the inserted row

if (error) {
  console.error('❌ Supabase insert error:', error);
}
const insertedEntry = data?.[0];


if (error) {
  console.error('❌ Supabase insert error:', error);
}

// ✅ Clean up uploaded files
fs.unlinkSync(beforeLogPath);
fs.unlinkSync(afterLogPath);

// ✅ Respond to frontend
res.json({ trainingEntry: insertedEntry, aiSummary });


    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'AI training failed.' });
    }
    });

    module.exports = router;
router.post('/update-feedback', express.json(), async (req, res) => {
  const { id, feedback } = req.body;
  if (!id || !feedback) {
    return res.status(400).json({ error: 'Missing id or feedback' });
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { error } = await supabase
    .from('trainer_entries')
    .update({ feedback })
    .eq('id', id);

  if (error) {
    console.error('❌ Feedback update error:', error);
    return res.status(500).json({ error: 'Update failed' });
  }

  res.json({ success: true });
});

// new new new


router.post('/fine-tune-now', async (req, res) => {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Step 1: Pull entries from Supabase
    const { data: entries, error } = await supabase
      .from('trainer_entries')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) throw new Error('Failed to fetch trainer entries');

    // Step 2: Format to JSONL
    const fineTuneData = entries
      .filter(entry => entry.aiSummary && entry.vehicle) // Only valid entries
      .map(entry => {
        const context = `Vehicle Info:\n${JSON.stringify(entry.vehicle, null, 2)}\n\nSpark Table Changes:\n${JSON.stringify(entry.sparkChanges || [], null, 2)}`;
        const feedbackNote = entry.feedback ? `\n\nTrainer Feedback:\n${entry.feedback}` : '';
        return {
          prompt: context,
          completion: entry.aiSummary + feedbackNote
        };
      });

    if (fineTuneData.length === 0) {
      return res.status(400).json({ error: 'No valid entries found to fine-tune on.' });
    }

    // Step 3: Write to temp .jsonl file
    const fs = require('fs');
    const path = require('path');
    const tempFilePath = path.join(__dirname, 'fine-tune-upload.jsonl');

    const jsonlContent = fineTuneData.map(entry => JSON.stringify(entry)).join('\n');
    fs.writeFileSync(tempFilePath, jsonlContent);

    // Step 4: Upload file to OpenAI
    const file = await openai.files.create({
      file: fs.createReadStream(tempFilePath),
      purpose: 'fine-tune'
    });

    // Step 5: Start fine-tuning job
    const fineTune = await openai.fineTuning.jobs.create({
      training_file: file.id,
      model: 'gpt-3.5-turbo-0125'
    });

    res.json({ message: 'Fine-tuning started', job: fineTune });
  } catch (err) {
    console.error('❌ Fine-tuning failed:', err);
    res.status(500).json({ error: 'Fine-tuning failed' });
  }
});
