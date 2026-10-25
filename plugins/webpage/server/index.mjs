/** Sormus API v1 lifecycle with named, read-only public webpages.
 * Browser embedding is direct; server polling never runs downloaded scripts.
 */
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { parse } from '../vendor/parse5/dist/index.js';

const maximumBytes = 1024 * 1024;
const maximumText = 16000;
const deadlineMs = 15000;

export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return a > 0 && a < 224 && a !== 10 && a !== 127
      && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254)
      && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && [0, 168].includes(b))
      && !(a === 192 && b === 88 && c === 99)
      && !(a === 198 && ([18, 19].includes(b) || b === 51 && c === 100))
      && !(a === 203 && b === 0 && c === 113);
  }
  // Only global unicast IPv6 is accepted. Mapped IPv4, link-local, multicast,
  // loopback, unique-local and documentation addresses are not public targets.
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address)
    && !/^2001:(?:0{1,4}|0?db8|0{0,3}2|0{0,2}[12]0):/i.test(address) && !/^2002:/i.test(address);
}

export function pageUrl(value) {
  if (typeof value !== 'string' || value.length > 2000 || /[\u0000-\u0020\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port
      || host === 'localhost' || host.endsWith('.localhost') || !host.includes('.') && !isIP(host)
      || isIP(host) && !publicAddress(host)) return null;
    return url.href.length <= 2000 ? url.href : null;
  } catch { return null; }
}

function configuration(settings) {
  if (!Array.isArray(settings?.pages) || settings.pages.length > 20) return null;
  if (settings.pages.some(page => !localPagePath(page.query) && !pageUrl(page.query))) return null;
  const pages = settings.pages.filter(page => page.enabled);
  return pages.length ? pages.map(page => ({ ...page, query: localPagePath(page.query) || pageUrl(page.query) })) : null;
}

export function localPagePath(value) {
  // This single public server route is also display-only. No other server/API
  // route, query suffix or private HTTP URL is admitted by this exception.
  if (value === '/universe' || value === '/phone-information') return value;
  // Only an explicit project display directory is local. Never reinterpret a
  // private HTTP address as a public poll target or accept traversal/URL suffixes.
  return typeof value === 'string' && value.length <= 2000
    && /^\/assets\/pages\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.html$/.test(value) ? value : null;
}

export function parsePage(html, parseText) {
  const document = parse(html);
  const excluded = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'head']);
  const blocks = new Set(['address', 'article', 'aside', 'blockquote', 'br', 'div', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'p', 'pre', 'section', 'table', 'tr']);
  let title = '';
  const parts = [];
  // An iterative traversal bounds stack usage for hostile/deep HTML. parse5
  // decodes entities without executing script or fetching linked resources.
  const stack = [{ node: document, exit: false, hidden: false }];
  while (stack.length) {
    const { node, exit, hidden } = stack.pop();
    if (exit) { if (!hidden && blocks.has(node.tagName)) parts.push('\n'); continue; }
    if (node.tagName === 'title') title ||= (node.childNodes || []).map(child => child.value || '').join('');
    const isHidden = hidden || excluded.has(node.tagName) || (node.attrs || []).some(attr =>
      attr.name === 'hidden' || attr.name === 'aria-hidden' && attr.value === 'true');
    if (parseText && node.nodeName === '#text' && !isHidden) parts.push(node.value);
    if (parseText && !isHidden && blocks.has(node.tagName)) parts.push('\n');
    stack.push({ node, exit: true, hidden: isHidden });
    for (let i = (node.childNodes || []).length - 1; i >= 0; i -= 1) {
      stack.push({ node: node.childNodes[i], exit: false, hidden: isHidden });
    }
  }
  const clean = value => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
  const text = clean(parts.join('')).replace(/[^\S\n]+/gu, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title: clean(title).replace(/\s+/gu, ' ').trim().slice(0, 300) || null,
    text: parseText ? text.slice(0, maximumText) : null,
    'text-truncated': parseText ? text.length > maximumText : null };
}

