import {useEffect,useRef,useState} from 'react';
import {Question,ArrowLeft,ArrowRight,ArrowClockwise,Pause,Play,Coins,ShareNetwork,DownloadSimple,X,Plus,Check,Lightning} from '@phosphor-icons/react';
import {actRace,newRace,tickRace,economics,modelFor,modelCost,machineCost,harnessBoost,models,harnesses,DURATION,TARGET,type Action,type Race} from './engine';
import {PrintCard,cardById,usd} from '../GameArt';
import {CompanyFooter} from '../CompanyFooter';
import {GameHeader} from '../SiteChrome';
import {saveRacePoster} from './share';

const num=(n:number)=>new Intl.NumberFormat('en',{maximumFractionDigits:0}).format(Math.floor(n));
const one=(n:number)=>new Intl.NumberFormat('en',{maximumFractionDigits:1}).format(n);
const boostLabel=(n:number)=>new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(n);
const clock=(n:number)=>`${Math.floor(n/60).toString().padStart(2,'0')}:${Math.floor(n%60).toString().padStart(2,'0')}`;
function seedFromUrl(){const value=new URLSearchParams(location.search).get('race');return value&&/^\d{1,6}$/.test(value)?Number(value)||1:Math.floor(Math.random()*999999)+1;}
function readBest(){try{const value=Number(localStorage.getItem('model-cards-factory-best'));return Number.isFinite(value)&&value>=0?Math.floor(value):0;}catch{return 0;}}

