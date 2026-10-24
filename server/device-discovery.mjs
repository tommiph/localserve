/** Bounded, read-only discovery on an attached private IPv4 /24 segment.
 * Announcements are untrusted hints, never permission to control a device. */
import os from 'node:os';
import dns from 'node:dns/promises';
import dgram from 'node:dgram';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {isPrivateIPv4} from './network.mjs';
export const cleanText=(value,max=120)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max):'';
const numeric=ip=>ip.split('.').reduce((n,part)=>(n*256+Number(part))>>>0,0);
export function localNetworks(interfaces=os.networkInterfaces()) {
  const networks=[];
  for(const [name,entries]of Object.entries(interfaces))for(const entry of entries||[]){
    if(entry.internal||!['IPv4',4].includes(entry.family)||!isPrivateIPv4(entry.address)||!entry.netmask)continue;
    const mask=numeric(entry.netmask),inverse=(~mask)>>>0;
    if(!inverse||((inverse+1)&inverse)!==0)continue;
    const prefix=entry.address.split('.').slice(0,3).join('.'),own=numeric(entry.address),network=(own&mask)>>>0,broadcast=(network|inverse)>>>0;
    const addresses=Array.from({length:254},(_,i)=>prefix+'.'+(i+1)).filter(ip=>numeric(ip)>network&&numeric(ip)<broadcast);
    if(!addresses.length)continue;
    const id=createHash('sha256').update(name+'|'+entry.address+'|'+entry.netmask).digest('hex').slice(0,24);
    networks.push({id,name:cleanText(name,80),address:entry.address,cidr:prefix+'.0/24',netmask:entry.netmask,addresses});
  }
  return networks.slice(0,16);
}
export function macAddress(value){
  const mac=String(value||'').replaceAll('-',':').toLowerCase();
  return /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)&&!['00:00:00:00:00:00','ff:ff:ff:ff:ff:ff'].includes(mac)&&!(parseInt(mac.slice(0,2),16)&1)?mac:null;
}
export function queryPacket(name){
  const labels=name.split('.').map(label=>{const b=Buffer.from(label);if(!b.length||b.length>63)throw Error('Invalid DNS label.');return Buffer.concat([Buffer.from([b.length]),b]);});
  const header=Buffer.alloc(12);header.writeUInt16BE(1,4);
  // QU asks for a unicast response to our temporary socket; no shared mDNS
  // service or port is stopped, rebound or reconfigured.
  return Buffer.concat([header,...labels,Buffer.from([0,0,12,0x80,1])]);
}
export function dnsRecords(packet){
  if(packet.length<12||packet.length>9000)throw Error('Invalid DNS packet.');
  function name(at){let next=at,parts=[],jumped=false;const visited=new Set();
    for(let count=0;count<64;count++){
      if(at>=packet.length||visited.has(at))throw Error('Invalid DNS name.');visited.add(at);
      const size=packet[at++];
      if((size&0xc0)===0xc0){if(at>=packet.length)throw Error('Invalid DNS pointer.');const target=((size&63)<<8)|packet[at++];if(!jumped)next=at;jumped=true;at=target;continue;}
      if(size&0xc0||at+size>packet.length)throw Error('Invalid DNS label.');
      if(!size)return {value:parts.join('.'),next:jumped?next:at};
      parts.push(packet.subarray(at,at+size).toString('utf8'));at+=size;
    }throw Error('DNS name too long.');
  }
  const questions=packet.readUInt16BE(4),total=packet.readUInt16BE(6)+packet.readUInt16BE(8)+packet.readUInt16BE(10);
  if(questions>64||total>128)throw Error('DNS record limit.');let at=12;const result=[];
  for(let i=0;i<questions;i++){at=name(at).next+4;if(at>packet.length)throw Error('Truncated DNS question.');}
  for(let i=0;i<total;i++){
    const label=name(at);at=label.next;if(at+10>packet.length)throw Error('Truncated DNS record.');
    const type=packet.readUInt16BE(at),ttl=packet.readUInt32BE(at+4),length=packet.readUInt16BE(at+8);at+=10;
    const end=at+length;if(end>packet.length)throw Error('Truncated DNS data.');
    let value;
    if(type===1&&length===4)value=Array.from(packet.subarray(at,end)).join('.');
    if(type===12)value=name(at).value;
    if(type===33&&length>=7)value={port:packet.readUInt16BE(at+4),host:name(at+6).value};
    if(ttl&&value!==undefined)result.push({name:label.value,type,value});at=end;
  }
  return result;
}
export function descriptionFields(xml){
  // No XML engine, entities or external resources are evaluated.
  if(typeof xml!=='string'||xml.length>65536||/<!DOCTYPE|<!ENTITY/i.test(xml))return {};
  const value=tag=>cleanText((new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+tag+'>','i').exec(xml)?.[1]||'').replace(/<[^>]*>/g,'').replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
  return {name:value('friendlyName'),manufacturer:value('manufacturer'),model:value('modelName'),reportedType:value('deviceType')};
}
export function descriptionUrl(raw,address,network){
  try{const url=new URL(raw);return url.protocol==='http:'&&url.hostname===address&&network.addresses.includes(address)&&address!==network.address&&!url.username&&!url.password&&!url.hash&&url.href.length<=1024?url:null;}catch{return null;}
}
export function mdnsDevices(records,network){
  const rows=[];
  for(const record of records.filter(item=>item.type===33)){
    const address=records.find(item=>item.type===1&&item.name.toLowerCase()===record.value.host.toLowerCase())?.value;
    if(!network.addresses.includes(address))continue;
    const match=/\.(\_[^.]+\.\_(?:tcp|udp)\.local)$/i.exec(record.name),direct=record.peer===address;
    rows.push({address,name:cleanText(record.name.slice(0,match?.index||0)),hostname:cleanText(record.value.host),services:[match?.[1]||'mDNS'],evidence:[direct?'mDNS response':'mDNS announcement'],seen:direct});
  }
  return rows;
}
function description(url,signal){return new Promise(resolve=>{
  const request=http.get(url,{signal,timeout:1500,headers:{Accept:'text/xml, application/xml'},agent:false},response=>{
    if(response.statusCode!==200){response.resume();resolve({});return;}
    let bytes=0;const chunks=[];
    response.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536)request.destroy();else chunks.push(chunk);});
    response.on('end',()=>resolve(descriptionFields(Buffer.concat(chunks).toString('utf8'))));response.on('error',()=>resolve({}));
  });request.on('timeout',()=>request.destroy());request.on('error',()=>resolve({}));
});}
async function advertisements(network,signal){
  const mdns=[],ssdp=new Map(),warnings=[],sockets=[];
  async function socket(){signal.throwIfAborted();const socket=dgram.createSocket('udp4');sockets.push(socket);
    await new Promise((resolve,reject)=>{
      const finish=error=>{socket.removeListener('error',failed);signal.removeEventListener('abort',cancel);error?reject(error):resolve();};
      const failed=error=>finish(error),cancel=()=>finish(signal.reason);
      socket.once('error',failed);signal.addEventListener('abort',cancel,{once:true});socket.bind(0,network.address,()=>finish());
    });
    socket.on('error',()=>{});socket.setMulticastInterface(network.address);socket.setMulticastTTL(1);return socket;
  }
  const stop=()=>{for(const socket of sockets)try{socket.close();}catch{}};
  signal.addEventListener('abort',stop,{once:true});
  try{
    const udp=await socket(),discovery=await socket();
    const queried=new Set(),send=name=>{if(queried.size>=32||queried.has(name)||!name.endsWith('.local'))return;queried.add(name);udp.send(queryPacket(name),5353,'224.0.0.251',()=>{});};
    udp.on('message',(packet,peer)=>{
      if(signal.aborted||!network.addresses.includes(peer.address)||mdns.length>=1024)return;
      try{for(const record of dnsRecords(packet)){
        mdns.push({...record,peer:peer.address});
        if(record.type===12&&record.name==='_services._dns-sd._udp.local')send(record.value);
      }}catch{}
    });
    discovery.on('message',(packet,peer)=>{
      if(signal.aborted||packet.length>8192||!network.addresses.includes(peer.address)||ssdp.size>=64)return;
      const text=packet.toString('utf8');if(!/^HTTP\/1\.1 200 /i.test(text))return;
      const raw=/^location:\s*(.+)$/im.exec(text)?.[1]?.trim(),url=descriptionUrl(raw,peer.address,network);
      if(url&&!ssdp.has(peer.address))ssdp.set(peer.address,url);
    });
    for(const type of ['_services._dns-sd._udp.local','_googlecast._tcp.local','_airplay._tcp.local','_raop._tcp.local','_ipp._tcp.local','_http._tcp.local','_adb-tls-connect._tcp.local'])send(type);
    discovery.send(Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n'),1900,'239.255.255.250',()=>{});
    await new Promise(resolve=>{const timer=setTimeout(done,3200);function done(){clearTimeout(timer);signal.removeEventListener('abort',done);resolve();}signal.addEventListener('abort',done,{once:true});if(signal.aborted)done();});
  }catch{warnings.push('Local service discovery was unavailable on this adapter.');}
  finally{stop();signal.removeEventListener('abort',stop);}
  signal.throwIfAborted();const rows=mdnsDevices(mdns,network);
  // Only SRV targets with an explicit matching A record are attributed to an
  // address. A responder can announce other devices on the network.
  const descriptions=[...ssdp.entries()];
  for(let at=0;at<descriptions.length;at+=6){signal.throwIfAborted();rows.push(...await Promise.all(descriptions.slice(at,at+6).map(async([address,url])=>({address,...await description(url,signal),services:['UPnP'],evidence:['UPnP'],seen:true}))));}
  return {rows,warnings};
}
export async function windowsNeighbors(network,signal){
  if(process.platform!=='win32')return {neighbors:[],responding:[],warning:'Address sweep and neighbor information require Windows.'};
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./devices-windows.ps1',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe'],signal});
    const chunks=[];let size=0;
    const timer=setTimeout(()=>child.kill(),20000);
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({localAddress:network.address,addresses:network.addresses})+'\n');child.stderr.resume();
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>262144)child.kill();else chunks.push(chunk);});
    child.on('error',reject);child.on('close',code=>{clearTimeout(timer);if(signal.aborted)return reject(signal.reason);if(code!==0)return reject(Error('Windows discovery could not complete.'));
      try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,'')));}catch{reject(Error('Windows discovery returned invalid data.'));}});
  });
}
export function inferredType(row){
  const text=[row.reportedType,...row.services||[]].join(' ').toLowerCase();
  if(/mediarenderer|googlecast|airplay/.test(text))return 'Media device';
  if(/mediaserver/.test(text))return 'Media server';
  if(/internetgatewaydevice/.test(text))return 'Router';
  if(/printer|_ipp\./.test(text))return 'Printer';
  if(/adb-tls/.test(text))return 'Android device';
  return 'Unknown';
}
export async function discoverNetwork(network,{signal,progress=()=>{},neighbors=windowsNeighbors,advertise=advertisements,reverse=dns.reverse}={}){
  const rows=new Map(),warnings=[];
  function add(raw){
    if(!network.addresses.includes(raw.address))return;
    let row=rows.get(raw.address);if(!row){row={address:raw.address,mac:null,name:'',hostname:'',manufacturer:'',model:'',reportedType:'',services:[],evidence:[],seen:false};rows.set(raw.address,row);}
    for(const key of ['name','hostname','manufacturer','model','reportedType'])if(raw[key])row[key]=cleanText(raw[key]);
    if(macAddress(raw.mac))row.mac=macAddress(raw.mac);
    row.seen ||= Boolean(raw.seen);
    row.services=[...new Set([...row.services,...raw.services||[]])].slice(0,16).map(value=>cleanText(value));
    row.evidence=[...new Set([...row.evidence,...raw.evidence||[]])].slice(0,8);
  }
  progress('Checking addresses and advertised services');
  const [local,services]=await Promise.allSettled([neighbors(network,signal),advertise(network,signal)]);signal.throwIfAborted();
  if(local.status==='fulfilled'){
    for(const ip of local.value.responding||[])add({address:ip,seen:true,evidence:['Ping reply']});
    for(const item of local.value.neighbors||[])if(macAddress(item.mac))add({...item,evidence:['Windows neighbor cache']});
    if(local.value.warning)warnings.push(local.value.warning);
  }else warnings.push('Windows address discovery was unavailable.');
  if(services.status==='fulfilled'){for(const row of services.value.rows)add(row);warnings.push(...services.value.warnings);}else warnings.push('Advertised service discovery was unavailable.');
  add({address:network.address,name:os.hostname(),seen:true,evidence:['This server']});
  progress('Resolving device names');
  const values=[...rows.values()];
  for(let at=0;at<Math.min(values.length,128);at+=8){signal.throwIfAborted();await Promise.all(values.slice(at,at+8).map(async row=>{
    if(row.hostname)return;let timer;
    try{const names=await Promise.race([reverse(row.address),new Promise(resolve=>{timer=setTimeout(()=>resolve([]),600);})]);if(names?.[0]){row.hostname=cleanText(names[0]);row.evidence.push('Reverse DNS');}}
    catch{}finally{clearTimeout(timer);}
  }));}
  signal.throwIfAborted();return {rows:values,warnings};
}
