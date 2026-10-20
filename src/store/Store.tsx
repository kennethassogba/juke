import {useEffect,useRef,useState} from 'react';
import {MagnifyingGlass,ArrowLeft,Share,Check,DownloadSimple,X} from '@phosphor-icons/react';
import {games,gamePath,searchGames,type Game} from './catalog';
import {useInstall,InstallGuide} from './Install';
import {CompanyFooter} from '../CompanyFooter';
import {registerCatalogTools} from './webmcp';

function PlayLink({game}:{game:Game}){return <a className="primary-button" href={gamePath(game)} aria-label={'Play '+game.name}>Play</a>;}
function GameCard({game}:{game:Game}){return <article className={'game-card card-'+game.slug}>
 <a className="card-art" href={'/apps/'+game.slug} aria-label={game.name+' details'}><img src={game.art} alt="" width="640" height="480"/></a>
 <div className="card-info"><a href={'/apps/'+game.slug} className="card-name"><img className="app-icon" src={game.icon} width="48" height="48" alt=""/><span><h2>{game.name}</h2><p>{game.subtitle}</p></span></a><div className="card-actions"><PlayLink game={game}/><a className="icon-button" href={gamePath(game)+'?install=1'} aria-label={'Install '+game.name}><DownloadSimple size={21}/></a></div></div>
 </article>;}
function GameDetail({game}:{game:Game}){
 const [shared,setShared]=useState(false),[notice,setNotice]=useState('');
 async function share(){const data={title:game.name,url:location.origin+'/apps/'+game.slug};try{if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(data.url);setShared(true);setNotice('Link copied.');}}catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))setNotice('Copy this link: '+data.url);}}
 return <><a className="back-link" href="/" aria-label="Back to Play"><ArrowLeft size={20}/>Play</a><article className="app-detail"><div className="detail-heading"><img className="app-icon detail-icon" src={game.icon} width="88" height="88" alt=""/><div><h1>{game.name}</h1><p>{game.subtitle}</p></div><div className="detail-actions"><PlayLink game={game}/><a className="secondary-button" href={gamePath(game)+'?install=1'}><DownloadSimple size={19}/>Install</a><button className="icon-button" onClick={share} aria-label={'Share '+game.name}>{shared?<Check size={21}/>:<Share size={21}/>}</button></div></div><p className="share-notice" role="status">{notice}</p><div className={'detail-art art-'+game.slug}><img src={game.art} alt={game.slug==='juke'?'JUKE’s arena with four paddles and a shared puck.':game.name+' artwork'}/></div><div className="detail-body"><section className="app-description"><p>{game.description}</p><h2>Controls</h2><p>{game.controls}</p><details><summary>{game.slug==='juke'?'Models & modes':'Game rules'}</summary><ul>{game.features.map(s=><li key={s}>{s}</li>)}</ul></details></section><dl className="app-facts">{game.facts.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div></article></>;
}
export function Store({pathname='/',initialQuery=''}:{pathname?:string;initialQuery?:string}){
 const detail=games.find(g=>pathname==='/apps/'+g.slug);
 const [query,setQuery]=useState(initialQuery),input=useRef<HTMLInputElement>(null);
 const install=useInstall();
 const changeQuery=(value:string)=>{setQuery(value.slice(0,120));const url=new URL(location.href);if(value)url.searchParams.set('q',value.slice(0,120));else url.searchParams.delete('q');history.replaceState(null,'',url.pathname+url.search);};
 useEffect(()=>{if(detail)return;return registerCatalogTools(value=>changeQuery(value));},[detail]);
 useEffect(()=>{const sync=()=>setQuery(new URLSearchParams(location.search).get('q')?.slice(0,120)||'');sync();window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync);},[]);
 const listed=searchGames(query);
 return <div className="store"><a className="skip-link" href="#main">Skip to games</a><header className="store-header"><a className="play-wordmark" href="/">Play</a>{!install.installed&&<button className="icon-button" onClick={install.open} aria-label="Install Play"><DownloadSimple size={21}/></button>}</header><main id="main" className="store-main">{detail?<GameDetail game={detail}/>:<><h1 className="sr-only">Play games</h1><form className="search-box" role="search" action="/" onSubmit={event=>event.preventDefault()}><MagnifyingGlass size={22} aria-hidden="true"/><input ref={input} type="search" name="q" aria-label="Search games" placeholder="Search games" maxLength={120} autoComplete="off" value={query} onChange={e=>changeQuery(e.target.value)}/>{query&&<button className="clear-search" type="button" aria-label="Clear search" onClick={()=>{changeQuery('');input.current?.focus();}}><X size={19}/></button>}</form><p className="sr-only" role="status">{listed.length} {listed.length===1?'game':'games'}</p><section className="game-grid" aria-label="Games">{listed.map(game=><GameCard key={game.slug} game={game}/>)}</section>{!listed.length&&<div className="empty-state"><p>No games found.</p><button className="secondary-button" onClick={()=>{changeQuery('');input.current?.focus();}}>Clear search</button></div>}</>}<CompanyFooter/></main><InstallGuide {...install}/></div>;
}
