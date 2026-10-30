/** File-owner recovery only: stop the server before disabling forgotten sign-in. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {AdminAccess} from './admin-access.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.argv.length!==3||process.argv[2]!=='--disable')throw Error('Stop Sormus, then use --disable to recover administrator access.');
const lock=path.join(root,'data/server.lock');let handle;
try{handle=await fs.open(lock,'wx');const access=await new AdminAccess(root).load();await access.recover();await access.close();console.log(JSON.stringify({ok:true,signInEnabled:false,sessionsRevoked:true}));}
finally{if(handle){await handle.close();await fs.rm(lock);}}
