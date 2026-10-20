import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {routeSite} from '../src/site.js';
import {registerCatalogTools} from '../src/store/webmcp.ts';
const origin='https://play.keff.uk';
const env={ASSETS:{fetch:async request=>{try{return new Response(await readFile(new URL('../public'+new URL(request.url).pathname,import.meta.url)));}catch{return new Response('Not found',{status:404});}}}};
const get=(path,options)=>routeSite(new Request(origin+path,options),env);
test('catalogue search shares controls and genuine model configuration',async()=>{
 const response=await get('/api/games?q=Decisions');assert.equal(response.status,200);const {games}=await response.json();assert.deepEqual(games.map(g=>g.slug),['juke']);assert.match(games[0].features[0],/Decisions API/);assert.equal(games[0].url,origin+'/juke/');
 assert.equal((await get('/api/games?q='+('x'.repeat(121)))).status,400);
 assert.equal((await get('/api/games/missing')).status,404);
 assert.equal(await (await get('/api/games',{method:'HEAD'})).text(),'');
 assert.equal((await get('/api/games',{method:'POST'})).status,405);
});
test('Markdown, discovery documents and static detail pages are available without JavaScript',async()=>{
 for(const path of ['/','/apps/juke','/apps/harness-tycoon','/apps/token-factory']){const html=await (await get(path)).text();assert.match(html,/<h[12]/);assert.match(html,/application\/ld\+json/);assert.match(html,/summary_large_image/);assert.doesNotMatch(html,/Keep a game on|Made by|©|store-sidebar|store-mobile-nav/);}
 const md=await get('/apps/juke',{headers:{accept:'text/markdown'}});assert.match(md.headers.get('content-type'),/text\/markdown/);assert.match(await md.text(),/Decisions API/);assert.equal(md.headers.get('vary'),'Accept');
 for(const path of ['/llms.txt','/index.md','/openapi.json','/.well-known/api-catalog','/.well-known/agent-skills/index.json','/.well-known/agent-skills/SKILL.md','/.well-known/mcp/server-card.json','/mcp/server-card','/apps/juke.md'])assert.equal((await get(path)).status,200,path);
 assert.equal((await get('/search?q=arcade')).headers.get('location'),origin+'/?q=arcade');
});
async function mcp(body,extra={}){return get('/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...extra},body:JSON.stringify(body)});}
test('MCP initializes and exposes only two validated read-only catalogue tools',async()=>{
 const init=await mcp({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'play-tests',version:'1'}}});assert.equal(init.status,200);assert.equal((await init.json()).result.serverInfo.name,'uk.keff/play');
 const list=await(await mcp({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})).json();assert.deepEqual(list.result.tools.map(t=>t.name),['search_games','get_game']);assert.ok(list.result.tools.every(t=>t.annotations.readOnlyHint&&!t.annotations.destructiveHint));
 const result=await(await mcp({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'search_games',arguments:{query:'offline'}}})).json();assert.deepEqual(JSON.parse(result.result.content[0].text).games.map(g=>g.slug),['harness-tycoon','token-factory']);
 const invalid=await(await mcp({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'get_game',arguments:{slug:'juke',start:true}}})).json();assert.equal(invalid.result.isError,true);
 assert.equal((await mcp({},{origin:'https://untrusted.example'})).status,403);
 assert.equal((await get('/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:'x'.repeat(16385)})).status,413);
});
test('WebMCP updates the visible search, supports current and older APIs, and cleans up',async()=>{
 for(const modern of [true,false]){const tools=new Map(),calls=[];let abortSignal;
  const context={registerTool(tool,options){tools.set(tool.name,tool);abortSignal=options?.signal;},unregisterTool(name){tools.delete(name);}};
  const cleanup=registerCatalogTools(query=>calls.push(query),modern?{modelContext:context}:{},modern?{}:{modelContext:context});
  assert.equal(tools.size,2);const value=await tools.get('search_games').execute({query:'GPT-6'});assert.deepEqual(calls,['GPT-6']);assert.equal(JSON.parse(value.content[0].text).games[0].slug,'juke');
  await assert.rejects(()=>tools.get('search_games').execute({query:42}));cleanup();if(modern)assert.equal(abortSignal.aborted,true);else assert.equal(tools.size,0);
 }
 assert.doesNotThrow(()=>registerCatalogTools(()=>{}, {}, {})());
});
