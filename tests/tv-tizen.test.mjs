import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// The packaged launcher must parse on the old TV JavaScript engine.
const acornModule={exports:{}};
vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{module:acornModule,exports:acornModule.exports});
acornModule.exports.parse(fs.readFileSync('tv-tizen/app/launch.js','utf8'),{ecmaVersion:5});

const fallback = /var defaultUrl = '([^']+)'/.exec(fs.readFileSync('tv-tizen/app/launch.js','utf8'))[1];
const alternative = 'http://192.168.50.10:7041/assets/page.html';
function fixture(control = null, boot = true, saved = null, native = {}) {
  const listeners = {};
  const timers = new Map();
  let nextTimer = 0, clock = 0;
  const makeFrame = () => ({ hidden: true, messages:[], navigations: [], focus() {}, getAttribute() { return this.current || null; },
    setAttribute(name, value) { this[name] = value; },
    set src(url) { this.current = url; this.navigations.push(url); } });
  const frame = () => {const value=makeFrame();value.contentWindow={postMessage(data,origin){value.messages.push({data,origin});}};return value;};
  const page = frame(); let frames = 0, exits = 0;
  const nodes = {};
  for(const id of ['pip-panel','pip-status','pip-source','pip-size','pip-corner','pip-settings','pip-back','pip-refresh','pip-show','pip-hide','launcher','status','retry','settings','loading-panel','launcher-actions','connection-settings','server-protocol','server-host','server-port','server-path','connect','use-display','connection-back'])nodes[id]={id,hidden:id==='connection-settings'||id==='pip-panel',value:'',readOnly:true,blur(){context.document.activeElement=null;},focus(){context.document.activeElement=this;}};
  const appended = [];
  const context = vm.createContext({ document: {
    hidden: false,
    body: { appendChild(node) { node.parentNode = this; appended.push(node); }, removeChild(node) { node.parentNode = null; appended.splice(appended.indexOf(node), 1); } },
    createElement(name) { if (name === 'iframe') return frames++ ? frame() : page; return { set href(value) { try { this.url = new URL(value); } catch {} },
      get href() { return this.url?.href || ''; }, get hostname() { return this.url?.hostname || ''; },
      get protocol() { return this.url?.protocol || ''; },get host(){return this.url?.host||'';},get port(){return this.url?.port||'';},get pathname(){return this.url?.pathname||'';},get search(){return this.url?.search||'';},get hash(){return this.url?.hash||'';} }; },
    getElementById(id) { return nodes[id]; }, addEventListener(name, fn) { listeners[name] = fn; },
  }, window: { addEventListener(name, fn) { listeners[name] = fn; } },
  localStorage:{getItem(){return saved;},setItem(key,value){saved=value;}},
  setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay, at:clock+delay }); return id; },
  clearTimeout(id) { timers.delete(id); },
  tizen: { tvinputdevice:{getKey(name){return {code:{ChannelUp:427,MediaPlayPause:10252,MediaPlay:415,MediaPause:19}[name]};},registerKey(){}},...native, application: { getCurrentApplication() { return { exit() { exits++; }, getRequestedAppControl() { return control ? { appControl: control } : null; } }; } } } });
  vm.runInContext(fs.readFileSync('tv-tizen/app/url-target.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('tv-tizen/app/pip.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('tv-tizen/app/launch.js', 'utf8'), context);
  function flush(delay) {
    for (const [id, timer] of [...timers]) if (timer.delay === delay) {
      timers.delete(id);
      timer.callback();
    }
  }
  function advance(milliseconds) {
    const end=clock+milliseconds;
    for(;;){
      const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next)break;clock=next[1].at;timers.delete(next[0]);next[1].callback();
    }
    clock=end;
  }
  const result = { context, page, nodes, appended, flush, advance, get exits() { return exits; },
    message(frame, data, origin = new URL(frame.current).origin) { listeners.message({ source: frame.contentWindow, origin, data }); },
    load() { listeners.load(); }, launch(value) { control = value; listeners.appcontrol(); },
    hide() { context.document.hidden = true; listeners.visibilitychange(); },
    back() { listeners.keydown({keyCode: 10009}); },settings(){listeners.keydown({keyCode:427});},key(code){listeners.keydown({keyCode:code});},get saved(){return saved;},
    show() { context.document.hidden = false; listeners.visibilitychange(); } };
  if (boot) { result.load(); flush(250); }
  return result;
}
const payload = value => ({ data: [{ key: 'PAYLOAD', value: [value] }] });
test('ordinary startup and a later launch without URL use the shared display', () => {
  assert.equal(new URL(fallback).pathname,'/display');
  const f = fixture();
  assert.equal(f.page.current, fallback);
  f.launch(payload(alternative));
  assert.equal(f.page.current, alternative);
  f.launch(null);
  assert.equal(f.page.current, fallback);
});

