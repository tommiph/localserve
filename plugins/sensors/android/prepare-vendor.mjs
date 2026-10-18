/** Fetch a pinned official Maven graph once; ordinary APK builds are offline.
 * POMs and upstream digests are data only. No Gradle/plugins/global install. */
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const directory=new URL('./vendor/',import.meta.url);await fs.mkdir(directory,{recursive:true});
const selected=new Map(),seen=new Set(),records=new Map();
const queue=[['com.google.android.gms','play-services-location','21.4.0']];
const hash=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest('hex');
const value=(text,name)=>text.match(new RegExp('<'+name+'>([^<]+)</'+name+'>'))?.[1];
const higher=(a,b)=>a.localeCompare(b,undefined,{numeric:true})>0;
while(queue.length){
 const [group,id,rawVersion]=queue.shift(),version=rawVersion.replace(/^\[([^,]+)\]$/,'$1'),key=group+':'+id,coordinate=key+':'+version;
 if(!/^[\w.-]+$/.test(group)||!/^[\w.-]+$/.test(id)||!/^\d[\w.-]*$/.test(version))throw new Error('Unresolved dependency '+coordinate);
 if(seen.has(coordinate))continue;seen.add(coordinate);if(seen.size>100)throw new Error('Dependency graph too large');
 const base=(group.startsWith('androidx.')||group.startsWith('com.google.android.gms')?'https://dl.google.com/dl/android/maven2/':'https://repo.maven.apache.org/maven2/')+group.replaceAll('.','/')+'/'+id+'/'+version+'/'+id+'-'+version;
 async function get(url){const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(url+' '+response.status);const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>20000000)throw new Error('Artifact exceeds limit');return bytes;}
 const pomBytes=await get(base+'.pom'),pom=pomBytes.toString('utf8');if(/<!DOCTYPE|<!ENTITY/i.test(pom))throw new Error('Unsupported XML');
 const type=value(pom.slice(0,pom.indexOf('<dependencies>')<0?pom.length:pom.indexOf('<dependencies>')),'packaging')||'jar';
 if(!['aar','jar'].includes(type))throw new Error('Unsupported artifact '+coordinate+' '+type);
 const bytes=await get(base+'.'+type),digest=(await get(base+'.'+type+'.sha1')).toString('utf8').trim().split(/\s/)[0];
 if(digest!==hash(bytes,'sha1'))throw new Error('Upstream hash mismatch '+coordinate);
 const filename=group+'-'+id+'-'+version;
 await fs.writeFile(new URL(filename+'.pom',directory),pomBytes);await fs.writeFile(new URL(filename+'.'+type,directory),bytes);
 const licenses=[...pom.matchAll(/<license>([\s\S]*?)<\/license>/g)].map(match=>({name:value(match[1],'name'),url:value(match[1],'url')}));
 records.set(coordinate,{group,id,version,type,file:filename+'.'+type,url:base+'.'+type,sha256:hash(bytes),sha1:digest,licenses});
 if(!selected.has(key)||higher(version,selected.get(key)))selected.set(key,version);
 for(const match of pom.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)){
   const block=match[1],scope=value(block,'scope')||'compile';if(!['compile','runtime'].includes(scope)||value(block,'optional')==='true')continue;
   queue.push([value(block,'groupId'),value(block,'artifactId'),value(block,'version')]);
 }
 console.log(coordinate);
}
const artifacts=[...selected].map(([key,version])=>records.get(key+':'+version)).sort((a,b)=>a.file.localeCompare(b.file));
await fs.writeFile(new URL('lock.json',directory),JSON.stringify({root:'com.google.android.gms:play-services-location:21.4.0',artifacts},null,2)+'\n');
console.log('Pinned '+artifacts.length+' artifacts.');
await fs.mkdir(new URL('licenses/',directory),{recursive:true});
for(const [name,url] of [['Apache-2.0.txt','https://www.apache.org/licenses/LICENSE-2.0.txt'],['Android-SDK-terms.html','https://developer.android.com/studio/terms']]) {
 const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('License download failed');
 await fs.writeFile(new URL('licenses/'+name,directory),await response.text());
}
