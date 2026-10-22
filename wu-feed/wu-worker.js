// Cloudflare Worker: GET / returns the latest observations as JSON, cached for 10 minutes.
// Upstream is contacted at most once per 10 minutes no matter how many people open the map.
import { fetchAll } from "./wu-core.mjs";

const TTL = 600;
const CORS = { "access-control-allow-origin": "*" };

export default {
  async fetch(request, env, ctx) {
    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).origin + "/wu-v1");
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
    try {
      const data = await fetchAll({ apiKey: env.WU_API_KEY });
      const res = new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json", "cache-control": `public, max-age=${TTL}`, ...CORS },
      });
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: { "content-type": "application/json", ...CORS } });
    }
  },
};
