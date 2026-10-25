/** Run an explicit public test selection serially to bound write contention.
 * The no-argument entry remains the full CI/publication gate. */
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {selectTests,testHelp} from './profiles.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
let selection;
try{selection=selectTests(process.argv.slice(2));}
catch(error){console.error(error.message+'\n'+testHelp);process.exit(1);}
if(selection.help){console.log(testHelp);process.exit(0);}
console.log(`Test profile: ${selection.mode} · ${selection.files.length} ${selection.files.length===1?'file':'files'}`);
if(selection.list){console.log(selection.files.join('\n'));process.exit(0);}
const child=spawn(process.execPath,['--test','--test-concurrency=1',...selection.files],{
  cwd:root,stdio:'inherit',windowsHide:true,
});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=signal?1:(code??1);});
