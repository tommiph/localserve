/** Build the standalone Scenes APK with project-local Android tools. Signing
 * identity is persistent and private; no configured server address is bundled. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {androidSourceReceipt} from '../../tools/android-build/source-receipt.mjs';
const app=fileURLToPath(new URL('./',import.meta.url));
const root=fileURLToPath(new URL('../../',import.meta.url));
const tools=path.join(root,'tools/android-build');
async function childDirectory(folder){
  const directories=(await fs.readdir(folder,{withFileTypes:true})).filter(entry=>entry.isDirectory());
  if(directories.length!==1)throw Error('Prepare the project-local tools with tools/android-build/prepare.ps1.');
  return path.join(folder,directories[0].name);
}
const jdk=await childDirectory(path.join(tools,'jdk')),sdk=await childDirectory(path.join(tools,'build-tools'));
const androidJar=path.join(await childDirectory(path.join(tools,'platform')),'android.jar');
const buildBase=path.join(app,'build'),output=path.join(app,'dist'),secret=path.join(tools,'private');
for(const folder of [buildBase,output,secret])await fs.mkdir(folder,{recursive:true});
const build=await fs.mkdtemp(path.join(buildBase,'apk-'));
for(const folder of ['generated','classes','dex','test'])await fs.mkdir(path.join(build,folder));
const passwordFile=path.join(secret,'scenes-signing-password.txt');
try{await fs.writeFile(passwordFile,randomBytes(32).toString('hex'),{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
const environment={...process.env,LOCALSERVE_SCENES_PASSWORD:await fs.readFile(passwordFile,'utf8')};
async function run(executable,args){
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{cwd:app,env:environment,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let text='';child.stdout.on('data',data=>text+=data);child.stderr.on('data',data=>text+=data);
    child.on('error',reject);child.on('exit',code=>code===0?resolve(text):reject(Error(path.basename(executable)+' failed:\n'+text)));
  });
}
async function files(folder,suffix){
  const result=[];
  for(const entry of await fs.readdir(folder,{withFileTypes:true})){
    const file=path.join(folder,entry.name);
    if(entry.isDirectory())result.push(...await files(file,suffix));else if(file.endsWith(suffix))result.push(file);
  }
  return result;
}
const java=path.join(jdk,'bin/java.exe'),javac=path.join(jdk,'bin/javac.exe');
const unsigned=path.join(build,'unsigned.apk'),aligned=path.join(build,'aligned.apk'),signed=path.join(build,'signed.apk');
await run(path.join(sdk,'aapt2.exe'),['compile','--dir','res','-o',path.join(build,'resources.zip')]);
await run(path.join(sdk,'aapt2.exe'),['link','--auto-add-overlay','-o',unsigned,'-I',androidJar,'--manifest','AndroidManifest.xml','--java',path.join(build,'generated'),'-R',path.join(build,'resources.zip')]);
await run(javac,['-encoding','UTF-8','--release','8','-classpath',androidJar,'-d',path.join(build,'classes'),...await files(path.join(app,'src'),'.java'),...await files(path.join(build,'generated'),'.java')]);
await run(javac,['-encoding','UTF-8','--release','8','-classpath',path.join(build,'classes'),'-d',path.join(build,'test'),...await files(path.join(app,'test'),'.java')]);
const checks=await run(java,['-cp',[path.join(build,'classes'),path.join(build,'test')].join(path.delimiter),'local.localserve.scenes.ScenesPolicyTest']);
const diagnostics=await run(java,['-cp',path.join(sdk,'lib/d8.jar'),'com.android.tools.r8.D8','--min-api','26','--lib',androidJar,'--output',path.join(build,'dex'),...await files(path.join(build,'classes'),'.class')]);
if(/was not found|Missing class/i.test(diagnostics))throw Error('DEX reports a missing runtime class.');
await run(path.join(jdk,'bin/jar.exe'),['--update','--file',unsigned,'-C',path.join(build,'dex'),'classes.dex']);
await run(path.join(sdk,'zipalign.exe'),['-f','4',unsigned,aligned]);
const key=path.join(secret,'scenes-signing.p12');
try{await fs.access(key);}catch{
  await run(path.join(jdk,'bin/keytool.exe'),['-genkeypair','-keystore',key,'-storetype','PKCS12','-storepass:env','LOCALSERVE_SCENES_PASSWORD','-keypass:env','LOCALSERVE_SCENES_PASSWORD','-alias','scenes','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Localserve Scenes']);
}
await run(java,['-jar',path.join(sdk,'lib/apksigner.jar'),'sign','--ks',key,'--ks-pass','env:LOCALSERVE_SCENES_PASSWORD','--ks-key-alias','scenes','--out',signed,aligned]);
const verification=await run(java,['-jar',path.join(sdk,'lib/apksigner.jar'),'verify','--verbose','--print-certs',signed]);
const badging=await run(path.join(sdk,'aapt2.exe'),['dump','badging',signed]);
if(!badging.includes("package: name='local.localserve.scenes'")||!badging.includes("application-label:'Scenes'"))throw Error('Unexpected APK identity.');
const manifest=await fs.readFile(path.join(app,'AndroidManifest.xml'),'utf8');
const version=manifest.match(/android:versionName="([^"]+)"/)[1],versionCode=Number(manifest.match(/android:versionCode="([^"]+)"/)[1]);
const bytes=await fs.readFile(signed),sha256=createHash('sha256').update(bytes).digest('hex');
await fs.rename(signed,path.join(output,'scenes.apk'));
const report={file:'apps/scenes/dist/scenes.apk',package:'local.localserve.scenes',name:'Scenes',version,versionCode,minSdk:26,targetSdk:35,bytes:bytes.length,sha256,sourceReceipt:await androidSourceReceipt(root,'apps/scenes'),checks:checks.trim(),verification:verification.trim()};
await fs.writeFile(path.join(output,'verification.json'),JSON.stringify(report,null,2)+'\n');
await fs.writeFile(path.join(output,'scenes.apk.sha256'),sha256+'  scenes.apk\n');
console.log(JSON.stringify(report,null,2));
