/** Mock/local transport checks; never contacts or changes a physical TV. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { createSamsungAdapter, appReading, remoteMessage, safeUrl } from '../plugins/samsung-tv/server/index.mjs';
import { pinnedAgent, connectRemote, createHttpClient, soapValues, magicPacket } from '../plugins/samsung-tv/server/client.mjs';
import { createVault } from '../plugins/samsung-tv/server/vault.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { createLocalserve } from '../server.mjs';
import {createYouTubeControl, sessionIdentifiers} from '../plugins/samsung-tv/server/youtube-control.mjs';
const declaration = JSON.parse(await fs.readFile(new URL('../plugins/samsung-tv/declaration.json', import.meta.url), 'utf8'));
const pin = Array(32).fill('AA').join(':');
const settings = { host: '10.23.42.5', port: 8002, fingerprint: pin, 'remote-name': 'Living room remote', token: '', mac: '10:20:30:40:50:60', 'poll-minutes': 1 };
const auth = { host: settings.host, port: settings.port, token: 'test-token' };
function harness(seed = {}) {
  let state = structuredClone(seed); const controller = new AbortController(), events = [];
  return { events, controller, get state() { return state; }, context: { signal: controller.signal,
    readState: async () => structuredClone(state), saveState: async value => { state = structuredClone(value); }, log: async () => {}, wait: async () => controller.signal.throwIfAborted(), emit: async (id, payload) => events.push({ id, payload, state: structuredClone(state) }) } };
}
function fakeHttp() {
  let currentVolume = 25, failed = false; const calls = [], failSections = new Set();
  return { calls, failSections, volume(value) { currentVolume = value; }, fail(value) { failed = value; },
    async info() { if (failed) throw new Error('private test-token'); return { name: 'TV', modelName: 'UE75MU7002', OS: 'Tizen' }; },
    async soap(host, action, args, kind, signal) {
      signal.throwIfAborted(); calls.push({ action, args }); if (failSections.has(action)) throw new Error('Unavailable');
      return { GetVolume: { CurrentVolume: String(currentVolume) }, GetMute: { CurrentMute: '0' }, GetTransportInfo: { CurrentTransportState: 'PLAYING' }, GetPositionInfo: { RelTime: '00:01:20', TrackDuration: '00:10:00' } }[action] || {};
    } };
}
const adapterFor = (http, extra = {}) => createSamsungAdapter({ http, vault: { async load() { return auth; } }, credentialReady: async () => true, ...extra });

test('Localserve app close uses one cooperative request and confirms exact-app stopped state without DELETE',async()=>{
  const calls=[],h=harness();let reads=0,requests=0;
  const adapter=adapterFor({async app(host,id,method){calls.push(method);assert.equal(id,'LsPsMode01.PlaystationMode');return {running:++reads===1};}});
  h.context.closeLocalserveTv=async()=>{requests++;return {accepted:true};};
  await adapter.start(settings);
  assert.deepEqual(await adapter.execute('close-app',{id:'LsPsMode01.PlaystationMode'},h.context),{commandSent:true,closed:true,cooperative:true});
  assert.equal(requests,1);assert.deepEqual(calls,['GET','GET']);
});
test('a rejected DELETE is not repeated and stopped readback resolves an app-close race',async()=>{
  const methods=[],h=harness();let reads=0;
  const adapter=adapterFor({async app(host,id,method){methods.push(method);if(method==='DELETE')throw Error('Rejected');return {running:++reads===1};}});
  await adapter.start(settings);
  assert.deepEqual(await adapter.execute('close-app',{id:'app.example'},h.context),{commandSent:true,closed:true});
  assert.deepEqual(methods,['GET','DELETE','GET']);
});

test('Samsung declaration and readiness are offline, with token/certificate boundaries', async () => {
  const plugin = validateDeclaration(declaration); assert.equal(plugin.actions.filter(action => !action.settingsOnly).length, 19); assert.equal(plugin.name, 'Samsung TV');
  assert.ok(!plugin.cardFields.some(field => field.source.key === 'token' || field.source.key === 'mac'));
  const http = fakeHttp(), adapter = adapterFor(http);
  assert.equal(await adapter.validateConfiguration(settings), true);
  assert.equal(await adapter.validateConfiguration({ ...settings, host: '8.8.8.8' }), false);
  assert.equal(await adapter.validateConfiguration({ ...settings, fingerprint: 'invalid' }), false);
  assert.equal(await adapter.validateConfiguration({ ...settings, token: 'bad token?' }), false);
  await adapter.start(settings); await adapter.stop(); assert.equal(http.calls.length, 0);
});

test('TV notice sends only one launch of the fixed Vista app with host-supplied context', async () => {
  const sent = [], http = fakeHttp(), f = harness();
  const adapter = adapterFor(http, { remote: async () => ({ send: async value => sent.push(value), close() {} }) });
  await adapter.start(settings);
  f.context.noticeUrl = 'http://10.23.42.3:7041/tv-notices/' + 'a'.repeat(48) + '?seconds=10';
  await adapter.execute('show-notice', { template: 'Warning', title: 'Title', message: 'Text', seconds: 10, sound: true }, f.context);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].params.data.appId, 'HwGlance01.HomeGlance');
  assert.equal(sent[0].params.data.metaTag, f.context.noticeUrl);
  assert.equal(http.calls.length, 0, 'Notice never changes volume, mute or media transport');
  await adapter.stop();
});

test('remote interval is bounded, counts elapsed time and applies across key and volume commands',async()=>{
  let clock=0;const waits=[],sent=[],http=fakeHttp(),h=harness();
  const adapter=adapterFor(http,{commandClock:()=>clock,remote:async()=>({close(){},async send(){sent.push(clock);}})});
  for(const value of [-1,5001,NaN,Infinity])assert.equal(await adapter.validateConfiguration({...settings,'command-interval-ms':value}),false);
  assert.equal(await adapter.validateConfiguration({...settings,'command-interval-ms':0}),true);
  h.context.wait=async seconds=>{h.controller.signal.throwIfAborted();waits.push(seconds);clock+=seconds*1000;};
  await adapter.start({...settings,'command-interval-ms':250});
  await adapter.execute('key',{key:'KEY_UP'},h.context);
  clock+=50;
  await adapter.execute('key',{key:'KEY_RIGHT'},h.context);
  assert.deepEqual(waits,[.01,.2]);assert.equal(sent[1]-sent[0],250);
  await adapter.execute('volume',{value:25},h.context);assert.equal(waits.at(-1),.25);
  await adapter.execute('refresh',{},h.context);assert.equal(waits.length,3,'Read-only polling adds no command spacing.');
  await adapter.stop();await adapter.start({...settings,'command-interval-ms':0});
  await adapter.execute('key',{key:'KEY_LEFT'},h.context);await adapter.execute('key',{key:'KEY_DOWN'},h.context);
  assert.deepEqual(waits.slice(-2),[.01,.01],'Zero retains only the existing host effect gate.');
  await adapter.stop();
});

test('cancelling during remote spacing prevents the next effect without retry',async()=>{
  let clock=0;const sent=[],h=harness();
  const adapter=adapterFor(fakeHttp(),{commandClock:()=>clock,remote:async()=>({close(){},async send(value){sent.push(value);}})});
  await adapter.start({...settings,'command-interval-ms':500});
  h.context.wait=async seconds=>{clock+=seconds*1000;};
  await adapter.execute('key',{key:'KEY_UP'},h.context);
  h.context.wait=async seconds=>{assert.equal(seconds,.5);h.controller.abort(new Error('Cancelled during spacing'));};
  await assert.rejects(adapter.execute('key',{key:'KEY_DOWN'},h.context),/Cancelled during spacing/);
  assert.equal(sent.length,1);await adapter.stop();
});

test('bounded HTTP/strict SOAP parser rejects DTDs/faults/redirects and never sends tokens', async () => {
  assert.equal(soapValues('<a xmlns="urn:test"><CurrentVolume>25</CurrentVolume></a>').CurrentVolume, '25');
  assert.throws(() => soapValues('<!DOCTYPE a><a/>'), /DTD/);
  assert.throws(() => soapValues('<s:Fault xmlns:s="urn:x"/>'), /rejected/);
  assert.throws(() => soapValues('<a><b></a>'));
  const calls = []; let redirect = false;
  const http = createHttpClient(async (url, options) => { calls.push({ url, options }); return redirect ? new Response('', { status: 302, headers: { Location: 'https://example.com' } }) : new Response(url.endsWith('/api/v2/') ? JSON.stringify({ device: { name: 'TV' } }) : '<a><CurrentMute>0</CurrentMute></a>'); });
  const signal = new AbortController().signal;
  await http.info(settings.host, signal); await http.soap(settings.host, 'GetMute', '', 'RenderingControl', signal);
  assert.ok(calls.every(call => call.url.startsWith('http://10.23.42.5:') && call.options.redirect === 'manual'));
  assert.doesNotMatch(JSON.stringify(calls), /test-token/);
  redirect = true; await assert.rejects(http.info(settings.host, signal), /rejected/); assert.equal(calls.length, 3);
});

test('exact app close reads only its own status and never sends remote keys',async()=>{
  const calls=[],h=harness();let running=false;
  const http={...fakeHttp(),async app(host,id,method,signal){signal.throwIfAborted();calls.push({host,id,method});return method==='GET'?{running}:{acknowledged:true};}};
  const adapter=adapterFor(http,{remote:async()=>{throw Error('Remote keys must not be used');}});
  await adapter.start(settings);
  assert.deepEqual(await adapter.execute('close-app',{id:'LsPsMode01.PlaystationMode'},h.context),{commandSent:false,alreadyStopped:true});
  assert.equal(calls.length,1);running=true;
  await adapter.execute('close-app',{id:'LsPsMode01.PlaystationMode'},h.context);
  assert.deepEqual(calls.map(c=>c.method),['GET','GET','DELETE']);
  assert.ok(calls.every(c=>c.id==='LsPsMode01.PlaystationMode'&&c.host===settings.host));
  h.context.wait=async()=>h.controller.abort(new Error('Cancelled close'));
  await assert.rejects(adapter.execute('close-app',{id:'LsPsMode01.PlaystationMode'},h.context),/Cancelled close/);
  assert.equal(calls.filter(c=>c.method==='DELETE').length,1);
  await adapter.stop();
});

test('app HTTP endpoints reject redirects, unknown status and unsafe identities without fallback',async()=>{
  const calls=[],signal=new AbortController().signal;let reply={id:'app.one',running:true};
  const http=createHttpClient(async(url,options)=>{calls.push({url,options});return reply instanceof Response?reply:Response.json(reply);});
  assert.deepEqual(await http.app(settings.host,'app.one','GET',signal),{running:true});
  await http.app(settings.host,'app.one','DELETE',signal);
  assert.equal(calls[1].options.method,'DELETE');assert.equal(calls[1].options.redirect,'manual');
  for(const id of ['../other','a/b','',null])await assert.rejects(http.app(settings.host,id,'DELETE',signal),/supported/);
  await assert.rejects(http.app('8.8.8.8','app.one','DELETE',signal),/supported/);
  await assert.rejects(http.app(settings.host,'app.one','PUT',signal),/supported/);
  assert.equal(calls.length,2);
  for(const value of [{id:'other',running:true},{id:'app.one',running:'true'},{error:'unavailable'}]){
    reply=value;await assert.rejects(http.app(settings.host,'app.one','GET',signal),/status/);
  }
  reply=new Response('',{status:302});await assert.rejects(http.app(settings.host,'app.one','DELETE',signal),/rejected/);
  reply={error:'unsupported'};await assert.rejects(http.app(settings.host,'app.one','DELETE',signal),/rejected/);
  assert.doesNotMatch(JSON.stringify(calls),/test-token/);
});

test('TLS agent rejects changed certificates before releasing a socket to credential-bearing HTTP', async () => {
  let actualPin = pin, destroyed = 0;
  const makeSocket = () => {
    const socket = new EventEmitter(); socket.getPeerCertificate = () => ({ fingerprint256: actualPin }); socket.destroy = () => { destroyed++; };
    queueMicrotask(() => socket.emit('secureConnect')); return socket;
  };
  const agent = pinnedAgent(settings.host, pin, { connect: makeSocket });
  const socket = await new Promise((resolve, reject) => agent.createConnection({}, (error, socket) => error ? reject(error) : resolve(socket)));
  assert.ok(socket); actualPin = Array(32).fill('BB').join(':');
  await assert.rejects(new Promise((resolve, reject) => agent.createConnection({}, error => error ? reject(error) : resolve())), /fingerprint changed/);
  assert.equal(destroyed, 1); agent.destroy();
});

test('remote handshake validates saved target, protects rotated tokens before commands, and bounds apps', async () => {
  const order = [], sockets = []; let badApps = false;
  const factory = (url, options) => {
    assert.equal(url.hostname, settings.host); assert.equal(url.port, '8002'); assert.equal(url.searchParams.get('token'), auth.token);
    assert.equal(options.maxPayload, 256 * 1024); assert.equal(options.followRedirects, false);
    const socket = new EventEmitter(); sockets.push(socket); socket.terminate = () => {};
    socket.send = (raw, callback) => {
      const payload = JSON.parse(raw); order.push('send'); callback();
      if (payload.params.event === 'ed.installedApp.get') queueMicrotask(() => socket.emit('message', Buffer.from(JSON.stringify({ event: 'ed.installedApp.get', data: badApps ? Array(201).fill({ appId: 'app', name: 'App' }) : [{ appId: 'app', name: 'App' }] }))));
    };
    queueMicrotask(() => socket.emit('message', Buffer.from(JSON.stringify({ event: 'ms.channel.connect', data: { token: 'rotated-token' } }))));
    return socket;
  };
  const options = { socketFactory: factory, agentFactory: () => ({ destroy() {} }), saveToken: async value => { assert.equal(value.token, 'rotated-token'); order.push('save'); } };
  let connection = await connectRemote(settings, auth, new AbortController().signal, options);
  await connection.send(remoteMessage('key', { key: 'KEY_HOME' })); assert.deepEqual(order, ['save', 'send']);
  assert.equal((await connection.apps()).length, 1); connection.close();
  await assert.rejects(connectRemote({ ...settings, host: '10.23.42.6' }, auth, new AbortController().signal, options), /Configure/);
  badApps = true; connection = await connectRemote(settings, auth, new AbortController().signal, options);
  await assert.rejects(connection.apps(), /exceeds 200/); connection.close();
});

test('explicit TV actions validate wire data, URLs, wake packet and app row limits', () => {
  assert.equal(remoteMessage('power-off', {}).params.DataOfCmd, 'KEY_POWEROFF');
  assert.equal(remoteMessage('input', { input: 'HDMI2' }).params.DataOfCmd, 'KEY_HDMI2');
  assert.throws(() => remoteMessage('key', { key: 'KEY_DELETE_EVERYTHING' }), /supported/);
  assert.throws(() => remoteMessage('pointer', { x: 1.5, y: 0 }), /integers/);
  assert.throws(() => safeUrl('https://user:password@example.com'), /without credentials/);
  assert.throws(() => safeUrl('file:///data/private'), /HTTP/);
  assert.equal(magicPacket(settings.mac).length, 102); assert.throws(() => magicPacket('ff:ff:ff:ff:ff:ff'), /unicast/);
  const reading = appReading(Array.from({ length: 15 }, (_, i) => ({ appId: i + 1, name: 'App ' + i })), 123);
  assert.equal(reading['app-count'], 15); assert.equal(reading['app-row-count'], 10); assert.equal(reading['apps-truncated'], true); assert.equal(reading['app-1-id'], '1');
});

test('YouTube playback is opt-in and validates before any TV effect',async()=>{
  let connected=0;
  const adapter=adapterFor(fakeHttp(),{remote:async()=>{connected++;throw new Error('Unexpected');}});
  await adapter.start(settings);
  await assert.rejects(adapter.execute('play-youtube',{'video-id':'newvideo001','app-id':'111299001912'},harness().context),/Enable YouTube playback/);
  await adapter.stop();await adapter.start({...settings,'youtube-playback':true,'youtube-port':8080});
  await assert.rejects(adapter.execute('play-youtube',{'video-id':'https://example.com/','app-id':'111299001912'},harness().context),/Video ID/);
  assert.equal(connected,0);
});

test('bounded YouTube playback uses one private TV read and three fixed session requests',async()=>{
  const calls=[];
  const frame=JSON.stringify([[0,['c','private-sid','',8]],[1,['S','private-session']]]);
  const client=createYouTubeControl({fetchImpl:async(url,options)=>{
    calls.push({url,options});
    if(calls.length===1)return new Response('<service><name>YouTube</name><additionalData><screenId>private-screen</screenId></additionalData></service>');
    if(calls.length===2)return Response.json({screens:[{screenId:'private-screen',loungeToken:'private-lounge'}]});
    return new Response(calls.length===3?Buffer.byteLength(frame)+'\n'+frame:'');
  }});
  const opts={...settings,'youtube-playback':true,'youtube-port':8080};
  await client.play(opts,'newvideo001',new AbortController().signal,async()=>{});
  assert.equal(calls.length,4);
  assert.equal(calls[0].url,'http://10.23.42.5:8080/ws/app/YouTube');
  assert.equal(calls[0].options.headers,undefined,'TV read carries no pairing token or Google key.');
  assert.ok(calls.slice(1).every(call=>new URL(call.url).origin==='https://www.youtube.com'&&call.options.redirect==='error'));
  assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[1].options.body)),{screen_ids:'private-screen'});
  const effect=new URLSearchParams(calls[3].options.body);
  assert.equal(effect.get('req0__sc'),'setPlaylist');
  assert.equal(effect.get('req0_videoId'),'newvideo001');
  assert.equal(effect.get('count'),'1');
  assert.equal(calls.filter(call=>new URLSearchParams(call.options.body).get('req0__sc')==='setPlaylist').length,1);
  assert.deepEqual(sessionIdentifiers(frame),{sid:'private-sid',session:'private-session'});
  assert.deepEqual(sessionIdentifiers((Buffer.byteLength(frame)+1)+'\n'+frame+'\n'),{sid:'private-sid',session:'private-session'});
  assert.throws(()=>sessionIdentifiers('100\n[]'),/incomplete/);
});

test('YouTube playback rejects unsafe/oversized replies and never retries a failed effect',async()=>{
  const opts={...settings,'youtube-playback':true,'youtube-port':8080};
  const run=async(replies,gate=async()=>{})=>{
    let calls=0;
    const client=createYouTubeControl({fetchImpl:async()=>{
      const reply=replies[calls++];
      if(reply instanceof Error)throw reply;
      return reply;
    }});
    await assert.rejects(client.play(opts,'newvideo001',new AbortController().signal,gate));
    return calls;
  };
  assert.equal(await run([new Response('<!DOCTYPE service><service/>')]),1);
  assert.equal(await run([new Response('x'.repeat(64*1024+1))]),1);
  assert.equal(await run([new Response('',{status:302,headers:{Location:'http://other/'}})]),1);
  const screen=()=>new Response('<service><name>YouTube</name><screenId>private-screen</screenId></service>');
  const token=()=>Response.json({screens:[{screenId:'private-screen',loungeToken:'private-token'}]});
  const frame=()=>new Response(JSON.stringify([[0,['c','sid']],[1,['S','session']]]));
  assert.equal(await run([screen(),token(),frame(),new Error('private-token')]),4);
  let gates=0;
  assert.equal(await run([screen(),token(),frame()],async()=>{if(++gates===4)throw new Error('Cancelled');}),3);
});

test('cancellation during a pending app response closes only the owned remote socket', async () => {
  const controller = new AbortController(); let closed = 0;
  const connection = await connectRemote(settings, auth, controller.signal, { agentFactory: () => ({ destroy() {} }),
    socketFactory: () => {
      const socket = new EventEmitter(); socket.terminate = () => { closed++; }; socket.send = (raw, callback) => callback();
      queueMicrotask(() => socket.emit('message', Buffer.from(JSON.stringify({ event: 'ms.channel.connect' })))); return socket;
    } });
  const pending = connection.apps(); controller.abort(new Error('cancelled')); await assert.rejects(pending, /cancelled/); assert.ok(closed >= 1);
});

test('multi-stage media control gates before each effect and never retries after cancellation', async () => {
  const http = fakeHttp(), adapter = adapterFor(http), h = harness(); await adapter.start(settings);
  let gates = 0;
  h.context.wait = async () => { if (++gates === 2) { h.controller.abort(new Error('cancelled between stages')); h.controller.signal.throwIfAborted(); } };
  await assert.rejects(adapter.execute('play-media', { url: 'https://example.com/video.mp4?a=1&b=2' }, h.context), /cancelled between stages/);
  assert.deepEqual(http.calls.map(call => call.action), ['SetAVTransportURI']); assert.match(http.calls[0].args, /&amp;/);
  assert.deepEqual(h.state, {}); assert.equal(h.events.length, 0);
});

test('TV readings commit transitions, retain failed sections and omit unavailable Task payloads', async () => {
  const http = fakeHttp(), adapter = adapterFor(http), h = harness(); await adapter.start(settings);
  await adapter.execute('refresh', {}, h.context); assert.deepEqual(h.events.map(event => event.id), ['status-updated']);
  http.volume(30); await adapter.execute('refresh', {}, h.context); assert.equal(h.events[1].id, 'tv-changed'); assert.equal(h.events[1].state.sequence, 1);
  http.failSections.add('GetVolume'); await adapter.execute('refresh', {}, h.context); assert.equal(h.state.volume, 30); assert.ok(!Object.hasOwn(h.events.at(-1).payload, 'volume'));
  http.failSections.clear(); await adapter.execute('refresh', {}, h.context); assert.equal(h.state.sequence, 1);
  const restarted = harness(h.state); await adapter.stop(); await adapter.start(settings); await adapter.execute('refresh', {}, restarted.context);
  assert.deepEqual(restarted.events.map(event => event.id), ['status-updated']);
  await adapter.execute('volume', { value: 40 }, restarted.context); assert.equal(restarted.state.volume, 30); assert.equal(restarted.state['last-command'], 'volume');
  const old = structuredClone(restarted.state); http.fail(true);
  await assert.rejects(adapter.execute('refresh', {}, restarted.context), error => !error.message.includes(auth.token)); assert.deepEqual(restarted.state, old);
});

test('Samsung own DPAPI token roundtrips without plaintext and retains damage', async t => {
  const base = fileURLToPath(new URL('./.tmp/', import.meta.url)); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'samsung-vault-')), file = path.join(root, 'token.dpapi');
  t.after(async () => { assert.ok(path.resolve(root).startsWith(path.resolve(base) + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  const vault = createVault(file); await vault.save(auth); assert.deepEqual(await vault.load(), auth); assert.ok(!(await fs.readFile(file)).includes(auth.token));
  await fs.writeFile(file, 'damage'); await assert.rejects(vault.load()); assert.equal(await fs.readFile(file, 'utf8'), 'damage');
});

test('installed Samsung runtime drives reading Tasks and projects chosen apps without private credentials', async t => {
  const base = fileURLToPath(new URL('./.tmp/', import.meta.url)); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'samsung-install-')), folder = path.join(root, 'plugins/samsung-tv');
  await fs.cp(new URL('../plugins/samsung-tv/', import.meta.url), folder, { recursive: true, filter: file => !file.split(path.sep).includes('data') });
  const metadata = structuredClone(declaration); metadata.runtime.entry = 'server/test-entry.mjs'; await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify(metadata));
  await fs.writeFile(path.join(folder, 'server/test-entry.mjs'), `import {createSamsungAdapter} from './index.mjs';
const auth=${JSON.stringify(auth)};
export default createSamsungAdapter({vault:{async load(){return auth;}},credentialReady:async()=>true,
http:{async info(){return {name:'TV',modelName:'UE75MU7002'};},async soap(host,action){return {GetVolume:{CurrentVolume:'25'},GetMute:{CurrentMute:'0'},GetTransportInfo:{CurrentTransportState:'PLAYING'},GetPositionInfo:{RelTime:'00:00:00'}}[action];}},
remote:async()=>({async apps(){return [{appId:'app',name:'App <name>'}];},close(){}})});`);
  const app = await createLocalserve(root, { automatic: false });
  t.after(async () => { await app.close(); assert.ok(path.resolve(root).startsWith(path.resolve(base) + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  const call = async (route, body) => { const response = await fetch(app.origin + route, body === undefined ? {} : { method: 'POST', headers: { Origin: app.origin, 'Content-Type': 'application/json', 'X-Localserve-Token': app.snapshot().token }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  const service = () => app.registry.services()[0];
  assert.equal((await call('/api/plugins/samsung-tv/config', { revision: service().config.revision, enabled: true, settings })).status, 200);
  assert.equal((await call('/api/tasks', { name: 'TV volume', enabled: true, starts: [{ id: 'rule', type: 'event', name: 'Event', enabled: true, eventId: 'plugin:samsung-tv:event:status-updated', condition: { field: 'volume', operator: 'gte', value: 20 } }], steps: [{ id: 'log', type: 'log', enabled: true, message: 'TV reading' }] })).status, 200);
  for (let i = 0; i < 2; i++) assert.equal((await call('/api/plugins/samsung-tv/actions/refresh', { parameters: {} })).status, 200);
  const deadline = Date.now() + 3000; while (app.engine.pending.size || app.engine.active.size) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.equal(app.state.snapshot().runs.length, 1);
  assert.equal((await call('/api/plugins/samsung-tv/actions/refresh-apps', { parameters: {} })).status, 200);
  await call('/api/plugins/samsung-tv/cards', { schemaVersion: 1, name: 'Apps', enabled: true, icon: 'inherit', size: 'medium', layout: 'table', fields: [{ id: 'table', binding: 'apps', label: 'Apps', enabled: true, icon: 'none', format: 'auto', unit: '', decimals: 0 }], listOptions: { rows: 1, fontSize: 14, noWrap: false, columns: ['name'] } });
  await call('/api/vistas', { schemaVersion: 1, name: 'TV', slug: 'tv', enabled: true, gap: 0, padding: 0, layout: { id: 'root', type: 'column', name: 'Canvas', enabled: true, width: '1fr', height: '1fr', children: [{ id: 'slot', type: 'card', name: 'Apps', enabled: true, width: '1fr', height: '1fr', cards: [{ pluginId: 'samsung-tv', cardId: service().cards[0].id }] }] } });
  const projection = (await call('/api/vistas/tv')).body;
  assert.deepEqual(Object.keys(projection.cards[0].data.values.apps.value[0]), ['name']); assert.doesNotMatch(JSON.stringify(projection), /test-token|reading-baseline|target-host|credentials.dpapi|token/);
  for (const name of ['config.json', 'state.json', 'credentials.dpapi']) assert.equal((await fetch(app.origin + '/plugins/samsung-tv/data/' + name)).status, 404);
});
