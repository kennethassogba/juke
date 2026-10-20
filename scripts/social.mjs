// Run after changing catalogue artwork. Outputs contain only game names and existing art.
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {writeFile} from 'node:fs/promises';
import {games} from '../src/store/catalog.ts';
const pub=new URL('../public/',import.meta.url);
for(const size of [192,512]){
 const canvas=createCanvas(size,size),c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,size,size);c.fillStyle='#1d1d1f';c.font=`700 ${size*.6}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('P',size/2,size*.54);await writeFile(new URL(`art/play-${size}.png`,pub),canvas.toBuffer('image/png'));
}
for(const game of [...games,null]){
 const canvas=createCanvas(1200,630),c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,1200,630);
 c.fillStyle='#1d1d1f';c.font='700 72px sans-serif';c.fillText(game?.name||'Play',64,105);
 const selected=game?[game]:games;
 for(const [i,g]of selected.entries()){
  const img=await loadImage(new URL(g.art.slice(1),pub).pathname),x=game?64:64+i*368,y=game?152:174,w=game?1072:336,h=game?430:312;
  c.save();c.beginPath();c.roundRect(x,y,w,h,20);c.clip();c.fillStyle='#f5f6f8';c.fillRect(x,y,w,h);
  const scale=Math.max(w/img.width,h/img.height);c.drawImage(img,x+(w-img.width*scale)/2,y+(h-img.height*scale)/2,img.width*scale,img.height*scale);c.restore();
  if(!game){c.fillStyle='#1d1d1f';c.font='600 28px sans-serif';c.fillText(g.name,x,536);}
 }
 await writeFile(new URL(`art/share-${game?.slug||'play'}.png`,pub),canvas.toBuffer('image/png'));
}
console.log('Wrote Play icons and four social previews.');
