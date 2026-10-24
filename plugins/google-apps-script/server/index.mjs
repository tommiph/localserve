/** The optional relay worker owns outbound cloud polling. Host calls expose
 * only the specifically granted catalogue, receipt and message boundaries. */
import {relayClient,relayUrl,relayKey,relayId} from '../../../server/relay-protocol.mjs';
export function validRelaySettings(value){
  try{return Boolean(relayUrl(value.url)&&relayKey.test(value['collector-key'])&&Array.isArray(value.clients)&&value.clients.length<=20
    &&value.clients.every(client=>relayId.test(client['client-id'])&&client['client-id']!=='collector'&&relayKey.test(client.key)&&typeof client.enabled==='boolean'&&(!client.enabled||!client.sensors||/^android-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(client['device-id'])))&&new Set(value.clients.map(client=>client['client-id'])).size===value.clients.length);}catch{return false;}
}
export function createRelayAdapter({client=relayClient,now=Date.now}={}){
  let settings,call,failures=0,retryAt=0,published=new Map();
  return {
    validateConfiguration:validRelaySettings,
    async start(values){settings=structuredClone(values);call=client(settings.url,'collector',settings['collector-key']);failures=0;retryAt=0;published=new Map();},
    async stop(){settings=null;call=null;published.clear();},
    async execute(id,values,context){
      if(!settings||id!=='sync')throw Error('Relay is unavailable.');
      if(now()<retryAt)return {coolingDown:true};
      try{
        const snapshot=await context.cloudRelay({operation:'snapshot'});context.signal.throwIfAborted();
        // Publish changed receipts only. Rewriting every retained receipt on
        // every poll would consume the account's property-operation quota.
        const current=new Map(snapshot.receipts.map(item=>[item.clientId+'/'+item.id,JSON.stringify(item)]));
        const receipts=snapshot.receipts.filter(item=>published.get(item.clientId+'/'+item.id)!==JSON.stringify(item));
        const response=await call('sync',{...snapshot,receipts},context.signal);
        if(!Array.isArray(response.messages)||response.messages.length>20)throw Error('Invalid relay batch.');
        published=current;
        const results=[];
        for(const message of response.messages){context.signal.throwIfAborted();const result=await context.cloudRelay({operation:'receive',message});if(result.event){await context.emit('message',result.event);delete result.event;}results.push(result);}
        // The next sync publishes durable receipts before removing cloud messages.
        // One HTTP exchange per poll stays within the ordinary action deadline.
        failures=0;retryAt=0;
        await context.saveState({'last-sync':now(),'last-batch':results.length,'retry-at':0,'client-sync':response.clientSync===1});
        await context.log('Relay synchronized · '+results.length+' messages.','success');
        return {received:results.length};
      }catch(error){
        if(context.signal.aborted)throw context.signal.reason;
        failures=Math.min(failures+1,6);retryAt=now()+Math.min(1800000,30000*2**failures);
        await context.saveState({'last-sync':(await context.readState())['last-sync']||0,'last-batch':0,'retry-at':retryAt});
        throw Error('Relay synchronization failed; waiting before the next fresh poll. Check deployment, credentials and quota.');
      }
    },
  };
}
export default createRelayAdapter();
