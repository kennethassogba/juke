import assert from 'node:assert/strict';
const origin=process.env.SITE_ORIGIN||'https://play.keff.uk';
const manifests=[];
for(const path of ['/','/apps/juke','/apps/harness-tycoon','/apps/token-factory','/juke/','/harness-tycoon/','/token-factory/']){const r=await fetch(origin+path,{headers:{'cache-control':'no-cache'}});assert.equal(r.status,200,path);const html=await r.text();assert.match(html,/<title>/);console.log('200',path);}
for(const slug of ['juke','harness-tycoon','token-factory']){const m=await(await fetch(`${origin}/${slug}/manifest.webmanifest`)).json();assert.equal(m.scope,`/${slug}/`);assert.equal(m.start_url,`/${slug}/`);manifests.push(m.id);const sw=await fetch(`${origin}/${slug}/sw.js`);assert.equal(sw.status,200);assert.match(sw.headers.get('content-type'),/javascript/);for(const icon of m.icons)assert.equal((await fetch(origin+icon.src)).status,200);}
assert.equal(new Set(manifests).size,3,'games must have distinct install IDs');
const old=await fetch('https://juke.keff.uk/',{redirect:'manual'});assert.equal(old.status,308);assert.equal(old.headers.get('location'),origin+'/juke/');
const statusResponse=await fetch(origin+'/juke/api/status');const cookie=statusResponse.headers.get('set-cookie')?.split(';')[0];const status=await statusResponse.json();assert.equal(status.configured,true);assert.ok(status.models.every(m=>m.ready),'all requested models are available');assert.equal(status.budget.limitUsd,.5);console.log('Real JUKE API: all models available; daily allowance intact.');
if(process.argv.includes('--decisions')){
 const state={version:1,bounds:{goalStart:.375,goalEnd:.625},score:{player:0,defender:0},puck:{x:.5,y:.4,vx:.1,vy:-.7,radius:.026},player:{x:.5,y:.85,radius:.072},defender:{x:.5,y:.15,radius:.065},otherDefenders:[{x:.15,y:.5,radius:.065},{x:.85,y:.5,radius:.065}],bumpersOn:false,bumpers:[]};
 for(const {id:model} of status.models){const r=await fetch(origin+'/juke/api/decision',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({model,state})});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));assert.ok(['intercept','press','left','center','right'].includes(data.action));assert.ok(data.latencyMs>=0);assert.ok(data.usage?.inputTokens>0);console.log(model,data.action,data.latencyMs+'ms',data.usage.costUsd+' USD');}
}
console.log('Published routes, install manifests, icons, scopes, redirect and JUKE API verified.');
