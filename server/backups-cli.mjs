/** Offline maintenance entry point, also used by Setup before replacing source. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Backups} from './backups.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const command=process.argv[2];
if(!['--before-update','--cancel-restore'].includes(command)||process.argv.length!==3)throw Error('Use --before-update or --cancel-restore with the server stopped.');
const lock=path.join(root,'data/server.lock');let handle;
try{
  handle=await fs.open(lock,'wx');
  const {version}=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
  const backups=await new Backups(root,version).load();
  if(command==='--cancel-restore')await backups.cancel();
  else if(backups.settings.snapshot().beforeUpdates)await backups.create('before-update');
  console.log(JSON.stringify({ok:true,operation:command}));
}finally{if(handle){await handle.close();await fs.rm(lock);}}
