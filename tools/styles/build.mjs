/** Assemble ordered stylesheet sources without transforming rules or selectors. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export async function renderStyles(root) {
  const folder=path.join(root,'web/styles'),files=JSON.parse(await fs.readFile(path.join(folder,'order.json'),'utf8'));
  if(!Array.isArray(files)||!files.length||new Set(files).size!==files.length||files.some(file=>typeof file!=='string'||!/^\d{2}-[a-z-]+\.css$/.test(file)))throw Error('Invalid stylesheet source order.');
  const css=[];
  for(const file of files){
    const target=path.join(folder,file),stat=await fs.lstat(target);
    if(!stat.isFile()||stat.isSymbolicLink())throw Error('Stylesheet sources must be ordinary files.');
    css.push(await fs.readFile(target,'utf8'));
  }
  return '/* Generated from web/styles/order.json by tools/styles/build.mjs. Edit the ordered sources. */\n'+css.join('');
}

export async function checkStyles(root) {
  const expected=await renderStyles(root),current=await fs.readFile(path.join(root,'styles.css'),'utf8');
  if(current!==expected)throw Error('styles.css is stale. Run runtime/node.exe tools/styles/build.mjs.');
  return true;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=fileURLToPath(new URL('../../',import.meta.url));
  try {
    if(process.argv.includes('--check')){await checkStyles(root);console.log('Stylesheet matches ordered sources.');}
    else {await fs.writeFile(path.join(root,'styles.css'),await renderStyles(root));console.log('Built styles.css.');}
  } catch(error){console.error(error.message);process.exitCode=1;}
}
