/** Isolated HTML/HTTP/runtime checks. No user pages or existing services are queried. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createLocalserve } from '../server.mjs';
import { createWebpageAdapter, pageUrl, localPagePath, publicAddress, parsePage, readPage, checkTvPage } from '../plugins/webpage/server/index.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { validateCard, projectCardData, selectedCardData, cardCatalog } from '../server/cards.mjs';

const declaration = JSON.parse(await fs.readFile(new URL('../plugins/webpage/declaration.json', import.meta.url), 'utf8'));
const plugin = validateDeclaration(declaration);
const settings = { 'poll-minutes': 60, pages: [{ id: 'example', name: 'Example', query: 'https://example.com/', enabled: true, 'parse-text': true }] };

test('Localserve display paths are explicit, display-only and never sent to HTTP/DNS polling', async () => {
  const local = '/assets/pages/scifi.html';
  assert.equal(localPagePath(local), local);
  assert.equal(localPagePath('/universe'), '/universe');
  assert.equal(localPagePath('/phone-information'),'/phone-information');
  assert.equal(pageUrl(local), null);
  for (const value of ['/api/state', '/controls/tradfri/lights', '/assets/notices/notice.html',
    '/assets/pages/../secret.html', '/assets/pages/%2e%2e/secret.html', '/assets/pages/a.html?token=abc',
    '//example.com/assets/pages/a.html', 'http://10.23.42.3:7041/assets/pages/a.html',
    '/universe/', '/universe?token=abc', '/universe#card', 'http://10.23.42.3:7041/universe']) assert.equal(localPagePath(value), null);
  const h = harness(), sends = [];
  h.context.openWebpageOnTv = async id => sends.push(id);
  const adapter = createWebpageAdapter({read: async () => {throw new Error('Unexpected local HTTP');},
    checkTv: async () => {throw new Error('Unexpected local DNS');}});
  const value = {...settings, pages: [{...settings.pages[0], query: local}]};
  assert.equal(adapter.validateConfiguration(value), true);
  await adapter.start(value);
  assert.deepEqual(await adapter.execute('refresh', {'page-id': 'example'}, h.context), {completed: true, displayOnly: true});
  await adapter.execute('open-on-tv', {'page-id': 'example'}, h.context);
  assert.deepEqual(sends, ['example']);
  assert.deepEqual(h.state, {});
  assert.deepEqual(h.events, []);
  await adapter.start({...value, pages:[{...value.pages[0], query:'/universe'}]});
  assert.deepEqual(await adapter.execute('refresh', {'page-id':'example'}, h.context), {completed:true, displayOnly:true});
  await adapter.execute('open-on-tv', {'page-id':'example'}, h.context);
  assert.deepEqual(sends, ['example', 'example']);
  await adapter.start({...value,pages:[{...value.pages[0],query:'/phone-information'}]});
  assert.deepEqual(await adapter.execute('refresh',{'page-id':'example'},h.context),{completed:true,displayOnly:true});
  await adapter.execute('open-on-tv',{'page-id':'example'},h.context);
  assert.deepEqual(sends,['example','example','example']);
  assert.deepEqual(h.state, {});
  assert.deepEqual(h.events, []);
  assert.equal(adapter.validateConfiguration({...value, pages: [{...value.pages[0], query: 'http://10.23.42.4:8080/'}]}), false);
});
function harness() {
  let state = {};
  const events = [], logs = [], controller = new AbortController();
  const context = { signal: controller.signal, readState: async () => structuredClone(state),
    saveState: async value => { state = structuredClone(value); },
    emit: async (id, payload) => { events.push({ id, payload, state: structuredClone(state) }); },
    log: async (message, level) => logs.push({ message, level }) };
  return { context, controller, events, logs, get state() { return state; } };
}

test('Open on TV validates the public page and never refreshes readings or fabricates events', async () => {
  const h = harness();
  const sends = [], checks = [];
  h.context.openWebpageOnTv = async id => sends.push(id);
  const adapter = createWebpageAdapter({read: async () => {throw new Error('Unexpected HTTP read');},
    checkTv: async (url, signal) => {signal.throwIfAborted(); checks.push(url);}});
  await adapter.start(settings);
  await adapter.execute('open-on-tv', {'page-id': 'example'}, h.context);
  assert.deepEqual(checks, ['https://example.com/']);
  assert.deepEqual(sends, ['example']);
  assert.deepEqual(h.state, {});
  assert.equal(h.events.length, 0);
  await assert.rejects(adapter.execute('open-on-tv', {'page-id': 'missing'}, h.context), /enabled webpage/);
  assert.equal(sends.length, 1);
  const signal = new AbortController().signal;
  assert.equal(await checkTvPage('https://example.com/', signal, async () => [{address: '93.184.216.34'}]), 'https://example.com/');
  await assert.rejects(checkTvPage('https://example.com/', signal, async () => [{address: '127.0.0.1'}]), /local, private/);
  await assert.rejects(checkTvPage('https://user:secret@example.com/', signal), /public HTTP/);
  h.controller.abort();
  await assert.rejects(adapter.execute('open-on-tv', {}, h.context), /abort/i);
  assert.equal(sends.length, 1);
});

test('saved Webpage TV launches use the existing Samsung queue, revisions and cancellation without retries', async t => {
  const base = fileURLToPath(new URL('./.tmp/', import.meta.url));
  await fs.mkdir(base, {recursive: true});
  const root = await fs.mkdtemp(path.join(base, 'webpage-tv-'));
  for (const id of ['webpage', 'samsung-tv']) {
    const folder = path.join(root, 'plugins', id);
    await fs.cp(new URL(`../plugins/${id}/`, import.meta.url), folder,
      {recursive: true, filter: source => !source.split(path.sep).includes('data')});
    const raw = JSON.parse(await fs.readFile(path.join(folder, 'declaration.json'), 'utf8'));
    raw.runtime.entry = 'server/test-entry.mjs';
    await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify(raw));
  }
  await fs.writeFile(path.join(root, 'plugins/webpage/server/test-entry.mjs'), `
import {createWebpageAdapter} from './index.mjs';
export default createWebpageAdapter({checkTv: async()=>{}});`);
  const messages = path.join(root, 'plugins/samsung-tv/data/test-messages.json');
  await fs.writeFile(path.join(root, 'plugins/samsung-tv/server/test-entry.mjs'), `
import fs from 'node:fs/promises';
import {createSamsungAdapter} from './index.mjs';
export default createSamsungAdapter({credentialReady:async()=>true,
vault:{load:async()=>({host:'10.23.42.5',port:8001,token:'test-token'}),save:async()=>{}},
remote:async()=>({close(){},send:async message=>{
await fs.appendFile(new URL('../data/test-messages.json',import.meta.url),JSON.stringify(message)+'\\n');
try{await fs.access(new URL('../data/fail-send',import.meta.url));}catch{return;}
throw new Error('Synthetic send failure');
}})});`);
  const app = await createLocalserve(root, {automatic: false});
  t.after(async () => {
    await app.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(base) + path.sep));
    await fs.rm(root, {recursive: true, force: true});
  });
  const count = async () => {try{return (await fs.readFile(messages, 'utf8')).trim().split('\n').length;}catch{return 0;}};
  const call = async body => {
    const response = await fetch(app.origin + '/api/plugins/webpage/actions/open-on-tv', {method: 'POST',
      headers: {Origin: app.origin, 'Content-Type': 'application/json', 'X-Localserve-Token': app.snapshot().token}, body: JSON.stringify(body)});
    return {status: response.status, body: await response.json()};
  };
  await app.registry.saveConfiguration('webpage', {revision: 1, enabled: true, settings});
  assert.equal(app.registry.actions().find(action => action.actionId === 'open-on-tv').available, false);
  assert.throws(() => app.registry.execute('webpage', 'open-on-tv', {'page-id': 'example'}), /Samsung TV/);
  await app.registry.saveConfiguration('samsung-tv', {revision: 1, enabled: true, settings: {
    host: '10.23.42.5', port: 8001, token: '', fingerprint: '', 'remote-name': 'Test', 'poll-minutes': 1,
  }});
  const record = app.registry.get('webpage');
  const revision = record.config.snapshot().revision;
  const hostSignal = new AbortController().signal;
  assert.equal((await call({parameters: {'page-id': 'example'}})).status, 400);
  assert.equal((await call({revision: revision - 1, parameters: {'page-id': 'example'}})).status, 409);
  await assert.rejects(app.registry.hostCall(record, 'open-webpage-on-tv', {pageId: 'example'}, {signal: hostSignal}), /only once/);
  assert.equal(await count(), 0);
  const response = await call({revision, parameters: {'page-id': 'example'}});
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const sent = JSON.parse((await fs.readFile(messages, 'utf8')).trim());
  assert.equal(sent.params.data.appId, 'HwGlance01.HomeGlance');
  assert.equal(sent.params.data.action_type, 'DEEP_LINK');
  assert.equal(sent.params.data.metaTag, 'https://example.com/');
  assert.equal(await count(), 1);
  assert.deepEqual(record.state.snapshot(), {});
  const claim = {used: false, revision, pageId: 'example'};
  await app.registry.hostCall(record, 'open-webpage-on-tv', {pageId: 'example'}, {signal: hostSignal, webpageTvLaunch: claim});
  await assert.rejects(app.registry.hostCall(record, 'open-webpage-on-tv', {pageId: 'example'}, {signal: hostSignal, webpageTvLaunch: claim}), /only once/);
  assert.equal(await count(), 2);
  const tv = app.registry.get('samsung-tv');
  let release;
  tv.actionQueue = new Promise(resolve => {release = resolve;});
  const controller = new AbortController();
  const pending = app.registry.execute('webpage', 'open-on-tv', {'page-id': 'example'}, {signal: controller.signal});
  const rejected = assert.rejects(pending, /cancel/i);
  const until = Date.now() + 2000;
  while (!tv.pending) {
    if (Date.now() > until) throw new Error('TV action did not queue');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  controller.abort(new Error('Cancelled test'));
  release();
  await rejected;
  assert.equal(await count(), 2, 'A cancelled queued launch sends nothing');
  // Quiet hours apply to automatic delegation before DNS and again in the
  // nested Samsung queue, while this same saved-page button remains manual.
  await app.config.update(config => {config.doNotDisturb.enabled = true;});
  assert.throws(() => app.registry.execute('webpage', 'open-on-tv', {'page-id': 'example'}, {automatic: true}), {code: 'TV_DO_NOT_DISTURB'});
  assert.equal((await call({revision, parameters: {'page-id': 'example'}})).status, 200);
  assert.equal(await count(), 3);
  await app.config.update(config => {config.doNotDisturb.enabled = false;});
  tv.actionQueue = new Promise(resolve => {release = resolve;});
  const quietPending = app.registry.execute('webpage', 'open-on-tv', {'page-id': 'example'}, {automatic: true});
  const quietRejected = assert.rejects(quietPending, {code: 'TV_DO_NOT_DISTURB'});
  const quietDeadline = Date.now() + 2000;
  while (!tv.pending) {
    if (Date.now() > quietDeadline) throw new Error('Nested TV action did not queue');
    await new Promise(next => setTimeout(next, 5));
  }
  await app.config.update(config => {config.doNotDisturb.enabled = true;});
  release(); await quietRejected;
  assert.equal(await count(), 3, 'Nested automatic launches retain their quiet-hours context.');
  await app.config.update(config => {config.doNotDisturb.enabled = false;});
  await fs.writeFile(path.join(root, 'plugins/samsung-tv/data/fail-send'), 'test');
  await assert.rejects(app.registry.execute('webpage', 'open-on-tv', {'page-id': 'example'}));
  assert.equal(await count(), 4, 'An uncertain failed send is attempted once');
  await fs.rm(path.join(root, 'plugins/samsung-tv/data/fail-send'));
  await fs.mkdir(path.join(root, 'assets/pages'), {recursive: true});
  await fs.writeFile(path.join(root, 'assets/pages/test.html'), '<!doctype html><title>Local display</title>');
  await fs.mkdir(path.join(root, 'web'), {recursive: true});
  await fs.writeFile(path.join(root, 'web/index.html'), '<!doctype html><title>Administration</title>');
  const localSettings = structuredClone(settings);
  localSettings.pages[0].query = '/assets/pages/test.html';
  await app.registry.saveConfiguration('webpage', {revision, settings: localSettings});
  await assert.rejects(app.registry.execute('webpage', 'open-on-tv', {'page-id': 'example'}), /private LAN/);
  assert.equal(await count(), 4);
  // Only the synthetic destination text changes; the TV adapter remains fake.
  app.registry.localDisplayOrigin = () => 'http://10.23.42.3:7041';
  await app.registry.execute('webpage', 'open-on-tv', {'page-id': 'example'});
  assert.equal(await count(), 5);
  const localMessage = JSON.parse((await fs.readFile(messages, 'utf8')).trim().split('\n').at(-1));
  assert.equal(localMessage.params.data.metaTag, 'http://10.23.42.3:7041/assets/pages/test.html');
  assert.doesNotMatch(JSON.stringify(localMessage), /token|capability|localhost|127\.0\.0\.1/);
  const served = await fetch(app.origin + '/assets/pages/test.html');
  assert.equal(served.status, 200);
  assert.match(served.headers.get('content-security-policy'), /sandbox allow-scripts;/);
  assert.doesNotMatch(served.headers.get('content-security-policy'), /allow-same-origin|'unsafe-inline'.*script-src/);
  assert.match(served.headers.get('content-security-policy'), /connect-src 'none'/);
  assert.match(served.headers.get('content-security-policy'), /frame-ancestors 'self' file:/);
  assert.equal(served.headers.get('referrer-policy'), 'no-referrer');
  const administrator = await fetch(app.origin + '/');
  assert.match(administrator.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  await fs.rm(path.join(root, 'assets/pages/test.html'));
  await assert.rejects(app.registry.execute('webpage', 'open-on-tv', {'page-id': 'example'}), /Local display page not found/);
  assert.equal(await count(), 5, 'Missing project pages never launch an unrelated URL.');

  // Universe uses one exact public server route and its own viewer CSP. All
  // sends here still terminate in the instrumented fake Samsung adapter.
  const universeSettings = {...settings, pages:[{...settings.pages[0], name:'Universe', query:'/universe'}]};
  await app.registry.saveConfiguration('webpage', {revision:record.config.snapshot().revision,settings:universeSettings});
  const action = app.registry.actions().find(action => action.actionId === 'open-on-tv');
  assert.deepEqual(action.parameters.find(field => field.id === 'page-id').enumLabels, ['Universe']);
  await assert.rejects(app.registry.execute('webpage','open-on-tv',{'page-id':'example'}), /Universe display page is unavailable/);
  assert.equal(await count(),5);
  await fs.writeFile(path.join(root,'web/universe.html'),'<!doctype html><title>Universe</title>');
  await app.universe.save({...app.universe.snapshot(),enabled:false});
  await assert.rejects(app.registry.execute('webpage','open-on-tv',{'page-id':'example'}), /Enable Universe/);
  assert.equal(await count(),5);
  await app.universe.save({...app.universe.snapshot(),enabled:true});
  await app.registry.execute('webpage','open-on-tv',{'page-id':'example'});
  assert.equal(await count(),6);
  const universeMessage = JSON.parse((await fs.readFile(messages,'utf8')).trim().split('\n').at(-1));
  assert.equal(universeMessage.params.data.metaTag,'http://10.23.42.3:7041/universe');
  assert.equal(universeMessage.params.data.appId,'HwGlance01.HomeGlance');
  const universePage = await fetch(app.origin+'/universe');
  assert.match(universePage.headers.get('content-security-policy'), /frame-ancestors 'self' file:/);
  assert.doesNotMatch(universePage.headers.get('content-security-policy'), /sandbox|connect-src 'none'/);
  assert.deepEqual(record.state.snapshot(),{});
});

test('Webpage declaration, public URL validation and offline lifecycle', async () => {
  let calls = 0;
  const adapter = createWebpageAdapter({ read: async () => { calls++; } });
  assert.equal(plugin.defaultCardLayout, 'webpage');
  assert.equal(plugin.polling.targetParameter, 'page-id');
  assert.equal(plugin.settings[0].default, 60);
  assert.deepEqual(plugin.settings[0].enum.slice(-1), [1440]);
  assert.equal(plugin.events[0].occurrenceKey, 'change-id');
  const invalidSource = structuredClone(declaration);
  invalidSource.cardFields[0].source.revisionKey = 'private-counter';
  assert.throws(() => validateDeclaration(invalidSource), /declared URL\/reception/);
  assert.equal(adapter.validateConfiguration(settings), true);
  assert.equal(adapter.validateConfiguration({ ...settings, pages: [] }), false);
  await adapter.start(settings); await adapter.stop();
  assert.equal(calls, 0);
  for (const url of ['file:///test', 'javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com:8080/', 'http://127.0.0.1/', 'http://10.0.0.1/', 'http://localhost/', 'https://printer/', 'https://example.com/ bad']) assert.equal(pageUrl(url), null, url);
  assert.equal(pageUrl('https://example.com/#section'), 'https://example.com/#section');
  for (const ip of ['::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '2001:db8::1', '2002:7f00:1::1', '169.254.1.1', '100.64.0.1', '192.168.1.1', '198.18.1.1', '203.0.113.1']) assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('93.184.216.34'), true);
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
});

test('HTML text extraction decodes entities, ignores active/hidden content and bounds text', () => {
  const html = '<html><head><title>News &amp; Updates</title><style>bad</style></head><body><h1>Hello &copy;</h1><p>One <b>two</b></p><script>bad()</script><div hidden>hidden</div><div aria-hidden="true">secret</div><template>template</template><p>Three</p></body></html>';
  const reading = parsePage(html, true);
  assert.equal(reading.title, 'News & Updates');
  assert.match(reading.text, /Hello ©/);
  assert.match(reading.text, /One two/);
  assert.doesNotMatch(reading.text, /bad|hidden|secret|template|News/);
  assert.equal(parsePage(html, false).text, null);
  const huge = parsePage('<p>' + 'a'.repeat(17000) + '</p>', true);
  assert.equal(huge.text.length, 16000);
  assert.equal(huge['text-truncated'], true);
  assert.equal(parsePage('<div>'.repeat(3000) + 'deep' + '</div>'.repeat(3000), true).text, 'deep');
});

test('successful HTML baselines, changes, repeats, restarts, URL edits and separate page identities', async () => {
  const h = harness();
  let html = '<title>A</title><p>First</p>', time = 1000;
  const options = { read: async () => ({ html, bytes: html.length }), now: () => time++ };
  let adapter = createWebpageAdapter(options);
  await adapter.start(settings);
  await adapter.execute('refresh', {}, h.context);
  assert.equal(h.events.length, 0, 'first reading is a baseline');
  await adapter.execute('refresh', {}, h.context);
  assert.equal(h.events.length, 0);
  html = '<title>B</title><p>Changed</p>';
  await adapter.execute('refresh', {}, h.context);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].state.pages.example['change-count'], 1, 'state committed before event');
  assert.equal(h.events[0].payload['change-id'], 'example:1');
  adapter = createWebpageAdapter(options); await adapter.start(settings);
  await adapter.execute('refresh', {}, h.context);
  assert.equal(h.events.length, 1, 'restart does not replay');
  html = '<title>A</title><p>First</p>';
  await adapter.execute('refresh', {}, h.context);
  assert.equal(h.events[1].payload['change-id'], 'example:2', 'returning content is a new occurrence');
  const next = structuredClone(settings);
  next.pages[0].query = 'https://example.org/'; next.pages[0].name = 'Renamed'; next.pages[0]['parse-text'] = false;
  next.pages.push({ ...next.pages[0], id: 'second', name: 'Second', query: 'https://example.net/' });
  await adapter.stop(); await adapter.start(next);
  await adapter.execute('refresh', { 'page-id': 'example' }, h.context);
  assert.equal(h.events.length, 2, 'URL edit creates a new baseline');
  assert.equal(h.state.pages.example.text, null);
  await adapter.execute('refresh', { 'page-id': 'second' }, h.context);
  html = '<p>New</p>';
  await adapter.execute('refresh', { 'page-id': 'second' }, h.context);
  assert.equal(h.events[2].payload['page-id'], 'second');
  assert.equal(h.state.pages.example['change-count'], 2);
});

test('failure, save rejection and cancellation preserve state and produce no change effects', async () => {
  const h = harness(); let fail = false;
  const adapter = createWebpageAdapter({ read: async () => {
    if (fail) throw new Error('HTTP error'); return { html: '<p>A</p>', bytes: 8 };
  } });
  await adapter.start(settings); await adapter.execute('refresh', {}, h.context);
  const before = structuredClone(h.state);
  fail = true; await assert.rejects(adapter.execute('refresh', {}, h.context), /HTTP error/);
  assert.deepEqual(h.state, before); assert.equal(h.events.length, 0);
  const changed = createWebpageAdapter({ read: async () => ({ html: '<p>B</p>', bytes: 8 }) });
  await changed.start(settings);
  await assert.rejects(changed.execute('refresh', {}, { ...h.context, saveState: async () => { throw new Error('disk failure'); } }), /disk failure/);
  assert.deepEqual(h.state, before); assert.equal(h.events.length, 0);
  const cancelled = createWebpageAdapter({ read: async () => { h.controller.abort(new Error('cancelled')); return { html: 'B', bytes: 1 }; } });
  await cancelled.start(settings);
  await assert.rejects(cancelled.execute('refresh', {}, h.context), /cancelled/);
  assert.deepEqual(h.state, before); assert.equal(h.events.length, 0);
});

function requestFixture({ code = 200, type = 'text/html; charset=utf-8', encoding, body = '<p>Example</p>' } = {}) {
  let called = 0, options;
  return { get called() { return called; }, get options() { return options; },
    request(url, opts, callback) {
      called++; options = opts;
      const req = new EventEmitter();
      req.end = () => {
        const response = Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(body)]);
        response.statusCode = code;
        response.headers = { 'content-type': type, ...(encoding ? { 'content-encoding': encoding } : {}) };
        callback(response);
      };
      return req;
    } };
}
test('HTTP collection pins checked DNS answers and rejects redirects, private answers and oversized/invalid content', async () => {
  const signal = new AbortController().signal;
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const f = requestFixture();
  assert.match((await readPage('https://example.com/', signal, { lookup, request: f.request })).html, /Example/);
  assert.equal(f.options.headers['Accept-Encoding'], 'identity');
  f.options.lookup('example.com', {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, '93.184.216.34'); assert.equal(family, 4); });
  const blocked = requestFixture();
  await assert.rejects(readPage('https://example.com/', signal, { lookup: async () => [{ address: '127.0.0.1', family: 4 }], request: blocked.request }), /private/);
  assert.equal(blocked.called, 0);
  for (const [fixture, message] of [[{ code: 302 }, /redirects/], [{ type: 'image/png' }, /not HTML/], [{ encoding: 'gzip' }, /uncompressed/], [{ body: 'x'.repeat(1024 * 1024 + 1) }, /1 MiB/], [{ body: Buffer.from([0xc3, 0x28]) }, /invalid text/]]) {
    const request = requestFixture(fixture).request;
    await assert.rejects(readPage('https://example.com/', signal, { lookup, request }), message);
  }
  const abort = new AbortController();
  const pending = readPage('https://example.com/', abort.signal, { lookup: () => new Promise(() => {}), request: blocked.request });
  abort.abort(new Error('cancelled lookup'));
  await assert.rejects(pending, /cancelled lookup/);
  assert.equal(blocked.called, 0);
});

test('whole-page Cards project only the explicit URL/reception key and render sandboxed escaped frames', async () => {
  const card = validateCard({ schemaVersion: 1, name: 'Page', enabled: true, icon: 'inherit', size: 'medium', layout: 'webpage', fields: [
    { id: 'one', binding: 'example:page', label: 'Example', enabled: true, icon: 'none', format: 'auto', unit: '', decimals: 0 },
  ] }, plugin, null, settings);
  const state = { pages: { example: { 'page-url': 'https://example.com/', 'received-at': 1234, hash: 'private hash', text: 'hidden text' } } };
  const record = { config: { snapshot: () => ({ enabled: true, settings }) }, state: { snapshot: () => state }, log: { latest: () => [] }, configured: true, health: 'ready' };
  const projection = selectedCardData(card, projectCardData(plugin, record), cardCatalog(plugin, settings));
  assert.deepEqual(Object.keys(projection.data.values), ['example:page']);
  assert.deepEqual(projection.data.values['example:page'].value, { url: 'https://example.com/', revision: 1234 });
  assert.doesNotMatch(JSON.stringify(projection), /private hash|hidden text|urlSetting|revisionKey/);
  const renderer = vm.runInNewContext(await fs.readFile(new URL('../web/card-renderer.js', import.meta.url), 'utf8') + '\nCardRenderer;', { URL, Intl, Date });
  const markup = renderer.render(card, projection.data, projection.catalog);
  assert.match(markup, /<iframe/); assert.match(markup, /sandbox="allow-scripts allow-forms"/);
  assert.doesNotMatch(markup, /allow-same-origin|srcdoc/);
  const clipped = renderer.render({ ...card, crop: true }, projection.data, projection.catalog);
  assert.match(clipped, /scrolling="no" tabindex="-1" inert/);
  const invalid = structuredClone(projection.data); invalid.values['example:page'].value.url = 'javascript:alert(1)';
  assert.doesNotMatch(renderer.render(card, invalid, projection.catalog), /<iframe/);
  assert.throws(() => validateCard({ ...card, layout: 'grid' }, plugin, null, settings), /Webpage style/);
  const disabled = structuredClone(settings); disabled.pages[0].enabled = false;
  assert.equal(projectCardData(plugin, { ...record, config: { snapshot: () => ({ enabled: true, settings: disabled }) } }).values['example:page'].available, false);
});

test('installed page changes drive distinct conditional Show Vista Tasks across restart with private projections', async t => {
  const base = fileURLToPath(new URL('./.tmp/', import.meta.url));
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'webpage-'));
  const folder = path.join(root, 'plugins/webpage');
  await fs.cp(new URL('../plugins/webpage/', import.meta.url), folder, { recursive: true, filter: file => !file.split(path.sep).includes('data') });
  const testDeclaration = structuredClone(declaration);
  testDeclaration.runtime.entry = 'server/test-entry.mjs';
  await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify(testDeclaration));
  await fs.writeFile(path.join(folder, 'server/test-entry.mjs'), `
import fs from 'node:fs/promises';
import { createWebpageAdapter } from './index.mjs';
export default createWebpageAdapter({ read: async () => {
  const html = await fs.readFile(new URL('./reading.html', import.meta.url), 'utf8');
  return { html, bytes: Buffer.byteLength(html) };
} });`);
  const reading = html => fs.writeFile(path.join(folder, 'server/reading.html'), html);
  await reading('<title>Changed</title><p>Baseline</p>');
  let app = await createLocalserve(root, { automatic: false });
  t.after(async () => {
    await app.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(base) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  const call = async (route, values) => {
    const response = await fetch(app.origin + route, values === undefined ? {} : { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: app.origin, 'X-Localserve-Token': app.snapshot().token }, body: JSON.stringify(values) });
    return { status: response.status, body: await response.json() };
  };
  const service = () => app.registry.services()[0];
  assert.equal((await call('/api/plugins/webpage/config', { revision: service().config.revision, settings, enabled: true })).status, 200);
  const vista = { schemaVersion: 1, name: 'Web', slug: 'web', enabled: true, gap: 0, padding: 0,
    layout: { id: 'root', type: 'column', name: 'Canvas', enabled: true, width: '1fr', height: '1fr', children: [] } };
  await call('/api/vistas', vista);
  const target = app.vistas.snapshot()[0];
  const task = { name: 'Changed page display', enabled: true,
    starts: [{ id: 'event', name: 'Event', type: 'event', enabled: true, eventId: 'plugin:webpage:event:page-changed:example', condition: { field: 'title', operator: 'eq', value: 'Changed' } }],
    steps: [{ id: 'show', type: 'show-vista', enabled: true, vistaId: target.id }] };
  assert.equal((await call('/api/tasks', task)).status, 200);
  const refresh = () => call('/api/plugins/webpage/actions/refresh', { parameters: { 'page-id': 'example' } });
  const settle = async () => {
    const deadline = Date.now() + 3000;
    while (app.engine.pending.size || app.engine.active.size) {
      if (Date.now() > deadline) throw new Error('Page-change Task did not settle');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  assert.equal((await refresh()).status, 200); await settle();
  assert.equal(app.state.snapshot().runs.length, 0);
  await reading('<title>Changed</title><p>Second</p>');
  assert.equal((await refresh()).status, 200); await settle();
  assert.equal(app.state.snapshot().runs.length, 1);
  assert.equal((await call('/api/display')).body.vista.id, target.id);
  await app.close(); app = await createLocalserve(root, { automatic: false });
  await refresh(); await settle(); assert.equal(app.state.snapshot().runs.length, 1);
  await reading('<title>Changed</title><p>Third</p>');
  await refresh(); await settle(); assert.equal(app.state.snapshot().runs.length, 2, 'consecutive matching changes have distinct claims');
  assert.equal((await call('/api/plugins/webpage/cards', { schemaVersion: 1, name: 'Whole page', enabled: true, icon: 'inherit', size: 'medium', layout: 'webpage',
    fields: [{ id: 'one', binding: 'example:page', label: 'Example', enabled: true, icon: 'none', format: 'auto', unit: '', decimals: 0 }] })).status, 200);
  const reference = { id: 'slot', type: 'card', name: 'Page', enabled: true, width: '1fr', height: '1fr', cards: [{ pluginId: 'webpage', cardId: service().cards[0].id }] };
  assert.equal((await call(`/api/vistas/${target.id}`, { ...target, layout: { ...target.layout, children: [reference] } })).status, 200);
  const projection = (await call('/api/display')).body;
  assert.equal(projection.cards[0].data.values['example:page'].value.url, 'https://example.com/');
  assert.doesNotMatch(JSON.stringify(projection), /hash|Third|text-truncated|urlSetting|token|stateMaxBytes/);
  for (const filename of ['config.json', 'state.json', 'activity.jsonl', 'cards.json']) assert.equal((await fetch(app.origin + '/plugins/webpage/data/' + filename)).status, 404);
});
