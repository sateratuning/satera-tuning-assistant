// src/api.js
export async function fetchLeaderboard(interval, filters = {}) {
  const params = new URLSearchParams({ interval, ...filters });
  const res = await fetch(`/api/leaderboard?${params}`);
  if (!res.ok) throw new Error("Failed to load leaderboard");
  return res.json();
}
export async function sendFeedback({ email, page, message, extra }) {
  const base = process.env.REACT_APP_API_BASE || '';
  const res = await fetch(`${base}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, page, message, extra }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Feedback failed (${res.status}): ${text}`);
  }
  const data = await res.json().catch(() => ({}));
  return !!data?.ok;
}
