// Usage: node routes/convert_jsonl.js input.jsonl output-chat.jsonl
const fs = require("fs");
const path = require("path");
const rl = require("readline");

const inp = process.argv[2] || "fine-tune-upload.jsonl";
const out = process.argv[3] || "fine-tune-upload-chat.jsonl";

const stripFences = s =>
  String(s ?? "")
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```$/i, "")
    .trim();

function normalize(obj) {
  // If it's already in chat format, just sanity-check and return
  if (Array.isArray(obj?.messages)) {
    const msgs = obj.messages
      .map(m => ({ role: String(m.role || "").trim(), content: stripFences(m.content) }))
      .filter(m => m.role && m.content);
    // require at least one user and one assistant
    const hasUser = msgs.some(m => m.role === "user");
    const hasAssistant = msgs.some(m => m.role === "assistant");
    if (hasUser && hasAssistant) return { messages: msgs };
    throw new Error("existing messages missing user/assistant");
  }

  // Otherwise expect {prompt, completion}
  const prompt = stripFences(obj?.prompt);
  const completion = stripFences(obj?.completion);
  if (!prompt || !completion) throw new Error("Missing prompt or completion");

  // Optional global instruction: uncomment if desired
  // const system = { role: "system", content: "Answer only with corrected spark table, no explanations." };

  return {
    messages: [
      // system,
      { role: "user", content: prompt },
      { role: "assistant", content: completion }
    ].filter(Boolean)
  };
}

(async () => {
  let lineNum = 0, converted = 0, skipped = 0;
  const outStream = fs.createWriteStream(out, { encoding: "utf8" });

  const rli = rl.createInterface({
    input: fs.createReadStream(inp, { encoding: "utf8" })
  });

  for await (const raw of rli) {
    lineNum++;
    const line = raw.trim();
    if (!line) continue;
    // ignore comments or accidental commas from arrays
    if (line.startsWith("//") || line === "," || line === "[") continue;

    try {
      const obj = JSON.parse(line.replace(/,+\s*$/, "")); // drop trailing commas
      const chat = normalize(obj);
      outStream.write(JSON.stringify(chat) + "\n");
      converted++;
    } catch (e) {
      console.error(`[line ${lineNum}] skipped: ${e.message}`);
      skipped++;
    }
  }
  outStream.end(() => {
    console.log(`Done. Converted: ${converted}, Skipped: ${skipped}`);
    console.log(`Wrote: ${path.resolve(out)}`);
    if (converted < 10) {
      console.warn("WARNING: You have fewer than 10 examples; fine-tuning will fail with invalid_n_examples.");
    }
  });
})();
