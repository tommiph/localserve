/** Topic polling uses shared named-source scheduling and durable discovery claims. */
import {createHash} from 'node:crypto';
import {providers,plain,sourceItems} from './sources.mjs';
export function createInterests({fetchImpl=(...args)=>fetch(...args),now=Date.now}={}){
  let settings=null,startedAt=0;const checked=new Set();
  const valid=value=>Boolean(value&&[15,30,60,120].includes(value['poll-minutes'])&&/^[A-Z]{2}$/.test(value['movie-region'])&&/^[a-z]{2}-[A-Z]{2}$/.test(value['movie-language'])&&Array.isArray(value.topics)&&value.topics.length<=20&&value.topics.every(topic=>providers[topic.provider]&&typeof topic.enabled==='boolean'&&[1,3,7,30].includes(topic['age-days'])));
  const words=value=>String(value||'').split(',').map(word=>word.trim().toLowerCase()).filter(Boolean).slice(0,20);
  function filtered(items,topic,at){const include=words(topic.include),exclude=words(topic.exclude),seen=new Set();return items.filter(value=>{
    const haystack=(value.title+' '+value.summary).toLowerCase();if(seen.has(value.id)||exclude.some(word=>haystack.includes(word))||include.length&&!include.some(word=>haystack.includes(word))||value.publishedAt!==null&&(value.publishedAt>at+3600000||value.publishedAt<at-topic['age-days']*86400000))return false;seen.add(value.id);return true;
  }).sort((a,b)=>(b.publishedAt||0)-(a.publishedAt||0)).slice(0,10);}
  return {
    validateConfiguration:valid,async start(value){if(!valid(value))throw Error('Check the Interests topic settings.');settings=structuredClone(value);startedAt=now();checked.clear();},async stop(){settings=null;checked.clear();},
    async execute(action,parameters,context){
      context.signal.throwIfAborted();if(action!=='refresh'||!settings)throw Error('Choose Refresh interests.');
      const topic=settings.topics.find(topic=>topic.enabled&&topic.id===parameters['topic-id']);if(!topic)throw Error('Choose an enabled interest.');
      const at=now(),state=await context.readState();
      if(state.topics!==undefined&&(!state.topics||typeof state.topics!=='object'||Array.isArray(state.topics)||Object.keys(state.topics).length>20)||state.blockedUntil!==undefined&&(!Number.isFinite(state.blockedUntil)||state.blockedUntil<0))throw Error('Saved interest state is invalid; original file retained.');
      state.topics??={};
      state.topics=Object.fromEntries(Object.entries(state.topics).filter(([id])=>settings.topics.some(topic=>topic.id===id)));
      const identityParts=[topic.provider,topic.include,topic.exclude,topic['age-days']];
      if(topic.provider==='digest')identityParts.push(settings.topics.filter(entry=>entry.enabled&&entry.provider!=='digest').map(entry=>[entry.id,entry.provider,entry.include,entry.exclude,entry['age-days']]).sort((a,b)=>a[0].localeCompare(b[0])));
      const identity=createHash('sha256').update(JSON.stringify(identityParts)).digest('hex');
      const old=state.topics[topic.id],previous=old?.identity===identity?old:{identity};
      if(previous.seen!==undefined&&(!Array.isArray(previous.seen)||previous.seen.length>500||previous.seen.some(id=>!/^\w{32}$/.test(id))))throw Error('Saved interest claims are invalid; original state retained.');
      if((previous.nextCheck||0)>at||topic.provider!=='digest'&&(state.blockedUntil||0)>at){
        // Some feeds use the literal word null for absent descriptions. Clean
        // that display placeholder without a request, new receipt or Event.
        if(previous.items?.some(value=>/^(null|undefined)$/i.test(value.summary||''))){
          const items=previous.items.map(value=>/^(null|undefined)$/i.test(value.summary||'')?{...value,summary:''}:value);
          state.topics[topic.id]={...previous,items,'lead-summary':items[0]?.summary||''};await context.saveState(state);
        }
        return {completed:true,cached:true};
      }
      const signal=AbortSignal.any([context.signal,AbortSignal.timeout(20000)]);let items;
      try{
        if(topic.provider==='digest'){
          const date=new Date(at),day=[date.getFullYear(),date.getMonth()+1,date.getDate()].join('-'),batches=[];
          for(const entry of settings.topics.filter(entry=>entry.enabled&&entry.id!==topic.id&&entry.provider!=='digest')){
            const reading=state.topics[entry.id],expected=createHash('sha256').update(JSON.stringify([entry.provider,entry.include,entry.exclude,entry['age-days']])).digest('hex');
            if(reading?.identity!==expected||reading['poll-status']!=='Ready'||at-(reading['received-at']||0)>86400000)continue;
            const values=filtered(reading.items||[],topic,at).slice(0,2);if(values.length)batches.push({values,rank:createHash('sha256').update(day+'/'+entry.id).digest('hex')});
          }
          batches.sort((a,b)=>a.rank.localeCompare(b.rank));items=[];const selected=new Set();
          // Pick one per source before taking second items. Daily source order
          // shares the ten slots when more than ten enabled topics have data.
          for(let round=0;round<2;round++)for(const batch of batches){const value=batch.values[round];if(value&&items.length<10&&!selected.has(value.id)){selected.add(value.id);items.push(value);}}
        }else{
          state.blockedUntil=at+1500;await context.saveState(state);
          items=await sourceItems(topic.provider,settings,signal,fetchImpl);
        }
        signal.throwIfAborted();items=filtered(items,topic,at);
      }catch(error){
        context.signal.throwIfAborted();const cooldown=at+(error.status===429?error.retryMs:900000);
        if(error.status===429)state.blockedUntil=cooldown;
        state.topics[topic.id]={...previous,nextCheck:cooldown,'poll-status':topic.provider==='movies'&&!settings['tmdb-token']?'Configure TMDB token':'Unavailable; cached items retained'};
        await context.saveState(state);throw Error(topic.provider==='movies'&&!settings['tmdb-token']?'Add your TMDB token to use movie releases.':'Interest source unavailable. Cached items are retained; no request was retried.');
      }
      const seen=new Set(previous.seen||[]),events=previous.seen&&checked.has(topic.id)&&topic.provider!=='digest'?items.filter(value=>!seen.has(value.id)&&(value.kind==='movie'||value.publishedAt!==null&&value.publishedAt>=startedAt)).slice(0,5):[];
      const reading={identity,items,seen:[...new Set([...seen,...items.map(value=>value.id)])].slice(-500),nextCheck:at+settings['poll-minutes']*60000,'received-at':at,'poll-status':'Ready','item-count':items.length,'topic-name':topic.name,'lead-title':items[0]?.title||'','lead-summary':items[0]?.summary||'','lead-source':items[0]?.source||'','lead-at':items[0]?.publishedAt??null};
      for(let i=0;i<10;i++)for(const [key,value]of Object.entries({title:items[i]?.title||'',source:items[i]?.source||'',at:items[i]?.publishedAt??null,url:items[i]?.url||''}))reading[`item-${i+1}-${key}`]=value;
      state.topics=Object.fromEntries(Object.entries(state.topics).filter(([id])=>settings.topics.some(topic=>topic.id===id)));state.topics[topic.id]=reading;
      await context.saveState(state);
      checked.add(topic.id);
      for(const value of events){context.signal.throwIfAborted();await context.emit('item-discovered',{'topic-id':topic.id,'topic-name':topic.name,title:value.title,summary:value.summary,source:value.source,url:value.url,'discovery-id':createHash('sha256').update(topic.id+value.id).digest('hex').slice(0,48),...(value.publishedAt!==null?{'published-at':value.publishedAt}:{})});}
      return {completed:true,count:items.length};
    },
  };
}
export default createInterests();
