/** Build a sideloadable APK entirely with project-local Java/Android tools.
 * Generated signing identity stays private; only the APK is downloadable. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import {androidSourceReceipt} from '../../../tools/android-build/source-receipt.mjs';

const app=fileURLToPath(new URL('./',import.meta.url));
const root=fileURLToPath(new URL('../../../',import.meta.url));
const tools=path.join(root,'tools/android-build');
async function childDirectory(folder) {
  const children=await fs.readdir(folder,{withFileTypes:true});
  const directories=children.filter(child=>child.isDirectory());
  if(directories.length!==1)throw new Error('Run tools/android-build/prepare.ps1 to prepare the pinned tools.');
  return path.join(folder,directories[0].name);
}
const jdk=await childDirectory(path.join(tools,'jdk'));
const sdk=await childDirectory(path.join(tools,'build-tools'));
const platform=await childDirectory(path.join(tools,'platform'));
const buildBase=path.join(app,'build'), output=path.join(app,'dist');
await fs.mkdir(buildBase,{recursive:true});
// A fresh workspace cannot accidentally package removed source classes.
const build=await fs.mkdtemp(path.join(buildBase,'apk-'));
for(const folder of ['classes','generated','dex','test'])await fs.mkdir(path.join(build,folder),{recursive:true});
await fs.mkdir(output,{recursive:true});
const secret=path.join(tools,'private');await fs.mkdir(secret,{recursive:true});
const passwordFile=path.join(secret,'signing-password.txt');
try {await fs.writeFile(passwordFile,randomBytes(32).toString('hex'),{flag:'wx'});} catch(error){if(error.code!=='EEXIST')throw error;}
const password=await fs.readFile(passwordFile,'utf8');
const environment={...process.env,LOCAL_SERVE_APK_PASSWORD:password};
async function run(executable,args) {
  // Windows has a short process-command limit. JDK argument files keep the
  // complete local class/resource graph readable without truncating it.
  if(/(?:java|javac)\.exe$/i.test(executable) && args.join(' ').length>12000) {
    const argumentFile=path.join(build,'arguments-'+randomBytes(6).toString('hex')+'.txt');
    await fs.writeFile(argumentFile,args.map(value=>JSON.stringify(value.replaceAll('\\','/'))).join('\n'));
    args=['@'+argumentFile];
  }
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{cwd:app,env:environment,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let result='';child.stdout.on('data',value=>{result+=value;});child.stderr.on('data',value=>{result+=value;});
    child.on('error',reject);child.on('exit',code=>code===0?resolve(result):reject(new Error(path.basename(executable)+' failed:\n'+result)));
  });
}
const java=path.join(jdk,'bin/java.exe'), jar=path.join(jdk,'bin/jar.exe');
const androidJar=path.join(platform,'android.jar');
// Every Maven artifact is locked and included locally. Verify before compiling;
// never resolve/download dependencies during a normal build.
const vendor=path.join(app,'vendor'),lock=JSON.parse(await fs.readFile(path.join(vendor,'lock.json')));
const libraries=[],resources=[],packages=[],notices=[];
const licenseAssets=path.join(build,'assets','licenses');await fs.mkdir(licenseAssets,{recursive:true});
for(const file of await fs.readdir(path.join(vendor,'licenses')))await fs.copyFile(path.join(vendor,'licenses',file),path.join(licenseAssets,file));
notices.push('Localserve Sensors — Android runtime dependencies\n\n'+lock.artifacts.map(item=>item.group+':'+item.id+':'+item.version+'\n'+item.url+'\n'+item.licenses.map(license=>license.name+' — '+license.url).join('\n')).join('\n\n'));
for(const artifact of lock.artifacts) {
  if(!/^[\w.-]+\.(aar|jar)$/.test(artifact.file))throw new Error('Invalid locked artifact path.');
  const file=path.join(vendor,artifact.file),bytes=await fs.readFile(file);
  if(createHash('sha256').update(bytes).digest('hex')!==artifact.sha256)throw new Error('Vendor hash mismatch: '+artifact.file);
  if(artifact.type==='jar'){libraries.push(file);continue;}
  const destination=path.join(build,artifact.file.replace(/\.aar$/,''));await fs.mkdir(destination);
  const listing=await run(jar,['--list','--file',file]);
  if(listing.split(/\r?\n/).some(entry=>entry && (/^[\\/]|^[A-Za-z]:/.test(entry)||entry.split(/[\\/]/).includes('..'))))throw new Error('Unsafe vendor archive');
  // jar extracts relative to its own process directory; use a contained folder.
  await new Promise((resolve,reject)=>{const child=spawn(jar,['--extract','--file',file],{cwd:destination,windowsHide:true,stdio:'ignore'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Vendor extraction failed')));});
  libraries.push(path.join(destination,'classes.jar'));
  const manifest=await fs.readFile(path.join(destination,'AndroidManifest.xml'),'utf8');
  const name=manifest.match(/\bpackage="([\w.]+)"/)?.[1];if(name)packages.push(name);
  for(const entry of ['third_party_licenses.txt','third_party_licenses.json'])try {
    const text=await fs.readFile(path.join(destination,entry),'utf8');
    await fs.writeFile(path.join(licenseAssets,artifact.id+'-'+entry),text);
    if(entry.endsWith('.txt'))notices.push(artifact.id+' third-party notices\n'+text);
  }catch(error){if(error.code!=='ENOENT')throw error;}
  try {await fs.access(path.join(destination,'res'));const output=path.join(destination,'resources.zip');
    await run(path.join(sdk,'aapt2.exe'),['compile','--dir',path.join(destination,'res'),'-o',output]);resources.push(output);
  } catch(error) {if(error.code!=='ENOENT')throw error;}
}
notices.push(await fs.readFile(path.join(vendor,'licenses','Apache-2.0.txt'),'utf8'));
const termsHtml=await fs.readFile(path.join(vendor,'licenses','Android-SDK-terms.html'),'utf8');
const terms=termsHtml.match(/<div class="sdk-terms">([\s\S]*?)<\/div>/)?.[1];
if(!terms)throw new Error('SDK license text could not be located; original HTML retained.');
const termsText=terms.replace(/<[^>]+>/g,'\n').replace(/&(amp|quot|apos|lt|gt|nbsp);/g,(_,entity)=>({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '})[entity]).replace(/\n{3,}/g,'\n\n').trim();
await fs.writeFile(path.join(licenseAssets,'Android-SDK-terms.txt'),termsText);notices.push(termsText);
await fs.writeFile(path.join(build,'assets','licenses.txt'),notices.join('\n\n'));
await run(path.join(sdk,'aapt2.exe'),['compile','--dir','res','-o',path.join(build,'resources.zip')]);
const unsigned=path.join(build,'unsigned.apk'),aligned=path.join(build,'aligned.apk');
await run(path.join(sdk,'aapt2.exe'),['link','--auto-add-overlay','--extra-packages',packages.join(':'),'-o',unsigned,'-I',androidJar,'--manifest','AndroidManifest.xml','--java',path.join(build,'generated'),'-A',path.join(build,'assets'),...resources.flatMap(file=>['-R',file]),'-R',path.join(build,'resources.zip')]);
// D8 packages bytecode only. Keep ordinary Java resources too: SDK version
// properties, Kotlin built-ins and ServiceLoader provider files are runtime data.
const javaResources=path.join(build,'java-resources');await fs.mkdir(javaResources);
const resourceFiles=new Map();
for(let index=0;index<libraries.length;index++) {
  const library=libraries[index],listing=await run(jar,['--list','--file',library]);
  const entries=listing.split(/\r?\n/).filter(entry=>entry && !entry.endsWith('/') && !entry.endsWith('.class')
    && !/^META-INF\/(?:MANIFEST\.MF|INDEX\.LIST|.*\.(SF|RSA|DSA)|versions\/)/i.test(entry));
  if(entries.some(entry=>/^[\\/]|^[A-Za-z]:/.test(entry)||entry.split(/[\\/]/).includes('..')))throw new Error('Unsafe Java resource path');
  if(!entries.length)continue;
  const destination=path.join(build,'java-resource-'+index);await fs.mkdir(destination);
  await new Promise((resolve,reject)=>{const child=spawn(jar,['--extract','--file',library,...entries],{cwd:destination,windowsHide:true,stdio:'ignore'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Java resource extraction failed')));});
  for(const entry of entries) {
    const bytes=await fs.readFile(path.join(destination,entry));if(bytes.length>5000000)throw new Error('Java resource exceeds limit');
    if(resourceFiles.has(entry) && !resourceFiles.get(entry).equals(bytes)) {
      if(entry.startsWith('META-INF/services/'))resourceFiles.set(entry,Buffer.from([...new Set((resourceFiles.get(entry).toString()+'\n'+bytes.toString()).split(/\r?\n/).filter(Boolean))].join('\n')+'\n'));
      else if(entry.startsWith('META-INF/com.android.tools/proguard/') || entry.startsWith('META-INF/proguard/'))resourceFiles.set(entry,Buffer.concat([resourceFiles.get(entry),Buffer.from('\n'),bytes]));
      else if(!/license|notice|copyright/i.test(entry))throw new Error('Conflicting Java resource: '+entry);
    }else resourceFiles.set(entry,bytes);
  }
}
for(const [name,bytes] of resourceFiles) {const target=path.join(javaResources,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);}
await run(jar,['--update','--file',unsigned,'-C',javaResources,'.']);
async function files(folder,extension) {
  const result=[];for(const entry of await fs.readdir(folder,{withFileTypes:true})) {
    const file=path.join(folder,entry.name);if(entry.isDirectory())result.push(...await files(file,extension));else if(file.endsWith(extension))result.push(file);
  }return result;
}
await run(path.join(jdk,'bin/javac.exe'),['-encoding','UTF-8','--release','8','-classpath',[androidJar,...libraries].join(path.delimiter),'-d',path.join(build,'classes'),
  ...await files(path.join(app,'src'),'.java'),...await files(path.join(build,'generated'),'.java')]);
await run(path.join(jdk,'bin/javac.exe'),['-encoding','UTF-8','--release','8','-classpath',androidJar+path.delimiter+path.join(build,'classes'),'-d',path.join(build,'test'),...await files(path.join(app,'test'),'.java')]);
const addressCheck=await run(java,['-cp',[path.join(build,'test'),path.join(build,'classes'),androidJar].join(path.delimiter),'local.localserve.sensors.ServerAddressTest']);
const regionCheck=await run(java,['-cp',[path.join(build,'test'),path.join(build,'classes')].join(path.delimiter),'local.localserve.sensors.RegionRulesTest']);
const dependencyCheck=await run(java,['-cp',[path.join(build,'test'),path.join(build,'classes'),androidJar,...libraries].join(path.delimiter),'local.localserve.sensors.DependenciesTest']);
const homeCheck=await run(java,['-cp',[path.join(build,'test'),path.join(build,'classes')].join(path.delimiter),'local.localserve.sensors.HomePolicyTest']);
const diagnostics=await run(java,['-cp',path.join(sdk,'lib/d8.jar'),'com.android.tools.r8.D8','--min-api','26','--lib',androidJar,'--output',path.join(build,'dex'),...await files(path.join(build,'classes'),'.class'),...libraries]);
await fs.writeFile(path.join(build,'dex-diagnostics.txt'),diagnostics);
if(/was not found|Missing class/i.test(diagnostics))throw new Error('DEX reports a missing runtime class; inspect the build diagnostics.');
for(const dex of await files(path.join(build,'dex'),'.dex'))await run(jar,['--update','--file',unsigned,'-C',path.join(build,'dex'),path.basename(dex)]);
await run(path.join(sdk,'zipalign.exe'),['-f','4',unsigned,aligned]);
const key=path.join(secret,'sensors-signing.p12');
try {await fs.access(key);} catch {
  await run(path.join(jdk,'bin/keytool.exe'),['-genkeypair','-keystore',key,'-storetype','PKCS12','-storepass:env','LOCAL_SERVE_APK_PASSWORD',
    '-keypass:env','LOCAL_SERVE_APK_PASSWORD','-alias','sensors','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Localserve Sensors Development']);
}
const apk=path.join(output,'localserve-sensors.apk');
const signed=path.join(build,'signed.apk');
await run(java,['-jar',path.join(sdk,'lib/apksigner.jar'),'sign','--ks',key,'--ks-pass','env:LOCAL_SERVE_APK_PASSWORD','--ks-key-alias','sensors','--out',signed,aligned]);
const verification=await run(java,['-jar',path.join(sdk,'lib/apksigner.jar'),'verify','--verbose','--print-certs',signed]);
const bytes=await fs.readFile(signed);
// Publish only the complete verified APK; an in-progress build stays private.
await fs.rename(signed,apk);
const report={file:'plugins/sensors/android/dist/localserve-sensors.apk',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),
  minSdk:26,targetSdk:35,version:(await fs.readFile(path.join(app,'AndroidManifest.xml'),'utf8')).match(/android:versionName="([^"]+)"/)[1],sourceReceipt:await androidSourceReceipt(root,'plugins/sensors/android'),vendorArtifacts:lock.artifacts.length,javaResources:resourceFiles.size,checks:[addressCheck.trim(),regionCheck.trim(),dependencyCheck.trim(),homeCheck.trim(),'No missing DEX runtime classes'],verification:verification.trim()};
await fs.writeFile(path.join(output,'verification.json'),JSON.stringify(report,null,2)+'\n');
await fs.writeFile(path.join(output,'localserve-sensors.apk.sha256'),report.sha256+'  localserve-sensors.apk\n');
console.log(JSON.stringify(report,null,2));
