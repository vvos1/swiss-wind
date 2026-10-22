// VD8 camping station (Cheseaux-Noreaz / Yvonand). The page vd8.ch/meteo/ is a Cumulus "SteelSeries gauges" page
// that polls a small JSON file, realtimegauges.txt, which is read here once per pass (the page itself reads it about every minute).
//   node wu-feed/scrape-vd8.mjs site/vd8.json
import { writeFile, rename } from "node:fs/promises";

const URLS = ["http://www.vd8.ch/meteo/realtimegauges.txt", "https://www.vd8.ch/meteo/realtimegauges.txt"];
const TO_KMH = { "km/h": 1, "kmh": 1, "m/s": 3.6, "mph": 1.609344, "kts": 1.852, "kt": 1.852, "knots": 1.852 };
const n = v => { const x = parseFloat(String(v).replace(",", ".")); return Number.isFinite(x) ? x : null; };

export function parseVd8(j) {
  const f = TO_KMH[String(j.windunit || "km/h").trim().toLowerCase()] ?? 1;
  const avg = n(j.wspeed), gust = n(j.wgust), dir = n(j.avgbearing ?? j.bearing);
  if (avg == null) throw new Error("no wspeed in file; keys: " + Object.keys(j).slice(0, 30).join(","));
  let ts = null;
  const t = String(j.timeUTC || "").split(",").map(Number);           // "yyyy,m,d,h,m,s" (UTC)
  if (t.length >= 5 && t.every(Number.isFinite)) {
    ts = Date.UTC(t[0], t[1] - 1, t[2], t[3], t[4], t[5] || 0);
    if (ts - Date.now() > 36e5) ts = Date.UTC(t[0], t[1], t[2], t[3], t[4], t[5] || 0);   // month turned out to be 0-based
  }
  return { id: "VD8", ts, avg: avg * f, gust: gust == null ? null : gust * f, dir, temp: n(j.temp), pressure: n(j.press) };
}
if (process.argv[1] && process.argv[1].endsWith("scrape-vd8.mjs")) {
  const out = process.argv[2] || "vd8.json";
  let text, last;
  for (const u of URLS) {
    try {
      const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0 swiss-wind-map (personal, low rate)" }, redirect: "follow" });
      if (r.ok) { text = await r.text(); break; }
      last = "HTTP " + r.status;
    } catch (e) { last = e.message; }
  }
  if (!text) throw new Error("vd8 fetch failed: " + last);
  let j; try { j = JSON.parse(text); } catch { throw new Error("vd8: not JSON, starts with: " + text.slice(0, 200)); }
  const data = parseVd8(j);
  await writeFile(out + ".tmp", JSON.stringify(data)); await rename(out + ".tmp", out);
  console.log(new Date().toISOString(), "VD8", JSON.stringify(data));
}
