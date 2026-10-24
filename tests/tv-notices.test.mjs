/** Isolated notice claims/HTTP pages; never sends a physical TV command. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TvNotices, validateNotice } from '../server/tv-notices.mjs';
import { createLocalserve } from '../server.mjs';
import { validateTaskParameters, resolveTaskParameters } from '../server/task-event-values.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import vm from 'node:vm';

const base = fileURLToPath(new URL('./.tmp/', import.meta.url));
const content = { template: 'Warning', title: 'Train departure', message: 'Leave in ten minutes.', seconds: 10, sound: true };
async function rootFor(t, close = async () => {}) {
  await fs.mkdir(base, { recursive: true }); const root = await fs.mkdtemp(path.join(base, 'notices-'));
  t.after(async () => { await close(); assert.ok(path.resolve(root).startsWith(path.resolve(base) + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  return root;
}

test('four bounded templates and one persisted claim protect content, sound and concurrent notices through restart', async t => {
  const root = await rootFor(t); let now = Date.now();
  const config = { snapshot: () => ({ listen: { host: '10.23.42.3' }, vistaFontScale: 110, name: 'Desk' }) };
  let notices = await new TvNotices(root, config, () => ({ port: 7041 }), () => now).load();
  const results = await Promise.allSettled([notices.create(content), notices.create(content)]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  const url = new URL(results.find(value => value.status === 'fulfilled').value), id = url.pathname.split('/').at(-1);
  assert.doesNotMatch(url.href, /Train|Leave/);
  assert.equal(notices.view(id).fontScale, 110);
  assert.equal((await notices.report(id, 'shown')).first, true);
  now += 2000;
  notices = await new TvNotices(root, config, () => ({ port: 7041 }), () => now).load();
  const repeated = await notices.report(id, 'shown');
  assert.equal(repeated.first, false); assert.equal(repeated.remainingMs, 8000);
  await notices.report(id, 'finished'); assert.throws(() => notices.view(id), /unavailable/);
  const next = new URL(await notices.create(content)).pathname.split('/').at(-1);
  assert.notEqual(next, id); now += 36000; await notices.expire();
  assert.equal(notices.store.snapshot().notice, null);
  for (const patch of [{ template: 'Unknown' }, { title: ' ' }, { seconds: 0 }, { seconds: 3601 }, { sound: 'true' }, {'auto-close': 'false'}, {'loop-sound': 1}, { html: '<script>' }, { message: 'x'.repeat(2001) }]) assert.throws(() => validateNotice({ ...content, ...patch }));
  for (const template of ['Notice', 'Alarm', 'Alert', 'Warning']) assert.equal(validateNotice({ ...content, template }).template, template);
});

test('notice text uses ordinary immutable Event substitution and rejects missing/oversized fields before effects', async () => {
  const plugin = validateDeclaration(JSON.parse(await fs.readFile(new URL('../plugins/samsung-tv/declaration.json', import.meta.url), 'utf8')));
  const action = plugin.actions.find(action => action.id === 'show-notice');
  const events = [{ id: 'event', pluginId: 'source', eventId: 'update', payload: [{ id: 'title', type: 'string', maxLength: 200 }] }];
  const parameters = validateTaskParameters(action, { ...content, title: '{{event.title}}' }, [{ type: 'event', eventId: 'event' }], events);
  const event = { pluginId: 'source', eventId: 'update', payload: { title: '<b>Literal headline</b>' } };
  assert.equal(resolveTaskParameters(action, parameters, event, events).title, '<b>Literal headline</b>');
  assert.throws(() => resolveTaskParameters(action, parameters, null, events), /triggering event/);
  event.payload.title = 'x'.repeat(121); assert.throws(() => resolveTaskParameters(action, parameters, event, events));
});

test('notice URL grants only scoped text/reception; CSP, private storage, sounds and ordinary administrator boundaries remain', async t => {
  let app; const root = await rootFor(t, () => app?.close());
  await fs.cp(new URL('../assets/notices/', import.meta.url), path.join(root, 'assets/notices'), { recursive: true });
  app = await createLocalserve(root, { automatic: false });
  // Only the broker's advertised host is synthetic. Tests bind loopback only.
  app.registry.notices.config = { snapshot: () => ({ ...app.config.snapshot(), listen: { host: '10.23.42.3' } }) };
  const url = new URL(await app.registry.notices.create(content)), id = url.pathname.split('/').at(-1);
  const page = await fetch(app.origin + url.pathname);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /media-src 'self'.*frame-ancestors 'self' file:/);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.doesNotMatch(await page.text(), /Train departure|Leave in|<script[^>]*>[^<]+/);
  const data = await (await fetch(app.origin + '/api/tv-notices/' + id)).json();
  assert.equal(data.message, content.message); assert.equal(data.token, undefined);
  const post = (status, origin = app.origin) => fetch(app.origin + '/api/tv-notices/' + id, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
  assert.equal((await post('shown', 'https://outside.example')).status, 403);
  assert.equal((await post('launch-app')).status, 400);
  assert.equal((await (await post('shown')).json()).first, true);
  assert.equal((await (await post('shown')).json()).first, false);
  const wav = await fetch(app.origin + '/assets/notices/notice.wav');
  assert.equal(wav.headers.get('content-type'), 'audio/wav');
  assert.equal(Buffer.from(await wav.arrayBuffer()).toString('ascii', 0, 4), 'RIFF');
  assert.equal((await fetch(app.origin + '/data/tv-notice.json')).status, 404);
  assert.doesNotMatch(JSON.stringify(app.snapshot()), /Leave in ten minutes|Train departure/);
  await post('finished'); assert.equal((await fetch(app.origin + url.pathname)).status, 404);
  const persistent = new URL(await app.registry.notices.create({...content, 'auto-close': false}));
  const persistentId = persistent.pathname.split('/').at(-1);
  await app.registry.notices.report(persistentId, 'shown');
  const summary = app.snapshot().tvNotice;
  assert.equal(summary.active, true); assert.equal(summary.autoClose, false);
  const dismiss = (revision, token = app.snapshot().token) => fetch(app.origin + '/api/tv-notices/dismiss', {
    method: 'POST', headers: {Origin: app.origin, 'X-Localserve-Token': token, 'Content-Type': 'application/json'}, body: JSON.stringify({revision}),
  });
  assert.equal((await dismiss(summary.revision, 'wrong')).status, 403);
  assert.equal((await dismiss(summary.revision - 1)).status, 409);
  assert.equal((await dismiss(summary.revision)).status, 200);
  assert.equal((await (await fetch(app.origin + '/api/tv-notices/' + persistentId)).json()).dismissed, true);
  await app.registry.notices.report(persistentId, 'finished');
  await app.registry.notices.create(content);
  assert.equal((await dismiss(summary.revision)).status, 409, 'A stale dismiss cannot clear a newer notice');
});

test('the supervised TV action receives its committed claim URL, and a busy claim prevents another worker effect', async t => {
  let app; const root = await rootFor(t, () => app?.close());
  const folder = path.join(root, 'plugins/samsung-tv'); await fs.mkdir(path.join(folder, 'server'), { recursive: true });
  const declaration = JSON.parse(await fs.readFile(new URL('../plugins/samsung-tv/declaration.json', import.meta.url), 'utf8'));
  // Synthetic runtime verifies IPC ordering without credentials/device transport.
  declaration.settings = []; delete declaration.polling; delete declaration.controls;delete declaration.connectionSetup;
  declaration.cardFields = []; declaration.cardTemplates = []; declaration.events = [];
  await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify(declaration));
  await fs.writeFile(path.join(folder, 'server/index.mjs'), `export default {
    async validateConfiguration(){return true;}, async start(){}, async stop(){},
    async execute(id, parameters, context){await context.captureNoticeReturn('example.app');return {url:context.noticeUrl};},
    async returnNotice(values,context){await context.saveState({returned:values.appId});return {commandSent:true};}
  };`);
  app = await createLocalserve(root, { automatic: false });
  app.registry.notices.config = { snapshot: () => ({ ...app.config.snapshot(), listen: { host: '10.23.42.3' } }) };
  await app.registry.saveConfiguration('samsung-tv', { revision: 1, enabled: true, settings: {} });
  const result = await app.registry.execute('samsung-tv', 'show-notice', content);
  const saved = JSON.parse(await fs.readFile(path.join(root, 'data/tv-notice.json'), 'utf8'));
  assert.ok(result.url.includes(saved.notice.id));
  await assert.rejects(app.registry.execute('samsung-tv', 'show-notice', content), /already active/);
  assert.equal(saved.notice.returnTarget.appId,'example.app');
  await app.registry.notices.report(saved.notice.id,'shown');await app.registry.notices.report(saved.notice.id,'finished');
  assert.equal(app.registry.records.get('samsung-tv').state.snapshot().returned,'example.app');
});

const noticeScript = await fs.readFile(new URL('../assets/notices/notice.js', import.meta.url), 'utf8');
function noticePage({ preview = false, first = true, sound = true, autoClose = true, loopSound = false, webAudio = false, deferDecode = false } = {}) {
  let now = 10000, plays = 0, pauses = 0, tick, audio, source, decoded, gain, remotePause;
  const nodes = {}, messages = [], reports = [], listeners = {};
  const node = id => nodes[id] ||= { style: {}, textContent: '' };
  const data = { ...content, title: '<b>Literal</b>', id: 'a'.repeat(48), sound,
    'auto-close': autoClose, 'loop-sound': loopSound, elapsedMs: 0, remainingMs: autoClose ? 10000 : null, fontScale: 110 };
  class Request {
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader() {}
    abort() {}
    send(body) {
      this.status = 200;
      if (this.url.endsWith('.wav')) {this.response = {byteLength: 32000}; this.onload(); return;}
      if (this.method === 'POST') reports.push(JSON.parse(body).status);
      this.responseText = JSON.stringify(this.method === 'GET' ? data : { ...data, first });
      this.onload();
    }
  }
  const document = { hidden: false, getElementById: node, querySelector: node,
    body: { setAttribute() {} }, addEventListener: (name, callback) => { listeners[name] = callback; },
    createElement: () => (audio = {play() { plays++; this.onplaying?.(); }, pause() { pauses++; }}) };
  class AudioEngine {
    createGain() {return gain={gain:{value:1},connect(){}};}
    decodeAudioData(bytes, success) { if (deferDecode) decoded = success; else success({}); }
    createBufferSource() { return source = {connect() {}, start() {plays++;}, stop() {pauses++;}}; }
    close() {}
  }
  vm.runInNewContext(noticeScript, { document, window: {LocalserveTvViewer:{install(step,controls){remotePause=controls.pause;}},AudioContext: webAudio ? AudioEngine : undefined, parent: { postMessage: value => messages.push(value) }, addEventListener() {} },
    location: { pathname: preview ? '/assets/notices/notice.html' : '/tv-notices/' + data.id,
      search: preview ? '?preview=1' : '', hash: '#' + encodeURIComponent(JSON.stringify(data)) },
    XMLHttpRequest: Request, Date: { now: () => now }, JSON, Math, Number, isFinite,
    setInterval: (callback, ms) => { if (ms !== 5000) tick = callback; return 1; }, clearInterval() {},
    setTimeout() {},
  });
  return { nodes, messages, reports,remotePause,get gain(){return gain;},get plays() { return plays; }, get pauses() { return pauses; }, get audio() { return audio; }, get source() {return source;}, decode() {decoded({});},
    finish() { now += 10001; tick(); }, hide() { document.hidden = true; listeners.visibilitychange(); } };
}

test('notice page escapes text, claims sound once, returns locally and keeps preview/receptions silent', () => {
  const page = noticePage();
  assert.equal(page.nodes['notice-title'].textContent, '<b>Literal</b>');
  assert.equal(page.plays, 1); assert.deepEqual(page.reports, ['shown', 'sound-playing']);
  assert.equal(page.messages[0].type, 'localserve-notice-ready');
  page.finish(); assert.equal(page.pauses, 1); assert.equal(page.reports[2], 'finished');
  assert.equal(page.messages.at(-1).type, 'localserve-notice-finished');
  assert.equal(noticePage({ first: false }).plays, 0, 'A reload never replays sound');
  assert.equal(noticePage({ sound: false }).plays, 0);
  const preview = noticePage({ preview: true });
  assert.equal(preview.plays, 0); assert.equal(preview.messages.length, 0); assert.equal(preview.reports.length, 0);
});

test('untimed notice shows elapsed time and loops only the first claimed sound until dismissal', () => {
  const page = noticePage({autoClose: false, loopSound: true});
  assert.equal(page.audio.loop, false, 'Completion-driven looping avoids unsupported native WAV loop behaviour');
  assert.equal(page.plays, 1);
  assert.equal(page.messages[0].remainingMs, 0);
  assert.equal(page.nodes['return-label'].textContent, 'Press Back to dismiss');
  page.finish();
  assert.equal(page.nodes.countdown.textContent, 'Open for 00:10');
  assert.equal(page.pauses, 0, 'The saved duration does not close an untimed notice');
  page.audio.onended();
  assert.equal(page.plays, 2);
  assert.deepEqual(page.reports, ['shown', 'sound-playing'], 'A repeated cue does not repeat reception writes');
  page.hide();
  assert.equal(page.audio.loop, false); assert.equal(page.pauses, 1);
  assert.equal(page.messages.at(-1).type, 'localserve-notice-finished');
  page.audio.onended(); assert.equal(page.plays, 2, 'A late ended callback cannot restart dismissed sound');
  assert.equal(noticePage({autoClose: false, loopSound: true, first: false}).plays, 0);
  assert.equal(noticePage({preview: true, autoClose: false, loopSound: true}).plays, 0);
  const timed = noticePage({loopSound: true});
  timed.finish(); assert.equal(timed.pauses, 1); assert.equal(timed.audio.loop, false);
  const failed = noticePage({loopSound: true});
  failed.audio.onerror(); failed.audio.onended();
  assert.equal(failed.plays, 1, 'Playback failures stop repetition without retry');
});

test('buffered chimes loop one decoded cue, stop on dismissal and discard late decodes', () => {
  const page = noticePage({autoClose: false, loopSound: true, webAudio: true});
  assert.equal(page.source.loop, true); assert.equal(page.plays, 1);
  assert.deepEqual(page.reports, ['shown', 'sound-playing']);
  page.finish(); assert.equal(page.pauses, 0);
  page.hide(); assert.equal(page.pauses, 1);
  const late = noticePage({autoClose: false, loopSound: true, webAudio: true, deferDecode: true});
  late.hide(); late.decode();
  assert.equal(late.plays, 0, 'Decode completion cannot resurrect a dismissed chime');
});

test('remote sound pause mutes either chime engine without extending automatic expiry or replaying a cue',()=>{
  for(const webAudio of [false,true]){
    const page=noticePage({loopSound:true,webAudio});page.remotePause('pause');
    if(webAudio)assert.equal(page.gain.gain.value,0);else assert.equal(page.audio.muted,true);
    page.remotePause('play');if(webAudio)assert.equal(page.gain.gain.value,1);else assert.equal(page.audio.muted,false);
    assert.equal(page.plays,1);page.finish();assert.equal(page.messages.at(-1).type,'localserve-notice-finished');
  }
});

test('untimed claims survive time and restart, with revision-checked explicit dismissal and expiring unshown reservations', async t => {
  const root = await rootFor(t); let now = Date.now();
  const config = {snapshot: () => ({listen: {host: '10.23.42.3'}})};
  let notices = await new TvNotices(root, config, () => ({port: 7041}), () => now).load();
  const id = new URL(await notices.create({...content, 'auto-close': false, 'loop-sound': true})).pathname.split('/').at(-1);
  const shown = await notices.report(id, 'shown');
  assert.equal(shown.remainingMs, null); assert.equal(shown.first, true);
  const revision = notices.admin().revision;
  now += 86400000;
  await notices.expire();
  notices = await new TvNotices(root, config, () => ({port: 7041}), () => now).load();
  assert.equal(notices.view(id).elapsedMs, 86400000);
  assert.equal((await notices.report(id, 'shown')).first, false);
  await assert.rejects(notices.create(content), /already active/);
  await assert.rejects(notices.dismiss(revision - 1), /changed/);
  await notices.dismiss(revision);
  assert.equal(notices.view(id).dismissed, true);
  await assert.rejects(notices.create(content), /already active/, 'New notices wait for the closing acknowledgement');
  await notices.report(id, 'finished');
  assert.equal(notices.admin().active, false);
  assert.throws(() => notices.view(id), /unavailable/);
  await notices.create({...content, 'auto-close': false});
  now += 26000; await notices.expire();
  assert.equal(notices.admin().active, false);
});
