import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function fixture() {
  const calls = [], reports = [];
  const api = {systeminfo:{getPropertyValue(name,ok,fail){calls.push({kind:'read',name,ok,fail});}},tvwindow:{}};
  for (const kind of ['setSource','show','hide']) api.tvwindow[kind] = (...args) => {
    const source = kind === 'setSource' ? args.shift() : null;
    const [ok,fail,...rest] = args; calls.push({kind,source,ok,fail,rest});
  };
  const context = vm.createContext({}); vm.runInContext(fs.readFileSync('tv-tizen/app/pip.js','utf8'),context);
  const pip = context.VistaPip.create(api,(...args)=>reports.push(args));
  const discover = () => {pip.discover(()=>{});calls.at(-1).ok({connected:[{type:'HDMI',number:2}]});};
  return {pip,calls,reports,api,context,discover};
}
test('PIP is idle at startup, lists only connected TV/HDMI and explicitly selects the reported source',()=>{
  const f=fixture();assert.equal(f.calls.length,0);
  let result;f.pip.discover((sources)=>{result=sources;});
  f.calls[0].ok({connected:[{type:'HDMI',number:2},{type:'TV',number:0},{type:'AV',number:1}],disconnected:[{type:'HDMI',number:3}]});
  assert.equal(JSON.stringify(result),JSON.stringify([{id:'0',label:'HDMI 2'},{id:'1',label:'Live TV'}]));
  assert.equal(f.pip.show('0','33','br'),true);assert.equal(f.calls.at(-1).source.number,2);
  f.calls.at(-1).ok();const show=f.calls.at(-1);assert.equal(show.kind,'show');
  assert.equal(JSON.stringify(show.rest),JSON.stringify([['65%','65%','33%','33%'],'MAIN','FRONT']));
  show.ok();f.pip.hide();assert.equal(f.calls.at(-1).kind,'hide');f.calls.at(-1).ok();
  assert.equal(f.reports.at(-1)[0],'Video window hidden.');
});
test('hide cancels a pending source change without issuing show',()=>{
  const f=fixture();f.discover();f.pip.show('0','25','tl');const source=f.calls.at(-1);
  f.pip.hide();source.ok();assert.equal(f.calls.some(call=>call.kind==='show'),false);
});
test('hide serializes after an in-flight show and never restores from late completion',()=>{
  const f=fixture();f.discover();f.pip.show('0','50','tr');f.calls.at(-1).ok();const show=f.calls.at(-1);
  f.pip.hide();f.pip.hide();assert.equal(f.calls.at(-1),show);show.ok();
  assert.equal(f.calls.at(-1).kind,'hide');f.calls.at(-1).ok();
  assert.equal(f.calls.filter(call=>call.kind==='hide').length,1);
  assert.equal(f.calls.filter(call=>call.kind==='show').length,1);
});
test('cancelled source failures cannot reopen settings on a newer page',()=>{
  const f=fixture();f.discover();f.pip.show('0','33','br');const request=f.calls.at(-1);
  f.pip.hide();const count=f.reports.length;request.fail({name:'SecurityError'});
  assert.equal(f.reports.length,count);assert.equal(f.calls.at(-1),request);
});
test('native failures are reported without automatic retries, with explicit hide recovery',()=>{
  const f=fixture();f.discover();f.pip.show('0','33','bl');f.calls.at(-1).ok();f.calls.at(-1).ok();
  f.pip.hide();const count=f.calls.length;f.calls.at(-1).fail({name:'NotSupportedError'});
  assert.equal(f.calls.length,count);assert.equal(f.reports.at(-1)[1],true);
  assert.equal(f.pip.show('0','33','bl'),false);f.pip.hide();assert.equal(f.calls.length,count+1);
  f.calls.at(-1).ok();assert.equal(f.pip.show('0','33','bl'),true);
});
test('source failures and stale discovery cannot expose previous selections',()=>{
  const f=fixture();f.discover();f.pip.discover(()=>{});const old=f.calls.at(-1);
  f.pip.discover(()=>{});f.calls.at(-1).fail({name:'SecurityError'});old.ok({connected:[{type:'HDMI',number:9}]});
  assert.equal(f.pip.show('0','33','br'),false);
});
test('invalid geometry, source IDs and unavailable APIs cannot issue native commands',()=>{
  const f=fixture();f.discover();const count=f.calls.length;
  for(const args of [['0','100','br'],['0','33','no'],['-1','33','br'],['0.0','33','br'],['99','33','br']])assert.equal(f.pip.show(...args),false);
  assert.equal(f.calls.length,count);
  const unavailable=f.context.VistaPip.create(null,()=>{});unavailable.hide();let message;
  unavailable.discover((sources,text)=>{assert.equal(sources.length,0);message=text;});
  assert.match(message,/installed Samsung/);assert.equal(unavailable.show('0','33','br'),false);
  for(const size of ['25','33','50'])for(const corner of ['tl','tr','bl','br']){
    const rect=f.context.VistaPip.rectangle(size,corner).map(parseFloat);
    assert.ok(rect[0]>=0&&rect[1]>=0&&rect[0]+rect[2]<=100&&rect[1]+rect[3]<=100);
  }
});
