import {games,searchGames,publicGame,origin} from './store/catalog.ts';
export const catalogTools=[
 {name:'search_games',description:'Search the Play game catalogue. Returns controls, install links and model details without starting a match.',inputSchema:{type:'object',properties:{query:{type:'string',maxLength:120}},additionalProperties:false}},
 {name:'get_game',description:'Read one game, including controls, modes and install links.',inputSchema:{type:'object',properties:{slug:{type:'string',enum:games.map(g=>g.slug)}},required:['slug'],additionalProperties:false}}
];
export function runCatalogTool(name,args={}){
 if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('Arguments must be an object.');
 if(name==='search_games'){
  if(Object.keys(args).some(k=>k!=='query')||(args.query!==undefined&&(typeof args.query!=='string'||args.query.length>120)))throw new Error('Use a query of at most 120 characters.');
  return {games:searchGames(args.query||'').map(publicGame)};
 }
 if(name==='get_game'){
  if(Object.keys(args).some(k=>k!=='slug'))throw new Error('Only slug is accepted.');
  const game=games.find(g=>g.slug===args.slug);if(!game)throw new Error('Unknown game.');return publicGame(game);
 }
 throw new Error('Unknown tool.');
}
export function gameMarkdown(game){return `# ${game.name}\n\n${game.description}\n\nPlay: ${origin}/${game.slug}/\nInstall: ${origin}/${game.slug}/?install=1\nManifest: ${origin}/${game.slug}/manifest.webmanifest\n\n## Controls\n\n${game.controls}\n\n## Modes and rules\n\n${game.features.map(s=>'- '+s).join('\n')}\n`;}
export const catalogueMarkdown=()=>`# Play\n\n${games.map(g=>`- [${g.name}](${origin}/apps/${g.slug}): ${g.subtitle}.`).join('\n')}\n\n## Agent access\n\n- Search: GET /api/games?q={query}\n- Game: GET /api/games/{slug}\n- OpenAPI: /openapi.json\n- MCP: /mcp (Streamable HTTP, read-only)\n- Browser WebMCP: search_games, get_game\n\nCatalogue tools do not play matches or make paid API calls.\n`;
