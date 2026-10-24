/** Synthetic TV peers acknowledge only a current, targeted, cancellable request. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {TvCloseRequests} from '../server/tv-close.mjs';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {selectorFixture} from './fixtures/scene-selector.mjs';
test('cooperative close is target-bound, one-use and never replays',async()=>{
  const service=new TvCloseRequests(),controller=new AbortController();let allowed=true;
  const request=service.request('10.23.42.8',()=>{if(!allowed)throw Error('Changed');},controller.signal);
  assert.equal(service.poll('10.23.42.9'),null);
  const ticket=service.poll('::ffff:10.23.42.8');assert.ok(ticket);
  assert.equal(service.acknowledge('10.23.42.9',ticket),false);
  assert.equal(service.acknowledge('10.23.42.8',{...ticket,token:'wrong'}),false);
  assert.equal(service.acknowledge('10.23.42.8',ticket),true);assert.equal(await request,true);
  assert.equal(service.poll('10.23.42.8'),null);assert.equal(service.acknowledge('10.23.42.8',ticket),false);
});
test('timeout, changed gates and cancellation discard requests without retained effects',async()=>{
  const service=new TvCloseRequests({timeout:10}),controller=new AbortController();
  assert.equal(await service.request('10.23.42.8',()=>{},controller.signal),false);assert.equal(service.pending,null);
  let allowed=true;const changed=service.request('10.23.42.8',()=>{if(!allowed)throw Error('Changed');},controller.signal);
  const rejected=assert.rejects(changed,/Changed/);allowed=false;assert.equal(service.poll('10.23.42.8'),null);await rejected;
  const cancelled=service.request('10.23.42.8',()=>{},controller.signal),stopped=assert.rejects(cancelled,/Cancelled/);
  controller.abort(Error('Cancelled'));await stopped;assert.equal(service.pending,null);
});
test('display acknowledgement needs the exact current ticket and same-origin POST',async t=>{
  const f=await selectorFixture();t.after(()=>f.close());const controller=new AbortController();
  const pending=f.app.registry.tvClose.request('127.0.0.1',()=>{},controller.signal);
  const data=await fetch(f.app.origin+'/api/playstation-mode').then(r=>r.json());assert.ok(data.closeRequest);
  const post=(values,origin=f.app.origin)=>fetch(f.app.origin+'/api/playstation-mode/close',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(values)});
  assert.equal((await post(data.closeRequest,'https://foreign.invalid')).status,403);
  assert.equal((await post({...data.closeRequest,token:'wrong'})).status,409);
  assert.equal((await post(data.closeRequest)).status,200);assert.equal(await pending,true);
  assert.equal((await post(data.closeRequest)).status,409);
});
test('the ES5 display requests native exit only after one acknowledged visible-session close',async()=>{
  const source=await fs.readFile(new URL('../assets/playstation-mode/display.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('  var closingTicket'),source.indexOf('  function poll()'));
  const requests=[],messages=[],context={parentSession:'native',hiddenGeneration:1,document:{hidden:false},window:{parent:{postMessage:m=>messages.push(m)}},
    XMLHttpRequest:class{constructor(){requests.push(this);}open(){}setRequestHeader(){}send(body){this.body=JSON.parse(body);}}};
  vm.createContext(context);vm.runInContext(code+'\nglobalThis.closeDisplay=closeFromServer;',context);
  const ticket={id:'a'.repeat(32),token:'b'.repeat(48)};
  context.closeDisplay(ticket);assert.equal(messages.length,0);assert.equal(requests.length,1);
  context.closeDisplay(ticket);assert.equal(requests.length,1);
  requests[0].status=200;requests[0].onload();assert.equal(messages.length,1);assert.equal(messages[0].type,'localserve-ps-back');
  context.closeDisplay({...ticket,id:'c'.repeat(32)});context.document.hidden=true;requests[1].status=200;requests[1].onload();assert.equal(messages.length,1);
});
