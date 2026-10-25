/** Optional authored examples use only Simulator and normal Task/Card/Vista
 * contracts. Pending setup can resume without replacing edited or foreign data. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual as equal} from 'node:util';
import {JsonStore,HttpError} from './storage.mjs';
import {validateTask} from './tasks.mjs';
import {validateCard} from './cards.mjs';
import {validateVista} from './vistas.mjs';

export const demoIds=Object.freeze({task:'localserve-demo-task',card:'localserve-demo-card',vista:'localserve-demo-vista'});

export function demoDefinitions(registry) {
  const record=registry.get('simulator');
  const action=(id,actionId,parameters)=>({id,type:'plugin',enabled:true,capabilityId:'plugin:simulator:'+actionId,parameters});
  const task={...validateTask({name:'Run the demo',enabled:true,starts:[],steps:[
    {id:'start',type:'log',enabled:true,message:'Demo started. Watch the Signal lab screen.'},
    action('low','set-value',{value:12}),action('pulse','pulse',{}),
    action('signal','emit-signal',{message:'Your Task is updating this screen.'}),
    {id:'wait',type:'delay',enabled:true,seconds:3},
    action('high','set-value',{value:72}),
    action('finish','emit-signal',{message:'Task complete. Try changing its steps.'}),
    {id:'done',type:'log',enabled:true,message:'Demo completed. Open Tasks to edit Run the demo.'},
  ]},null,registry.actions(),registry.events()),id:demoIds.task};
  const card={...validateCard({schemaVersion:1,layout:'readymade',templateId:'signal-lab',sourceId:'plugin',enabled:true},record.plugin,null,record.config.snapshot().settings),id:demoIds.card};
  const vista={...validateVista({schemaVersion:1,name:'Sormus demo',slug:'localserve-demo',enabled:true,gap:16,padding:24,
    layout:{id:'canvas',type:'column',name:'Canvas',enabled:true,width:'100%',height:'100%',children:[
      {id:'signal-lab',type:'card',name:'Signal lab',enabled:true,width:'100%',height:'100%',cards:[{pluginId:'simulator',cardId:card.id}]},
    ]}}),id:demoIds.vista};
  return {task,card,vista};
}

export class DemoSetup {
  constructor(root,registry,tasks,state,vistas,controls,universe,engine) {
    Object.assign(this,{registry,tasks,state,vistas,controls,universe,engine});
    this.file=path.join(root,'data/demo.json');
    this.journal=null;
  }
  async load() {
    try {
      const stat=await fs.lstat(this.file);
      if(!stat.isFile()||stat.isSymbolicLink())throw Error('Invalid demo setup record.');
      const record=JSON.parse(await fs.readFile(this.file,'utf8'));
      if(record.schemaVersion!==1||!['installing','ready'].includes(record.status)
        ||!Number.isSafeInteger(record.simulatorRevision)||record.simulatorRevision<1
        ||Object.keys(record).some(key=>!['schemaVersion','status','simulatorRevision'].includes(key)))throw Error('Invalid demo setup record.');
      this.journal=await new JsonStore(this.file,{}).load();
    }catch(error){if(error.code!=='ENOENT')this.error='Demo setup record is invalid. The original file was preserved.';}
    return this;
  }
  eligible() {
    try {
      if(this.error)return false;
      const pending=this.journal?.snapshot();
      const owned=pending?.status==='installing'?demoDefinitions(this.registry):null;
      const only=(items,item)=>items.every(value=>item&&equal(value,item));
      const simulator=this.registry.get('simulator'),config=simulator.config.snapshot();
      const configOwned=pending&&config.revision===pending.simulatorRevision+1&&config.enabled;
      if(!simulator.cards||config.settings['configuration-complete']!==true
        ||config.revision!==(pending?.simulatorRevision??1)&&!configOwned
        ||config.enabled&&!configOwned||this.engine.gate.paused||this.engine.active.size||this.engine.pending.size
        ||this.state.snapshot().runs.length||Object.keys(simulator.state.snapshot()).length)return false;
      if(this.registry.services().some(service=>service.id!=='simulator'&&(service.enabled||service.config.revision!==1||Object.keys(service.pluginState).length)))return false;
      if(!only(this.tasks.snapshot(),owned?.task)||!only(this.vistas.snapshot(),owned?.vista)
        ||this.vistas.displaySnapshot().vistaId!==null||this.universe.snapshot().cards.length)return false;
      if(this.controls.admin().some(plugin=>plugin.pages.length))return false;
      for(const service of this.registry.services())if(!only(service.cards,service.id==='simulator'?owned?.card:null))return false;
      return true;
    }catch{return false;}
  }
  snapshot() {
    const status=this.journal?.snapshot().status;
    const task=this.tasks.snapshot().find(item=>item.id===demoIds.task);
    const vista=this.vistas.snapshot().find(item=>item.id===demoIds.vista);
    let original=false;
    try{original=equal(task,demoDefinitions(this.registry).task);}catch{}
    const running=Array.from(this.engine.active.values()).some(run=>run.taskId===demoIds.task)||this.engine.pending.has(demoIds.task);
    return {status:this.error?'unavailable':status||'not-installed',available:!this.error&&status!=='ready'&&this.eligible(),
      taskId:status==='ready'&&task?task.id:null,revision:task?.revision??null,
      vistaUrl:status==='ready'&&vista?.enabled?'/vistas/'+vista.slug:null,
      running,canRun:status==='ready'&&original&&!running&&!this.engine.gate.paused&&this.registry.actions().some(action=>action.id==='plugin:simulator:pulse'&&action.available),
    };
  }
  async install(values) {
    if(!values||Object.keys(values).length)throw new HttpError(400,'Demo setup does not accept settings or device targets.');
    if(this.error)throw new HttpError(409,this.error);
    if(this.journal?.snapshot().status==='ready')return;
    if(!this.eligible())throw new HttpError(409,'The demo needs an empty installation with Simulator unchanged. Existing content was preserved.');
    const definitions=demoDefinitions(this.registry),record=this.registry.get('simulator');
    if(!this.journal)this.journal=await new JsonStore(this.file,{schemaVersion:1,status:'installing',simulatorRevision:record.config.snapshot().revision}).load();
    // The journal precedes definitions. A failed write leaves a resumable setup;
    // there are no automatic rules, display selection changes or Task effects.
    const add=(items,item)=>{
      if(items.some(value=>value.id!==item.id||!equal(value,item)))throw new HttpError(409,'Demo content changed. Existing content was preserved.');
      if(!items.length)items.push(item);
    };
    await record.cards.update(store=>add(store.cards,definitions.card));
    await this.vistas.store.update(store=>add(store.vistas,definitions.vista));
    await this.tasks.update(items=>add(items,definitions.task));
    const current=record.config.snapshot();
    if(!current.enabled)await this.registry.saveConfiguration('simulator',{revision:this.journal.snapshot().simulatorRevision,enabled:true});
    await this.journal.update(record=>{record.status='ready';});
    await this.engine.syncRuleClocks();
  }
  async run(values) {
    if(!values||Object.keys(values).some(key=>key!=='revision')||!Number.isSafeInteger(values.revision))throw new HttpError(400,'Use the current demo Task revision.');
    if(!this.snapshot().canRun)throw new HttpError(409,'The demo Task is unavailable or has been edited. Review it in Tasks.');
    return this.engine.manualStart(demoIds.task,{revision:values.revision});
  }
}
