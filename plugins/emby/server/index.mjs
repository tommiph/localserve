/** Localserve API v1 lifecycle. Only refresh performs one read; no discovery,
 * playback commands, account changes or artwork downloads. */
import { configuration, readSessions } from './client.mjs';
import { digest, parseSessions, playbackChanges } from './sessions.mjs';
export { configuration } from './client.mjs';

export function createEmbyAdapter({read = readSessions,now = Date.now} = {}) {
  let configured, startedAt;
  return {
    validateConfiguration(settings) { return configuration(settings) !== null; },
    async start(settings) {
      configured = configuration(settings);
      if (!configured) throw new Error('Enter the Emby private IPv4 server URL and its dedicated API key.');
      startedAt = now();
    },
    async stop() { configured = null; },
    async execute(actionId,parameters,context) {
      context.signal.throwIfAborted();
      if (actionId !== 'refresh' || !configured) throw new Error('Emby refresh is unavailable.');
      const state = await context.readState();
      const identity = digest(configured.url);
      const credential = digest(configured.token);
      if (state.sequence !== undefined && (!Number.isSafeInteger(state.sequence) || state.sequence < 0)
        || state.sessions !== undefined && (!Array.isArray(state.sessions) || state.sessions.length > 100)) {
        throw new Error('Emby saved transition state is invalid; original state retained.');
      }
      if (state.identity !== identity) {
        // A replacement server must not inherit the old server's media titles,
        // readings or claims, even if its first request fails.
        for (const key of Object.keys(state)) if (key !== 'sequence') delete state[key];
        state.identity = identity;
      }
      if (state.credential !== credential) {
        state.credential = credential;
        state.nextRequestAt = 0;
        state.failures = 0;
      }
      if (now() < (state.nextRequestAt || 0)) throw new Error('Emby is cooling down; wait for the next allowed refresh.');
      state['attempted-at'] = now();
      state.nextRequestAt = now()+2000;
      await context.saveState(state);
      let result;
      try {
        result = parseSessions(await read(configured,context.signal),now());
        context.signal.throwIfAborted();
      } catch (error) {
        context.signal.throwIfAborted();
        state.failures = Math.min(10,(state.failures || 0)+1);
        state.nextRequestAt = now()+Math.min(3600000,configured.minutes*60000*2**(state.failures-1));
        if ([401,403,429].includes(error.status)) state.nextRequestAt = now()+3600000;
        state['poll-status'] = 'Failed · previous successful sessions retained';
        await context.saveState(state);
        await context.log('Emby refresh failed; previous same-server readings retained.','warning');
        throw new Error('Emby sessions could not be read. Check the address, API key and server access; no request was retried.');
      }
      const recent = state['received-at'] >= Math.max(startedAt,now()-configured.minutes*120000);
      const changes = recent ? playbackChanges(state.sessions,result.sessions) : [];
      let sequence = state.sequence ?? 0;
      if (sequence > Number.MAX_SAFE_INTEGER-10) throw new Error('Emby event sequence exhausted.');
      const events = changes.slice(0,10).map(({id,row}) => {
        const payload = {'occurrence-id':`playback-${++sequence}`,state:row.state};
        for (const key of ['title','series','type','user','device','client','position','duration','progress','muted','volume']) {
          if (row[key] !== null && row[key] !== '') payload[key] = row[key];
        }
        return {id,payload};
      });
      Object.assign(state,result.reading,{sequence,sessions:result.sessions,failures:0,nextRequestAt:now()+2000});
      // Full bounded baselines commit before events, including transitions above
      // the ten-event cap. Restart/failed polls never replay skipped effects.
      await context.saveState(state);
      await context.log(`Emby refreshed: ${result.sessions.length} sessions.`,'success');
      for (const event of events) await context.emit(event.id,event.payload);
      const payload = {sessions:state['session-count'],active:state['active-count'],playing:state['playing-count'],paused:state['paused-count']};
      for (const key of ['title','state','device','user']) if (state[`current-${key}`] !== null) payload[key] = state[`current-${key}`];
      await context.emit('reading-updated',payload);
      return {completed:true};
    },
  };
}
export default createEmbyAdapter();
