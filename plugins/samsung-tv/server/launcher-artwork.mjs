/** Read Smart Hub artwork through the TV's existing paired remote protocol.
 * Store IDs and native package IDs differ; match only a unique installed name.
 * No app launch, key press, credential write or arbitrary file read is exposed. */
import {createVault} from './vault.mjs';
import {connectRemote} from './client.mjs';
import WebSocket from '../vendor/node_modules/ws/wrapper.mjs';

export function hubImage(value) {
  if(typeof value!=='string'||value.length>65536||!/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value))return null;
  const bytes=Buffer.from(value,'base64');
  if(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.subarray(12,16).toString()!=='IHDR')return null;
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(!width||!height||width>4096||height>4096||Math.abs(width/height-16/9)>.12)return null;
  return 'data:image/png;base64,'+value;
}
export function hubPath(app) {
  if(!app||typeof app.appId!=='string'||!/^[\w.-]{1,128}$/.test(app.appId)||['.','..'].includes(app.appId))return null;
  const directory='/opt/share/webappservice/apps_icon/FirstScreen/'+app.appId+'/';
  return typeof app.icon==='string'&&app.icon.startsWith(directory)&&/^[\w.-]+\.png$/.test(app.icon.slice(directory.length))
    ? directory+'167x94.png':null;
}
export async function readLauncherArtwork(settings,names,signal,gate,{vault=createVault(),connect=connectRemote,socketFactory=(url,options)=>new WebSocket(url,options)}={}) {
  const auth=await vault.load(signal);signal.throwIfAborted();gate();
  let remote,pending=null;
  const receive=raw=>{
    if(!pending||signal.aborted)return;
    try{
      const message=JSON.parse(raw.toString()),data=typeof message.data==='string'?JSON.parse(message.data):message.data;
      if(message.event!=='ed.apps.icon'||data?.iconPath!==pending.path)return;
      pending.finish(hubImage(data.imageBase64));
    }catch{}
  };
  try{
    remote=await connect(settings,auth,signal,{socketFactory(url,options){const socket=socketFactory(url,options);socket.on('message',receive);return socket;}});
    gate();const installed=await remote.apps(),result=[];
    for(const name of names){
      signal.throwIfAborted();gate();
      const matches=installed.filter(app=>typeof app.name==='string'&&app.name.trim().toLowerCase()===name.toLowerCase());
      if(matches.length!==1)continue;
      const path=hubPath(matches[0]);if(!path)continue;
      const image=await new Promise(resolve=>{
        let finished=false;
        const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener('abort',abort);pending=null;resolve(value);};
        const abort=()=>finish(null);
        const timer=setTimeout(()=>finish(null),1200);pending={path,finish};signal.addEventListener('abort',abort,{once:true});
        remote.send({method:'ms.channel.emit',params:{event:'ed.apps.icon',to:'host',data:{iconPath:path}}}).catch(()=>finish(null));
      });
      signal.throwIfAborted();gate();if(image)result.push({name,image});
    }
    return result;
  }finally{pending?.finish(null);remote?.close();}
}
