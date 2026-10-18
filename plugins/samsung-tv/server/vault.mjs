/** CurrentUser DPAPI credential storage using this plugin's local helper.
 * Encrypted credentials remain in the plugin-owned private data folder.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('../native/Vault.exe', import.meta.url));
export async function helperReady() {
  if (process.platform !== 'win32') return false;
  try { const stat = await fs.lstat(helper); return stat.isFile() && !stat.isSymbolicLink(); } catch { return false; }
}

export function transform(value, operation, signal = new AbortController().signal) {
  signal.throwIfAborted();
  if (!['protect', 'unprotect'].includes(operation) || value.length > 32768) throw new Error('Invalid credential transform.');
  return new Promise((resolve, reject) => {
    const child = spawn(helper, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      error ? reject(error) : resolve(result);
    };
    const abort = () => {
      // Closing stdin ends an unstarted helper normally. A DPAPI call already
      // executing is bounded local work; its late output is discarded, never
      // force-killed and never allowed to commit a credential file afterward.
      child.stdin.end();
      finish(signal.reason || new Error('Credential operation cancelled.'));
    };
    const timer = setTimeout(() => {
      child.stdin.end(); finish(new Error('Windows credential protection timed out.'));
    }, 5000);
    signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => {
      if (settled) return;
      output += chunk.toString('ascii');
      if (output.length > 60000) finish(new Error('Windows credential protection returned invalid data.'));
    });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => finish(new Error('Windows credential protection is unavailable.')));
    child.on('close', code => {
      if (settled) return;
      if (code !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(output)) finish(new Error('Saved Samsung TV credentials cannot be unlocked. Use an authorized replacement on this Windows account.'));
      else finish(null, Buffer.from(output, 'base64'));
    });
    child.stdin.end(JSON.stringify({ operation, value: Buffer.from(value).toString('base64') }) + '\n');
  });
}

export function createVault(file = fileURLToPath(new URL('../data/credentials.dpapi', import.meta.url))) {
  return {
    async load(signal) {
      try {
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768) throw new Error('Invalid Samsung TV credential file.');
        return JSON.parse((await transform(await fs.readFile(file), 'unprotect', signal)).toString('utf8'));
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async save(value, signal = new AbortController().signal) {
      const encrypted = await transform(Buffer.from(JSON.stringify(value)), 'protect', signal);
      signal.throwIfAborted();
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        const handle = await fs.open(temporary, 'wx', 0o600);
        try { await handle.writeFile(encrypted); await handle.sync(); } finally { await handle.close(); }
        // Publish only after encryption/file sync and a final cancellation gate.
        signal.throwIfAborted();
        await fs.rename(temporary, file);
      } finally { await fs.rm(temporary, { force: true }); }
    },
  };
}


