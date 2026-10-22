/** Disposable UI preview with synthetic adapters and no installed configuration. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createLocalserve} from '../../server.mjs';
import {validateTask} from '../../server/tasks.mjs';
import {formControlsFixture} from './form-controls.mjs';

const source=path.resolve(import.meta.dirname,'../..'),base=path.join(source,'tests/.tmp');
await fs.mkdir(base,{recursive:true});
const root=await fs.mkdtemp(path.join(base,'ui-preview-'));
for(const directory of ['web','assets/material-symbols','assets/controls','assets/qrcode'])
  await fs.cp(path.join(source,directory),path.join(root,directory),{recursive:true});
for(const file of ['package.json','styles.css','assets/logo.svg','assets/logo-dark.svg','assets/card-preview.js','assets/vista-boot.js','assets/vista-legacy.js','assets/vista-legacy.css','assets/vista-legacy-ready.css']) {
  await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});
  await fs.copyFile(path.join(source,file),path.join(root,file));
}
const ids=(await fs.readdir(path.join(source,'plugins'),{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort();
for(const id of ids) {
  if(!await fs.stat(path.join(source,'plugins',id,'declaration.json')).then(stat=>stat.isFile(),()=>false))continue;
  const folder=path.join(root,'plugins',id);await fs.mkdir(path.join(folder,'server'),{recursive:true});
  await fs.copyFile(path.join(source,'plugins',id,'declaration.json'),path.join(folder,'declaration.json'));
  for(const directory of ['cards','admin']) {
    const input=path.join(source,'plugins',id,directory);
    if(await fs.stat(input).then(stat=>stat.isDirectory(),()=>false))await fs.cp(input,path.join(folder,directory),{recursive:true});
  }
  if(id==='simulator')await fs.copyFile(path.join(source,'plugins',id,'server/index.mjs'),path.join(folder,'server/index.mjs'));
  else {
    const reading=id==='sensors'?{devices:{'test-phone':{'reading-status':'No recent reports · retained readings','received-at':Date.now()-1800000,'acceleration-x':0,'acceleration-y':1,'acceleration-z':2,'acceleration-unit':'m/s²'}}}:{};
    // Real provider modules and native helpers are deliberately absent.
    await fs.writeFile(path.join(folder,'server/index.mjs'),`export default {
      validateConfiguration(){return true},async start(){},async stop(){},
      async inspect(operation){if(operation!=='cameras')throw Error('Unknown setup read');return {devices:[{index:0,name:'Synthetic camera'},{index:1,name:'Second synthetic camera'}]}},
      async execute(id,p,c){if(id!=='refresh')throw Error('Only synthetic refresh is supported');await c.saveState(${JSON.stringify(reading)});return {ok:true}}
    };`);
  }
}
for(const theme of ['light','dark'])for(const scale of [100,130])await fs.writeFile(path.join(root,'assets','form-controls-'+theme+(scale===130?'-large':'')+'.html'),formControlsFixture(theme,scale));
let app,closing=false,timer;
async function close() {
  if(closing)return;closing=true;clearInterval(timer);await app?.close();
  assert.equal(path.dirname(root),base);assert.ok(path.basename(root).startsWith('ui-preview-'));
  assert.equal((await fs.lstat(root)).isSymbolicLink(),false);
  await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
try {
  app=await createLocalserve(root,{automatic:false});
  for(const id of ['simulator','sensors','samsung-tv']) {
    const service=app.registry.services().find(item=>item.id===id);
    await app.registry.saveConfiguration(id,{revision:service.config.revision,enabled:true,
      ...(id==='sensors'?{settings:{...service.config.settings,devices:[{id:'test-phone',name:'Test phone',enabled:true}]}}:{})});
    if(id!=='simulator')await app.registry.execute(id,'refresh',{});
  }
  const cards=[];
  for(const id of ['sensors','webcam','pc-network']) {
    const service=app.registry.services().find(item=>item.id===id);
    const card=await app.registry.saveCard(id,{schemaVersion:1,layout:'readymade',enabled:true,templateId:service.cardData.readyMade.templates[0].id,sourceId:id==='sensors'?'test-phone':'plugin'});
    cards.push({pluginId:id,cardId:card.id});
  }
  await app.vistas.save({schemaVersion:1,name:'Status preview',slug:'status',enabled:true,gap:16,padding:16,
    layout:{id:'canvas',type:'row',name:'Canvas',enabled:true,width:'1fr',height:'1fr',children:cards.map((reference,index)=>({id:'card-'+index,type:'card',name:'Card '+(index+1),enabled:true,width:'1fr',height:'1fr',cards:[reference]}))}});
  const task=validateTask({name:'Sample failure',enabled:true,starts:[],steps:[{id:'fail',type:'plugin',enabled:true,capabilityId:'plugin:simulator:fail',parameters:{message:'Synthetic failure'}}]},null,app.registry.actions(),app.registry.events());
  await app.tasks.update(items=>items.push(task));await app.engine.manualStart(task.id);
  await app.config.update(value=>{value.fontScale=130;});
  const stopFile=path.join(root,'.stop');
  console.log(JSON.stringify({origin:app.origin,root,stopFile,synthetic:true}));
  timer=setInterval(async()=>{if(await fs.stat(stopFile).then(()=>true,()=>false))await close();},300);
  process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
} catch(error) {await close();throw error;}