const noticeId = 'a'.repeat(48);
const noticeUrl = `http://192.168.50.10:7041/tv-notices/${noticeId}?seconds=10`;

test('Vista address fields require OK before editing and relock on remote navigation',()=>{
  const f=fixture();f.flush(30000);assert.equal(f.nodes['server-host'].readOnly,true);
  f.key(13);assert.equal(f.nodes['server-host'].readOnly,false);f.key(40);assert.equal(f.nodes['server-host'].readOnly,true);
  assert.equal(f.context.document.activeElement,f.nodes['server-port']);f.key(13);assert.equal(f.nodes['server-port'].readOnly,false);
  f.key(13);assert.equal(f.nodes['server-port'].readOnly,true);
});

test('notice completion holds the local exit guard for its single server return, never extending it on duplicates',()=>{
  const f=fixture(payload(noticeUrl)),overlay=f.appended[0];
  f.message(overlay,{type:'localserve-notice-ready',id:noticeId,remainingMs:10000});f.back();
  f.message(overlay,{type:'localserve-notice-finishing',id:noticeId});f.flush(400);f.flush(11000);assert.equal(f.exits,0);
  f.message(overlay,{type:'localserve-notice-finishing',id:noticeId});f.flush(6500);assert.equal(f.exits,1);
  const changed=fixture(payload(noticeUrl));changed.message(changed.appended[0],{type:'localserve-notice-finishing',id:noticeId});
  changed.hide();changed.flush(6500);assert.equal(changed.exits,0,'Never exit another app after the notice loses foreground');
});

test('untimed notices clear the load guard without an expiry and dismiss by Back or scoped completion', () => {
  const untimedUrl = noticeUrl.replace('seconds=10', 'seconds=0');
  const f = fixture(payload(alternative));
  f.launch(payload(untimedUrl));
  const overlay = f.appended[1];
  f.message(overlay, {type: 'localserve-notice-ready', id: noticeId, remainingMs: 10000});
  assert.equal(f.appended.length, 2, 'A forged timed value cannot arm the untimed notice');
  f.message(overlay, {type: 'localserve-notice-ready', id: noticeId, remainingMs: 0});
  f.flush(20000); f.flush(1000); f.flush(11000);
  assert.equal(f.appended.length, 2);
  f.back(); f.flush(400);
  assert.equal(f.appended.length, 1); assert.equal(f.exits, 0);
  assert.equal(f.page.current, alternative);
  const cold = fixture(payload(untimedUrl));
  cold.message(cold.appended[0], {type: 'localserve-notice-ready', id: noticeId, remainingMs: 0});
  cold.message(cold.appended[0], {type: 'localserve-notice-finished', id: noticeId});
  assert.equal(cold.exits, 1);
});
test('a foreground notice preserves the previous frame and ignores duplicate or forged countdowns', () => {
  const f = fixture(payload(alternative));
  f.launch(payload(noticeUrl));
  const overlay = f.appended[1];
  assert.equal(f.page.current, alternative);
  assert.equal(overlay.current, noticeUrl);
  const ready = { type: 'localserve-notice-ready', id: noticeId, remainingMs: 10000 };
  f.message(f.page, ready); f.flush(10000);
  assert.equal(f.appended.length, 2);
  f.message(overlay, ready, 'https://unrelated.example'); f.flush(10000);
  assert.equal(f.appended.length, 2);
  f.message(overlay, ready);
  f.launch(payload(noticeUrl));
  assert.equal(f.appended.length, 2);
  f.flush(11000);
  assert.equal(f.appended.length, 1); assert.equal(f.exits, 0);
  assert.equal(f.page.navigations.length, 1, 'Previous browsing context was never navigated or replaced');
});

