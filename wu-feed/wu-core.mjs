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

export function findKey(html) {
  const pats = [/[?&]apiKey=([0-9a-zA-Z]{32})/, /apiKey["'\s:=]+["']?([0-9a-zA-Z]{32})/i];
  for (const p of pats) { const m = p.exec(html); if (m) return m[1]; }
  return null;
}

export async function discoverKey(fetchFn = fetch) {
  const r = await fetchFn("https://www.wunderground.com/dashboard/pws/" + STATIONS[0], { headers: { "user-agent": UA } });
  const key = findKey(await r.text());
  if (!key) throw new Error("API key not found in the dashboard page. Set WU_API_KEY instead.");
  return key;
}

export async function fetchAll({ apiKey, fetchFn = fetch, stations = STATIONS } = {}) {
  const key = apiKey || (await discoverKey(fetchFn));
  const out = [];
  for (const id of stations) {          // one at a time, on purpose
    const empty = { id, ts: null, avg: null, gust: null, dir: null, temp: null };
    try {
      const u = `https://api.weather.com/v2/pws/observations/current?stationId=${id}&format=json&units=m&numericPrecision=decimal&apiKey=${key}`;
      const r = await fetchFn(u, { headers: { "user-agent": UA } });
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
