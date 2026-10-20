# Play

Browser games by [keff](https://keff.uk).

**[play.keff.uk](https://play.keff.uk/)**

| Game | Play | How it works |
| --- | --- | --- |
| JUKE | [/juke/](https://play.keff.uk/juke/) | One air hockey paddle against three AI opponents. Real OpenAI decisions or classic Arcade. |
| Harness Tycoon | [/harness-tycoon/](https://play.keff.uk/harness-tycoon/) | Assign agents, route tools and answer requests before their deadlines. Local simulation. |
| Token Factory | [/token-factory/](https://play.keff.uk/token-factory/) | Race a computer to 10,000 tokens. Hire models and upgrade machines. Local simulation. |

Each game has its own manifest, install icon and service-worker scope. The two strategy games work offline after loading.

## Agent access

Search with `GET /api/games?q=…`, or read `GET /api/games/{slug}`. The same catalogue is available through browser WebMCP (`search_games`, `get_game`) and Streamable HTTP MCP at `/mcp`. Tools only read the catalogue. They do not start matches or spend credits.

Discovery: `/llms.txt`, `/openapi.json`, `/.well-known/api-catalog` and `/mcp/server-card`. Store and game detail pages include HTML content, structured data and per-game social previews. Request `Accept: text/markdown` for Markdown.

## JUKE experiment

The experiment compares model decisions in a physical game. All models receive the same state format and can choose `intercept`, `press`, `left`, `center` or `right`.

| Opponent | API | Configuration |
| --- | --- | --- |
| GPT-6 Luna | `/v1/decisions` | One `choice` question |
| GPT-5.6 Luna | `/v1/responses` | Strict JSON schema, reasoning effort `none` |
| GPT-4.1 nano | `/v1/responses` | Strict JSON schema |

The Worker checks model availability before play. Physics runs in the browser; decisions arrive asynchronously, so API latency affects play. Costs use returned token usage. A Durable Object enforces a $0.50 allowance per browser per UTC day. The OpenAI key stays in the Worker secret.

Arcade uses local game AI, with selectable difficulty. Harness Tycoon and Token Factory do not call a model or incur API charges.

## Develop and deploy

```sh
npm ci
npm run check
npm test
npm run dev
```

`npm run build` bundles the store, both strategy games and JUKE into `public/`. `npm run deploy` checks and publishes the existing `juke-air-hockey` Cloudflare Worker. Keep its name to preserve secrets and Durable Object data. `wrangler.jsonc` owns the public domains and bindings.

The former `juke.keff.uk` domain redirects to Play. Card's old game routes transfer validated local best scores and open the corresponding game here.

The model references and official art used by the strategy games came from [Model cards](https://card.keff.uk/). Reference dates and sources remain in `content/tcg/` and the asset provenance files. Those assets retain their owners' rights.
