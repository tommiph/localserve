/** Synthetic positions only: tests never contact a tile service or device. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

async function viewer(){
  const images=[];
  const context={Image:class{constructor(){images.push(this);}}};
  vm.runInNewContext(await fs.readFile(new URL('../assets/sensors/phone-street-map.js',import.meta.url),'utf8'),context);
  return {map:context.PhoneStreetMap,images};
}
test('street viewport is 300 m wide, bounded and wraps the date line',async()=>{
  const {map}=await viewer();
  for(const latitude of [0,60,-60,85,-85])for(const longitude of [0,180,-180]){
    const plan=map.layout({latitude,longitude});
    assert.equal(plan.metresPerPixel*1824,300);
    assert.ok(plan.tiles.length<=36);
    for(const tile of plan.tiles){
      const [zoom,x,y]=tile.key.split('/').map(Number);
      assert.ok(zoom>=0&&zoom<=19&&x>=0&&x<2**zoom&&y>=0&&y<2**zoom);
    }
  }
  for(const fix of [null,{latitude:90,longitude:0},{latitude:0,longitude:181},{latitude:NaN,longitude:0}])assert.equal(map.layout(fix),null);
});
test('only a visible connected viewport loads tiles, without repeated reads or late paint',async()=>{
  const {map,images}=await viewer();let paints=0;
  const ctx={fillRect(){paints++;},drawImage(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){}};
  const canvas={getContext:()=>ctx},fix={latitude:0,longitude:0};
  map.draw(canvas,fix,false);assert.equal(images.length,0);
  map.draw(canvas,fix,true);const count=images.length;
  assert.ok(count>0&&count<=36);assert.ok(images.every(i=>/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/.test(i.src)));
  images[0].onload();map.draw(canvas,fix,true);assert.equal(images.length,count);
  const late=images[1].onload;map.stop();const stopped=paints;late();assert.equal(paints,stopped);
  assert.equal(images[1].src,'');
  assert.equal(map.draw(canvas,null,true),false);assert.equal(images.length,count);
});
