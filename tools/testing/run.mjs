/** Run the shared public suite serially to bound durable-write contention. */
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {publicTests} from './public-tests.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const child=spawn(process.execPath,['--test','--test-concurrency=1',...publicTests],{
  cwd:root,stdio:'inherit',windowsHide:true,
});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=signal?1:(code??1);});
