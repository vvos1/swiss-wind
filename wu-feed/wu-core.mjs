// Shared logic: read current observations for a few Weather Underground personal stations.
// Note: Weather Underground's terms intend its data for personal use of your own station. Keep this to a
// handful of stations and a 10 minute interval, as configured here.
export const STATIONS = ["IVAUD1", "IPRVER1", "IVAUDSTS2"];
const UA = "Mozilla/5.0 (compatible; personal-wind-map)";

export function normalize(o) {
  const m = o.metric || {};
  return {
    id: o.stationID,
    ts: o.obsTimeUtc ? Date.parse(o.obsTimeUtc) : null,
    avg: m.windSpeed ?? null,          // km/h
    gust: m.windGust ?? null,          // km/h
    dir: o.winddir ?? null,            // degrees, wind comes from
    temp: m.temp ?? null,
  };
}

export function findKeys(html) {
  const found = [];
  for (const p of [/[?&]apiKey=([0-9a-zA-Z]{32})/g, /apiKey["'\s:=]+["']?([0-9a-zA-Z]{32})/gi])
    for (const m of html.matchAll(p)) if (!found.includes(m[1])) found.push(m[1]);
  return found;
}
export const findKey = (html) => findKeys(html)[0] || null;

const obsUrl = (id, key) =>
  `https://api.weather.com/v2/pws/observations/current?stationId=${id}&format=json&units=m&numericPrecision=decimal&apiKey=${key}`;

// The dashboard page hands out several keys and only some are accepted, so every candidate is tested before use.
export async function discoverKey(fetchFn = fetch, tries = 4) {
  const tested = new Set();
  for (let t = 0; t < tries; t++) {
    const r = await fetchFn("https://www.wunderground.com/dashboard/pws/" + STATIONS[0], { headers: { "user-agent": UA } });
    for (const key of findKeys(await r.text())) {
      if (tested.has(key)) continue;
      tested.add(key);
      const probe = await fetchFn(obsUrl(STATIONS[0], key), { headers: { "user-agent": UA } });
      if (probe.status !== 401 && probe.status !== 403) return key;
    }
  }
  throw new Error(`No working API key found (${tested.size} candidates tried). Set WU_API_KEY instead.`);
}

export async function fetchAll({ apiKey, fetchFn = fetch, stations = STATIONS } = {}) {
  const key = apiKey || (await discoverKey(fetchFn));
  const out = [];
  for (const id of stations) {          // one at a time, on purpose
    const empty = { id, ts: null, avg: null, gust: null, dir: null, temp: null };
    try {
      const r = await fetchFn(obsUrl(id, key), { headers: { "user-agent": UA } });
      if (r.status === 204) { out.push(empty); continue; }          // station offline / no data
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      const o = j.observations && j.observations[0];
      out.push(o ? normalize(o) : empty);
    } catch (e) {
      out.push({ ...empty, error: String(e.message || e) });
    }
  }
  return out;
}

// Normalise an observation taken from the dashboard's own data (metric, imperial or uk_hybrid units, current or 1-day history).
export function normalizeAny(o) {
  const u = o.metric || o.imperial || o.uk_hybrid || {};
  const f = o.metric ? 1 : 1.609344;                       // imperial and uk_hybrid report wind in mph
  const wind = v => (v == null ? null : Math.round(v * f * 10) / 10);
  const temp = u.temp ?? u.tempAvg ?? null;
  return {
    id: o.stationID,
    ts: o.obsTimeUtc ? Date.parse(o.obsTimeUtc) : null,
    avg: wind(u.windSpeed ?? u.windspeedAvg ?? null),
    gust: wind(u.windGust ?? u.windgustHigh ?? null),
    dir: o.winddir ?? o.winddirAvg ?? null,
    temp: temp == null ? null : (o.imperial && !o.metric ? Math.round(((temp - 32) / 1.8) * 10) / 10 : temp),
  };
}
