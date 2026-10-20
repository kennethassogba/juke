import {type ReactNode} from 'react';
import {ArrowLeft,DownloadSimple} from '@phosphor-icons/react';
import {useInstall,InstallGuide} from './store/Install';
export function StudioMark(){return <a className="studio-mark" href="https://keff.uk" aria-label="keff.uk"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M5 4v16M17 5 6 14m5-5 8 11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg></a>;}
export function GameHeader({children}:{children:ReactNode}){const install=useInstall();return <><header className="game-header"><a href="/"><ArrowLeft size={19}/>Play</a><div className="game-header-actions">{children}{!install.installed&&<button onClick={install.open} aria-label="Install this game"><DownloadSimple size={21}/></button>}</div></header><InstallGuide {...install}/></>;}
