/** Whitelist reported public scalars. Never retain media paths, network client
 * addresses, user/account IDs, stream URLs, image tokens or full API replies. */
import { createHash } from 'node:crypto';
export const digest = value => createHash('sha256').update(value).digest('hex');
const text = (value,limit) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/gu,' ').trim().slice(0,limit) || null : null;
const seconds = value => Number.isSafeInteger(value) && value >= 0 ? value/10000000 : null;

export function parseSessions(data, now) {
  if (!Array.isArray(data) || data.length > 100) throw new Error('Emby must report at most 100 sessions.');
  const seen = new Set();
  const sessions = data.map(row => {
    if (!row || typeof row.Id !== 'string' || !row.Id || row.Id.length > 256 || seen.has(row.Id)) throw new Error('Emby session identity is missing or duplicated.');
    seen.add(row.Id);
    const item = row.NowPlayingItem;
    const knownIdle = Object.hasOwn(row,'NowPlayingItem') && item === null;
    if (item !== undefined && item !== null && (typeof item !== 'object' || Array.isArray(item))) throw new Error('Invalid Emby item.');
    const itemId = typeof item?.Id === 'string' && item.Id && item.Id.length <= 256 ? digest(item.Id) : null;
    const paused = typeof row.PlayState?.IsPaused === 'boolean' ? row.PlayState.IsPaused : null;
    const state = itemId ? paused === true ? 'Paused' : paused === false ? 'Playing' : 'Unknown' : knownIdle ? 'Idle' : 'Unknown';
    const position = seconds(row.PlayState?.PositionTicks), duration = seconds(item?.RunTimeTicks);
    const progress = itemId && position !== null && duration > 0 ? Math.min(100,position/duration*100) : null;
    return {id:digest(row.Id),itemId,state,title:itemId ? text(item.Name,160) : null,
      series:itemId ? text(item.SeriesName,120) : null,type:itemId ? text(item.Type,40) : null,
      user:text(row.UserName,80),device:text(row.DeviceName,100),client:text(row.Client,80),
      position:itemId ? position : null,duration:itemId ? duration : null,progress,
      muted:itemId && typeof row.PlayState?.IsMuted === 'boolean' ? row.PlayState.IsMuted : null,
      volume:itemId && Number.isFinite(row.PlayState?.VolumeLevel) && row.PlayState.VolumeLevel >= 0 && row.PlayState.VolumeLevel <= 100 ? row.PlayState.VolumeLevel : null};
  });
  const active = sessions.filter(row => row.itemId);
  const ordered = [...sessions].sort((a,b) => Number(Boolean(b.itemId))-Number(Boolean(a.itemId)) || a.id.localeCompare(b.id));
  const reading = {'session-count':sessions.length,'active-count':active.length,'playing-count':active.filter(row => row.state === 'Playing').length,
    'paused-count':active.filter(row => row.state === 'Paused').length,'row-count':Math.min(10,sessions.length),'list-limited':sessions.length>10,'received-at':now,'poll-status':'Available'};
  const first = ordered.find(row => row.itemId);
  for (const key of ['title','series','type','user','device','client','state','position','duration','progress','muted','volume']) reading[`current-${key}`] = first?.[key] ?? null;
  if (!active.length && sessions.every(row => row.state === 'Idle')) {
    reading['current-title'] = 'Not playing';
    reading['current-state'] = 'Idle';
  }
  for (let i=0;i<10;i++) {
    for (const key of ['title','user','device','client','state','position','progress']) reading[`session-${i+1}-${key}`] = ordered[i]?.[key] ?? null;
  }
  return {sessions,reading};
}

export function playbackChanges(previous,current) {
  if (!Array.isArray(previous)) return [];
  const prior = new Map(previous.map(row => [row.id,row]));
  const changes = [];
  for (const row of current) {
    const old = prior.get(row.id);
    // Unknown data never becomes a known stop/pause transition. A new session
    // with a reported playing item is a newly observed playback, not a replay.
    if (row.itemId && (!old || old.state !== 'Unknown' && old.itemId !== row.itemId)) changes.push({id:'playback-started',row});
    else if (old?.itemId && old.itemId === row.itemId) {
      if (old.state === 'Playing' && row.state === 'Paused') changes.push({id:'playback-paused',row});
      if (old.state === 'Paused' && row.state === 'Playing') changes.push({id:'playback-resumed',row});
    }
    if (old?.itemId && row.state === 'Idle') changes.push({id:'playback-stopped',row:{...old,state:'Idle'}});
  }
  // A session disappearing does not prove that playback stopped. Only an
  // explicit idle session can produce playback-stopped in this polling adapter.
  return changes;
}
