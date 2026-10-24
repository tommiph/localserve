/** Tray lifecycle checks own an isolated project with no installed plugins,
 * real provider requests, Windows startup edits, or unrelated process controls.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createLocalserve, defaultConfig } from '../server.mjs';
import { attachTrayControl } from '../server/tray-control.mjs';

const execute = promisify(execFile);
const source = fileURLToPath(new URL('../', import.meta.url));
const temporary = path.join(source, 'tests', '.tmp');

function rpc(descriptor, command, token = descriptor.token) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(`\\\\.\\pipe\\${descriptor.pipeName}`);
    let output = '';
    socket.setTimeout(5000, () => socket.destroy(new Error('Desktop response timeout')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write(JSON.stringify({ token, command }) + '\n'));
    socket.on('data', chunk => { output += chunk; });
    socket.on('end', () => { try { resolve(JSON.parse(output)); } catch (error) { reject(error); } });
  });
}

test('private tray channel authenticates commands and gracefully releases project lock', async t => {
  await fs.mkdir(temporary, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporary, 'tray-control-'));
  const app = await createLocalserve(root, { automatic: false });
  const controller = await attachTrayControl(app, root);
  t.after(async () => {
    await controller.shutdown();
    assert.ok(path.resolve(root).startsWith(path.resolve(temporary) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  assert.equal((await rpc(controller.descriptor, 'status', 'invalid')).ok, false);
  assert.equal((await rpc(controller.descriptor, 'status', 'é'.repeat(64))).ok, false);
  assert.equal((await rpc(controller.descriptor, 'kill-all')).ok, false);
  assert.equal((await rpc(controller.descriptor, 'status')).pid, process.pid);
  assert.equal((await rpc(controller.descriptor, 'pause')).paused, true);
  assert.equal((await rpc(controller.descriptor, 'resume')).paused, false);
  const response = await fetch(app.origin + '/data/tray-server.json');
  assert.equal(response.status, 404, 'Desktop credentials are private');
  assert.equal((await rpc(controller.descriptor, 'stop')).stopping, true);
  await controller.shutdown();
  await assert.rejects(fs.access(path.join(root, 'data/server.lock')));
  await assert.rejects(fs.access(path.join(root, 'data/tray-server.json')));
});

test('compiled Windows tray starts detached host, pauses/resumes, restarts, and safely recovers a stale lock', async t => {
  await fs.mkdir(temporary, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporary, 'tray-desktop-'));
  for (const directory of ['tray', 'runtime', 'data', 'plugins']) await fs.mkdir(path.join(root, directory));
  const compiled=await fs.stat(path.join(source,'tray/LocalserveTray.next.exe')).then(()=> 'tray/LocalserveTray.next.exe',()=> 'tray/LocalserveTray.exe');
  await fs.copyFile(path.join(source, compiled), path.join(root, 'tray/LocalserveTray.exe'));
  await fs.copyFile(path.join(source, 'tray/server-host.mjs'), path.join(root, 'tray/server-host.mjs'));
  await fs.writeFile(path.join(root, 'tray/settings.json'), '{"autoStartServer":false}\n');
  await fs.copyFile(path.join(source, 'server.mjs'), path.join(root, 'server.mjs'));
  await fs.copyFile(path.join(source, 'package.json'), path.join(root, 'package.json'));
  await fs.mkdir(path.join(root,'assets/material-symbols'),{recursive:true});
  await fs.copyFile(path.join(source,'assets/material-symbols/catalog.json'),path.join(root,'assets/material-symbols/catalog.json'));
  await fs.cp(path.join(source, 'server'), path.join(root, 'server'), { recursive: true });
  await fs.cp(path.join(source, 'vendor'), path.join(root, 'vendor'), { recursive: true });
  // One local hard link avoids a second runtime download/copy. It stays within
  // the project's temporary test tree and is removed without modifying Node.
  await fs.link(path.join(source, 'runtime/node.exe'), path.join(root, 'runtime/node.exe'));
  await fs.writeFile(path.join(root, 'config.json'), JSON.stringify({ ...defaultConfig, name: 'Tray test' }));
  const command = async name => {
    const { stdout } = await execute(path.join(root, 'tray/LocalserveTray.exe'), [name], { windowsHide: true, timeout: 45000 });
    return JSON.parse(stdout.trim());
  };
  t.after(async () => {
    await command('--stop');
    assert.ok(path.resolve(root).startsWith(path.resolve(temporary) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  assert.equal((await command('--status')).running, false);
  const first = await command('--start');
  assert.equal(first.name, 'Tray test');
  assert.equal((await command('--start')).pid, first.pid, 'No duplicate server');
  assert.equal((await command('--pause')).paused, true);
  assert.equal((await command('--resume')).paused, false);
  const second = await command('--restart');
  assert.notEqual(second.pid, first.pid);
  assert.equal((await command('--status')).pid, second.pid);
  await command('--stop');
  assert.equal((await command('--status')).running, false);
  await assert.rejects(fs.access(path.join(root, 'data/server.lock')));
  // The exited first host's PID is known absent; recovery must not kill it or
  // infer ownership from a process name. A live test-process lock is retained.
  await fs.writeFile(path.join(root, 'data/server.lock'), JSON.stringify({ pid: process.pid }));
  await assert.rejects(command('--start'));
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'data/server.lock'))).pid, process.pid);
  await fs.writeFile(path.join(root, 'data/server.lock'), JSON.stringify({ pid: first.pid }));
  assert.ok((await command('--start')).pid > 0);
  await command('--stop-and-exit');assert.equal((await command('--status')).running,false);
});
