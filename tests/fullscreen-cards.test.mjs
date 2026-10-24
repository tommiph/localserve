/** Full-screen designs use bounded public data and inert local assets only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {validateDeclaration} from '../server/plugins.mjs';
import {validateCard,projectCardData,cardCatalog,selectedCardData} from '../server/cards.mjs';
import {validateCardTemplates} from '../server/card-templates.mjs';
import {buildFullscreenStyles} from '../tools/cards/build-fullscreen.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const context=vm.createContext({Intl,URL,Date});
vm.runInContext(await fs.readFile(new URL('../web/card-renderer.js',import.meta.url),'utf8')+'\nglobalThis.renderer=CardRenderer;',context);
const sample=type=>type==='number'?0:type==='boolean'?false:type==='timestamp'?1791910000000:'Reported value';
const plugins=[];
for(const folder of await fs.readdir(new URL('../plugins/',import.meta.url),{withFileTypes:true}))if(folder.isDirectory()){
 const raw=JSON.parse(await fs.readFile(new URL(`../plugins/${folder.name}/declaration.json`,import.meta.url)));
 if(raw.cardTemplates?.length)plugins.push(validateDeclaration(raw));
}
test('full-screen styles are reproducible and preserve literal TV geometry',async()=>{
 assert.equal(await buildFullscreenStyles(root,{check:true}),17);
 const css=await fs.readFile(new URL('../assets/card-fullscreen.css',import.meta.url),'utf8');
 assert.match(css,/display:-webkit-flex/);assert.match(css,/background:#101c2a/);
 assert.match(css,/prefers-reduced-motion/);assert.match(css,/animation-play-state:paused/);
});
for(const plugin of plugins)test(`${plugin.name} offers a richer 1080p design without changing its compact design`,async()=>{
 const base=plugin.cardTemplates[0],full=plugin.cardTemplates.find(t=>t.id===base.id+'-fullscreen');
 assert.ok(full);assert.ok(full.slots.length>base.slots.length||full.slots.some(s=>s.type==='table'&&s.rows>(base.slots.find(b=>b.field===s.field)?.rows||0)));
 assert.equal(full.directory,base.directory);assert.equal(full.entry,'fullscreen.html');
 const settings=plugin.instances?{[plugin.instances.setting]:[{id:'selected',name:'Selected source',enabled:true},{id:'other',name:'Other source',enabled:true}]}:{};
 const state={};
 for(const f of plugin.cardFields)if(f.source.kind==='state')state[f.source.key]=sample(f.type);
 for(const f of plugin.cardFields)if(f.type==='table'){
  state[f.source.countKey]=f.source.rows.length;
  for(const row of f.source.rows)for(const c of f.columns)state[row[c.id]]=sample(c.type);
 }
 state['private-token']='PRIVATE-SENTINEL';
 const record={health:'ready',configured:true,config:{snapshot:()=>({enabled:true,settings})},log:{latest:()=>[]},state:{snapshot:()=>plugin.instances?{[plugin.instances.stateKey]:{selected:state,other:{...state,'private-token':'OTHER-SOURCE'}}}:state}};
 const card=validateCard({schemaVersion:1,layout:'readymade',templateId:full.id,sourceId:plugin.instances?'selected':'plugin',enabled:true},plugin,null,settings);
 const data=projectCardData(plugin,record,false,{now:1791910000000,location:{latitude:60,longitude:25}}),catalog=cardCatalog(plugin,settings);
 const projected=selectedCardData(card,data,catalog);
 assert.doesNotMatch(JSON.stringify(projected),/PRIVATE-SENTINEL|OTHER-SOURCE|private-token|Other source/);
 assert.equal(validateCard({...card,enabled:false},plugin,card,settings).enabled,false);
 for(const s of full.slots.filter(s=>s.type==='table')){
  const value=projected.data.values[projected.data.readyMade.bindings[s.id]];
  if(value.available){assert.ok(value.value.length<=s.rows);if(value.value.length)assert.deepEqual(Object.keys(value.value[0]),s.columns.map(c=>c.id));}
 }
 const html=await fs.readFile(new URL(`../plugins/${plugin.id}/${full.directory}/${full.entry}`,import.meta.url),'utf8');
 assert.doesNotMatch(html,/<script\b|<iframe\b|https?:\/\/|on(?:load|click|error)=|\.\.\//i);
 for(const m of html.matchAll(/data-card-(?:text|table|meter)="([a-z0-9-]+)"/g))assert.ok(['source-name','source-status',...full.slots.map(s=>s.id)].includes(m[1]),m[1]);
 const rendered=context.renderer.render(card,data,catalog,{timeFormat:'24',fontScale:100});
 assert.match(rendered,/sandbox="allow-same-origin"/);assert.doesNotMatch(rendered,/allow-scripts/);
 if(full.preview)assert.equal(plugin.runtime.preview,'jpeg-v1');
});
test('expanded ready-made bounds do not permit unbounded fields or larger ordinary Cards',()=>{
 const p=plugins.find(p=>p.id==='fingrid'),full=p.cardTemplates[1];
 const slots=Array.from({length:33},(_,i)=>({id:'slot-'+i,field:p.cardFields.find(f=>f.type==='number').id,format:'number'}));
 assert.throws(()=>validateCardTemplates([{...full,slots}],p.cardFields));
 const pc=plugins.find(p=>p.id==='pc-network');
 assert.throws(()=>validateCard({schemaVersion:1,layout:'grid',name:'Too many',enabled:true,size:'large',icon:'none',fields:Array.from({length:17},(_,i)=>({id:'f-'+i,binding:'cpu-percent',label:'CPU',enabled:true,icon:'none',format:'auto',unit:'',decimals:0}))},pc));
});

test('new Card design choice changes the draft and preview while existing Cards keep their identity',async()=>{
  const service={id:'weather',cardData:{readyMade:{templates:[
    {id:'atmosphere',name:'Atmosphere',sourceLabel:'Location'},
    {id:'atmosphere-fullscreen',name:'Atmosphere · Fullscreen',sourceLabel:'Location'}
  ],sources:[{id:'chosen',name:'Chosen location',enabled:true}]}}};
  let markup='',preview;
  const controls={sourceId:{value:'chosen'},readyTemplate:{value:'atmosphere'}};
  const form={dataset:{readyMade:'atmosphere'},elements:{namedItem:name=>controls[name]||null}};
  const ui=vm.createContext({
    state:{services:[service]},document:{addEventListener(){}},
    dialog:{open:true,querySelector:selector=>selector==='#card-editor-form'?form:{}},
    escapeHtml:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    formField:(label,glyph,control)=>`<label>${label}${control}</label>`,
    dialogHeader:(title,name)=>`<h2>${title}</h2><p>${name}</p>`,dialogFooter:label=>`<button>${label}</button>`,
    showDialog:(html,metadata)=>{markup=html;ui.dialogContext=metadata;},
    CardRenderer:{mount:(node,card)=>{preview=card;}},
  });
  vm.runInContext(await fs.readFile(new URL('../web/card-designer.js',import.meta.url),'utf8')+'\nglobalThis.designer=CardDesigner;',ui);
  ui.designer.renderCard=card=>({...card});
  ui.designer.openReadyMade(service);
  assert.match(markup,/name="readyTemplate"/);assert.match(markup,/Atmosphere · Fullscreen/);
  assert.equal(ui.designer.readDraft().enabled,false);
  controls.readyTemplate.value='atmosphere-fullscreen';ui.designer.updatePreview();
  assert.equal(ui.designer.readDraft().templateId,'atmosphere-fullscreen');assert.equal(preview.name,'Atmosphere · Fullscreen');
  assert.equal(ui.designer.readDraft().sourceId,'chosen');
  // Editing/copying a saved design offers no layout replacement field.
  delete controls.readyTemplate;
  const original={id:'saved',templateId:'atmosphere',sourceId:'chosen',name:'Existing',revision:3,enabled:true};
  for(const copy of [false,true]){
    ui.designer.openReadyMade(service,original,copy);
    assert.doesNotMatch(markup,/name="readyTemplate"/);
    assert.equal(ui.designer.readDraft().templateId,'atmosphere');
    assert.equal(ui.designer.readDraft().enabled,!copy);
  }
});
