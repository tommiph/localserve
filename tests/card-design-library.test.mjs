/** Offline design checks build readings from declared public fields only.
 * No installed data, provider requests or physical device commands are used. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { validateDeclaration } from '../server/plugins.mjs';
import { validateCard, projectCardData, cardCatalog, selectedCardData } from '../server/cards.mjs';

const ids = ['hsl-trains','finavia','news','pc-network','playstation','oculus-go','tradfri','samsung-tv','simulator','sensors'];
const context = vm.createContext({ Intl, URL, Date });
vm.runInContext(await fs.readFile(new URL('../web/card-renderer.js',import.meta.url),'utf8')+'\nglobalThis.renderer=CardRenderer;',context);
vm.runInContext(await fs.readFile(new URL('../web/vista-renderer.js',import.meta.url),'utf8')+'\nglobalThis.vista=VistaRenderer;',context);
const declarations = await Promise.all(ids.map(async id => JSON.parse(await fs.readFile(new URL(`../plugins/${id}/declaration.json`,import.meta.url),'utf8'))));

function fixture(raw) {
  const plugin = validateDeclaration(raw);
  const settings = plugin.instances ? { [plugin.instances.setting]: [
    {id:'chosen',name:'Chosen source',enabled:true},{id:'other',name:'Other source',enabled:true},
  ] } : {};
  const state = {};
  const sample = type => type==='number' ? 42.5 : type==='timestamp' ? 1791910000000 : type==='boolean' ? true : 'Public reading';
  for (const field of plugin.cardFields) {
    if (field.source.kind==='state') state[field.source.key]=sample(field.type);
  }
  for (const field of plugin.cardFields) {
    if (field.type==='table') {
      state[field.source.countKey]=field.source.rows.length;
      for (const row of field.source.rows) for (const column of field.columns) state[row[column.id]]=sample(column.type);
    }
  }
  state['private-token']='NEVER-PUBLIC';
  const entries=plugin.events.map(event=>({eventId:event.id,at:1791910000000,payload:Object.fromEntries(event.payload.map(field=>[field.id,sample(field.type)]))}));
  const record = { health:'ready',configured:true,config:{snapshot:()=>({enabled:true,settings})},log:{latest:()=>entries},
    state:{snapshot:()=>plugin.instances ? {[plugin.instances.stateKey]:{chosen:state,other:{...state,'private-token':'OTHER-SOURCE'}}} : state} };
  const card = validateCard({schemaVersion:1,layout:'readymade',templateId:plugin.cardTemplates[0].id,sourceId:plugin.instances?'chosen':'plugin',enabled:true},plugin,null,settings);
  return {plugin,settings,state,record,card,data:projectCardData(plugin,record,false,
    {now:1791910000000,location:{latitude:60.4048,longitude:25.113}}),catalog:cardCatalog(plugin,settings)};
}

for (const declaration of declarations) test(`${declaration.name} design has contained assets and selected public projection`,async () => {
  const f=fixture(declaration), template=f.plugin.cardTemplates[0];
  const projected=selectedCardData(f.card,f.data,f.catalog);
  assert.equal(projected.data.readyMade.template.id,template.id);
  assert.doesNotMatch(JSON.stringify(projected),/NEVER-PUBLIC|OTHER-SOURCE|private-token|Other source/);
  for (const slot of template.slots) {
    const datum=projected.data.values[projected.data.readyMade.bindings[slot.id]];
    assert.equal(datum.available,true,slot.id);
    if (slot.type==='table') {
      assert.ok(datum.value.length<=slot.rows);
      assert.deepEqual(Object.keys(datum.value[0]),slot.columns.map(column=>column.id));
    }
  }
  for (const asset of template.assets) {
    const source=await fs.readFile(new URL(`../plugins/${declaration.id}/${template.directory}/${asset}`,import.meta.url),'utf8');
    assert.ok(Buffer.byteLength(source)<256*1024);
    assert.doesNotMatch(source,/<script\b|<iframe\b|on(?:click|load|error)=|url\(["']?https?:|<image[^>]+https?:/i);
    if (asset.endsWith('.css')) {assert.match(source,/prefers-reduced-motion/);assert.match(source,/animation-play-state: paused/);}
    if (asset.endsWith('.html')) {
      for (const match of source.matchAll(/data-card-(?:text|table|meter|flash|color)="([a-z0-9-]+)"/g)) assert.ok(['source-name','source-status',...template.slots.map(slot=>slot.id)].includes(match[1]),match[1]);
    }
  }
  const markup=context.renderer.render(f.card,projected.data,projected.catalog,{now:1791909950000,timeZone:'Europe/Helsinki',timeFormat:'24'});
  assert.match(markup,/sandbox="allow-same-origin"/);
  assert.doesNotMatch(markup,/allow-scripts|NEVER-PUBLIC/);
});

test('fixed table selections reject unknown columns, unbounded rows and table-driven variants',()=>{
  const raw=structuredClone(declarations.find(declaration=>declaration.id==='finavia')),
    template=raw.cardTemplates[0], table=template.slots.find(slot=>slot.format==='table');
  for (const patch of [{rows:11},{rows:0},{columns:['private-token']},{columns:['train','train']}]) {
    const changed=structuredClone(raw);Object.assign(changed.cardTemplates[0].slots.find(slot=>slot.id===table.id),patch);assert.throws(()=>validateDeclaration(changed));
  }
  template.variant={slot:table.id,fallback:'unknown',choices:{}};assert.throws(()=>validateDeclaration(raw));
});

test('source-only edits retarget bindings and disabled sources clear their public readings',()=>{
  const f=fixture(declarations[0]);
  const changed=validateCard({...f.card,sourceId:'other'},f.plugin,f.card,f.settings);
  assert.equal(changed.sourceId,'other');assert.ok(changed.fields.every(field=>field.binding.startsWith('other:')));
  f.settings.locations[1].enabled=false;
  const selected=selectedCardData(changed,projectCardData(f.plugin,f.record),cardCatalog(f.plugin,f.settings));
  assert.equal(selected.data.readyMade.source.enabled,false);
  assert.ok(Object.values(selected.data.values).every(datum=>!datum.available&&datum.value===null));
});

function payload(markup) {
  return JSON.parse(markup.match(/data-ready-card="([^"]+)"/)[1].replaceAll('&quot;','"').replaceAll('&amp;','&').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>'));
}

test('ordinary Cards isolate preview font size and ready-made frames receive the Vista font size', () => {
  const f = fixture(declarations.find(declaration => declaration.id === 'pc-network'));
  const ordinary = { name: 'Test', layout: 'grid', fields: [], icon: 'none' };
  assert.match(context.renderer.render(ordinary, f.data, f.catalog, { fontScale: 115 }), /style="--font-scale:1\.15"/);
  assert.equal(payload(context.renderer.render(f.card, f.data, f.catalog, { fontScale: 85 })).fontScale, 85);
});

test('Observatory uses GPU 1 and a bounded public dedicated-memory ratio', () => {
  const raw = declarations.find(declaration => declaration.id === 'pc-network');
  const f = fixture(raw);
  const values = f.data.values;
  const get = () => payload(context.renderer.render(f.card, f.data, f.catalog, { locale: 'en-US' }));
  values['gpu-1-percent'].value = 37.5;
  values['gpu-1-dedicated-used-gib'].value = 2;
  values['gpu-1-dedicated-total-gib'].value = 8;
  assert.equal(get().slots.gpu.raw, 37.5);
  assert.equal(get().slots['gpu-memory'].value, '25');
  values['gpu-1-dedicated-used-gib'].value = 0;
  assert.equal(get().slots['gpu-memory'].raw, 0);
  for (const total of [0, null, -1, Infinity]) {
    values['gpu-1-dedicated-total-gib'].value = total;
    assert.equal(get().slots['gpu-memory'].available, false);
    assert.equal(get().slots['gpu-memory'].value, 'No data');
  }
  values['gpu-1-dedicated-total-gib'].value = 8;
  values['gpu-1-dedicated-used-gib'].available = false;
  assert.equal(get().slots['gpu-memory'].available, false);
  const projected = selectedCardData(f.card, f.data, f.catalog);
  assert.doesNotMatch(JSON.stringify(projected), /drive-[de]-free-percent|gpu-2-/);
  // Fixed designs cannot divide by private fields, themselves or derived chains.
  for (const percentOf of ['private-token', 'gpu-memory', 'host']) {
    const invalid = structuredClone(raw);
    invalid.cardTemplates[0].slots.find(slot => slot.id === 'gpu-memory').percentOf = percentOf;
    assert.throws(() => validateDeclaration(invalid));
  }
});

test('flight table keeps its selected time and countdown',()=>{
  const f=fixture(declarations.find(declaration=>declaration.id==='finavia'));
  const slot=f.plugin.cardTemplates[0].slots.find(slot=>slot.type==='table');
  const binding=f.data.readyMade.sources[0].bindings[slot.field];
  f.data.values[binding].value[0]['in-minutes']=1791910000000;
  const get=now=>payload(context.renderer.render(f.card,f.data,f.catalog,{now,timeZone:'Europe/Helsinki',timeFormat:'24'}));
  const first=get(1791909950000);
  assert.equal(first.slots.board.rows[0]['in-minutes'].value,'1 min');
  assert.equal(first.slots.board.rows.length,1);
  assert.equal(get(1791910010000).slots.board.rows[0]['in-minutes'].value,'0 min');
  assert.doesNotMatch(first.slots.board.rows[0].time.value,/2026/);
});

test('Platform projects only the next train with a live deadline',()=>{
  const f=fixture(declarations.find(declaration=>declaration.id==='hsl-trains'));
  const get=(now,connected=true)=>payload(context.renderer.render(f.card,f.data,f.catalog,{now,timeZone:'Europe/Helsinki',timeFormat:'24',connected}));
  const first=get(1791909950000);
  assert.equal(first.slots['next-in'].value,'1 min');
  assert.equal(first.slots['next-in'].deadline,1791910000000);
  assert.equal(get(1791910010000).slots['next-in'].value,'0 min');
  assert.doesNotMatch(first.slots['next-time'].value,/2026/);
  assert.equal(first.slots.board,undefined);
  assert.equal(get(1791909950000,false).connected,false);
});

test('Gaming lounge keeps ungrouped whole-number displays and a confirmed no-game label',()=>{
  const f=fixture(declarations.find(declaration=>declaration.id==='playstation'));
  const bindings=f.data.readyMade.sources[0].bindings;
  f.data.values[bindings['trophies-total']].value=1640;
  f.data.values[bindings['all-games-play-hours']].value=1665.1;
  f.data.values[bindings['active-play-hours']].value=2.5;
  f.data.values[bindings['active-game-display']].value='Not playing';
  const rendered=payload(context.renderer.render(f.card,f.data,f.catalog,{locale:'en-US'}));
  assert.equal(rendered.slots.game.value,'Not playing');
  assert.equal(rendered.slots['trophies-total'].value,'1640');
  assert.equal(rendered.slots['all-hours'].value,'1665');
  assert.equal(rendered.slots.hours.value,'3');
});

test('Orbital displays confirmed no-app state and free storage as its fourth percentage gauge',()=>{
  const f=fixture(declarations.find(declaration=>declaration.id==='oculus-go'));
  const bindings=f.data.readyMade.sources[0].bindings;
  f.data.values[bindings['active-app-display']].value='Not playing';
  f.data.values[bindings['storage-free-percent']].value=34.6;
  const rendered=payload(context.renderer.render(f.card,f.data,f.catalog,{locale:'en-US'}));
  assert.equal(rendered.slots.app.value,'Not playing');
  assert.equal(rendered.slots['storage-free'].value,'34.6');
  assert.equal(rendered.slots['storage-free'].raw,34.6);
  assert.equal(rendered.slots['foreground-minutes'],undefined);
});

test('ready-made collection fingerprints ignore hidden table cells and rows in administrator previews',()=>{
  const f=fixture(declarations.find(d=>d.id==='finavia'));
  const entry={pluginId:f.plugin.id,cardId:f.card.id,card:f.card,data:f.data,catalog:f.catalog};
  const node={type:'collection',cards:[{pluginId:f.plugin.id,cardId:f.card.id}],rotation:'update',intervalSeconds:10};
  const entries=new Map([[`${f.plugin.id}/${f.card.id}`,entry]]);
  const before=context.vista.choose(node,entries,null,0);
  const table=f.data.readyMade.sources[0].bindings.flights;
  f.data.values[table].value[0].scheduled='HIDDEN';f.data.values[table].value[6].route='Outside selected rows';
  const hidden=context.vista.choose(node,entries,before,1);
  assert.equal(hidden.fingerprints[`${f.plugin.id}/${f.card.id}`],before.fingerprints[`${f.plugin.id}/${f.card.id}`]);
  f.data.values[table].value[0].route='Visible change';
  const visible=context.vista.choose(node,entries,hidden,2);
  assert.notEqual(visible.fingerprints[`${f.plugin.id}/${f.card.id}`],hidden.fingerprints[`${f.plugin.id}/${f.card.id}`]);
});

test('typed gauges clamp graphic ranges, retain missing values and flash only changed known readings',()=>{
  const root={dataset:{},style:{setProperty(){}}};
  const meter={dataset:{cardMeter:'cpu'},style:{setProperty(key,value){this[key]=value;}},setAttribute(key,value){this[key]=value;},removeAttribute(key){delete this[key];}};
  const flash={dataset:{cardFlash:'value'}};
  const document={documentElement:root,querySelector:()=>true,querySelectorAll:selector=>selector==='[data-card-meter]'?[meter]:selector==='[data-card-flash]'?[flash]:[]};
  const frame={contentDocument:document,dataset:{}};
  const hydrate=(cpu,value,connected=true)=>{
    frame.dataset.readyCard=JSON.stringify({slots:{cpu:{raw:cpu,available:cpu!==null},value:{raw:value,available:value!==null}},connected,fontScale:100});
    context.renderer.hydrateReadyMade(frame);
  };
  hydrate(180,1);assert.equal(meter.style['--reading-percent'],100);assert.equal(flash.dataset.flash,undefined);
  hydrate(-5,1);assert.equal(meter.style['--reading-percent'],0);assert.equal(flash.dataset.flash,undefined);
  hydrate(null,null);assert.equal(meter.dataset.available,'false');assert.equal(meter['aria-valuenow'],undefined);
  assert.equal(meter.role,'img');assert.match(meter['aria-label'],/No data/);
  hydrate(20,2);assert.equal(flash.dataset.flash,'a');
  assert.equal(meter.role,'meter');assert.equal(meter['aria-valuenow'],'20');
  hydrate(20,3,false);assert.equal(flash.dataset.flash,'a');
});
