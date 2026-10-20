import {modelFor,type Race} from './engine';

// A portable portrait scorecard. No user data leaves the browser to render it.
export async function saveRacePoster(race:Race){
 const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1920;
 const c=canvas.getContext('2d');if(!c)throw new Error('Canvas unavailable.');
 await document.fonts.ready;
 c.fillStyle='#0b0c0f';c.fillRect(0,0,1080,1920);
 c.fillStyle='#f5f5f7';c.font='600 42px Figtree';c.fillText('Play',76,120);
 c.font='600 120px Figtree';c.fillText('Token',76,340);c.fillText('factory',76,470);
 c.fillStyle='#15161b';c.beginPath();c.roundRect(60,570,960,950,34);c.fill();
 c.fillStyle='#ffb779';c.beginPath();c.moveTo(540,650);c.lineTo(690,735);c.lineTo(690,905);c.lineTo(540,995);c.lineTo(390,905);c.lineTo(390,735);c.closePath();c.fill();
 c.fillStyle='#5e2d16';c.font='600 95px Figtree';c.textAlign='center';c.fillText('</>',540,865);
 c.fillStyle='#f8fbfe';c.textAlign='center';c.font='600 145px Figtree';c.fillText(new Intl.NumberFormat('en',{maximumFractionDigits:0}).format(Math.floor(race.player.tokens)),540,1160);
 c.font='400 42px Figtree';c.fillText(`tokens in ${race.elapsed.toFixed(1)} seconds`,540,1235);
 c.font='600 48px Figtree';c.fillStyle='#ffb779';c.fillText(race.winner==='player'?'You won.':race.winner==='tie'?'Tie.':'Challenge a friend',540,1400);
 c.textAlign='start';c.fillStyle='#f5f5f7';c.font='600 46px Figtree';c.fillText(modelFor(race.player)?.name||'Made by hand',76,1630);
 c.font='400 34px Figtree';c.fillText(`${race.player.level+1} machines · ${race.player.taps} taps · Race ${race.seed}`,76,1690);
 c.font='600 39px Figtree';c.fillText('play.keff.uk/token-factory/',76,1840);
 const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Unable to export.')),'image/png'));
 const file=new File([blob],'model-cards-factory.png',{type:'image/png'});
 if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'Play factory'});return 'shared' as const;}
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);return 'saved' as const;
}
