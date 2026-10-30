/** Private desktop control channel. No shutdown endpoint is added to HTTP.
 * The project-owned descriptor and random token identify this server instance.
 */
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { JsonStore } from './storage.mjs';

export function trayPipeName(root) {
  const identity = createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 24);
  return `localserve-${identity}`;
}

export async function attachTrayControl(application, root, options = {}) {
  const name = trayPipeName(root);
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : path.join(root, 'data', `${name}.sock`);
  const descriptorPath = path.join(root, 'data', 'tray-server.json');
  const token = randomBytes(32).toString('hex');
  let stopping = false, closePromise;
  const sockets = new Set();
  const onError = options.onError || (error => console.error(error));
  const descriptor = { pid: process.pid, origin: application.origin, pipeName: name, token };

  function authorized(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
      && timingSafeEqual(Buffer.from(value), Buffer.from(token));
  }

  function status() {
    return { ok: true, pid: process.pid, name: application.config.snapshot().name,
      origin: application.origin, paused: application.engine.gate.paused,
      runningTasks: application.engine.active.size, stopping };
  }

  async function dispatch(request) {
    if (!request || !authorized(request.token)) throw new Error('Desktop control token is invalid.');
    if (request.command === 'status') return status();
    if (stopping) throw new Error('Server is stopping.');
    if (['pause', 'resume'].includes(request.command)) {
      if(request.command==='resume'&&application.backups?.pending)throw Error('A restore is pending. Restart normally or cancel it in Settings.');
      await application.engine.setPaused(request.command === 'pause');
      return status();
    }
    if (request.command === 'stop') {
      stopping = true;
      // Acknowledge before draining HTTP/tasks/workers and closing this pipe.
      // The desktop waits for process exit; it never force-kills a slow stop.
      setImmediate(() => shutdown().catch(onError));
      return status();
    }
    throw new Error('Unknown desktop command.');
  }

  const control = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(3000, () => socket.destroy());
    let input = '', bytes = 0, handled = false;
    socket.on('data', chunk => {
      if (handled) return;
      bytes += chunk.length;
      if (bytes > 4096) return socket.destroy();
      input += chunk.toString('utf8');
      if (!input.includes('\n')) return;
      handled = true;
      Promise.resolve().then(() => dispatch(JSON.parse(input.split('\n')[0])))
        .catch(error => ({ ok: false, error: error.message }))
        .then(result => socket.end(JSON.stringify(result) + '\n'));
    });
  });
  await new Promise((resolve, reject) => {
    control.once('error', reject);
    control.listen(endpoint, resolve);
  });
  control.on('error', onError);
  try {
    await new JsonStore(descriptorPath, descriptor).write(descriptor);
  } catch (error) {
    await new Promise(resolve => control.close(resolve));
    throw error;
  }

  async function close() {
    for (const socket of sockets) socket.destroy();
    if (control.listening) await new Promise(resolve => control.close(resolve));
    // Remove only this instance's descriptor. A replacement must retain its
    // fresh credentials even if this process's final cleanup is delayed.
    try {
      const current = JSON.parse(await fs.readFile(descriptorPath, 'utf8'));
      if (current.token === token) await fs.rm(descriptorPath);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  function shutdown() {
    if (!closePromise) closePromise = application.close().finally(close).finally(() => options.onStopped?.());
    return closePromise;
  }
  return { close, shutdown, descriptor };
}
