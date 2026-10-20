import {models} from '../factory/engine.ts';

export type Tool='browser'|'terminal'|'files';
export type Environment='web'|'sandbox'|'workspace';
export type Stage='queued'|'thinking'|'tool'|'working'|'reply'|'done'|'missed';
export type Job={id:number;title:string;prompt:string;kind:'research'|'code'|'writing';tool:Tool;environment:Environment;memory:number;deadline:number;stage:Stage;progress:number;duration:number;agent:number|null;reward:number};
export type Agent={id:number;model:string;job:number|null};
export type Upgrades={agents:number;memory:number;tools:number;speed:number;auto:boolean};
export type HarnessRun={status:'tutorial'|'running'|'paused'|'upgrade'|'over';previous:'tutorial'|'running';wave:number;time:number;nextArrival:number;spawned:number;total:number;jobs:Job[];agents:Agent[];upgrades:Upgrades;router:boolean;credits:number;score:number;completed:number;missed:number;combo:number;bestCombo:number;event:string;eventId:number;bestWave:number};
export type Action={type:'assign';job:number;agent:number}|{type:'tool';job:number;tool:Tool;environment:Environment}|{type:'reply';job:number}|{type:'upgrade';id:keyof Upgrades}|{type:'next'}|{type:'pause'}|{type:'resume'}|{type:'auto';enabled:boolean}|{type:'finish'};
const briefs=[
 {title:'Fix the login button',prompt:'The login button does nothing. Find the bug and run the tests.',kind:'code',tool:'terminal',environment:'sandbox',memory:2},
 {title:'Compare three API providers',prompt:'Check current API documentation and compare input and output prices.',kind:'research',tool:'browser',environment:'web',memory:2},
 {title:'Turn notes into a brief',prompt:'Read the meeting notes and write a one-page product brief.',kind:'writing',tool:'files',environment:'workspace',memory:1},
 {title:'Repair the checkout',prompt:'The cart total is wrong. Patch the calculation and test it.',kind:'code',tool:'terminal',environment:'sandbox',memory:3},
 {title:'Find the original source',prompt:'This benchmark has no citation. Find and check the original paper.',kind:'research',tool:'browser',environment:'web',memory:3},
 {title:'Clean up the README',prompt:'Read the project files and write clear setup instructions.',kind:'writing',tool:'files',environment:'workspace',memory:1},
] as const;
export const agentModel=(agent:Agent)=>models.find(m=>m.id===agent.model)!;
export const memoryCapacity=(s:HarnessRun)=>6+s.upgrades.memory*3;
export const memoryUsed=(s:HarnessRun)=>s.jobs.filter(j=>!['queued','done','missed'].includes(j.stage)).reduce((n,j)=>n+j.memory,0);
export const upgradeCost=(s:HarnessRun,id:keyof Upgrades)=>id==='auto'?60:45+(Number(s.upgrades[id])*25);
export const canUpgrade=(s:HarnessRun,id:keyof Upgrades)=>s.status==='upgrade'&&s.credits>=upgradeCost(s,id)&&(id==='auto'?!s.router:id==='agents'?s.agents.length<4:Number(s.upgrades[id])<3);
function emit(s:HarnessRun,message:string){s.event=message;s.eventId++;}
function addJob(s:HarnessRun,tutorial=false){
 const index=tutorial?0:(s.spawned+s.wave)%briefs.length,b=briefs[index];
 s.jobs.push({...b,id:s.wave*100+s.spawned+1,deadline:s.time+Math.max(24,42-s.wave*2),stage:'queued',duration:0,progress:0,agent:null,reward:25+(s.wave-1)*3});s.spawned++;
}
export function newHarness(bestWave=0):HarnessRun{
 const s:HarnessRun={status:'tutorial',previous:'tutorial',wave:1,time:0,nextArrival:4,spawned:0,total:3,jobs:[],agents:[{id:1,model:'gpt-luna',job:null},{id:2,model:'claude-opus',job:null}],upgrades:{agents:0,memory:0,tools:0,speed:0,auto:false},router:bestWave>=2,credits:0,score:0,completed:0,missed:0,combo:0,bestCombo:0,event:'Select Luna to take the first request.',eventId:0,bestWave:Math.max(0,Math.min(999,Math.trunc(bestWave)||0))};
 addJob(s,true);return s;
}
function assign(s:HarnessRun,job:Job,agent:Agent){
 if(job.stage!=='queued'||agent.job!==null)return false;
 if(memoryUsed(s)+job.memory>memoryCapacity(s)){emit(s,'Context is full. Reply to a finished request to free it.');return false;}
 const model=agentModel(agent),specialist=(job.kind==='code'&&model.family==='Anthropic')||(job.kind==='research'&&agent.model==='gpt-terra');
 job.stage='thinking';job.agent=agent.id;job.progress=0;job.duration=Math.max(1.2,(6-model.score/15)*(specialist?.75:1)/(1+s.upgrades.speed*.3));agent.job=job.id;
 emit(s,`${model.name} is on it.`);return true;
}
function runTool(s:HarnessRun,job:Job,tool:Tool,environment:Environment){
 if(job.stage!=='tool')return false;
 if(tool!==job.tool){emit(s,`This request needs ${job.tool==='files'?'Files':job.tool==='terminal'?'Terminal':'Browser'}.`);return false;}
 if(environment!==job.environment){emit(s,`Use the ${job.environment} environment for this request.`);return false;}
 if(s.jobs.filter(j=>j.stage==='working').length>=1+s.upgrades.tools){emit(s,'Tools are busy. Wait for a slot or pause to plan.');return false;}
 job.stage='working';job.progress=0;job.duration=Math.max(1.1,(job.memory+1)/(1+s.upgrades.speed*.25));emit(s,`${tool==='files'?'Reading files':tool==='terminal'?'Running tests':'Checking sources'} in ${environment}.`);return true;
}
function reply(s:HarnessRun,job:Job){
 if(job.stage!=='reply')return false;
 job.stage='done';s.completed++;s.combo++;s.bestCombo=Math.max(s.combo,s.bestCombo);s.credits+=job.reward;s.score+=100+Math.min(10,s.combo)*20;
 emit(s,`Reply sent. +${job.reward} credits${s.combo>1?' · '+s.combo+' in a row':''}.`);
 if(s.status==='tutorial'){
  s.jobs=[];s.spawned=0;s.time=0;s.status='running';s.nextArrival=3;addJob(s);emit(s,'You’ve got it. Keep the queue moving.');
 }
 return true;
}
function settle(s:HarnessRun){
 if(s.status!=='running')return;
 if(s.missed>=3){s.status='over';emit(s,'Three requests expired. Start a new shift.');return;}
 if(s.spawned===s.total&&s.jobs.every(j=>j.stage==='done'||j.stage==='missed')){s.status='upgrade';s.bestWave=Math.max(s.bestWave,s.wave);if(s.wave>=2)s.router=true;emit(s,`Wave ${s.wave} cleared.${s.wave===2?' Auto-router unlocked.':' Upgrade your setup.'}`);}
}
export function actHarness(run:HarnessRun,action:Action):HarnessRun{
 const s=structuredClone(run);
 if(action.type==='pause'&&(s.status==='running'||s.status==='tutorial')){s.previous=s.status;s.status='paused';emit(s,'Paused. Plan your next move.');return s;}
 if(action.type==='resume'&&s.status==='paused'){s.status=s.previous;emit(s,'Back to work.');return s;}
 if(action.type==='finish'&&s.status==='upgrade'){s.status='over';emit(s,'Shift complete.');return s;}
 if(action.type==='upgrade'&&canUpgrade(s,action.id)){
  s.credits-=upgradeCost(s,action.id);
  if(action.id==='auto'){s.upgrades.auto=true;s.router=true;}
  else{s.upgrades[action.id]++;if(action.id==='agents')s.agents.push({id:s.agents.length+1,model:s.agents.length===2?'gpt-terra':'gpt-sol',job:null});}
  emit(s,action.id==='auto'?'Auto-router installed. You can switch it off any time.':'Upgrade installed.');return s;
 }
 if(action.type==='auto'&&s.router){s.upgrades.auto=action.enabled;emit(s,action.enabled?'Auto-router on.':'Auto-router off.');return s;}
 if(action.type==='next'&&s.status==='upgrade'){
  s.wave++;s.time=0;s.jobs=[];s.spawned=0;s.total=Math.min(10,2+s.wave);s.nextArrival=3;s.status='running';addJob(s);emit(s,`Wave ${s.wave}. ${s.total} requests incoming.`);return s;
 }
 if(!['tutorial','running','paused'].includes(s.status))return run;
 const job='job'in action?s.jobs.find(j=>j.id===action.job):undefined;if(!job)return run;
 if(action.type==='assign'){const agent=s.agents.find(a=>a.id===action.agent);if(agent)assign(s,job,agent);}
 else if(action.type==='tool')runTool(s,job,action.tool,action.environment);
 else if(action.type==='reply'){
  // Planning while paused may include dispatching a completed reply. Resume before wave settlement.
  const wasPaused=s.status==='paused';if(wasPaused)s.status=s.previous;
  reply(s,job);if(wasPaused&&s.status!=='upgrade'&&s.status!=='over'){s.previous=s.status as 'tutorial'|'running';s.status='paused';}
 }
 settle(s);return s;
}
export function tickHarness(run:HarnessRun,seconds:number):HarnessRun{
 if(!['tutorial','running'].includes(run.status)||!Number.isFinite(seconds)||seconds<=0)return run;
 const s=structuredClone(run);let remaining=Math.min(seconds,120);
 while(remaining>1e-8&&['tutorial','running'].includes(s.status)){
  const dt=Math.min(.1,remaining);remaining-=dt;
  // Tutorial clocks run only while an agent or tool is actually working. No memorized instructions.
  const active=s.status==='running'||s.jobs.some(j=>j.stage==='thinking'||j.stage==='working');if(!active)break;
  s.time+=dt;
  for(const job of s.jobs){
   if(s.status==='running'&&!['done','missed'].includes(job.stage)&&s.time>=job.deadline){job.stage='missed';s.missed++;s.combo=0;const agent=s.agents.find(a=>a.job===job.id);if(agent)agent.job=null;emit(s,'A request expired. Prioritize the shortest deadline.');continue;}
   if(job.stage==='thinking'||job.stage==='working'){
    job.progress=Math.min(job.duration,job.progress+dt);
    if(job.progress>=job.duration-1e-8){const thinking=job.stage==='thinking';job.stage=thinking?'tool':'reply';job.progress=0;
     const agent=s.agents.find(a=>a.job===job.id);if(agent)agent.job=null;
     emit(s,thinking?`Choose ${job.tool} in ${job.environment}.`:'Ready. Send the reply.');
    }
   }
  }
  if(s.status==='running'&&s.spawned<s.total&&s.time>=s.nextArrival){addJob(s);s.nextArrival+=Math.max(3,7-s.wave*.4);}
  // Automation relieves repeated routing, leaving capacity and upgrade choices to the player.
  if(s.upgrades.auto&&s.status==='running'){
   for(const job of [...s.jobs].sort((a,b)=>a.deadline-b.deadline)){
    if(job.stage==='reply')reply(s,job);
    else if(job.stage==='tool'&&s.jobs.filter(j=>j.stage==='working').length<1+s.upgrades.tools)runTool(s,job,job.tool,job.environment);
    else if(job.stage==='queued'&&memoryUsed(s)+job.memory<=memoryCapacity(s)){const agent=s.agents.find(a=>a.job===null);if(agent)assign(s,job,agent);}
   }
  }
  settle(s);
 }
 return s;
}
