export const STORE_ORIGIN='https://play.keff.uk';
const slugs=new Set(['juke','harness-tycoon','token-factory']);
const titles={juke:'JUKE','harness-tycoon':'Harness Tycoon','token-factory':'Token Factory'};
const descriptions={juke:'Air hockey against three AI opponents.','harness-tycoon':'Run the agents. Clear the queue.','token-factory':'Race a computer opponent to 10,000 tokens.'};
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
 if(!['GET','HEAD'].includes(request.method))return new Response('Use GET to open a game.',{status:405,headers:{allow:'GET, HEAD'}});
 const details=path.match(/^\/apps\/([^/]+)$/);
 if(details&&!slugs.has(details[1]))return new Response('Game not found. Browse games at /.',{status:404});
 const store=['/','/search','/library'].includes(path)||!!details;
 const target=store?'/index.html':path;
 const upstream=await env.ASSETS.fetch(new Request(new URL(target,url),{method:'GET',headers:request.headers}));
 const headers=new Headers(upstream.headers);
 for(const [key,value]of Object.entries(security))headers.set(key,value);
 if(path.endsWith('/sw.js')||path==='/sw.js'||path.endsWith('manifest.webmanifest')||upstream.headers.get('content-type')?.includes('text/html'))headers.set('cache-control','no-cache');
 if(path.endsWith('/sw.js'))headers.set('service-worker-allowed',path.slice(0,-5));
 if(details&&upstream.ok){let html=await upstream.text(),slug=details[1];html=html.replace(/<title>.*?<\/title>/,'<title>'+titles[slug]+' · Play</title>').replace(/((?:name="description"|property="og:description") content=")[^"]+/g,'$1'+descriptions[slug]).replace(/(property="og:title" content=")[^"]+/g,'$1'+titles[slug]+' · Play').replace(/(property="og:url" content=")[^"]+/g,'$1'+STORE_ORIGIN+path).replace(/(rel="canonical" href=")[^"]+/g,'$1'+STORE_ORIGIN+path);headers.delete('etag');headers.delete('content-length');return new Response(request.method==='HEAD'?null:html,{status:200,headers});}
 return new Response(request.method==='HEAD'?null:upstream.body,{status:upstream.status,headers});
}
