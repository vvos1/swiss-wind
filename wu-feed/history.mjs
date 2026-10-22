// Rolling 24 h history for every station, kept in site/history.json.
// Format: {v:1, s:{ "<station id>": [[minutesSinceEpoch, avg*10 (km/h), gust*10 | null, dir | null], ...] }}
import { readFileSync, writeFileSync, renameSync } from "node:fs";

export const KEEP_MIN = 24 * 60;
export function loadHistory(path) {
  try { const h = JSON.parse(readFileSync(path, "utf8")); if (h && h.s) return h; } catch {}
  return { v: 1, s: {} };
}
export function addPoints(h, id, pts) {            // pts: [{ts(ms), avg, gust, dir}]
  const cutoff = Math.round(Date.now() / 60000) - KEEP_MIN;
  const m = new Map((h.s[id] || []).map(r => [r[0], r]));
  for (const p of pts) {
    if (p.ts == null || p.avg == null || !Number.isFinite(p.avg)) continue;
    const t = Math.round(p.ts / 60000);
    if (t < cutoff) continue;
    m.set(t, [t, Math.round(p.avg * 10), p.gust == null || !Number.isFinite(p.gust) ? null : Math.round(p.gust * 10), p.dir == null || !Number.isFinite(p.dir) ? null : Math.round(p.dir)]);
  }
  const arr = [...m.values()].filter(r => r[0] >= cutoff).sort((a, b) => a[0] - b[0]);
  if (arr.length) h.s[id] = arr; else delete h.s[id];
}
export function pruneOld(h) {                      // drop stations with nothing left in the window
  const cutoff = Math.round(Date.now() / 60000) - KEEP_MIN;
  for (const id of Object.keys(h.s)) { h.s[id] = h.s[id].filter(r => r[0] >= cutoff); if (!h.s[id].length) delete h.s[id]; }
}
export function saveHistory(path, h) { pruneOld(h); writeFileSync(path + ".tmp", JSON.stringify(h)); renameSync(path + ".tmp", path); }
