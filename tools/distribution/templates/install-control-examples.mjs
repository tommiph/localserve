/** Install disabled example pages only into empty Controls stores. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateDeclaration} from '../server/plugins.mjs';
import {validateControlPage} from '../server/controls.mjs';
import {JsonStore} from '../server/storage.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
if(await fs.stat(path.join(root,'data/server.lock')).catch(()=>null))throw Error('Stop this Localserve server before installing examples.');
for(const id of ['samsung-tv','tradfri']){
  const declaration=validateDeclaration(JSON.parse(await fs.readFile(path.join(root,'plugins',id,'declaration.json'))));
  const example=JSON.parse(await fs.readFile(path.join(root,'examples/controls',id+'.json')));
  const page=validateControlPage(example,declaration);
  const store=await new JsonStore(path.join(root,'plugins',id,'data/controls.json'),{schemaVersion:1,pages:[]}).load();
  if(!Array.isArray(store.snapshot().pages)||store.snapshot().pages.length){console.log(id+': existing Controls preserved; example not installed.');continue;}
  await store.update(current=>{if(current.schemaVersion!==1||current.pages.length)throw Error('Controls store is not empty.');current.pages.push(page);});
  console.log(id+': disabled example installed. Configure the plugin before enabling the page.');
}
