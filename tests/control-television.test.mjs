/** Presentation tests only; no TV connection or command is used. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { televisionRole } from '../server/control-television.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { validateControlPage } from '../server/controls.mjs';

test('TV roles follow saved mappings, not editable labels or private app arguments', () => {
  const item = {kind:'button',label:'Not Up',steps:[{actionId:'key',parameters:{key:'KEY_UP'}}]};
  assert.equal(televisionRole(item),'up');
  item.steps[0].parameters.key='KEY_POWER'; assert.equal(televisionRole(item),'power');
  item.steps[0].parameters.key='KEY_POWEROFF'; assert.equal(televisionRole(item),'off');
  item.steps[0].parameters.key='KEY_UNKNOWN'; assert.equal(televisionRole(item),'other');
  item.steps[0]={actionId:'launch-app',parameters:{id:'PRIVATE',arguments:'SECRET'}};
  assert.equal(televisionRole(item),'app');
  item.steps.push({actionId:'key',parameters:{key:'KEY_HOME'}});assert.equal(televisionRole(item),'other');
  item.kind='scene'; assert.equal(televisionRole(item),'scene');
});
test('TV presentation requires plugin opt-in and preserves original mapped controls', async () => {
  const raw=JSON.parse(await fs.readFile(new URL('../plugins/samsung-tv/declaration.json',import.meta.url)));
  const plugin=validateDeclaration(raw);assert.equal(plugin.controls.television,true);
  const page={schemaVersion:1,name:'Remote',slug:'remote',enabled:false,icon:'display',columns:3,items:[],presentation:'television'};
  assert.equal(validateControlPage(page,plugin).presentation,'television');
  delete raw.controls.television;
  assert.throws(()=>validateControlPage(page,validateDeclaration(raw)),/available/);
  assert.equal(validateControlPage({...page,presentation:'mapped'},validateDeclaration(raw)).presentation,'mapped');
});
test('TV renderer escapes labels, preserves DOM on readings and disables busy/unavailable commands', async () => {
  const context=vm.createContext({document:{activeElement:null}});
  vm.runInContext(await fs.readFile(new URL('../web/controls-renderer.js',import.meta.url),'utf8'),context);
  vm.runInContext(await fs.readFile(new URL('../web/television-controls.js',import.meta.url),'utf8')+';globalThis.tv=TelevisionControls;',context);
  const button={dataset:{controlItem:'app'},disabled:false}, host={dataset:{},querySelector:()=>null,querySelectorAll:selector=>selector==='[data-control-item],[data-control-input]'?[button]:[]};
  let builds=0,markup='';Object.defineProperty(host,'innerHTML',{set:value=>{builds++;markup=value;}});
  const snapshot={page:{id:'p',revision:1,pluginName:'Samsung TV',items:[{id:'app',label:'<img onerror="bad">',kind:'button',icon:'display',remoteRole:'app',available:true,reported:null}]},available:true,busy:false};
  context.tv.tab='apps';context.tv.mount(host,snapshot);
  assert.doesNotMatch(markup,/<img/);assert.match(markup,/&lt;img/);assert.equal(button.disabled,false);
  snapshot.busy=true;context.tv.mount(host,snapshot);assert.equal(button.disabled,true);assert.equal(builds,1);
  snapshot.busy=false;snapshot.available=false;context.tv.mount(host,snapshot);assert.equal(button.disabled,true);
  assert.doesNotMatch(markup,/parameters|PRIVATE|SECRET/);
});
