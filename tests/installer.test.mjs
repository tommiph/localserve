/** Installer inputs and README metadata are public, never installed settings. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {installerFiles} from '../tools/installer/build.mjs';
import {renderDemoReadme} from '../tools/distribution/readme.mjs';

test('installer file list excludes settings seeds and rejects unsafe names',()=>{
  const value=installerFiles({files:[{path:'config.json'},{path:'tray/settings.json'},{path:'server.mjs'},{path:'plugins/example/declaration.json'}]});
  assert.doesNotMatch(value,/settings\.json|config\.json/);assert.match(value,/plugins\\example\\declaration\.json/);assert.match(value,/ignoreversion/);
  for(const path of ['../secret','C:/private','bad"name','folder\\private'])assert.throws(()=>installerFiles({files:[{path}]}));
});
test('demo link updates one README block from public metadata',()=>{
  const original='# Localserve\n\nProduct guide.\n',metadata={demoVideoUrl:'https://youtu.be/iRawtvXB6DQ'};
  const first=renderDemoReadme(original,metadata);assert.match(first,/https:\/\/youtu.be\/iRawtvXB6DQ/);assert.equal(renderDemoReadme(first,metadata),first);
  const next=renderDemoReadme(first,{demoVideoUrl:'https://youtu.be/abcdefghijk'});assert.equal((next.match(/demo:start/g)||[]).length,1);assert.doesNotMatch(next,/iRawtvXB6DQ/);assert.match(next,/Product guide/);
  for(const demoVideoUrl of ['http://youtu.be/iRawtvXB6DQ','https://example.com/iRawtvXB6DQ','https://youtu.be/iRawtvXB6DQ?secret=value'])assert.throws(()=>renderDemoReadme(original,{demoVideoUrl}));
});
test('setup defaults remain per-user and preserve private data; compiler is pinned',async()=>{
  const script=await fs.readFile(new URL('../tools/installer/localserve.iss',import.meta.url),'utf8'),lock=JSON.parse(await fs.readFile(new URL('../tools/installer/compiler-lock.json',import.meta.url)));
  assert.match(script,/PrivilegesRequired=lowest/);assert.match(script,/CloseApplications=no/);assert.match(script,/Flags: unchecked/);assert.match(script,/--stop-and-exit/);assert.match(script,/MB_DEFBUTTON2/);assert.match(script,/ValidateDestination/);assert.match(lock.sha256,/^[a-f0-9]{64}$/);assert.match(lock.url,/^https:\/\/github\.com\/jrsoftware\/issrc\/releases\/download\//);
});
