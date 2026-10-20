# Play

- [JUKE](https://play.keff.uk/apps/juke): Air hockey against three AI opponents.
- [Harness Tycoon](https://play.keff.uk/apps/harness-tycoon): Manage agents and tool calls.
- [Token Factory](https://play.keff.uk/apps/token-factory): Race to 10,000 tokens.

## Agent access

- Search: GET /api/games?q={query}
- Game: GET /api/games/{slug}
- OpenAPI: /openapi.json
- MCP: /mcp (Streamable HTTP, read-only)
- Browser WebMCP: search_games, get_game

Catalogue tools do not play matches or make paid API calls.
