import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { validateDeclaration } from '../server/plugins.mjs';
import { validateCard, cardCatalog, projectCardData, selectedCardData } from '../server/cards.mjs';

const boot = await fs.readFile(new URL('../assets/vista-boot.js', import.meta.url), 'utf8');
const legacy = await fs.readFile(new URL('../assets/vista-legacy.js', import.meta.url), 'utf8');
const readyCss = await fs.readFile(new URL('../assets/vista-legacy-ready.css', import.meta.url), 'utf8');

test('every installed ready-made Card has a TV color fallback', async () => {
  const plugins = new URL('../plugins/', import.meta.url);
  for (const plugin of await fs.readdir(plugins)) {
    const cards = new URL(`${plugin}/cards/`, plugins);
    let designs;
    try { designs = await fs.readdir(cards); } catch { continue; }
    for (const design of designs) {
      try { await fs.access(new URL(`${design}/card.html`, cards)); } catch { continue; }
      assert.ok(readyCss.includes(`data-legacy-template="${design}"`), `${plugin}/${design}`);
    }
  }
});

test('new TV CSS provides literal palettes, date no-wrap and airport-style aircraft geometry', () => {
  const section=readyCss.slice(readyCss.indexOf('/* Agenda, Screening room and Airspace:'));
  assert.doesNotMatch(section,/var\(|conic-gradient|aspect-ratio|display:\s*grid|\b(?:row-|column-)?gap\s*:|#[a-f\d]{8}\b/i);
  for(const id of ['agenda','screening','airspace','studio']) {
    assert.ok(section.includes(`html[data-theme="light"][data-legacy-template="${id}"]`));
    assert.ok(section.includes(`html[data-legacy-template="${id}"] .content`));
  }
  assert.match(section,/-webkit-flex-direction: column/);
  assert.doesNotMatch(section,/localserve-airspace-sweep/);
  assert.match(section,/prefers-reduced-motion/);
  assert.match(section,/data-connected="false"/);
  assert.match(section,/airspace"\] \.hero-value[\s\S]*font-size: 64px/);
  assert.match(section,/agenda"\] td:nth-child\(2\)[\s\S]*white-space: nowrap/);
});

function bootScripts(modern, search = '') {
  const written = [];
  const features = modern ? {
    CSS: { supports: () => true }, fetch() {}, Promise: function Promise() {},
  } : {};
  vm.runInNewContext(boot, {
    document: { write: value => written.push(value) }, location: { search }, window: features,
    CSS: features.CSS, Object: { fromEntries() {} }, Array: { prototype: { at() {} } },
    Element: { prototype: { replaceChildren() {} } },
  });
  return written.join('');
}

test('viewer boot keeps modern scripts ordered and selects ES5 on older TVs', () => {
  assert.match(bootScripts(false), /vista-legacy\.js/);
  assert.doesNotMatch(bootScripts(false), /card-renderer\.js/);
  assert.match(bootScripts(true), /card-renderer\.js.*vista-renderer\.js.*vista-viewer\.js/);
  assert.match(bootScripts(true, '?legacy=1'), /vista-legacy\.js/);
});

class FakeElement {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.style = {};
    this.className = '';
    this.value = '';
    this._text = '';
    this.attributes = {};
  }
  set textContent(value) { this.children = []; this._text = String(value); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; return child; }
  replaceChild(next, previous) { this.children.splice(this.children.indexOf(previous), 1, next); next.parentNode = this; previous.parentNode = null; return previous; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  getAttribute(name) { return this.attributes[name] || (name === 'data-theme' ? 'dark' : null); }
}

function runLegacy(payload, time = Date, manual = false) {
  let currentPayload = payload;
  let offline = false;
  const intervals = [];
  const timeouts = [];
  const host = new FakeElement('main');
  const status = new FakeElement('p');
  const body = new FakeElement('body');
  if (manual) body.setAttribute('data-card-host', 'universe');
  const document = {
    body, documentElement: new FakeElement('html'),
    getElementById: id => id === 'vista-display' ? host : status,
    createElement: tag => new FakeElement(tag),
  };
  // These stand in for package-owned pixel fallbacks on a CSS-variable-free TV.
  const fontRule = { style: { fontSize: '20px' } };
  document.styleSheets = [{ cssRules: [fontRule] }];
  class MockRequest {
    open() {}
    send() {
      this.status = offline ? 503 : 200;
      this.readyState = 4;
      this.responseText = JSON.stringify(currentPayload);
      this.onreadystatechange();
    }
  }
  const browser = { matchMedia: () => ({ matches: false }) };
  vm.runInNewContext(legacy, {
    document, location: { pathname: '/vistas/tv' }, XMLHttpRequest: MockRequest,
    setInterval: callback => intervals.push(callback),
    setTimeout: callback => timeouts.push(callback),
    window: browser,
    Date: time, JSON, Math, isFinite, isNaN,
  });
  return { host, status, body, fontRule, adapter: browser.LocalserveLegacyCard, intervals,
    update(next) { offline = false; currentPayload = next; intervals[0](); },
    disconnect() { offline = true; intervals[0](); },
    tick() { intervals[1](); },
    flushTimeouts() { while (timeouts.length) timeouts.shift()(); },
  };
}

test('TV Vista font sizing scales fallback fonts without compounding on polls', () => {
  const make = fontScale => ({ vista: null, cards: [], options: { name: 'Localserve', theme: 'dark', fontScale } });
  const result = runLegacy(make(125));
  assert.equal(result.fontRule.style.fontSize, '25px');
  result.update(make(125));
  assert.equal(result.fontRule.style.fontSize, '25px');
  result.update(make(80));
  assert.equal(result.fontRule.style.fontSize, '16px');
  result.update(make(100));
  assert.equal(result.fontRule.style.fontSize, '20px');
});

test('empty TV Vista displays an explanation rather than a black page', () => {
  const result = runLegacy({
    vista: { id: 'tv', name: 'TV', enabled: true, padding: 16, gap: 12,
      layout: { id: 'root', type: 'row', enabled: true, children: [] } },
    cards: [], options: { name: 'Localserve', theme: 'dark' },
  });
  assert.match(result.host.textContent, /No cards in this Vista yet/);
  assert.match(result.host.textContent, /TV/);
  assert.equal(result.host.children[0].children[0].children[0].src, '../assets/logo-dark.svg');
  assert.match(result.body.className, /legacy-vista/);
  assert.equal(result.status.style.display, 'none');
});

test('old-TV viewer reads the public projection and displays card fields', () => {
  const result = runLegacy({
    vista: { id: 'tv', name: 'TV', enabled: true, padding: 16, gap: 12,
      layout: { id: 'root', type: 'row', enabled: true, children: [
        { id: 'slot', type: 'card', enabled: true, width: '1fr', cards: [{ pluginId: 'pc-network', cardId: 'cpu' }] },
      ] } },
    cards: [{ pluginId: 'pc-network', card: { id: 'cpu', name: 'PC', layout: 'list', showHeader: true, showFooter: true,
      fields: [{ binding: 'cpu-percent', label: 'CPU', unit: '%', decimals: 0, enabled: true }] },
    catalog: [{ id: 'cpu-percent', type: 'number', label: 'CPU' }],
    data: { status: 'Connected', pluginName: 'PC and Network', values: { 'cpu-percent': { type: 'number', available: true, value: 34 } } } }],
    options: { name: 'Localserve', theme: 'dark' },
  });
  assert.match(result.host.textContent, /PC.*CPU.*34 %/);
});

test('old-TV viewer mounts the same packaged ready-made Card asset', () => {
  const result = runLegacy({
    vista: { id: 'tv', name: 'TV', enabled: true, padding: 16, gap: 16,
      layout: { id: 'root', type: 'row', enabled: true, children: [
        { id: 'slot', type: 'collection', enabled: true, width: '1fr',
          cards: [{ pluginId: 'news', cardId: 'front' }] },
      ] } },
    cards: [{ pluginId: 'news', card: { id: 'front', name: 'Front page', layout: 'readymade' },
      catalog: [], data: { status: 'Ready', values: {}, readyMade: {
        template: { id: 'front-page', url: '/plugin-card-assets/news/front-page/card.html', slots: [] },
        source: { id: 'kerava', name: 'Kerava', enabled: true }, bindings: {},
      } } }],
    options: { name: 'Localserve', theme: 'dark' },
  });
  const frame = result.host.children[0].children[0].children[0].children[0];
  assert.equal(frame.tag, 'iframe');
  assert.equal(frame.src, '/plugin-card-assets/news/front-page/card.html');
  assert.equal(frame.getAttribute('scrolling'), 'no');
});

test('Universe adapter mounts one sandboxed ready-made frame without starting Vista polling', () => {
  const result = runLegacy(null, Date, true);
  assert.equal(result.intervals.length, 0);
  const entry = { pluginId:'news',cardId:'front',card:{id:'front',name:'Front page',layout:'readymade'},
    catalog:[],data:{status:'Ready',values:{},readyMade:{template:{id:'front-page',url:'/plugin-card-assets/news/front-page/card.html',slots:[]},source:{id:'source',name:'Source',enabled:true},bindings:{}}} };
  const options = {name:'Test',theme:'dark',fontScale:100,timeFormat:'24'};
  result.adapter.update(entry, options, true);
  const frame = result.host.firstChild.firstChild.firstChild;
  assert.equal(frame.getAttribute('sandbox'),'allow-same-origin');
  result.adapter.update(entry, options, true);
  assert.equal(result.host.firstChild.firstChild.firstChild,frame);
  result.adapter.connected(false);
  result.adapter.update(null, options, false);
  assert.equal(result.host.children.length,0);
});

test('Sensorium TV rings preserve signed acceleration as a value, with no percentage scale',()=>{
  const result=runLegacy(null,Date,true);
  const entry={pluginId:'sensors',cardId:'sensorium',card:{id:'sensorium',name:'Sensorium',layout:'readymade'},catalog:[],
    data:{status:'Ready',values:{x:{available:true,value:-9.81}},readyMade:{
      template:{id:'sensorium',url:'/plugin-card-assets/sensors/sensorium/card.html',slots:[{id:'acceleration-x',type:'number',format:'number',decimals:2}]},
      source:{id:'phone',name:'Phone',enabled:true},bindings:{'acceleration-x':'x'}}}};
  result.adapter.update(entry,{theme:'dark',fontScale:100},true);
  const frame=result.host.firstChild.firstChild.firstChild;
  const meter=new FakeElement('div'),text=new FakeElement('span');
  meter.setAttribute('data-card-meter','acceleration-x');meter.setAttribute('data-meter-mode','value');
  meter.setAttribute('aria-label','Acceleration X');meter.setAttribute('data-meter-unit',' m/s²');
  text.setAttribute('data-card-text','acceleration-x');
  frame.contentDocument={head:new FakeElement('head'),documentElement:new FakeElement('html'),querySelector:()=>true,
    querySelectorAll:selector=>selector==='[data-card-meter]'?[meter]:selector==='[data-card-text]'?[text]:[],
    createElement:tag=>new FakeElement(tag),createElementNS:(ns,tag)=>new FakeElement(tag)};
  frame.onload();
  assert.equal(text.textContent,'-9.81');assert.equal(meter.getAttribute('role'),'img');
  assert.equal(meter.getAttribute('aria-valuenow'),null);assert.match(meter.getAttribute('aria-label'),/-9.81 m\/s²/);
  assert.equal(meter.firstChild.children[1].getAttribute('stroke-dashoffset'),'0');
  assert.equal(meter.firstChild.children[1].getAttribute('stroke'),'#b5a6ff');
});

test('new Cards hydrate real declared scalar/table slots and retain frames on disconnect/reconnect',async()=>{
  const configs={calendar:{calendars:[{id:'source',name:'Calendar source',enabled:true}]},
    emby:{},'adsb-lol':{areas:[{id:'source',name:'Aircraft source',enabled:true}]},youtube:{channels:[{id:'source',name:'Video source',enabled:true}]}};
  const now=Date.parse('2026-10-15T09:00:00Z'),entries=[];
  for(const [id,templateId] of [['calendar','agenda'],['emby','screening'],['adsb-lol','airspace'],['youtube','studio']]) {
    const declaration=validateDeclaration(JSON.parse(await fs.readFile(new URL(`../plugins/${id}/declaration.json`,import.meta.url))));
    const settings=configs[id],reading={private:'PRIVATE-MARKER'};
    const sample=(type,label)=>type==='number'?0:type==='boolean'?false:type==='timestamp'?now:`${label} <b>literal</b>`;
    for(const field of declaration.cardFields) {
      if(field.source.kind==='state')reading[field.source.key]=sample(field.type,field.label);
      if(field.source.kind==='rows') {
        reading[field.source.countKey]=1;
        for(const column of field.columns) reading[field.source.rows[0][column.id]]=sample(column.type,column.label);
      }
    }
    for(const field of declaration.cardFields.filter(field=>field.source.kind==='rows')) reading[field.source.countKey]=1;
    const state=declaration.instances?{[declaration.instances.stateKey]:{source:reading}}:reading;
    const record={health:'ready',configured:true,config:{snapshot:()=>({enabled:true,settings})},log:{latest:()=>[]},state:{snapshot:()=>state}};
    const card=validateCard({schemaVersion:1,enabled:true,layout:'readymade',templateId,sourceId:declaration.instances?'source':'plugin'},declaration,null,settings);
    const selected=selectedCardData(card,projectCardData(declaration,record),cardCatalog(declaration,settings));
    assert.doesNotMatch(JSON.stringify(selected),/PRIVATE-MARKER/);
    entries.push({pluginId:id,card,...selected});
  }
  const payload={vista:{id:'new-cards',name:'New Cards',enabled:true,padding:24,gap:24,layout:{id:'root',type:'row',enabled:true,
    children:entries.map((entry,i)=>({id:`slot-${i}`,type:'card',enabled:true,width:'1fr',cards:[{pluginId:entry.pluginId,cardId:entry.card.id}]}))}},
    cards:entries,options:{name:'Localserve',theme:'dark',timeFormat:'24',now,fontScale:100}};
  const result=runLegacy(payload),frames=[];
  for(let i=0;i<entries.length;i++) {
    const frame=result.host.firstChild.children[i].firstChild.firstChild;
    const textNodes=entries[i].data.readyMade.template.slots.filter(slot=>slot.type!=='table').map(slot=>{
      const node=new FakeElement('span');node.setAttribute('data-card-text',slot.id);return node;
    });
    const sourceStatus=new FakeElement('span');sourceStatus.setAttribute('data-card-text','source-status');textNodes.push(sourceStatus);
    const tables=entries[i].data.readyMade.template.slots.filter(slot=>slot.type==='table').map(slot=>{
      const node=new FakeElement('table');node.setAttribute('data-card-table',slot.id);return node;
    });
    frame.contentDocument={head:new FakeElement('head'),documentElement:new FakeElement('html'),querySelector:()=>true,
      querySelectorAll:selector=>selector==='[data-card-text]'?textNodes:selector==='[data-card-table]'?tables:selector==='[data-card-text="source-status"]'?[sourceStatus]:[],
      createElement:tag=>new FakeElement(tag)};
    frame.onload();
    assert.equal(frame.contentDocument.head.children.length,1);
    assert.equal(frame.contentDocument.head.firstChild.href,'/assets/vista-legacy-ready.css?v=20');
    assert.equal(frame.contentDocument.documentElement.getAttribute('data-legacy-template'),entries[i].card.templateId);
    assert.ok(tables[0].textContent.includes('<b>literal</b>'),entries[i].pluginId+' should hydrate its declared text cells');
    if(entries[i].data.readyMade.template.slots.some(slot=>slot.type==='number')) {
      assert.ok(textNodes.some(node=>node.textContent==='0'),'Known numeric zero must remain available');
    }
    assert.equal(sourceStatus.textContent,'Ready');
    frames.push({frame,textNodes,tables,sourceStatus});
  }
  const emby=entries[1],progressBinding=emby.data.readyMade.bindings.progress;
  emby.data.values[progressBinding]={type:'number',available:false,value:null};
  result.update(payload);
  assert.equal(frames[1].textNodes.find(node=>node.getAttribute('data-card-text')==='progress').textContent,'No data');
  result.disconnect();result.tick();
  for(const current of frames) {
    assert.equal(current.frame.contentDocument.documentElement.getAttribute('data-connected'),'false');
    assert.equal(current.sourceStatus.textContent,'Disconnected · retained reading');
  }
  result.update(payload);
  for(let i=0;i<frames.length;i++) {
    assert.strictEqual(result.host.firstChild.children[i].firstChild.firstChild,frames[i].frame);
    assert.equal(frames[i].frame.contentDocument.head.children.length,1,'Polling must not add stylesheets');
    assert.equal(frames[i].frame.contentDocument.documentElement.getAttribute('data-connected'),'true');
    assert.equal(frames[i].sourceStatus.textContent,'Ready');
  }
});

test('old-TV ready-made Cards fill table, hero and meter slots', () => {
  const now = Date.now();
  const result = runLegacy({
    vista: { id: 'tv', name: 'TV', enabled: true, padding: 16, gap: 16,
      layout: { id: 'root', type: 'row', enabled: true, children: [
        { id: 'slot', type: 'card', enabled: true, width: '1fr',
          cards: [{ pluginId: 'hsl-trains', cardId: 'platform' }] },
      ] } },
    cards: [{ pluginId: 'hsl-trains', card: { id: 'platform', name: 'Platform', layout: 'readymade' },
      catalog: [], data: { status: 'Ready', values: {
        trains: { available: true, value: [{ train: 'K', 'in-minutes': now + 5 * 60000 }] },
        cpu: { available: true, value: 44 },
      }, readyMade: {
        template: { id: 'platform', url: '/plugin-card-assets/hsl-trains/platform/card.html', slots: [
          { id: 'board', type: 'table', rows: 5, columns: [
            { id: 'train', label: 'Train', type: 'string' },
            { id: 'in-minutes', label: 'In', type: 'timestamp', format: 'minutes-until' },
          ] },
          { id: 'cpu', type: 'number', format: 'number', decimals: 1 },
        ], variant: { slot: 'cpu', choices: { active: ['44'] }, fallback: 'unknown' } },
        source: { id: 'kerava', name: 'Kerava', enabled: true },
        bindings: { board: 'trains', cpu: 'cpu' },
      } } }],
    options: { name: 'Localserve', theme: 'dark', timeFormat: '24', now },
  });
  const frame = result.host.children[0].children[0].children[0].children[0];
  const textNode = new FakeElement('span'); textNode.setAttribute('data-card-text', 'cpu');
  const hero = new FakeElement('span'); hero.setAttribute('data-card-cell', 'board:0:train');
  const table = new FakeElement('table'); table.setAttribute('data-card-table', 'board');
  const meter = new FakeElement('div'); meter.setAttribute('data-card-meter', 'cpu');
  frame.contentDocument = {
    head: new FakeElement('head'), documentElement: new FakeElement('html'),
    querySelector: () => new FakeElement('body'),
    querySelectorAll: selector => ({
      '[data-card-text]': [textNode], '[data-card-cell]': [hero],
      '[data-card-table]': [table], '[data-card-meter]': [meter],
    })[selector] || [],
    createElement: tag => new FakeElement(tag),
    createElementNS: (namespace, tag) => new FakeElement(tag),
  };
  frame.onload();
  assert.equal(textNode.textContent, '44');
  assert.equal(hero.textContent, 'K');
  assert.match(table.textContent, /Train.*In.*K.*5 min/);
  assert.equal(meter.children[0].tag, 'svg');
  assert.equal(meter.getAttribute('aria-valuenow'), '44');
  assert.equal(frame.contentDocument.documentElement.getAttribute('data-variant'), 'active');
});

test('data refresh keeps the ready-made iframe mounted', () => {
  const fixture = {
    vista: { id: 'tv', name: 'TV', enabled: true, padding: 16, gap: 16,
      layout: { id: 'root', type: 'row', enabled: true, children: [
        { id: 'slot', type: 'card', enabled: true, width: '1fr',
          cards: [{ pluginId: 'pc-network', cardId: 'observatory' }] },
      ] } },
    cards: [{ pluginId: 'pc-network', card: { id: 'observatory', name: 'Observatory', layout: 'readymade' },
      catalog: [], data: { status: 'Ready', values: { cpu: { available: true, value: 25 } }, readyMade: {
        template: { id: 'observatory', url: '/plugin-card-assets/pc-network/observatory/card.html',
          slots: [{ id: 'cpu', type: 'number', format: 'number', decimals: 1 }] },
        source: { id: 'pc', name: 'PC', enabled: true }, bindings: { cpu: 'cpu' },
      } } }],
    options: { name: 'Localserve', theme: 'dark', timeFormat: '24', now: Date.now() },
  };
  const result = runLegacy(fixture);
  const root = result.host.children[0];
  const frame = root.children[0].children[0].children[0];
  const meter = new FakeElement('div'); meter.setAttribute('data-card-meter', 'cpu');
  frame.contentDocument = {
    head: new FakeElement('head'), documentElement: new FakeElement('html'),
    querySelector: () => new FakeElement('body'),
    querySelectorAll: selector => selector === '[data-card-meter]' ? [meter] : [],
    createElement: tag => new FakeElement(tag),
    createElementNS: (namespace, tag) => new FakeElement(tag),
  };
  frame.onload();
  const ring = meter.firstChild;
  result.update({ ...fixture, cards: [{ ...fixture.cards[0], data: {
    ...fixture.cards[0].data,
    values: { cpu: { available: true, value: 48 } },
  } }] });
  assert.strictEqual(result.host.children[0], root);
  assert.strictEqual(root.children[0].children[0].children[0], frame);
  assert.equal(frame._legacyEntry.data.values.cpu.value, 48);
  assert.strictEqual(meter.firstChild, ring);
  assert.equal(meter.getAttribute('aria-valuenow'), '48');
});

test('TV dedicated-memory percentage handles zero and unavailable totals', () => {
  const entry = {
    pluginId: 'pc-network', card: { id: 'observatory', name: 'Observatory', layout: 'readymade' },
    data: { status: 'Ready', values: { used: { available: true, value: 2 }, total: { available: true, value: 8 } }, readyMade: {
      template: { id: 'observatory', url: '/plugin-card-assets/pc-network/observatory/card.html', slots: [
        { id: 'memory', type: 'number', format: 'number', decimals: 1, percentOf: 'total' },
        { id: 'total', type: 'number', format: 'number', decimals: 1 },
      ] }, source: { id: 'pc', enabled: true }, bindings: { memory: 'used', total: 'total' },
    } },
  };
  const make = () => ({ vista: { id: 'tv', name: 'TV', enabled: true, layout: {
    id: 'root', type: 'row', enabled: true, children: [{ id: 'slot', type: 'card', enabled: true,
      cards: [{ pluginId: 'pc-network', cardId: 'observatory' }] }],
  } }, cards: [entry], options: { theme: 'dark' } });
  const result = runLegacy(make());
  const frame = result.host.children[0].children[0].children[0].children[0];
  const text = new FakeElement('span'); text.setAttribute('data-card-text', 'memory');
  const meter = new FakeElement('div'); meter.setAttribute('data-card-meter', 'memory');
  frame.contentDocument = {
    head: new FakeElement('head'), documentElement: new FakeElement('html'), querySelector: () => true,
    querySelectorAll: selector => selector === '[data-card-text]' ? [text] : selector === '[data-card-meter]' ? [meter] : [],
    createElement: tag => new FakeElement(tag), createElementNS: (namespace, tag) => new FakeElement(tag),
  };
  frame.onload();
  assert.equal(text.textContent, '25');
  assert.equal(meter.getAttribute('aria-valuenow'), '25');
  entry.data.values.used.value = 0; result.update(make());
  assert.equal(text.textContent, '0');
  entry.data.values.total.value = 0; result.update(make());
  assert.equal(text.textContent, 'No data');
  assert.equal(meter.getAttribute('aria-valuenow'), null);
});

test('ready-made table refresh preserves rows and cells when readings change', () => {
  const makePayload = value => ({
    vista: { id: 'tv', name: 'TV', enabled: true, padding: 16, gap: 16,
      layout: { id: 'root', type: 'row', enabled: true, children: [
        { id: 'slot', type: 'card', enabled: true, width: '1fr',
          cards: [{ pluginId: 'hsl-trains', cardId: 'platform' }] },
      ] } },
    cards: [{ pluginId: 'hsl-trains', card: { id: 'platform', name: 'Platform', layout: 'readymade' },
      catalog: [], data: { status: 'Ready', values: { board: { available: true, value: [{ train: value }] } }, readyMade: {
        template: { id: 'platform', url: '/plugin-card-assets/hsl-trains/platform/card.html', slots: [
          { id: 'board', type: 'table', rows: 5, columns: [{ id: 'train', label: 'Train', type: 'string' }] },
        ] }, source: { id: 'kerava', name: 'Kerava', enabled: true }, bindings: { board: 'board' },
      } } }], options: { name: 'Localserve', theme: 'dark', timeFormat: '24', now: Date.now() },
  });
  const result = runLegacy(makePayload('K'));
  const frame = result.host.children[0].children[0].children[0].children[0];
  const table = new FakeElement('table'); table.setAttribute('data-card-table', 'board');
  frame.contentDocument = {
    head: new FakeElement('head'), documentElement: new FakeElement('html'),
    querySelector: () => new FakeElement('body'),
    querySelectorAll: selector => selector === '[data-card-table]' ? [table] : [],
    createElement: tag => new FakeElement(tag),
    createElementNS: (namespace, tag) => new FakeElement(tag),
  };
  frame.onload();
  const body = table.children[1], row = body.firstChild, cell = row.firstChild;
  result.update(makePayload('R'));
  assert.strictEqual(table.children[1], body);
  assert.strictEqual(body.firstChild, row);
  assert.strictEqual(row.firstChild, cell);
  assert.equal(cell.textContent, 'R');
});

test('ordinary Card values update without replacing the Card', () => {
  const fixture = {
    vista: { id: 'tv', name: 'TV', enabled: true, padding: 16, gap: 16,
      layout: { id: 'root', type: 'row', enabled: true, children: [
        { id: 'slot', type: 'card', enabled: true, width: '1fr',
          cards: [{ pluginId: 'pc-network', cardId: 'cpu' }] },
      ] } },
    cards: [{ pluginId: 'pc-network', card: { id: 'cpu', name: 'CPU', layout: 'list',
      fields: [{ binding: 'cpu', label: 'Usage', enabled: true }] },
    catalog: [{ id: 'cpu', label: 'CPU', type: 'number' }],
    data: { status: 'Ready', values: { cpu: { available: true, type: 'number', value: 25 } } } }],
    options: { name: 'Localserve', theme: 'dark', now: Date.now() },
  };
  const result = runLegacy(fixture);
  const article = result.host.children[0].children[0].children[0];
  result.update({ ...fixture, cards: [{ ...fixture.cards[0], data: {
    ...fixture.cards[0].data, values: { cpu: { available: true, type: 'number', value: 48 } },
  } }] });
  assert.strictEqual(result.host.children[0].children[0].children[0], article);
  assert.match(article.textContent, /48/);
});

test('TV collection fades only on a card switch and preserves the new card on polls', () => {
  let now = 1000;
  class FakeDate extends Date { static now() { return now; } }
  const card = (id, value) => ({ pluginId: 'pc-network',
    card: { id, name: id, layout: 'list', fields: [{ binding: 'reading', label: 'Reading', enabled: true }] },
    catalog: [{ id: 'reading', label: 'Reading', type: 'string' }],
    data: { status: 'Ready', values: { reading: { available: true, type: 'string', value } } },
  });
  const payload = {
    vista: { id: 'tv', name: 'TV', enabled: true, padding: 16, gap: 16,
      layout: { id: 'root', type: 'row', enabled: true, children: [
        { id: 'slot', type: 'collection', enabled: true, width: '1fr', rotation: 'interval',
          intervalSeconds: 1, animation: 'fade', cards: [
            { pluginId: 'pc-network', cardId: 'a' }, { pluginId: 'pc-network', cardId: 'b' },
          ] },
      ] } },
    cards: [card('a', 'Alpha'), card('b', 'Beta')], options: { name: 'Localserve', theme: 'dark' },
  };
  const result = runLegacy(payload, FakeDate);
  const slot = result.host.firstChild.firstChild;
  const old = slot.firstChild;
  now = 2100;
  result.tick();
  assert.equal(slot.children.length, 2);
  assert.strictEqual(slot.firstChild, old);
  assert.match(old.className, /legacy-switch-leave/);
  const current = slot.lastChild;
  assert.match(current.textContent, /Beta/);
  result.flushTimeouts();
  assert.strictEqual(slot.firstChild, current);
  result.update({ ...payload, cards: [card('a', 'Alpha'), card('b', 'Beta updated')] });
  assert.strictEqual(slot.firstChild, current);
  assert.match(current.textContent, /Beta updated/);
});

test('TV keeps the outgoing ready-made Card visible until the new stylesheet loads', () => {
  let now = 1000;
  class FakeDate extends Date { static now() { return now; } }
  const card = id => ({ pluginId: 'news',
    card: { id, name: id, layout: 'readymade' }, catalog: [],
    data: { status: 'Ready', values: {}, readyMade: {
      template: { id: 'front-page', url: '/plugin-card-assets/news/front-page/card.html', slots: [] },
      source: { id: 'news', name: 'News', enabled: true }, bindings: {},
    } },
  });
  const result = runLegacy({
    vista: { id: 'tv', name: 'TV', enabled: true, padding: 16, gap: 16,
      layout: { id: 'root', type: 'row', enabled: true, children: [
        { id: 'slot', type: 'collection', enabled: true, width: '1fr', rotation: 'interval',
          intervalSeconds: 1, animation: 'fade', cards: [
            { pluginId: 'news', cardId: 'a' }, { pluginId: 'news', cardId: 'b' },
          ] },
      ] } },
    cards: [card('a'), card('b')], options: { name: 'Localserve', theme: 'dark' },
  }, FakeDate);
  const slot = result.host.firstChild.firstChild, old = slot.firstChild;
  now = 2100;
  result.tick();
  const frame = slot.lastChild.firstChild;
  assert.equal(slot.children.length, 2);
  assert.doesNotMatch(old.className, /legacy-switch-leave/);
  frame.contentDocument = {
    head: new FakeElement('head'), documentElement: new FakeElement('html'),
    querySelector: () => new FakeElement('body'), querySelectorAll: () => [],
    createElement: tag => new FakeElement(tag),
  };
  frame.onload();
  assert.doesNotMatch(old.className, /legacy-switch-leave/);
  frame.contentDocument.head.firstChild.onload();
  assert.match(old.className, /legacy-switch-leave/);
  result.flushTimeouts();
  assert.strictEqual(slot.firstChild.firstChild, frame);
});
