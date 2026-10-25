/** Native-client contracts and enrollment checks use no physical headset. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ApkLibrary} from '../server/apk-library.mjs';
import {inspectApk,protectedPackage} from '../plugins/oculus-go/server/apk.mjs';

const root=path.resolve(import.meta.dirname,'..'),app=path.join(root,'plugins/oculus-go/android');
test('native APK identity, signature receipt and generic configuration agree',async()=>{
  const receipt=JSON.parse(await fs.readFile(path.join(app,'dist/verification.json'))),bytes=await fs.readFile(path.join(app,'dist/localserve-go.apk'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),receipt.sha256);
  assert.equal(receipt.unconfigured,true);assert.equal(receipt.signatureVerified,true);assert.equal(receipt.label,'# Sormus #');
  const handle=await fs.open(path.join(app,'dist/localserve-go.apk'),'r');
  try{const parsed=await inspectApk(handle,bytes.length);assert.equal(parsed.packageName,'org.localserve.go');assert.equal(parsed.versionName,receipt.version);assert.equal(parsed.nativeCode,'armeabi-v7a');}finally{await handle.close();}
  const manifest=await fs.readFile(path.join(app,'AndroidManifest.xml'),'utf8');assert.ok(manifest.includes('android:allowBackup="false"'));assert.ok(!manifest.includes('REQUEST_INSTALL_PACKAGES'));assert.ok(protectedPackage('org.localserve.go'));
});
test('client uses Keystore, fixed routes and no embedded or broadcast token configuration',async()=>{
  const files=['MainActivity.java','NetApi.java','ConnectionSettings.java','GoScreen.java'];const source=(await Promise.all(files.map(file=>fs.readFile(path.join(app,'src/org/localserve/go',file),'utf8')))).join('\n');
  assert.ok(source.includes('AndroidKeyStore'));assert.ok(source.includes('AES/GCM/NoPadding'));
  assert.ok(source.includes('setInstanceFollowRedirects(false)'));assert.ok(!source.includes('DatagramSocket'));
  assert.ok(!/\b(?:10\.[0-9.]+|192\.168\.[0-9.]+|172\.(?:1[6-9]|2[0-9]|3[01])\.[0-9.]+)\b/.test(source),'The client must not embed a private LAN address.');
  assert.ok(!source.includes('String.join('));assert.ok(source.includes('review.submitted = true'));
  const assets=await fs.readdir(path.join(app,'assets'));assert.ok(!assets.some(name=>/connection|pairing|token/i.test(name)));
});
test('connection codes are one-use, replaceable, expiring and limited to five guesses',async()=>{
  let clock=1000;const token='synthetic-native-token-for-tests';
  const record={plugin:{actions:[{id:'library-install'}]},config:{snapshot:()=>({revision:1,enabled:true,settings:{'library-enabled':true,'home-vr-enabled':true}})}};
  const library=new ApkLibrary(root,{records:new Map([['oculus-go',record]])},{now:()=>clock,vault:{load:async()=>({token})}});library.clientApp={version:'1.0.0'};
  const peer={headers:{},socket:{remoteAddress:'192.168.1.10'}};
  const first=await library.clientCode(1);assert.match(first.code,/^\d{6}$/);assert.equal(first.expiresAt,301000);
  assert.deepEqual(await library.enroll(peer,{code:first.code}),{token});await assert.rejects(library.enroll(peer,{code:first.code}),/new connection code/);
  const second=await library.clientCode(1);clock=second.expiresAt;await assert.rejects(library.enroll(peer,{code:second.code}),/new connection code/);
  clock=1000;const third=await library.clientCode(1);const wrong=third.code==='000000'?'000001':'000000';
  for(let i=0;i<5;i++)await assert.rejects(library.enroll(peer,{code:wrong}),/incorrect/);
  await assert.rejects(library.enroll(peer,{code:third.code}),/new connection code/);
  const fourth=await library.clientCode(1);
  await assert.rejects(library.enroll({...peer,headers:{origin:'http://example.org'}},{code:fourth.code}),/private LAN/);
  await assert.rejects(library.enroll({...peer,socket:{remoteAddress:'8.8.8.8'}},{code:fourth.code}),/private LAN/);
  assert.deepEqual(await library.enroll(peer,{code:fourth.code}),{token});
});
