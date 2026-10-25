/** Palette checks use disposable settings and documents, never live preferences. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {themeCatalogue,validateColorThemes,displayPalette} from '../server/color-themes.mjs';
import {selectorFixture} from './fixtures/scene-selector.mjs';

test('theme examples are isolated copies and arbitrary style values are rejected',()=>{
  const original={},themes=themeCatalogue(original);assert.equal(themes.length,3);assert.deepEqual(original,{});
  themes[0].colors.text='#000000';assert.notEqual(themeCatalogue({})[0].colors.text,'#000000');
  for(const value of [null,{},Array(13).fill(themes[0]),[{...themes[0],colors:{...themes[0].colors,accent:'url(https://invalid.example)'}}],[{...themes[0],id:'../theme'}]])assert.throws(()=>validateColorThemes({colorThemes:value}));
  validateColorThemes({colorThemes:[],adminColorTheme:'',displayColorTheme:''});
  assert.throws(()=>validateColorThemes({displayColorTheme:'missing'}));
  assert.throws(()=>validateColorThemes({colorThemes:[{...themes[0],enabled:false}],adminColorTheme:themes[0].id}));
  assert.equal(displayPalette({adminColorTheme:'forest'}),null);
  assert.deepEqual(Object.keys(displayPalette({displayColorTheme:'forest'})).sort(),['colors','mode']);
});

test('palette saving persists independently, remains admin guarded and projects only display colors',async t=>{
  const f=await selectorFixture();t.after(()=>f.close());
  const before=JSON.stringify(f.app.config.snapshot()),snapshot=f.app.snapshot();
  assert.equal(snapshot.config.colorThemes.length,3);assert.equal(JSON.stringify(f.app.config.snapshot()),before);
  const post=(body,token=snapshot.token)=>fetch(f.app.origin+'/api/config',{method:'POST',headers:{Origin:f.app.origin,'Content-Type':'application/json','X-Localserve-Token':token},body:JSON.stringify(body)});
  assert.equal((await post({adminColorTheme:'forest'},'bad')).status,403);
  assert.equal((await post({adminColorTheme:'forest'})).status,200);
  let view=await fetch(f.app.origin+'/api/control-room').then(r=>r.json());assert.equal(view.options.colorTheme,null);
  const custom={...themeCatalogue({})[2],id:'my-theme',name:'Private theme label'};
  assert.equal((await post({colorThemes:[custom],adminColorTheme:'',displayColorTheme:custom.id,displayTheme:'light'})).status,200);
  view=await fetch(f.app.origin+'/api/control-room').then(r=>r.json());assert.equal(view.options.colorTheme.colors.canvas,custom.colors.canvas);
  assert.doesNotMatch(JSON.stringify(view),/Private theme label|my-theme|adminColorTheme|colorThemes/);
  const disk=JSON.parse(await fs.readFile(new URL('file:///'+f.root.replaceAll('\\','/')+'/config.json')));assert.equal(disk.displayColorTheme,custom.id);
  assert.equal((await post({colorThemes:[],displayColorTheme:custom.id})).status,400);
  assert.equal((await post({colorThemes:[],displayColorTheme:''})).status,200);
  assert.equal((await fetch(f.app.origin+'/color-themes.js')).status,200);
});

test('browser palettes clear owned overrides, retain nodes on repeated reads and support literal TV colors',async()=>{
  const nodes=new Map(),properties=new Map(),attributes=new Map(),head={appendChild(node){nodes.set(node.id,node);node.parentNode={removeChild(child){nodes.delete(child.id);}};}};
  const doc={documentElement:{style:{setProperty:(k,v)=>properties.set(k,v),removeProperty:k=>properties.delete(k)},setAttribute:(k,v)=>attributes.set(k,v),removeAttribute:k=>attributes.delete(k)},head,getElementById:id=>nodes.get(id),createElement:()=>({})};
  const context=vm.createContext({window:{}});vm.runInContext(await fs.readFile(new URL('../web/color-themes.js',import.meta.url),'utf8'),context);
  const ui=context.window.ColorThemes,palette=displayPalette({displayColorTheme:'sand'});ui.apply(doc,palette);
  assert.equal(properties.get('--canvas'),palette.colors.canvas);assert.equal(attributes.get('data-theme'),'light');
  assert.match(nodes.get('palette-legacy').textContent,/body\.legacy-vista/);const node=nodes.get('palette-legacy');ui.apply(doc,palette);assert.equal(nodes.get('palette-legacy'),node);
  assert.ok(ui.contrast(properties.get('--accent-contrast'),palette.colors.accent)>=4.5);
  ui.apply(doc,null);assert.equal(properties.size,0);assert.equal(nodes.size,0);assert.equal(attributes.has('data-color-theme'),false);
  ui.apply(doc,{colors:{canvas:'</style>'}});assert.equal(properties.size,0);
});
