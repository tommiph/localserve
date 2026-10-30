/** Regenerate package-owned themed assets without reading private data. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {cardThemes,themedDesign} from './themed-designs.mjs';
const root=path.resolve(import.meta.dirname,'../..');let count=0;
const staging=process.argv.includes('--stage');if(staging)await fs.mkdir(path.join(root,'work/themed-stage/declarations'),{recursive:true});
for(const folder of await fs.readdir(path.join(root,'plugins'),{withFileTypes:true})){
 if(!folder.isDirectory())continue;const file=path.join(root,'plugins',folder.name,'declaration.json'),plugin=JSON.parse(await fs.readFile(file,'utf8'));
 const kept=(plugin.cardTemplates||[]).filter(template=>!cardThemes.some(([theme])=>template.id==='theme-'+theme));
 for(const [theme]of cardThemes){const design=themedDesign(plugin,theme),directory=path.join(root,'plugins',folder.name,design.metadata.directory);await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'card.html'),design.html+'\n');await fs.writeFile(path.join(directory,'card.css'),design.css+'\n');if(plugin.id==='movies'){await fs.mkdir(path.join(directory,'assets'),{recursive:true});await fs.copyFile(path.join(root,'plugins/movies/cards/daily-movies/assets/tmdb.svg'),path.join(directory,'assets/tmdb.svg'));}kept.push(design.metadata);count++;}
 plugin.cardTemplates=kept;await fs.writeFile(staging?path.join(root,'work/themed-stage/declarations',plugin.id+'.json'):file,JSON.stringify(plugin,null,2)+'\n');
}
console.log(JSON.stringify({generated:count,themes:cardThemes.length,privateDataRead:false}));
