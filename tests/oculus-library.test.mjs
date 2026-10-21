/** Synthetic APKs and ADB peers exercise package management without a headset. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {generateKeyPairSync} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {ApkCatalog, installable} from '../plugins/oculus-go/server/library.mjs';
import {parseManifest, protectedPackage} from '../plugins/oculus-go/server/apk.mjs';
import {connectAdb, packet} from '../plugins/oculus-go/server/adb.mjs';
import {createOculusAdapter} from '../plugins/oculus-go/server/index.mjs';
import {ApkLibrary, nativeLibraryRoute} from '../server/apk-library.mjs';
import {validateDeclaration} from '../server/plugins.mjs';
import {createLocalserve} from '../server.mjs';

const root = path.resolve(import.meta.dirname,'..');
const declaration = JSON.parse(await fs.readFile(path.join(root,'plugins/oculus-go/declaration.json')));
const pair = generateKeyPairSync('rsa',{modulusLength:2048});
const key = {privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'})};
const settings = {address:'192.168.1.7:5555',serial:'TEST-GO','poll-minutes':.25,'library-enabled':true,'library-folder':'library/oculus-go'};
const cleanups = new Map();
async function temporary(t) {
  const base = path.join(root,'tests/.tmp'); await fs.mkdir(base,{recursive:true});
  const folder = await fs.mkdtemp(path.join(base,'vr-library-'));
  cleanups.set(folder,[]);
  t.after(async () => { for (const close of cleanups.get(folder)) await close(); cleanups.delete(folder); assert.equal(path.dirname(folder),base); await fs.rm(folder,{recursive:true,force:true,maxRetries:5,retryDelay:100}); }); return folder;
}
// A minimal valid Android binary manifest and a stored ZIP avoid external SDK
// tools and exercise the same byte-level reader as real APKs.
export function sampleManifest(packageName='com.example.game',versionCode=7) {
  const strings=[packageName,'manifest','package','versionCode','versionName','1.7','uses-sdk','minSdkVersion','application','label','Example game'];
  const encoded=strings.map(s=>Buffer.concat([Buffer.from([s.length,Buffer.byteLength(s)]),Buffer.from(s),Buffer.from([0])]));
  const pool=Buffer.alloc(28+strings.length*4+encoded.reduce((n,b)=>n+b.length,0));
  pool.writeUInt16LE(1,0);pool.writeUInt16LE(28,2);pool.writeUInt32LE(pool.length,4);pool.writeUInt32LE(strings.length,8);pool.writeUInt32LE(0x100,16);pool.writeUInt32LE(28+strings.length*4,20);
  let offset=0;encoded.forEach((buffer,i)=>{pool.writeUInt32LE(offset,28+i*4);buffer.copy(pool,28+strings.length*4+offset);offset+=buffer.length;});
  const tag=(name,attrs)=>{
    const b=Buffer.alloc(36+attrs.length*20);b.writeUInt16LE(0x102,0);b.writeUInt16LE(16,2);b.writeUInt32LE(b.length,4);b.writeUInt32LE(0xffffffff,12);b.writeUInt32LE(0xffffffff,16);b.writeUInt32LE(strings.indexOf(name),20);b.writeUInt16LE(20,24);b.writeUInt16LE(20,26);b.writeUInt16LE(attrs.length,28);
    attrs.forEach(([name,value],i)=>{const p=36+i*20;b.writeUInt32LE(0xffffffff,p);b.writeUInt32LE(strings.indexOf(name),p+4);b.writeUInt32LE(0xffffffff,p+8);b.writeUInt16LE(8,p+12);b[p+15]=typeof value==='number'?0x10:3;b.writeUInt32LE(typeof value==='number'?value:strings.indexOf(value),p+16);});return b;
  };
  const chunks=[pool,tag('manifest',[['package',packageName],['versionCode',versionCode],['versionName','1.7']]),tag('uses-sdk',[['minSdkVersion',23]]),tag('application',[['label','Example game']])];
  const header=Buffer.alloc(8);header.writeUInt16LE(3);header.writeUInt16LE(8,2);header.writeUInt32LE(8+chunks.reduce((n,b)=>n+b.length,0),4);return Buffer.concat([header,...chunks]);
}
export function sampleApk(packageName,versionCode) {
  const name=Buffer.from('AndroidManifest.xml'),xml=sampleManifest(packageName,versionCode),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt32LE(xml.length,18);local.writeUInt32LE(xml.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt32LE(xml.length,20);central.writeUInt32LE(xml.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+xml.length,16);
  return Buffer.concat([local,name,xml,central,name,end]);
}
test('APK manifest bounds, compatibility and protected packages are explicit',()=>{
  assert.equal(parseManifest(sampleManifest()).packageName,'com.example.game');
  assert.equal(parseManifest(sampleManifest()).minSdk,23);
  const bad=sampleManifest();bad.writeUInt32LE(0xffffffff,4);assert.throws(()=>parseManifest(bad),/manifest/);
  for(const name of ['android','com.android.settings','com.oculus.home','com.tommi.homevr','bad;reboot','org.openpacific.home'])assert.equal(protectedPackage(name),true);
  assert.throws(()=>installable({packageName:'com.example.game',minSdk:26}),/compatibility/);
  assert.throws(()=>installable({packageName:'com.example.game',minSdk:23,nativeCode:'arm64-v8a'}),/compatibility/);
  installable({packageName:'com.example.game',minSdk:23,nativeCode:'armeabi-v7a, arm64-v8a'});
});
test('catalogue groups versions, preserves metadata, refuses changed files and does not follow links',async t=>{
  const folder=await temporary(t),library=path.join(folder,'library');await fs.mkdir(library);
  await fs.writeFile(path.join(library,'game.apk'),sampleApk());await fs.writeFile(path.join(library,'new.apk'),sampleApk(undefined,8));await fs.writeFile(path.join(library,'invalid.apk'),'not a zip');
  const catalog=new ApkCatalog(folder,'library');await catalog.scan();
  assert.equal(catalog.apps.length,1);assert.equal(catalog.apps[0].versions[0].versionCode,8);assert.equal(catalog.errors.length,1);
  const id=catalog.apps[0].versions[1].id;const info=await catalog.fileInfo(id);assert.match(info.sha256,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(catalog.snapshot()).includes(folder));
  await fs.appendFile(path.join(library,'game.apk'),'changed');await assert.rejects(catalog.open(id),/changed/);
  await assert.rejects(catalog.open('../config.json'),/current library/);
  await fs.symlink(library,path.join(folder,'linked'),'junction');await assert.rejects(new ApkCatalog(folder,'linked').scan(),/regular/);
});
test('extended deadlines are Settings-only and package actions are not Task capabilities',()=>{
  assert.equal(validateDeclaration(declaration).actions.find(a=>a.id==='library-install').timeoutSeconds,1200);
  const invalid=structuredClone(declaration);invalid.actions[0].timeoutSeconds=60;assert.throws(()=>validateDeclaration(invalid),/Settings-only/);
});
test('adapter verifies serial, signature-safe replacement and post-install version; rejects downgrade and system removal',async t=>{
  const folder=await temporary(t);await fs.mkdir(path.join(folder,'library/oculus-go'),{recursive:true});await fs.writeFile(path.join(folder,'library/oculus-go/game.apk'),sampleApk());
  const index=new ApkCatalog(folder,'library/oculus-go');await index.scan();const id=index.apps[0].versions[0].id;
  let identity='TEST-GO',version=6,system=false,effects=0,closed=0;
  const adapter=createOculusAdapter({root:folder,vault:{load:async()=>key},connect:async()=>({close(){closed++;},read:async()=>identity,packages:async()=>['com.example.game'],packageInfo:async()=>({versionCode:version,system}),async install(source){effects++;for await(const chunk of source)assert.ok(chunk.length);version=7;},async uninstall(){effects++;}})});
  await adapter.start(settings);const context={signal:new AbortController().signal,wait:async seconds=>{assert.ok(seconds>0&&seconds<=10);}};
  identity='OTHER';await assert.rejects(adapter.execute('library-install',{id},context),/serial/);assert.equal(effects,0);
  identity='TEST-GO';version=9;await assert.rejects(adapter.execute('library-install',{id},context),/newer/);assert.equal(effects,0);
  version=6;const result=await adapter.execute('library-install',{id},context);assert.equal(result.installed,true);assert.equal(effects,1);
  system=true;await assert.rejects(adapter.execute('library-uninstall',{package:'com.example.game'},context),/user applications/);assert.equal(effects,1);assert.equal(closed,4);
});
test('package transport sends bounded streamed APK frames and fixed services; default connection remains read-only',async t=>{
  const sockets=new Set(),services=[],payload=Buffer.alloc(12000,42);let received=0,streamId=0,installing=false;
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});let input=Buffer.alloc(0);
    socket.on('data',chunk=>{input=Buffer.concat([input,chunk]);while(input.length>=24&&input.length>=24+input.readUInt32LE(12)){
      const name=input.toString('ascii',0,4),id=input.readUInt32LE(4),size=input.readUInt32LE(12),data=Buffer.from(input.subarray(24,24+size));input=input.subarray(24+size);
      if(name==='CNXN')socket.write(packet('CNXN',0x01000000,4096,'device::\0'));
      if(name==='OPEN'){const service=data.toString().replace(/\0$/,'');services.push(service);streamId=id;installing=service.startsWith('exec:cmd package install');socket.write(packet('OKAY',99,id));if(!installing)socket.write(packet('WRTE',99,id,'package:com.example.game\n'));}
      if(name==='WRTE'){assert.ok(size<=4096);received+=size;socket.write(packet('OKAY',99,id));if(received===payload.length)socket.write(packet('WRTE',99,id,'Success\n'));}
      if(name==='OKAY')socket.write(packet('CLSE',99,streamId));
    }});
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
  const options={management:true,socketFactory:()=>net.createConnection({host:'127.0.0.1',port:server.address().port})};
  const connection=await connectAdb(settings.address,key,new AbortController().signal,options);
  assert.deepEqual(await connection.packages(),['com.example.game']);await connection.install((async function*(){yield payload;})(),payload.length,async()=>{});connection.close();
  assert.equal(received,payload.length);assert.deepEqual(services,['shell:pm list packages -3','exec:cmd package install -r -S 12000']);
  const diagnostic=await connectAdb(settings.address,key,new AbortController().signal,{...options,management:false});assert.equal(diagnostic.install,undefined);diagnostic.close();
});

async function hostFixture(t) {
  const folder=await temporary(t);await fs.mkdir(path.join(folder,'library/oculus-go'),{recursive:true});await fs.writeFile(path.join(folder,'library/oculus-go/game.apk'),sampleApk());
  let revision=1,enabled=true,completion,started=0;
  const config=()=>({revision,enabled,settings:{...settings,'home-vr-enabled':true}});
  const record={plugin:{actions:[{id:'library-install'}]},config:{snapshot:config}};
  const registry={records:new Map([['oculus-go',record]]),engine:{gate:{paused:false}},async execute(id,action,params,context){
    if(action==='library-inspect')return {packageName:params.package,versionCode:7};if(action==='library-inventory')return {packages:['com.example.game']};
    started++;return new Promise((resolve,reject)=>{completion=resolve;context.signal.addEventListener('abort',()=>reject(context.signal.reason),{once:true});});
  }};
  const library=await new ApkLibrary(folder,registry,{vault:{load:async()=>({token:'example-native-token-not-a-real-key'})}}).load();await library.catalog().scan();cleanups.get(folder).push(()=>library.close());
  return {library,registry,record,change(){revision++;},disable(){enabled=false;},get started(){return started;},finish(){completion({installed:true});}};
}
test('durable job claim is unique, cancellable and not replayed after recovery',async t=>{
  const f=await hostFixture(t),id=f.library.catalog().apps[0].versions[0].id;
  const first=await f.library.start({id},1);while(!f.started)await new Promise(resolve=>setTimeout(resolve,5));
  await assert.rejects(f.library.start({id},1),/already/);assert.equal(f.library.snapshot().job.state,'Installing');
  f.library.cancel(first.job.id);await assert.rejects(first.completion,/Cancelled/);assert.equal(f.library.snapshot().job.state,'Failed');assert.equal(f.started,1);
  await f.library.store.update(value=>{value.job.state='Installing';});
  const recovered=await new ApkLibrary(f.library.root,f.registry).load();assert.equal(recovered.store.snapshot().job.state,'Failed');assert.match(recovered.store.snapshot().job.error,/Interrupted/);assert.equal(f.started,1);await recovered.close();
});
test('uninstall confirmations are single-use, expiring and bound to current plugin settings',async t=>{
  const f=await hostFixture(t);const prepared=await f.library.prepareUninstall('com.example.game',1);
  f.change();await assert.rejects(f.library.start({packageName:'com.example.game',confirmation:prepared.confirmation},2),/confirmation/);assert.equal(f.started,0);
  const current=await f.library.prepareUninstall('com.example.game',2);
  const job=await f.library.start({packageName:'com.example.game',confirmation:current.confirmation},2);
  while(!f.started)await new Promise(resolve=>setTimeout(resolve,5));f.finish();await job.completion;
  await assert.rejects(f.library.start({packageName:'com.example.game',confirmation:current.confirmation},2),/confirmation/);
  await assert.rejects(f.library.prepareUninstall('com.tommi.homevr',2),/protected/);
});
test('native authorization requires matching token, local peer and no browser Origin',async t=>{
  const f=await hostFixture(t),request={headers:{authorization:'Bearer example-native-token-not-a-real-key'},socket:{remoteAddress:'192.168.1.20'}};
  assert.equal(await f.library.authenticate(request),1);
  await assert.rejects(f.library.authenticate({...request,headers:{...request.headers,origin:'http://example.org'}}),/not available/);
  await assert.rejects(f.library.authenticate({...request,socket:{remoteAddress:'8.8.8.8'}}),/not available/);
  await assert.rejects(f.library.authenticate({...request,headers:{authorization:'Bearer incorrect-token-value'}}),/does not match/);
  assert.equal(nativeLibraryRoute('/api/shutdown'),false);assert.equal(nativeLibraryRoute('/api/state'),false);assert.equal(nativeLibraryRoute('/api/device/install'),true);
});
test('library forms keep named controls separate from form identity and manual review is not a definition draft',async()=>{
  const ui=await fs.readFile(path.join(root,'web/vr-library-ui.js'),'utf8');
  const app=await fs.readFile(path.join(root,'web/app.js'),'utf8');
  assert.ok(ui.includes('name="fileId"'));assert.ok(!ui.includes('name="id"'));
  assert.ok(ui.includes('context.submitted = true'));assert.ok(ui.includes('form.isConnected'));
  assert.ok(app.includes("'vr-install', 'vr-uninstall'].includes(dialogContext?.kind)"));
});
test('HTTP endpoints isolate native bearer writes from Origin/CSRF-protected administrator operations',async t=>{
  const folder=await temporary(t),plugin=path.join(folder,'plugins/oculus-go');await fs.mkdir(path.join(plugin,'server'),{recursive:true});
  await fs.writeFile(path.join(plugin,'declaration.json'),JSON.stringify(declaration));
  const adapterUrl=pathToFileURL(path.join(root,'plugins/oculus-go/server/index.mjs')).href;
  await fs.writeFile(path.join(plugin,'server/index.mjs'),`import {createOculusAdapter} from ${JSON.stringify(adapterUrl)};
    import {generateKeyPairSync} from 'node:crypto';
    const pair=generateKeyPairSync('rsa',{modulusLength:2048});const key={privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'})};let installed=false;
    export default createOculusAdapter({root:${JSON.stringify(folder)},credentialReady:async()=>true,vault:{load:async()=>key},connect:async()=>({
      close(){},read:async()=>'TEST-GO',packages:async()=>installed?['com.example.game']:[],packageInfo:async()=>installed?{versionCode:7,system:false}:null,
      async install(stream){for await(const chunk of stream){if(!chunk.length)throw Error('Empty transfer');}installed=true;},async uninstall(){installed=false;}
    })});`);
  await fs.mkdir(path.join(folder,'web'),{recursive:true});await fs.copyFile(path.join(root,'web/index.html'),path.join(folder,'web/index.html'));await fs.copyFile(path.join(root,'web/vr-library-ui.js'),path.join(folder,'web/vr-library-ui.js'));
  const app=await createLocalserve(folder,{automatic:false});cleanups.get(folder).push(()=>app.close());
  await app.registry.saveConfiguration('oculus-go',{revision:1,enabled:true,settings:{...settings,'home-vr-enabled':true}});
  app.apkLibrary.vault={load:async()=>({token:'example-native-token-not-a-real-key'})};
  const state=app.snapshot(),revision=state.services[0].config.revision;
  const request=(route,body,headers={})=>fetch(app.origin+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
  assert.equal((await request('/api/catalog')).status,401);
  const native={Authorization:'Bearer example-native-token-not-a-real-key'};
  assert.equal((await request('/api/catalog',null,native)).status,200);
  assert.equal((await request('/api/catalog',null,{...native,Origin:app.origin})).status,403);
  await fs.mkdir(path.join(folder,'library/oculus-go'),{recursive:true});
  const bytes=sampleApk();await fs.writeFile(path.join(folder,'library/oculus-go/game.apk'),bytes);await app.apkLibrary.catalog().scan();
  const fileId=app.apkLibrary.catalog().apps[0].versions[0].id;
  const info=await request('/api/file/'+fileId,null,native);assert.equal(info.status,200);assert.equal((await info.json()).size,bytes.length);
  const download=await request('/api/download/'+fileId,null,{...native,Range:'bytes=0-9'});assert.equal(download.status,206);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes.subarray(0,10));
  assert.equal((await request('/api/download/'+fileId,null,{...native,Range:'bytes=100000-100001'})).status,416);
  assert.equal((await request('/api/vr-library/inventory',{revision},native)).status,403);
  const admin={Origin:app.origin,'x-localserve-token':state.token};
  assert.equal((await request('/api/vr-library/inventory',{revision},admin)).status,200);
  assert.equal((await request('/api/vr-library/install',{revision,id:fileId},admin)).status,200);
  await app.apkLibrary.active?.promise;assert.equal(app.apkLibrary.store.snapshot().job.state,'Installed');
  const prepare=await request('/api/device/uninstall/prepare',{packageName:'com.example.game'},native);assert.equal(prepare.status,200);
  const confirmation=(await prepare.json()).confirmation;
  const removal=await request('/api/device/uninstall',{packageName:'com.example.game',confirmation},native);assert.equal(removal.status,200);assert.equal((await removal.json()).uninstalled,true);
  assert.equal((await request('/api/plugins/oculus-go/actions/library-uninstall',{revision,parameters:{package:'com.example.game'}},admin)).status,400);
  assert.equal((await request('/vr-library')).status,200);assert.equal((await request('/vr-library-ui.js')).status,200);
  assert.ok(!app.registry.actions().some(action=>action.id?.includes('library-')||action.actionId?.includes('library-')));
});
