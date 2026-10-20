import {type ReactNode} from 'react';
import {ArrowLeft,DownloadSimple} from '@phosphor-icons/react';
import {useInstall,InstallGuide} from './store/Install';
export function StudioMark(){return <a className="studio-mark" href="https://keff.uk" aria-label="k eff studio">k<sub>eff</sub></a>;}
export function GameHeader({children}:{children:ReactNode}){const install=useInstall();return <><header className="game-header"><a href="/"><ArrowLeft size={19}/>Play</a><div className="game-header-actions">{children}{!install.installed&&<button onClick={install.open} aria-label="Install this game"><DownloadSimple size={21}/></button>}</div></header><InstallGuide {...install}/></>;}
