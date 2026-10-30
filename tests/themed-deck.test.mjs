/** Animated themes use typed data and presentation-only, append-only setup. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateDeclaration} from '../server/plugins.mjs';
import {readyMadeCatalog,validateReadyMadeCard} from '../server/card-templates.mjs';
import {cardCatalog,projectCardData,selectedCardData} from '../server/cards.mjs';
import {validateVista} from '../server/vistas.mjs';
import {deckPresentation} from '../server/vista-deck.mjs';
import {createLocalserve} from '../server.mjs';
import {cardThemes,themedDesign} from '../tools/cards/themed-designs.mjs';
import {copyThemedPlugins} from './fixtures/themed.mjs';
const base=path.resolve('tests/.tmp');
function node(){return {id:'root',type:'column',name:'Canvas',enabled:true,width:'1fr',height:'1fr',children:[]};}
async function fixture(t){await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'themed-'));await copyThemedPlugins(root);const f={root,app:await createLocalserve(root,{automatic:false,backupKeyProvider:async()=>Buffer.alloc(32,7)})};t.after(async()=>{await f.app.close();assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});return f;}
test('every installed plugin has four distinct script-free, bounded, typed themed packages',async()=>{
 let count=0;for(const entry of await fs.readdir('plugins',{withFileTypes:true})){
  if(!entry.isDirectory())continue;const raw=JSON.parse(await fs.readFile('plugins/'+entry.name+'/declaration.json','utf8'));
  const designs=cardThemes.map(([theme])=>themedDesign(raw,theme));const plugin=validateDeclaration({...raw,cardTemplates:[...(raw.cardTemplates||[]).filter(t=>!t.id.startsWith('theme-')),...designs.map(d=>d.metadata)]});
  assert.ok(plugin.cardTemplates.length<=8);const hashes=new Set();for(const design of designs){count++;assert.ok(design.html.includes('data-ready-made'));assert.ok(design.html.length<256*1024&&design.css.length<256*1024);assert.doesNotMatch(design.html,/<script|\son\w+=|<iframe|https?:\/\//i);assert.match(design.css,/prefers-reduced-motion/);assert.match(design.css,/data-paused/);assert.match(design.css,/data-legacy-template/);hashes.add(design.html);const folder='plugins/'+entry.name+'/'+design.metadata.directory;assert.equal(await fs.readFile(folder+'/card.html','utf8'),design.html+'\n');assert.equal(await fs.readFile(folder+'/card.css','utf8'),design.css+'\n');for(const slot of design.metadata.slots)assert.ok((raw.cardFields||[]).some(f=>f.id===slot.field)||/^plugin-(?:status|version|health|enabled|configured)$/.test(slot.field));}assert.equal(hashes.size,4);
 }assert.equal(count,4*(await fs.readdir('plugins',{withFileTypes:true})).filter(e=>e.isDirectory()).length);
});
test('status-only services use safe common metadata; unconfigured named sources remain explicitly unavailable',async()=>{
 for(const id of ['google-apps-script','recipes','weather']){const raw=JSON.parse(await fs.readFile('plugins/'+id+'/declaration.json','utf8'));const plugin=validateDeclaration({...raw,cardTemplates:[themedDesign(raw,'sci-fi').metadata]});const config={enabled:false,settings:{'collector-key':'PRIVATE-SECRET'}},record={config:{snapshot:()=>config},state:{snapshot:()=>({secret:'PRIVATE-SECRET'})},log:{latest:()=>[]},configured:false,health:'ready'};
  if(plugin.instances)config.settings[plugin.instances.setting]=[];const before=JSON.stringify(config.settings);const catalog=readyMadeCatalog(plugin,config.settings);assert.equal(JSON.stringify(config.settings),before);assert.equal(catalog.sources.length,1);if(plugin.instances)assert.equal(catalog.sources[0].enabled,false);const card=validateReadyMadeCard({schemaVersion:1,layout:'readymade',templateId:'theme-sci-fi',sourceId:'plugin',enabled:true},plugin,null,config.settings);const projected=projectCardData(plugin,record);const view=selectedCardData(card,projected,cardCatalog(plugin,config.settings));assert.doesNotMatch(JSON.stringify(view),/PRIVATE-SECRET|collector-key/);assert.ok(!Object.values(view.data.values).some(v=>v.value===123));if(!plugin.instances)assert.equal(view.data.values['plugin-status'].value,'Configure');
 }
});
test('deck presentation is explicit and bounded without changing standard/Today validation',()=>{
 const p={type:'deck',theme:'hologram',motion:'full',spotlightSeconds:18,opacity:94};assert.deepEqual(deckPresentation(p),p);assert.equal(validateVista({schemaVersion:1,name:'Command',slug:'command',enabled:true,gap:0,padding:0,layout:node(),presentation:p}).presentation.type,'deck');
 for(const extra of [{theme:'unknown'},{motion:'flash'},{opacity:69},{spotlightSeconds:9},{url:'https://example.com'}])assert.throws(()=>deckPresentation({...p,...extra}));assert.equal(validateVista({schemaVersion:1,name:'Plain',slug:'plain',enabled:false,gap:0,padding:0,layout:node()}).presentation,undefined);
});
test('explicit themed setup appends four Cards per plugin and five Vistas, preserves prior data/display/enablement and is idempotent',async t=>{
 const f=await fixture(t);await f.app.vistas.save({schemaVersion:1,name:'Owner view',slug:'owner-view',enabled:true,gap:12,padding:12,layout:node()});const owner=f.app.vistas.snapshot()[0];await f.app.vistas.show(owner.id);await f.app.tasks.update(items=>items.push({id:randomUUID(),revision:1,name:'Owner Task',enabled:false,starts:[],steps:[]}));const oldCard=await f.app.registry.saveCard('simulator',{schemaVersion:1,layout:'readymade',templateId:'signal-lab',sourceId:'plugin',enabled:true});
 const before=f.app.snapshot(),oldFiles=Object.fromEntries(await Promise.all([...f.app.registry.records].map(async([id,r])=>[id,await fs.readFile(r.config.file,'utf8')])));
 const pack=await f.app.themePack.install(1);assert.equal(pack.status,'complete');assert.equal(pack.vistas.length,5);assert.equal(pack.cards,4*f.app.registry.records.size);assert.deepEqual(f.app.tasks.snapshot(),before.tasks);assert.deepEqual(f.app.vistas.displaySnapshot(),before.vistaDisplay);assert.deepEqual(f.app.vistas.snapshot().find(v=>v.id===owner.id),owner);assert.deepEqual(f.app.homeMap.admin(),before.homeMap);assert.equal(f.app.engine.gate.paused,before.paused);assert.equal(f.app.state.snapshot().runs.length,0);
 for(const [id,r]of f.app.registry.records)assert.equal(await fs.readFile(r.config.file,'utf8'),oldFiles[id]);assert.deepEqual(f.app.registry.cardStore('simulator').cards.snapshot().cards.find(c=>c.id===oldCard.id),oldCard);
 const total=()=>[...f.app.registry.records.values()].reduce((sum,r)=>sum+r.cards.snapshot().cards.length,0);assert.equal(total(),1+4*f.app.registry.records.size);assert.ok((await f.app.backups.collect()).files.some(file=>file.path==='data/theme-pack.json'));for(const v of pack.vistas){const view=f.app.vistas.viewer(v.url.split('/').pop());assert.equal(view.cards.length,f.app.registry.records.size);assert.equal(view.vista.presentation.type,'deck');assert.ok(view.cards.every(e=>e.card));assert.doesNotMatch(JSON.stringify(view),/collector-key|passwordHash|tokenHash/);}
 await f.app.themePack.install(pack.revision);assert.equal(total(),1+4*f.app.registry.records.size);assert.equal(f.app.vistas.snapshot().length,6);
});
test('interrupted data-only setup resumes known identities without overwriting existing Cards or duplicating Vistas',async t=>{
 const f=await fixture(t),record=f.app.registry.cardStore('pc-network'),write=record.cards.write.bind(record.cards);record.cards.write=async()=>{throw Error('simulated write failure');};await assert.rejects(f.app.themePack.install(1),/write failure/);assert.equal(f.app.themePack.snapshot().status,'installing');assert.equal(f.app.state.snapshot().runs.length,0);record.cards.write=write;
 const before=[...f.app.registry.records.values()].flatMap(r=>r.cards.snapshot().cards);assert.ok(before.length>0);await f.app.close();f.app=await createLocalserve(f.root,{automatic:false});const phase=f.app.themePack.snapshot();assert.equal(phase.status,'installing');await f.app.themePack.install(phase.revision);const after=[...f.app.registry.records.values()].flatMap(r=>r.cards.snapshot().cards);assert.equal(after.length,4*f.app.registry.records.size);for(const card of before)assert.deepEqual(after.find(c=>c.id===card.id),card);assert.equal(f.app.vistas.snapshot().length,5);
});
test('capacity preflight fails before any partial setup; the setup API retains Origin/CSRF admission',async t=>{
 const f=await fixture(t),record=f.app.registry.cardStore('simulator'),sample=await f.app.registry.saveCard('simulator',{schemaVersion:1,layout:'readymade',templateId:'signal-lab',sourceId:'plugin',enabled:true});await record.cards.update(store=>{store.cards=Array.from({length:98},(_,i)=>({...sample,id:randomUUID(),name:'Existing '+i}));});await assert.rejects(f.app.themePack.install(1),/room/);assert.equal(f.app.themePack.snapshot().status,'empty');assert.equal([...f.app.registry.records.values()].reduce((sum,r)=>sum+r.cards.snapshot().cards.length,0),98);
 for(const headers of [{Origin:'http://foreign.example','X-Localserve-Token':f.app.snapshot().token},{Origin:f.app.origin,'X-Localserve-Token':'bad'}]){const response=await fetch(f.app.origin+'/api/theme-pack',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:'{"revision":1}'});assert.equal(response.status,403);}
});
test('the shared TV compositor remains ES5 and readonly, with bounded frame slots and explicit disposal',async()=>{
 const source=await fs.readFile('web/deck-renderer.js','utf8');assert.doesNotMatch(source,/\b(?:const|let|class)\s|=>|\?\.|\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|\/api\//);assert.match(source,/i<limit/);assert.match(source,/VistaNative\.capacity/);assert.match(source,/clearInterval\(timer\)/);assert.match(source,/removeEventListener/);assert.match(source,/prefers-reduced-motion/);
});

test('TV deck dimensions do not depend on inset and themed legacy Cards have scoped literal layout fallbacks',async()=>{
 const css=await fs.readFile('web/styles/69-deck.css','utf8'),stage=/\.deck-stage\s*\{([^}]+)\}/.exec(css)[1];
 for(const [side,value]of [['top','14%'],['right','0'],['bottom','10%'],['left','0']])assert.ok(stage.includes(side+':'+value),'Explicit '+side+' anchors the absolute stage on Chromium 47.');
 assert.doesNotMatch(css,/(?:[;{]\s*)inset\s*:/);assert.match(css,/data-legacy=true\] \.deck-sky\s*\{\s*display:none/);
 const fallback=(await fs.readFile('assets/vista-legacy-ready.css','utf8')).split('/* Themed designs share a literal, margin-spaced Chromium 47 layout.')[1];assert.ok(fallback);
 assert.doesNotMatch(fallback,/var\(|clamp\(|#[a-f\d]{8}\b|(?:[;{]\s*)(?:inset|gap|row-gap|column-gap)\s*:|display:\s*grid/i);
 for(const selector of ['.theme-card header','.theme-card .hero','.theme-card .hero-value','.theme-card .metrics','.theme-card .metric','.theme-card footer'])assert.ok(fallback.includes(selector),selector+' isolates the new design from old generic rules.');
 assert.match(fallback,/-webkit-flex-direction:column/);assert.match(fallback,/margin:0 10px 0 0/);assert.match(fallback,/font-size:66px/);assert.match(fallback,/max-height:430px/);
});
