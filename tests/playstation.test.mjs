/** Synthetic Sony transport/state checks plus actual local DPAPI roundtrips.
 * No test sends credentials to Sony or contacts an installed service.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createPlaystationAdapter, normalizePresence, durationSeconds, gameReadings, collectionReadings } from '../plugins/playstation/server/index.mjs';
import { createClient, ownAccountId, validNpsso } from '../plugins/playstation/server/client.mjs';
import { createVault } from '../plugins/playstation/server/vault.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { createLocalserve } from '../server.mjs';

const declaration = JSON.parse(await fs.readFile(new URL('../plugins/playstation/declaration.json', import.meta.url), 'utf8'));
const npsso = 'a'.repeat(64);
const session = { accessToken: 'access', refreshToken: 'refresh', accountId: '9999999999999999999', onlineId: 'Player', expiresAt: 9999999999999 };
const jwt = object => 'header.' + Buffer.from(JSON.stringify(object)).toString('base64url') + '.signature';
function memoryVault() {
  let value = null;
  return { get value() { return value; }, async load() { return structuredClone(value); }, async save(next) { value = structuredClone(next); } };
}
function context() {
  let state = {}; const events = [], logs = [], controller = new AbortController();
  return { controller, events, logs, get state() { return state; },
    context: { signal: controller.signal, readState: async () => structuredClone(state), saveState: async value => { state = structuredClone(value); },
      log: async (message, level) => logs.push({ message, level }), emit: async (id, payload) => events.push({ id, payload, state: structuredClone(state) }) } };
}
const present = (status = 'online', game = 'Game A', title = 'PPSA00001_00') => ({ basicPresence: {
  primaryPlatformInfo: { onlineStatus: status, platform: 'PS5', lastOnlineDate: '2026-10-13T10:00:00Z' },
  gameTitleInfoList: game ? [{ titleName: game, npTitleId: title }] : [],
} });
function syntheticClient() {
  let presence = present(), failure = false, detailsFailure = false;
  const calls = [];
  return { calls, setPresence(value) { presence = value; }, fail(value) { failure = value; }, failDetails(value) { detailsFailure = value; },
    async authorize(auth, token, signal) { signal.throwIfAborted(); return session; },
    async get(auth, route, signal, devices) {
      signal.throwIfAborted(); calls.push(route);
      if (route.includes('basicPresences')) { if (failure) throw new Error('echo ' + npsso); return presence; }
      if (detailsFailure) throw new Error('private echo');
      if (devices) return { accountDevices: [{ device: { name: 'Console', platform: 'PS5' }, systemData: { model: 'Model', systemVersion: '1' }, serialNumber: 'private' }] };
      if (route.includes('/profiles')) return { onlineId: 'Player', isPlus: true };
      if (route.includes('/trophySummary')) return { trophyLevel: 25, progress: 50, earnedTrophies: { bronze: 1, silver: 2, gold: 3, platinum: 4 } };
      return { titles: [{ npTitleId: 'PPSA00001_00', trophyTitles: [{ npCommunicationId: 'NPWR1_00', earnedTrophies: { bronze: 1, silver: 2, gold: 0, platinum: 0 } }] }] };
    },
    async pages(auth, route, key, signal) {
      signal.throwIfAborted(); calls.push(route);
      if (detailsFailure) throw new Error('private echo');
      return { rows: key === 'titles' ? [{ titleId: 'PPSA00001_00', name: 'Game A', category: 'ps5_native_game', playDuration: 'PT2H30M', playCount: 4, lastPlayedDateTime: '2026-10-13T10:00:00Z' }]
        : [{ trophyTitleName: 'Game A', trophyTitlePlatform: 'PS5', progress: 25, earnedTrophies: { bronze: 1, silver: 2, gold: 0, platinum: 0 }, definedTrophies: { bronze: 10, silver: 10, gold: 2, platinum: 1 } }], total: 1, truncated: false };
    } };
}

test('PlayStation declaration, secret boundary and offline readiness use real credential availability', async () => {
  const plugin = validateDeclaration(declaration);
  assert.equal(plugin.name, 'PlayStation'); assert.equal(plugin.settings[0].format, 'secret');
  assert.equal(plugin.polling.intervalSetting, 'poll-minutes');
  assert.ok(!plugin.cardFields.some(field => field.source?.kind === 'setting' && field.source.key === 'npsso'));
  const vault = memoryVault(), client = syntheticClient();
  const adapter = createPlaystationAdapter({ vault, client, credentialReady: async () => true });
  assert.equal(await adapter.validateConfiguration({ npsso: '' }), false);
  assert.equal(await adapter.validateConfiguration({ npsso }), true);
  await vault.save(session); assert.equal(await adapter.validateConfiguration({ npsso: '' }), true);
  assert.equal(await adapter.validateConfiguration({ npsso: 'bad' }), false);
  await adapter.start({ npsso: '' }); await adapter.stop(); assert.equal(client.calls.length, 0);
  const damaged = createPlaystationAdapter({ vault: { async load() { throw new Error('unreadable'); } }, client, credentialReady: async () => true });
  assert.equal(await damaged.validateConfiguration({ npsso: '' }), false);
  await damaged.start({ npsso }); await damaged.stop();
  const invalid = structuredClone(declaration);
  invalid.cardFields.push({ id: 'key', label: 'Key', type: 'string', source: { kind: 'setting', key: 'npsso' } });
  assert.throws(() => validateDeclaration(invalid), /Secret/);
});

test('presence is account status with explicit unknown/game/time data and bounded typed lists', () => {
  assert.equal(normalizePresence(present()).online, true);
  assert.equal(normalizePresence(present('offline'))['active-game'], null);
  assert.equal(normalizePresence(present('offline'))['active-game-display'], 'Not playing');
  assert.equal(normalizePresence(present('online', null))['active-game-display'], 'Not playing');
  assert.equal(normalizePresence(present('hidden')).online, null);
  assert.equal(normalizePresence(present('online', null))['game-running'], false);
  assert.throws(() => normalizePresence({}), /invalid/);
  assert.equal(durationSeconds('P1DT2H3M4.5S'), 93784.5);
  assert.equal(durationSeconds('PT'), null);
  assert.equal(ownAccountId({ access_token: jwt({ account_id: session.accountId }) }), session.accountId);
  assert.equal(ownAccountId({ id_token: jwt({ sub: session.accountId }) }), session.accountId);
  assert.throws(() => ownAccountId({ access_token: jwt({ account_id: 123 }) }), /identifier/);
  const games = gameReadings({ rows: Array.from({ length: 12 }, (_, i) => ({ titleId: String(i), name: String(i), playDuration: 'PT1H', lastPlayedDateTime: new Date(1700000000000 + i * 1000).toISOString() })), total: 500, truncated: true }, '11');
  assert.equal(games['game-row-count'], 10); assert.equal(games['games-1-name'], '11'); assert.equal(games['active-play-hours'], 1);
  assert.equal(games['games-total'], 500); assert.equal(games['games-truncated'], true);
  assert.equal(games['all-games-play-hours'], null);
  assert.equal(gameReadings({ rows: [{ playDuration: 'PT2H30M' }, { playDuration: 'PT1H' }], total: 2, truncated: false }, null)['all-games-play-hours'], 3.5);
  assert.equal(gameReadings({ rows: [{ playDuration: 'PT1H' }, {}], total: 2, truncated: false }, null)['all-games-play-hours'], null);
  const platform = gameReadings({ rows: [{ name: 'PS4 game on PS5', category: 'ps4_game' }], total: 1, truncated: false }, null);
  assert.equal(platform['games-1-platform'], 'PS4');
  const trophies = collectionReadings({ rows: [{ trophyTitleName: 'A', earnedTrophies: { bronze: 1 }, progress: 101 }], total: 1, truncated: false });
  assert.equal(trophies['collections-1-earned'], null); assert.equal(trophies['collections-1-progress'], null);
});

test('shared Current values renders declared tables for a single-account plugin', async () => {
  const context = vm.createContext({ URL, Intl, Date, document: { addEventListener() {} }, state: { paused: false }, config: { timeFormat: '24' },
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'), icon: () => '' });
  vm.runInContext(await fs.readFile(new URL('../web/card-renderer.js', import.meta.url), 'utf8'), context);
  const ui = vm.runInContext(await fs.readFile(new URL('../web/plugin-ui.js', import.meta.url), 'utf8') + '\nPluginUI;', context);
  const plugin = validateDeclaration(declaration);
  const markup = ui.events({ ...plugin, enabled: true, configurationReady: true, health: 'ready', events: [],
    cardData: { values: { games: { available: true, type: 'table', value: [{ name: 'Game <A>', platform: 'PS4', hours: 1, plays: 2, first: null, last: null }] } } } });
  assert.match(markup, /plugin-table-fact/);
  assert.match(markup, /<table[^>]*aria-label="Games played"/);
  assert.match(markup, /Game &lt;A&gt;/);
  assert.doesNotMatch(markup, /<A>/);
});

test('Sony NPSSO exchange uses only fixed destinations, decimal account ID and encrypted storage before reads', async () => {
  const calls = [], vault = memoryVault();
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/authorize?')) return new Response(null, { status: 302, headers: { Location: 'com.scee.psxandroid.scecompcall://redirect/?code=v3.test' } });
    if (url.endsWith('/token')) return Response.json({ access_token: jwt({ account_id: session.accountId }), refresh_token: 'refresh', expires_in: 3600 });
    assert.match(url, new RegExp('/users/' + session.accountId + '/profiles$'));
    return Response.json({ onlineId: 'Player' });
  };
  const client = createClient({ fetchImpl, vault, now: () => 1000 });
  const auth = await client.connect(npsso);
  assert.equal(auth.accountId, session.accountId); assert.equal(vault.value.onlineId, 'Player');
  assert.equal(calls[0].options.headers.Cookie, 'npsso=' + npsso);
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[1].options.body.get('grant_type'), 'authorization_code');
  assert.ok(calls.every(call => !call.url.includes(npsso)));
  assert.ok(calls.slice(1).every(call => !call.options.headers.Cookie));
  assert.equal(validNpsso('a'.repeat(63)), false);
});

test('token renewal commits rotated tokens and bound pagination never retries redirects or echoes errors', async () => {
  const vault = memoryVault(); const saved = { ...session, expiresAt: 1000 };
  await vault.save(saved); let tokenCalls = 0, pages = 0;
  const client = createClient({ vault, now: () => 2000, fetchImpl: async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (url.endsWith('/token')) { tokenCalls++; return Response.json({ access_token: jwt({ account_id: session.accountId }), refresh_token: 'rotated', expires_in: 3600 }); }
    pages++; return Response.json({ titles: Array.from({ length: 100 }, () => ({})), totalItemCount: 1000, nextOffset: pages * 100 });
  } });
  const signal = new AbortController().signal;
  const auth = await client.authorize(saved, '', signal);
  assert.equal(tokenCalls, 1); assert.equal(vault.value.refreshToken, 'rotated');
  const result = await client.pages(auth, 'gamelist/v2/users/{account}/titles', 'titles', signal);
  assert.equal(pages, 2); assert.equal(result.rows.length, 200); assert.equal(result.total, 1000); assert.equal(result.truncated, true);
  const failed = createClient({ vault, fetchImpl: async () => { throw new Error(npsso); } });
  await assert.rejects(failed.get(auth, 'userProfile/v1/internal/users/{account}/profiles', signal), error => !error.message.includes(npsso));
  const redirect = createClient({ vault, fetchImpl: async () => new Response(null, { status: 302, headers: { Location: 'https://foreign.example/?code=' + npsso } }) });
  await assert.rejects(redirect.connect(npsso), error => !error.message.includes(npsso));
});

test('readings/transition claims commit before events; restart, failure and cached details preserve successful data', async () => {
  const h = context(), vault = memoryVault(), client = syntheticClient(); await vault.save(session);
  let time = 1000000;
  const factory = () => createPlaystationAdapter({ vault, client, now: () => time, credentialReady: async () => true });
  let adapter = factory(); await adapter.start({ npsso: '' }); await adapter.execute('refresh', {}, h.context);
  assert.deepEqual(h.events.map(event => event.id), ['status-updated']);
  assert.equal(h.state['trophies-total'], 10); assert.equal(h.state['active-play-hours'], 2.5); assert.equal(h.state['active-trophies'], 3);
  assert.equal(h.state['active-bronze'],1);assert.equal(h.state['active-silver'],2);assert.equal(h.state['active-play-count'],4);
  assert.equal(h.state['games-1-platform'], 'PS5');
  const detailCalls = client.calls.length; time += 60000;
  await adapter.execute('refresh', {}, h.context); assert.equal(client.calls.length, detailCalls + 1);
  client.setPresence(present('online', 'Game B', 'PPSA00002_00')); client.failDetails(true);
  await adapter.execute('refresh', {}, h.context);
  assert.equal(h.state['active-play-hours'], null); assert.equal(h.state['active-trophies'], null);
  for(const field of ['active-platinum','active-gold','active-silver','active-bronze','active-trophy-progress','active-trophies-received-at','active-play-count'])assert.equal(h.state[field],null,field+' clears when a new game detail request fails');
  assert.equal(h.state['games-1-name'], 'Game A'); assert.equal(h.state['details-status'], 'Partial · failed sections retained');
  const change = h.events.find(event => event.id === 'presence-changed');
  assert.equal(change.state['change-sequence'], 1); assert.equal(change.payload['change-id'], session.accountId + ':1');
  adapter = factory(); await adapter.start({ npsso: '' }); await adapter.execute('refresh', {}, h.context);
  assert.equal(h.events.filter(event => event.id === 'presence-changed').length, 1);
  client.fail(true); const before = structuredClone(h.state);
  await assert.rejects(adapter.execute('refresh', {}, h.context), /PSN refresh failed/);
  assert.deepEqual(h.state, before); assert.ok(h.logs.every(log => !log.message.includes(npsso)));
});

test('save failure and cancellation produce no transition effects or fabricated statistics', async () => {
  const h = context(), vault = memoryVault(), client = syntheticClient(); await vault.save(session);
  const adapter = createPlaystationAdapter({ vault, client, credentialReady: async () => true });
  await adapter.start({ npsso: '' });
  await assert.rejects(adapter.execute('refresh', {}, { ...h.context, saveState: async () => { throw new Error('disk'); } }), /disk/);
  assert.equal(h.events.length, 0); assert.deepEqual(h.state, {});
  h.controller.abort(new Error('cancelled'));
  await assert.rejects(adapter.execute('refresh', {}, h.context), /cancelled/);
  assert.equal(h.events.length, 0);
});

test('Windows vault roundtrip protects credentials locally and corrupt input is retained', { skip: process.platform !== 'win32' }, async t => {
  const base = fileURLToPath(new URL('./.tmp/', import.meta.url)); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'psn-vault-')), file = path.join(root, 'session.dpapi');
  t.after(async () => { assert.ok(path.resolve(root).startsWith(path.resolve(base) + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  const vault = createVault(file);
  assert.equal(await vault.load(), null); await vault.save(session);
  const bytes = await fs.readFile(file); assert.ok(!bytes.includes(Buffer.from('refresh')));
  assert.deepEqual(await vault.load(), session);
  await fs.writeFile(file, Buffer.from('corrupt')); await assert.rejects(vault.load(), /unlock/);
  assert.equal((await fs.readFile(file)).toString(), 'corrupt');
});

test('installed plugin drives typed reading/occurrence Tasks across restart and projects only selected public tables', async t => {
  const base = fileURLToPath(new URL('./.tmp/', import.meta.url)); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'playstation-'));
  const folder = path.join(root, 'plugins/playstation');
  await fs.cp(new URL('../plugins/playstation/', import.meta.url), folder, { recursive: true, filter: file => !file.split(path.sep).includes('data') });
  const testDeclaration = structuredClone(declaration); testDeclaration.runtime.entry = 'server/test-entry.mjs';
  await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify(testDeclaration));
  const writePresence = value => fs.writeFile(path.join(folder, 'server/presence.json'), JSON.stringify(value));
  await writePresence(present());
  await fs.writeFile(path.join(folder, 'server/test-entry.mjs'), `
import fs from 'node:fs/promises';
import { createPlaystationAdapter } from './index.mjs';
const auth = ${JSON.stringify(session)};
const client = {
  async authorize() { return auth; },
  async get(auth, route, signal, devices) {
    if(route.includes('basicPresences')) return JSON.parse(await fs.readFile(new URL('./presence.json',import.meta.url),'utf8'));
    if(devices) return {accountDevices:[]};
    if(route.includes('/profiles')) return {isPlus:true};
    if(route.includes('/trophySummary')) return {earnedTrophies:{bronze:1,silver:1,gold:0,platinum:0},trophyLevel:1,progress:1};
    return {titles:[]};
  },
  async pages(auth,route,key) { return {rows:key==='titles'?[{titleId:'PPSA00001_00',name:'Game A',playDuration:'PT1H',privateField:'private'}]:[],total:1,truncated:false}; }
};
export default createPlaystationAdapter({vault:{async load(){return auth;}},client,credentialReady:async()=>true});`);
  let app = await createLocalserve(root, { automatic: false });
  t.after(async () => {
    await app.close(); assert.ok(path.resolve(root).startsWith(path.resolve(base) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  const call = async (route, values) => {
    const response = await fetch(app.origin + route, values === undefined ? {} : { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: app.origin, 'X-Localserve-Token': app.snapshot().token }, body: JSON.stringify(values) });
    return { status: response.status, body: await response.json() };
  };
  const service = () => app.registry.services()[0];
  assert.equal(service().enabled, false); assert.equal(service().configurationReady, true);
  assert.equal((await call('/api/plugins/playstation/config', { revision: service().config.revision, enabled: true })).status, 200);
  const makeTask = (name, event) => ({ name, enabled: true, starts: [{ id: 'rule', type: 'event', name: 'Event', enabled: true,
    eventId: 'plugin:playstation:event:' + event, condition: { field: 'online', operator: 'eq', value: true } }],
    steps: [{ id: 'log', type: 'log', enabled: true, message: 'PSN condition' }] });
  await call('/api/tasks', makeTask('Online reading', 'status-updated'));
  await call('/api/tasks', makeTask('Online transition', 'presence-changed'));
  const settle = async () => {
    const deadline = Date.now() + 3000;
    while (app.engine.pending.size || app.engine.active.size) {
      if (Date.now() > deadline) throw new Error('PSN Task did not settle');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  const refresh = async () => { assert.equal((await call('/api/plugins/playstation/actions/refresh', { parameters: {} })).status, 200); await settle(); };
  await refresh(); assert.equal(app.state.snapshot().runs.length, 1);
  await refresh(); assert.equal(app.state.snapshot().runs.length, 1);
  await writePresence(present('online', 'Game B', 'PPSA00002_00')); await refresh(); assert.equal(app.state.snapshot().runs.length, 2);
  await writePresence(present('online', 'Game C', 'PPSA00003_00')); await refresh(); assert.equal(app.state.snapshot().runs.length, 3);
  await app.close(); app = await createLocalserve(root, { automatic: false });
  await refresh(); assert.equal(app.state.snapshot().runs.length, 3, 'restart does not replay matching transitions');
  const card = { schemaVersion: 1, name: 'Games', enabled: true, icon: 'inherit', size: 'medium', layout: 'table',
    fields: [{ id: 'table', binding: 'games', label: 'Games', enabled: true, icon: 'none', format: 'auto', unit: '', decimals: 0 }],
    listOptions: { rows: 1, fontSize: 14, noWrap: false, columns: ['name', 'hours'] } };
  assert.equal((await call('/api/plugins/playstation/cards', card)).status, 200);
  await call('/api/vistas', { schemaVersion: 1, name: 'PSN', slug: 'psn', enabled: true, gap: 0, padding: 0,
    layout: { id: 'root', type: 'column', name: 'Canvas', enabled: true, width: '1fr', height: '1fr', children: [
      { id: 'slot', type: 'card', name: 'Games', enabled: true, width: '1fr', height: '1fr', cards: [{ pluginId: 'playstation', cardId: service().cards[0].id }] },
    ] } });
  const projection = (await call('/api/vistas/psn')).body;
  assert.deepEqual(Object.keys(projection.cards[0].data.values.games.value[0]), ['name', 'hours']);
  assert.doesNotMatch(JSON.stringify(projection), /account-id|change-sequence|accessToken|refreshToken|npssoHash|session.dpapi|privateField|token/);
  const mode = (await call('/api/playstation-mode')).body;
  assert.equal(mode.values['online-id'].value,'Player');assert.equal(mode.values.games.available,true);
  assert.ok(mode.activity.length >= 2);assert.ok(mode.activity.some(entry=>entry.kind==='game'));
  assert.doesNotMatch(JSON.stringify(mode), /account-id|change-sequence|accessToken|refreshToken|npssoHash|session.dpapi|privateField|token|change-id/);
  assert.equal((await call('/api/playstation-mode?unexpected=1')).status,400);
  for (const file of ['config.json', 'state.json', 'session.dpapi', 'cards.json']) assert.equal((await fetch(app.origin + '/plugins/playstation/data/' + file)).status, 404);
});
