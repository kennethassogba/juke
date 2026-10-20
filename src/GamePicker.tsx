export function GameIcon({kind}:{kind:'tokens'|'harness'}){return <img className="game-app-icon" src={'/art/'+(kind==='tokens'?'token-factory':'harness-tycoon')+'.svg'} alt=""/>;}
