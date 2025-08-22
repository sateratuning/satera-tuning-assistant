// src/api.js
export async function fetchLeaderboard(interval, filters = {}) {
  const params = new URLSearchParams({ interval, ...filters });
  const res = await fetch(`/api/leaderboard?${params}`);
  if (!res.ok) throw new Error("Failed to load leaderboard");
  return res.json();
}
