/** Bounded, supervised reads from the official YouTube Data API v3.
 * No scraping, redirects, OAuth/browser credentials, media or thumbnail fetches. */
export const validChannelId = value => /^UC[A-Za-z0-9_-]{22}$/.test(value || '');
export const validVideoId = value => /^[A-Za-z0-9_-]{11}$/.test(value || '');
export const validKey = value => typeof value === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(value);

// Only errors authored here can cross the transport boundary. Matching message
// prefixes on arbitrary network exceptions could accidentally expose a key.
class YouTubeReadError extends Error {}

export function channelFilter(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  let query = value.trim();
  if (/^https?:\/\//i.test(query)) {
    try {
      const url = new URL(query);
      if (url.protocol !== 'https:' || !['youtube.com','www.youtube.com','m.youtube.com'].includes(url.hostname)
        || url.username || url.password || url.port || url.hash || url.search) return null;
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts.length === 2 && parts[0] === 'channel') query = parts[1];
      else if (parts.length === 2 && parts[0] === 'user' && /^[A-Za-z0-9_-]{1,100}$/.test(parts[1])) return { forUsername: parts[1] };
      else if (parts.length === 1) query = parts[0];
      else return null;
    } catch { return null; }
  }
  if (validChannelId(query)) return { id: query };
  // Handles are passed as data to Google's fixed endpoint, never as a hostname.
  if (/^@[^\s/?#%:]{1,100}$/u.test(query)) return { forHandle: query };
  return null;
}

export function cleanText(value, maximum = 300) {
  if (typeof value !== 'string') return null;
  return value.replace(/[\u0000-\u001f\u007f]/gu,' ').trim().slice(0,maximum) || null;
}
export function count(value) {
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
export function durationSeconds(value) {
  const match = typeof value === 'string' && value.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match || !match.slice(1).some(value => value !== undefined)) return null;
  return count(Number(match[1] || 0)*86400 + Number(match[2] || 0)*3600 + Number(match[3] || 0)*60 + Number(match[4] || 0));
}

async function boundedJson(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) throw new YouTubeReadError('YouTube returned an empty response.');
  const chunks = []; let bytes = 0, complete = false;
  try {
    while (true) {
      signal.throwIfAborted();
      const result = await reader.read();
      if (result.done) { complete = true; break; }
      bytes += result.value.byteLength;
      if (bytes > 512*1024) throw new YouTubeReadError('YouTube response exceeds 512 KiB.');
      chunks.push(result.value);
    }
    const text = new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
    return JSON.parse(text);
  } catch (error) {
    signal.throwIfAborted();
    if (bytes > 512*1024) throw error;
    throw new YouTubeReadError('YouTube returned unreadable JSON.');
  } finally {
    if (!complete) await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}

export function createClient({ fetchImpl = (...args) => fetch(...args) } = {}) {
  return {
    async request(method, parameters, key, signal) {
      if (!['channels','playlistItems','videos','search'].includes(method) || !validKey(key)) throw new Error('YouTube request is not configured.');
      const url = new URL('https://www.googleapis.com/youtube/v3/'+method);
      for (const [name,value] of Object.entries(parameters)) url.searchParams.set(name,String(value));
      try {
        const response = await fetchImpl(url,{method:'GET',headers:{Accept:'application/json','X-Goog-Api-Key':key},redirect:'error',signal});
        const data = await boundedJson(response,signal);
        signal.throwIfAborted();
        if (!response.ok) {
          const reason = data?.error?.errors?.[0]?.reason;
          const error = new YouTubeReadError([400,401,403].includes(response.status) ? 'YouTube rejected the request. Check the API key, restrictions and enabled API.' : `YouTube request failed (HTTP ${response.status}).`);
          // Only allowlisted reason categories survive; Google messages and raw
          // transport errors can contain credentials or URLs and are discarded.
          error.block = /^(quotaExceeded|dailyLimitExceeded|rateLimitExceeded)$/.test(reason || '') ? 'quota'
            : response.status===401 || /^(keyInvalid|accessNotConfigured|ipRefererBlocked|forbidden)$/.test(reason || '') ? 'credentials' : null;
          throw error;
        }
        if (!Array.isArray(data.items) || data.items.length > 50) throw new YouTubeReadError('YouTube returned unexpected items.');
        return data;
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof YouTubeReadError) throw error;
        throw new Error('YouTube could not be reached. Previous successful readings are retained.');
      }
    },
  };
}

export function mapChannel(raw) {
  if (!validChannelId(raw?.id)) return null;
  const uploads = raw.contentDetails?.relatedPlaylists?.uploads;
  if (uploads !== undefined && !/^UU[A-Za-z0-9_-]{22}$/.test(uploads)) throw new Error('YouTube returned an invalid uploads playlist.');
  return { id:raw.id, name:cleanText(raw.snippet?.title,150) || raw.id, handle:cleanText(raw.snippet?.customUrl,100), uploads:uploads || null,
    subscribers:raw.statistics?.hiddenSubscriberCount === false ? count(raw.statistics.subscriberCount) : null,
    videos:count(raw.statistics?.videoCount), views:count(raw.statistics?.viewCount) };
}

export function mapVideos(items, channelId, now) {
  const seen = new Set();
  return items.flatMap(raw => {
    const published = raw.snippet?.publishedAt;
    const at = typeof published === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(published) ? Date.parse(published) : NaN;
    if (!validVideoId(raw.id) || seen.has(raw.id) || raw.snippet?.channelId !== channelId
      || raw.status?.privacyStatus !== 'public' || raw.snippet?.liveBroadcastContent !== 'none' || !Number.isFinite(at) || at > now) return [];
    const title = cleanText(raw.snippet.title);
    if (!title) return [];
    seen.add(raw.id);
    return [{id:raw.id,title,at,duration:durationSeconds(raw.contentDetails?.duration),url:'https://www.youtube.com/watch?v='+raw.id}];
  }).sort((left,right)=>right.at-left.at);
}
