// Ichtus page (St-Blaise): a Davis station on the Ichtus roof plus a table that also carries CVN (Holfuy, Neuchatel)
// and, when it works, Cudrefin. Speeds on that page are in KNOTS; the output file is in km/h like the others.
//   node wu-feed/scrape-ichtus.mjs site/ichtus.json
import { writeFile, rename } from "node:fs/promises";
import { zurichToMs } from "./scrape-yvbeach.mjs";

const URL_ = "http://webcam.ichtus.ch:8888/IW/WindMSChartMulipleValues.aspx";
const KMH = 1.852;
const NAMES = { Ichtus: "ICHTUS", CVN: "CVN", Cudrefin: "CUDREFIN" };
const clean = h => h.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&deg;/gi, "°").replace(/\s+/g, " ").trim();
const num = s => { const m = String(s ?? "").match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; };

export function parseIchtus(html) {
  const i = html.indexOf('id="tblStandardScreen"');
  if (i < 0) throw new Error("page layout not recognised: no summary table; starts with " + clean(html).slice(0, 200));
  const table = html.slice(i, html.indexOf("</table>", i));
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(r => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => clean(c[1])));
  const tm = clean(table).match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (!tm) throw new Error("no timestamp in table");
  let h = +tm[1] % 12 + (tm[3].toUpperCase() === "PM" ? 12 : 0);
  const ts = zurichToMs(+tm[6], +tm[4], +tm[5], h, +tm[2]);          // page shows Swiss local time, US date format
  const out = {}; let section = null, air = null, press = null;
  for (const c of rows) {
    const first = (c[0] || "").toLowerCase();
    if (first.startsWith("vent") && first.includes("moy")) { section = "avg"; continue; }
    if (first.startsWith("vent") && first.includes("max")) { section = "max"; continue; }
    if (c[0] === "Ichtus" && /current/i.test(c[1] || "")) { section = "other"; continue; }
    const id = NAMES[c[0]];
    if (id && section === "avg") {
      const dm = (c[5] || "").match(/([A-Z]{1,3})\s+(\d{1,3})/);
      out[id] = { id, ts, avg: num(c[4]) == null ? null : num(c[4]) * KMH, avg1: num(c[1]), dir: dm ? +dm[2] : null, gust: null };
    } else if (id && section === "max" && out[id]) out[id].gust = num(c[4]) == null ? null : num(c[4]) * KMH;
    else if (section === "other" && /^Air/.test(c[0]) ) air = num(c[1]);
    else if (section === "other" && /^Barometer/.test(c[0])) press = num(c[1]);
  }
  if (out.ICHTUS) { out.ICHTUS.temp = air; out.ICHTUS.pressure = press; }
  // a station with no 1-min value, 0 knots and direction 0 is a placeholder (Cudrefin when offline): drop it
  return Object.values(out).filter(s => s.avg != null && !(s.avg === 0 && s.dir === 0 && s.avg1 == null)).map(({ avg1, ...s }) => s);
}
if (process.argv[1] && process.argv[1].endsWith("scrape-ichtus.mjs")) {
  const out = process.argv[2] || "ichtus.json";
  const r = await fetch(URL_, { headers: { "user-agent": "Mozilla/5.0 swiss-wind-map (personal, low rate)" }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const data = parseIchtus(await r.text());
  if (!data.length) throw new Error("no stations parsed");
  await writeFile(out + ".tmp", JSON.stringify(data)); await rename(out + ".tmp", out);
  console.log(new Date().toISOString(), "ICHTUS", JSON.stringify(data));
}
