# Model cards
## Token factory

First contact is a collectible set of 120 cards. The browser game uses six model references with verified Intelligence Index scores and token prices. You race a computer opponent to make tokens.

## Start a round

Select Start making tokens. Both factories hire Luna from the same 60-credit starting budget. Production starts immediately. Tap or hold Make tokens to add tokens by hand. Tokens sell automatically for 0.35 game credits each.

The first factory to reach 10,000 tokens wins. If neither reaches the target in two minutes, the factory with more tokens wins. Equal totals are a tie. Pause stops both factories and the timer. Leaving the browser tab pauses the race; return and select Resume factory.

## Choose a model

A model has three reference attributes: Artificial Analysis Intelligence Index, input token price and output token price. API prices are USD per million tokens. Scores and prices come from the card’s dated sources. DeepSeek R1 refers to the original January 2025 release and launch prices.

Higher intelligence increases production. Input price sets a one-time hiring cost. Output price sets a running cost. Switching models replaces the active model and charges the full hiring cost. It keeps your machines and harness. Previously hired models have no resale value.

## Add a harness

Codex costs 100 credits. It gives OpenAI models 1.8× production and other models 1.15× production. Claude Code costs 100 credits and gives Anthropic models the 1.8× boost. OpenCode costs 80 credits and gives every model 1.35× production. Each harness also divides running costs by the same boost.

One harness can be connected at a time. Replacing it costs its full price; there is no stacking or refund. These boosts are game rules, not measured harness benchmarks.

## Add machines

Each upgrade multiplies automatic production, token costs and tokens made per tap by 1.65. A factory starts with one machine and can have nine. The next machine costs 60 × 1.8 to the power of the number of upgrades, rounded to the nearest credit. Machines persist when you switch models.

## Economy formulas

All credits, production rates and conversion factors are game values. They do not predict real model throughput or API billing.

- Hiring cost: round(40 + input price × 16) credits.
- Automatic tokens per second: Intelligence Index squared ÷ 60 × machine multiplier × harness boost.
- Running cost per second: output price × 0.8 × machine multiplier ÷ harness boost.
- Machine multiplier: 1.65 to the power of the number of upgrades.
- Tokens per tap: 8 × machine multiplier. Taps are limited to one every 0.14 seconds; holding makes five taps per second.
- Sales revenue: tokens × 0.35 credits.

Revenue and running costs settle continuously. A loss-making model stops when credits run out. Make tokens by hand to earn credits, or hire an affordable model once you have enough. Factories cannot go into debt.

## Computer opponent

The opponent runs locally in your browser. It uses the same model prices, starting budget, production formulas, harness costs and machine limit. It compares purchases by expected earnings and production over the remaining round, then buys an affordable improvement. It does not make hand-tapped tokens or receive extra credits.

The race number determines its decision timing. Play again repeats that race number; sharing a challenge link lets a friend face the same computer strategy. Timing and purchases still depend on how they play. Scores are stored only on your device; there is no global leaderboard or verified competitive ranking.

## After a round

Play again to restart. Challenge a friend shares a link to the same race. Save score image creates a portrait image on your device for sharing. It does not publish to a social account.

The collectible card catalogue and physical packs are independent of the free browser race. Buying a pack does not unlock browser upgrades. The stored physical card rules are a separate ruleset.

Made by k_eff: https://keff.uk
