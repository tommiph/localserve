/** Run only against a disposable extracted release. The bundled Node is used by
 * the caller; no installed settings, tray, Windows startup or provider is used. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = path.resolve(process.argv[2]);
const permission = path.join(root, '..', '.distribution-verification');
assert.equal(await fs.readFile(permission,'utf8'),'disposable distribution verification\n');
assert.equal(path.basename(root),'Localserve');
assert.equal(await fs.stat(path.join(root,'data')).then(()=>true,()=>false),false);
const {createLocalserve} = await import(pathToFileURL(path.join(root,'server.mjs')).href);
const app = await createLocalserve(root, {automatic:false});
let result;
try {
  const response = await fetch(app.origin+'/api/state');
  assert.equal(response.status,200);
  const snapshot = await response.json();
  assert.equal(snapshot.config.listen.host,'127.0.0.1');
  assert.equal(snapshot.config.listen.port,0);
  assert.equal(snapshot.config.location,null);
  assert.equal(snapshot.config.name,'Sormus');
  assert.equal(snapshot.config.theme,'dark');
  assert.equal(snapshot.config.displayTheme,'dark');
  assert.equal(snapshot.config.fontScale,100);
  assert.equal(snapshot.config.vistaFontScale,100);
  assert.equal(snapshot.config.timeFormat,'24');
  assert.equal(snapshot.config.activityRetentionDays,30);
  assert.equal(snapshot.config.doNotDisturb.enabled,false);
  assert.equal(snapshot.config.doNotDisturb.scheduleEnabled,false);
  assert.equal(snapshot.paused,false);
  assert.equal(snapshot.tasks.length,0);
  assert.equal(snapshot.vistas.length,0);
  assert.equal(snapshot.controls.flatMap(plugin => plugin.pages).length,0);
  assert.equal(snapshot.runs.length,0);
  assert.equal(snapshot.demo.status,'not-installed');
  assert.equal(snapshot.demo.available,true);
  assert.equal(await fs.stat(path.join(root,'data/demo.json')).then(()=>true,()=>false),false);
  assert.equal(snapshot.server.discoveryErrors.length,0);
  assert.equal(snapshot.vistaDisplay.vistaId,null);
  assert.equal(snapshot.universe.world,'space');
  assert.deepEqual(snapshot.universe.cards,[]);
  assert.equal(snapshot.games.startSize,5);
  assert.equal(snapshot.games.revision,1);
  assert.equal(snapshot.games.musicUrl,'');
  const game=await fetch(app.origin+'/api/games/maze').then(response=>response.json());
  assert.equal(game.settings.musicUrl,'');
  assert.equal(game.token,undefined);
  const folders = await fs.readdir(path.join(root,'plugins'));
  const expectedPlugins = [];
  for (const folder of folders) if (await fs.stat(path.join(root,'plugins',folder,'declaration.json')).then(()=>true,()=>false)) expectedPlugins.push(folder);
  assert.deepEqual(snapshot.services.map(plugin=>plugin.id).sort(),expectedPlugins.sort());
  let designs = 0;
  for (const service of snapshot.services) {
    assert.equal(service.enabled,false,service.id);
    assert.equal(service.error,'',service.id);
    assert.equal(service.cards.length,0,service.id);
    assert.deepEqual(service.pluginState,{},service.id);
    assert.equal(service.lastPollAt,null,service.id);
    assert.equal(service.config.revision,1,service.id);
    function settings(fields, values) {
      for (const field of fields) {
        const value = values[field.id];
        if (field.format === 'secret') assert.ok(!value,service.id+' has a nonblank secret');
        if (field.type === 'list') assert.deepEqual(value,[],service.id+' has named source entries');
      }
    }
    settings(service.settings,service.config.settings);
    if (service.id === 'tradfri') assert.equal(service.config.settings['fade-seconds'],0.4);
    for (const template of service.cardTemplates) {
      designs++;
      for (const asset of template.assets) {
        const reply = await fetch(app.origin+`/plugin-card-assets/${service.id}/${template.id}/${asset}`);
        assert.equal(reply.status,200,service.id+'/'+asset);
        if (asset.endsWith('.html')) assert.match(reply.headers.get('content-security-policy'),/script-src 'none'/);
        await reply.arrayBuffer();
      }
    }
  }
  const index = await fetch(app.origin+'/');
  assert.equal(index.status,200);
  const html = await index.text();
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const url = new URL(match[1],app.origin+'/');
    if (url.origin !== app.origin) continue;
    const asset = await fetch(url);
    assert.equal(asset.status,200,url.pathname);
    await asset.arrayBuffer();
  }
  assert.equal((await fetch(app.origin+'/display')).status,200);
  // Exercise the other shared entry points' local styles/scripts/icons as well
  // as administration. Merely reading these pages cannot issue device actions.
  for (const page of ['/controls','/display','/universe','/games/maze','/sensors','/assets/notices/notice.html']) {
    const response = await fetch(app.origin+page);
    assert.equal(response.status,200,page);
    for (const match of (await response.text()).matchAll(/(?:src|href)="([^"#]+)"/g)) {
      const url = new URL(match[1],app.origin+page);
      if (url.origin !== app.origin) continue;
      const asset = await fetch(url);
      assert.equal(asset.status,200,url.pathname);
      await asset.arrayBuffer();
    }
  }
  const apk = await fetch(app.origin+'/downloads/localserve-sensors.apk');
  assert.equal(apk.status,200);
  assert.ok((await apk.arrayBuffer()).byteLength>1000000);
  for (const file of ['/assets/pages/solar-system.html','/assets/pages/scifi.html']) {
    assert.equal((await fetch(app.origin+file)).status,200,file);
  }
  assert.equal((await fetch(app.origin+'/assets/scifi.html')).status,404);
  for (const file of ['/config.json','/data/tasks.json','/data/tray-server.json','/plugins/emby/data/config.json','/plugins/tradfri/data/credentials.dpapi']) {
    assert.equal((await fetch(app.origin+file)).status,404,file);
  }
  result = {started:true,plugins:snapshot.services.length,disabledPlugins:snapshot.services.filter(p=>!p.enabled).length,
    readyMadeDesigns:designs,tasks:0,vistas:0,cards:0,controls:0,privateRoutesBlocked:true,administratorAssets:true,providerActionsRun:0,
    node:process.version,architecture:process.arch};
} finally {
  await app.close();
}
assert.equal(await fs.stat(path.join(root,'data/server.lock')).then(()=>true,()=>false),false);

// Exercise the shipped executable with its own extracted installation identity.
// No visible tray, startup registration, provider action or installed service is
// used. Stop always targets only the authenticated pipe for this disposable root.
const execute = promisify(execFile);
await execute(path.join(root,'runtime/node.exe'),['tools/install-control-examples.mjs'],{cwd:root,windowsHide:true});
const examples=[];
for(const id of ['samsung-tv','tradfri']){
  const file=path.join(root,'plugins',id,'data/controls.json'),bytes=await fs.readFile(file,'utf8'),saved=JSON.parse(bytes);
  assert.equal(saved.pages.length,1);assert.equal(saved.pages[0].enabled,false);examples.push({file,bytes});
}
await execute(path.join(root,'runtime/node.exe'),['tools/install-control-examples.mjs'],{cwd:root,windowsHide:true});
for(const entry of examples)assert.equal(await fs.readFile(entry.file,'utf8'),entry.bytes);
result.disabledControlExamples=2;result.existingControlsPreserved=true;
async function tray(command) {
  const response = await execute(path.join(root,'tray/LocalserveTray.exe'),[command],{cwd:root,windowsHide:true,maxBuffer:65536});
  return JSON.parse(response.stdout.trim());
}
assert.equal((await tray('--startup-status')).enabled,false);
try {
  const started = await tray('--start');
  assert.ok(started.pid > 0);
  assert.equal(started.name,'Sormus');
  const state = await (await fetch(started.origin+'/api/state')).json();
  assert.equal(state.services.filter(plugin => plugin.enabled).length,0);
  assert.equal(state.tasks.length,0);
  assert.equal(state.vistas.length,0);
  assert.equal((await tray('--pause')).paused,true);
  assert.equal((await tray('--resume')).paused,false);
} finally {
  await tray('--stop');
}
assert.equal((await tray('--status')).running,false);
assert.equal((await tray('--startup-status')).enabled,false);
result.trayStartPauseResumeStop = true;
result.windowsStartupUnchanged = true;
console.log(JSON.stringify(result));
