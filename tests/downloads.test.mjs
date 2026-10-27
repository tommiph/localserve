/** Fixed-file downloads use synthetic packages; no SDK or device is contacted. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createLocalserve} from '../server.mjs';
import {downloadCatalogue,productDownload,sourceZip} from '../server/downloads.mjs';

async function fixture(t){
  const base=path.resolve(import.meta.dirname,'.tmp');await fs.mkdir(base,{recursive:true});
  const root=await fs.mkdtemp(path.join(base,'downloads-'));
  const write=async(file,bytes)=>{await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),bytes);};
  const apk=Buffer.from('Synthetic Controller package');
  await write('plugins/sensors/android/AndroidManifest.xml','<manifest android:versionName="2.3.4"/>');
  await write('plugins/sensors/android/dist/localserve-sensors.apk',apk);
  await write('plugins/sensors/android/dist/verification.json',JSON.stringify({version:'2.3.4',bytes:apk.length,sha256:createHash('sha256').update(apk).digest('hex'),private:'DO NOT EXPOSE'}));
  t.after(async()=>{assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});
  return {root,write,apk};
}
test('catalogue lists one phone app, separates headset/source files and omits private metadata',async t=>{
  const f=await fixture(t),items=await downloadCatalogue(f.root);
  assert.equal(items.filter(item=>item.platform==='Android phone').length,1);
  const controller=items.find(item=>item.id==='controller');assert.equal(controller.version,'2.3.4');assert.equal(controller.available,true);
  assert.equal(items.find(item=>item.id==='oculus-go').available,false);
  assert.doesNotMatch(JSON.stringify(items),/DO NOT EXPOSE|verification.json|\/data\//);
  await f.write('plugins/sensors/android/dist/localserve-sensors.apk',Buffer.from('Tampered'));
  assert.equal((await downloadCatalogue(f.root)).find(item=>item.id==='controller').available,false);
});
test('widget versions come from bounded package entries and outdated builds are unavailable',async t=>{
  const f=await fixture(t),config=Buffer.from('<widget version="1.2.3"/>');
  await f.write('tv-tizen/app/config.xml',config);
  await f.write('tv-tizen/dist/Vista.wgt',sourceZip([['config.xml',config],['author-signature.xml',Buffer.from('Synthetic')],['signature1.xml',Buffer.from('Synthetic')]]));
  assert.equal((await productDownload(f.root,'vistas-tv')).version,'1.2.3');
  await f.write('tv-tizen/app/config.xml','<widget version="1.2.4"/>');
  assert.equal((await downloadCatalogue(f.root)).find(item=>item.id==='vistas-tv').available,false);
  assert.throws(()=>sourceZip([['../private',Buffer.alloc(0)]]));
  await assert.rejects(productDownload(f.root,'../../config.json'),/Download not found/);
});
test('download routes preserve HEAD semantics, attachment identity and missing-file boundaries',async t=>{
  const f=await fixture(t),app=await createLocalserve(f.root,{automatic:false});
  try {
  const url=app.origin+'/downloads/controller.apk';
  const response=await fetch(url);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.apk);
  assert.match(response.headers.get('content-disposition'),/controller.apk/);
  const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(f.apk.length));assert.equal((await head.arrayBuffer()).byteLength,0);
  assert.equal((await fetch(url+'?file=config.json')).status,400);
  assert.equal((await fetch(url,{method:'POST'})).status,405);
  const index=await fetch(app.origin+'/api/downloads').then(response=>response.json());assert.equal(index.items.length,9);
  assert.equal(index.items.find(item=>item.id==='launcher-tv').available,false);
  assert.equal(index.items.find(item=>item.id==='launcher-source').platform,'Samsung Tizen TV');
  const legacy=await fetch(app.origin+'/sensors',{redirect:'manual'});assert.equal(legacy.status,307);assert.equal(legacy.headers.get('location'),'/downloads');
  } finally {await app.close();}
});
