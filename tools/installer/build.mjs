/** Compile only an already verified clean ZIP. Compiler caches and installed
 * preferences are never included in the setup payload. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url)),execute=promisify(execFile),output=path.join(root,'dist');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function installerFiles(manifest){
  return manifest.files.filter(file=>!['config.json','tray/settings.json'].includes(file.path)).map(file=>{
    if(file.path.includes('"')||file.path.includes('..')||file.path.includes(':')||file.path.includes('\\')||file.path.startsWith('/'))throw Error('Invalid installer file path.');
    const parts=file.path.split('/'),name=parts.pop(),directory=parts.join('\\');
    return `Source: "{#Payload}\\${file.path.replaceAll('/','\\')}"; DestDir: "{app}${directory?'\\'+directory:''}"; Flags: ignoreversion`;
  }).join('\n');
}
export async function buildInstaller(archive,{test=false}={}){
  await fs.mkdir(path.join(root,'work'),{recursive:true});
  archive=path.resolve(root,archive);assert.ok(archive.startsWith(output+path.sep)&&archive.endsWith('.zip'));
  const verification=JSON.parse(await fs.readFile(archive+'.verification.json','utf8')),bytes=await fs.readFile(archive);assert.equal(verification.sha256,hash(bytes));assert.equal(verification.archiveHashesVerified,true);assert.equal(verification.privateStateExcluded,true);
  const workspace=await fs.mkdtemp(path.join(output,'.installer-'));
  try{
    await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'tools/distribution/archive.ps1'),'-Mode','Extract','-Source',archive,'-Destination',workspace],{windowsHide:true});
    const payload=path.join(workspace,'Localserve'),manifest=JSON.parse(await fs.readFile(path.join(payload,'DISTRIBUTION-MANIFEST.json'),'utf8'));
    for(const file of manifest.files){const target=path.resolve(payload,file.path);assert.ok(target.startsWith(payload+path.sep));assert.equal(hash(await fs.readFile(target)),file.sha256);}
    const list=path.join(workspace,'files.iss');await fs.writeFile(list,installerFiles(manifest));
    const name=`Localserve-${manifest.version}-${test?'InstallTest':'Setup'}`;
    const args=[`/DAppVersion=${manifest.version}`,`/DPayload=${payload}`,`/DFileList=${list}`,`/DOutputDir=${output}`,`/DOutputName=${name}`];
    if(test)args.push('/DProductId=Localserve.Windows.InstallTest','/DShortcutGroup=Localserve Install Test');
    args.push(path.join(root,'tools/installer/localserve.iss'));
    const compiled=await execute(path.join(root,'tools/installer/compiler/ISCC.exe'),args,{cwd:root,windowsHide:true,maxBuffer:4*1024*1024});
    await fs.writeFile(path.join(root,'work/installer-build-log.txt'),compiled.stdout);
    const file=path.join(output,name+'.exe'),sha256=hash(await fs.readFile(file));await fs.writeFile(file+'.sha256',sha256+'  '+path.basename(file)+'\n');
    const result={installer:path.relative(root,file).replaceAll('\\','/'),version:manifest.version,sha256,archiveSha256:verification.sha256,payloadFiles:manifest.files.length-2,privateSeedsExcluded:true,testIdentity:test,signed:false};
    await fs.writeFile(file+'.build.json',JSON.stringify(result,null,2)+'\n');return result;
  }finally{assert.ok(workspace.startsWith(output+path.sep));await fs.rm(workspace,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await buildInstaller(process.argv[2],{test:process.argv.includes('--test-identity')})));}
  catch(error){await fs.writeFile(path.join(root,'work/installer-build-error.txt'),String(error.stderr||error.message)+'\n'+String(error.stdout||''));console.error(error.stderr||error.message);process.exitCode=1;}
}
