/** Public declarations and inert adapters only; never copy installed data. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {cardThemes,themedDesign} from '../../tools/cards/themed-designs.mjs';
export async function copyThemedPlugins(root,{assets=false}={}){
 const source=path.resolve(import.meta.dirname,'../../plugins');
 for(const entry of await fs.readdir(source,{withFileTypes:true})){
  if(!entry.isDirectory())continue;const plugin=JSON.parse(await fs.readFile(path.join(source,entry.name,'declaration.json'),'utf8'));
  plugin.cardTemplates=[...(plugin.cardTemplates||[]).filter(t=>!/^theme-(sci-fi|hacker|rustic|lcars)$/.test(t.id)),...cardThemes.map(([theme])=>themedDesign(plugin,theme).metadata)];
  const folder=path.join(root,'plugins',entry.name);await fs.mkdir(path.join(folder,'server'),{recursive:true});await fs.writeFile(path.join(folder,'declaration.json'),JSON.stringify(plugin));
  await fs.writeFile(path.join(folder,'server/index.mjs'),"export default {validateConfiguration(){return true},async start(){},async stop(){},async execute(){throw Error('No device/provider actions in this fixture')}};\n");
  if(assets)await fs.cp(path.join(source,entry.name,'cards'),path.join(folder,'cards'),{recursive:true}).catch(error=>{if(error.code!=='ENOENT')throw error;});
 }
}
