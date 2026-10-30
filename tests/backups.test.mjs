/** Private snapshots and recovery are exercised only in disposable roots. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Backups} from '../server/backups.mjs';
import {createLocalserve,defaultConfig,serverVersion} from '../server.mjs';

const temporary=path.resolve('tests/.tmp'),key=Buffer.alloc(32,19),keyProvider=async()=>key;
async function fixture(t,options={}){
 await fs.mkdir(temporary,{recursive:true});const root=await fs.mkdtemp(path.join(temporary,'backups-'));
 const write=async(name,value)=>{await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),typeof value==='string'?value:JSON.stringify(value));};
 await write('config.json',{...defaultConfig,name:'Saved home'});
 await write('data/tasks.json',[{id:'task',revision:2,name:'Saved Task',enabled:true,starts:[],steps:[{id:'log',type:'log',enabled:true,message:'Saved message'}]}]);
 await write('data/state.json',{paused:false,plugins:{example:{enabled:true}},runs:[],claims:['durable-current-claim']});
 await write('data/home-map.json',{revision:7,markers:[{id:'owner-marker'}]});
 await write('plugins/example/declaration.json',{id:'example',version:'1.0.0'});
 await write('plugins/example/data/config.json',{revision:3,enabled:true,settings:{token:'SECRET-PRIVATE-TOKEN'}});
 await write('plugins/example/data/credentials.dpapi','opaque-credential');
 await write('plugins/example/data/state.json',{cursor:'do-not-rewind'});
 const backups=await new Backups(root,serverVersion,{keyProvider,...options}).load();
 t.after(async()=>{assert.ok(root.startsWith(temporary+path.sep));await fs.rm(root,{recursive:true,force:true});});
 return {root,write,backups,read:async name=>JSON.parse(await fs.readFile(path.join(root,name),'utf8'))};
}
test('encrypted snapshots verify settings, credentials and map while excluding runtime receipts and code',async t=>{
 const f=await fixture(t),before=await f.backups.stable(),item=await f.backups.create();
 const raw=await fs.readFile(path.join(f.root,'data/backups',item.id+'.snapshot'),'utf8');assert.doesNotMatch(raw,/SECRET-PRIVATE-TOKEN|owner-marker|opaque-credential|Saved home/);
 const {payload}=await f.backups.open(item.id);assert.deepEqual(payload,before);assert.ok(payload.files.some(file=>file.path==='plugins/example/data/credentials.dpapi'));
 assert.ok(!payload.files.some(file=>file.path.endsWith('state.json')||file.path.endsWith('.mjs')));assert.deepEqual(await f.backups.stable(),before);
 assert.equal(f.backups.snapshot().items.length,1);assert.equal(f.backups.snapshot().settings.keepAutomatic,5);
});
test('authenticated metadata, ciphertext, wrong keys, and unsafe identifiers fail without applying files',async t=>{
 const f=await fixture(t),item=await f.backups.create(),name='data/backups/'+item.id+'.snapshot',saved=await f.read(name);
 for(const change of [v=>v.meta.kind='before-update',v=>v.data=v.data.slice(0,-4)+'AAAA',v=>v.tag='0'.repeat(32)]){
  const damaged=structuredClone(saved);change(damaged);await f.write(name,damaged);await assert.rejects(f.backups.open(item.id),/integrity/);
 }
 await f.write(name,saved);const other=await new Backups(f.root,serverVersion,{keyProvider:async()=>Buffer.alloc(32,3)}).load();await assert.rejects(other.open(item.id),/integrity/);
 for(const id of ['../config','C:/private','not-a-backup',undefined])await assert.rejects(f.backups.preview(id));
 assert.equal((await f.read('config.json')).name,'Saved home');assert.equal(f.backups.pending,null);
});
test('Windows account protection can unlock a snapshot in a new manager without storing a raw key',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t,{keyProvider:undefined}),item=await f.backups.create();
 const protectedKey=await fs.readFile(path.join(f.root,'data/backups/key.dpapi'));assert.notEqual(protectedKey.length,32);
 const reopened=await new Backups(f.root,serverVersion).load();assert.equal((await reopened.open(item.id)).meta.id,item.id);
 await fs.rm(path.join(f.root,'data/backups/key.dpapi'));const missing=await new Backups(f.root,serverVersion).load();await assert.rejects(missing.key(),/key is missing/);
});
test('preview is read only, bounded to current settings, expires and cannot be reused after changes',async t=>{
 let now=1000;const f=await fixture(t,{now:()=>now}),item=await f.backups.create();await f.write('config.json',{...defaultConfig,name:'Current home'});
 const preview=await f.backups.preview(item.id);assert.ok(preview.changes.some(change=>change.path==='config.json'&&change.change==='replace'));assert.doesNotMatch(JSON.stringify(preview),/SECRET-PRIVATE-TOKEN/);assert.equal((await f.read('config.json')).name,'Current home');assert.equal(f.backups.pending,null);
 await f.write('data/tasks.json',[]);await assert.rejects(f.backups.stage(preview.token),/changed/);await assert.rejects(f.backups.stage(preview.token),/Preview/);
 const fresh=await f.backups.preview(item.id);now+=300001;await assert.rejects(f.backups.stage(fresh.token),/Preview/);
});
test('restore saves a safety snapshot, stages without replacing data, disables effects and retains current receipts',async t=>{
 const f=await fixture(t),item=await f.backups.create();await f.write('config.json',{...defaultConfig,name:'Current home'});await f.write('plugins/example/data/state.json',{cursor:'newest-cursor'});
 const preview=await f.backups.preview(item.id),staged=await f.backups.stage(preview.token);assert.equal(staged.restartRequired,true);assert.equal((await f.read('config.json')).name,'Current home');assert.equal(f.backups.items.find(i=>i.id===staged.safetyId).kind,'before-restore');
 await assert.rejects(f.backups.remove(item.id),/pending/);await assert.rejects(f.backups.create(),/pending/);
 const restart=await new Backups(f.root,serverVersion,{keyProvider}).load();assert.equal(await restart.applyPending(),true);
 assert.equal((await f.read('config.json')).name,'Saved home');assert.equal((await f.read('data/tasks.json'))[0].enabled,false);assert.equal((await f.read('plugins/example/data/config.json')).enabled,false);
 const state=await f.read('data/state.json');assert.equal(state.paused,true);assert.deepEqual(state.claims,['durable-current-claim']);assert.equal(state.plugins.example.enabled,false);assert.equal((await f.read('plugins/example/data/state.json')).cursor,'newest-cursor');assert.equal((await f.read('data/home-map.json')).markers[0].id,'owner-marker');
 assert.equal(await restart.applyPending(),false);assert.equal(restart.pending,null);
});
test('interrupted restore rolls forward deterministically before runtime loading; cancel never partly restores',async t=>{
 let fail=true;const f=await fixture(t,{failAfterWrite:async count=>{if(count===2&&fail){fail=false;throw Error('simulated power loss');}}}),item=await f.backups.create();await f.write('config.json',{...defaultConfig,name:'Newer'});
 const preview=await f.backups.preview(item.id);await f.backups.stage(preview.token);await assert.rejects(f.backups.applyPending(),/power loss/);assert.equal((await f.read('data/backups/restore.json')).phase,'applying');await assert.rejects(f.backups.cancel(),/started/);
 const restart=await new Backups(f.root,serverVersion,{keyProvider}).load();await restart.applyPending();assert.equal((await f.read('config.json')).name,'Saved home');assert.equal((await f.read('data/tasks.json'))[0].enabled,false);
 const next=await restart.preview(item.id);await restart.stage(next.token);const before=await restart.stable();await restart.cancel();assert.deepEqual(await restart.stable(),before);assert.equal(restart.pending,null);
});
test('automatic retention removes only automatic snapshots and updates can be opted out',async t=>{
 let now=1000;const f=await fixture(t,{now:()=>now++}),manual=await f.backups.create();
 await f.backups.saveSettings({beforeUpdates:true,keepAutomatic:2});for(let i=0;i<4;i++)await f.backups.create('before-update');
 assert.equal(f.backups.items.filter(i=>i.kind==='before-update').length,2);assert.ok(f.backups.items.some(i=>i.id===manual.id));
 await f.backups.beforeStartup();await f.write('data/backups/version.json',{version:'0.1.0'});await f.backups.beforeStartup();assert.ok(f.backups.items.some(i=>i.version==='0.1.0'));
 await f.backups.saveSettings({beforeUpdates:false,keepAutomatic:1});const count=f.backups.items.length;await f.write('data/backups/version.json',{version:'0.2.0'});await f.backups.beforeStartup();assert.equal(f.backups.items.length,count);
 for(const keepAutomatic of [0,51,2.5])await assert.rejects(f.backups.saveSettings({beforeUpdates:true,keepAutomatic}));
});
test('linked directories and forged archive paths cannot escape the installation',async t=>{
 const f=await fixture(t);await fs.mkdir(path.join(f.root,'external'));await fs.mkdir(path.join(f.root,'plugins/example/data/link-target'));
 await fs.rm(path.join(f.root,'plugins/example/data'),{recursive:true});await fs.symlink(path.join(f.root,'external'),path.join(f.root,'plugins/example/data'),'junction');await assert.rejects(f.backups.create(),/linked/);
 const payload={versions:{},files:[{path:'../config.json',sha256:'0'.repeat(64),data:''}]};assert.throws(()=>f.backups.validatePayload(payload,1),/Invalid/);
 for(const value of ['../data','C:/else','data/../config.json','data\\config.json'])await assert.rejects(f.backups.safe(value));
});
test('changing versions or editing a staged restore refuses application before replacing definitions',async t=>{
 const f=await fixture(t),item=await f.backups.create();await f.write('plugins/example/declaration.json',{id:'example',version:'2.0.0'});await assert.rejects(f.backups.preview(item.id),/versions differ/);
 await f.write('plugins/example/declaration.json',{id:'example',version:'1.0.0'});const preview=await f.backups.preview(item.id);await f.backups.stage(preview.token);await f.write('config.json',{...defaultConfig,name:'External change'});
 const restart=await new Backups(f.root,serverVersion,{keyProvider}).load();await assert.rejects(restart.applyPending(),/Settings changed/);assert.equal((await f.read('config.json')).name,'External change');await restart.cancel();
});
test('restore removal intent must match its authenticated safety snapshot',async t=>{
 const f=await fixture(t),item=await f.backups.create(),preview=await f.backups.preview(item.id);await f.backups.stage(preview.token);
 const journal=await f.read('data/backups/restore.json');journal.removals=['config.json'];await f.write('data/backups/restore.json',journal);
 const restart=await new Backups(f.root,serverVersion,{keyProvider}).load();await assert.rejects(restart.applyPending(),/authenticated safety/);assert.equal((await f.read('config.json')).name,'Saved home');
});
test('HTTP requires token and Origin, refuses active/unpaused restores, locks editing pending restore, and restarts safely',async t=>{
 await fs.mkdir(temporary,{recursive:true});const root=await fs.mkdtemp(path.join(temporary,'backup-http-'));let app=await createLocalserve(root,{automatic:false,backupKeyProvider:keyProvider});
 t.after(async()=>{await app.close();assert.ok(root.startsWith(temporary+path.sep));await fs.rm(root,{recursive:true,force:true});});
 const post=async(endpoint,values,headers={})=>{const response=await fetch(app.origin+endpoint,{method:'POST',headers:{Origin:app.origin,'X-Localserve-Token':app.snapshot().token,'Content-Type':'application/json',...headers},body:JSON.stringify(values)});return {status:response.status,body:await response.json()};};
 assert.equal((await post('/api/backups/create',{}, {'X-Localserve-Token':'bad'})).status,403);assert.equal((await post('/api/backups/create',{}, {Origin:'http://evil.example'})).status,403);
 assert.equal((await post('/api/backups/create',{path:'../anything'})).status,400);
 assert.equal((await fetch(app.origin+'/data/backups/key.dpapi')).status,404);assert.equal((await fetch(app.origin+'/api/backups/restore')).status,405);
 const created=await post('/api/backups/create',{});assert.equal(created.status,200);await post('/api/config',{name:'Changed after backup'});const preview=await post('/api/backups/preview',{id:created.body.id});assert.equal(preview.status,200);
 assert.equal((await post('/api/backups/restore',{token:preview.body.token})).status,409);await post('/api/pause',{paused:true});assert.equal((await post('/api/backups/restore',{token:preview.body.token})).status,200);
 assert.equal((await post('/api/config',{name:'Too late'})).status,409);assert.equal((await post('/api/pause',{paused:false})).status,409);assert.equal(app.config.snapshot().name,'Changed after backup');
 await app.close();app=await createLocalserve(root,{automatic:false,backupKeyProvider:keyProvider});assert.equal(app.config.snapshot().name,'Sormus');assert.equal(app.engine.gate.paused,true);assert.equal(app.backups.pending,null);assert.equal(app.engine.active.size,0);
});
