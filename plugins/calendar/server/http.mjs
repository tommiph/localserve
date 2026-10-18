/** Subscription reads never follow links or redirects. Public DNS answers are
 * checked together and the selected address is pinned for the actual socket. */
import https from 'node:https';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';

export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return a > 0 && a < 224 && ![10,127].includes(a)
      && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254)
      && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && [0,168].includes(b))
      && !(a === 192 && b === 88 && c === 99) && !(a === 198 && ([18,19].includes(b) || b === 51 && c === 100))
      && !(a === 203 && b === 0 && c === 113);
  }
  return isIP(address) === 6 && /^[23][a-f\d]{3}:/i.test(address)
    && !/^2001:(?:0{1,4}|0?db8|0{0,3}2|0{0,2}[12]0):/i.test(address) && !/^2002:/i.test(address);
}

export function subscriptionUrl(value) {
  if (typeof value !== 'string' || value.length > 2000 || /[\u0000-\u0020\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value.replace(/^webcal:/i,'https:'));
    const host = url.hostname.replace(/^\[|\]$/g,'');
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
      || host === 'localhost' || host.endsWith('.localhost') || !host.includes('.') && !isIP(host)
      || isIP(host) && !publicAddress(host)) return null;
    return url.href;
  } catch { return null; }
}

export async function readSubscription(value, signal, { lookup = dns.lookup, request = https.request } = {}) {
  const normalized = subscriptionUrl(value);
  if (!normalized) throw new Error('Enter a public HTTPS calendar subscription URL.');
  const url = new URL(normalized), host = url.hostname.replace(/^\[|\]$/g,'');
  const deadline = AbortSignal.any([signal,AbortSignal.timeout(15000)]);
  let onAbort;
  const aborted = new Promise((resolve,reject) => {
    onAbort = () => reject(deadline.reason);
    deadline.addEventListener('abort',onAbort,{once:true});
    if (deadline.aborted) onAbort();
  });
  try {
    const addresses = isIP(host) ? [{address:host,family:isIP(host)}]
      : await Promise.race([lookup(host,{all:true,verbatim:true}),aborted]);
    deadline.throwIfAborted();
    if (!addresses.length || addresses.some(row => !publicAddress(row.address))) throw new Error('Calendar address is not public.');
    const pinned = addresses[0];
    return await Promise.race([new Promise((resolve,reject) => {
      const req = request(url,{method:'GET',agent:false,signal:deadline,
        lookup(hostname,options,callback) { options.all ? callback(null,[pinned]) : callback(null,pinned.address,pinned.family); },
        headers:{Accept:'text/calendar, text/plain','Accept-Encoding':'identity','User-Agent':'Localserve-Calendar/1.0'}},response => {
        const fail = message => { response.destroy(); reject(new Error(message)); };
        if (response.statusCode !== 200) { fail('Calendar feed could not be read. Check its final subscription URL and access.'); return; }
        if (!/^(text\/calendar|text\/plain|application\/octet-stream)(?:;|$)/i.test(response.headers['content-type'] || '')
          || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
          fail('Calendar feed must return uncompressed iCalendar text.'); return;
        }
        if (Number(response.headers['content-length']) > 1048576) { fail('Calendar feed exceeds 1 MiB.'); return; }
        const chunks = [];
        let size = 0;
        response.on('error',() => reject(new Error('Calendar feed was interrupted.')));
        response.on('data',chunk => {
          size += chunk.length;
          if (size > 1048576) fail('Calendar feed exceeds 1 MiB.');
          else chunks.push(chunk);
        });
        response.on('end',() => {
          try { deadline.throwIfAborted(); resolve(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))); }
          catch { reject(new Error('Calendar feed is not valid UTF-8 text.')); }
        });
      });
      req.on('error',() => reject(new Error('Calendar feed connection failed.')));
      req.end();
    }),aborted]);
  } finally { deadline.removeEventListener('abort',onAbort); }
}
