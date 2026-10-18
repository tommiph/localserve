/** Offline source contracts; no device/provider or configured state. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { defaultConfig } from '../server.mjs';
import { validateDeclaration } from '../server/plugins.mjs';
import { validateValues } from '../server/plugin-schema.mjs';
import { universeDefaults } from '../server/universe.mjs';

test('first-start defaults contain no configured targets or display selections', () => {
  assert.equal(defaultConfig.listen.host,'127.0.0.1');
  assert.equal(defaultConfig.listen.port,0); assert.equal(defaultConfig.location,null);
  assert.equal(defaultConfig.doNotDisturb.enabled,false);
  assert.deepEqual(universeDefaults.cards,[]); assert.equal(universeDefaults.world,'space');
});

test('bundled declarations validate with empty secret/list defaults', async () => {
  const plugins=new URL('../plugins/',import.meta.url);
  for(const folder of await fs.readdir(plugins,{withFileTypes:true})) {
    if(!folder.isDirectory()) continue;
    const raw=JSON.parse(await fs.readFile(new URL(folder.name+'/declaration.json',plugins),'utf8'));
    const declaration=validateDeclaration(raw);
    const values=validateValues(declaration.settings,{},true);
    assert.equal(declaration.id,folder.name);
    for(const field of declaration.settings) {
      if(field.format==='secret') assert.ok(!values[field.id]);
      if(field.type==='list') assert.deepEqual(values[field.id],[]);
    }
  }
});
