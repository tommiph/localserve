/** Localserve public-channel upload monitoring through YouTube Data API v3.
 * Import/validation/start are offline. Shared named-source polling owns timers. */
import { createClient, channelFilter, validKey, validVideoId, validChannelId, mapChannel, mapVideos, cleanText } from './client.mjs';
import { createHash } from 'node:crypto';

const dayMs = 86400000;
export function quotaDay(at) {
  // This provider quota day is independent of the user's display timezone.
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
}
export function effectiveInterval(settings) {
  const active = settings.channels.filter(channel=>channel.enabled).length;
  return Math.max(settings['poll-minutes']*60000,Math.ceil(Math.max(active,1)*2*dayMs/1500));
}
function configuration(settings) {
  if (!validKey(settings?.['api-key']) || typeof settings['api-paused'] !== 'boolean'
    || ![15,30,60,120,240].includes(settings['poll-minutes']) || !Array.isArray(settings.channels) || settings.channels.length>20
    || settings.channels.some(channel=>!channel || typeof channel.query!=='string' || typeof channel.enabled!=='boolean'
      || channel.enabled && !channelFilter(channel.query))) return null;
  return structuredClone(settings);
}
function presentBudget(state, configured, now) {
  const budget = state.budget?.day === quotaDay(now) ? state.budget : {day:quotaDay(now),reads:0,searches:0};
  for (const channel of configured.channels) {
    const reading = state.channels[channel.id];
    if (reading) Object.assign(reading,{'api-paused':configured['api-paused'],'budget-reads':budget.reads,'budget-searches':budget.searches,
      'budget-read-limit':2000,'budget-search-limit':20,'effective-minutes':Math.ceil(effectiveInterval(configured)/60000),
      'blocked-until':state.blockedUntil || null,'api-state':configured['api-paused']?'Paused':state.blockedUntil>now?'Temporarily blocked':'Active',
      'next-check':configured['api-paused']?null:Math.max(reading.nextCheck || 0,state.blockedUntil || 0) || null,'last-error':reading.error || null});
  }
}
function putVideos(reading,videos) {
  const selected=videos.slice(0,10);
  reading['video-count']=selected.length;
  Object.assign(reading,{'latest-id':selected[0]?.id || null,'latest-title':selected[0]?.title || null,'latest-url':selected[0]?.url || null,'latest-published':selected[0]?.at || null});
  for (let index=0;index<10;index++) {
    const video=selected[index];
    for (const [key,value] of Object.entries({title:video?.title,id:video?.id,url:video?.url,published:video?.at,duration:video?.duration})) reading[`video-${index+1}-${key}`]=value ?? null;
  }
}

