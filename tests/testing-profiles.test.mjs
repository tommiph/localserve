/** Test selection never reads installed settings or runs a device adapter. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import {selectTests,coreTests} from '../tools/testing/profiles.mjs';
import {publicTests} from '../tools/testing/public-tests.mjs';
const execute=promisify(execFile);
test('default and explicit full retain every public check; listing does not narrow it',()=>{
  assert.deepEqual(selectTests().files,[...publicTests]);
  assert.deepEqual(selectTests(['--full']).files,[...publicTests]);
  assert.deepEqual(selectTests(['--list']).files,[...publicTests]);
  assert.equal(selectTests(['--full','--list']).list,true);
});
test('focused names and Windows-relative paths select only known files; activation adds core once',()=>{
  assert.deepEqual(selectTests(['--focused','tradfri','tests\\gateway-scenes.test.mjs']).files,
    publicTests.filter(file=>['tests/tradfri.test.mjs','tests/gateway-scenes.test.mjs'].includes(file)));
  const selection=selectTests(['--activate','tradfri','controls','tradfri']);
  assert.equal(selection.files.length,new Set([...coreTests,'tests/tradfri.test.mjs']).size);
  assert.ok(coreTests.every(file=>selection.files.includes(file)));
  assert.deepEqual(selectTests(['--core']).files,publicTests.filter(file=>coreTests.includes(file)));
});
test('empty focus, unknown flags and private/arbitrary paths fail instead of running a misleading selection',()=>{
  for(const args of [['--focused'],['--activate'],['--changed'],['--core','tradfri'],['--full','tradfri'],
    ['--focused','missing'],['--focused','../work/private.mjs'],['--focused','C:/test.mjs'],
    ['--focused','--full'],['--full','--list','--list']])assert.throws(()=>selectTests(args),args.join(' '));
});
test('CLI prints selections and fails invalid requests without starting a suite',async()=>{
  const result=await execute(process.execPath,['tools/testing/run.mjs','--activate','tradfri','--list'],{windowsHide:true});
  assert.match(result.stdout,/Test profile: activate/);assert.match(result.stdout,/tests\/tradfri.test.mjs/);
  assert.doesNotMatch(result.stdout,/TAP version|tests\/youtube.test.mjs/);
  await assert.rejects(execute(process.execPath,['tools/testing/run.mjs','--focused'],{windowsHide:true}),error=>error.code===1&&/Name the focused tests/.test(error.stderr));
});
test('CI and clean-source verification keep the complete gate and clean copies include the profile implementation',async()=>{
  const workflow=await fs.readFile(new URL('../.github/workflows/windows.yml',import.meta.url),'utf8');
  const verify=await fs.readFile(new URL('../tools/distribution/verify-source.mjs',import.meta.url),'utf8');
  const build=await fs.readFile(new URL('../tools/distribution/build.mjs',import.meta.url),'utf8');
  assert.match(workflow,/tools\/testing\/run.mjs(?: --full)?\s*\r?\n/);
  assert.match(verify,/\['tools\/testing\/run.mjs'(?:,'--full')?\]/);
  assert.match(build,/tools\/testing\/profiles.mjs/);
});
