/** Detached tray-owned host with bounded persistent server diagnostics.
 * All application paths are derived from this file's Sormus root.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Console } from 'node:console';
import { createLocalserve } from '../server.mjs';
import { attachTrayControl } from '../server/tray-control.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
fs.mkdirSync(path.join(root, 'data', 'tray'), { recursive: true });
// Append to a bounded diagnostic file, not a pipe owned by a terminal/UI process.
const logPath = path.join(root, 'data', 'tray', 'server.log');
if (fs.existsSync(logPath) && fs.statSync(logPath).size > 2 * 1024 * 1024) {
  fs.renameSync(logPath, `${logPath}.previous`);
}
const output = fs.createWriteStream(logPath, { flags: 'a' });
globalThis.console = new Console({ stdout: output, stderr: output });
let application, desktop, shuttingDown = false;

async function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { if (desktop) await desktop.shutdown(); else await application?.close(); }
  finally { output.end(); }
}

try {
  console.log(`[${new Date().toISOString()}] Starting Sormus`);
  application = await createLocalserve(root);
  desktop = await attachTrayControl(application, root, { onStopped: () => output.end(), onError: error => {
    console.error(error);
    process.exitCode = 1;
    void stop();
  } });
  console.log(`[${new Date().toISOString()}] Ready: ${application.origin}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  await stop();
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
// Record unexpected failures before draining. No hidden restart/replay loop.
process.on('uncaughtException', error => { console.error(error); process.exitCode = 1; void stop(); });
process.on('unhandledRejection', error => { console.error(error); process.exitCode = 1; void stop(); });
