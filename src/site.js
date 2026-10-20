import {games,origin} from './store/catalog.ts';
import {runCatalogTool,catalogueMarkdown,gameMarkdown} from './catalog-api.js';
import {handleMcp} from './mcp.js';
export const STORE_ORIGIN='https://play.keff.uk';
const slugs=new Set(['juke','harness-tycoon','token-factory']);
const security={
 'content-security-policy':"default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
 'x-frame-options':'DENY','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','permissions-policy':'camera=(), microphone=(), geolocation=()'
};
export async function routeSite(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(url.hostname==='juke.keff.uk'){
  // Retire the old root-scope worker so existing installed copies follow the move.
  if(path==='/sw.js')return new Response("self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('juke-')).map(k=>caches.delete(k)))).then(()=>self.registration.unregister()).then(()=>self.clients.matchAll()).then(cs=>Promise.all(cs.map(c=>c.navigate('https://play.keff.uk/juke/'))))));",{headers:{'content-type':'application/javascript','cache-control':'no-store'}});
  return Response.redirect(STORE_ORIGIN+'/juke'+(path==='/'?'/':path)+url.search,308);
 }
 const first=path.split('/')[1];
 if(slugs.has(first)&&path==='/'+first)return Response.redirect(url.origin+path+'/'+url.search,308);
 if(path.startsWith('/juke/api/'))return null;
 if(path==='/mcp')return handleMcp(request);
 if(!['GET','HEAD'].includes(request.method))return new Response('Use GET to open a game.',{status:405,headers:{allow:'GET, HEAD'}});
 const discoveryHeaders={...security,'cache-control':'no-cache','link':`<${origin}/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json", <${origin}/llms.txt>; rel="help", <${origin}/mcp>; rel="mcp"`};
 if(path==='/api/games'||path.startsWith('/api/games/')){
  try{const data=path==='/api/games'?runCatalogTool('search_games',{query:url.searchParams.get('q')||''}):runCatalogTool('get_game',{slug:path.slice('/api/games/'.length)});return new Response(request.method==='HEAD'?null:JSON.stringify(data),{headers:{...discoveryHeaders,'content-type':'application/json; charset=utf-8'}});}
  catch(error){return new Response(request.method==='HEAD'?null:JSON.stringify({error:error.message}),{status:path==='/api/games'?400:404,headers:{...discoveryHeaders,'content-type':'application/json; charset=utf-8'}});}
 }
 if(path==='/search'||path==='/library')return Response.redirect(origin+'/'+(url.searchParams.has('q')?'?'+new URLSearchParams({q:url.searchParams.get('q').slice(0,120)}):''),308);
 const details=path.match(/^\/apps\/([a-z0-9-]+)\/?$/);
 const game=details&&games.find(g=>g.slug===details[1]);
 if(details&&!game)return new Response('Game not found. Browse games at /.',{status:404});
 if(details&&path.endsWith('/'))return Response.redirect(origin+'/apps/'+game.slug+url.search,308);
 if(request.headers.get('accept')?.includes('text/markdown')&&(path==='/'||game))return new Response(request.method==='HEAD'?null:game?gameMarkdown(game):catalogueMarkdown(),{headers:{...discoveryHeaders,'content-type':'text/markdown; charset=utf-8',vary:'Accept'}});
 const target=path==='/'?'/index.html':game?'/apps/'+game.slug+'/index.html':path;
 const upstream=await env.ASSETS.fetch(new Request(new URL(target,url),{method:'GET',headers:request.headers}));
 const headers=new Headers(upstream.headers);
 for(const [key,value]of Object.entries(discoveryHeaders))headers.set(key,value);
 if(path.endsWith('/sw.js')||path==='/sw.js'||path.endsWith('manifest.webmanifest')||upstream.headers.get('content-type')?.includes('text/html'))headers.set('cache-control','no-cache');
 if(path.endsWith('/sw.js'))headers.set('service-worker-allowed',path.slice(0,-5));
 if(path==='/'||game)headers.set('vary','Accept');
 return new Response(request.method==='HEAD'?null:upstream.body,{status:upstream.status,headers});
}