test('cold/background notice closes only Vista, while a user switch or newer URL cancels stale returns', () => {
  const cold = fixture(payload(noticeUrl));
  cold.message(cold.appended[0], { type: 'localserve-notice-ready', id: noticeId, remainingMs: 10000 });
  cold.flush(11000); assert.equal(cold.exits, 1);
  for (const beforeShow of [true, false]) {
    const f = fixture(); f.hide();
    if (beforeShow) f.launch(payload(noticeUrl));
    f.show(); if (!beforeShow) f.launch(payload(noticeUrl)); f.flush(250);
    const overlay = f.appended[f.appended.length - 1];
    f.message(overlay, { type: 'localserve-notice-ready', id: noticeId, remainingMs: 10000 });
    f.flush(11000); assert.equal(f.exits, 1);
  }
  const switched = fixture(); switched.launch(payload(noticeUrl)); switched.hide(); switched.flush(20000);
  assert.equal(switched.exits, 0);
  const changed = fixture(); changed.launch(payload(noticeUrl)); changed.launch(payload(alternative)); changed.flush(20000);
  assert.equal(changed.page.current, alternative); assert.equal(changed.exits, 0);
});

test('notice load failure returns locally, and public hosts or excessive durations remain ordinary URLs', () => {
  const f = fixture(payload(noticeUrl)); f.flush(20000); assert.equal(f.exits, 1);
  for (const url of [noticeUrl.replace('192.168.50.10', 'example.com'), noticeUrl.replace('seconds=10', 'seconds=99999')]) {
    const ordinary = fixture(payload(url)); ordinary.flush(20000); assert.equal(ordinary.exits, 0);
  }
});
test('URL overrides work initially and on appcontrol, without duplicate frame reloads', () => {
  for (const input of [alternative, JSON.stringify({ url: alternative }), JSON.stringify({ values: alternative }),
    JSON.stringify({ values: JSON.stringify({ url: alternative }) })]) {
    const f = fixture(payload(input));
    assert.equal(f.page.current, alternative);
    f.launch(payload(input));
    assert.equal(f.page.navigations.length, 1);
    f.launch({ uri: 'https://example.com/', data: [] });
    assert.equal(f.page.current, 'https://example.com/');
  }
});
test('invalid or excessive payloads fall back without opening unsafe schemes or credentials', () => {
  for (const value of ['javascript:alert(1)', 'file:///tmp/x', 'https://user:pass@example.com/', 'https://example.com/\\evil',
    'https://example.com/\npath', 'https://', 'http:///path', 'https://example.com/' + 'x'.repeat(2048), '{bad', JSON.stringify({ url: 123 })]) {
    assert.equal(fixture(payload(value)).page.current, fallback, value);
  }
});
test('remote loading cannot participate in packaged startup or hold its load event', () => {
  const f = fixture(null, false);
  assert.equal(f.appended.length, 0);
  assert.equal(f.page.navigations.length, 0);
  f.launch(payload(alternative));
  assert.equal(f.appended.length, 0);
  f.load();
  assert.equal(f.appended.length, 0, 'load callback must yield before creating a remote frame');
  f.flush(250);
  assert.equal(f.appended.length, 1);
  assert.equal(f.page.current, alternative);
});
test('a stalled page retains a local retry screen and does not automatically retry', () => {
  const f = fixture(payload(alternative));
  f.advance(29999);assert.equal(f.nodes['connection-settings'].hidden,true);
  f.advance(1);
  assert.equal(f.nodes.launcher.hidden, false);
  assert.match(f.nodes.status.textContent, /not finished loading/);
  assert.equal(f.page.navigations.length, 1);
  f.nodes.retry.onclick();
  assert.equal(f.page.navigations.length, 2);
  f.page.onload();
  assert.equal(f.nodes.launcher.hidden, true);
  f.flush(30000);
  assert.equal(f.nodes.launcher.hidden, true, 'completed navigation cancels the timeout');
});
test('menu reopen uses the default even when Tizen retains the last requested URL', () => {
  const f = fixture(payload(alternative));
  assert.equal(f.page.current, alternative);
  f.hide();
  f.show();
  f.flush(250);
  assert.equal(f.page.current, fallback);
});
test('fresh Task appcontrol wins before or after the foreground visibility event', () => {
  for (const beforeShow of [true, false]) {
    const f = fixture();
    f.hide();
    if (beforeShow) f.launch(payload(alternative));
    f.show();
    if (!beforeShow) f.launch(payload(alternative));
    f.flush(250);
    assert.equal(f.page.current, alternative);
    assert.equal(f.page.navigations.length, 2);
  }
});
test('the dynamic frame allows page scripts/forms/origin without top navigation or popups', () => {
  const html = fs.readFileSync('tv-tizen/app/index.html', 'utf8');
  assert.doesNotMatch(html, /<iframe/);
  assert.equal(fixture().page.sandbox, 'allow-scripts allow-forms allow-same-origin');
  assert.doesNotMatch(html, /allow-top-navigation|allow-popups|srcdoc/);
  assert.doesNotMatch(fs.readFileSync('tv-tizen/app/launch.js', 'utf8'), /location\.replace/);
});
test('the packaged frame policy admits HTTP/HTTPS on Localserve’s actual LAN port', () => {
  const config = fs.readFileSync('tv-tizen/app/config.xml', 'utf8');
  assert.match(config, /frame-src http: https:/);
  assert.match(config, /<tizen:allow-navigation>[^<]*http:\/\/\*:\* https:\/\/\*:\*</);
  assert.match(config, /script-src 'self'; style-src 'self'/);
});

