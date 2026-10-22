/** Package versions describe local files, never an installed remote client. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readClientPackages} from '../server/client-packages.mjs';

test('client package metadata requires a matching bounded APK and reports source-only TV version',async t=>{
  const base=fileURLToPath(new URL('./.tmp/',import.meta.url));await fs.mkdir(base,{recursive:true});
  const root=await fs.mkdtemp(path.join(base,'client-packages-'));
  t.after(async()=>{assert.equal(path.dirname(root),path.resolve(base));await fs.rm(root,{recursive:true,force:true});});
  assert.deepEqual(await readClientPackages(root),{android:null,tvLauncherSource:null});
  const dist=path.join(root,'plugins/sensors/android/dist');await fs.mkdir(dist,{recursive:true});
  const apk=Buffer.from('Synthetic package bytes'),meta={version:'1.2.3',bytes:apk.length,sha256:createHash('sha256').update(apk).digest('hex'),private:'never exposed'};
  await fs.writeFile(path.join(dist,'localserve-sensors.apk'),apk);
  await fs.writeFile(path.join(dist,'verification.json'),JSON.stringify(meta));
  await fs.mkdir(path.join(root,'tv-tizen/app'),{recursive:true});
  await fs.writeFile(path.join(root,'tv-tizen/app/config.xml'),'<!-- <widget version="9.9.9"> --><widget id="example" version="2.1.0"/>');
  assert.deepEqual(await readClientPackages(root),{android:'1.2.3',tvLauncherSource:'2.1.0'});
  for(const patch of [{version:'<script>'},{sha256:'0'.repeat(64)},{bytes:17*1024*1024}]){
    await fs.writeFile(path.join(dist,'verification.json'),JSON.stringify({...meta,...patch}));
    assert.equal((await readClientPackages(root)).android,null);
  }
  await fs.writeFile(path.join(dist,'verification.json'),JSON.stringify(meta));
  await fs.appendFile(path.join(dist,'localserve-sensors.apk'),'changed');
  assert.equal((await readClientPackages(root)).android,null);
});

test('administrator version tracking keeps its original connection version and never infers an installed TV build',async()=>{
  const context=vm.createContext({escapeHtml:value=>String(value),icon:()=>''});
  vm.runInContext(await fs.readFile(new URL('../web/admin-ux.js',import.meta.url),'utf8')+'\nglobalThis.ux=AdminUX;',context);
  context.ux.observeServerVersion('0.19.0');context.ux.observeServerVersion('0.20.0');
  assert.equal(context.ux.pageServerVersion,'0.19.0');
  const data={config:{version:'0.20.0'},server:{clientPackages:{android:'1.4.1',tvLauncherSource:'1.1.2'}}};
  const before=JSON.stringify(data),html=context.ux.versions(data);
  assert.match(html,/Reload recommended/);assert.match(html,/running server/i);assert.match(html,/v0.19.0/);assert.match(html,/v1.4.1/);
  assert.match(html,/installed TV launcher version is not reported/);assert.match(html,/does not restart the server/);
  assert.equal(JSON.stringify(data),before);
  assert.doesNotMatch(context.ux.versions({config:{version:'0.19.0'}}),/Reload recommended/);
});
