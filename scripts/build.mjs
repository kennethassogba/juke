import {build} from 'esbuild';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const pub=new URL('public/',root);
await mkdir(new URL('store/',pub),{recursive:true});
await build({entryPoints:[new URL('src/store/main.tsx',root).pathname],bundle:true,minify:true,format:'esm',target:['es2022'],outfile:new URL('store/app.js',pub).pathname,jsx:'automatic'});
await build({entryPoints:[new URL('src/game.js',root).pathname],bundle:true,minify:true,format:'esm',target:['es2022'],outfile:new URL('juke/app.js',pub).pathname});
const games=[{slug:'token-factory',name:'Token Factory',description:'Race a computer opponent to 10,000 tokens.'},{slug:'harness-tycoon',name:'Harness Tycoon',description:'Assign agents, route tools and clear incoming requests.'}];
const shell=(title,description,path,manifest,icon)=>`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#ffffff"><title>${title}</title><meta name="description" content="${description}"><link rel="canonical" href="https://play.keff.uk${path}"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="https://play.keff.uk${path}"><meta property="og:image" content="https://play.keff.uk${icon}"><meta name="twitter:card" content="summary"><link rel="manifest" href="${manifest}"><link rel="icon" href="${icon}"><link rel="apple-touch-icon" href="${icon}"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="default"><link rel="stylesheet" href="/store/app.css"><script type="module" src="/store/app.js"></script></head><body><div id="root"></div><noscript><h1>${title}</h1><p>Turn on JavaScript to play.</p><a href="/">Browse games</a></noscript></body></html>\n`;
await writeFile(new URL('index.html',pub),shell('Play · Games by k_eff','Play JUKE, Harness Tycoon and Token Factory. Play in your browser or install a game on your home screen.','/','/manifest.webmanifest','/art/play-192.png'));
const manifest=(slug,name,description)=>({id:slug?`/${slug}/`:'/',name,short_name:slug?name:'Play',description,start_url:slug?`/${slug}/`:'/',scope:slug?`/${slug}/`:'/',display:'standalone',background_color:'#ffffff',theme_color:'#ffffff',icons:[192,512].map(size=>({src:`/art/${slug||'play'}-${size}.png`,sizes:`${size}x${size}`,type:'image/png',purpose:'any maskable'}))});
await writeFile(new URL('manifest.webmanifest',pub),JSON.stringify(manifest('','Play','Games by k_eff'),null,2)+'\n');
const sw=async(slug)=>`const PREFIX='${slug?'play-'+slug:'play-store'}-';const CACHE=PREFIX+'v1';
const HOME='${slug?'/'+slug+'/':'/'}';
const SHELL=[HOME,'/store/app.js','/store/app.css','${slug?'/'+slug+'/manifest.webmanifest':'/manifest.webmanifest'}',${[192,512].map(n=>`'/art/${slug||'play'}-${n}.png'`).join(',')}];
const essential=${JSON.stringify(slug?Object.values(JSON.parse(await readFile(new URL('content/tcg/model-marketing.json',root)))).map(m=>m.asset):['/art/juke.jpg','/art/harness-cover.svg','/art/tokens-cover.svg','/art/harness-tycoon.svg','/art/token-factory.svg','/juke/icons/icon-192.png'])};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll([...new Set([...SHELL,...essential])] )).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.includes('/api/'))return;
const navigation=e.request.mode==='navigate'&&${slug?'u.pathname.startsWith(HOME)':"(u.pathname==='/'||u.pathname==='/search'||u.pathname==='/library'||u.pathname.startsWith('/apps/'))"};
if(!navigation&&!SHELL.includes(u.pathname)&&!essential.includes(u.pathname))return;
e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();e.waitUntil(caches.open(CACHE).then(c=>c.put(e.request,copy)));}return r;}).catch(async()=>await caches.match(e.request)||(navigation?await caches.match(HOME):null)||Response.error()));});\n`;
await writeFile(new URL('sw.js',pub),await sw(''));
for(const g of games){await mkdir(new URL(g.slug+'/',pub),{recursive:true});await writeFile(new URL(g.slug+'/index.html',pub),shell(g.name+' · Play',g.description,`/${g.slug}/`,`/${g.slug}/manifest.webmanifest`,`/art/${g.slug}-192.png`));await writeFile(new URL(g.slug+'/manifest.webmanifest',pub),JSON.stringify(manifest(g.slug,g.name,g.description),null,2)+'\n');await writeFile(new URL(g.slug+'/sw.js',pub),await sw(g.slug));}
await writeFile(new URL('robots.txt',pub),'User-agent: *\nAllow: /\nDisallow: /juke/api/\nSitemap: https://play.keff.uk/sitemap.xml\n');
await writeFile(new URL('sitemap.xml',pub),'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+['/','/apps/juke','/apps/harness-tycoon','/apps/token-factory','/juke/','/harness-tycoon/','/token-factory/'].map(p=>'<url><loc>https://play.keff.uk'+p+'</loc></url>').join('')+'</urlset>');
console.log('Built Play, JUKE and both installable strategy games.');
