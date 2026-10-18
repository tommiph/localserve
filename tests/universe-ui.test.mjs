import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { universeDefaults } from '../server/universe.mjs';

test('Universe library uses existing ready-made Cards, escapes labels and keeps filters outside the draft', async () => {
  const nodes = { '#universe-selected':{}, '#universe-library':{} };
  const state = { universe:structuredClone(universeDefaults),services:[{id:'all',name:'Plugin <one>',cards:[
    {id:'first',name:'First <Card>',layout:'readymade',enabled:true},
    {id:'second',name:'Second',layout:'readymade',enabled:false},
    {id:'ordinary',name:'Not a design',layout:'list',enabled:true},
  ]}] };
  const handlers = {};
  const context = { state,document:{addEventListener:(name,fn)=>{handlers[name]=fn;}},
    dialog:{open:true,querySelector:selector=>nodes[selector] || null},structuredClone,
    escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),icon:()=>'',pageHeading:()=>'' };
  const ui=vm.runInNewContext(await fs.readFile(new URL('../web/universe-ui.js',import.meta.url),'utf8')+'\nUniverseUI;',context);
  ui.draft=structuredClone(universeDefaults);
  assert.equal(ui.library().length,2);ui.refresh();
  const overview=ui.render();
  for(const world of ['space','ocean','mountains','forest','dunes']) assert.ok(overview.includes('/universe?world='+world));
  assert.match(nodes['#universe-library'].innerHTML,/First &lt;Card&gt;/);
  assert.match(nodes['#universe-library'].innerHTML,/data-category="plugin:all"/);
  await ui.handleAction('universe-add',{dataset:{plugin:'all',card:'first'}});
  await ui.handleAction('universe-add',{dataset:{plugin:'all',card:'second'}});
  await ui.handleAction('universe-up',{dataset:{index:'1'}});
  assert.deepEqual(Array.from(ui.draft.cards,item=>item.cardId),['second','first']);
  const saved=JSON.stringify(ui.readDraft());
  handlers.input({target:{id:'universe-search',value:'First'}});
  await ui.handleAction('universe-category',{dataset:{category:'plugin:all'}});
  assert.equal(JSON.stringify(ui.readDraft()),saved);
  assert.match(nodes['#universe-library'].innerHTML,/First &lt;Card&gt;/);
  assert.doesNotMatch(nodes['#universe-library'].innerHTML,/strong>Second/);
  await ui.handleAction('universe-remove',{dataset:{index:'0'}});
  assert.equal(ui.draft.cards[0].cardId,'first');
  // A refreshed server snapshot must not replace an open editor's revision.
  state.universe.revision=99;assert.equal(ui.readDraft().revision,1);
});

test('Universe editor exposes default world and reads it with captured settings', async () => {
  let html='';
  const state={universe:{...structuredClone(universeDefaults),world:'forest'},services:[]};
  const values=new Map(Object.entries({...universeDefaults,world:'dunes'}));
  const form={}, nodes={'#universe-editor-form':form,'#universe-selected':{},'#universe-library':{}};
  const context={state,document:{addEventListener(){}},dialog:{querySelector:key=>nodes[key]},structuredClone,
    escapeHtml:String,icon:()=>'',formField:(label,glyph,input)=>label+input,
    dialogHeader:()=>'',dialogFooter:()=>'',showDialog:value=>{html=value;},
    FormData:class {get(key){return values.get(key);}has(key){return values.get(key)===true;}}};
  const ui=vm.runInNewContext(await fs.readFile(new URL('../web/universe-ui.js',import.meta.url),'utf8')+'\nUniverseUI;',context);
  ui.open();
  assert.match(html,/name="world"/); assert.match(html,/value="forest" selected/);
  assert.match(html,/Space objects/); assert.match(html,/These switches apply to the Space world/);
  const draft=ui.readDraft(); assert.equal(draft.world,'dunes'); assert.equal(draft.revision,1);
  assert.equal(state.universe.world,'forest');
});
