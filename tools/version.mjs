/** Software versions and a public change ledger are independent of user data.
 * Each completed change advances only the components whose source changed. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const encode=value=>JSON.stringify(value,null,2)+'\n';
const valid=value=>/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);

export function nextVersion(version,level='patch') {
  if(!valid(version)||!['major','minor','patch'].includes(level))throw Error('Use major.minor.patch and a major, minor or patch increment.');
  const numbers=version.split('.').map(Number),index=['major','minor','patch'].indexOf(level);
  numbers[index]++;for(let i=index+1;i<3;i++)numbers[i]=0;
  if(!numbers.every(Number.isSafeInteger))throw Error('Version number exceeds the supported range.');
  return numbers.join('.');
}

async function components(root) {
  const records=[{target:'server',file:path.join(root,'package.json')}];
  for(const folder of await fs.readdir(path.join(root,'plugins'),{withFileTypes:true})){
    if(!folder.isDirectory())continue;
    const file=path.join(root,'plugins',folder.name,'declaration.json');
    let declaration;try{declaration=await read(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(!/^[a-z][a-z0-9-]{0,63}$/.test(declaration.id)||declaration.id==='server')throw Error('Invalid plugin identity: '+folder.name);
    records.push({target:declaration.id,file});
  }
  if(new Set(records.map(record=>record.target)).size!==records.length)throw Error('Duplicate component identity.');
  for(const record of records){record.metadata=await read(record.file);if(!valid(record.metadata.version))throw Error('Invalid version: '+record.target);}
  return records;
}

export async function initializeVersions(root) {
  const records=await components(root);
  const baseline=Object.fromEntries(records.map(record=>[record.target,record.metadata.version]));
  await fs.writeFile(path.join(root,'VERSION-HISTORY.json'),encode({schemaVersion:1,baseline,changes:[]}),{flag:'wx'});
}

function trackedVersion(history,target) {
  return history.changes.findLast(change=>change.component===target)?.version??history.baseline[target];
}

export async function checkVersions(root) {
  const history=await read(path.join(root,'VERSION-HISTORY.json'));
  if(history.schemaVersion!==1||!history.baseline||!Array.isArray(history.changes))throw Error('Invalid version history.');
  const records=await components(root);
  for(const record of records)if(trackedVersion(history,record.target)!==record.metadata.version)throw Error('Version history does not match '+record.target+'. Use the version command to record changes.');
  return Object.fromEntries(records.map(record=>[record.target,record.metadata.version]));
}

export async function bumpVersion(root,target,level,summary) {
  if(typeof summary!=='string'||!summary.trim()||summary.trim().length>240)throw Error('Provide a public change summary of 1–240 characters, without private data.');
  const records=await components(root),record=records.find(record=>record.target===target);
  if(!record)throw Error('Unknown component. Use server or an installed plugin ID.');
  const file=path.join(root,'VERSION-HISTORY.json'),history=await read(file);
  if(history.schemaVersion!==1||!history.baseline||!Array.isArray(history.changes))throw Error('Invalid version history.');
  const previous=trackedVersion(history,target),version=level==='register'?record.metadata.version:nextVersion(record.metadata.version,level);
  if(level==='register'?previous!==undefined:previous!==record.metadata.version)throw Error('The component version and history must agree before an increment; register is for new components only.');
  history.changes.push({date:new Date().toISOString(),component:target,from:previous??null,version,summary:summary.trim()});
  if(level!=='register')await fs.writeFile(record.file,encode({...record.metadata,version}));
  await fs.writeFile(file,encode(history));
  return {component:target,version};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=fileURLToPath(new URL('../',import.meta.url));
  try{
    const [target,level,summary]=process.argv.slice(2);
    if(target==='--init'){await initializeVersions(root);console.log('Version baseline recorded.');}
    else if(target==='--check')console.log(JSON.stringify(await checkVersions(root),null,2));
    else console.log(JSON.stringify(await bumpVersion(root,target,level,summary)));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
