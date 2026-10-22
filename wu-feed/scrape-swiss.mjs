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
// SLF IMIS (snow/avalanche stations, many with wind): 30-minute means, speed in m/s -> km/h
export function parseImis(recs) {
  const rows = (recs || []).filter(r => r.VW_30MIN_MEAN != null && r.measure_date);
  if (!rows.length) return null;
  const l = rows[rows.length - 1];
  return { ts: Date.parse(l.measure_date), avg: l.VW_30MIN_MEAN * 3.6, gust: l.VW_30MIN_MAX == null ? null : l.VW_30MIN_MAX * 3.6, dir: l.DW_30MIN_MEAN ?? null, temp: l.TA_30MIN_MEAN ?? null };
}
// METAR (aviationweather.gov): speed in knots -> km/h, newest report per airport
export function parseMetar(list) {
  const best = new Map();
  for (const m of list || []) {
    if (!/, CH$/.test(m.name || "") || m.wspd == null || !m.obsTime) continue;
    if (!best.has(m.icaoId) || m.obsTime > best.get(m.icaoId).obsTime) best.set(m.icaoId, m);
  }
  return [...best.values()].map(m => ({ id: m.icaoId, name: m.name.replace(/, CH$/, "").replace(/, [A-Z]{2}$/, ""), lat: m.lat, lon: m.lon, alt: m.elev ?? null,
    ts: m.obsTime * 1000, avg: m.wspd * 1.852, gust: m.wgst == null ? null : m.wgst * 1.852, dir: typeof m.wdir === "number" ? m.wdir : null, temp: m.temp ?? null }));
}
// winds.mobi aggregates many wind networks (Holfuy, FFVL, Windline, ...). Speeds km/h, ts epoch seconds.
// Networks we already read directly are skipped so nothing is drawn twice.
const DUP = /pioupiou|openwindmap|meteoswiss|yvbeach|metar|aviationweather|slf|ichtus|vd8/i;
// Switzerland plus a border margin (Jura, Haute-Savoie, Black Forest edge, northern Italy), so French/neighbouring FFVL and Holfuy spots show up too
const WINDS_BBOX = { s: 45.4, n: 48.2, w: 5.2, e: 10.9 };
export function parseWinds(list, bbox) {
  const out = [];
  for (const st of list || []) {
    const id = String(st._id || ""), pv = String(st["pv-name"] || "");
    const c = st.loc && st.loc.coordinates, l = st.last;
    if (!c || !l || l["w-avg"] == null || !l._id || DUP.test(id) || DUP.test(pv)) continue;
    const [lon, lat] = c;
    if (bbox && (lat < bbox.s || lat > bbox.n || lon < bbox.w || lon > bbox.e)) continue;
    out.push({ id, name: st.name || st.short || id, provider: pv, lat, lon, alt: st.alt ?? null,
      ts: l._id * 1000, avg: l["w-avg"], gust: l["w-max"] ?? null, dir: l["w-dir"] ?? null, temp: l.temp ?? null });
  }
  return out;
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
  const slf = [];
  try {
    const sts = JSON.parse(await getText("https://measurement-api.slf.ch/public/api/imis/stations")).filter(x => x.country_code === "CH" || !x.country_code);
    await pool(sts, 8, async st => {
      try { const d = parseImis(JSON.parse(await getText(`https://measurement-api.slf.ch/public/api/imis/station/${st.code}/measurements`))); if (d) slf.push({ code: st.code, name: st.label, lat: st.lat, lon: st.lon, alt: st.elevation, ...d }); }
      catch (e) { failed.push("slf " + st.code + ":" + e.message); }
    });
  } catch (e) { failed.push("slf:" + e.message); }
  let metar = [];
  try { metar = parseMetar(JSON.parse(await getText(`https://aviationweather.gov/api/data/metar?bbox=${CH_BBOX.s},${CH_BBOX.w},${CH_BBOX.n},${CH_BBOX.e}&format=json&hours=3`))); }
  catch (e) { failed.push("metar:" + e.message); }
  let winds = [];
  try {
    // One big request comes back truncated, so cover the area with many small overlapping circles and merge by id.
    const tiles = []; const R = 40000;
    for (let lat = WINDS_BBOX.s; lat <= WINDS_BBOX.n + 0.2; lat += 0.45)
      for (let lon = WINDS_BBOX.w; lon <= WINDS_BBOX.e + 0.3; lon += 0.65) tiles.push([lat, lon]);
    const seen = new Map(); let tileFail = 0;
    await pool(tiles, 5, async ([la, lo]) => {
      try {
        const raw = JSON.parse(await getText(`https://winds.mobi/api/2/stations/?near-lat=${la.toFixed(3)}&near-lon=${lo.toFixed(3)}&near-distance=${R}&limit=1000`));
        for (const w of parseWinds(raw, WINDS_BBOX)) seen.set(w.id, w);
      } catch (e) { tileFail++; }
    });
    winds = [...seen.values()];
    const by = {}; for (const w of winds) by[w.provider] = (by[w.provider] || 0) + 1;
    console.log(`winds.mobi: ${tiles.length} tiles (${tileFail} failed), ${winds.length} stations kept; by provider`, JSON.stringify(by));
    if (tileFail > tiles.length / 2) failed.push("winds.mobi: " + tileFail + " tile failures");
  } catch (e) { failed.push("winds.mobi:" + e.message); }
  if (!smn.length && !piou.length) throw new Error("nothing fetched: " + failed.slice(0, 5).join("; "));
  await writeFile(out + ".tmp", JSON.stringify({ generated: Date.now(), smn, piou, slf, metar, winds }));
  await rename(out + ".tmp", out);
  console.log(new Date().toISOString(), `SWISS meteoswiss=${smn.length}/${stations.length} openwindmap=${piou.length} slf=${slf.length} metar=${metar.length} winds.mobi=${winds.length}`, failed.length ? "failed: " + failed.slice(0, 8).join("; ") : "");
}
