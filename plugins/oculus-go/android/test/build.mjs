/** Build the opt-in instrumentation APK. Does not contact any headset. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const app = fileURLToPath(new URL('../', import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const tools = path.join(root, 'tools/android-build');

async function onlyDirectory(folder) {
  const folders = (await fs.readdir(folder, {withFileTypes: true})).filter(entry => entry.isDirectory());
  if (folders.length !== 1) throw Error('Prepare the project-local Android tools.');
  return path.join(folder, folders[0].name);
}

const jdk = await onlyDirectory(path.join(tools, 'jdk'));
const sdk = await onlyDirectory(path.join(tools, 'build-tools'));
const platform = await onlyDirectory(path.join(tools, 'platform'));
const java = path.join(jdk, 'bin/java.exe');
const jar = path.join(jdk, 'bin/jar.exe');
const androidJar = path.join(platform, 'android.jar');
const builds = [];
for (const entry of await fs.readdir(path.join(app, 'build'), {withFileTypes: true})) {
  if (!entry.isDirectory() || !entry.name.startsWith('apk-')) continue;
  const folder = path.join(app, 'build', entry.name);
  try { builds.push({folder, time: (await fs.stat(path.join(folder, 'classes.jar'))).mtimeMs}); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
builds.sort((a, b) => b.time - a.time);
if (!builds.length) throw Error('Build the main APK first.');
const main = builds[0].folder;
const build = await fs.mkdtemp(path.join(app, 'build/probe-'));
for (const name of ['classes', 'dex']) await fs.mkdir(path.join(build, name));
const signing = path.join(root, 'plugins/oculus-go/data/android-signing');
const environment = {
  ...process.env, TEMP: build, TMP: build,
  LOCALSERVE_GO_PASSWORD: await fs.readFile(path.join(signing, 'password.txt'), 'utf8'),
};

async function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {cwd: app, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    child.stdout.on('data', bytes => { output += bytes; });
    child.stderr.on('data', bytes => { output += bytes; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(output) : reject(Error(path.basename(executable) + ' failed:\n' + output)));
  });
}

await run(path.join(jdk, 'bin/javac.exe'), [
  '-encoding', 'UTF-8', '--release', '8', '-classpath', androidJar + path.delimiter + path.join(main, 'classes'),
  '-d', path.join(build, 'classes'), path.join(app, 'test/GoSmoke.java'),
]);
await run(jar, ['--create', '--file', path.join(build, 'classes.jar'), '-C', path.join(build, 'classes'), '.']);
await run(java, [
  '-cp', path.join(sdk, 'lib/d8.jar'), 'com.android.tools.r8.D8', '--release', '--min-api', '25',
  '--lib', androidJar, '--classpath', path.join(main, 'classes.jar'), '--output', path.join(build, 'dex'), path.join(build, 'classes.jar'),
]);
await run(path.join(sdk, 'aapt2.exe'), [
  'link', '-o', path.join(build, 'unsigned.apk'), '-I', androidJar, '--manifest', path.join(app, 'test/AndroidManifest.xml'),
]);
await run(jar, ['--update', '--file', path.join(build, 'unsigned.apk'), '-C', path.join(build, 'dex'), 'classes.dex']);
await run(path.join(sdk, 'zipalign.exe'), ['-f', '4', path.join(build, 'unsigned.apk'), path.join(build, 'aligned.apk')]);
await run(java, [
  '-jar', path.join(sdk, 'lib/apksigner.jar'), 'sign', '--ks', path.join(signing, 'localserve-go.p12'),
  '--ks-key-alias', 'localserve-go', '--ks-pass', 'env:LOCALSERVE_GO_PASSWORD',
  '--out', path.join(build, 'probe.apk'), path.join(build, 'aligned.apk'),
]);
await run(java, ['-jar', path.join(sdk, 'lib/apksigner.jar'), 'verify', path.join(build, 'probe.apk')]);
const result = {apk: path.relative(root, path.join(build, 'probe.apk'))};
await fs.writeFile(path.join(app, 'build/probe.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