export function Token({className=''}:{className?:string}){
 return <svg className={className} viewBox="0 0 140 160" fill="none" aria-hidden="true"><defs><linearGradient id="token-body" x1="30" y1="20" x2="100" y2="150" gradientUnits="userSpaceOnUse"><stop stopColor="#ffd1a7"/><stop offset=".55" stopColor="#f2a45e"/><stop offset="1" stopColor="#ad5824"/></linearGradient></defs><path d="M70 10 126 42v72l-56 34-56-34V42Z" fill="url(#token-body)"/><path d="m70 10 56 32-56 34-56-34Z" fill="#ffe9d5"/><path d="M70 76v72l56-34V42Z" fill="#d47c3c"/><path d="m14 42 56 34 56-34M70 76v72" stroke="#a54d1e" strokeOpacity=".5" strokeWidth="2"/><path d="m50 37-12 8 12 8m40-16 12 8-12 8M78 31 62 59" stroke="#6a3019" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export function FactoryGame(){
 const [race,setRace]=useState(()=>newRace(seedFromUrl()));
 const [tab,setTab]=useState<'models'|'harnesses'|'machines'>('models');
 const [help,setHelp]=useState(false),[benchOpen,setBenchOpen]=useState(false),[shareNotice,setShareNotice]=useState(''),[best,setBest]=useState(readBest),[pops,setPops]=useState(0);
 const benchDialog=useRef<HTMLDialogElement>(null),benchTrigger=useRef<HTMLElement|null>(null);
 const helpDialog=useRef<HTMLDialogElement>(null),resultDialog=useRef<HTMLDialogElement>(null),startButton=useRef<HTMLButtonElement>(null),helpTrigger=useRef<HTMLButtonElement>(null),hold=useRef(false);
 const lastFrame=useRef(0),holdAt=useRef(0),stage=useRef<Race['status']>('ready');
 const player=race.player,rival=race.rival,model=modelFor(player),stats=economics(player),rivalStats=economics(rival),playing=race.status==='running';
 const outOfCredits=stats.profit<0&&player.credits<=0;
 const send=(action:Action)=>setRace(s=>actRace(s,action));
 useEffect(()=>{
  document.title='Token factory · Play';
  document.getElementById('factory-title')?.focus();
  const frame=()=>{
   const now=performance.now(),delta=lastFrame.current?Math.min((now-lastFrame.current)/1000,.5):0;lastFrame.current=now;
   if(stage.current==='running'){
    const heldTap=hold.current&&now-holdAt.current>=180;
    if(heldTap)holdAt.current=now;
    setRace(s=>{const next=tickRace(s,delta);return heldTap?actRace(next,{type:'tap'}):next;});
   }
  };
  const timer=setInterval(frame,100);
  const visibility=()=>{if(document.hidden){hold.current=false;setRace(s=>actRace(s,{type:'pause'}));}lastFrame.current=0;};
  const release=()=>{hold.current=false;};
  const blur=()=>{release();setRace(s=>actRace(s,{type:'pause'}));};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pointerup',release);window.addEventListener('pointercancel',release);window.addEventListener('blur',blur);
  return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pointerup',release);window.removeEventListener('pointercancel',release);window.removeEventListener('blur',blur);};
 },[]);
 useEffect(()=>{stage.current=race.status;lastFrame.current=0;if(!playing)hold.current=false;},[race.status,playing]);
 useEffect(()=>{if(help)helpDialog.current?.showModal();else if(helpDialog.current?.open){helpDialog.current.close();helpTrigger.current?.focus();}},[help]);
 useEffect(()=>{if(benchOpen)benchDialog.current?.showModal();else if(benchDialog.current?.open){benchDialog.current.close();if(race.status!=='finished')benchTrigger.current?.focus();}},[benchOpen,race.status]);
 useEffect(()=>{
  if(race.status==='finished'){
   benchDialog.current?.close();setBenchOpen(false);
   resultDialog.current?.showModal();
   const score=Math.floor(race.player.tokens);setBest(b=>{const next=Math.max(b,score);try{localStorage.setItem('model-cards-factory-best',String(next));}catch{}return next;});
  }else resultDialog.current?.close();
 },[race.status]);
 const replay=()=>{hold.current=false;setShareNotice('');setRace(actRace(newRace(race.seed),{type:'start'}));setTab('models');requestAnimationFrame(()=>startButton.current?.focus());};
 const start=()=>send({type:'start'});
 const tap=()=>{send({type:'tap'});setPops(p=>p+1);};
 const openHelp=()=>{send({type:'pause'});setHelp(true);};
 const share=async()=>{
  const url=new URL('/token-factory/',location.origin);url.searchParams.set('race',String(race.seed));
  const text=`I made ${num(player.tokens)} tokens in ${one(race.elapsed)} seconds. Can you beat my factory?`;
  try{if(navigator.share){await navigator.share({title:'Play: token factory',text,url:url.href});setShareNotice('Challenge shared.');}
   else{await navigator.clipboard.writeText(text+' '+url.href);setShareNotice('Challenge copied. Paste it into a message.');}}
  catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))setShareNotice('Copy this challenge link: '+url.href);}
 };
 const cost=machineCost(player);
 return <div className="factory-page">
  <a className="factory-skip" href="#factory-make">Skip to making tokens</a>
  <GameHeader><button aria-label="How to play" ref={helpTrigger} onClick={openHelp}><Question size={22}/></button></GameHeader>
  <main className="factory-shell">
   <div className="factory-heading"><h1 id="factory-title" tabIndex={-1}>Token factory</h1><div className="factory-clock"><span>{race.status==='ready'?'Round length':'Time left'}</span><strong>{clock(Math.ceil(DURATION-race.elapsed))}</strong></div></div>
   <div className="factory-race" aria-label="Race progress"><div className="race-line"><span><b>You</b> {num(player.tokens)}</span><span>Computer <b>{num(rival.tokens)}</b></span></div><div className="race-tracks"><div className="race-track"><span style={{width:Math.min(100,player.tokens/TARGET*100)+'%'}}/></div><div className="race-track rival-track"><span style={{width:Math.min(100,rival.tokens/TARGET*100)+'%'}}/></div></div><p>First to 10,000 tokens. Most tokens at 2:00 wins.</p></div>
   <section className={'factory-floor '+(playing?'is-running':'')} aria-label="Your token factory">
    <div className="factory-readout"><span>Tokens</span><strong>{num(player.tokens)}</strong><small>{model?`${one(outOfCredits?0:stats.rate)} / sec`:'Ready to start'}</small></div>
    <div className="token-apparatus" aria-hidden="true"><div className="token-shadow"/><Token className="token-large"/><span className="token-burst" key={pops}>{pops>0?'+'+num(8*1.65**player.level):''}</span></div>
    <div className="factory-operator"><div className="operator-avatar">{model?<img src={model.asset} alt=""/>:<Coins size={26}/>}</div><div><strong>{model?model.name:'Luna'}</strong><span>{outOfCredits?'Make tokens to fund production':model?(player.harness?`${harnesses.find(h=>h.id===player.harness)?.name} · ${boostLabel(harnessBoost(player))}× production`:'Autopilot'):'Start with Luna'}</span></div><span className="operator-signal">{outOfCredits?'No credits':model&&playing?'Running':race.status==='paused'?'Paused':race.status==='finished'?'Finished':'Ready'}</span></div>
   </section>
   <div className="factory-controls">
    <button ref={startButton} id="factory-make" className="factory-make" disabled={race.status==='finished'} onClick={()=>race.status==='ready'?start():race.status==='paused'?send({type:'resume'}):tap()}
     onPointerDown={e=>{if(playing&&e.button===0){hold.current=true;holdAt.current=performance.now();}}} onPointerLeave={()=>{hold.current=false;}}
     onKeyDown={e=>{if(playing&&e.key===' '){e.preventDefault();if(!e.repeat){tap();hold.current=true;holdAt.current=performance.now();}}}}
     onKeyUp={e=>{if(e.key===' '){e.preventDefault();hold.current=false;}}} onBlur={()=>{hold.current=false;}}>
     <span>{race.status==='ready'?'Start':race.status==='paused'?'Resume':'Make tokens'}</span><span>{race.status==='ready'?<ArrowRight size={25}/>:race.status==='paused'?<Play size={24}/>:<>+{num(8*1.65**player.level)} <Coins size={23}/></>}</span>
    </button>
    <div className="factory-control-foot"><span>{playing?'Tap or hold to make tokens.':race.status==='ready'?'First to 10,000 tokens.':race.status==='paused'?'Both factories are paused.':'Round finished.'}</span>{race.status!=='ready'&&race.status!=='finished'&&<button className="factory-pause" aria-label={playing?'Pause both factories':'Resume both factories'} onClick={()=>send({type:playing?'pause':'resume'})}>{playing?<Pause size={18}/>:<Play size={18}/>}</button>}</div>
   </div>
   <section className="factory-bench" aria-label="Factory upgrades">
    <div className="factory-wallet"><div><span>Credits</span><strong>{num(player.credits)}<small>cr</small></strong></div><span>{model?`${stats.profit>=0?'+':''}${one(stats.profit)} cr / sec`:'Upgrade your factory'}</span></div>
    <div className="bench-tabs" role="group" aria-label="Choose upgrades">{(['models','harnesses','machines'] as const).map(t=><button key={t} aria-haspopup="dialog" onClick={e=>{setTab(t);benchTrigger.current=e.currentTarget;setBenchOpen(true);}}>{t[0].toUpperCase()+t.slice(1)}</button>)}</div>{model&&<button className="quick-machine" disabled={!playing||player.level>=8||player.credits<cost} onClick={()=>send({type:'upgrade'})}><Plus size={18}/><span>{player.level>=8?'All machines installed':'Add a machine'}</span><b>{player.level>=8?'9 / 9':cost+' cr'}</b></button>}
   </section>
   <dialog className="factory-dialog bench-dialog" ref={benchDialog} onCancel={()=>setBenchOpen(false)} aria-labelledby="bench-title"><button className="factory-dialog-close" onClick={()=>setBenchOpen(false)} aria-label="Close upgrades"><X size={22}/></button><h2 id="bench-title">{tab[0].toUpperCase()+tab.slice(1)}</h2><div className="bench-balance"><strong>{num(player.credits)} cr</strong><span>{clock(Math.ceil(DURATION-race.elapsed))} left</span></div><div className="bench-tabs" role="group" aria-label="Choose upgrades">{(['models','harnesses','machines'] as const).map(t=><button key={t} aria-pressed={tab===t} onClick={()=>setTab(t)}>{t[0].toUpperCase()+t.slice(1)}</button>)}</div>
    {tab==='models'&&<div className="bench-models">{models.map(m=>{const chosen=player.model===m.id,price=modelCost(m),preview=economics({...player,model:m.id});return <article className={'bench-model '+(chosen?'chosen':'')} key={m.id}><div className="bench-card"><PrintCard card={cardById(m.id)} bare/></div><div className="bench-model-info"><h3>{m.name}<span>{m.score} index</span></h3><p><b>{one(preview.rate)} tokens / sec</b> · {usd(m.input)} in / {usd(m.output)} out</p><small>USD / 1M tokens{m.historical?' · Jan 2025 launch':''}</small></div><button disabled={!playing||chosen||player.credits<price} onClick={()=>send({type:'model',id:m.id})} aria-label={chosen?m.name+' selected':`Hire ${m.name} for ${price} credits`}>{chosen?<><Check size={18}/><span>Selected</span></>:<><span>{price} cr</span><Plus size={18}/></>}</button></article>;})}<details className="factory-data-note"><summary>About the scores and prices</summary><p>Scores are from the Artificial Analysis Intelligence Index. These are the card’s dated reference scores and USD API rates, not live quotes. DeepSeek R1 uses its January 2025 launch rates. Credits and production are game values. No API calls or real charges.</p><a href="https://card.keff.uk/collection/index.md">Read the card sources</a></details></div>}
    {tab==='harnesses'&&<div className="bench-tools">{harnesses.map(h=>{const chosen=player.harness===h.id,match=h.family==='any'||h.family===model?.family,boost=h.family==='any'?1.35:match?1.8:1.15;return <article key={h.id} className="bench-tool"><div className="tool-glyph">{h.asset?<img src={h.asset} alt=""/>:<span>&gt;_</span>}</div><div><h3>{h.name}</h3><p>{h.family==='any'?'1.35× with every model':`1.8× with ${h.family} · 1.15× otherwise`}</p><small>{model?`${boostLabel(boost)}× with ${model.name}. Lower running costs.`:'Hire a model first.'}</small></div><button disabled={!playing||!model||chosen||player.credits<h.cost} onClick={()=>send({type:'harness',id:h.id})} aria-label={chosen?h.name+' connected':`Connect ${h.name} for ${h.cost} credits`}>{chosen?<Check size={18}/>:<>{h.cost}<small>cr</small></>}</button></article>;})}<p className="bench-hint">A harness speeds up production and reduces running costs. The boosts are game rules.</p></div>}
    {tab==='machines'&&<div className="bench-machines"><div className="machine-stack" aria-hidden="true">{Array.from({length:Math.min(player.level+1,5)},(_,i)=><span key={i}><Coins size={25}/></span>)}</div><h2>{player.level+1} {player.level===0?'machine':'machines'}</h2><p>Each new machine makes everything 1.65× faster, including your taps. It also uses 1.65× more tokens.</p><button className="machine-buy" disabled={!playing||!model||player.level>=8||player.credits<cost} onClick={()=>send({type:'upgrade'})}><Plus size={21}/>{player.level>=8?'All 9 machines installed':`Add a machine · ${cost} cr`}</button>{!model&&<p className="bench-hint">Hire a model first.</p>}</div>}
   </dialog>
   <div className="factory-rival-note"><span className="rival-dot"/><span>Computer: {modelFor(rival)?.name||'setting up'} · {one(rivalStats.rate)} tokens / sec</span></div>
   <p className="factory-announcement" role="status">{race.event}</p>
   <CompanyFooter/>
  </main>
  <dialog className="factory-dialog" ref={helpDialog} onCancel={()=>setHelp(false)} aria-labelledby="factory-help-title"><button className="factory-dialog-close" onClick={()=>setHelp(false)} aria-label="Close how to play"><X size={22}/></button><Coins className="dialog-token" size={48}/><h2 id="factory-help-title">How to play</h2><ol><li>Tap or hold to make tokens. They sell for credits.</li><li>Luna starts both factories. Switch models as you earn credits. Intelligence sets the speed; input and output prices set the costs.</li><li>Add a harness and machines. Codex favours OpenAI; Claude Code favours Anthropic.</li></ol><p>First to 10,000 tokens wins. After two minutes, the bigger factory wins. The computer pays the same prices. Pause stops both factories.</p><button className="factory-make" onClick={()=>{setHelp(false);send({type:race.status==='ready'?'start':'resume'});}}>{race.status==='ready'?'Start':'Resume'} <ArrowRight size={23}/></button><a className="factory-rule-link" href="/token-factory/rules.html">Read the formulas and rules</a></dialog>
  <dialog className="factory-dialog result-dialog" ref={resultDialog} onCancel={e=>e.preventDefault()} aria-labelledby="factory-result-title"><span className="result-stamp">{race.winner==='player'?'You won':race.winner==='tie'?'Tie':'Round complete'}</span><h2 id="factory-result-title">{race.winner==='player'?'You won.':race.winner==='tie'?'Tie.':'The computer won.'}</h2><strong className="result-tokens">{num(player.tokens)}</strong><p>tokens in {one(race.elapsed)} seconds</p><div className="result-scores"><span>Computer <b>{num(rival.tokens)}</b></span><span>Best <b>{num(best)}</b></span></div><div className="result-recipe"><Coins size={22}/><span>{model?.name||'By hand'}{player.harness?' + '+harnesses.find(h=>h.id===player.harness)?.name:''}<br/>{player.level+1} machines · {player.taps} taps</span></div><button className="factory-make" onClick={replay}>Play again <ArrowClockwise size={23}/></button><div className="result-share"><button onClick={share}><ShareNetwork size={20}/>Challenge a friend</button><button onClick={async()=>{try{const outcome=await saveRacePoster(race);setShareNotice(outcome==='shared'?'Score image shared.':'Score image saved.');}catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))setShareNotice('Unable to save the image. Try sharing the challenge link.');}}}><DownloadSimple size={20}/>Save score image</button></div><p className="share-notice" role="status">{shareNotice}</p><a href="/">Back to games</a></dialog>
 </div>;
}
