/** Password/session and route boundaries use fresh disposable roots only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {AdminAccess} from '../server/admin-access.mjs';
import {publicAccessRoute,loginReturn} from '../server/access-policy.mjs';
import {createLocalserve} from '../server.mjs';
import {HttpError} from '../server/storage.mjs';
const base=path.resolve('tests/.tmp'),origin='http://127.0.0.1:2345',secret='Synthetic administrator password 123';
const cookie=result=>result.cookie.split(';')[0];
const req=(value='')=>({headers:{cookie:value},socket:{remoteAddress:'127.0.0.1'}});
async function fixture(t,options={}){
 await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'admin-access-'));await fs.mkdir(path.join(root,'data'));
 const access=await new AdminAccess(root,options).load();t.after(async()=>{await access.close();assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});return {root,access};
}
async function enable(access){return access.configure({revision:access.admin().revision,enabled:true,password:secret,name:'Owner browser'},req(),origin);}
async function httpFixture(t){
 await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'access-http-')),options={automatic:false,backupKeyProvider:async()=>Buffer.alloc(32,7)};
 const f={root,options};f.app=await createLocalserve(root,options);t.after(async()=>{await f.app.close();assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});
 f.call=async(endpoint,values,session='',extra={})=>{const response=await fetch(f.app.origin+endpoint,values===undefined?{headers:{Cookie:session,...extra},redirect:'manual'}:{method:'POST',headers:{Origin:f.app.origin,'X-Localserve-Token':f.app.snapshot().token,'Content-Type':'application/json',Cookie:session,...extra},body:JSON.stringify(values),redirect:'manual'});const text=await response.text();return {status:response.status,body:text?JSON.parse(text):null,cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};};
 f.enable=async()=>{const result=await f.call('/api/access/settings',{revision:1,enabled:true,password:secret,name:'Owner browser'});assert.equal(result.status,200);return result.cookie;};return f;
}
test('optional defaults require no password and contain no configured credentials or sessions',async t=>{
 const {access}=await fixture(t);assert.equal(access.enabled(),false);assert.equal(access.require(req(),origin),null);assert.deepEqual(access.status(req(),origin),{enabled:false,authenticated:true});assert.deepEqual(access.admin().sessions,[]);await assert.rejects(access.login({name:'Browser',password:secret},origin,'one'),/switched off/);
});
test('salted password derivation and bearer hashes persist; cookies are HttpOnly, Strict, bounded and origin scoped',async t=>{
 const {access,root}=await fixture(t),enabled=await enable(access),browser=req(cookie(enabled));assert.match(enabled.cookie,/HttpOnly/);assert.match(enabled.cookie,/SameSite=Strict/);assert.match(enabled.cookie,/Max-Age=43200/);const session=access.require(browser,origin);assert.equal(session.name,'Owner browser');assert.throws(()=>access.require(browser,'http://localhost:2345'),error=>error.status===401&&error.authenticationRequired);
 const raw=await fs.readFile(path.join(root,'data/admin-access.json'),'utf8');assert.ok(!raw.includes(secret));assert.ok(!raw.includes(cookie(enabled).split('=')[1]));assert.doesNotMatch(JSON.stringify(access.admin(session.id)),/tokenHash|passwordHash|salt|http:/);
 const reopened=await new AdminAccess(root).load();assert.equal(reopened.require(browser,origin).id,session.id);await reopened.close();
 const second=await fixture(t);assert.notEqual(second.access.cookieName,access.cookieName);assert.equal(access.session(req(cookie(enabled)+'; '+cookie(enabled)),origin),null);
});
test('wrong passwords and invalid changes retain settings; password rotation and explicit disable revoke sessions',async t=>{
 const {access}=await fixture(t),first=await enable(access),one=req(cookie(first)),second=await access.login({password:secret,name:'Second browser'},origin,'two');
 await assert.rejects(access.configure({revision:2,enabled:false,currentPassword:'wrong'},one,origin),/not accepted/);assert.equal(access.enabled(),true);assert.equal(access.admin().sessions.length,2);
 await assert.rejects(access.configure({revision:2,enabled:true,currentPassword:secret,password:'short'},one,origin),/10 to 256/);await assert.rejects(access.configure({revision:1,enabled:false,currentPassword:secret},one,origin),/changed/);
 const changed=await access.configure({revision:2,enabled:true,currentPassword:secret,password:secret+' new'},one,origin);assert.equal(access.session(one,origin),null);assert.equal(access.session(req(cookie(second)),origin),null);assert.equal(access.admin().sessions.length,1);
 const off=await access.configure({revision:3,enabled:false,currentPassword:secret+' new'},req(cookie(changed)),origin);assert.match(off.cookie,/Max-Age=0/);assert.equal(access.enabled(),false);assert.deepEqual(access.store.snapshot().sessions,[]);assert.equal(access.store.snapshot().passwordHash,'');
});
test('session naming is revisioned, revocation is independent, and expired sessions cannot authenticate',async t=>{
 let now=1000;const {access}=await fixture(t,{now:()=>now}),first=await enable(access),one=req(cookie(first)),second=await access.login({password:secret,name:'Tablet <desk>'},origin,'tablet'),two=req(cookie(second));const id=access.require(two,origin).id;
 await access.changeSession({id,revision:1,name:'Tablet & office'},one,origin);assert.equal(access.require(two,origin).name,'Tablet & office');await assert.rejects(access.changeSession({id,revision:1,name:'Stale'},one,origin),/changed/);
 await access.changeSession({id},one,origin,true);assert.equal(access.session(two,origin),null);assert.ok(access.session(one,origin));now+=12*3600000+1;assert.throws(()=>access.require(one,origin),error=>error.status===401);await assert.rejects(access.changeSession({id},two,origin,true),error=>error.status===401);
});
test('failed login work is bounded by per-peer/global rate limits and the concurrent KDF limit',async t=>{
 let now=1000;const {access}=await fixture(t,{now:()=>now});await enable(access);
 for(let i=0;i<10;i++)await assert.rejects(access.login({password:'wrong password',name:'Guess'},origin,'peer'),error=>error.status===401);
 await assert.rejects(access.login({password:secret,name:'Browser'},origin,'peer'),error=>error.status===429);now+=600001;
 const requests=await Promise.allSettled(['a','b','c'].map(ip=>access.login({password:secret,name:ip},origin,ip)));assert.equal(requests.filter(r=>r.status==='fulfilled').length,2);assert.ok(requests.some(r=>r.status==='rejected'&&r.reason.status===429));
 access.globalAttempts={until:now+10000,count:40};await assert.rejects(access.login({password:secret,name:'Browser'},origin,'other'),error=>error.status===429);
});
test('public policy is method-specific and unknown administrative APIs stay private',()=>{
 for(const endpoint of ['/api/display','/api/universe','/api/games/maze']){assert.equal(publicAccessRoute(endpoint,'GET'),true);assert.equal(publicAccessRoute(endpoint,'POST'),false);}
 for(const endpoint of ['/api/state','/api/admin-state','/api/backups','/api/vr-library','/api/home-map/catalogue','/api/home-map/upload','/api/plugins/x/config','/api/calendar-date','/api/future-private-route'])assert.equal(publicAccessRoute(endpoint,'GET'),false);
 assert.equal(publicAccessRoute('/api/control-view/example/remote/run','POST'),true);assert.equal(publicAccessRoute('/api/control-view/example/remote/run','GET'),false);assert.equal(publicAccessRoute('/api/sensors/report','POST'),true);
 for(const value of ['https://evil.example','//evil.example','/api/state','/%2f/evil','/login'])assert.equal(loginReturn(value),'/');assert.equal(loginReturn('/map-editor'),'/map-editor');
});
test('HTTP off behavior remains available; enabling protects private reads/writes and cannot be bypassed with old CSRF tokens',async t=>{
 const f=await httpFixture(t);assert.equal((await f.call('/api/state')).status,200);const oldToken=f.app.snapshot().token,session=await f.enable();
 const status=await f.call('/api/access/status');assert.deepEqual(status.body,{enabled:true,authenticated:false});assert.doesNotMatch(JSON.stringify(status.body),/token|session|name|password|salt/);
 for(const endpoint of ['/api/state','/api/admin-state','/api/backups','/api/vr-library','/api/home-map/catalogue','/api/calendar-date?date=2028-01-01&time=12:00','/api/plugin-preview/unknown/frame.jpg']){const result=await f.call(endpoint);assert.equal(result.status,401,endpoint);assert.equal(result.body.authenticationRequired,true);assert.ok(!JSON.stringify(result.body).includes(oldToken));}
 assert.equal((await f.call('/api/config',{name:'Unauthorized'},'',{'X-Localserve-Token':oldToken})).status,401);const page=await f.call('/devices');assert.equal(page.status,303);assert.match(page.headers.get('location'),/^\/login\?/);
 const authenticated=await f.call('/api/state',undefined,session);assert.equal(authenticated.status,200);assert.ok(authenticated.body.access.currentSessionId);assert.equal((await f.call('/api/config',{name:'Owner edit'},session)).status,200);assert.equal((await f.call('/api/config',{name:'Missing CSRF'},session,{'X-Localserve-Token':''})).status,403);assert.equal((await f.call('/api/config',{name:'Foreign'},session,{Origin:'http://evil.example'})).status,403);
 const wrongPassword=await f.call('/api/access/settings',{revision:2,enabled:false,currentPassword:'wrong'},session);assert.equal(wrongPassword.status,401);assert.equal(wrongPassword.body.authenticationRequired,undefined);assert.equal((await f.call('/api/state',undefined,session)).status,200);
});
test('sign-in preserves public projections and native authorization; private map images require both session and CSRF capability',async t=>{
 const f=await httpFixture(t),session=await f.enable();
 for(const endpoint of ['/api/control-view','/api/phone-home','/api/scene-selector','/api/launcher','/api/control-room','/api/home-map','/api/portal','/api/watch-guide','/api/universe','/api/games/maze']){const result=await f.call(endpoint);assert.notEqual(result.status,401,endpoint);assert.doesNotMatch(JSON.stringify(result.body),/passwordHash|tokenHash|taskActions/);}
 assert.notEqual((await f.call('/api/catalog')).status,401,'Native Go keeps its own bearer gate');assert.equal((await f.call('/api/access/login',{password:secret,name:'Attack'},'',{Origin:'http://evil.example'})).status,403);
 const privileged=[];f.app.homeMap.image=async(id,privateAccess)=>{privileged.push(privateAccess);throw new HttpError(404,'No image');};const image='/api/home-map/image/'+'a'.repeat(64)+'.png';
 await f.call(image,undefined,'',{'X-Localserve-Token':f.app.snapshot().token});await f.call(image,undefined,session,{'X-Localserve-Token':f.app.snapshot().token});assert.deepEqual(privileged,[false,true]);
});
test('a revoked session cannot receive a delayed private response; other sessions remain valid',async t=>{
 const f=await httpFixture(t),first=await f.enable(),second=await f.call('/api/access/login',{password:secret,name:'Second'}),two=second.cookie;let release,entered;
 const ready=new Promise(r=>{entered=r;});f.app.apkLibrary.snapshot=()=>({available:true,lastScan:true});f.app.apkLibrary.art=async()=>{entered();await new Promise(r=>{release=r;});return {type:'image/png',data:Buffer.from('private-image')};};
 const inFlight=f.call('/api/vr-library/art/example.app',undefined,two);await ready;const state=await f.call('/api/state',undefined,first),id=state.body.access.sessions.find(s=>s.name==='Second').id;assert.equal((await f.call('/api/access/revoke',{id},first)).status,200);release();assert.equal((await inFlight).status,401);assert.equal((await f.call('/api/state',undefined,two)).status,401);assert.equal((await f.call('/api/state',undefined,first)).status,200);
});
test('configuration restore preserves current optional sign-in and its sessions',async t=>{
 const f=await httpFixture(t),backup=await f.call('/api/backups/create',{}),session=await f.enable();await f.call('/api/config',{name:'Later configuration'},session);
 const preview=await f.call('/api/backups/preview',{id:backup.body.id},session);await f.call('/api/pause',{paused:true},session);assert.equal((await f.call('/api/backups/restore',{token:preview.body.token},session)).status,200);
 const port=f.app.server.address().port;await f.app.close();f.app=await createLocalserve(f.root,{...f.options,listen:{host:'127.0.0.1',port}});assert.equal((await f.call('/api/state')).status,401);const restored=await f.call('/api/state',undefined,session);assert.equal(restored.status,200);assert.equal(restored.body.config.name,'Sormus');assert.equal(restored.body.paused,true);assert.equal(restored.body.access.enabled,true);
});
test('offline recovery refuses a live folder lock and then disables sign-in without changing Tasks',async t=>{
 const f=await httpFixture(t);await f.enable();await fs.mkdir(path.join(f.root,'server'));for(const name of ['admin-access.mjs','admin-access-cli.mjs','storage.mjs'])await fs.copyFile(path.resolve('server',name),path.join(f.root,'server',name));
 const run=()=>promisify(execFile)(process.execPath,[path.join(f.root,'server/admin-access-cli.mjs'),'--disable'],{windowsHide:true});await assert.rejects(run());assert.equal(f.app.adminAccess.enabled(),true);assert.ok(await fs.stat(path.join(f.root,'data/server.lock')));
 const tasks=await fs.readFile(path.join(f.root,'data/tasks.json'),'utf8');await f.app.close();await run();assert.equal(await fs.readFile(path.join(f.root,'data/tasks.json'),'utf8'),tasks);f.app=await createLocalserve(f.root,f.options);assert.equal(f.app.adminAccess.enabled(),false);assert.deepEqual(f.app.adminAccess.admin().sessions,[]);assert.equal((await f.call('/api/state')).status,200);
});
