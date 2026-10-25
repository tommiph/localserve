/** Explicit test selection. Focused runs require named files; no guessed
 * dependency graph can silently turn a partial check into release evidence. */
import {publicTests} from './public-tests.mjs';

export const coreTests=Object.freeze([
  'tests/source.test.mjs',
  'tests/network.test.mjs',
  'tests/controls.test.mjs',
  'tests/task-event-values.test.mjs',
  'tests/plugin-recovery.test.mjs',
]);
export const testScripts=Object.freeze(Object.fromEntries([
  ['test','--full'],['test:public','--full'],['test:full','--full'],
  ['test:focused','--focused'],['test:core','--core'],['test:activate','--activate'],
].map(([name,profile])=>[name,'.\\runtime\\node.exe tools/testing/run.mjs '+profile])));

export const testHelp=`Usage: runtime/node.exe tools/testing/run.mjs [profile] [tests] [--list]
  --focused <tests...>   Changed feature and shared dependency checks
  --core                Core defaults, HTTP, Controls, Task and worker guards
  --activate <tests...>  Core plus the named focused checks, without duplicates
  --full                Complete public suite (also the no-argument default)
  --list                Print the selection without running tests
  --help                Show this help
Tests may be catalogue paths or short names, for example gateway-scenes tradfri.
Focused selections are explicit; include affected callers and shared contracts.
Before publication use --full plus the existing clean-source/installer gates.
`;

export function selectTests(arguments_=[]){
  if(arguments_.length===1&&arguments_[0]==='--help')return {help:true};
  const list=arguments_.includes('--list'),args=arguments_.filter(value=>value!=='--list');
  if(arguments_.filter(value=>value==='--list').length>1)throw Error('Use --list once.');
  const mode=args.shift()||'--full';
  if(!['--focused','--core','--activate','--full'].includes(mode))throw Error('Choose --focused, --core, --activate or --full.');
  if(['--focused','--activate'].includes(mode)&&!args.length)throw Error('Name the focused tests and their shared dependencies.');
  if(['--core','--full'].includes(mode)&&args.length)throw Error('Use --focused or --activate to select test files.');
  const focused=args.map(value=>{
    const normalized=value.replaceAll('\\','/').replace(/^\.\//,'');
    const file=normalized.startsWith('tests/')?normalized:'tests/'+normalized+(normalized.endsWith('.test.mjs')?'':'.test.mjs');
    if(!publicTests.includes(file))throw Error('Unknown public test: '+value);
    return file;
  });
  if(coreTests.some(file=>!publicTests.includes(file)))throw Error('Core tests must remain in the complete public catalogue.');
  const chosen=new Set(mode==='--full'?publicTests:mode==='--core'?coreTests:mode==='--activate'?[...coreTests,...focused]:focused);
  return {mode:mode.slice(2),list,files:publicTests.filter(file=>chosen.has(file))};
}
