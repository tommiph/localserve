/** Protect the local snapshot key with Windows CurrentUser DPAPI. No secret arguments. */
import {spawn} from 'node:child_process';
const script = `Add-Type -AssemblyName System.Security; $v=[Console]::ReadLine(); if($v.Length -gt 4096){exit 2}; $b=[Convert]::FromBase64String($v); $e=[Text.Encoding]::UTF8.GetBytes('Sormus.Backups.v1'); try { $r=[Security.Cryptography.ProtectedData]::OPERATION($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($r)) } catch {exit 2}`;
export function protectBackupKey(value,operation){
  if(process.platform!=='win32'||!['Protect','Unprotect'].includes(operation)||value.length>2048)throw Error('Local backups require Windows account protection.');
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script.replace('OPERATION',operation)],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='',settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result);};
    const timer=setTimeout(()=>{child.stdin.end();finish(Error('Windows backup key protection timed out.'));},15000);
    child.stdout.on('data',chunk=>{output+=chunk.toString('ascii');if(output.length>4096)finish(Error('Invalid protected backup key.'));});
    child.stderr.resume();child.stdin.on('error',()=>{});child.on('error',()=>finish(Error('Windows backup key protection is unavailable.')));
    child.on('close',code=>{if(code!==0||!output||!/^[A-Za-z0-9+/]+={0,2}$/.test(output))finish(Error('Backups cannot be unlocked by this Windows account.'));else finish(null,Buffer.from(output,'base64'));});
    child.stdin.end(Buffer.from(value).toString('base64')+'\n');
  });
}
