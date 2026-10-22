/** Source checkouts retain verified asset bytes even with Windows conversion enabled. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

test('Windows Git checkout preserves pinned dependencies and generated stylesheet bytes',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const temporary=path.join(root,'tests/.tmp');await fs.mkdir(temporary,{recursive:true});
  const folder=await fs.mkdtemp(path.join(temporary,'checkout-bytes-'));
  const execute=promisify(execFile);
  const git=async(...args)=>execute('git',args,{cwd:folder,windowsHide:true});
  const files=['.gitattributes','assets/qrcode/qrcodegen.js','styles.css','web/styles/00-foundation.css'];
  const originals=new Map();
  try {
    await git('init','--initial-branch=main');await git('config','core.autocrlf','true');
    for(const file of files){
      const bytes=await fs.readFile(path.join(root,file));originals.set(file,bytes);
      await fs.mkdir(path.dirname(path.join(folder,file)),{recursive:true});
      await fs.writeFile(path.join(folder,file),bytes);
    }
    await git('add','--all');
    for(const file of files)await fs.unlink(path.join(folder,file));
    await git('checkout-index','--all','--force');
    for(const file of files)assert.deepEqual(await fs.readFile(path.join(folder,file)),originals.get(file),file);
  } finally {
    assert.ok(folder.startsWith(temporary+path.sep));await fs.rm(folder,{recursive:true,force:true});
  }
});
