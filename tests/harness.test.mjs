import test from 'node:test';
import assert from 'node:assert/strict';
import {newHarness,actHarness,tickHarness,memoryUsed,memoryCapacity,canUpgrade,upgradeCost} from '../src/harness/engine.ts';

function finishTutorial(s=newHarness()){
 const job=s.jobs[0];s=actHarness(s,{type:'assign',job:job.id,agent:1});s=tickHarness(s,10);
 s=actHarness(s,{type:'tool',job:job.id,tool:'terminal',environment:'sandbox'});s=tickHarness(s,10);
 return actHarness(s,{type:'reply',job:job.id});
}
function drive(s){
 for(let i=0;i<2500&&s.status==='running';i++){
  for(const j of s.jobs){
   if(j.stage==='reply')s=actHarness(s,{type:'reply',job:j.id});
   else if(j.stage==='tool')s=actHarness(s,{type:'tool',job:j.id,tool:j.tool,environment:j.environment});
   else if(j.stage==='queued'){const a=s.agents.find(a=>a.job===null);if(a)s=actHarness(s,{type:'assign',job:j.id,agent:a.id});}
  }
  s=tickHarness(s,.1);
 }
 return s;
}
test('tutorial pauses for choices, never expires or spawns distractions, and teaches a full request',()=>{
 let s=newHarness();assert.deepEqual(tickHarness(s,100),s);
 s=actHarness(s,{type:'assign',job:101,agent:1});s=tickHarness(s,100);
 assert.equal(s.jobs.length,1);assert.equal(s.jobs[0].stage,'tool');assert.equal(s.missed,0);
 assert.equal(tickHarness(s,50).jobs[0].stage,'tool');
 s=finishTutorial();assert.equal(s.status,'running');assert.equal(s.completed,1);assert.equal(s.credits,25);
 assert.equal(s.time,0);assert.equal(s.jobs[0].stage,'queued');
});
test('wrong tools and environments explain the correction without consuming a tool slot',()=>{
 let s=actHarness(newHarness(),{type:'assign',job:101,agent:1});s=tickHarness(s,10);
 s=actHarness(s,{type:'tool',job:101,tool:'browser',environment:'sandbox'});assert.match(s.event,/terminal/i);assert.equal(s.jobs[0].stage,'tool');
 s=actHarness(s,{type:'tool',job:101,tool:'terminal',environment:'web'});assert.match(s.event,/sandbox/i);assert.equal(s.jobs[0].stage,'tool');
});
test('context stays allocated while waiting for tools and replies, then is released exactly once',()=>{
 let s=actHarness(newHarness(),{type:'assign',job:101,agent:1});s=tickHarness(s,10);assert.equal(memoryUsed(s),2);assert.equal(s.agents[0].job,null);
 s=actHarness(s,{type:'tool',job:101,tool:'terminal',environment:'sandbox'});s=tickHarness(s,10);assert.equal(memoryUsed(s),2);
 s=actHarness(s,{type:'reply',job:101});assert.equal(memoryUsed(s),0);assert.equal(actHarness(s,{type:'reply',job:999}).credits,s.credits);
});
test('agent, context and tool capacity constrain concurrent work',()=>{
 let s=finishTutorial();s=tickHarness(s,11);assert.equal(s.jobs.length,3);
 for(const j of s.jobs)s=actHarness(s,{type:'assign',job:j.id,agent:1});assert.equal(s.jobs.filter(j=>j.stage==='thinking').length,1);
 s=tickHarness(s,6);const first=s.jobs.find(j=>j.stage==='tool');s=actHarness(s,{type:'tool',job:first.id,tool:first.tool,environment:first.environment});
 const second=s.jobs.find(j=>j.stage==='queued');s=actHarness(s,{type:'assign',job:second.id,agent:2});s=tickHarness(s,2.5);
 assert.equal(s.jobs.find(j=>j.id===second.id).stage,'tool');
 {
  s=actHarness(s,{type:'tool',job:second.id,tool:second.tool,environment:second.environment});assert.equal(s.jobs.filter(j=>j.stage==='working').length,1);
 }
 assert.ok(memoryUsed(s)<=memoryCapacity(s));
});
test('pause freezes deadlines and production while still permitting planning',()=>{
 let s=finishTutorial();s=actHarness(s,{type:'pause'});assert.deepEqual(tickHarness(s,120),s);
 s=actHarness(s,{type:'assign',job:s.jobs[0].id,agent:1});assert.equal(s.jobs[0].stage,'thinking');assert.equal(s.time,0);
 s=actHarness(s,{type:'resume'});s=tickHarness(s,1);assert.equal(s.status,'running');assert.ok(s.time>0);
});
test('idle shifts end with three expired requests and all resources reclaimed',()=>{
 const s=tickHarness(finishTutorial(),100);assert.equal(s.status,'over');assert.equal(s.missed,3);assert.equal(memoryUsed(s),0);
 assert.deepEqual(tickHarness(s,5),s);
});
test('two waves can be completed by routing, reward upgrades, and persist the automation unlock',()=>{
 let s=drive(finishTutorial());assert.equal(s.status,'upgrade');assert.equal(s.wave,1);assert.equal(s.missed,0);assert.equal(s.completed,4);
 const credits=s.credits,cost=upgradeCost(s,'agents');assert.ok(canUpgrade(s,'agents'));
 s=actHarness(s,{type:'upgrade',id:'agents'});assert.equal(s.agents.length,3);assert.equal(s.credits,credits-cost);
 s=actHarness(s,{type:'next'});s=drive(s);assert.equal(s.status,'upgrade');assert.equal(s.wave,2);assert.equal(s.router,true);assert.equal(s.bestWave,2);
 const replay=newHarness(s.bestWave);assert.equal(replay.router,true);assert.equal(replay.upgrades.auto,false);
});
test('automation performs real dispatch and replies rather than adding free score',()=>{
 let s=finishTutorial(newHarness(2));s=actHarness(s,{type:'auto',enabled:true});s=tickHarness(s,100);
 assert.equal(s.status,'upgrade');assert.equal(s.completed,4);assert.equal(s.missed,0);assert.ok(s.time>5);
 const noUnlock=actHarness(finishTutorial(),{type:'auto',enabled:true});assert.equal(noUnlock.upgrades.auto,false);
});
test('game rejects unaffordable upgrades and allows ending a cleared shift',()=>{
 let s=drive(finishTutorial());s.credits=0;const before=structuredClone(s);s=actHarness(s,{type:'upgrade',id:'speed'});assert.deepEqual(s,before);
 s=actHarness(s,{type:'finish'});assert.equal(s.status,'over');assert.deepEqual(actHarness(s,{type:'next'}),s);
});
