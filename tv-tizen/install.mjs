/** Install this built package on the configured Samsung TV only. No scan,
 * uninstall, app launch, server restart or unrelated device operation exists. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isPrivateIPv4 } from '../server/network.mjs';

const root = path.resolve(import.meta.dirname, '..');
const target = process.argv[2] || 'vista';
if (!['vista','playstation','launcher'].includes(target)) throw Error('Choose vista, playstation or launcher.');
const appFolder = target === 'vista' ? 'tv-tizen' : 'tv-tizen/'+target;
const packageName = target === 'launcher' ? 'SormusLauncher.wgt' : target === 'playstation' ? 'PlayStation.wgt' : 'Vista.wgt';
const config = JSON.parse(await fs.readFile(path.join(root, 'plugins/samsung-tv/data/config.json'), 'utf8'));
const host = config.settings?.host;
if (!isPrivateIPv4(host)) throw new Error('Configure the private Samsung TV address first.');
const sdk = path.join(root, 'tools/tizen/studio'), ide = path.join(sdk, 'tools/ide');
const libraries = (await fs.readdir(path.join(ide, 'lib-ncli'))).filter(name => name.endsWith('.jar'));
const classpath = [path.join(ide, 'conf-ncli'), ...libraries.map(name => path.join(ide, 'lib-ncli', name)),
  path.join(sdk, 'library/sdk-utils-core.jar')].join(path.delimiter);
const result = await promisify(execFile)(path.join(sdk, 'jdk/bin/java.exe'), [
  '-Dlog4j.configuration=log4j-progress.xml', '-Djava.library.path=' + path.join(ide, 'lib-ncli/spawner'),
  '-cp', classpath, 'org.tizen.ncli.ide.shell.Main', 'install', '-n', packageName, '-s', host + ':26101',
  '--', path.join(root, appFolder, 'dist'), '--current-workspace-path', root,
], { cwd: path.join(ide, 'bin'), windowsHide: true, timeout: 60000, maxBuffer: 512 * 1024 });
console.log(result.stdout);
