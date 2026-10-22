// Run every 10 minutes (cron: */10 * * * *) next to the map:  node scrape-wu.mjs [output.json]
// Writes wu.json, which the page reads when WU_FEED_URL = "wu.json".
import { writeFile, rename } from "node:fs/promises";
import { fetchAll } from "./wu-core.mjs";

const out = process.argv[2] || "wu.json";
const data = await fetchAll({ apiKey: process.env.WU_API_KEY });
await writeFile(out + ".tmp", JSON.stringify(data));
await rename(out + ".tmp", out);                       // replace atomically
console.log(new Date().toISOString(), data.map(d => `${d.id}:${d.avg ?? (d.error ? "err" : "off")}`).join(" "));
