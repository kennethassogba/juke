# JUKE

[Play JUKE](https://juke.keff.uk) · [Decisions API](https://developers.openai.com/api/docs/guides/decisions)

Can a decision model react quickly enough to play air hockey? JUKE makes API latency visible: one human paddle faces three real OpenAI opponents in a shared 3D rink. The puck keeps moving while each model decides.

The experiment is inspired by structured decision models such as [Jev by TypeSafe](https://openrouter.ai/typesafe/jev-1.13). JUKE currently compares these OpenAI configurations:

| Opponent | API | Decision configuration |
| --- | --- | --- |
| GPT-6 Luna | `/v1/decisions` | One `choice` question named `action`, with five allowed moves |
| GPT-5.6 Luna | `/v1/responses` | Strict JSON schema, reasoning effort `none`, 24 output tokens maximum |
| GPT-4.1 nano | `/v1/responses` | The same strict JSON schema and output limit |

## Play

Move with your mouse, finger or arrow keys. Protect the front goal and score in any coloured goal. First to 5 wins, or the higher score after 40 seconds. Toggle bumpers for a different match. Share a silent vertical replay afterwards. Supported phones can add JUKE to their home screen after a match.

## How it works

`Three.js rink → physical snapshot → Cloudflare Worker → OpenAI → chosen move → paddle target`

Every model gets the same state format: puck position and velocity, all four paddles, goals, bumpers and score. Coordinates rotate to put its own goal at `y=0`. All three use the same instructions and actions: `intercept`, `press`, `left`, `center`, `right`.

The browser runs physics at fixed 120 Hz steps. Each model has one request in flight, followed by a 1.1 second gap. A returned action sets a target using the snapshot that was sent. The paddle moves towards that target until the next response. There are no simulated model decisions. The characters are cosmetic and do not change the prompts.

Latency measures the upstream request through reading its response. Costs use returned token usage and the rates in `src/worker.js`; missing usage is shown as unknown. Models are checked for availability before play. Different goal positions and changing game states make this a playable experiment, not a controlled model benchmark.

## Daily allowance and email

keff funds $0.50 of API usage per browser per UTC day. An HttpOnly cookie identifies the browser across tabs and reloads. A Durable Object reserves a conservative amount before each request and settles against actual usage. Unconfirmed usage keeps its reservation for the day. The server rejects further calls when the remaining allowance cannot cover a reservation.

This is an anonymous browser allowance: clearing cookies or changing browsers creates a new identity. A separate IP limit allows 180 decisions per minute.

Mailing-list signup is optional. Cloudflare D1 stores email, consent wording, timestamp and an unsubscribe token. Signup does not send email. The site provides a removal button; future mailing tools must include the token-based unsubscribe link. Subscriber records and API keys stay outside this repository.

## Run and deploy

Requires Node.js 24.

```sh
npm ci
# Copy .dev.vars.example to .dev.vars and set your own OPENAI_API_KEY.
npx wrangler d1 migrations apply juke-mailing-list --local
npm run dev
```

Frontend: `src/game.js`, `src/scene.js`, `public/index.html`, `public/styles.css`. API, budget and signup: `src/worker.js`. `npm run check` checks syntax and rebuilds `public/app.js`.

Production uses Cloudflare Workers Builds on pushes to `main`. GitHub Actions also checks the build and Worker bundle. To deploy your own copy, replace the account-specific domain and D1 binding in `wrangler.jsonc`, create the database, apply its migrations, and set `OPENAI_API_KEY` with Wrangler. Keep the key in a Worker secret.
