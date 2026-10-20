import {useEffect,useRef,useState} from 'react';
import {DownloadSimple,Share,X} from '@phosphor-icons/react';
type Prompt=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
let pending:Prompt|null=null;
if(typeof window!=='undefined')window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();pending=event as Prompt;});
const standalone=()=>typeof window!=='undefined'&&(matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone===true);
export function useInstall(){
 const [installed,setInstalled]=useState(false),[show,setShow]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{setInstalled(standalone());const done=()=>{setInstalled(true);setShow(false);pending=null;};window.addEventListener('appinstalled',done);return()=>window.removeEventListener('appinstalled',done);},[]);
 const open=async()=>{if(pending){const p=pending;pending=null;await p.prompt();await p.userChoice;}else setShow(true);};
 return{installed,show,message,open,close:()=>setShow(false),setMessage};
}
export function InstallGuide({show,close}:ReturnType<typeof useInstall>){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(show)ref.current?.showModal();else ref.current?.close();},[show]);
 const ua=typeof navigator==='undefined'?{userAgent:'',platform:'',maxTouchPoints:0}:navigator;
 const ios=/iPad|iPhone|iPod/.test(ua.userAgent)||(ua.platform==='MacIntel'&&ua.maxTouchPoints>1),android=/Android/.test(ua.userAgent);
 return <dialog ref={ref} className="install-dialog" onCancel={close} aria-labelledby="install-heading"><button className="close-button" onClick={close} aria-label="Close install instructions"><X size={24}/></button><span className="install-symbol"><DownloadSimple size={30}/></span><h2 id="install-heading">Install</h2>{ios?<><p>In Safari, tap <Share size={18} aria-label="Share"/> <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</p><p>Turn on <strong>Open as Web App</strong> and tap <strong>Add</strong>.</p></>:android?<><p>In Chrome, open the <strong>⋮</strong> menu and choose <strong>Add to Home screen</strong>, then <strong>Install</strong>.</p></>:<p>In Chrome or Edge, open the browser menu and choose <strong>Install this page as an app</strong>. Safari on Mac uses <strong>File → Add to Dock</strong>.</p>}<button className="primary-button" onClick={close}>Done</button></dialog>;
}
