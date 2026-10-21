/** Build a generic, unconfigured Oculus Go APK with project-local tools only. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';

const app=fileURLToPath(new URL('./',import.meta.url)),root=fileURLToPath(new URL('../../../',import.meta.url));
const metadata=JSON.parse(await fs.readFile(path.join(app,'app.json')));
const tools=path.join(root,'tools/android-build'),nativeTools=path.join(root,'tools/oculus-build/ndk/toolchains/llvm/prebuilt/windows-x86_64');
async function onlyDirectory(folder){const directories=(await fs.readdir(folder,{withFileTypes:true})).filter(e=>e.isDirectory());if(directories.length!==1)throw Error('Prepare the project-local Android build tools.');return path.join(folder,directories[0].name);}
const jdk=await onlyDirectory(path.join(tools,'jdk')),sdk=await onlyDirectory(path.join(tools,'build-tools')),platform=await onlyDirectory(path.join(tools,'platform'));
const java=path.join(jdk,'bin/java.exe'),jar=path.join(jdk,'bin/jar.exe'),androidJar=path.join(platform,'android.jar');
const buildBase=path.join(app,'build');await fs.mkdir(buildBase,{recursive:true});const build=await fs.mkdtemp(path.join(buildBase,'apk-'));
for(const directory of ['classes','dex','assets','lib/armeabi-v7a'])await fs.mkdir(path.join(build,directory),{recursive:true});
const privateDirectory=path.join(root,'plugins/oculus-go/data/android-signing');await fs.mkdir(privateDirectory,{recursive:true});
const passwordFile=path.join(privateDirectory,'password.txt'),keystore=path.join(privateDirectory,'localserve-go.p12');
try{await fs.writeFile(passwordFile,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
const environment={...process.env,TMP:build,TEMP:build,TMPDIR:build,LOCALSERVE_GO_PASSWORD:await fs.readFile(passwordFile,'utf8')};
async function run(executable,args){return new Promise((resolve,reject)=>{const child=spawn(executable,args,{cwd:app,env:environment,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});child.on('error',reject);child.on('exit',code=>code===0?resolve(output):reject(Error(path.basename(executable)+' failed:\n'+output)));});}
async function files(folder,extension){const result=[];for(const entry of await fs.readdir(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())result.push(...await files(file,extension));else if(!extension||file.endsWith(extension))result.push(file);}return result;}

// Vendor source, libraries and licenses are hash-locked. A normal build never
// downloads dependencies or embeds this installation's address/credentials.
const vendor=path.join(app,'vendor'),lock=JSON.parse(await fs.readFile(path.join(vendor,'lock.json')));
for(const entry of lock.files){if(entry.file.includes('..')||path.isAbsolute(entry.file))throw Error('Invalid vendor path.');const bytes=await fs.readFile(path.join(vendor,entry.file));if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Vendor checksum failed: '+entry.file);}
await fs.cp(path.join(app,'assets'),path.join(build,'assets'),{recursive:true});
if((await files(path.join(build,'assets'))).some(file=>/connection|pairing|token|\.dpapi|\.jks|\.p12/i.test(path.basename(file))))throw Error('Private connection material cannot be included in the APK.');
await run(path.join(nativeTools,'bin/clang++.exe'),['--target=armv7a-linux-androideabi24','-std=c++17','-O2','-fPIC','-shared','-static-libstdc++','-Wall','-Wextra','-Wno-unused-parameter',
  '-I'+path.join(vendor,'vrapi/Include'),path.join(app,'native/localserve.cpp'),'-L'+path.join(vendor,'vrapi/lib'),'-lvrapi','-lEGL','-lGLESv3','-landroid','-llog','-ljnigraphics','-o',path.join(build,'lib/armeabi-v7a/liblocalserve_go.so')]);
await fs.copyFile(path.join(vendor,'vrapi/lib/libvrapi.so'),path.join(build,'lib/armeabi-v7a/libvrapi.so'));
await run(path.join(sdk,'aapt2.exe'),['compile','--dir','res','-o',path.join(build,'resources.zip')]);
const unsigned=path.join(build,'unsigned.apk'),aligned=path.join(build,'aligned.apk');
await run(path.join(sdk,'aapt2.exe'),['link','-o',unsigned,'-I',androidJar,'--manifest','AndroidManifest.xml','-A',path.join(build,'assets'),path.join(build,'resources.zip')]);
await run(path.join(jdk,'bin/javac.exe'),['-encoding','UTF-8','--release','8','-classpath',androidJar,'-d',path.join(build,'classes'),...await files(path.join(app,'src'),'.java')]);
await run(jar,['--create','--file',path.join(build,'classes.jar'),'-C',path.join(build,'classes'),'.']);
await run(java,['-cp',path.join(sdk,'lib/d8.jar'),'com.android.tools.r8.D8','--release','--min-api','25','--lib',androidJar,'--output',path.join(build,'dex'),path.join(build,'classes.jar')]);
await run(jar,['--update','--file',unsigned,'-C',path.join(build,'dex'),'classes.dex','-C',build,'lib']);
await run(path.join(sdk,'zipalign.exe'),['-f','-p','4',unsigned,aligned]);
try{await fs.access(keystore);}catch(error){if(error.code!=='ENOENT')throw error;await run(path.join(jdk,'bin/keytool.exe'),['-genkeypair','-keystore',keystore,'-storetype','PKCS12','-storepass:env','LOCALSERVE_GO_PASSWORD','-keypass:env','LOCALSERVE_GO_PASSWORD','-alias','localserve-go','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Localserve Go']);}
const output=path.join(app,'dist');await fs.mkdir(output,{recursive:true});const apk=path.join(output,'localserve-go.apk');
await run(java,['-jar',path.join(sdk,'lib/apksigner.jar'),'sign','--ks',keystore,'--ks-key-alias','localserve-go','--ks-pass','env:LOCALSERVE_GO_PASSWORD','--key-pass','env:LOCALSERVE_GO_PASSWORD','--out',apk,aligned]);
const verification=await run(java,['-jar',path.join(sdk,'lib/apksigner.jar'),'verify','--verbose','--print-certs',apk]);
await run(path.join(sdk,'zipalign.exe'),['-c','4',apk]);
const badging=await run(path.join(sdk,'aapt2.exe'),['dump','badging',apk]);
if(!badging.includes("package: name='org.localserve.go'")||!badging.includes("application-label:'# Localserve #'"))throw Error('APK identity or launcher label is incorrect.');
const manifest=await fs.readFile(path.join(app,'AndroidManifest.xml'),'utf8');
if(!manifest.includes('android:versionName="'+metadata.version+'"')||!manifest.includes('android:versionCode="'+metadata.versionCode+'"'))throw Error('APK versions disagree.');
const bytes=await fs.readFile(apk),sha256=createHash('sha256').update(bytes).digest('hex');
const result={packageName:metadata.packageName,version:metadata.version,versionCode:metadata.versionCode,label:metadata.name,minSdk:25,targetSdk:25,abi:'armeabi-v7a',size:bytes.length,sha256,unconfigured:true,signatureVerified:true,verification:verification.trim()};
await fs.writeFile(path.join(output,'verification.json'),JSON.stringify(result,null,2)+'\n');await fs.writeFile(path.join(output,'localserve-go.apk.sha256'),sha256+'  localserve-go.apk\n');
console.log(JSON.stringify(result,null,2));
