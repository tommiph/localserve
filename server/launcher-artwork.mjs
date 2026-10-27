/** Bounded, read-only Smart Hub artwork cache. TV settings/credentials and
 * filesystem paths never enter the public response or the disk cache. */
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {HttpError} from './storage.mjs';

export class LauncherArtwork {
  constructor(root,registry,gate,{reader,now=Date.now}={}) {
    Object.assign(this,{root,registry,gate,reader,now});this.cache=new Map();this.controllers=new Set();this.queue=Promise.resolve();this.waiting=0;this.closed=false;
  }
  async read(names,signal=new AbortController().signal) {
    if(!Array.isArray(names)||names.length>12||!names.length||names.some(name=>typeof name!=='string'||!name.trim()||name.length>100||/[\x00-\x1f\x7f]/.test(name)))throw new HttpError(400,'Choose up to 12 installed app names.');
    names=[...new Set(names.map(name=>name.trim()))];
    if(this.closed||signal.aborted||this.gate.paused||this.waiting>=3)return {icons:[]};
    this.waiting++;
    const operation=this.queue.then(async()=>{
      let record;try{record=this.registry.get('samsung-tv');}catch{return {icons:[]};}
      const config=record.config.snapshot(),runtime=record.runtime;
      const valid=()=>{try{return !this.closed&&!this.gate.paused&&this.registry.get('samsung-tv')===record&&record.runtime===runtime&&record.config.snapshot().revision===config.revision&&record.config.snapshot().enabled&&record.configured&&record.health==='ready'&&!record.pending;}catch{return false;}};
      if(!valid()||signal.aborted)return {icons:[]};
      const gate=()=>{if(!valid())throw Error('TV artwork source changed.');};
      const prefix=JSON.stringify([config.revision,config.settings.host,record.plugin.version])+':';
      const missing=names.filter(name=>!(this.cache.get(prefix+name)?.expires>this.now()));
      if(missing.length){
        const controller=new AbortController();this.controllers.add(controller);
        try{
          let reader=this.reader;
          if(!reader){const module=await import(pathToFileURL(path.join(this.root,'plugins/samsung-tv/server/launcher-artwork.mjs')));reader=module.readLauncherArtwork;}
          gate();const rows=await reader(structuredClone(config.settings),missing,AbortSignal.any([signal,controller.signal,AbortSignal.timeout(5000)]),gate);gate();signal.throwIfAborted();
          for(const name of missing){const image=rows.find(row=>row.name===name)?.image||null;this.cache.set(prefix+name,{image,expires:this.now()+(image?600000:60000)});}
        }catch{
          // Unavailable artwork stays a glyph; reads never retry TV commands.
          if(valid()&&!signal.aborted)for(const name of missing)this.cache.set(prefix+name,{image:null,expires:this.now()+60000});
        }finally{this.controllers.delete(controller);}
      }
      if(!valid()||signal.aborted)return {icons:[]};
      while(this.cache.size>256)this.cache.delete(this.cache.keys().next().value);
      return {icons:names.map(name=>({name,image:this.cache.get(prefix+name)?.image})).filter(row=>row.image)};
    });
    this.queue=operation.catch(()=>{});try{return await operation;}finally{this.waiting--;}
  }
  close(){this.closed=true;for(const controller of this.controllers)controller.abort();this.cache.clear();}
}
