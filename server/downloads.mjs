/** Fixed downloadable product files. No request chooses a filesystem path;
 * package metadata is checked against bytes before an attachment is served. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {HttpError} from './storage.mjs';

const version=text=>/^\d+\.\d+\.\d+$/.test(text||'')?text:null;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const widgetVersion=bytes=>version(/<widget\b[^>]*\sversion="([^"]+)"/.exec(bytes.toString('utf8').replace(/<!--[\s\S]*?-->/g,''))?.[1]);
async function contained(root,relative,limit=8*1024*1024) {
  const realRoot=await fs.realpath(root),file=await fs.realpath(path.join(root,relative));
  if(!file.startsWith(realRoot+path.sep))throw Error('File outside product folder.');
  const stat=await fs.stat(file);if(!stat.isFile()||stat.size>limit)throw Error('File exceeds download limit.');
  const bytes=await fs.readFile(file);if(bytes.length>limit)throw Error('File exceeds download limit.');return bytes;
}
function entry(bytes,name) {
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0||bytes.readUInt16LE(end+10)>128)throw Error('Invalid widget archive.');
  let at=bytes.readUInt32LE(end+16);
  for(let n=0;n<bytes.readUInt16LE(end+10);n++){
    if(at+46>bytes.length||bytes.readUInt32LE(at)!==0x02014b50)throw Error('Invalid widget directory.');
    const length=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32);
    if(bytes.subarray(at+46,at+46+length).toString('utf8')===name){
      const size=bytes.readUInt32LE(at+24),packed=bytes.readUInt32LE(at+20),local=bytes.readUInt32LE(at+42),method=bytes.readUInt16LE(at+10);
      if(size>262144||packed>262144||local+30>bytes.length||bytes.readUInt32LE(local)!==0x04034b50||bytes.readUInt16LE(at+8)&1)throw Error('Invalid widget entry.');
      const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
      if(start+packed>bytes.length)throw Error('Incomplete widget entry.');
      const data=bytes.subarray(start,start+packed),result=method===0?data:method===8?inflateRawSync(data,{maxOutputLength:262144}):null;
      if(!result||result.length!==size)throw Error('Unsupported widget entry.');return result;
    }
    at+=46+length+extra+comment;
  }
  throw Error('Missing widget entry.');
}
function crc32(bytes) {let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=value>>>1^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
export function sourceZip(files) {
  const local=[],central=[];let offset=0;
  for(const [name,bytes] of files){
    if(!/^[a-zA-Z0-9._/-]+$/.test(name)||name.split('/').includes('..')||name.startsWith('/'))throw Error('Invalid archive name.');
    const filename=Buffer.from(name),sum=crc32(bytes),header=Buffer.alloc(30),directory=Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(33,12);header.writeUInt32LE(sum,14);header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(filename.length,26);
    directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(33,14);directory.writeUInt32LE(sum,16);directory.writeUInt32LE(bytes.length,20);directory.writeUInt32LE(bytes.length,24);directory.writeUInt16LE(filename.length,28);directory.writeUInt32LE(offset,42);
    local.push(header,filename,bytes);central.push(directory,filename);offset+=header.length+filename.length+bytes.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
const items=[
  {id:'downloads-phone',name:'Sormus Downloads',platform:'Android phone',kind:'APK',file:'downloads.apk',folder:'plugins/downloads-inbox/android',artifact:'sormus-downloads.apk',description:'Send files, magnets and torrent files to your paired PC Downloads folder.'},
  {id:'controller',name:'Controller',platform:'Android phone',kind:'APK',file:'controller.apk',folder:'plugins/sensors/android',artifact:'localserve-sensors.apk',description:'Lights, Tasks, remotes, Cards and optional phone reporting.'},
  {id:'vistas-tv',name:'Sormus Vistas',platform:'Samsung Tizen TV',kind:'Signed widget',file:'vistas.wgt',folder:'tv-tizen',description:'Install with the Tizen SDK and an authorized developer connection.'},
  {id:'vistas-source',name:'Vistas TV source',platform:'Samsung Tizen TV',kind:'Source ZIP',file:'vistas-source.zip',folder:'tv-tizen',description:'Build and sign with your own Tizen SDK and certificate.'},
  {id:'launcher-tv',name:'Sormus Launcher',platform:'Samsung Tizen TV',kind:'Signed widget',file:'sormus-launcher.wgt',folder:'tv-tizen/launcher',description:'TV apps, inputs, displays and published shortcuts. Requires a reachable Sormus PC.'},
  {id:'launcher-source',name:'Sormus Launcher source',platform:'Samsung Tizen TV',kind:'Source ZIP',file:'sormus-launcher-source.zip',folder:'tv-tizen/launcher',description:'Build and sign the launcher using your own Tizen SDK and certificate.'},
  {id:'playstation-tv',name:'PlayStation TV app',platform:'Samsung Tizen TV',kind:'Signed widget',file:'playstation.wgt',folder:'tv-tizen/playstation',description:'The separate PlayStation display app. Requires your TV developer setup.'},
  {id:'playstation-source',name:'PlayStation TV source',platform:'Samsung Tizen TV',kind:'Source ZIP',file:'playstation-source.zip',folder:'tv-tizen/playstation',description:'Source for the PlayStation TV app, including its launcher artwork.'},
  {id:'oculus-go',name:'Oculus Go app',platform:'Oculus Go headset',kind:'APK',file:'oculus-go.apk',folder:'plugins/oculus-go/android',artifact:'localserve-go.apk',description:'The headset library client. Install on Oculus Go, not on your phone.'},
  {id:'apps-script',name:'Google Apps Script relay',platform:'Google Apps Script',kind:'Script',file:'Code.gs',description:'Public relay code without keys. Follow the relay setup guide after downloading.'},
];
const tvFiles=['config.xml','index.html','launch.js','launch.css','url-target.js','pip.js','icon-tv.png','launch-icon.png'];
const psFiles=['config.xml','index.html','launch.js','launch.css','url-target.js','hdmi.js','icon.png','wordmark.png','fonts/Rajdhani-Medium.ttf','fonts/Rajdhani-SemiBold.ttf','fonts/OFL.txt'];
const launcherFiles=['config.xml','index.html','launch.js','launch.css','url-target.js','inputs.js','icons.js','icon-tv.png','launch-icon.png'];
export async function productDownload(root,id) {
  const item=items.find(item=>item.id===id);if(!item)throw new HttpError(404,'Download not found.');
  let bytes,release;
  if(item.artifact){
    const meta=JSON.parse(await contained(root,item.folder+'/dist/verification.json',32768));
    bytes=await contained(root,item.folder+'/dist/'+item.artifact,16*1024*1024);release=version(meta.version);
    const manifest=(await contained(root,item.folder+'/AndroidManifest.xml',32768)).toString('utf8');
    if(!release||meta.sha256!==digest(bytes)||(meta.bytes??meta.size)!==bytes.length||!/android:versionName="([^"]+)"/.exec(manifest)||/android:versionName="([^"]+)"/.exec(manifest)[1]!==release)throw Error('Rebuild the application package.');
  }else if(item.kind==='Signed widget'){
    bytes=await contained(root,item.folder+'/dist/'+(id==='launcher-tv'?'SormusLauncher.wgt':id==='vistas-tv'?'Vista.wgt':'PlayStation.wgt'));
    release=widgetVersion(entry(bytes,'config.xml'));
    if(!release||release!==widgetVersion(await contained(root,item.folder+'/app/config.xml',32768)))throw Error('Rebuild the TV package.');
    entry(bytes,'author-signature.xml');entry(bytes,'signature1.xml');
  }else if(item.kind==='Source ZIP'){
    const files=[];
    for(const file of id==='launcher-source'?launcherFiles:id==='vistas-source'?tvFiles:psFiles){
      let content=await contained(root,item.folder+'/app/'+file,1024*1024);
      if(file==='config.xml'){
        release=widgetVersion(content);
        content=Buffer.from(content.toString('utf8').replace(/<tizen:allow-navigation>[^<]+<\/tizen:allow-navigation>/,'<tizen:allow-navigation>http://*:* https://*:*</tizen:allow-navigation>'));
      }
      if(file==='launch.js')content=Buffer.from(content.toString('utf8').replace(/var defaultUrl = '[^']+';/,"var defaultUrl = 'http://192.0.2.1:7041/"+(id==='vistas-source'?'display':'playstation-mode')+"';"));
      files.push([file,content]);
    }
    files.push(['README.md',await contained(root,item.folder+'/README.md',131072)]);bytes=sourceZip(files);
  }else{
    bytes=await contained(root,'plugins/google-apps-script/server/apps-script/Code.gs',262144);
    release=version(JSON.parse(await contained(root,'plugins/google-apps-script/declaration.json',65536)).version);
  }
  return {id,name:item.name,platform:item.platform,kind:item.kind,description:item.description,filename:item.file,version:release,bytes:bytes.length,sha256:digest(bytes),status:'Ready',available:true,url:'/downloads/'+item.file,
    content:bytes,type:item.kind==='APK'?'application/vnd.android.package-archive':item.kind==='Source ZIP'?'application/zip':item.kind==='Signed widget'?'application/widget':'text/plain; charset=utf-8'};
}
export async function downloadCatalogue(root) {
  return Promise.all(items.map(async item=>{
    try{const {content,type,filename,...metadata}=await productDownload(root,item.id);return metadata;}
    catch{return {id:item.id,name:item.name,platform:item.platform,kind:item.kind,description:item.description,version:null,bytes:null,status:'Not built or unavailable',available:false,url:null};}
  }));
}
export async function serveProductDownload(root,request,response,pathname) {
  const item=items.find(item=>'/downloads/'+item.file===pathname);if(!item)return false;
  if(!['GET','HEAD'].includes(request.method))throw new HttpError(405,'Use a download link.');
  let result;try{result=await productDownload(root,item.id);}catch{throw new HttpError(404,'This package is unavailable or needs rebuilding. Refresh Downloads.');}
  response.writeHead(200,{'Content-Type':result.type,'Content-Length':result.bytes,'Content-Disposition':'attachment; filename="'+result.filename+'"','Cache-Control':'no-store'});
  response.end(request.method==='HEAD'?undefined:result.content);return true;
}
