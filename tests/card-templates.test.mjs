/** Fixed designs use only disposable Weather packages and saved sample data.
 * No wttr.in requests or installed Cards/Vistas are touched by these checks. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

test('source reception labels stay visible while disabled/disconnected host status takes precedence', async () => {
  const context = vm.createContext({Intl, URL, Date});
  vm.runInContext(await fs.readFile(new URL('../web/card-renderer.js', import.meta.url), 'utf8') + '\nglobalThis.renderer = CardRenderer;', context);
  const label = {dataset:{cardText:'reading-status'},textContent:'',hasAttribute:name=>name==='data-card-source-state'};
  const doc = {documentElement:{dataset:{},style:{setProperty(){}}},querySelector:()=>({}),
    querySelectorAll:selector=>selector==='[data-card-text]'?[label]:[]};
  const frame = {contentDocument:doc,dataset:{}};
  for (const [status, expected] of [['Ready','No recent reports · retained readings'],['Disabled','Disabled'],['Disconnected · retained reading','Disconnected · retained reading']]) {
    frame.dataset.readyCard = JSON.stringify({status,connected:status==='Ready',slots:{'reading-status':{value:'No recent reports · retained readings',available:true}}});
    context.renderer.hydrateReadyMade(frame);
    assert.equal(label.textContent, expected);
  }
  const card = await fs.readFile(new URL('../plugins/sensors/cards/sensorium/card.html', import.meta.url),'utf8');
  assert.match(card, /<header[^>]*>[^\n]*data-card-text="reading-status" data-card-source-state/);
});
import { fileURLToPath } from 'node:url';
import { createLocalserve } from '../server.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { validateCard, selectedCardData } from '../server/cards.mjs';
const temporaryRoot = fileURLToPath(new URL('./.tmp/', import.meta.url));
const declaration = JSON.parse(await fs.readFile(new URL('../plugins/weather/declaration.json', import.meta.url), 'utf8'));
const locations = [{ id: 'legacy-city', name: 'Kerava', query: 'Kerava', enabled: true }, { id: 'second', name: 'Helsinki', query: 'Helsinki', enabled: true }];
const definition = sourceId => ({ schemaVersion: 1, layout: 'readymade', templateId: 'atmosphere', sourceId: sourceId || 'legacy-city', enabled: true });

test('duration columns format seconds consistently without changing typed data', async () => {
  const context=vm.createContext({Intl,URL,Date});
  vm.runInContext(await fs.readFile(new URL('../web/card-renderer.js',import.meta.url),'utf8')+'\nglobalThis.renderer=CardRenderer;',context);
  const card={name:'Durations',layout:'list',enabled:true,fields:[{id:'rows',binding:'videos',enabled:true}],list:{rows:3,columns:['duration'],fontSize:16,clip:false}};
  const data={status:'Ready',values:{videos:{type:'table',available:true,value:[{duration:0},{duration:1429},{duration:3723}]}}};
  const catalog=[{id:'videos',type:'table',columns:[{id:'duration',label:'Duration',type:'number',format:'duration'}]}];
  const before=JSON.stringify(data),html=context.renderer.render(card,data,catalog);
  assert.match(html,/0:00/); assert.match(html,/23:49/); assert.match(html,/1:02:03/);
  assert.equal(JSON.stringify(data),before);
  const legacy=await fs.readFile(new URL('../assets/vista-legacy.js',import.meta.url),'utf8');
  const fn=vm.runInNewContext(legacy.slice(legacy.indexOf('  function readyCell('),legacy.indexOf('  function setReadyCell('))+'\nreadyCell;');
  for(const [seconds,label] of [[0,'0:00'],[1429,'23:49'],[3723,'1:02:03']])assert.equal(fn(catalog[0].columns[0],seconds).value,label);
});
async function fixture(t) {
  await fs.mkdir(temporaryRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporaryRoot, 'card-design-')), folder = path.join(root, 'plugins/weather');
  await fs.mkdir(path.join(folder, 'server'), { recursive: true });
  await fs.copyFile(new URL('../plugins/weather/server/index.mjs', import.meta.url), path.join(folder, 'server/index.mjs'));
  await fs.cp(new URL('../plugins/weather/cards/', import.meta.url), path.join(folder, 'cards'), { recursive: true });
  await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify(declaration));
  let app = await createLocalserve(root, { automatic: false });
  t.after(async () => { await app.close(); assert.ok(path.resolve(root).startsWith(path.resolve(temporaryRoot) + path.sep)); await fs.rm(root, { recursive: true, force: true }); });
  await app.registry.saveConfiguration('weather', { revision: 1, enabled: true, settings: { 'poll-minutes': 60, locations } });
  await app.registry.get('weather').state.update(current => { current.locations = {
    'legacy-city': { 'temperature-c': 7, 'feels-like-c': 3, conditions: 'Light rain', 'weather-code': '296', 'updated-at': 1791910000000, 'resolved-area': 'Sompio', 'humidity-percent': 91 },
    second: { 'temperature-c': -3, conditions: 'Snow', 'weather-code': '332', 'updated-at': 1791910000000, 'resolved-area': 'Helsinki', 'private-marker': 'DO-NOT-PROJECT' },
  }; });
  const call = async (endpoint, values) => {
    const response = await fetch(app.origin + endpoint, values === undefined ? {} : { method: 'POST', headers: {
      Origin: app.origin, 'Content-Type': 'application/json', 'X-Localserve-Token': app.snapshot().token }, body: JSON.stringify(values) });
    return { status: response.status, body: await response.json() };
  };
  return { root, folder, call, get app() { return app; }, async restart() { await app.close(); app = await createLocalserve(root, { automatic: false }); } };
}

test('installed design declarations constrain files, public scalar slots and variant tokens', () => {
  const plugin = validateDeclaration(declaration);
  assert.equal(plugin.cardTemplates[0].name, 'Atmosphere');
  for (const patch of [{ directory: '../server' }, { entry: 'code.js', assets: ['code.js'] }, { assets: ['card.html','../../data/config.json'] },
    { slots: [{ id: 'secret', field: 'not-public' }] }, { variant: { slot: 'code', fallback: '../path', choices: {} } }]) {
    assert.throws(() => validateDeclaration({ ...declaration, cardTemplates: [{ ...declaration.cardTemplates[0], ...patch }] }));
  }
});

test('ready-made Cards permit only source changes and derive fixed presentation without rewriting ordinary Cards', () => {
  const plugin = validateDeclaration(declaration), settings = { locations };
  const saved = validateCard(definition(), plugin, null, settings);
  assert.equal(saved.name, 'Atmosphere · Kerava'); assert.equal(saved.fields.length, 11);
  assert.equal(saved.showHeader, false); assert.equal(saved.showFooter, false);
  const changed = validateCard(definition('second'), plugin, saved, settings);
  assert.equal(changed.id, saved.id); assert.equal(changed.fields[0].binding, 'second:temperature-c');
  for (const patch of [{ name: 'Custom title' }, { showHeader: true }, { crop: true }, { fields: [] }, { size: 'small' }, { icon: 'sun' }, { html: '<script>anything</script>' }, { sourceId: 'not-installed' }]) assert.throws(() => validateCard({ ...definition(), ...patch }, plugin, saved, settings));
  assert.throws(() => validateCard({ ...saved, layout: 'grid' }, plugin, saved, settings));
});

test('CRUD, copy naming, captured revisions, source identities and restart keep the fixed design', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/api/plugins/weather/cards', definition())).status, 200);
  const saved = f.app.registry.services()[0].cards[0];
  assert.equal((await f.call(`/api/plugins/weather/cards/${saved.id}`, { ...definition('second'), revision: 0 })).status, 409);
  assert.equal((await f.call('/api/plugins/weather/cards', { ...definition(), enabled: false })).status, 200);
  assert.equal(f.app.registry.services()[0].cards[1].name, 'Atmosphere · Kerava 2');
  assert.equal((await f.call(`/api/plugins/weather/cards/${saved.id}`, { ...definition('second'), revision: saved.revision })).status, 200);
  const config = f.app.registry.services()[0].config;
  await f.app.registry.saveConfiguration('weather', { revision: config.revision, settings: { 'poll-minutes': 60, locations: locations.map(source => source.id === 'second' ? { ...source, name: 'Renamed' } : source) } });
  await f.restart();
  assert.equal(f.app.registry.services()[0].cards[0].sourceId, 'second');
  assert.equal(f.app.registry.services()[0].cards[1].enabled, false);
  assert.equal(f.app.registry.services()[0].cardData.readyMade.sources[1].name, 'Renamed');
  const raw = JSON.parse(await fs.readFile(path.join(f.folder, 'data/cards.json'), 'utf8'));
  assert.equal(raw.cards[0].layout, 'readymade');
});

test('Vista projection exposes only the chosen source/slots and makes disabled/missing sources explicit', async t => {
  const f = await fixture(t);
  await f.call('/api/plugins/weather/cards', definition());
  let service = f.app.registry.services()[0], card = service.cards[0];
  let selected = selectedCardData(card, service.cardData, service.cardCatalog);
  assert.equal(selected.data.values['temperature-c'].value, 7);
  assert.equal(selected.data.readyMade.source.name, 'Kerava');
  assert.doesNotMatch(JSON.stringify(selected), /Helsinki|DO-NOT-PROJECT|private-marker|query|poll-minutes|directory|config|token/);
  await f.app.vistas.save({ schemaVersion: 1, name: 'Test', slug: 'test', enabled: true, gap: 0, padding: 0, layout: {
    id: 'root', type: 'column', name: 'Canvas', enabled: true, width: '1fr', height: '1fr', children: [{ id: 'card', type: 'card', name: 'Weather', enabled: true, width: '1fr', height: '1fr', cards: [{ pluginId: 'weather', cardId: card.id }] }],
  } });
  assert.equal(f.app.vistas.viewer('test').cards[0].data.readyMade.template.id, 'atmosphere');
  let config = service.config;
  await f.app.registry.saveConfiguration('weather', { revision: config.revision, settings: { 'poll-minutes': 60, locations: locations.map(source => source.id === 'legacy-city' ? { ...source, enabled: false } : source) } });
  service = f.app.registry.services()[0]; selected = selectedCardData(card, service.cardData, service.cardCatalog);
  assert.equal(selected.data.values['temperature-c'].available, false);
  config = service.config;
  await f.app.registry.saveConfiguration('weather', { revision: config.revision, settings: { 'poll-minutes': 60, locations: [locations[1]] } });
  service = f.app.registry.services()[0]; selected = selectedCardData(card, service.cardData, service.cardCatalog);
  assert.equal(selected.data.readyMade.unavailable, 'Design or data source unavailable');
  assert.deepEqual(selected.data.values, {});
  await f.restart(); assert.equal(f.app.registry.services()[0].cardsError, '');
});

test('only installed allowlisted assets are frameable and all plugin data/code stays private', async t => {
  const f = await fixture(t);
  const response = await fetch(f.app.origin + '/plugin-card-assets/weather/atmosphere/card.html');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /script-src 'none'.*connect-src 'none'.*frame-ancestors 'self'/);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'self' file:;/);
  const artwork = await fetch(f.app.origin + '/plugin-card-assets/weather/atmosphere/assets/cloud.svg');
  assert.match(artwork.headers.get('content-security-policy'), /frame-ancestors 'self';/);
  assert.doesNotMatch(await response.text(), /<script|iframe|https?:\/\//);
  for (const asset of ['card.css','assets/cloud.svg','assets/sun.svg','assets/rain.svg','assets/snow.svg']) assert.equal((await fetch(f.app.origin + '/plugin-card-assets/weather/atmosphere/' + asset)).status, 200);
  for (const url of ['/plugin-card-assets/weather/atmosphere/data/config.json','/plugin-card-assets/weather/atmosphere/server/index.mjs','/plugins/weather/data/state.json']) assert.equal((await fetch(f.app.origin + url)).status, 404);
  await fs.writeFile(path.join(f.folder,'cards/atmosphere/undeclared.svg'), '<svg/>');
  assert.equal((await fetch(f.app.origin + '/plugin-card-assets/weather/atmosphere/undeclared.svg')).status, 404);
});

test('shared renderer chooses only known condition variants, escapes provider text and hydrates without HTML insertion', async t => {
  const f = await fixture(t); await f.call('/api/plugins/weather/cards', definition());
  const context = vm.createContext({ Intl, URL, Date });
  vm.runInContext(await fs.readFile(new URL('../web/card-renderer.js', import.meta.url), 'utf8') + '\nglobalThis.renderer = CardRenderer;', context);
  const service = f.app.registry.services()[0], card = service.cards[0], data = service.cardData;
  let html = context.renderer.render(card, data, service.cardCatalog, { timeFormat: '24', timeZone: 'Europe/Helsinki' });
  assert.match(html, /sandbox="allow-same-origin"/); assert.doesNotMatch(html, /allow-scripts|srcdoc/);
  const payload = () => JSON.parse(html.match(/data-ready-card="([^"]+)"/)[1].replaceAll('&quot;','"').replaceAll('&amp;','&').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>'));
  assert.equal(payload().variant, 'rain');
  data.values['weather-code'].value = '999'; data.values.conditions.value = '<img onerror="anything">';
  html = context.renderer.render(card, data, service.cardCatalog);
  assert.equal(payload().variant, 'unknown'); assert.doesNotMatch(html, /<img onerror/);
  const slots = [{ dataset: { cardText: 'condition' }, textContent: '', hasAttribute: () => false }];
  const root = { dataset: {}, style: { setProperty() {} } };
  context.renderer.hydrateReadyMade({ dataset: { readyCard: JSON.stringify(payload()) }, contentDocument: { documentElement: root, querySelector: () => true, querySelectorAll: () => slots } });
  assert.equal(slots[0].textContent, '<img onerror="anything">'); assert.equal(root.dataset.variant, 'unknown');
  const css = await fs.readFile(new URL('../plugins/weather/cards/atmosphere/card.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion/); assert.match(css, /animation-play-state: paused/);
});
