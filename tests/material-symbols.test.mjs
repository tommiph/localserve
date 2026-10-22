/** No installed settings or devices: inspect local assets and pure renderers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {glyphs, validateValue} from '../server/plugin-schema.mjs';
import catalogue from '../assets/material-symbols/catalog.json' with {type:'json'};

test('Material catalogue covers bundled static font and old saved glyph identities', async () => {
  assert.ok(glyphs.length > 4000);
  const font=await fs.readFile(new URL('../assets/material-symbols/material-symbols-outlined.ttf',import.meta.url));
  const tables=[];
  for(let i=0;i<font.readUInt16BE(4);i++)tables.push(font.toString('ascii',12+i*16,16+i*16));
  assert.ok(tables.includes('cmap')); assert.ok(!tables.includes('fvar'),'No variable-font requirement on old Tizen');
  // Compatibility glyph catalogue. Any missing alias can make an
  // otherwise valid saved configuration, Card or Controls page fail to load.
  const previousGlyphs = [
    'plug','puzzle-piece','flask','robot','microchip','gear','gears','cubes','cube','code','terminal','bolt',
    'lightbulb','sun','moon','house','server','network-wired','wifi','satellite-dish','tower-broadcast',
    'sliders','toggle-on','clock','hourglass-half','calendar','bell','comment','clipboard-list','list-check',
    'chart-line','gauge','heart','star','shield-halved','key','lock','eye','circle-check','plane',
    'triangle-exclamation','palette','wand-magic-sparkles','gamepad','display','vr-cardboard',
    'power-off','right-left','arrow-up','arrow-down','arrow-left','arrow-right','arrow-rotate-left',
    'chevron-up','chevron-down','chevron-left','chevron-right',
    'bars','xmark','volume-high','volume-low','volume-xmark','plus','minus','circle-info','play','pause',
    'stop','temperature-half','table-cells-large',
  ];
  for(const id of previousGlyphs) {
    assert.ok(catalogue[id]);
    assert.doesNotThrow(()=>validateValue({id:'icon',type:'string',format:'glyph'},id));
  }
  const css=await fs.readFile(new URL('../assets/material-symbols/material-symbols.css',import.meta.url),'utf8');
  assert.doesNotMatch(css,/https?:\/\/|fontawesome|fa-solid/);
  for(const [id,item] of Object.entries(catalogue)) {
    assert.match(id,/^[a-z][a-z0-9-]{0,63}$/);
    assert.ok(css.includes(`.ms-${id}::before { content: "\\${item.codepoint}"; }`),id);
  }
});

test('administrator, remotes, Vista and legacy renderers use only Material assets', async () => {
  for(const file of ['web/index.html','web/vista.html','web/controls.html','web/universe.html']) {
    const html=await fs.readFile(new URL('../'+file,import.meta.url),'utf8');
    assert.match(html,/assets\/material-symbols\/material-symbols\.css/);
    assert.doesNotMatch(html,/fontawesome|fa-solid/);
  }
  const context=vm.createContext({});
  vm.runInContext(await fs.readFile(new URL('../web/controls-renderer.js',import.meta.url),'utf8')+'\nglobalThis.renderer=ControlsRenderer;',context);
  assert.match(context.renderer.icon('plug'),/material-symbol ms-plug/);
  for(const file of ['web/card-renderer.js','assets/vista-legacy.js']) {
    assert.doesNotMatch(await fs.readFile(new URL('../'+file,import.meta.url),'utf8'),/fa-solid/);
  }
});

test('all administrator dropdowns share the same final style without changing widths', async () => {
  const css=await fs.readFile(new URL('../styles.css',import.meta.url),'utf8');
  assert.match(css,/\.app-shell select, #editor-dialog select, \.controls-viewer select \{[^}]*min-height:40px;[^}]*border-radius:6px;[^}]*background:var\(--surface\)/);
  const builder=await fs.readFile(new URL('../tools/distribution/build.mjs',import.meta.url),'utf8');
  assert.match(builder,/'controls','material-symbols'/); assert.doesNotMatch(builder,/fontawesome/);
});

test('installed plugin defaults use distinct Material artwork, including aliases', async () => {
  const directory=new URL('../plugins/',import.meta.url), seen=new Map();
  for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
    if(!entry.isDirectory())continue;
    let declaration;
    try {declaration=JSON.parse(await fs.readFile(new URL(entry.name+'/declaration.json',directory),'utf8'));}
    catch(error) {if(error.code==='ENOENT')continue;throw error;}
    const symbol=catalogue[declaration.icon];
    assert.ok(symbol,'Missing plugin glyph: '+declaration.id);
    assert.ok(!seen.has(symbol.codepoint),declaration.id+' shares artwork with '+seen.get(symbol.codepoint));
    seen.set(symbol.codepoint,declaration.id);
  }
  assert.ok(seen.size > 0);
});
