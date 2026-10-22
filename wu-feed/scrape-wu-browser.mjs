// Opens each Weather Underground dashboard in a headless browser and captures the observation the page loads itself.
// Usage: node scrape-wu-browser.mjs [output.json]      (needs: npm i playwright && npx playwright install chromium)
import { chromium } from "playwright";
import { writeFile, rename } from "node:fs/promises";
import { STATIONS, normalizeAny } from "./wu-core.mjs";

const out = process.argv[2] || "wu.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
let browser;
try { browser = await chromium.launch({ channel: "chrome" }); }      // Chrome is preinstalled on GitHub runners: nothing to download
catch { browser = await chromium.launch(); }                          // otherwise the bundled Chromium (needs: npx playwright install chromium)
const ctx = await browser.newContext({ locale: "en-US", userAgent: UA, viewport: { width: 1280, height: 900 } });
const results = [];

for (const id of STATIONS) {            // one station at a time, on purpose
  const empty = { id, ts: null, avg: null, gust: null, dir: null, temp: null };
  const page = await ctx.newPage();
  const seen = [];
  let obs = null;
  page.on("response", async (r) => {
    const u = r.url();
    if (!u.includes("api.weather.com")) return;
    seen.push(r.status() + " " + u.replace(/apiKey=[^&]+/, "apiKey=…").slice(0, 150));
    if (!/pws\/observations\/(current|all)/.test(u) || !r.ok()) return;
    try {
      const j = await r.json();
      const list = j.observations || [];
      if (list.length) obs = list[list.length - 1];
    } catch { /* not JSON */ }
  });
  try {
    await page.goto("https://www.wunderground.com/dashboard/pws/" + id, { waitUntil: "domcontentloaded", timeout: 45000 });
    for (let i = 0; i < 50 && !obs; i++) await page.waitForTimeout(500);     // up to 25 s
    if (obs) results.push(normalizeAny(obs));
    else results.push({ ...empty, error: "no observation seen" });
  } catch (e) {
    results.push({ ...empty, error: String(e.message || e).split("\n")[0] });
  }
  if (!obs) console.log(`${id}: api calls seen: ${seen.length ? "\n  " + seen.join("\n  ") : "none"}`);
  await page.close();
}
await browser.close();

await writeFile(out + ".tmp", JSON.stringify(results));
await rename(out + ".tmp", out);
console.log(new Date().toISOString(), results.map(d => `${d.id}:${d.avg ?? (d.error ? "err(" + d.error + ")" : "off")}`).join(" "));
if (results.every(d => d.avg == null && d.error)) process.exitCode = 1;   // nothing worked: fail the run so old data is kept
