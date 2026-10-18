/** Check clone-first startup in a disposable copy, never in the prepared index
 * or running installation. All copied plugins remain disabled throughout. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url));
const preparation = JSON.parse(await fs.readFile(path.join(root, 'work/github-source-preparation.json')));
const checkout = path.resolve(root, preparation.checkout);
assert.ok(checkout.startsWith(path.join(root, 'work') + path.sep));
const execute = promisify(execFile);
const indexTree=(await execute('git',['write-tree'],{cwd:checkout,windowsHide:true})).stdout.trim();
assert.equal(indexTree,preparation.indexTree);
const files = (await execute('git', ['ls-files', '-z'], { cwd: checkout, windowsHide: true })).stdout.split('\0').filter(Boolean);
const temporary = await fs.mkdtemp(path.join(root, 'work/github-source-check-'));
const installation = path.join(temporary, 'Localserve');
try {
  for (const file of files) {
    const target = path.resolve(installation, file);
    assert.ok(target.startsWith(installation + path.sep));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(checkout, file), target);
  }
  const node = path.join(installation, 'runtime/node.exe');
  const tests=await execute(node,['tools/testing/run.mjs'],
    {cwd:installation,windowsHide:true,maxBuffer:2*1024*1024});
  await fs.writeFile(path.join(root,'work/github-source-tests.txt'),tests.stdout);
  await execute(node,['tools/version.mjs','--check'],{cwd:installation,windowsHide:true});
  async function initialize() {
    await execute(node, ['tools/initialize-settings.mjs'], { cwd: installation, windowsHide: true });
  }
  await initialize();
  const configFile = path.join(installation, 'config.json');
  const trayFile = path.join(installation, 'tray/settings.json');
  const cleanConfig = await fs.readFile(configFile, 'utf8');
  const cleanTray = await fs.readFile(trayFile, 'utf8');
  assert.equal(JSON.parse(cleanConfig).listen.host, '127.0.0.1');
  assert.equal(JSON.parse(cleanConfig).location, null);
  await fs.writeFile(configFile, JSON.stringify({ ...JSON.parse(cleanConfig), name: 'Retain existing settings' }));
  await fs.writeFile(trayFile, '{"autoStartServer":false}\n');
  await initialize();
  assert.equal(JSON.parse(await fs.readFile(configFile)).name, 'Retain existing settings');
  assert.equal(JSON.parse(await fs.readFile(trayFile)).autoStartServer, false);
  await fs.writeFile(configFile, cleanConfig);
  await fs.writeFile(trayFile, cleanTray);
  await fs.writeFile(path.join(temporary, '.distribution-verification'), 'disposable distribution verification\n');
  const smoke = await execute(node, [path.join(root, 'tools/distribution/smoke.mjs'), installation],
    { cwd: installation, windowsHide: true, maxBuffer: 1024 * 1024 });
  assert.equal((await execute('git',['write-tree'],{cwd:checkout,windowsHide:true})).stdout.trim(),indexTree);
  assert.equal((await execute('git',['diff','--name-only'],{cwd:checkout,windowsHide:true})).stdout.trim(),'');
  const report = { firstStartInitialized: true, existingSettingsPreserved: true, files: files.length,indexTree,
    archiveSha256:preparation.archiveSha256,sourceTestsPassed:true,
    smoke: JSON.parse(smoke.stdout.trim()) };
  await fs.writeFile(path.join(root, 'work/github-source-startup-verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  assert.ok(path.resolve(temporary).startsWith(path.resolve(root, 'work') + path.sep));
  await fs.rm(temporary, { recursive: true, force: true });
}
