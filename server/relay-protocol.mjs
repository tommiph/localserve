/** Signed HTTPS relay messages carry data and scoped shortcut identities only.
 * No administrator credential or LAN capability is sent to the cloud. */
import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
export const relayId=/^[a-z][a-z0-9-]{0,31}$/;
export const relayKey=/^[a-f0-9]{64}$/;
export const relayUuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function relayUrl(value){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.hostname!=='script.google.com'||url.port||url.username||url.password||url.search||url.hash||!/^\/macros\/s\/[A-Za-z0-9_-]{16,256}\/exec$/.test(url.pathname))throw Error('Use the deployed Apps Script HTTPS /exec URL.');
  return url.href;
}
export function relaySignature(value,key){return createHmac('sha256',key).update([value.v,value.clientId,value.op,value.at,value.nonce,value.payload].join('\n')).digest('hex');}
export function signRelay(clientId,key,op,payload,at=Date.now(),nonce=randomUUID()){
  if(!relayId.test(clientId)||!relayKey.test(key)||!/^[a-z-]{1,24}$/.test(op)||!relayUuid.test(nonce))throw Error('Invalid relay credential or request.');
  const message={v:1,clientId,op,at,nonce,payload:Buffer.from(JSON.stringify(payload)).toString('base64')};message.signature=relaySignature(message,key);return message;
}
export function readRelay(value,key,{clientId,op,nonce,now=Date.now(),maxBytes=196608}={}){
  if(!value||value.v!==1||value.clientId!==clientId||value.op!==op||value.nonce!==nonce||!Number.isSafeInteger(value.at)||Math.abs(now-value.at)>120000
    ||typeof value.payload!=='string'||value.payload.length>Math.ceil(maxBytes*4/3)||value.payload.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.payload)||!relayKey.test(value.signature||''))throw Error('Relay response is invalid or expired.');
  const expected=relaySignature(value,key);if(!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(value.signature,'hex')))throw Error('Relay response authentication failed.');
  const bytes=Buffer.from(value.payload,'base64');if(bytes.length>maxBytes)throw Error('Relay response exceeds its limit.');return JSON.parse(bytes.toString('utf8'));
}
async function boundedJson(response){
  const reader=response.body?.getReader();if(!reader)throw Error('Relay returned no data.');const chunks=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>280000)throw Error('Relay response exceeds its limit.');chunks.push(Buffer.from(part.value));}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  finally{await reader.cancel().catch(()=>{});}
}
export function relayClient(url,clientId,key,{fetcher=fetch,now=Date.now}={}){
  url=relayUrl(url);if(!relayKey.test(key)||!relayId.test(clientId))throw Error('Enter relay credentials.');
  return async(op,payload,signal)=>{
    const signed=signRelay(clientId,key,op,payload,now()),deadline=AbortSignal.any([signal,AbortSignal.timeout(18000)]);
    try{
      let response=await fetcher(url,{method:'POST',redirect:'manual',signal:deadline,headers:{'Content-Type':'application/json'},body:JSON.stringify(signed)});
      // ContentService returns its result on a one-time Google content URL.
      // Never forward the signed POST body or credentials on that redirect.
      if([302,303].includes(response.status)){
        const location=new URL(response.headers.get('location')||'');await response.body?.cancel();
        if(location.protocol!=='https:'||location.hostname!=='script.googleusercontent.com'||location.port||location.username||location.password||location.hash||location.pathname!=='/macros/echo')throw Error('Unexpected relay redirect.');
        response=await fetcher(location.href,{method:'GET',redirect:'error',signal:deadline,headers:{Accept:'application/json'}});
      }
      if(!response.ok){await response.body?.cancel();throw Error('Relay HTTP request failed.');}
      const result=readRelay(await boundedJson(response),key,{clientId,op,nonce:signed.nonce,now:now()});
      if(result?.ok!==true)throw Error('Relay rejected the request. Check its configuration, permissions or quota.');
      return result;
    }catch(error){if(signal.aborted)throw signal.reason;throw Error('Relay connection failed. Check deployment, credentials and Google service availability.');}
  };
}