export function createYouTubeAdapter({client=createClient(),now=Date.now}={}) {
  let configured=null,startedAt=0;
  return {
    validateConfiguration(settings){return configuration(settings)!==null;},
    async start(settings){configured=configuration(settings);if(!configured)throw new Error('Add a valid YouTube API key and Channel settings.');startedAt=now();},
    async stop(){configured=null;startedAt=0;},
    async execute(actionId,parameters,context){
      context.signal.throwIfAborted();
      if (!configured) throw new Error('YouTube is not configured.');
      if (!['refresh','lookup-channel'].includes(actionId)) throw new Error('Unknown YouTube action.');
      const lookup = actionId === 'lookup-channel';
      const id=parameters['source-id'] || (configured.channels.filter(channel=>channel.enabled).length===1 ? configured.channels.find(channel=>channel.enabled).id : null);
      const target=lookup ? null : configured.channels.find(channel=>channel.enabled&&channel.id===id);
      if (!lookup && !target) throw new Error('Choose an enabled YouTube Channel.');
      const state=await context.readState();
      state.channels=Object.fromEntries(Object.entries(state.channels || {}).filter(([id])=>configured.channels.some(channel=>channel.id===id)));
      const fingerprint=createHash('sha256').update(configured['api-key']).digest('hex');
      if(state.keyFingerprint!==fingerprint){
        // A corrected key can clear provider error blocks, but never reclaims
        // locally reserved quota or erases movement/event claims.
        state.keyFingerprint=fingerprint;state.blockedUntil=null;
        for(const reading of Object.values(state.channels)){reading.nextCheck=0;reading.error='';}
      }
      // Discovery belongs to Settings and never needs or modifies a monitored
      // Channel. Changing a monitored identity clears its old public readings.
      const previous=target && state.channels[target.id]?.query===target.query ? state.channels[target.id] : target ? {query:target.query} : {};
      if (target) state.channels[target.id]=previous;
      if (configured['api-paused']) {
        presentBudget(state,configured,now());await context.saveState(state);
        if (actionId==='lookup-channel') throw new Error('YouTube API calls are paused. Resume them in Settings.');
        return {skipped:'API calls paused'};
      }
      const interval=effectiveInterval(configured);
      if (!lookup && previous.query===target.query && previous.nextCheck>now()) return {skipped:'Next scheduled check is not due'};
      if (state.blockedUntil>now()) throw new Error('YouTube API calls are temporarily blocked. See Current values for the end time.');
      const signal=AbortSignal.any([context.signal,AbortSignal.timeout(20000)]);
      async function persist(){
        signal.throwIfAborted();presentBudget(state,configured,now());await context.saveState(state);signal.throwIfAborted();
      }
      async function api(method,parameters){
        signal.throwIfAborted();
        if(state.budget?.day!==quotaDay(now())) state.budget={day:quotaDay(now()),reads:0,searches:0};
        const kind=method==='search'?'searches':'reads',limit=kind==='searches'?20:2000;
        if(!Number.isInteger(state.budget[kind])||state.budget[kind]<0||state.budget[kind]>=limit) throw new Error('Localserve daily YouTube request budget is used. Wait for the next Pacific quota day.');
        // Reserve before transmitting, including failures. Worker restart cannot
        // reclaim uncertain requests or repeat them using the old budget.
        state.budget[kind]++;
        if (target) state.channels[target.id] ||= {query:target.query};
        await persist();
        return client.request(method,parameters,configured['api-key'],signal);
      }
      try{
        if(actionId==='lookup-channel'){
          const query=parameters.query?.trim();
          if(!query || query.length>200 || /[\u0000-\u001f\u007f]/u.test(query)) throw new Error('Enter a channel name, @handle, ID or supported channel URL.');
          const filter=channelFilter(query);
          if(!filter && /^https?:\/\//i.test(query)) throw new Error('Use a supported HTTPS youtube.com channel URL.');
          const data=await api(filter?'channels':'search',filter?{part:'snippet,contentDetails',...filter}:{part:'snippet',type:'channel',q:query,maxResults:5});
          const matches=data.items.map(item=>filter?mapChannel(item):mapChannel({...item,id:item.id?.channelId})).filter(Boolean).slice(0,5);
          await persist();
          await context.log(`Channel lookup returned ${matches.length} matches.`,'success');
          // Only bounded public choices return to this administrator request.
          // No setup result enters Cards, event rules or another Channel's state.
          return {completed:true,query,count:matches.length,matches:matches.map(({id,name,handle})=>({id,name,handle}))};
        }
        let channel;
        const filter=channelFilter(target.query);
        const sameQuery=previous.query===target.query && validChannelId(previous['channel-id'])
          && (!filter.id || filter.id===previous['channel-id']) && /^UU[A-Za-z0-9_-]{22}$/.test(previous.uploads || '');
        // Metadata is cached for one day. New targets/changed identifiers resolve
        // explicitly; expensive name search is never part of automatic polling.
        if(sameQuery && previous.metadataAt>now()-dayMs) channel={id:previous['channel-id'],name:previous['channel-name'],handle:previous['channel-handle'],uploads:previous.uploads,
          subscribers:previous.subscribers,videos:previous['total-videos'],views:previous.views};
        else{
          const data=await api('channels',{part:'snippet,contentDetails,statistics',...filter});
          if(data.items.length!==1) throw new Error('YouTube channel was not uniquely found. Use Lookup channel to choose its exact ID.');
          channel=mapChannel(data.items[0]);
          if(!channel?.uploads) throw new Error('The YouTube channel has no public uploads playlist.');
          if(filter.id && channel.id!==filter.id)throw new Error('YouTube returned an unexpected channel identity.');
        }
        const playlist=await api('playlistItems',{part:'contentDetails',playlistId:channel.uploads,maxResults:50});
        if(playlist.items.some(item=>!validVideoId(item.contentDetails?.videoId))) throw new Error('YouTube returned an invalid video identity.');
        const ids=[...new Set(playlist.items.map(item=>item.contentDetails?.videoId).filter(validVideoId))];
        const batch=ids.length ? await api('videos',{part:'snippet,status,contentDetails',id:ids.join(',')}) : {items:[]};
        const videos=mapVideos(batch.items,channel.id,now());
        const received=now(),baseline=sameQuery && Number.isFinite(previous['received-at']);
        const seen=new Map(baseline && Array.isArray(previous.claims) ? previous.claims.filter(claim=>validVideoId(claim.id)&&Number.isFinite(claim.at)&&claim.at>received-2*dayMs).map(claim=>[claim.id,claim.at]) : []);
        const cutoff=Math.max(previous['received-at'] || received,startedAt,received-interval);
        const fresh=baseline ? videos.filter(video=>video.at>cutoff && !seen.has(video.id)).sort((left,right)=>left.at-right.at) : [];
        for(const video of videos)seen.set(video.id,received);
        const reading={...previous,query:target.query,'channel-id':channel.id,'channel-name':channel.name,'channel-handle':channel.handle,
          uploads:channel.uploads,metadataAt:sameQuery&&previous.metadataAt>received-dayMs?previous.metadataAt:received,
          subscribers:channel.subscribers,'total-videos':channel.videos,views:channel.views,
          'received-at':received,'videos-limited':Boolean(playlist.nextPageToken)||videos.length>10,
          nextCheck:received+interval,claims:[...seen].slice(-300).map(([id,at])=>({id,at})),failures:0,error:''};
        putVideos(reading,videos);state.channels[target.id]=reading;
        // Release claims and public data commit before Tasks can run. First
        // readings seed a baseline; startup/pause gaps never replay old effects.
        await persist();
        await context.log(`YouTube refreshed for ${target.name}: ${reading['video-count']} displayed public videos, ${fresh.length} new releases.`,'success');
        for(const video of fresh){
          signal.throwIfAborted();
          await context.emit('video-released',{'source-id':target.id,'source-name':target.name,'channel-id':channel.id,'channel-name':channel.name,
            'video-id':video.id,title:video.title,url:video.url,'published-at':video.at,
            ...(video.duration !== null ? {duration:video.duration} : {}),'release-id':`${channel.id}:${video.id}`});
        }
        await context.emit('videos-updated',{'source-id':target.id,'source-name':target.name,'channel-id':channel.id,'channel-name':channel.name,'video-count':reading['video-count']});
        return {completed:true,releases:fresh.length};
      }catch(error){
        context.signal.throwIfAborted();
        // Late/deadline/cancelled reads never commit a reading or an event.
        // Reservations already committed remain spent; successful data survives.
        if(signal.aborted) throw new Error('YouTube request exceeded its 20-second deadline. Previous readings retained.');
        if(error.block)state.blockedUntil=now()+(error.block==='quota'?dayMs:6*60*60*1000);
        if (lookup) {
          await persist();
          await context.log(`YouTube channel lookup failed: ${cleanText(error.message,300)}`,'warning');
          throw error;
        }
        const retained=state.channels[target.id] || {...previous};
        retained.error=cleanText(error.message,300);
        if(actionId==='refresh'){
          retained.failures=(Number.isInteger(previous.failures)?previous.failures:0)+1;
          retained.nextCheck=now()+Math.min(6*60*60*1000,interval*2**Math.min(retained.failures-1,5));
        }
        state.channels[target.id]=retained;await persist();
        await context.log(`YouTube ${actionId==='refresh'?'refresh':'lookup'} failed for ${target.name}: ${retained.error}`,'warning');
        throw new Error(retained.error);
      }
    },
  };
}

export default createYouTubeAdapter();