function confirmViewer(f, connected=true) {
  f.page.onload();
  const probe=f.page.messages.at(-1).data;
  f.message(f.page,{type:'localserve-viewer-state',id:probe.id,path:probe.path,connected});
  return probe;
}
test('display load requires a scoped health response, then a silent connection opens settings',()=>{
  const f=fixture();f.page.onload();assert.notEqual(f.nodes.launcher.hidden,true);
  confirmViewer(f);assert.equal(f.nodes.launcher.hidden,true);
  f.advance(29999);assert.equal(f.nodes['connection-settings'].hidden,true);assert.equal(f.nodes.launcher.hidden,true);
  f.advance(1);assert.equal(f.nodes['connection-settings'].hidden,false);
  assert.equal(f.nodes['server-host'].value,new URL(fallback).hostname);
  assert.equal(f.nodes['server-port'].value,new URL(fallback).port);assert.equal(f.nodes['server-path'].value,'/display');
  assert.equal(f.page.navigations.length,1,'No automatic navigation retry');
});

test('failed reports and frame errors retain the display until the first failure has lasted thirty seconds',()=>{
  const f=fixture(),probe=confirmViewer(f);
  f.advance(1000);
  const report=()=>f.message(f.page,{type:'localserve-viewer-state',id:probe.id,path:probe.path,connected:false});
  report();f.advance(10000);report();f.page.onerror();
  f.advance(19999);assert.equal(f.nodes['connection-settings'].hidden,true);assert.equal(f.nodes.launcher.hidden,true);
  f.advance(1);assert.equal(f.nodes['connection-settings'].hidden,false);
  assert.equal(f.page.navigations.length,1,'Failure never reloads the page automatically.');
});

test('healthy responses cancel failure deadlines and new navigation gets its own thirty-second load budget',()=>{
  const f=fixture(),probe=confirmViewer(f);
  const report=connected=>f.message(f.page,{type:'localserve-viewer-state',id:probe.id,path:probe.path,connected});
  report(false);f.advance(20000);report(true);f.advance(20000);
  assert.equal(f.nodes.launcher.hidden,true);assert.equal(f.nodes['connection-settings'].hidden,true);
  report(false);f.advance(29999);assert.equal(f.nodes['connection-settings'].hidden,true);
  report(true);f.launch(payload('http://10.23.42.3:7041/vistas/another'));report(false);
  f.advance(29999);assert.equal(f.nodes['connection-settings'].hidden,true);
  f.advance(1);assert.equal(f.nodes['connection-settings'].hidden,false);
});

