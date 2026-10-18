/** Read-only Emby boundary. The one configured private IPv4 is the only target;
 * tokens travel in a header, never URLs, diagnostics, Cards or Task payloads. */
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

export function serverUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/u.test(value) || value.length > 200) return null;
  try {
    const url = new URL(value);
    const [a,b] = url.hostname.split('.').map(Number);
    const privateHost = isIP(url.hostname) === 4 && (a === 10 || a === 127 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31);
    if (!privateHost || !['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
      || !['/','/emby','/emby/'].includes(url.pathname)) return null;
    url.pathname = '/emby/Sessions';
    return url.href;
  } catch { return null; }
}

export function configuration(settings) {
  const url = serverUrl(settings?.['server-url']);
  const token = settings?.['api-key'];
  return url && typeof token === 'string' && /^[a-zA-Z\d_-]{16,256}$/.test(token)
    && [1/6,0.5,1].includes(settings['poll-minutes']) ? {url,token,minutes:settings['poll-minutes']} : null;
}

export async function readSessions(config, signal, { request } = {}) {
  const deadline = AbortSignal.any([signal,AbortSignal.timeout(15000)]);
  deadline.throwIfAborted();
  const url = new URL(config.url);
  return new Promise((resolve,reject) => {
    const req = (request || (url.protocol === 'https:' ? https.request : http.request))(url,{
      method:'GET',agent:false,signal:deadline,
      headers:{Accept:'application/json','Accept-Encoding':'identity','X-Emby-Token':config.token,'User-Agent':'Localserve-Emby/1.0'},
    },response => {
      const fail = status => {
        const error = new Error('Emby sessions could not be read.');
        error.status = status;
        response.destroy();
        reject(error);
      };
      if (response.statusCode !== 200) { fail(response.statusCode); return; }
      if (!/^application\/json(?:;|$)/i.test(response.headers['content-type'] || '')
        || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity'
        || Number(response.headers['content-length']) > 524288) { fail(); return; }
      let size = 0;
      const chunks = [];
      response.on('error',() => reject(new Error('Emby response was interrupted.')));
      response.on('data',chunk => {
        size += chunk.length;
        if (size > 524288) fail();
        else chunks.push(chunk);
      });
      response.on('end',() => {
        try { deadline.throwIfAborted(); resolve(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))); }
        catch { reject(new Error('Emby returned invalid session data.')); }
      });
    });
    req.on('error',() => reject(new Error('Emby connection failed. Check the server address and TLS certificate.')));
    req.end();
  });
}
