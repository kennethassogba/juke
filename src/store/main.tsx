import {createRoot,hydrateRoot} from 'react-dom/client';
import {FactoryGame} from '../factory/FactoryGame';
import {HarnessGame} from '../harness/HarnessGame';
import {Store} from './Store';
import './store.css';
import '../factory/factory.css';
import '../harness/harness.css';
import './games.css';
const path=location.pathname;
const slug=path.startsWith('/token-factory')?'token-factory':path.startsWith('/harness-tycoon')?'harness-tycoon':null;
// Import only validated best scores from the old Card origin. No account data is transferred.
if(location.hash.startsWith('#migrate='))try{const data=JSON.parse(decodeURIComponent(location.hash.slice(9)));for(const key of ['model-cards-factory-best','model-cards-harness-wave'])if(Number.isInteger(data[key])&&data[key]>=0&&data[key]<=1e9)localStorage.setItem(key,String(Math.max(Number(localStorage.getItem(key))||0,data[key])));history.replaceState(null,'',location.pathname+location.search);}catch{}
if(slug){try{const recent=JSON.parse(localStorage.getItem('play-recent')||'[]');localStorage.setItem('play-recent',JSON.stringify([slug,...recent.filter((s:string)=>s!==slug)].slice(0,3)));}catch{} }
if(slug)createRoot(document.getElementById('root')!).render(slug==='token-factory'?<FactoryGame/>:<HarnessGame/>);
else hydrateRoot(document.getElementById('root')!,<Store pathname={location.pathname}/>);
if('serviceWorker' in navigator)navigator.serviceWorker.register(slug?`/${slug}/sw.js`:'/sw.js',{scope:slug?`/${slug}/`:'/'}).catch(()=>{});
if(slug&&new URLSearchParams(location.search).has('install')){history.replaceState(null,'',location.pathname);requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('[aria-label="Install this game"]')?.click());}
