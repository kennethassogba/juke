# Play release review

20 October 2026. Scope: store home, search and recent-game states, game details, installation entry points, and the two migrated strategy games. Stack: React with plain CSS, system sans-serif typography, white surfaces, blue actions and Phosphor icons. Project conventions are recorded in `AGENTS.md`; the original Card interface remains in its own repository.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | `src/store/Store.tsx`, `Install.tsx`, `SiteChrome.tsx`; browser accessibility snapshots; keyboard installation dialog and Escape | Named native controls, modal focus trap and return to a visible 3px focus ring verified. |
| Layout | `store.css`, `games.css`; desktop, 390px and 320px browser views | No horizontal overflow observed at 320px. The mobile feature image was moved beneath its text to prevent overlap. |
| Writing | `catalog.ts`, store labels, install instructions and both READMEs | Removed the redundant home slogan. Match length corrected against JUKE’s 40-second constant. Reference data and simulation descriptions retained. |
| Typography | Declared sizes, hierarchy, wrapping and rendered narrow game detail | System sans-serif, clear headings, wrapping actions and 16px search input. |
| Colors | Store and game tokens; rendered mobile feature; computed contrast pairs | Blue/white 5.51:1; muted/white 5.94:1; orange/white 5.86:1; purple/white 7.32:1. No green interface palette. |
| UI polish | Hover, press, focus and dialog rules in `store.css`, `games.css` and migrated game CSS | Neutral shadows, motion preference guards, 0.96 press scale and contained dialog scrolling. |

No actionable blocking interface findings remain in the inspected views.

## Verification

- `npm run check`, `npm test` and `wrangler deploy --dry-run` passed for Play.
- `node scripts/smoke-live.mjs --decisions` verified all store/game routes, three distinct manifest IDs and scopes, icons, the old JUKE redirect, the daily allowance and one real response from each requested OpenAI model.
- The production Harness Tycoon tutorial completed agent → tool → reply, awarding 25 credits and advancing to the next request.
- Token Factory started and produced tokens in the browser.
- Both strategy games loaded and accepted play actions with the local server stopped, after their individual service workers had installed. Installing the second game did not erase the first game’s offline shell.
- The old Card Harness URL opened `https://play.keff.uk/harness-tycoon/` through the score migration bridge.
- The installation dialog opened with Enter, closed with Escape and restored focus to the initiating button.
- Card’s catalogue, API, D1 waitlist, physical rules, discovery and Sites checks passed. The waitlist test required execution outside the restricted socket environment.

Not verified: native installation on physical iOS/Android devices, a hardware screen reader, 200% browser zoom and a rendered RTL layout. Reduced motion and logical layout properties were inspected in source.

Copy review used one corrective pass. The quote normalizer ran on selected plain prose paragraphs; the assessment of source facts and visible copy was manual. The writing detector and preservation validator did not run. No further justified copy edit was found in that scope.

**Approve** for the inspected views and checks. The unverified device and assistive-technology checks above remain outside this result.
