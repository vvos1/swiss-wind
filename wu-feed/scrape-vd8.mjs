// VD8 camping station (Cheseaux-Noreaz / Yvonand). The page vd8.ch/meteo/ is a Cumulus "SteelSeries gauges" page
// that polls a small JSON file, realtimegauges.txt, which is read here once per pass (the page itself reads it about every minute).
//   node wu-feed/scrape-vd8.mjs site/vd8.json
import { writeFile, rename } from "node:fs/promises";

const TO_KMH = { "km/h": 1, "kmh": 1, "m/s": 3.6, "mph": 1.609344, "kts": 1.852, "kt": 1.852, "knots": 1.852 };
const n = v => { const x = parseFloat(String(v).replace(",", ".")); return Number.isFinite(x) ? x : null; };

export function parseVd8(j) {
  if (j && j.data !== undefined && j.wspeed === undefined) {       // long-poll wrapper: {timestamp, status, data:{...}}
    let d = j.data;
    if (typeof d === "string") { try { d = JSON.parse(d); } catch { throw new Error("vd8: data is not JSON, starts with: " + d.slice(0, 120)); } }
    if (!d || typeof d !== "object") throw new Error("vd8: empty data, status=" + j.status + ", keys=" + Object.keys(j));
    j = d;
  }
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
  const BASE = "http://www.vd8.ch/meteo/";                  // the site only works over http (its https certificate is for another host)
  const UA = { "user-agent": "Mozilla/5.0 swiss-wind-map (personal, low rate)" };
  const get = async (u) => { const r = await fetch(u, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(25000) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); };
  const notes = []; let text;
  // The gauges page names its data file in scripts/gauges.js (realTimeURL); read it instead of guessing.
  const cands = [];
  try {
    const js = await get(BASE + "scripts/gauges.js");
    const m = js.match(/realTimeURL\s*:\s*['"]([^'"]+)['"]/);
    if (m) cands.push(m[1]);
    const lits = [...new Set([...js.matchAll(/['"]([\w./-]+\.(?:txt|json|php|xml))['"]/g)].map(x => x[1]))];
    for (const l of js.split(/\r?\n/).filter(l => /longpoll|timestamp/i.test(l)).slice(0, 10)) console.log("gauges.js:", l.trim().slice(0, 220));
    notes.push("gauges.js realTimeURL=" + (m ? m[1] : "none") + "; data-file literals: " + lits.join(", "));
    cands.push(...lits);
  } catch (e) { notes.push("gauges.js: " + e.message); }
  cands.push("realtimegauges.txt", "realtimegauges.json", "realtime.txt");
  const urls = [];
  for (const c of [...new Set(cands)]) { const u = new URL(c, BASE).href; urls.push(u); if (/\.php$/.test(u)) urls.push(u + "?timestamp=0", u + "?timestamp=1&_=" + Date.now()); }
  for (const u of urls) {
    try {
      const t = await get(u);
      if (!t.trim().startsWith("{")) { notes.push(`${u}: not JSON (${t.slice(0, 80).replace(/\s+/g, " ")})`); continue; }
      let ok = false; try { parseVd8(JSON.parse(t)); ok = true; } catch (e) { notes.push(`${u}: ${e.message.slice(0, 80)} | raw: ${t.slice(0, 300).replace(/\s+/g, " ")}`); }
      if (ok) { text = t; notes.push("using " + u); break; }
    } catch (e) { notes.push(`${u}: ${e.message}`); }
  }
  if (!text) throw new Error("vd8 fetch failed:\n  " + notes.join("\n  "));
  console.log("vd8:", notes[notes.length - 1]);
  let j; try { j = JSON.parse(text); } catch { throw new Error("vd8: not JSON, starts with: " + text.slice(0, 200)); }
  const data = parseVd8(j);
  await writeFile(out + ".tmp", JSON.stringify(data)); await rename(out + ".tmp", out);
  console.log(new Date().toISOString(), "VD8", JSON.stringify(data));
}
