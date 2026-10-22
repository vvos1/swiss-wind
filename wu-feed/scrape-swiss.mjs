// All of Switzerland in one file: every MeteoSwiss SwissMetNet station that measures wind + every OpenWindMap/Pioupiou beacon.
// Runs on the GitHub runner so visitors download one small file instead of ~160 CSVs.   node wu-feed/scrape-swiss.mjs site/swiss.json
import { writeFile, rename } from "node:fs/promises";

const BASE = "https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/";
const CH_BBOX = { s: 45.8, n: 47.85, w: 5.9, e: 10.55 };
const num = v => (v === "" || v == null) ? null : (Number.isFinite(parseFloat(v)) ? parseFloat(v) : null);
const parseUTC = s => { const m = /(\d\d)\.(\d\d)\.(\d{4}) (\d\d):(\d\d)/.exec(s); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]) : null; };

export function parseMeta(txt) {
  const lines = txt.trim().split(/\r?\n/), head = lines[0].split(";"), ix = n => head.indexOf(n), out = [];
  for (const l of lines.slice(1)) {
    const c = l.split(";"), lat = parseFloat(c[ix("station_coordinates_wgs84_lat")]), lon = parseFloat(c[ix("station_coordinates_wgs84_lon")]);
    if (c[ix("station_abbr")] && !isNaN(lat) && !isNaN(lon))
      out.push({ code: c[ix("station_abbr")], name: c[ix("station_name")], lat, lon, alt: parseFloat(c[ix("station_height_masl")]), canton: c[ix("station_canton")] });
  }
  return out;
}
// Same columns as the page used: fu3010z0 mean wind km/h, fu3010z1 gust, dkl010z0 direction, tre200s0 temperature
export function parseSmn(txt) {
  const lines = txt.trim().split(/\r?\n/), head = lines[0].split(";"), ix = n => head.indexOf(n);
  const iT = ix("reference_timestamp"), iA = ix("fu3010z0"), iG = ix("fu3010z1"), iD = ix("dkl010z0"), iTemp = ix("tre200s0");
  if (iA < 0) return null;                                  // station has no wind sensor
  const rows = lines.slice(1).map(l => l.split(";")).map(c => ({ ts: parseUTC(c[iT]), avg: num(c[iA]), gust: num(c[iG]), dir: num(c[iD]), temp: num(c[iTemp]) }))
    .filter(x => x.ts && x.avg != null);
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  return { ...last, hist: rows.slice(-13).map(r => ({ ts: r.ts, avg: r.avg })) };
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); })); }
const getText = async (u, dec) => { const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error("HTTP " + r.status); return new TextDecoder(dec || "utf-8").decode(await r.arrayBuffer()); };

if (process.argv[1] && process.argv[1].endsWith("scrape-swiss.mjs")) {
  const out = process.argv[2] || "swiss.json";
  const stations = parseMeta(await getText(BASE + "ogd-smn_meta_stations.csv", "windows-1252"));
  const smn = [], failed = [];
  await pool(stations, 10, async st => {
    const c = st.code.toLowerCase();
    try { const d = parseSmn(await getText(`${BASE}${c}/ogd-smn_${c}_t_now.csv`, "windows-1252")); if (d) smn.push({ ...st, ...d }); }
    catch (e) { failed.push(st.code + ":" + e.message); }
  });
  let piou = [];
  try {
    const j = JSON.parse(await getText("https://api.pioupiou.fr/v1/live-with-meta/all"));
    piou = j.data.filter(d => d.location && d.location.success && d.location.latitude >= CH_BBOX.s && d.location.latitude <= CH_BBOX.n &&
        d.location.longitude >= CH_BBOX.w && d.location.longitude <= CH_BBOX.e && d.measurements && d.measurements.wind_speed_avg != null)
      .map(d => ({ id: d.id, name: (d.meta && d.meta.name) || ("Pioupiou " + d.id), lat: d.location.latitude, lon: d.location.longitude,
        ts: Date.parse(d.measurements.date), avg: d.measurements.wind_speed_avg, gust: d.measurements.wind_speed_max, dir: d.measurements.wind_heading }));
  } catch (e) { failed.push("pioupiou:" + e.message); }
  if (!smn.length && !piou.length) throw new Error("nothing fetched: " + failed.slice(0, 5).join("; "));
  await writeFile(out + ".tmp", JSON.stringify({ generated: Date.now(), smn, piou }));
  await rename(out + ".tmp", out);
  console.log(new Date().toISOString(), `SWISS meteoswiss=${smn.length}/${stations.length} openwindmap=${piou.length}`, failed.length ? "failed: " + failed.slice(0, 8).join("; ") : "");
}
