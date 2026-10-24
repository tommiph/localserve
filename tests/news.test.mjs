/** Synthetic RSS and disposable server roots; no upstream or installed data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createLocalserve } from '../server.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { cardFormats, projectCardData, selectedCardData, cardCatalog } from '../server/cards.mjs';
import { createNewsAdapter, parseNews, feedUrl } from '../plugins/news/server/index.mjs';

const source = fileURLToPath(new URL('../plugins/news/', import.meta.url));
const temporaryRoot = fileURLToPath(new URL('./.tmp/', import.meta.url));
const newsUrl = query => query.startsWith('https://') ? query
  : `https://news.google.com/rss/search?${new URLSearchParams({ q: query, hl: 'fi-FI', gl: 'FI', ceid: 'FI:fi' })}`;
const settings = (searches = [{ id: 'kerava', name: 'Kerava', query: 'Kerava', enabled: true }]) => ({
  'poll-minutes': 60, searches: searches.map(search => ({ ...search, query: newsUrl(search.query) })),
});
const escapeXml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function listCard(overrides = {}) {
  return { schemaVersion: 1, name: 'News list', enabled: true, icon: 'inherit', size: 'medium', layout: 'table',
    listOptions: { rows: 2, fontSize: 18, noWrap: true, columns: ['title', 'date'] },
    fields: [{ id: 'articles-field', binding: 'kerava:articles', label: 'Articles', enabled: true,
      icon: 'none', format: 'auto', unit: '', decimals: 0 }], ...overrides };
}

test('table declarations reuse bounded scalar rows and reject private keys or mismatched columns', async () => {
  const raw = JSON.parse(await fs.readFile(path.join(source, 'declaration.json'), 'utf8'));
  const plugin = validateDeclaration(raw);
  const field = raw.cardFields.find(field => field.type === 'table');
  for (const invalid of [
    { ...field, source: { ...field.source, rows: Array(11).fill(field.source.rows[0]) } },
    { ...field, source: { ...field.source, countKey: 'private-count' } },
    { ...field, source: { ...field.source, rows: [{ title: 'private-token', date: 'article-1-published-at' }] } },
    { ...field, columns: [{ id: 'title', label: 'Title', type: 'timestamp' }, field.columns[1]] },
    { ...field, columns: [field.columns[0], field.columns[0]] },
    { ...field, source: { ...field.source, sort: { column: 'private-token', direction: 'desc' } } },
    { ...field, source: { ...field.source, sort: { column: 'title', direction: 'desc' } } },
    { ...field, source: { ...field.source, sort: { column: 'date', direction: 'random' } } },
  ]) assert.throws(() => validateDeclaration({ ...raw, cardFields: raw.cardFields.map(item => item.id === field.id ? invalid : item) }));
  const reading = parseNews(rss(2), 'Kerava');
  const record = { config: { snapshot: () => ({ enabled: true, settings: settings() }) },
    state: { snapshot: () => ({ searches: { kerava: reading } }) }, log: { latest: () => [] }, health: 'ready', configured: true };
  assert.equal(projectCardData(plugin, record).values['kerava:articles'].value.length, 2);
  reading['article-1-published-at'] = null;
  assert.equal(projectCardData(plugin, record).values['kerava:articles'].value[1].date, null);
  reading['article-count'] = 0;
  assert.deepEqual(projectCardData(plugin, record).values['kerava:articles'].value, []);
  delete reading['article-count'];
  assert.equal(projectCardData(plugin, record).values['kerava:articles'].available, false);
  record.config.snapshot = () => ({ enabled: true, settings: settings([{ ...settings().searches[0], enabled: false }]) });
  assert.equal(projectCardData(plugin, record).values['kerava:articles'].available, false);
});

test('News List sorts retained publication dates newest first before limiting rows or hiding Date', async () => {
  const raw = JSON.parse(await fs.readFile(path.join(source, 'declaration.json'), 'utf8'));
  const plugin = validateDeclaration(raw);
  const reading = parseNews(rss(6), 'Kerava');
  const dates = [null, 1000, 3000, 2000, 3000, null];
  dates.forEach((date, index) => { reading[`article-${index + 1}-published-at`] = date; });
  const original = structuredClone(reading);
  const record = { config: { snapshot: () => ({ enabled: true, settings: settings() }) },
    state: { snapshot: () => ({ searches: { kerava: reading } }) }, log: { latest: () => [] }, health: 'ready', configured: true };
  const data = projectCardData(plugin, record);
  const rows = data.values['kerava:articles'].value;
  assert.deepEqual(rows.map(row => row.date), [3000, 3000, 2000, 1000, null, null]);
  assert.deepEqual(rows.map(row => row.title), [2, 4, 3, 1, 0, 5].map(index => `Headline & Unicode ä ${index}`));
  assert.deepEqual(reading, original, 'List sorting must not rewrite stored feed-order scalars');
  const card = listCard({ listOptions: { rows: 2, fontSize: 14, noWrap: false, columns: ['title'] } });
  const selected = selectedCardData(card, data, cardCatalog(plugin, settings()));
  assert.deepEqual(selected.data.values['kerava:articles'].value, [{ title: rows[0].title }, { title: rows[1].title }]);
  assert.deepEqual(selected.catalog[0].columns.map(column => column.id), ['title']);
  const renderer = vm.runInNewContext(await fs.readFile(new URL('../web/card-renderer.js', import.meta.url), 'utf8') + '\nCardRenderer;', { Intl, Date, URL });
  const html = renderer.render(card, selected.data, selected.catalog);
  assert.ok(html.indexOf(rows[0].title.replace('&', '&amp;')) < html.indexOf(rows[1].title.replace('&', '&amp;')));
  assert.doesNotMatch(html, />Date<|>3000</);
  const unsorted = validateDeclaration({ ...raw, cardFields: raw.cardFields.map(field => field.type === 'table'
    ? { ...field, source: { kind: field.source.kind, countKey: field.source.countKey, rows: field.source.rows } } : field) });
  assert.deepEqual(projectCardData(unsorted, record).values['kerava:articles'].value.map(row => row.date), dates);
});

test('List editor serializes only its selected table source and keeps ordinary fields across style switches', async () => {
  const definition = listCard();
  const inputs = { name: 'Headlines', enabled: 'false', showHeader: 'true', showFooter: 'true', crop: 'false',
    cardIcon: 'inherit', size: 'medium', layout: 'table', listSource: 'kerava:articles', listRows: '3',
    listFontSize: '20', listNoWrap: 'true' };
  const table = { id: 'kerava:articles', label: 'Kerava · Articles', type: 'table',
    columns: [{ id: 'title', label: 'Title', type: 'string' }, { id: 'date', label: 'Date', type: 'timestamp' }] };
  const oldField = { id: 'old', binding: 'headlines', label: 'Headlines', enabled: true, icon: 'none', format: 'text', unit: '', decimals: 0 };
  const form = { elements: { namedItem: name => ({ value: inputs[name] }) },
    querySelector: () => ({ dataset: { fieldId: 'stable-id' } }),
    querySelectorAll: selector => selector.includes('listColumn') ? [{ value: 'title' }] : [oldField] };
  const source = await fs.readFile(new URL('../web/card-designer.js', import.meta.url), 'utf8');
  const designer = vm.runInNewContext(source + '\nCardDesigner;', {
    document: { addEventListener() {} }, dialog: { querySelector: () => form },
    state: { services: [{ id: 'news', cardCatalog: [table] }] }, dialogContext: { pluginId: 'news' },
  });
  designer.readField = field => field;
  const listDraft = JSON.parse(JSON.stringify(designer.readDraft()));
  assert.deepEqual(listDraft.listOptions, { rows: 3, fontSize: 20, noWrap: true, columns: ['title'] });
  assert.equal(listDraft.fields.length, 1);
  assert.equal(listDraft.fields[0].binding, definition.fields[0].binding);
  assert.equal(listDraft.fields[0].id, 'stable-id');
  inputs.layout = 'grid';
  const gridDraft = JSON.parse(JSON.stringify(designer.readDraft()));
  assert.deepEqual(gridDraft.fields, [oldField]);
  assert.equal(gridDraft.listOptions, undefined);
  inputs.layout = 'table';
  assert.deepEqual(JSON.parse(JSON.stringify(designer.readDraft())), listDraft);
});

test('List cards save/copy/restart and Vistas expose only selected rows and columns', async t => {
  const f = await fixture(t);
  await f.save({ enabled: true, settings: settings() });
  await f.response(200, rss(10, '<script>headline</script>'));
  await f.action('kerava');
  const base = listCard();
  for (const options of [
    { ...base.listOptions, rows: 0 }, { ...base.listOptions, rows: 11 }, { ...base.listOptions, rows: 1.5 },
    { ...base.listOptions, fontSize: 9 }, { ...base.listOptions, fontSize: '18' },
    { ...base.listOptions, noWrap: 'true' }, { ...base.listOptions, columns: [] },
    { ...base.listOptions, columns: ['title', 'title'] }, { ...base.listOptions, columns: ['private-token'] },
  ]) assert.equal((await f.call('/api/plugins/news/cards', { ...base, listOptions: options })).status, 400);
  assert.equal((await f.call('/api/plugins/news/cards', base)).status, 200);
  const card = f.service().cards[0];
  assert.deepEqual(card.listOptions, base.listOptions);
  assert.equal((await f.call('/api/plugins/news/cards', { ...card, name: 'Copy', enabled: false })).status, 200);
  assert.notEqual(f.service().cards[1].id, card.id);
  await f.restart();
  assert.deepEqual(f.service().cards[0].listOptions, base.listOptions);
  const vista = { schemaVersion: 1, name: 'Headlines', slug: 'headlines', enabled: true, gap: 0, padding: 0,
    layout: { id: 'root', name: 'Canvas', type: 'column', enabled: true, width: '1fr', height: '1fr', children: [
      { id: 'slot', name: 'News', type: 'card', enabled: true, width: '1fr', height: '1fr', cards: [{ pluginId: 'news', cardId: card.id }] },
    ] } };
  assert.equal((await f.call('/api/vistas', vista)).status, 200);
  let publicCard = (await f.call('/api/vistas/headlines')).body.cards[0];
  assert.equal(publicCard.data.values['kerava:articles'].value.length, 2);
  const renderer = await fs.readFile(new URL('../web/card-renderer.js', import.meta.url), 'utf8');
  const context = vm.createContext({ Intl, URL, Date });
  vm.runInContext(renderer + '\nthis.renderCard = CardRenderer.render;', context);
  const rendered = context.renderCard(publicCard.card, publicCard.data, publicCard.catalog,
    { locale: 'en-GB', timeZone: 'Europe/Helsinki', timeFormat: '24' });
  assert.match(rendered, /<table/);
  assert.match(rendered, /scope="col">Title/);
  assert.match(rendered, /scope="col"[^>]*>Date/);
  assert.match(rendered, /display-card-table-nowrap/);
  assert.match(rendered, /--list-font-size:18px/);
  assert.match(rendered, /&lt;script&gt;headline&lt;\/script&gt;/);
  assert.doesNotMatch(rendered, /<script>/);
  assert.match(rendered, /15:00/);
  assert.match(context.renderCard(publicCard.card, publicCard.data, publicCard.catalog,
    { locale: 'en-GB', timeZone: 'Europe/Helsinki', timeFormat: '12' }), /3:00 pm/);
  for (const rows of [1, 10]) {
    const latest = f.service().cards[0];
    assert.equal((await f.call(`/api/plugins/news/cards/${card.id}`, { ...latest,
      listOptions: { rows, fontSize: 14, noWrap: false, columns: ['title'] } })).status, 200);
    publicCard = (await f.call('/api/vistas/headlines')).body.cards[0];
    const table = publicCard.data.values['kerava:articles'].value;
    assert.equal(table.length, rows);
    assert.deepEqual(Object.keys(table[0]), ['title']);
    assert.deepEqual(publicCard.catalog[0].columns.map(column => column.id), ['title']);
    const output = context.renderCard(publicCard.card, publicCard.data, publicCard.catalog);
    assert.doesNotMatch(output, /display-card-table-nowrap|scope="col"[^>]*>Date/);
  }
  await f.response(200, rss(0));
  await f.action('kerava');
  publicCard = (await f.call('/api/vistas/headlines')).body.cards[0];
  assert.match(context.renderCard(publicCard.card, publicCard.data, publicCard.catalog), /No items/);
});
function rss(count = 2, title = 'Headline & Unicode ä', publisher = 'Publisher', linkPadding = '') {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Kerava - Google News</title>${Array.from({ length: count }, (_, index) => `<item><title>${escapeXml(title)} ${index}</title><link>https://news.google.com/rss/articles/article${index}${linkPadding}?oc=5</link><source url="https://publisher.invalid">${escapeXml(publisher)}</source><pubDate>Mon, 12 Oct 2026 12:00:00 GMT</pubDate><description>&lt;script&gt;ignored&lt;/script&gt;</description></item>`).join('')}</channel></rss>`;
}
function host(controller = new AbortController()) {
  const calls = [];
  let state = { searches: { old: { 'article-1-title': 'Previous successful article' } } };
  return { calls, signal: controller.signal,
    readState: async () => structuredClone(state),
    saveState: async next => { controller.signal.throwIfAborted(); state = next; calls.push('save'); },
    log: async (message, level) => calls.push(['log', message, level]),
    emit: async (id, payload) => calls.push(['event', id, payload]),
  };
}

test('RSS parsing bounds articles, decodes XML/CDATA, preserves order, and distinguishes publication/reception', () => {
  const data = parseNews(rss(12), 'Kerava', 123);
  assert.equal(data['article-count'], 10);
  assert.equal(data['article-1-title'], 'Headline & Unicode ä 0');
  assert.equal(data['article-10-title'], 'Headline & Unicode ä 9');
  assert.equal(data['article-1-publisher'], 'Publisher');
  assert.equal(data['article-1-published-at'], Date.parse('2026-10-12T12:00:00Z'));
  assert.equal(data['updated-at'], 123);
  assert.equal(data['requested-query'], 'Kerava');
  assert.match(data.headlines, /\n2\. /);
  assert.doesNotMatch(JSON.stringify(data), /description|ignored|publisher.invalid|article-11/);
  const missing = parseNews(rss(1).replace('<source url="https://publisher.invalid">Publisher</source>', '').replace('Mon, 12 Oct 2026 12:00:00 GMT', '12:00'), 'Kerava');
  assert.equal(missing['article-1-publisher'], null);
  assert.equal(missing['article-1-published-at'], null);
  assert.equal(missing['article-2-title'], null);
  assert.equal(parseNews(rss(0), 'Kerava')['article-count'], 0);
  assert.equal(parseNews(rss(0), 'Kerava').headlines, 'No articles found.');
  const cdata = rss(1).replace('Headline &amp; Unicode ä 0', '<![CDATA[Title <safe> & text]]>');
  assert.equal(parseNews(cdata, 'Kerava')['article-1-title'], 'Title <safe> & text');
  const duplicate = rss(2).replace('article1?', 'article0?');
  assert.equal(parseNews(duplicate, 'Kerava')['article-count'], 1);
});

test('malformed RSS, DTDs, unsafe URLs, empty HTML, invalid UTF-8 and oversized bodies preserve cache', async () => {
  const invalid = [
    '<html>Consent</html>', '<rss version="2.0"><channel><title>Broken</channel></rss>',
    '<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///private">]>' + rss(1),
    rss(1).replace('https://news.google.com/rss/articles/article0?oc=5', 'javascript:alert(1)'),
    rss(1).replace('https://news.google.com/rss/articles/article0?oc=5', 'https://elsewhere.invalid/article'),
    rss(1).replace('Headline &amp; Unicode ä 0', '&unknown;'),
    'x'.repeat(512 * 1024 + 1),
  ];
  for (const payload of invalid) assert.throws(() => parseNews(payload, 'Kerava'));
  for (const transport of [
    async () => new Response('Busy', { status: 429 }),
    ...invalid.map(payload => async () => new Response(payload)),
    async () => new Response(Uint8Array.from([0xff, 0xfe])),
    async () => { throw new Error('Network unavailable'); },
  ]) {
    let requests = 0;
    const adapter = createNewsAdapter({ fetchImpl: (...args) => { requests += 1; return transport(...args); } });
    await adapter.start(settings());
    const context = host();
    const saved = await context.readState();
    await assert.rejects(adapter.execute('refresh', {}, context));
    assert.equal(requests, 1);
    assert.deepEqual(await context.readState(), saved);
    assert.equal(context.calls.length, 1);
    assert.equal(context.calls[0][2], 'warning');
  }
});

test('complete feed URLs are requested unchanged, keep specific parameters, and commit before events', async () => {
  let requests = 0;
  const queryText = '"Kerava" & Helsinki when:7d';
  const query = `https://news.google.com/rss/search?${new URLSearchParams({ q: queryText, hl: 'en-US', gl: 'US', ceid: 'US:en', extra: 'specific+value' })}`;
  const adapter = createNewsAdapter({ fetchImpl: async (url, options) => {
    requests += 1;
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://news.google.com');
    assert.equal(parsed.pathname, '/rss/search');
    assert.equal(url, query);
    assert.equal(parsed.searchParams.get('q'), queryText);
    assert.equal(parsed.searchParams.get('hl'), 'en-US');
    assert.equal(parsed.searchParams.get('gl'), 'US');
    assert.equal(parsed.searchParams.get('ceid'), 'US:en');
    assert.equal(parsed.searchParams.get('extra'), 'specific+value');
    assert.equal(options.redirect, 'error');
    return new Response(rss());
  } });
  for (const invalid of ['', 'Kerava', 'http://news.google.com/rss', 'https://elsewhere.invalid/rss',
    'https://news.google.com.evil.invalid/rss', 'https://user:secret@news.google.com/rss',
    'https://news.google.com:444/rss', 'https://news.google.com/search?q=Kerava',
    'https://news.google.com/rss/articles/test', 'https://news.google.com/rss#fragment',
    'https://news.google.com/rss?q=a\nb', 'https://news.google.com/rss?q=' + 'x'.repeat(2000)]) {
    assert.equal(feedUrl(invalid), null);
    const bad = settings();
    bad.searches[0].query = invalid;
    assert.equal(adapter.validateConfiguration(bad), false);
  }
  for (const valid of [query, 'https://news.google.com/rss',
    'https://news.google.com/rss/topics/CAAqABC?hl=en-GB&gl=GB&ceid=GB:en',
    'https://news.google.com/rss/headlines/section/geo/Kerava?hl=fi-FI']) assert.equal(feedUrl(valid), valid);
  assert.equal(adapter.validateConfiguration(settings([])), false);
  const configured = settings([{ id: 'kerava', name: 'Kerava', query, enabled: true }]);
  assert.equal(adapter.validateConfiguration(configured), true);
  await adapter.start(configured);
  assert.equal(requests, 0);
  const context = host();
  await adapter.execute('refresh', {}, context);
  assert.equal(requests, 1);
  assert.equal(context.calls[0], 'save');
  assert.deepEqual(context.calls[2], ['event', 'news-updated', { 'search-id': 'kerava', 'search-name': 'Kerava', query,
    'article-count': 2, 'first-title': 'Headline & Unicode ä 0' }]);
  assert.equal((await context.readState()).searches.old, undefined);
  const reading = (await context.readState()).searches.kerava;
  assert.equal(reading['requested-query'], query);
  assert.equal(reading['feed-language'], 'en-US');
  assert.equal(reading['feed-country'], 'US');
  assert.equal(reading['feed-edition'], 'US:en');
  await adapter.stop();
  await assert.rejects(adapter.execute('refresh', {}, context), /not configured/);
});

test('cancellation aborts network work without using revoked host services', async () => {
  const controller = new AbortController();
  const adapter = createNewsAdapter({ fetchImpl: (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    controller.abort(new Error('Cancelled by test'));
  }) });
  await adapter.start(settings());
  const context = host(controller);
  await assert.rejects(adapter.execute('refresh', {}, context), /Cancelled by test/);
  assert.deepEqual(context.calls, []);
});

async function fixture(t, legacy = null) {
  await fs.mkdir(temporaryRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporaryRoot, 'news-'));
  const folder = path.join(root, 'plugins/news');
  await fs.mkdir(path.join(folder, 'server'), { recursive: true });
  await fs.copyFile(path.join(source, 'server/index.mjs'), path.join(folder, 'server/index.mjs'));
  await fs.cp(path.join(source, 'vendor'), path.join(folder, 'vendor'), { recursive: true });
  const declaration = JSON.parse(await fs.readFile(path.join(source, 'declaration.json'), 'utf8'));
  declaration.runtime.entry = 'server/test-entry.mjs';
  await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify(declaration));
  await fs.writeFile(path.join(folder, 'server/response.json'), JSON.stringify({ status: 200, xml: rss() }));
  await fs.writeFile(path.join(folder, 'server/test-entry.mjs'), `
import fs from 'node:fs/promises';
import { createNewsAdapter } from './index.mjs';
export default createNewsAdapter({ fetchImpl: async (url, options) => {
  if (new URL(url).origin !== 'https://news.google.com') throw new Error('Unexpected News URL');
  const fixture = JSON.parse(await fs.readFile(new URL('./response.json', import.meta.url), 'utf8'));
  return new Response(fixture.xml, { status: fixture.status });
} });`);
  if (legacy) {
    await fs.mkdir(path.join(folder, 'data'));
    for (const [name, value] of Object.entries(legacy)) {
      await fs.writeFile(path.join(folder, 'data', `${name}.json`), JSON.stringify(value));
    }
  }
  let app = await createLocalserve(root, { automatic: false });
  t.after(async () => {
    await app.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(temporaryRoot) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  const service = () => app.registry.services()[0];
  const call = async (endpoint, values) => {
    const response = await fetch(app.origin + endpoint, values === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.origin, 'X-Localserve-Token': app.snapshot().token },
      body: JSON.stringify(values),
    });
    return { status: response.status, body: await response.json() };
  };
  return { root, folder, service, call, get app() { return app; },
    save: values => call('/api/plugins/news/config', { revision: service().config.revision, ...values }),
    action: id => call('/api/plugins/news/actions/refresh', { parameters: id ? { 'search-id': id } : {} }),
    response: (status = 200, xml = rss()) => fs.writeFile(path.join(folder, 'server/response.json'), JSON.stringify({ status, xml })),
    async restart() { await app.close(); app = await createLocalserve(root, { automatic: false }); },
  };
}

test('legacy search queries upgrade to full URLs once with private recovery and unchanged identities/data/cards', async t => {
  const config = { revision: 7, enabled: true, icon: 'sun', settings: {
    'poll-minutes': 15, language: 'en-GB', country: 'GB', edition: 'GB:en', searches: [
      { id: 'kerava', name: 'Kerava', query: '"Kerava" when:7d', enabled: true },
      { id: 'helsinki', name: 'Helsinki', query: 'Helsinki', enabled: false },
    ],
  } };
  const state = { searches: { kerava: parseNews(rss(2), '"Kerava" when:7d', 123) } };
  const card = { ...listCard(), id: 'saved-card', revision: 4 };
  const f = await fixture(t, { config, state, cards: { schemaVersion: 1, cards: [card] } });
  const migrated = f.service().config;
  assert.equal(migrated.revision, 8);
  assert.equal(migrated.enabled, true);
  assert.equal(migrated.icon, 'sun');
  assert.equal(migrated.settings['poll-minutes'], 15);
  assert.deepEqual(Object.keys(migrated.settings).sort(), ['poll-minutes', 'searches']);
  migrated.settings.searches.forEach((search, index) => {
    const old = config.settings.searches[index];
    assert.equal(search.id, old.id);
    assert.equal(search.name, old.name);
    assert.equal(search.enabled, old.enabled);
    const url = new URL(search.query);
    assert.equal(url.searchParams.get('q'), old.query);
    assert.equal(url.searchParams.get('hl'), 'en-GB');
    assert.equal(url.searchParams.get('gl'), 'GB');
    assert.equal(url.searchParams.get('ceid'), 'GB:en');
  });
  assert.deepEqual(f.service().pluginState, state);
  assert.deepEqual(f.service().cards, [card]);
  const backupPath = path.join(f.folder, 'data/config.before-query-urls.json');
  assert.deepEqual(JSON.parse(await fs.readFile(backupPath, 'utf8')), config);
  assert.equal((await f.call('/plugins/news/data/config.before-query-urls.json')).status, 404);
  await f.restart();
  assert.deepEqual(f.service().config, migrated);
  assert.deepEqual(f.service().pluginState, state);
  assert.deepEqual(JSON.parse(await fs.readFile(backupPath, 'utf8')), config);
});

test('installed settings, stable per-search cards/events, revision checks, private storage and restart', async t => {
  const f = await fixture(t);
  assert.equal(f.service().enabled, false);
  assert.equal(f.service().configurationReady, false);
  assert.deepEqual(f.service().config.settings, settings([]));
  assert.deepEqual(f.service().cards, []);
  assert.equal((await f.action()).status, 409);
  const searches = [...settings().searches, { id: 'helsinki', name: 'Helsinki', query: 'Helsinki', enabled: true }];
  assert.equal((await f.save({ enabled: true, settings: settings(searches) })).status, 200);
  assert.equal((await f.action()).status, 409);
  assert.equal((await f.action('kerava')).status, 200);
  assert.equal(f.service().cardData.values['kerava:article-1-title'].value, 'Headline & Unicode ä 0');
  assert.equal(f.service().cardData.values['helsinki:article-1-title'].available, false);
  assert.equal((await f.action('helsinki')).status, 200);
  const saved = structuredClone(f.service().pluginState);
  await f.response(503);
  assert.notEqual((await f.action('kerava')).status, 200);
  assert.deepEqual(f.service().pluginState, saved);
  const revision = f.service().config.revision;
  searches[0].name = 'Renamed';
  searches[1].enabled = false;
  assert.equal((await f.save({ settings: settings(searches) })).status, 200);
  assert.equal((await f.call('/api/plugins/news/config', { revision, enabled: false })).status, 409);
  assert.match(f.service().cardCatalog.find(field => field.id === 'kerava:article-1-title').label, /Renamed/);
  assert.ok(f.app.registry.events().some(event => event.id === 'plugin:news:event:news-updated:kerava'));
  assert.equal(f.service().cardData.values['helsinki:article-1-title'].available, false);
  for (const file of ['declaration.json', 'server/index.mjs', 'vendor/sax/lib/sax.js', 'data/config.json', 'data/state.json']) {
    assert.equal((await f.call(`/plugins/news/${file}`)).status, 404);
  }
  await f.restart();
  assert.deepEqual(f.service().pluginState, saved);
  assert.equal(f.service().config.settings.searches[0].name, 'Renamed');
  assert.equal(f.service().lastPollAt, null);
});

test('two-search polling is staggered, serial, pauses and postpones one target after failure/manual refresh', async t => {
  const f = await fixture(t);
  const searches = [...settings().searches, { id: 'helsinki', name: 'Helsinki', query: 'Helsinki', enabled: true }];
  await f.save({ enabled: true, settings: settings(searches) });
  const record = f.app.registry.get('news');
  const clocks = record.instancePolls;
  assert.ok(clocks.get('helsinki').nextAt - clocks.get('kerava').nextAt >= 1799000);
  await f.app.engine.setPaused(true);
  f.app.registry.pollDue(record.pollDueAt + 10000000);
  assert.equal(record.pending, 0);
  await f.app.engine.setPaused(false);
  f.app.registry.pollDue(record.pollDueAt);
  f.app.registry.pollDue(record.pollDueAt + 10000000);
  await record.pollOperation;
  assert.equal(f.service().pluginActivity.filter(entry => entry.eventId === 'news-updated').length, 1);
  const otherDue = record.instancePolls.get('helsinki').nextAt;
  await f.response(429);
  await f.action('kerava');
  assert.equal(record.instancePolls.get('helsinki').nextAt, otherDue);
  assert.ok(record.instancePolls.get('kerava').nextAt >= Date.now() + 3599000);
  await f.save({ enabled: false });
  f.app.registry.pollDue(record.pollDueAt + 10000000);
  assert.equal(record.pending, 0);
});

test('20 ten-article searches fit the declared state bound; invalid limits and excessive writes fail', async t => {
  const raw = JSON.parse(await fs.readFile(path.join(source, 'declaration.json'), 'utf8'));
  assert.equal(validateDeclaration(raw).runtime.stateMaxBytes, 1048576);
  for (const limit of [65535, 1048577, 100000.5, '1048576']) {
    assert.throws(() => validateDeclaration({ ...raw, runtime: { ...raw.runtime, stateMaxBytes: limit } }), /stateMaxBytes/);
  }
  const f = await fixture(t);
  const searches = Array.from({ length: 20 }, (_, index) => ({ id: `search-${index}`, name: `Search ${index}`, query: `Query ${index}`, enabled: true }));
  await f.save({ enabled: true, settings: settings(searches) });
  await f.response(200, rss(10, '界'.repeat(300), '界'.repeat(100), 'x'.repeat(1000)));
  for (const search of searches) assert.equal((await f.action(search.id)).status, 200);
  const saved = structuredClone(f.service().pluginState);
  const size = Buffer.byteLength(JSON.stringify(saved));
  assert.ok(size > 65536 && size < 1048576, `Stored ${size} bytes`);
  const record = f.app.registry.get('news');
  await assert.rejects(f.app.registry.hostCall(record, 'save-state', { excessive: '界'.repeat(400000) }, { signal: new AbortController().signal }), /size limit/);
  assert.deepEqual(f.service().pluginState, saved);
});

test('News event conditions are isolated by search, trigger on entry, and rearm on an empty feed', async t => {
  const f = await fixture(t);
  const searches = [...settings().searches, { id: 'helsinki', name: 'Helsinki', query: 'Helsinki', enabled: true }];
  await f.save({ enabled: true, settings: settings(searches) });
  const response = await f.call('/api/tasks', { name: 'News condition', enabled: true,
    starts: [{ id: 'news-rule', name: 'Event', type: 'event', enabled: true,
      eventId: 'plugin:news:event:news-updated:kerava', condition: { field: 'article-count', operator: 'gte', value: 1 } }],
    steps: [{ id: 'log', type: 'log', enabled: true, message: 'News condition' }],
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const settle = async () => {
    const deadline = Date.now() + 5000;
    while (f.app.engine.active.size || f.app.engine.pending.size) {
      if (Date.now() > deadline) throw new Error('News Task did not settle.');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  const runs = () => f.app.state.snapshot().runs.length;
  await f.action('helsinki');
  await settle();
  assert.equal(runs(), 0);
  await f.action('kerava');
  await settle();
  assert.equal(runs(), 1);
  await f.action('kerava');
  await settle();
  assert.equal(runs(), 1);
  await f.response(200, rss(0));
  await f.action('kerava');
  await settle();
  assert.equal(runs(), 1);
  await f.response();
  await f.action('kerava');
  await settle();
  assert.equal(runs(), 2);
});

test('shared Link format escapes text/URLs, rejects executable protocols and retains headline newlines', async () => {
  assert.ok(cardFormats('string').includes('link'));
  const source = await fs.readFile(new URL('../web/card-renderer.js', import.meta.url), 'utf8');
  const renderer = vm.runInNewContext(source + '\nCardRenderer;', { Intl, Date, URL });
  const card = { name: 'News', icon: 'none', layout: 'list', fields: [{ id: 'link', binding: 'link', label: 'Article', enabled: true, format: 'link' }] };
  const catalog = [{ id: 'link', type: 'string' }];
  const render = value => renderer.render(card, { values: { link: { type: 'string', available: true, value } } }, catalog);
  assert.match(render('https://news.google.com/rss/articles/test?x=1&y=2'), /href="https:\/\/news.google.com\/rss\/articles\/test\?x=1&amp;y=2"/);
  assert.match(render('https://news.google.com/rss/articles/test'), /rel="noopener noreferrer"/);
  for (const value of ['javascript:alert(1)', 'data:text/html,unsafe', 'file:///private', 'https://user:secret@example.invalid/']) {
    assert.match(render(value), /Unavailable link/);
    assert.doesNotMatch(render(value), /<a /);
  }
  card.fields[0].format = 'text';
  const output = render('First headline\nSecond <script>');
  assert.match(output, /display-card-value-text/);
  assert.match(output, /First headline\nSecond &lt;script&gt;/);
});
