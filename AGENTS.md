# Play

Play is the game store at https://play.keff.uk. This repository contains the store and JUKE, Harness Tycoon and Token Factory. The existing Cloudflare Worker name stays `juke-air-hockey` to preserve OpenAI secrets, Durable Objects and the mailing list.

- Store: white backgrounds, clear system sans-serif type, blue actions, generous editorial artwork, restrained App Store structure. No green or lime, no em dashes, no invented ratings or download counts.
- Games have independent manifests, IDs, install icons, service-worker scopes and caches. Never let a cache activation clear another game’s cache. OpenAI API responses must never be cached.
- JUKE is mounted at `/juke/`. Its server APIs are under `/juke/api/`. Keep real model calls, usage costs, asynchronous latency and the daily allowance. Never replace OpenAI decisions with local AI.
- Harness Tycoon and Token Factory run locally and can work offline. Their model labels and reference scores are game data, not evidence of live model calls.
- The old JUKE host redirects to `/juke/`; keep the old-root service-worker retirement route so existing installs can migrate.
- Keep local builds sequential with a 512 MB Node heap. Do not commit `output/`, recordings, credentials or local browser sessions.

Run `npm run check`, `npm test` and a Wrangler dry run before release. Verify the three game routes, distinct manifests, install instructions and the real JUKE API on the published origin. Cloudflare deployment uses the existing `wrangler.jsonc`.
