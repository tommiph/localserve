/** The standalone client download contains only the verified distributable APK. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {HttpError} from './storage.mjs';

export async function readScenesApk(root) {
  try {
    const base=await fs.realpath(root);
    async function read(relative,limit) {
      const file=await fs.realpath(path.join(base,relative)),stat=await fs.stat(file);
      if(!file.startsWith(base+path.sep)||!stat.isFile()||stat.size>limit)throw Error('Invalid package file.');
      const bytes=await fs.readFile(file);
      if(bytes.length>limit)throw Error('Package file exceeds its limit.');
      return bytes;
    }
    const meta=JSON.parse(await read('apps/scenes/dist/verification.json',32768));
    if(meta.package!=='local.localserve.scenes'||meta.name!=='Scenes'||!/^\d+\.\d+\.\d+$/.test(meta.version)
      ||!Number.isSafeInteger(meta.bytes)||meta.bytes<1||meta.bytes>4*1024*1024||!/^[a-f0-9]{64}$/.test(meta.sha256))throw Error('Invalid package metadata.');
    const bytes=await read('apps/scenes/dist/scenes.apk',4*1024*1024);
    if(bytes.length!==meta.bytes||createHash('sha256').update(bytes).digest('hex')!==meta.sha256)throw Error('Package does not match its verification.');
    return bytes;
  } catch { throw new HttpError(404,'Scenes app unavailable. Build the standalone Scenes APK first.'); }
}
