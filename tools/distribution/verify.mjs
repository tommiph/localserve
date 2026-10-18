/** Verify the ZIP itself, not the builder's staging tree. An isolated extraction
 * is hash-checked, booted with its own runtime, then removed cooperatively. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import {assertPublicPath} from './boundary.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../../',import.meta.url));
const tooling = fileURLToPath(new URL('./',import.meta.url));
const output = path.join(root,'dist');
const archive = path.resolve(root,process.argv[2] || '');
assert.ok(archive.startsWith(output+path.sep) && archive.endsWith('.zip'),'Choose a ZIP inside dist/.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const checksum = hash(await fs.readFile(archive));
assert.equal((await fs.readFile(archive+'.sha256','utf8')).split(' ')[0],checksum);
const workspace = await fs.mkdtemp(path.join(output,'.verify-'));
try {
  await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(tooling,'archive.ps1'),'-Mode','Extract','-Source',archive,'-Destination',workspace],{cwd:root,windowsHide:true,maxBuffer:1024*1024});
  const installation = path.join(workspace,'Localserve');
  const manifest = JSON.parse(await fs.readFile(path.join(installation,'DISTRIBUTION-MANIFEST.json')));
  const actual = [];
  async function files(directory) {
    for (const entry of await fs.readdir(directory,{withFileTypes:true})) {
      assert.equal(entry.isSymbolicLink(),false);
      const file = path.join(directory,entry.name);
      if (entry.isDirectory()) await files(file);
      else actual.push(path.relative(installation,file).split(path.sep).join('/'));
    }
  }
  await files(installation);
  assert.deepEqual(actual.sort(),[...manifest.files.map(file=>file.path),'DISTRIBUTION-MANIFEST.json'].sort());
  for (const file of manifest.files) {
    assertPublicPath(file.path,{seeds:true});
    assert.ok(!file.path.split('/').includes('data') && !file.path.split('/').includes('private'));
    const bytes = await fs.readFile(path.join(installation,file.path));
    assert.equal(bytes.length,file.bytes,file.path);
    assert.equal(hash(bytes),file.sha256,file.path);
  }
  assert.ok(actual.includes('.gitignore'));
  assert.ok(actual.includes('runtime/LICENSE.txt'));
  assert.ok(actual.includes('plugins/calendar/vendor/ical.js/lib/ical/module.js'));
  assert.ok(actual.includes('plugins/pc-network/native/Collector.exe'));
  assert.ok(actual.includes('plugins/pc-network/native/GpuReadings.cs'));
  for (const file of ['server/control-apps.mjs','server/local-pages.mjs','server/do-not-disturb.mjs',
    'web/control-app.js','assets/controls/app-icon.svg','assets/controls/app-icon-192.png',
    'assets/controls/app-icon-512.png','assets/notices/notice.js','assets/notices/alarm.wav',
    'tools/build-control-app-icons.ps1','assets/pages/README.md']) assert.ok(actual.includes(file),file);
  for(const file of ['AGENTS.md','CONTRIBUTING.md','USER-GUIDE.md','SECURITY.md',
    'assets/universe/worlds.js','server/games.mjs','web/games-ui.js','web/maze.html',
    'assets/games/maze-core.js','assets/games/maze.js','assets/games/maze.css','assets/games/music.js',
    'assets/games/music/README.md','GAMES.md','tests/games.test.mjs','tools/initialize-settings.mjs','tests/source.test.mjs',
    'tools/install-control-examples.mjs','examples/controls/README.md','examples/controls/samsung-tv.json','examples/controls/tradfri.json',
    'plugins/sensors/android/dist/localserve-sensors.apk','plugins/sensors/android/vendor/lock.json'])assert.ok(actual.includes(file),file);
  assert.deepEqual(actual.filter(file => file.startsWith('assets/pages/')).sort(),['README.md','scifi.html','scifi-display.js','scifi-tv.css','scifi.utilities.css','solar-system.html','solar-system.js','vendor/three-r97/LICENSE.txt','vendor/three-r97/README.md','vendor/three-r97/three.min.js'].map(file=>'assets/pages/'+file).sort());
  assert.deepEqual(actual.filter(file => file.startsWith('assets/games/music/')),['assets/games/music/README.md']);
  for (const file of ['assets/scifi.html','assets/scifi.js','assets/task-model.js',
    'assets/tasks-ui.js','assets/tv-url-test.html']) assert.ok(!actual.includes(file),file);
  for (const file of actual) assert.doesNotMatch(file,/(?:author-signature|signature1)\.xml$|\.(?:wgt|dpapi|p12|pfx|pwd|jsonl|log|tmp)$/i);
  await fs.writeFile(path.join(workspace,'.distribution-verification'),'disposable distribution verification\n');
  const smoke = await run(path.join(installation,'runtime/node.exe'),[path.join(tooling,'smoke.mjs'),installation],
    {cwd:installation,windowsHide:true,maxBuffer:1024*1024});
  const result = JSON.parse(smoke.stdout.trim());
  const report = {schemaVersion:1,archive:path.basename(archive),verifiedAt:new Date().toISOString(),sha256:checksum,
    files:actual.length,archiveHashesVerified:true,privateStateExcluded:true,tvSigningExcluded:true,smoke:result};
  await fs.writeFile(archive+'.verification.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
} finally {
  // This unique directory was created by this verifier, under dist/, and never
  // becomes a user's install. No broad delete, PID scan or force-kill is used.
  assert.ok(path.resolve(workspace).startsWith(path.resolve(output)+path.sep));
  await fs.rm(workspace,{recursive:true,force:true});
}