test('background time does not expire a viewer connection and resume starts a fresh heartbeat grace period',()=>{
  const f=fixture(),probe=confirmViewer(f);
  f.message(f.page,{type:'localserve-viewer-state',id:probe.id,path:probe.path,connected:false});
  f.advance(10000);f.hide();f.advance(60000);
  assert.equal(f.nodes['connection-settings'].hidden,true);
  f.show();f.flush(250);f.advance(29999);assert.equal(f.nodes.launcher.hidden,true);
  f.advance(1);assert.equal(f.nodes['connection-settings'].hidden,false);
});
test('initial failure opens editable connection fields and ignores forged or obsolete viewer messages',()=>{
  const f=fixture();const probe=confirmViewer(f);
  f.page.onload();
  f.launch(payload('http://10.23.42.3:7041/vistas/another'));
  f.message(f.page,{type:'localserve-viewer-state',id:probe.id,path:probe.path,connected:true});
  f.flush(30000);assert.equal(f.nodes['connection-settings'].hidden,false);
  const other=fixture();other.page.onload();const current=other.page.messages.at(-1).data;
  other.message(other.page,{type:'localserve-viewer-state',id:current.id,path:current.path,connected:true},'https://unrelated.example');
  other.flush(30000);assert.equal(other.nodes['connection-settings'].hidden,false);
});
test('saved connection is explicit, validated, durable and remains default after appcontrol overrides',()=>{
  const f=fixture();f.flush(30000);
  f.nodes['server-host'].value='192.168.1.5';f.nodes['server-port'].value='8080';
  f.nodes['server-path'].value='/display';f.nodes['server-protocol'].value='http:';
  f.nodes['connection-settings'].onsubmit({preventDefault(){}});
  assert.equal(f.saved,'http://192.168.1.5:8080/display');assert.equal(f.page.current,f.saved);
  f.launch(payload(alternative));f.launch(null);assert.equal(f.page.current,f.saved);
  assert.equal(fixture(null,true,f.saved).page.current,f.saved);
  for(const saved of ['file:///private','http://user:pass@192.168.1.5/'])assert.equal(fixture(null,true,saved).page.current,fallback);
  const bad=fixture();bad.flush(30000);bad.nodes['server-host'].value='user@server';
  bad.nodes['connection-settings'].onsubmit({});assert.equal(bad.saved,null);assert.equal(bad.page.navigations.length,1);
});
test('connection failure never replaces a visible settings draft, and Back can return without saving',()=>{
  const f=fixture();const probe=confirmViewer(f);f.settings();
  assert.equal(f.nodes['connection-settings'].hidden,false);f.nodes['server-host'].value='draft-host';
  f.message(f.page,{type:'localserve-viewer-state',id:probe.id,path:probe.path,connected:false});
  assert.equal(f.nodes['server-host'].value,'draft-host');
  f.message(f.page,{type:'localserve-viewer-state',id:probe.id,path:probe.path,connected:true});
  assert.equal(f.nodes['connection-settings'].hidden,false,'Recovery does not dismiss editing');
  f.nodes['connection-back'].onclick();assert.equal(f.nodes['connection-settings'].hidden,true);assert.equal(f.nodes.launcher.hidden,true);assert.equal(f.saved,null);
});
test('arrow keys are forwarded only to the current ready Vista, never settings or notices',()=>{
  const f=fixture();confirmViewer(f);const count=f.page.messages.length;
  f.key(39);assert.equal(f.page.messages.at(-1).data.type,'localserve-viewer-key');assert.equal(f.page.messages.at(-1).data.keyCode,39);
  f.settings();f.key(37);assert.equal(f.page.messages.length,count+1);
  f.nodes['connection-back'].onclick();f.launch(payload(noticeUrl));f.key(39);assert.equal(f.page.messages.length,count+1);
  const ordinary=fixture(payload(alternative));ordinary.page.onload();ordinary.key(39);assert.equal(ordinary.page.messages.length,0);
});
test('connection URL construction rejects invalid authority, schemes and ports',()=>{
  const target=fixture().context.VistaUrlTarget;
  const values={protocol:'http:',host:'localserve.local',port:'7041',path:'/display'};
  assert.equal(target.settings(values),'http://localserve.local:7041/display');
  for(const patch of [{protocol:'file:'},{host:'server/path'},{host:'user@host'},{port:'0'},{port:'65536'},{path:'//external.example/'}])assert.equal(target.settings({...values,...patch}),null);
  assert.ok(target.viewer('http://10.23.42.3:7041/display?legacy=1'));
  assert.equal(target.viewer('http://10.23.42.3:7041/display-evil'),null);
});

