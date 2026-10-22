// Adds the latest reading of the stations we scrape ourselves (Wunderground, YvBeach, VD8, Ichtus/CVN) to history.json.
//   node wu-feed/build-history.mjs site
import { readFileSync, existsSync } from "node:fs";
import { loadHistory, addPoints, saveHistory } from "./history.mjs";

const dir = process.argv[2] || "site";
const rd = f => { try { return JSON.parse(readFileSync(`${dir}/${f}`, "utf8")); } catch { return null; } };
const h = loadHistory(`${dir}/history.json`);
let n = 0;
const add = (id, d) => { if (d && d.avg != null && d.ts) { addPoints(h, id, [d]); n++; } };
for (const d of rd("wu.json") || []) if (!d.error) add("wu:" + d.id, d);
const yv = rd("yv.json"); if (yv) add("yv:YVBEACH", yv);
const vd8 = rd("vd8.json"); if (vd8) add("vd8:VD8", vd8);
for (const d of rd("ichtus.json") || []) add("ich:" + d.id, d);
saveHistory(`${dir}/history.json`, h);
console.log(`history: +${n} latest readings, ${Object.keys(h.s).length} stations tracked`);
