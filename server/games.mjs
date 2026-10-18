/** Package-owned games and revisioned preferences; play sessions stay in browsers. */
import path from 'node:path';
import fs from 'node:fs/promises';
import {JsonStore,HttpError} from './storage.mjs';
export const gameDefaults={schemaVersion:1,revision:1,enabled:true,startSize:5,growth:2,gemCount:18,gemPoints:100,speedPoints:1000,paceSeconds:2,moveMs:280,detail:'low',musicUrl:'',musicVolume:40};
export function validateGames(value,previous=gameDefaults){
  if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(key=>!Object.hasOwn(gameDefaults,key)))throw new HttpError(400,'Unknown game setting.');
  if(value.schemaVersion!==1||!Number.isSafeInteger(value.revision)||value.revision!==previous.revision||value.revision>=Number.MAX_SAFE_INTEGER)throw new HttpError(409,'Game settings changed. Close and reopen the editor.');
  if(typeof value.enabled!=='boolean'||!['low','medium','high'].includes(value.detail))throw new HttpError(400,'Choose game enablement and rendering detail.');
  for(const [key,min,max]of [['startSize',3,25],['growth',1,10],['gemCount',0,64],['gemPoints',1,10000],['speedPoints',1,100000],['paceSeconds',1,30],['moveMs',120,800],['musicVolume',0,100]]){
    if(!Number.isInteger(value[key])||value[key]<min||value[key]>max)throw new HttpError(400,`${key} must be a whole number from ${min} to ${max}.`);
  }
  if(typeof value.musicUrl!=='string'||value.musicUrl.length>240||value.musicUrl!==''&&!/^\/assets\/games\/music\/[a-zA-Z0-9_-]+\.(?:mp3|ogg|wav|m4a)$/.test(value.musicUrl))throw new HttpError(400,'Use a music file under /assets/games/music/, or leave it blank.');
  return {...value,revision:previous.revision+1};
}
export async function requireMazeDisplay(root){
  try{
    const base=await fs.realpath(root),web=await fs.realpath(path.join(root,'web'));
    const file=await fs.realpath(path.join(root,'web/maze.html'));
    if(!web.startsWith(base+path.sep)||!file.startsWith(web+path.sep)||!(await fs.stat(file)).isFile())throw Error();
    return file;
  }catch{throw new HttpError(404,'Maze game page is unavailable.');}
}
export class GamesStore{
  constructor(root,registry,activity){this.root=root;this.registry=registry;this.activity=activity;this.store=new JsonStore(path.join(root,'data/games.json'),gameDefaults);this.launching=false;}
  async load(){await this.store.load();validateGames(this.store.snapshot(),this.store.snapshot());return this;}
  snapshot(){return this.store.snapshot();}
  admin(){const availability=this.registry.actionAvailability('samsung-tv','launch-app');return {...this.snapshot(),tvAvailable:availability.available&&!this.launching&&!this.registry.engine?.gate.paused,tvReason:availability.unavailableReason||''};}
  viewer(){const value=this.snapshot();if(!value.enabled)throw new HttpError(404,'Games are disabled.');const {revision,schemaVersion,...settings}=value;return {settings};}
  async save(value){await this.store.update(current=>Object.assign(current,validateGames(value,current)));await this.activity.add('Game settings updated');}
  async openOnTv(revision,signal){
    if(this.launching)throw new HttpError(409,'A game launch is already in progress.');
    const value=this.snapshot();
    if(!value.enabled||revision!==value.revision)throw new HttpError(409,'Refresh Games before launching.');
    this.launching=true;
    try{
      await requireMazeDisplay(this.root);signal.throwIfAborted();
      if(this.snapshot().revision!==revision)throw new HttpError(409,'Game settings changed before launch.');
      const origin=this.registry.localDisplayOrigin?.();
      if(!origin)throw new HttpError(409,'Configure a private LAN server address before opening a game on TV.');
      await this.activity.add('Opening Neon Labyrinth on TV');
      signal.throwIfAborted();
      if(this.snapshot().revision!==revision||!this.snapshot().enabled)throw new HttpError(409,'Game settings changed before launch.');
      await this.registry.execute('samsung-tv','launch-app',{id:'HwGlance01.HomeGlance',mode:'DEEP_LINK',arguments:origin+'/games/maze'},{signal,automatic:false});
      return {sent:true};
    }finally{this.launching=false;}
  }
}
