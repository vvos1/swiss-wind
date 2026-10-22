# swiss-wind

Live wind map for Vaud and the lakes (Léman, Yverdon, Neuchâtel).

- `site/index.html`: the map (Leaflet). Reads MeteoSwiss open data and the OpenWindMap network in the browser.
- `wu-feed/`: fetches three Weather Underground stations every 5 minutes (`scrape-wu.mjs`), or as a Cloudflare Worker (`wu-worker.js`).
- `.github/workflows/wu-feed.yml`: runs the fetcher on a schedule and publishes `site/` to the `gh-pages` branch.

Data: MeteoSwiss (cite "Source: MeteoSwiss"), OpenWindMap, swisstopo map tiles.

To open site go to: https://vvos1.github.io/swiss-wind/
