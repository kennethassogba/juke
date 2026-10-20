import test from 'node:test';
import assert from 'node:assert/strict';
import {newRace,actRace,tickRace,economics,modelCost,machineCost,models,TARGET,DURATION} from '../src/factory/engine.ts';
import prices from '../content/tcg/model-marketing.json' with {type:'json'};
import index from '../content/tcg/intelligence-index.json' with {type:'json'};

const start=seed=>actRace(newRace(seed),{type:'start'});
test('playable model values come from the same sourced cards, never fabricated benchmark scores',()=>{
 assert.equal(models.length,6);
 for(const m of models){assert.equal(m.score,index.records[m.id].score);assert.equal(m.input,prices[m.id].apiPricing.input);assert.equal(m.output,prices[m.id].apiPricing.output);}
 assert.equal(models.find(m=>m.id==='deepseek-r1').historical,true);
});
test('first action earns tokens and credits; holding cannot bypass the tapping rate limit',()=>{
 let s=start(1);s=actRace(s,{type:'tap'});assert.equal(s.player.tokens,8);assert.ok(s.player.credits>18);
 assert.deepEqual(actRace(s,{type:'tap'}),s);
 s=tickRace(s,.2);s=actRace(s,{type:'tap'});assert.ok(s.player.tokens>16);
});
test('input prices affect hiring, output prices affect ongoing balance, and an unaffordable hire cannot spend money',()=>{
 let s=start(1);assert.equal(actRace(s,{type:'model',id:'gpt-astra'}),s);
 const m=models.find(m=>m.id==='gpt-luna');assert.equal(s.player.credits,60-modelCost(m));
 const before=s.player.credits;s=tickRace(s,1);
 assert.ok(Math.abs(s.player.credits-before-(m.score**2/60*.35-m.output*.8))<1e-7);
 assert.ok(s.player.expenses>0);assert.ok(s.player.revenue>0);
});
test('matching harnesses produce a larger boost; generic harnesses work for every family',()=>{
 const base={...newRace().player,model:'gpt-sol'};
 const match=economics({...base,harness:'codex'}),mismatch=economics({...base,harness:'claude-code'}),generic=economics({...base,harness:'opencode'});
 assert.ok(match.rate>generic.rate&&generic.rate>mismatch.rate);assert.ok(match.burn<mismatch.burn);
 const opus={...base,model:'claude-opus'};
 assert.ok(economics({...opus,harness:'claude-code'}).rate>economics({...opus,harness:'codex'}).rate);
});
test('loss-making factories stop at zero instead of creating debt or free output',()=>{
 let s=start(1);s.player.credits=201;s=actRace(s,{type:'model',id:'gpt-astra'});s=tickRace(s,3);
 assert.equal(s.player.credits,0);const tokens=s.player.tokens;s=tickRace(s,1);assert.equal(s.player.tokens,tokens);
 s=actRace(s,{type:'tap'});assert.ok(s.player.credits>0);s=tickRace(s,.1);assert.ok(s.player.tokens>tokens+8);
});
test('pause freezes both factories and the clock; finished games reject spending and production',()=>{
 let s=actRace(start(1),{type:'model',id:'gpt-luna'});s=tickRace(s,5);s=actRace(s,{type:'pause'});
 assert.equal(tickRace(s,50),s);assert.equal(actRace(s,{type:'tap'}),s);
 s=actRace(s,{type:'resume'});s=tickRace(s,200);assert.equal(s.status,'finished');assert.ok(s.elapsed<=DURATION);
 assert.equal(tickRace(s,5),s);assert.equal(actRace(s,{type:'upgrade'}),s);
});
test('computer starts on every seed and obeys the same prices and credits',()=>{
 for(const seed of [1,2,3,42,999999]){const s=tickRace(start(seed),10);assert.ok(s.rival.model);assert.ok(s.rival.tokens>0);assert.ok(s.rival.credits>=0);assert.ok(s.rival.expenses>0);}
});
test('a seeded replay is deterministic and fixed-tick grouping preserves economics',()=>{
 const s=actRace(start(42),{type:'model',id:'gpt-luna'});const a=tickRace(s,12);let b=s;for(let i=0;i<120;i++)b=tickRace(b,.1);
 assert.ok(Math.abs(a.rival.tokens-b.rival.tokens)<1e-6);assert.ok(Math.abs(a.player.credits-b.player.credits)<1e-6);
 assert.deepEqual(tickRace(s,12),a);
});
test('active play can win; doing nothing loses, so the opponent is not a scripted victory',()=>{
 const idle=tickRace(start(42),200);assert.equal(idle.winner,'rival');
 let s=actRace(start(42),{type:'model',id:'gpt-luna'});
 while(s.status==='running'){
  s=tickRace(s,.2);s=actRace(s,{type:'tap'});
  if(!s.player.harness&&s.player.credits>=100)s=actRace(s,{type:'harness',id:'codex'});
  else if(s.player.credits>=machineCost(s.player))s=actRace(s,{type:'upgrade'});
 }
 assert.equal(s.winner,'player');assert.ok(s.player.tokens>=TARGET);assert.ok(s.elapsed>10&&s.elapsed<120);
});
test('machine upgrades increase output and costs, are bounded and cannot overdraft',()=>{
 let s=actRace(start(1),{type:'model',id:'gpt-luna'});const before=economics(s.player);s.player.credits=100000;
 s=actRace(s,{type:'upgrade'});const after=economics(s.player);assert.ok(Math.abs(after.rate/before.rate-1.65)<1e-8);assert.ok(Math.abs(after.burn/before.burn-1.65)<1e-8);
 for(let i=0;i<20;i++)s=actRace(s,{type:'upgrade'});assert.equal(s.player.level,8);assert.ok(s.player.credits>=0);
});

test('a faster factory cannot overtake an earlier finish inside the same simulation slice',()=>{
 const s=start(1);s.player.tokens=TARGET-1;s.rival.tokens=TARGET-8;s.rival.level=4;
 const next=tickRace(s,.1);
 assert.equal(next.winner,'player');assert.ok(next.rival.tokens<TARGET);assert.ok(next.elapsed<.1);
});
