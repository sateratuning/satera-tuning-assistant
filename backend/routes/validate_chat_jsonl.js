// Usage: node routes/validate_chat_jsonl.js file.jsonl
const fs = require("fs");
const rl = require("readline");

const file = process.argv[2];
if (!file) { console.error("Usage: node routes/validate_chat_jsonl.js file.jsonl"); process.exit(1); }

(async () => {
  let i = 0, ok = 0, bad = 0; const errs = [];
  const rli = rl.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }) });
  for await (const raw of rli) {
    i++; const t = raw.trim(); if (!t || t === "," || t === "[") continue;
    try {
      const o = JSON.parse(t);
      const msgs = o.messages;
      if (!Array.isArray(msgs) || msgs.length < 2) throw new Error("messages missing/too short");
      const hasUser = msgs.some(m => m.role === "user" && m.content?.trim());
      const hasAssistant = msgs.some(m => m.role === "assistant" && m.content?.trim());
      if (!hasUser || !hasAssistant) throw new Error("need user and assistant");
      ok++;
    } catch (e) { bad++; if (errs.length < 5) errs.push({ line: i, error: e.message, sample: t.slice(0,180) }); }
  }
  console.log(`Validated lines: ${i}. OK: ${ok}. Errors: ${bad}.`);
  if (errs.length) console.log("First errors:", errs);
  if (ok < 10) console.warn("WARNING: OK < 10. Add more examples before fine-tuning.");
  process.exit(bad ? 1 : 0);
})();
