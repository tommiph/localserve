/** APK delivery and the single-page client boundary use disposable data only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {selectorFixture} from './fixtures/scene-selector.mjs';
import {assertPublicPath} from '../tools/distribution/boundary.mjs';

test('Scenes is independently downloadable with matching verification, no Sensors plugin or configured data',async t=>{
  const f=await selectorFixture();t.after(()=>f.close());
  assert.equal((await fetch(f.app.origin+'/downloads/scenes.apk')).status,404);
  const dist=path.join(f.root,'apps/scenes/dist');await fs.mkdir(dist,{recursive:true});
  const bytes=Buffer.from('Synthetic Scenes APK'),meta={package:'local.localserve.scenes',name:'Scenes',version:'1.0.0',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  await fs.writeFile(path.join(dist,'scenes.apk'),bytes);await fs.writeFile(path.join(dist,'verification.json'),JSON.stringify(meta));
  const response=await fetch(f.app.origin+'/downloads/scenes.apk');assert.equal(response.status,200);
  assert.equal(response.headers.get('content-disposition'),'attachment; filename="scenes.apk"');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  const head=await fetch(f.app.origin+'/downloads/scenes.apk',{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(bytes.length));assert.equal((await head.arrayBuffer()).byteLength,0);
  assert.notEqual((await fetch(f.app.origin+'/downloads/scenes.apk?path=config.json')).status,200);
  assert.notEqual((await fetch(f.app.origin+'/downloads/scenes.apk',{method:'POST'})).status,200);
  assert.notEqual((await fetch(f.app.origin+'/apps/scenes/dist/verification.json')).status,200);
  await fs.appendFile(path.join(dist,'scenes.apk'),'changed');assert.equal((await fetch(f.app.origin+'/downloads/scenes.apk')).status,404);
});
test('Scenes identity and icons are separate, local and white/black; build/signing inputs remain private',async()=>{
  const manifest=await fs.readFile(new URL('../apps/scenes/AndroidManifest.xml',import.meta.url),'utf8');
  assert.match(manifest,/package="local.localserve.scenes"/);assert.match(manifest,/android:label="Scenes"/);
  assert.deepEqual([...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map(m=>m[1]),['android.permission.INTERNET']);
  assert.doesNotMatch(manifest,/<service|<receiver|local\.localserve\.sensors/);
  const icon=await fs.readFile(new URL('../assets/scenes/app-icon.svg',import.meta.url),'utf8');
  assert.match(icon,/<rect[^>]+fill="white"/);assert.match(icon,/fill="black"/);assert.doesNotMatch(icon,/c2pa|<metadata/);
  assertPublicPath('apps/scenes/dist/scenes.apk');assertPublicPath('apps/scenes/src/local/localserve/scenes/ScenesActivity.java');
  for(const file of ['apps/scenes/build/apk-a/classes.dex','tools/android-build/private/scenes-signing.p12','apps/scenes/private/server.json'])assert.throws(()=>assertPublicPath(file));
  const source=await fs.readFile(new URL('../apps/scenes/src/local/localserve/scenes/ScenesActivity.java',import.meta.url),'utf8');
  assert.match(source,/origin \+ "\/scenes"/);assert.match(source,/setAllowFileAccess\(false\)/);assert.doesNotMatch(source,/addJavascriptInterface|SslErrorHandler[^\n]*proceed|startForegroundService/);
});
test('Scenes loading surfaces remain dark while the white launcher stays independent',async()=>{
  for(const folder of ['values','values-v31']){
    const theme=await fs.readFile(new URL('../apps/scenes/res/'+folder+'/styles.xml',import.meta.url),'utf8');
    for(const attribute of ['windowBackground','statusBarColor','navigationBarColor'])assert.match(theme,new RegExp('name="android:'+attribute+'">#000000<'));
    assert.match(theme,/name="android:windowLightStatusBar">false</);
    if(folder==='values-v31'){
      assert.match(theme,/name="android:windowSplashScreenBackground">#000000</);
      assert.match(theme,/name="android:windowSplashScreenAnimatedIcon">@drawable\/scenes_splash</);
    }
  }
  const splash=await fs.readFile(new URL('../apps/scenes/res/drawable/scenes_splash.png',import.meta.url));
  assert.deepEqual(splash,await fs.readFile(new URL('../assets/controls/app-icon-512.png',import.meta.url)));
  assert.notDeepEqual(splash,await fs.readFile(new URL('../apps/scenes/res/drawable/scenes_icon.png',import.meta.url)));
  const source=await fs.readFile(new URL('../apps/scenes/src/local/localserve/scenes/ScenesActivity.java',import.meta.url),'utf8');
  assert.doesNotMatch(source,/setBackgroundColor\(Color.WHITE\)|SYSTEM_UI_FLAG_LIGHT_/);
  assert.match(source,/postVisualStateCallback/);assert.match(source,/current != generation \|\| view != web/);
});
