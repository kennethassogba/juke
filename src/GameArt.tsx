import {models} from './factory/engine';
export const cardById=(id:string)=>models.find(m=>m.id===id)!;
export const usd=(n:number)=>'$'+n.toFixed(2);
export function PrintCard({card}:{card:{asset:string};bare?:boolean}){return <div className="tcg-card official-card"><div className="official-art"><img src={card.asset} alt="" loading="lazy"/></div></div>;}