function abortedPromise(signal) {
  let listener;
  const promise = new Promise((resolve, reject) => {
    listener = () => reject(signal.reason);
    signal.addEventListener('abort', listener, { once: true });
    if (signal.aborted) listener();
  });
  return { promise, remove: () => signal.removeEventListener('abort', listener) };
}

export async function readPage(urlValue, signal, { lookup = dns.lookup, request = null } = {}) {
  const url = new URL(urlValue);
  const signalWithDeadline = AbortSignal.any([signal, AbortSignal.timeout(deadlineMs)]);
  const abort = abortedPromise(signalWithDeadline);
  try {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }]
      : await Promise.race([lookup(host, { all: true, verbatim: true }), abort.promise]);
    signalWithDeadline.throwIfAborted();
    if (!addresses.length || addresses.some(row => !publicAddress(row.address))) {
      throw new Error('The webpage resolves to a local, private or unsupported address.');
    }
    const pinned = addresses[0];
    // Validate every DNS answer and pin the connection to the checked address.
    // A second resolver call must not bypass the private-address restriction.
    return await Promise.race([new Promise((resolve, reject) => {
      const req = (request || (url.protocol === 'https:' ? https.request : http.request))(url, {
        method: 'GET', agent: false, signal: signalWithDeadline,
        lookup(hostname, options, callback) {
          if (options.all) callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        },
        headers: { Accept: 'text/html, application/xhtml+xml, text/plain', 'Accept-Encoding': 'identity', 'User-Agent': 'Localserve-Webpage/1.0' },
      }, response => {
        const chunks = [];
        let length = 0;
        const fail = error => { response.destroy(); reject(error); };
        if (response.statusCode < 200 || response.statusCode >= 300) {
          fail(new Error(response.statusCode >= 300 && response.statusCode < 400
            ? 'The webpage redirects. Configure its final URL.' : `Webpage request failed (HTTP ${response.statusCode}).`));
          return;
        }
        const contentType = response.headers['content-type'] || '';
        if (!/^(text\/html|application\/xhtml\+xml|text\/plain)(?:;|$)/i.test(contentType)) {
          fail(new Error('The webpage response is not HTML or plain text.')); return;
        }
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
          fail(new Error('The webpage ignored the uncompressed response request.')); return;
        }
        if (Number(response.headers['content-length']) > maximumBytes) {
          fail(new Error('Webpage response exceeds 1 MiB.')); return;
        }
        response.on('error', () => reject(new Error('Webpage response was interrupted.')));
        response.on('data', chunk => {
          length += chunk.length;
          if (length > maximumBytes) fail(new Error('Webpage response exceeds 1 MiB.'));
          else chunks.push(chunk);
        });
        response.on('end', () => {
          try {
            signalWithDeadline.throwIfAborted();
            const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1] || 'utf-8';
            const html = new TextDecoder(charset, { fatal: true }).decode(Buffer.concat(chunks));
            resolve({ html, bytes: length, plain: /^text\/plain/i.test(contentType) });
          } catch { reject(new Error('The webpage has an unsupported encoding or invalid text.')); }
        });
      });
      req.on('error', error => reject(signalWithDeadline.aborted ? signalWithDeadline.reason : new Error('Webpage connection failed.')));
      req.end();
    }), abort.promise]);
  } finally { abort.remove(); }
}

export async function checkTvPage(value, signal, lookup = dns.lookup) {
  const normalized = pageUrl(value);
  if (!normalized) throw new Error('Choose a public HTTP/HTTPS webpage URL.');
  const host = new URL(normalized).hostname.replace(/^\[|\]$/g, '');
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  const abort = abortedPromise(bounded);
  try {
    bounded.throwIfAborted();
    const addresses = isIP(host) ? [{address: host}]
      : await Promise.race([lookup(host, {all: true, verbatim: true}), abort.promise]);
    bounded.throwIfAborted();
    if (!addresses.length || addresses.some(row => !publicAddress(row.address))) {
      throw new Error('The webpage resolves to a local, private or unsupported address.');
    }
    // The TV loads the URL itself. This checks the initial hostname only; it
    // cannot pin the TV's DNS, inspect its frame or override site restrictions.
    return normalized;
  } finally { abort.remove(); }
}

