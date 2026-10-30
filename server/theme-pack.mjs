/** Explicit presentation-only setup. Journalled identities make retries append-only. */
import path from 'node:path';
import fs from 'node:fs/promises';
import {JsonStore,HttpError} from './storage.mjs';
import {readyMadeCatalog,validateReadyMadeCard} from './card-templates.mjs';
import {validateCardStore} from './cards.mjs';
import {validateVista} from './vistas.mjs';
import {randomUUID} from 'node:crypto';
const themes=['sci-fi','hacker','rustic','lcars'];
const names={'sci-fi':'Sci-fi TV',hacker:'Hacker TV',rustic:'Rustic TV',lcars:'LCARS TV',hologram:'Holographic Command'};
const priority=['weather','tradfri','pc-network','interests','movies','tv-calendar'];
export class ThemePack{
 constructor(root,registry,vistas,activity){Object.assign(this,{root,registry,vistas,activity});this.store=new JsonStore(path.join(root,'data/theme-pack.json'),{schemaVersion:1,revision:1,status:'empty',plans:null});this.busy=false;this.error='';}
 async load(){try{const stat=await fs.lstat(this.store.file).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(stat&&(!stat.isFile()||stat.isSymbolicLink()||stat.size>512*1024))throw Error();await this.store.load();const state=this.store.snapshot();if(state.schemaVersion!==1||!Number.isSafeInteger(state.revision)||!['empty','installing','complete'].includes(state.status)||state.plans&&(!Array.isArray(state.plans.cards)||state.plans.cards.length>192||!Array.isArray(state.plans.vistas)||state.plans.vistas.length!==5))throw Error();}catch{this.error='The themed Vista setup record cannot be read. Original data was retained.';}return this;}
 snapshot(){if(this.error)return {error:this.error,busy:false,status:'unavailable'};const saved=this.store.snapshot(),plans=saved.plans;return {error:'',busy:this.busy,status:saved.status,revision:saved.revision,designs:this.registry.plugins.reduce((sum,p)=>sum+p.cardTemplates.filter(t=>themes.some(theme=>t.id==='theme-'+theme)).length,0),cards:plans?plans.cards.length:0,vistas:plans?plans.vistas.map(v=>({id:v.id,name:v.name,url:'/vistas/'+v.slug,available:this.vistas.snapshot().some(current=>current.id===v.id&&current.enabled)})):[]};}
 plan(){
  if(this.registry.plugins.length>48)throw new HttpError(409,'A themed collection supports up to 48 installed plugins.');
  const plugins=[...this.registry.plugins].sort((a,b)=>{const rank=id=>priority.includes(id)?priority.indexOf(id):priority.length;return rank(a.id)-rank(b.id)||a.id.localeCompare(b.id);}),cards=[],refs={};
  for(const plugin of plugins){const record=this.registry.cardStore(plugin.id),settings=record.config.snapshot().settings,catalog=readyMadeCatalog(plugin,settings),source=catalog.sources.find(s=>s.enabled)||catalog.sources[0];if(!source)throw new HttpError(409,'Choose a data source for '+plugin.name+'.');let added=0;
   for(const theme of themes){if(!catalog.templates.some(t=>t.id==='theme-'+theme))throw new HttpError(409,'Install the themed designs for '+plugin.name+'.');const old=record.cards.snapshot().cards.find(c=>c.layout==='readymade'&&c.templateId==='theme-'+theme&&c.sourceId===source.id&&c.enabled);let card;
    if(old)card=old;else{card=validateReadyMadeCard({schemaVersion:1,layout:'readymade',templateId:'theme-'+theme,sourceId:source.id,enabled:true},plugin,null,settings);const base=card.name;let suffix=2;while([...record.cards.snapshot().cards,...cards.filter(p=>p.pluginId===plugin.id).map(p=>p.card)].some(c=>c.name.toLowerCase()===card.name.toLowerCase()))card.name=(base.slice(0,56)+' '+suffix++);added++;}
    cards.push({pluginId:plugin.id,card,reuse:Boolean(old)});(refs[theme]||(refs[theme]=[])).push({pluginId:plugin.id,cardId:card.id,name:plugin.name});
   }if(record.cards.snapshot().cards.length+added>100)throw new HttpError(409,'Make room for four Cards in '+plugin.name+'.');
  }
  if(this.vistas.snapshot().length+5>100)throw new HttpError(409,'Make room for five themed Vistas.');const vistas=[];
  for(const theme of [...themes,'hologram']){const base=theme==='hologram'?'holographic-command':'theme-'+theme;let slug=base,name=names[theme],suffix=2;while([...this.vistas.snapshot(),...vistas].some(v=>v.slug===slug||v.name.toLowerCase()===name.toLowerCase())){slug=base+'-'+suffix;name=names[theme]+' '+suffix++;}
   vistas.push(validateVista({schemaVersion:1,name,slug,enabled:true,gap:16,padding:0,presentation:{type:'deck',theme,motion:theme==='rustic'?'gentle':'full',spotlightSeconds:theme==='rustic'?24:18,opacity:theme==='hologram'?94:100},layout:{id:randomUUID(),type:'column',name:'Selected plugin Cards',enabled:true,width:'1fr',height:'1fr',children:refs[theme==='hologram'?'sci-fi':theme].map(ref=>({id:randomUUID(),type:'card',name:ref.name,enabled:true,width:'1fr',height:'1fr',cards:[{pluginId:ref.pluginId,cardId:ref.cardId}]}))}}));
  }return {cards,vistas};
 }
 async install(revision){
  if(this.error)throw new HttpError(409,this.error);if(this.busy)throw new HttpError(409,'Themed Vista setup is in progress.');if(revision!==this.store.snapshot().revision)throw new HttpError(409,'Themed Vista setup changed. Refresh first.');if(this.store.snapshot().status==='complete')return this.snapshot();
  this.busy=true;this.operation=(async()=>{
   if(!this.store.snapshot().plans){const plans=this.plan();await this.store.update(s=>{s.plans=plans;s.status='installing';s.revision++;});}
   const plans=this.store.snapshot().plans;
   for(const pluginId of [...new Set(plans.cards.map(p=>p.pluginId))]){const record=this.registry.cardStore(pluginId),wanted=plans.cards.filter(p=>p.pluginId===pluginId);
    await record.cards.update(current=>{for(const item of wanted){if(current.cards.some(c=>c.id===item.card.id))continue;if(item.reuse)throw new HttpError(409,'A selected Card was deleted. Existing setup was retained.');if(current.cards.length>=100||current.cards.some(c=>c.name.toLowerCase()===item.card.name.toLowerCase()))throw new HttpError(409,'Card capacity or names changed in '+pluginId+'.');validateReadyMadeCard(item.card,record.plugin,item.card,record.config.snapshot().settings);current.cards.push(item.card);}validateCardStore(current,record.plugin,record.config.snapshot().settings);});
   }
   await this.vistas.store.update(saved=>{for(const vista of plans.vistas){if(saved.vistas.some(v=>v.id===vista.id))continue;if(saved.vistas.length>=100||saved.vistas.some(v=>v.slug===vista.slug||v.name.toLowerCase()===vista.name.toLowerCase()))throw new HttpError(409,'Vista names or capacity changed. Existing Vistas were retained.');saved.vistas.push(validateVista(vista,{...vista,revision:0}));}});
   await this.store.update(s=>{s.status='complete';s.revision++;});await this.activity.add('Themed Card collection and five TV Vistas created. No integration or shared display was changed.');return this.snapshot();
  })();try{return await this.operation;}finally{this.busy=false;}
 }
 async close(){await this.operation?.catch(()=>{});await this.store.queue;}
}
