/** Build a shareable snapshot from public source, never by copying the install.
 * Fresh configuration is authored here; live data is read only for a private
 * credential-leak check and hashes. Generated files live exclusively in dist/.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateDeclaration } from '../../server/plugins.mjs';
import { validateValues } from '../../server/plugin-schema.mjs';
import {controlExamples} from './templates/control-examples.mjs';
import {validateControlPage} from '../../server/controls.mjs';
import {assertPublicPath} from './boundary.mjs';
import {renderDemoReadme} from './readme.mjs';
import {publicTests} from '../testing/public-tests.mjs';
import {sanitizeOculusReadings,initializeSourceLauncher} from './sanitize-source.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const tooling = fileURLToPath(new URL('./', import.meta.url));
const output = path.join(root, 'dist');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'))).version;
const name = `Localserve-${version}-windows-x64-${stamp}`;
const workspace = path.join(output, `.build-${stamp}`);
const stage = path.join(workspace, 'Localserve');
const archive = path.join(output, name + '.zip');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = value => value.split(path.sep).join('/');
const copied = new Set();
const declarations = [];

function inside(parent, child) {
  if (!path.resolve(child).startsWith(path.resolve(parent) + path.sep)) throw new Error('Path escapes distribution workspace.');
}

async function write(relative, content) {
  const target = path.join(stage, relative);
  inside(stage, target);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
  copied.add(slash(relative));
}

async function copyFile(relative) {
  const source = path.join(root, relative);
  inside(root, source);
  const stat = await fs.lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Not an ordinary source file: ${relative}`);
  await write(relative, await fs.readFile(source));
}

async function copyTree(relative, excluded = new Set()) {
  const source = path.join(root, relative);
  const stat = await fs.lstat(source);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Not an ordinary source directory: ${relative}`);
  for (const entry of (await fs.readdir(source, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const child = path.join(relative, entry.name);
    // This applies even below a vendored package. Never follow links or include
    // local state, credentials, archives or developer-generated binary output.
    if (excluded.has(slash(child)) || ['data', 'private', '.git', '.codex', '.agents', 'test', 'tests', 'coverage', '.cache'].includes(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Link excluded from distribution: ${child}`);
    if (entry.isDirectory()) await copyTree(child, excluded);
    else if (entry.isFile() && !/\.(?:tgz|zip|wgt|p12|pfx|pwd|dpapi|pdb|log|jsonl|tmp)$/i.test(entry.name)) await copyFile(child);
  }
}

async function definitions() {
  const files = ['config.json', 'data/tasks.json', 'data/vistas.json', 'data/vista-display.json', 'data/universe.json', 'data/games.json'];
  for (const declaration of declarations) for (const file of ['config.json','cards.json','controls.json']) {
    files.push(`plugins/${declaration.id}/data/${file}`);
  }
  const hashes = {};
  for (const file of files) try { hashes[file] = sha256(await fs.readFile(path.join(root, file))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return hashes;
}

const setup = {
  sensors: 'Enable Sensors, open /sensors on Android and install the APK. Enter this server’s private LAN address, select sensors and Start. Devices register without pairing. Phone events, location, named regions and activity transitions are optional and require real Android permissions; activity needs installed Google Play services. Disable a device to reject reports. See android/README.md for setup, privacy, Task conditions and building.',
  'adsb-lol': 'Add an Area with your coordinates, radius in nautical miles and maximum reported position age. Enabling the plugin and Area sends those coordinates to api.adsb.lol. No map, route enrichment or device control is provided.',
  calendar: 'Add your own complete public HTTPS/webcal ICS subscription URL. No subscription is supplied. Reminder checks use cached agenda data; feed refresh is separate. No authenticated CalDAV, calendar edits or attachment downloads are provided.',
  emby: 'Enter your private/loopback Emby URL including port and a dedicated Emby API key. Paste only the key value, without its application label or spaces. Reads sessions only; connected clients without reported media can show No data. No playback or library control is provided.',
  finavia: 'Obtain your own Finavia Public Flights API key and add a Location/airport board. This plugin uses the fixed apigw.finavia.fi gateway and app_key header. Availability depends on provider access and your key.',
  fingrid: 'Enter your own Fingrid Open Data API key and add named numeric dataset IDs. No key or sample dataset entries are installed. Queries are rate-limited; enabling many sources can slow background refreshes.',
  'hsl-trains': 'Add a Finnish station board using the bundled public station catalogue, then choose arrival/departure, route and line filters. Uses Fintraffic Digitraffic; no API key is required. Upcoming times are provider reports, not guaranteed movements.',
  news: 'Add a Search using its complete HTTPS Google News RSS Feed URL. Each feed URL supplies its own query/language/edition parameters. No personal searches or subscriptions are included; article pages/images are not downloaded.',
  'oculus-go': 'Requires wireless ADB already enabled, the exact headset serial, a private IPv4:port and an already authorized RSA key. Enter Base64 of that authorized key in the masked replacement setting; clear it after a successful authenticated refresh. Localserve does not enable debugging, authorize a new key, scan devices, use USB or control the headset.',
  'pc-network': 'Enable to read this Windows PC\'s CPU, memory, fixed drives, network counters and supported GPU readings. Unsupported values remain unavailable. Neighbor names come from the existing cache and bounded lookups, not a network scan. No separate monitoring service or credentials are needed.',
  playstation: 'Sign in to PlayStation in your own browser, then open https://ca.account.sony.com/api/v1/ssocookie in that browser. Enter only your own npsso value, enable and refresh. After success clear the NPSSO input; the Windows-protected session remains. This reads PSN account presence and history, not physical console power, and sends no console/account controls.',
  'samsung-tv': 'Enter the TV\'s private IPv4 and explicitly choose port 8002 (TLS) or 8001 (plain). Port 8002 remote actions require the verified exact SHA-256 certificate fingerprint. Remote actions need an already authorized TV token obtained separately through an approved pairing workflow; this plugin does not perform tokenless pairing. Clear the replacement token input after a successful remote action/read. The optional wired MAC is used only by explicit Wake TV. A clean install has no saved remote page or button mappings; create your own Controls page.',
  simulator: 'Enable for local test actions, values and events without a device. Leave Configuration complete on unless testing readiness behavior. On an empty installation, Overview offers an optional Create demo button for an editable Task, Signal lab Card and Vista; nothing runs automatically.',
  tradfri: 'Supports the legacy IKEA TRÅDFRI gateway, not DIRIGERA. Enter your private gateway IPv4 and printed security code, enable and refresh to derive Windows-protected credentials. Clear the security-code input after success. Add your own Controls page and device mappings; no lighting scenes, gateway identities or routines are supplied.',
  weather: 'Add named Locations using a wttr.in query. New coordinates can prefill from your own Server location after you configure it. Each Location owns its readings and polling. No location is supplied by this release.',
  webpage: 'Add a named public HTTP/HTTPS page for bounded HTML/text reads; arbitrary private/local targets and redirects are rejected. Alternatively add your own display HTML under assets/pages/ and save its /assets/pages/name.html path. These local pages are display-only and never polled. Open on TV requires your own ready Samsung TV plugin and compatible Vista Tizen app. No personal pages or saved Page entries are included.',
  youtube: 'Create your own Google API key with YouTube Data API v3 enabled, then add named public Channels in Settings by ID, handle or supported channel URL. Resolve ambiguous name searches explicitly. First readings establish a baseline; later public uploads can trigger Task Events. Provider quotas/local budgets apply. Optional playback belongs to Samsung TV: configure its authorized remote connection and enable YouTube playback separately. No keys, channel entries, account sessions or automatic TV Tasks are included.',
};

function fieldList(fields) {
  return fields.map(field => {
    const choices = field.enum ? ` Choices: ${field.enumLabels?.join(', ') || field.enum.join(', ')}.` : '';
    const child = field.fields ? '\n' + field.fields.map(item => `  - **${item.label}**${item.format === 'secret' ? ' (private secret)' : ''}: ${item.help || item.type}`).join('\n') : '';
    return `- **${field.label}**${field.format === 'secret' ? ' (private secret)' : ''}: ${field.help || field.type}.${choices}${child}`;
  }).join('\n');
}

async function pluginGuide(declaration) {
  if(declaration.taskBuilder){await write(`plugins/${declaration.id}/README.md`,await fs.readFile(path.join(root,'plugins',declaration.id,'README.md')));return;}
  const templates = declaration.cardTemplates?.map(item => item.name).join(', ') || 'No fixed ready-made design; use the ordinary Card designer.';
  await write(`plugins/${declaration.id}/README.md`, `# ${declaration.name}\n\n${declaration.description}\n\n## Setup\n\n${setup[declaration.id] || 'Configure declared Settings before enabling.'}\n\nStarts disabled with fresh default settings, no cached readings, saved Cards or Controls. Configure through the shared administrator; do not copy credentials from someone else\'s installation.\n\n## Settings\n\n${fieldList(declaration.settings)}\n\n## Actions and events\n\nActions: ${declaration.actions.map(item => item.name).join('; ') || 'None'}.\n\nEvents: ${declaration.events.map(item => item.name).join('; ') || 'None'}.\n\nPlugin actions appear in global Tasks only when the plugin is enabled and ready. Explicit device actions can have real effects. Polling failures retain successful same-target readings; missing values remain explicit and uncertain effects are not automatically retried/replayed.\n\n## Cards\n\nReady-made designs: ${templates}. Designs are package assets, not preconfigured saved Cards. Create a Card, choose its source and enable it before adding it to a Vista. Cards and Vistas are read-only; Controls/Tasks own actions.\n\n${declaration.attribution ? `## Data attribution\n\n${declaration.attribution.label}: ${declaration.attribution.url}\n\n${declaration.attribution.licenseLabel || ''} ${declaration.attribution.licenseUrl || ''}\n\n${declaration.attribution.notice || ''}\n\n` : ''}See [installation instructions](../../INSTALL.md) for storage, credentials and LAN access. Private mutable files are created only under this plugin\'s data folder.\n`);
}

async function audit() {
  const secretBytes = [];
  const personalMarkers = [];
  let installedConfig={};
  try{installedConfig=JSON.parse(await fs.readFile(path.join(root,'config.json')));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if (installedConfig.listen?.host && !['127.0.0.1','::1'].includes(installedConfig.listen.host)) personalMarkers.push(installedConfig.listen.host);
  for (const declaration of declarations) {
    let config;
    try { config = JSON.parse(await fs.readFile(path.join(root, 'plugins', declaration.id, 'data/config.json'))); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    function collect(fields, values) {
      for (const field of fields) {
        const value = values?.[field.id];
        if (field.type === 'list' && Array.isArray(value)) for (const item of value) collect(field.fields, item);
        else if (field.format === 'secret' && typeof value === 'string' && value.length >= 12) {
          secretBytes.push(Buffer.from(value), Buffer.from(value, 'utf16le'));
        }
      }
    }
    collect(declaration.settings, config.settings);
    for (const key of ['host','serial','mac','fingerprint','address']) {
      const value = config.settings?.[key];
      if (typeof value === 'string' && value.length >= 8) personalMarkers.push(value);
    }
  }
  const home = process.env.USERPROFILE;
  const privatePaths = [root, ...(home ? [home] : [])].flatMap(value => [value, value.replaceAll('\\','/'), value.replaceAll('\\','\\\\')]);
  for (const file of copied) {
    assertPublicPath(file,{seeds:true});
    if (/^(?:data|work|reference|dist)\//.test(file) || /(?:^|\/)(?:data|private|\.git|\.codex|\.agents)\//.test(file)
      || /\.(?:dpapi|p12|pfx|pwd|wgt|log|jsonl|tmp)$/i.test(file)
      || /(?:author-signature|signature1)\.xml$/.test(file)) throw new Error(`Private/development entry found: ${file}`);
    const bytes = await fs.readFile(path.join(stage, file));
    if (secretBytes.some(secret => bytes.includes(secret))) throw new Error(`Private credential found in distribution file: ${file}`);
    const text = bytes.toString('utf8') + '\n' + bytes.toString('utf16le');
    if (privatePaths.some(value => text.toLowerCase().includes(value.toLowerCase()))) throw new Error(`Installation path found in distribution file: ${file}`);
    if (personalMarkers.some(value => text.includes(value))) throw new Error(`Installed device/address detail found: ${file}`);
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=]{40}/.test(text)) throw new Error(`Private key material found: ${file}`);
  }
  const config = JSON.parse(await fs.readFile(path.join(stage, 'config.json')));
  if (config.location !== null || config.listen.host !== '127.0.0.1' || config.listen.port !== 0) throw new Error('Unsafe installation defaults.');
}

await fs.mkdir(stage, { recursive: true });
for (const entry of await fs.readdir(path.join(root, 'plugins'), { withFileTypes:true })) {
  if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
  try {
    const declaration = JSON.parse(await fs.readFile(path.join(root, 'plugins', entry.name, 'declaration.json')));
    validateDeclaration(declaration);
    if (declaration.id !== entry.name) throw new Error('Plugin folder/identity mismatch.');
    declarations.push(declaration);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
declarations.sort((a,b) => a.id.localeCompare(b.id));
const before = await definitions();
try {
  for (const file of ['LICENSE','server.mjs','styles.css','project-info.json','VERSIONING.md','VERSION-HISTORY.json','tools/version.mjs','Start Localserve.cmd','Start Localserve Tray.cmd','runtime/node.exe','runtime/LICENSE.txt']) await copyFile(file);
  for (const directory of ['server','web','vendor']) await copyTree(directory);
  for(const file of ['build.mjs','verify.mjs','smoke.mjs','archive.ps1','boundary.mjs','readme.mjs','gitignore.txt','release.mjs','prepare-source.mjs','verify-source.mjs','sanitize-source.mjs'])await copyFile('tools/distribution/'+file);
  for(const directory of ['templates','licenses'])await copyTree('tools/distribution/'+directory);
  for(const file of ['localserve.iss','build.mjs','verify.mjs','uninstall-path.mjs','README.md','compiler-lock.json','prepare-compiler.ps1','LICENSE.InnoSetup.txt'])await copyFile('tools/installer/'+file);
  // Only public isolated tests are copied; never traverse tests/.tmp.
  for (const file of publicTests.filter(file=>file!=='tests/source.test.mjs')) await copyFile(file);
  for (const file of ['tools/testing/public-tests.mjs','tools/testing/run.mjs','.github/workflows/windows.yml']) await copyFile(file);
  await write('tests/source.test.mjs',await fs.readFile(path.join(tooling,'templates/source.test.mjs')));
  await write('tools/initialize-settings.mjs',await fs.readFile(path.join(tooling,'templates/initialize-settings.mjs')));
  await write('tools/install-control-examples.mjs',await fs.readFile(path.join(tooling,'templates/install-control-examples.mjs')));
  await write('examples/controls/README.md',await fs.readFile(path.join(tooling,'templates/CONTROLS-EXAMPLES.md')));
  for(const [id,page] of Object.entries(controlExamples())){
    validateControlPage(page,validateDeclaration(declarations.find(value=>value.id===id)));
    await write('examples/controls/'+id+'.json',JSON.stringify(page,null,2)+'\n');
  }
  for (const launcher of ['Start Localserve.cmd','Start Localserve Tray.cmd']) {
    await write(launcher,initializeSourceLauncher(await fs.readFile(path.join(stage,launcher),'utf8')));
  }
  // User-added display HTML is content, not an application dependency. Never
  // recursively copy assets/, which can contain private user-authored pages.
  for (const file of ['favicon.svg','logo.svg','logo-dark.svg','vista-boot.js',
    'vista-legacy-ready.css','vista-legacy.css','vista-legacy.js']) await copyFile('assets/'+file);
    for (const directory of ['controls','material-symbols','notices','timezones','universe','sensors']) await copyTree('assets/'+directory);
  // Music belongs to the installation. Ship game code and instructions only.
  for(const file of ['maze-core.js','maze.js','maze.css','music.js','music/README.md']) await copyFile('assets/games/'+file);
  await copyFile('GAMES.md');
  await write('assets/pages/README.md',await fs.readFile(path.join(tooling,'templates','PAGES-README.md')));
  for(const file of ['scifi.html','scifi-display.js','scifi-tv.css','scifi.utilities.css','solar-system.html','solar-system.js'])await copyFile('assets/pages/'+file);
  await copyTree('assets/pages/vendor/three-r97');
  await copyFile('tools/build-control-app-icons.ps1');
  await copyTree('tools/icons');
  for (const file of ['LocalserveTray.cs','build.ps1','enable-lan.ps1','server-host.mjs']) await copyFile('tray/'+file);
  let trayBinary='tray/LocalserveTray.exe';
  try{
    const receipt=JSON.parse((await fs.readFile(path.join(root,'tray/build-result.json'),'utf8')).replace(/^\uFEFF/,''));
    if(receipt.version!==version||!['tray/LocalserveTray.exe','tray/LocalserveTray.next.exe'].includes(receipt.binary)||sha256(await fs.readFile(path.join(root,'tray/LocalserveTray.cs')))!==receipt.sourceSha256||sha256(await fs.readFile(path.join(root,receipt.binary)))!==receipt.binarySha256)throw Error('Rebuild the tray before packaging: its version, source or executable changed.');
    trayBinary=receipt.binary;
  }catch(error){if(error.code!=='ENOENT'||await fs.stat(path.join(root,'tray/build-result.json')).then(()=>true,()=>false))throw error;}
  await write('tray/LocalserveTray.exe',await fs.readFile(path.join(root,trayBinary)));
  await copyTree('tray/assets');
  // Public releases have no knowledge of the originating interface's profile.
  // Keep the optional rule on Private networks only; no firewall command runs.
  const lanScript = 'tray/enable-lan.ps1';
  await write(lanScript,(await fs.readFile(path.join(stage,lanScript),'utf8'))
    .replace("Profile=@('Private','Public')","Profile='Private'")
    .replace(/# The interface is currently labelled Public\.[\s\S]*?# and private subnet on either profile, without weakening other networks\./,
      '# Apply only on Private networks, scoped to the exact address and subnet.\n    # Never change the network category or broaden another network\'s rules.'));
  for (const declaration of declarations) {
    const folder = 'plugins/'+declaration.id;
    for (const directory of ['server','cards','native','vendor','admin']) {
      try { await fs.access(path.join(root,folder,directory)); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      await copyTree(folder+'/'+directory);
    }
    try { await copyFile(folder+'/LICENSE.txt'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (declaration.id === 'hsl-trains') await copyFile(folder+'/stations.json');
    if (declaration.id === 'sensors') {
      for (const directory of ['src','res','test']) await copyTree(folder+'/android/'+directory);
      for (const file of ['AndroidManifest.xml','build.mjs','prepare-vendor.mjs','README.md','dist/localserve-sensors.apk','dist/localserve-sensors.apk.sha256','dist/verification.json','vendor/lock.json','vendor/README.md']) await copyFile(folder+'/android/'+file);
      const androidLock=JSON.parse(await fs.readFile(path.join(root,folder,'android/vendor/lock.json'),'utf8'));
      for(const artifact of androidLock.artifacts) {
        if(!/^[\w.-]+\.(?:aar|jar)$/.test(artifact.file))throw new Error('Invalid Android vendor path');
        await copyFile(folder+'/android/vendor/'+artifact.file);
        await copyFile(folder+'/android/vendor/'+artifact.file.replace(/\.(aar|jar)$/,'.pom'));
      }
      await copyTree(folder+'/android/vendor/licenses');
      // Include tool preparation instructions, excluding SDK/JDK caches and private signing keys.
      for (const file of ['prepare.ps1','README.md']) await copyFile('tools/android-build/'+file);
      await copyFile('tools/build-sensors-declaration.mjs');
    }
    // These are declaration defaults, never the installation's saved values.
    validateValues(validateDeclaration(declaration).settings, {}, true);
    if (declaration.id === 'samsung-tv') declaration.settings.find(field => field.id === 'remote-name').help = 'Name presented to the TV by this Localserve installation.';
    await write(folder+'/declaration.json',JSON.stringify(declaration,null,2)+'\n');
    await pluginGuide(declaration);
  }
  // Both configured source and an already clean checkout produce this same
  // generic public reading; an unknown field contract must stop packaging.
  const oculus = 'plugins/oculus-go/server/readings.mjs';
  const readings = await fs.readFile(path.join(stage, oculus),'utf8');
  await write(oculus,sanitizeOculusReadings(readings));

  for (const [name, file] of [['node-tradfri-client','node-tradfri-client-3.2.0.txt'],['node-dtls-client','node-dtls-client-1.1.1.txt'],['alcalzone-shared','alcalzone-shared-4.0.8.txt']]) {
    await write(`plugins/tradfri/vendor/node_modules/${name}/LICENSE`,await fs.readFile(path.join(tooling,'licenses',file)));
  }
  await write('plugins/tradfri/vendor/node_modules/mdns-server/LICENSE-NOTICE.md', '# Upstream license notice\n\nmdns-server 1.0.11 declares MIT in package.json and README.md, both retained.\nAuthor: Bryan Nielsen (@bnielsen1965). Based on multicast-dns by Mathias Buus.\nUpstream source: https://github.com/bnielsen1965/mdns-server/tree/36fa17973899e898c832e87c55aa18e79fddc4e8\nThe published package does not supply a separate full license file.\n');

  const tvFiles = ['config.xml','icon-tv.png','launch-icon.png','index.html','launch.css','launch.js','url-target.js'];
  for (const file of tvFiles) await copyFile('tv-tizen/app/'+file);
  const tvScript = 'tv-tizen/app/launch.js';
  await write(tvScript,(await fs.readFile(path.join(stage,tvScript),'utf8')).replace(/var defaultUrl = '[^']+';/,"var defaultUrl = 'http://192.0.2.1:7041/display';"));
  const tvConfig = 'tv-tizen/app/config.xml';
  await write(tvConfig,(await fs.readFile(path.join(stage,tvConfig),'utf8')).replace('http://hareware.local/homeglance','https://localserve.example/vista').replace(/<tizen:allow-navigation>[^<]+<\/tizen:allow-navigation>/,'<tizen:allow-navigation>http://*:* https://*:*</tizen:allow-navigation>'));
  for (const [target, source] of [['README.md','README.md'],['INSTALL.md','INSTALL.md'],['tv-tizen/README.md','TV-README.md']]) await write(target,await fs.readFile(path.join(tooling,'templates',source)));
  await write('README.md',renderDemoReadme(await fs.readFile(path.join(tooling,'templates/README.md'),'utf8'),JSON.parse(await fs.readFile(path.join(root,'project-info.json'),'utf8'))));
  for (const file of ['USER-GUIDE.md','CONTRIBUTING.md','AGENTS.md','SECURITY.md']) await write(file,await fs.readFile(path.join(tooling,'templates',file)));
  await write('plugins/sensors/android/README.md',await fs.readFile(path.join(tooling,'templates/ANDROID-README.md')));
  await write('PLUGINS.md','# Bundled plugins\n\nAll start disabled with fresh defaults. No live settings or saved Cards are included.\n\n| Plugin | Setup | Ready-made design |\n| --- | --- | --- |\n'+declarations.map(d => `| [${d.name}](plugins/${d.id}/README.md) | ${d.description} | ${d.cardTemplates?.map(t=>t.name).join(', ') || 'Ordinary Cards'} |`).join('\n')+'\n\nProvider access, devices and your own credentials are separate from installing this server.\n');
  await write('tray/README.md','# Windows tray\n\nSee [installation instructions](../INSTALL.md) for portable startup, menu controls, current-user Windows startup, LAN access and removal. Source and executable are included; build.ps1 uses Windows\' .NET Framework compiler and local logo assets.\n');
  await write('config.json',JSON.stringify({name:'Localserve',version,theme:'dark',fontScale:100,vistaFontScale:100,timeFormat:'24',location:null,activityRetentionDays:30,
    doNotDisturb:{enabled:false,scheduleEnabled:false,days:[1,2,3,4,5,6,0],start:'22:00',end:'07:00'},
    listen:{host:'127.0.0.1',port:0},maxConcurrentRuns:8},null,2)+'\n');
  await write('tray/settings.json',JSON.stringify({autoStartServer:true},null,2)+'\n');
  await write('package.json',JSON.stringify({name:'localserve',version,license:'MIT',private:true,type:'module',scripts:{start:'.\\runtime\\node.exe server.mjs',test:'.\\runtime\\node.exe tools/testing/run.mjs','version:check':'.\\runtime\\node.exe tools/version.mjs --check'},engines:{node:'>=24'}},null,2)+'\n');

  await write('.gitignore',await fs.readFile(path.join(tooling,'gitignore.txt')));
  const notices = ['# Third-party notices','', 'Localserve-authored code is licensed under the MIT License in LICENSE. Bundled upstream code/data retains its own terms and notices. Do not remove these when redistributing.','', '- Node.js and bundled components: runtime/LICENSE.txt.', '- Google Material Symbols (Apache-2.0): assets/material-symbols/LICENSE.txt.', '- SunCalc: vendor/suncalc/LICENSE.', '- Three.js r97 (MIT): assets/universe/vendor/three-r97/LICENSE.txt.', '- Timezone catalogue: assets/timezones/LICENSE.txt.', '- Public station catalogue and provider attribution: plugins/hsl-trains/LICENSE.txt.',''];
  async function packages(directory) {
    for (const entry of await fs.readdir(directory,{withFileTypes:true})) {
      const file = path.join(directory,entry.name);
      if (entry.isDirectory()) await packages(file);
      else if (entry.name === 'package.json') {
        const p = JSON.parse(await fs.readFile(file));
        const siblings = await fs.readdir(directory);
        const licenses = siblings.filter(item => /license|copying|copyright|notice/i.test(item));
        if (!licenses.length) throw new Error(`Missing dependency license notice: ${p.name}`);
        notices.push(`- ${p.name} ${p.version} (${p.license || 'see upstream terms'}): ${licenses.map(item=>slash(path.relative(stage,path.join(directory,item)))).join(', ')}.`);
      }
    }
  }
  for (const d of declarations) if (copied.has(`plugins/${d.id}/vendor/packages.json`) || await fs.stat(path.join(stage,'plugins',d.id,'vendor')).then(s=>s.isDirectory(),()=>false)) await packages(path.join(stage,'plugins',d.id,'vendor'));
  notices.push('', 'Provider licenses remain in declarations, plugin guides and packaged attribution files. MPL-licensed ICAL.js includes readable upstream source under plugins/calendar/vendor/ical.js/lib/. Android runtime client libraries and their license metadata are under plugins/sensors/android/vendor/; see vendor/lock.json, vendor/README.md and vendor/licenses/. Build SDK/JDK tools must be prepared separately. No provider credentials or remote artwork are supplied.','');
  await write('THIRD-PARTY-NOTICES.md',notices.join('\n'));
  await audit();
  const files = [];
  for (const file of [...copied].sort()) {
    const bytes = await fs.readFile(path.join(stage,file));
    files.push({path:file,bytes:bytes.length,sha256:sha256(bytes)});
  }
  await write('DISTRIBUTION-MANIFEST.json',JSON.stringify({schemaVersion:1,version,createdAt:new Date().toISOString(),platform:'windows-x64',clean:true,files},null,2)+'\n');
  await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(tooling,'archive.ps1'),'-Mode','Create','-Source',stage,'-Destination',archive],{cwd:root,windowsHide:true,maxBuffer:1024*1024});
  const checksum = sha256(await fs.readFile(archive));
  await fs.writeFile(archive+'.sha256',`${checksum}  ${path.basename(archive)}\n`);
  const after = await definitions();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Live saved definitions changed during packaging; review before publishing.');
  console.log(JSON.stringify({archive:slash(path.relative(root,archive)),sha256:checksum,fileCount:copied.size,uncompressedBytes:files.reduce((sum,file)=>sum+file.bytes,0),zipBytes:(await fs.stat(archive)).size,plugins:declarations.length,liveDefinitionsUnchanged:true}));
} finally {
  // Delete only this run's verified staging directory, never the installation.
  inside(output,workspace);
  await fs.rm(workspace,{recursive:true,force:true});
}