export function createWebpageAdapter({ read = readPage, checkTv = checkTvPage, now = Date.now } = {}) {
  let pages = null;
  let ids = new Set();
  return {
    validateConfiguration(settings) { return configuration(settings) !== null; },
    async start(settings) {
      pages = configuration(settings);
      if (!pages) throw new Error('Add and enable a valid webpage in Settings.');
      ids = new Set(settings.pages.map(page => page.id));
    },
    async stop() { pages = null; ids.clear(); },
    async execute(actionId, parameters, context) {
      context.signal.throwIfAborted();
      if (!['refresh', 'open-on-tv'].includes(actionId) || !pages) throw new Error('Webpage action is unavailable.');
      const id = parameters['page-id'] || (pages.length === 1 ? pages[0].id : null);
      const page = pages.find(page => page.id === id);
      if (!page) throw new Error('Choose an enabled webpage.');
      if (actionId === 'open-on-tv') {
        if (!localPagePath(page.query)) await checkTv(page.query, context.signal);
        context.signal.throwIfAborted();
        // Only the host can reach the existing TV adapter. No TV credentials or
        // arbitrary cross-plugin execution API enter this read-only monitor.
        await context.openWebpageOnTv(page.id);
        await context.log(`Webpage sent to the TV app: ${page.name}. Delivery does not confirm display.`, 'success');
        return {completed: true, sent: true};
      }
      // Local displays are loaded by the TV, never fetched/polled by this
      // read-only adapter. No reception, parsed data or change Event is invented.
      if (localPagePath(page.query)) return {completed: true, displayOnly: true};
      let result;
      try { result = await read(page.query, context.signal); }
      catch (error) {
        if (!context.signal.aborted) await context.log(`Webpage refresh failed for ${page.name}: ${error.message}`, 'warning');
        throw error;
      }
      context.signal.throwIfAborted();
      const state = await context.readState();
      const previous = state.pages?.[id];
      const hash = createHash('sha256').update(result.html).digest('hex');
      const sameUrl = previous?.['page-url'] === page.query;
      const changed = sameUrl && typeof previous.hash === 'string' && previous.hash !== hash;
      const count = (Number.isSafeInteger(previous?.['change-count']) ? previous['change-count'] : 0) + (changed ? 1 : 0);
      const receivedAt = now();
      const parsed = result.plain ? { title: null, text: page['parse-text'] ? result.html.slice(0, maximumText) : null,
        'text-truncated': page['parse-text'] ? result.html.length > maximumText : null } : parsePage(result.html, page['parse-text']);
      const reading = { ...parsed, 'page-url': page.query, 'response-bytes': result.bytes, 'received-at': receivedAt,
        'changed-at': changed ? receivedAt : previous?.['changed-at'] ?? null, 'change-count': count, hash };
      const retained = Object.fromEntries(Object.entries(state.pages || {}).filter(([key]) => ids.has(key)));
      retained[id] = reading;
      // Persist the new hash/sequence before emission. Failure or restart never
      // replays uncertain events; a changed URL establishes its own baseline.
      await context.saveState({ pages: retained });
      await context.log(`Webpage refreshed for ${page.name}${changed ? ': Page changed' : ''}.`, 'success');
      if (changed) await context.emit('page-changed', { 'page-id': id, 'page-name': page.name, url: page.query,
        'change-id': `${id}:${count}`, 'change-count': count, ...(parsed.title ? { title: parsed.title } : {}) });
      return { completed: true, changed };
    },
  };
}

export default createWebpageAdapter();
