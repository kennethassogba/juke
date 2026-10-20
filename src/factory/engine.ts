import marketing from '../../content/tcg/model-marketing.json' with {type:'json'};
import intelligence from '../../content/tcg/intelligence-index.json' with {type:'json'};

export const DURATION=120;
export const TARGET=10000;
export const STEP=.1;
export type Model={id:string;name:string;family:string;score:number;input:number;output:number;asset:string;historical:boolean};
export const models:Model[]=Object.entries(marketing).flatMap(([id,m])=>{
 const score=(intelligence.records as Record<string,{score:number}>)[id];
 return 'apiPricing' in m&&score?[{id,name:m.title,family:id.startsWith('gpt-')?'OpenAI':id.startsWith('claude-')?'Anthropic':'DeepSeek',score:score.score,input:m.apiPricing.input,output:m.apiPricing.output,asset:m.asset,historical:m.apiPricing.historical}]:[];
});
export const harnesses=[
 {id:'codex',name:'Codex',family:'OpenAI',cost:100,asset:'/assets/official/codex.webp'},
 {id:'claude-code',name:'Claude Code',family:'Anthropic',cost:100,asset:'/assets/official/claude-code.webp'},
 {id:'opencode',name:'OpenCode',family:'any',cost:80,asset:''},
] as const;
export type Factory={tokens:number;credits:number;model:string|null;harness:string|null;level:number;taps:number;lastTap:number;revenue:number;expenses:number};
export type Race={seed:number;elapsed:number;status:'ready'|'running'|'paused'|'finished';player:Factory;rival:Factory;winner:'player'|'rival'|'tie'|null;nextDecision:number;event:string;eventId:number};
export type Action={type:'tap'}|{type:'model';id:string}|{type:'harness';id:string}|{type:'upgrade'}|{type:'start'}|{type:'pause'}|{type:'resume'};
export const machineCost=(f:Factory)=>Math.round(60*1.8**f.level);
export const modelCost=(m:Model)=>Math.round(40+m.input*16);
export const modelFor=(f:Factory)=>models.find(m=>m.id===f.model);
export function harnessBoost(f:Factory){
 const h=harnesses.find(h=>h.id===f.harness),m=modelFor(f);
 return !h||!m?1:h.family==='any'?1.35:h.family===m.family?1.8:1.15;
}
export function economics(f:Factory){
 const m=modelFor(f),scale=1.65**f.level,boost=harnessBoost(f);
 const rate=m?m.score**2/60*scale*boost:0;
 const burn=m?m.output*.8*scale/boost:0;
 return {rate,burn,profit:rate*.35-burn};
}
const factory=():Factory=>({tokens:0,credits:60,model:null,harness:null,level:0,taps:0,lastTap:-1,revenue:0,expenses:0});
export const newRace=(seed=1):Race=>({seed:Math.abs(Math.trunc(seed))%1000000||1,elapsed:0,status:'ready',player:factory(),rival:factory(),winner:null,nextDecision:2.5,event:'Make your first token.',eventId:0});
function emit(s:Race,text:string){s.event=text;s.eventId++;}
function purchase(f:Factory,action:Action):boolean{
 if(action.type==='model'){
  const m=models.find(m=>m.id===action.id);if(!m||f.model===m.id||f.credits<modelCost(m))return false;
  f.credits-=modelCost(m);f.model=m.id;return true;
 }
 if(action.type==='harness'){
  const h=harnesses.find(h=>h.id===action.id);if(!h||!f.model||f.harness===h.id||f.credits<h.cost)return false;
  f.credits-=h.cost;f.harness=h.id;return true;
 }
 if(action.type==='upgrade'){
  if(!f.model||f.level>=8||f.credits<machineCost(f))return false;
  f.credits-=machineCost(f);f.level++;return true;
 }
 return false;
}
export function actRace(race:Race,action:Action):Race{
 const s=structuredClone(race);
 if(action.type==='start'&&s.status==='ready'){
  s.status='running';purchase(s.player,{type:'model',id:'gpt-luna'});purchase(s.rival,{type:'model',id:'gpt-luna'});
  emit(s,'Luna is making tokens. Add a machine with your earnings.');return s;
 }
 if(action.type==='pause'&&s.status==='running'){s.status='paused';emit(s,'Both factories are paused.');return s;}
 if(action.type==='resume'&&s.status==='paused'){s.status='running';emit(s,'Factories running.');return s;}
 if(s.status!=='running')return race;
 if(action.type==='tap'){
  // Rate-limit automation and rapid event repeats equally, including keyboard input.
  if(s.elapsed-s.player.lastTap<.14)return race;
  const tokens=8*1.65**s.player.level;
  s.player.lastTap=s.elapsed;s.player.tokens+=tokens;s.player.credits+=tokens*.35;s.player.revenue+=tokens*.35;s.player.taps++;
  if(s.player.taps===1)emit(s,'Save up for a machine. It makes every tap worth more.');
 }else if(purchase(s.player,action)){
  if(action.type==='model')emit(s,`${modelFor(s.player)!.name} is running your factory.`);
  if(action.type==='harness')emit(s,`${harnesses.find(h=>h.id===action.id)!.name} connected.`);
  if(action.type==='upgrade')emit(s,`Machine ${s.player.level+1} installed.`);
 }else return race;
 finish(s);return s;
}
function produce(f:Factory,dt:number){
 const {rate,burn}=economics(f);
 // Sales fund operating costs continuously. A loss-making model stops at zero credit.
 const net=rate*.35-burn,active=net<0?Math.min(dt,f.credits/-net):dt;
 const tokens=rate*active,revenue=tokens*.35,expenses=burn*active;
 f.tokens+=tokens;f.credits=Math.max(0,f.credits+revenue-expenses);f.revenue+=revenue;f.expenses+=expenses;
}
function rivalDecision(s:Race){
 const f=s.rival;
 if(!f.model){purchase(f,{type:'model',id:'gpt-luna'});return;}
 const options:Action[]=[{type:'upgrade'},...models.filter(m=>m.id!==f.model).map(m=>({type:'model' as const,id:m.id})),...harnesses.filter(h=>h.id!==f.harness).map(h=>({type:'harness' as const,id:h.id}))];
 const before=economics(f),horizon=Math.min(26,DURATION-s.elapsed);
 let best:Action|null=null,bestValue=0;
 for(const action of options){
  const next=structuredClone(f);if(!purchase(next,action))continue;
  const after=economics(next),cost=f.credits-next.credits;
  const value=(after.profit-before.profit)*horizon-cost+(after.rate-before.rate)*horizon*.12;
  if(value>bestValue){best=action;bestValue=value;}
 }
 if(best)purchase(f,best);
}
function finish(s:Race){
 if(s.player.tokens>=TARGET||s.rival.tokens>=TARGET||s.elapsed>=DURATION-1e-8){
  if(s.elapsed>=DURATION-1e-8)s.elapsed=DURATION;
  s.status='finished';s.winner=Math.abs(s.player.tokens-s.rival.tokens)<.001?'tie':s.player.tokens>s.rival.tokens?'player':'rival';
  emit(s,s.winner==='player'?'You won.':s.winner==='rival'?'The computer won.':'A tie.');
 }
}
export function tickRace(race:Race,seconds:number):Race{
 if(race.status!=='running'||!Number.isFinite(seconds)||seconds<=0)return race;
 const s=structuredClone(race);
 // Fixed slices preserve purchase timing and resolve the actual first target crossing.
 let remaining=Math.min(seconds,DURATION-s.elapsed);
 while(remaining>1e-8&&s.status==='running'){
  const crossing=(f:Factory)=>{
   const {rate,profit}=economics(f);
   const time=rate>0?(TARGET-f.tokens)/rate:Infinity;
   return profit<0&&f.credits/-profit+1e-8<time?Infinity:time;
  };
  const dt=Math.min(STEP,remaining,crossing(s.player),crossing(s.rival));produce(s.player,dt);produce(s.rival,dt);s.elapsed=Math.min(DURATION,s.elapsed+dt);remaining-=dt;
  if(s.elapsed+1e-8>=s.nextDecision){rivalDecision(s);s.nextDecision+=3+(s.seed%7)*.15;}
  finish(s);
 }
 return s;
}
