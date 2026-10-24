/** Pure schema fixtures: no private values, providers or installed definitions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const snapshot={services:[{id:'example',name:'Example',folder:'example',
  config:{settings:{token:'NEVER_SHOW'}},pluginState:{value:'NEVER_SHOW'},
  events:[{id:'changed',name:'Changed',payload:[{id:'title',label:'Title',type:'string'},{id:'secret',type:'string',format:'secret'}]}],
  cardCatalog:[{id:'source:reading',label:'Reading',type:'number'},{id:'source:table',label:'Table',type:'table',columns:[{id:'date',label:'Date',type:'timestamp'}]}],
  cardFields:[{id:'reading',label:'Reading declaration',type:'number'}],
  cardTemplates:[{name:'Design',directory:'cards/design',entry:'index.html',slots:[{id:'value',field:'reading',format:'number'}]}]}],
  taskEvents:[{id:'plugin:example:event:changed:source',pluginId:'example',eventId:'changed',name:'Source · Changed',payload:[{id:'title',label:'Title',type:'string',required:true},{id:'flag',label:'Flag',type:'boolean'},{id:'secret',type:'string',format:'secret'}]}],
  taskActions:[{id:'log',name:'Log activity',type:'log',defaults:{message:''},parameters:[{id:'message',type:'string'}]},
    {id:'plugin:example:act',pluginId:'example',name:'Action',parameters:[{id:'text',label:'Text',type:'string'},{id:'token',type:'string',format:'secret'}]}]};
const ctx=vm.createContext({state:snapshot,TaskUI:{ruleTypes:{schedule:'Schedule',event:'Event'}},document:{addEventListener(){}},
  escapeHtml:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),icon:()=>''});
vm.runInContext(await fs.readFile(new URL('../web/variables-ui.js',import.meta.url),'utf8')+'\nglobalThis.reference=VariablesUI;',ctx);

test('reference uses declared public schemas only and keeps scoped Event identity',()=>{
  const rows=ctx.reference.records(snapshot), serialized=JSON.stringify(rows);
  assert.doesNotMatch(serialized,/NEVER_SHOW|event\.secret|"token"/);
  const field=rows.find(row=>row.code==='{{event.title}}');
  assert.equal(field.example.starts[0].eventId,'plugin:example:event:changed:source');
  assert.equal(field.example.steps[0].message,'{{event.title}}');
  assert.match(field.file,/data\/tasks.json/);
  assert.ok(rows.some(row=>row.code==='{{event.flag}}' && /Optional/.test(row.help)));
  assert.ok(rows.some(row=>row.kind==='card' && row.code==='source:reading'));
  assert.ok(rows.some(row=>row.kind==='column' && row.example.listOptions.columns[0]==='date'));
  assert.ok(rows.some(row=>row.kind==='slot' && row.example.field==='reading'));
  assert.equal(rows[0].owner,'server');
});

test('new and removed fields appear immediately; unconfigured declarations invent no rule ID',()=>{
  const altered=structuredClone(snapshot);altered.taskEvents=[];
  altered.services[0].cardCatalog=[{id:'new-value',label:'New',type:'number'}];
  const rows=ctx.reference.records(altered);
  assert.ok(rows.some(row=>row.code==='new-value'));
  assert.ok(!rows.some(row=>row.code==='source:reading'));
  const declared=rows.find(row=>row.code==='{{event.title}}');
  assert.match(declared.context,/add a source/);assert.equal(declared.example.starts,undefined);
});

test('a live image marker is a fixed design contract rather than a free-text tag or URL',()=>{
  const altered=structuredClone(snapshot);altered.services[0].cardTemplates[0].preview=true;
  const row=ctx.reference.records(altered).find(row=>row.code==='data-card-preview');
  assert.equal(row.type,'image');assert.match(row.help,/no URL or Task substitution/);
  assert.equal(row.example.runtime.preview,'jpeg-v1');assert.doesNotMatch(JSON.stringify(row),/NEVER_SHOW/);
});

test('search and context filters combine, and file examples escape markup',()=>{
  Object.assign(ctx.reference,{search:'title',owner:'example',kind:'event'});
  assert.equal(ctx.reference.filtered().length,1);
  const row=ctx.reference.filtered()[0];row.label='<script>';row.example={message:'<img>'};
  const html=ctx.reference.row(row);assert.match(html,/&lt;script>/);assert.doesNotMatch(html,/<script>|<img>/);
  Object.assign(ctx.reference,{search:'',owner:'',kind:''});
});
