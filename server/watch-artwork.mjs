/** Read-only artwork for current public movie picks. Images stay in a bounded
 * private PC cache; browsers receive local paths, never provider credentials. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {isPrivateIPv4} from './network.mjs';
import {HttpError} from './storage.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,40);
const imagePath=value=>typeof value==='string'&&/^\/[a-zA-Z0-9_-]{1,100}\.jpg$/.test(value);
const route='/api/watch-art/';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function embyConnection(settings){
  try{const url=new URL(settings['server-url']),token=settings['api-key'];
    if(!isPrivateIPv4(url.hostname)&&!(isIP(url.hostname)===4&&url.hostname.startsWith('127.'))||!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!['/','/emby','/emby/'].includes(url.pathname)||typeof token!=='string'||!/^[a-zA-Z\d_-]{16,256}$/.test(token))return null;
    url.pathname='/emby/Sessions';return {url:url.href,token};
  }catch{return null;}
}
export class WatchArtwork {
  constructor(root,registry,gate,{fetchImpl=fetch,now=Date.now}={}){
    this.directory=path.join(root,'data/watch-artwork');this.registry=registry;this.gate=gate;this.fetch=fetchImpl;this.now=now;
    this.pending=new Map();this.misses=new Map();this.controller=new AbortController();this.queue=Promise.resolve();
  }
  /** Resolve only this source's current declared picks, with identity-bound state. */
  choices(id){
    if(!['movies','emby'].includes(id)||this.controller.signal.aborted)return [];
    let record;try{record=this.registry.get(id);}catch{return [];}
    const config=record.config.snapshot();if(!config.enabled)return [];
    const values=this.registry.cardSource(id)?.cardData?.values||{},state=record.state.snapshot(),result=[];
    const read=key=>values[key]?.available?values[key].value:undefined;
    for(let i=1;i<=4;i++){
      const title=read(`pick-${i}-title`),link=read(`pick-${i}-url`);if(!title||!link)continue;
      let targets={},headers={Accept:'image/jpeg'},identity;
      if(id==='movies'){
        const settings=config.settings,genres=(settings.genres===undefined?settings.genre||'':settings.genres).split(',').filter(Boolean).sort().join(',');
        if(settings.source==='starter'||state.identity!==digest([settings.source,settings.region,settings.language,genres,settings['api-token']]))continue;
        const item=(state.catalog||[]).find(row=>row.title===title&&row.url===link&&row.source==='TMDB');if(!item)continue;
        identity=[config.revision,state.identity,item.id];
        for(const [kind,field,size]of [['poster','posterPath','w342'],['backdrop','backdropPath','w780']])if(imagePath(item[field]))targets[kind]='https://image.tmdb.org/t/p/'+size+item[field];
      }else{
        const item=(state.libraryPicks||[]).find(row=>row.title===title&&row.url===link),connection=embyConnection(config.settings);
        if(!item||!connection||!config.settings['library-suggestions'])continue;
        if(state.library?.identity!==digest([connection.url,connection.token,config.settings['library-limit']??100]))continue;
        identity=[config.revision,state.library?.identity,item.id];headers['X-Emby-Token']=connection.token;
        for(const [kind,tag,type]of [['poster',item.posterTag,'Primary'],['backdrop',item.backdropTag,'Backdrop']])if(typeof tag==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(tag)){
          const url=new URL(connection.url);url.pathname='/emby/Items/'+encodeURIComponent(item.id)+'/Images/'+type+(kind==='backdrop'?'/0':'');
          for(const [key,value]of Object.entries({MaxWidth:kind==='poster'?'342':'780',Quality:'85',Format:'jpg',Tag:tag}))url.searchParams.set(key,value);
          targets[kind]=url.href;
        }
      }
      if(Object.keys(targets).length)result.push({id,title,key:hash([id,identity,targets]),targets,headers});
    }
    return result;
  }
  describe(id,title,choices=this.choices(id)){
    const item=choices.find(item=>item.title===title);if(!item)return null;
    return Object.fromEntries(Object.keys(item.targets).map(kind=>[kind,route+id+'/'+item.key+'/'+kind+'.jpg']));
  }
  decorate(view){
    if(view.vista?.presentation?.type!=='today')return view;
    const choices={};
    for(const entry of view.cards||[]){
      if(!['movies','emby'].includes(entry.pluginId)||!entry.data||entry.card?.layout!=='readymade')continue;
      const artwork=Object.create(null);for(const [key,value]of Object.entries(entry.data.values||{}))if(/(?:^|:)pick-[1-4]-title$/.test(key)&&value.available&&value.type==='string'){
        choices[entry.pluginId]??=this.choices(entry.pluginId);const images=this.describe(entry.pluginId,value.value,choices[entry.pluginId]);if(images)artwork[value.value]=images;
      }
      entry.data={...entry.data,todayArtwork:artwork};
    }
    return view;
  }
  async read(id,key,kind){
    const item=this.choices(id).find(item=>item.key===key),url=item?.targets[kind];
    if(!url)throw new HttpError(404,'Artwork unavailable.');
    const cacheKey=key+'-'+kind,file=path.join(this.directory,cacheKey+'.jpg');
    try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Not a cache file');if(stat.size<=1572864){const bytes=await fs.readFile(file);if(validJpeg(bytes)&&this.choices(id).some(value=>value.key===key))return bytes;}}catch(error){if(error.code!=='ENOENT')throw new HttpError(404,'Artwork unavailable.');}
    if(this.gate.paused||this.pending.size>=4&&!this.pending.has(cacheKey)||(this.misses.get(cacheKey)||0)>this.now())throw new HttpError(404,'Artwork unavailable.');
    if(this.pending.has(cacheKey))return this.pending.get(cacheKey);
    const pending=this.load(item,kind,url,file,cacheKey);this.pending.set(cacheKey,pending);
    try{return await pending;}finally{this.pending.delete(cacheKey);}
  }
  async load(item,kind,url,file,cacheKey){
    const signal=AbortSignal.any([this.controller.signal,AbortSignal.timeout(8000)]);
    try{
      const response=await this.fetch(url,{signal,redirect:'error',headers:item.headers});
      if(!response.ok||!/^image\/jpeg(?:;|$)/i.test(response.headers.get('content-type')||'')||Number(response.headers.get('content-length'))>1572864){await response.body?.cancel();throw Error('Unavailable');}
      if(!response.body)throw Error('Unavailable');
      const reader=response.body.getReader(),chunks=[];let length=0,complete=false;
      try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done){complete=true;break;}length+=part.value.length;if(length>1572864)throw Error('Too large');chunks.push(part.value);}}
      finally{if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock();}
      const bytes=Buffer.concat(chunks);if(!validJpeg(bytes)||this.gate.paused||!this.choices(item.id).some(value=>value.key===item.key))throw Error('Unavailable');
      // Serialize cache maintenance; a failed cache write never removes metadata.
      const save=this.queue.catch(()=>{}).then(async()=>{
        signal.throwIfAborted();await fs.mkdir(this.directory,{recursive:true});await fs.writeFile(file,bytes);
        const files=(await fs.readdir(this.directory,{withFileTypes:true})).filter(entry=>entry.isFile()&&/^[a-f0-9]{40}-(poster|backdrop)\.jpg$/.test(entry.name));
        const dated=await Promise.all(files.map(async entry=>({name:entry.name,at:(await fs.stat(path.join(this.directory,entry.name))).mtimeMs})));
        dated.sort((a,b)=>b.at-a.at);for(const entry of dated.slice(48))await fs.unlink(path.join(this.directory,entry.name));
      });this.queue=save;await save;signal.throwIfAborted();if(this.gate.paused||!this.choices(item.id).some(value=>value.key===item.key))throw Error('Unavailable');return bytes;
    }catch{
      this.misses.set(cacheKey,this.now()+900000);while(this.misses.size>64)this.misses.delete(this.misses.keys().next().value);
      throw new HttpError(404,'Artwork unavailable.');
    }
  }
  close(){this.controller.abort();}
}
function validJpeg(bytes){return bytes.length>4&&bytes.length<=1572864&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217;}
