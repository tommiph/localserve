/** Build with the project-local official CLI and configured author identity.
 * Generated SDK paths resolve beneath the Sormus installation. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const root = path.resolve(import.meta.dirname, '..');
const target = process.argv[2] || 'vista';
if (!['vista','playstation','launcher'].includes(target)) throw Error('Choose vista, playstation or launcher.');
const appFolder = target === 'vista' ? 'tv-tizen' : 'tv-tizen/'+target;
const sdk = path.join(root, 'tools/tizen/studio');
const sdkData = path.join(root, 'tools/tizen/studio-data');
const ide = path.join(sdk, 'tools/ide');
const signing = path.join(root, 'tv-tizen/private/tizen-signing');
const xml = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const profile = `<?xml version="1.0" encoding="UTF-8"?>
<profiles active="Vista" version="3.1"><profile name="Vista">
<profileitem ca="" distributor="0" key="${xml(path.join(signing, 'home-glance-author.p12'))}" password="${xml(path.join(signing, 'home-glance-author.pwd'))}" rootca=""/>
<profileitem ca="" distributor="1" key="${xml(path.join(sdk, 'tools/certificate-generator/certificates/distributor/tizen-distributor-signer.p12'))}" password="${xml(path.join(sdkData, 'tools/certificate-generator/certificates/distributor/tizen-distributor-signer.pwd'))}" rootca=""/>
<profileitem ca="" distributor="2" key="" password="" rootca=""/>
</profile></profiles>\n`;
await fs.writeFile(path.join(sdkData, 'profile/profiles.xml'), profile);
await fs.writeFile(path.join(sdk, 'sdk.info'), `TIZEN_SDK_INSTALLED_PATH=${sdk}\nTIZEN_SDK_DATA_PATH=${sdkData}\nJDK_PATH=${path.join(sdk, 'jdk')}\n`);
const run = promisify(execFile);
// Invoke the same official CLI main class directly. Argument arrays avoid the
// Windows batch wrapper's nested quoting and keep credentials out of commands.
const libraries = (await fs.readdir(path.join(ide, 'lib-ncli'))).filter(name => name.endsWith('.jar'));
const classpath = [path.join(ide, 'conf-ncli'), ...libraries.map(name => path.join(ide, 'lib-ncli', name)),
  path.join(sdk, 'library/sdk-utils-core.jar')].join(path.delimiter);
const javaOptions = ['-Dlog4j.configuration=log4j-progress.xml',
  '-Djava.library.path=' + path.join(ide, 'lib-ncli/spawner'), '-cp', classpath, 'org.tizen.ncli.ide.shell.Main',
];
await run(path.join(sdk, 'jdk/bin/java.exe'), [...javaOptions, 'cli-config',
  'default.profiles.path=' + path.join(sdkData, 'profile/profiles.xml'), '--current-workspace-path', root],
  { cwd: path.join(ide, 'bin'), windowsHide: true, timeout: 20000, maxBuffer: 512 * 1024 });
const output=path.join(root,appFolder,'dist');await fs.mkdir(output,{recursive:true});
const temporary=await fs.mkdtemp(path.join(output,'.package-'));
const result = await run(path.join(sdk, 'jdk/bin/java.exe'), [...javaOptions,
  'package', '-t', 'wgt', '-s', 'Vista', '-o', temporary, '--', path.join(root, appFolder, 'app'),
  '--current-workspace-path', root],
  { cwd: path.join(ide, 'bin'), windowsHide: true, timeout: 60000, maxBuffer: 512 * 1024 });
console.log(result.stdout);
const packages=(await fs.readdir(temporary)).filter(file=>file.endsWith('.wgt'));
if(packages.length!==1)throw Error('Expected one signed TV package.');
// Visible app names may change without changing installed identity or the
// canonical filename consumed by downloads and the explicit installer.
await fs.rename(path.join(temporary,packages[0]),path.join(output,target==='launcher'?'SormusLauncher.wgt':target==='playstation'?'PlayStation.wgt':'Vista.wgt'));
await fs.rmdir(temporary);
