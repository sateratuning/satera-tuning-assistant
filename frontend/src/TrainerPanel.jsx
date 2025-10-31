// frontend/src/TrainerPanel.jsx
import React, { useState } from "react";

const API_BASE = process.env.REACT_APP_API_BASE || "";

export default function TrainerPanel({ trainerEntryId, getCurrentChatPairs }) {
  // getCurrentChatPairs should return an array like:
  // [{ system: "Answer only with corrected spark table, no explanations.", user: "...", assistant: "...", notes?: "" }, ...]
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [examplesTotal, setExamplesTotal] = useState(null);

  const saveChat = async () => {
    try {
      setBusy(true);
      setToast("");
      const chatPairs = (getCurrentChatPairs?.() || []).filter(p => p.user && p.assistant);
      if (chatPairs.length === 0) {
        setToast("No chat to save. Finish the conversation first.");
        return;
      }
      const res = await fetch(`${API_BASE}/trainer/save-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trainer_entry_id: trainerEntryId,
          chatPairs
        })
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Save chat failed");
      setToast(`Saved ${j.added} example(s) to entry ${j.trainer_entry_id}. Total in entry: ${j.total_examples_for_entry}`);
    } catch (e) {
      setToast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const finalizeAppend = async () => {
    try {
      setBusy(true);
      setToast("");
      const res = await fetch(`${API_BASE}/trainer/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trainer_entry_id: trainerEntryId,
          appendToJsonl: true
        })
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Finalize failed");
      setExamplesTotal(j.totalExamplesInFile ?? null);
      setToast(`Appended ${j.appended} example(s) → ${j.jsonlPath}. Total in file: ${j.totalExamplesInFile}`);
    } catch (e) {
      setToast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="trainer-panel">
      <div className="flex gap-2 mb-3">
        <button disabled={!trainerEntryId || busy}
                className="btn"
                onClick={saveChat}>
          Save Chat as Training
        </button>
        <button disabled={!trainerEntryId || busy}
                className="btn"
                onClick={finalizeAppend}>
          Finalize & Append JSONL
        </button>
      </div>

      {examplesTotal !== null && (
        <div className="text-sm opacity-80">Examples in JSONL: {examplesTotal} {examplesTotal < 10 ? " (need ≥ 10 for fine-tune)" : " ✅"}</div>
      )}

      {toast && (
        <div className="mt-2 text-xs p-2 rounded bg-black/30 border border-white/10">
          {toast}
        </div>
      )}
    </div>
  );
}
