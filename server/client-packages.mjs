/** Read bounded package metadata for administration without probing a device. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const version=value=>typeof value==='string'&&/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value)?value:null;
export async function readClientPackages(root) {
  const realRoot=await fs.realpath(root);
  async function bytes(relative,limit){
    const file=await fs.realpath(path.join(root,relative));
    if(!file.startsWith(realRoot+path.sep))throw Error('Package file outside root.');
    const stat=await fs.stat(file);if(!stat.isFile()||stat.size>limit)throw Error('Invalid package file.');
    const value=await fs.readFile(file);if(value.length>limit)throw Error('Package file too large.');return value;
  }
  let android=null,tvLauncherSource=null;
  try {
    const meta=JSON.parse(await bytes('plugins/sensors/android/dist/verification.json',32768));
    if(!version(meta.version)||!Number.isSafeInteger(meta.bytes)||meta.bytes<1||meta.bytes>16*1024*1024||!/^[a-f0-9]{64}$/.test(meta.sha256))throw Error('Invalid APK verification.');
    const apk=await bytes('plugins/sensors/android/dist/localserve-sensors.apk',16*1024*1024);
    if(apk.length!==meta.bytes||createHash('sha256').update(apk).digest('hex')!==meta.sha256)throw Error('APK differs from its verification.');
    android=meta.version;
  } catch { /* Missing or mismatched builds must remain unavailable. */ }
  try {
    const xml=(await bytes('tv-tizen/app/config.xml',32768)).toString('utf8');
    tvLauncherSource=version(/<widget\b[^>]*\sversion="([^"]+)"/.exec(xml.replace(/<!--[\s\S]*?-->/g,''))?.[1]);
  } catch { /* The launcher source is optional, separate from any installed TV app. */ }
  return Object.freeze({android,tvLauncherSource});
}
