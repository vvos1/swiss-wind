// Reads the YvBeach station page (static HTML, rewritten every few minutes) and writes yv.json.
//   node wu-feed/scrape-yvbeach.mjs site/yv.json
import { writeFile, rename } from "node:fs/promises";

const URL_ = "https://www.yvbeach.com/yvmeteo.htm";
const num = s => (s == null ? null : parseFloat(String(s).replace(",", ".")));

export function toText(html) {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&deg;/gi, "°").replace(/&amp;/gi, "&").replace(/\s+/g, " ");
}
// Swiss local time -> UTC ms (handles summer/winter time)
export function zurichToMs(y, mo, d, h, mi) {
  let t = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(t).map(x => [x.type, x.value]));
    const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    t += Date.UTC(y, mo - 1, d, h, mi) - shown;
  }
  return t;
}
const DIRS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
export function parseYv(html) {
  const t = toText(html);
  const m = (re) => { const r = t.match(re); return r ? r : null; };
  const avg = m(/VENT\s*moy\s*\/\s*10\s*min\s*:?\s*([\d.,]+)\s*km/i);
  const gust = m(/RAFALE[^:]{0,20}:?\s*([\d.,]+)\s*km/i);
  const dir = m(/DIRECTION[^:]{0,20}:?\s*([NSEWO]{1,3})?\s*-?\s*(\d{1,3})\s*[°�]?/i);
  const date = m(/(\d{1,2})\/(\d{1,2})\/(\d{4})\D{1,6}(\d{1,2})\s*h\s*(\d{2})/i);
  const temp = m(/TEMPERATURE\s*:?\s*(-?[\d.,]+)\s*[°�]?\s*C/i);
  const pres = m(/PRESSION\s*:?\s*([\d.,]+)\s*mb/i);
  if (!avg || !date) throw new Error("page layout not recognised: " + t.slice(0, 300));
  const d = +dir?.[2];
  return { id: "YVBEACH", ts: zurichToMs(+date[3], +date[2], +date[1], +date[4], +date[5]),
    avg: num(avg[1]), gust: gust ? num(gust[1]) : null, dir: dir ? d : null, temp: temp ? num(temp[1]) : null, pressure: pres ? num(pres[1]) : null };
}
if (process.argv[1] && process.argv[1].endsWith("scrape-yvbeach.mjs")) {
  const out = process.argv[2] || "yv.json";
  const r = await fetch(URL_, { headers: { "user-agent": "Mozilla/5.0 swiss-wind-map" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const html = new TextDecoder("windows-1252").decode(await r.arrayBuffer());
  const data = parseYv(html);
  await writeFile(out + ".tmp", JSON.stringify(data)); await rename(out + ".tmp", out);
  console.log(new Date().toISOString(), "YVBEACH", JSON.stringify(data));
}
