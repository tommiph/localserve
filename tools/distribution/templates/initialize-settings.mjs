/** A source checkout keeps generated settings out of Git. Create clean defaults
 * before opening the tray, which expects these files on its first status read.
 * Existing configuration is never read, replaced or reset by this initializer.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConfig } from '../server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const [relative, value] of [
  ['config.json', defaultConfig],
  ['tray/settings.json', { autoStartServer: true }],
]) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    // Exclusive creation prevents a concurrent first start or existing user
    // settings from being overwritten. No service, plugin or network is started.
    await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}