test('Back closes Vista from content and settings; Channel Up remains settings and media keys target only the current page',()=>{
 const f=fixture(),probe=confirmViewer(f);f.key(10252);
 assert.equal(f.page.messages.at(-1).data.keyCode,10252);
 f.settings();assert.equal(f.nodes['connection-settings'].hidden,false);f.back();assert.equal(f.exits,1);
 const content=fixture();confirmViewer(content);content.back();assert.equal(content.exits,1);
 const remote=fixture(payload('http://192.168.50.10:7041/universe'));remote.page.onload();
 const challenge=remote.page.messages.at(-1).data;
 remote.message(remote.page,{type:'localserve-viewer-settings',id:'old',path:challenge.path});assert.notEqual(remote.nodes['connection-settings'].hidden,false);
 remote.message(remote.page,{type:'localserve-viewer-settings',id:challenge.id,path:challenge.path});assert.equal(remote.nodes['connection-settings'].hidden,false);
 const opaque=fixture(payload('http://192.168.50.10:7041/assets/pages/solar-system.html'));opaque.page.onload();
 const p=opaque.page.messages.at(-1).data;
 opaque.message(opaque.page,{type:'localserve-viewer-back',id:p.id,path:p.path},'https://other');assert.equal(opaque.exits,0);
 opaque.message(opaque.page,{type:'localserve-viewer-back',id:p.id,path:p.path},'null');assert.equal(opaque.exits,1);
});

test('Channel Up dismisses notice audio before settings while Back and automatic expiry retain the prior foreground page',()=>{
 const f=fixture(payload(alternative));f.page.onload();f.launch(payload(noticeUrl));const overlay=f.appended.at(-1);
 overlay.onload();const probe=overlay.messages.at(-1).data;
 f.message(overlay,{type:'localserve-viewer-settings',id:noticeId,path:probe.path});
 assert.equal(overlay.messages.at(-1).data.type,'localserve-notice-dismiss');
 assert.equal(f.appended.length,2);f.flush(400);assert.equal(f.appended.length,1);
 assert.equal(f.nodes['connection-settings'].hidden,false);assert.equal(f.exits,0);
 f.nodes['connection-back'].onclick();assert.equal(f.page.current,alternative);
});

test('PIP controls are remote-accessible without changing connection drafts or permitting frame commands',()=>{
  const f=fixture();confirmViewer(f);f.settings();f.nodes['server-host'].value='unsaved';
  f.nodes['pip-settings'].onclick();assert.equal(f.nodes['pip-panel'].hidden,false);
  assert.equal(f.nodes['pip-show'].disabled,true);assert.match(f.nodes['pip-status'].textContent,/installed Samsung/);
  f.key(40);assert.equal(f.context.document.activeElement.id,'pip-size');
  f.nodes['pip-back'].onclick();assert.equal(f.nodes['pip-panel'].hidden,true);assert.equal(f.nodes['server-host'].value,'unsaved');
  f.nodes['connection-back'].onclick();assert.equal(f.nodes.launcher.hidden,true);
});

test('native PIP is hidden by settings, notices, background, navigation and connection failure',()=>{
  for(const reason of ['settings','notice','background','navigation','failure']){
    const calls=[];const native={systeminfo:{getPropertyValue(name,ok){ok({connected:[{type:'HDMI',number:1}]});}},
      tvwindow:{setSource(source,ok){calls.push('source');ok();},show(ok){calls.push('show');ok();},hide(ok){calls.push('hide');ok();}}};
    const f=fixture(null,true,null,native);const probe=confirmViewer(f);
    f.nodes['pip-source'].appendChild=function(){};
    f.settings();f.nodes['pip-settings'].onclick();
    f.nodes['pip-source'].value='0';f.nodes['pip-size'].value='33';f.nodes['pip-corner'].value='br';
    f.nodes['pip-show'].onclick();assert.deepEqual(calls,['source','show']);assert.equal(f.nodes.launcher.hidden,true);
    if(reason==='settings')f.settings();
    if(reason==='notice')f.launch(payload(noticeUrl));
    if(reason==='background')f.hide();
    if(reason==='navigation')f.launch(payload(alternative));
    if(reason==='failure'){
      f.message(f.page,{type:'localserve-viewer-state',id:probe.id,path:probe.path,connected:false});
      f.advance(29999);assert.deepEqual(calls,['source','show'],'PIP remains visible during the grace period.');f.advance(1);
    }
    assert.deepEqual(calls,['source','show','hide'],reason);
  }
});
