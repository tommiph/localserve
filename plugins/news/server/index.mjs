/** Localserve runtime API v1 for read-only Google News RSS polling.
 * Import, configuration validation, and start never initiate network requests.
 */
import sax from '../vendor/sax/lib/sax.js';

const maximumResponseBytes = 512 * 1024;
const requestTimeoutMs = 15000;
const maximumArticles = 10;

export function feedUrl(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (!input || input.length > 2000 || /[\u0000-\u001f\u007f]/u.test(input)) return null;
  try {
    const url = new URL(input);
    // Accept Google-generated RSS searches, topics, sections, and the main feed.
    // Keep all supplied parameters; never reinterpret q or apply global codes.
    // Restrict the provider so editable feeds cannot become arbitrary requests.
    if (url.protocol !== 'https:' || url.hostname !== 'news.google.com'
      || url.username || url.password || url.port || url.hash
      || !(url.pathname === '/rss' || url.pathname.startsWith('/rss/'))
      || url.pathname.startsWith('/rss/articles/')) return null;
    return input;
  } catch { return null; }
}

function configuration(settings) {
  if (!Array.isArray(settings?.searches) || settings.searches.length > 20) return null;
  const searches = settings.searches.filter(search => search.enabled);
  if (!searches.length || searches.some(search => !feedUrl(search.query))) return null;
  // Each query stores a complete feed URL. The shared named-source scheduler
  // uses this key in its polling signature and stable source identity.
  return { searches: searches.map(search => ({ ...search, query: feedUrl(search.query) })) };
}

function plainText(value, maximum) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/gu, ' ').trim();
  // HTML descriptions are ignored altogether. These XML text fields are only
  // rendered by the shared escaping renderer, never interpreted as markup.
  if (!text || /[\u0000-\u001f\u007f]/u.test(text)) return null;
  return text.slice(0, maximum);
}

function articleLink(value) {
  if (typeof value !== 'string' || value.length > 1200) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.hostname === 'news.google.com'
      && !url.username && !url.password && !url.port
      && url.pathname.startsWith('/rss/articles/') ? url.href : null;
  } catch { return null; }
}

function publicationTime(value) {
  // RSS publication dates carry an explicit zone. Never fill a missing date
  // from reception time or let Date.parse assume the server's local zone.
  if (!/^(?:[A-Za-z]{3},\s*)?\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{2}:\d{2}(?::\d{2})?\s+(?:GMT|UTC|[+-]\d{4})$/i.test(value || '')) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

export function parseNews(xml, query, receivedAt = Date.now()) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml, 'utf8') > maximumResponseBytes) {
    throw new Error('Google News response exceeds 512 KiB or is not XML.');
  }
  const parser = sax.parser(true, { strictEntities: true });
  const path = [];
  const articles = [];
  const seenLinks = new Set();
  let item = null;
  let feedTitle = null;
  let channelSeen = false;
  let itemCount = 0;
  let captured = '';
  let capturedKey = null;
  parser.onerror = () => { throw new Error('Google News returned invalid RSS XML.'); };
  // SAX does not fetch external entities. Reject DTDs anyway: the only accepted
  // document is a bounded RSS channel with predefined XML entities/CDATA.
  parser.ondoctype = () => { throw new Error('Google News RSS must not contain a DTD.'); };
  parser.onopentag = node => {
    if (capturedKey) throw new Error('Google News RSS text fields must not contain nested markup.');
    path.push(node.name);
    if (path.length > 32) throw new Error('Google News RSS nesting exceeds its limit.');
    if (path.length === 1 && (node.name !== 'rss' || node.attributes.version !== '2.0')) {
      throw new Error('Google News did not return RSS 2.0.');
    }
    if (path.join('/') === 'rss/channel') channelSeen = true;
    if (path.join('/') === 'rss/channel/item') { item = {}; itemCount += 1; }
    if (path.join('/') === 'rss/channel/title'
      || (path.length === 4 && path[2] === 'item' && ['title', 'source', 'link', 'pubDate'].includes(node.name))) {
      capturedKey = node.name;
      captured = '';
    }
  };
  const captureText = value => {
    if (capturedKey) captured += value;
    if (captured.length > 16000) throw new Error('Google News RSS field exceeds its limit.');
  };
  parser.ontext = captureText;
  parser.oncdata = captureText;
  parser.onclosetag = name => {
    if (capturedKey === name) {
      if (path.length === 3) feedTitle = plainText(captured, 300);
      else if (item) item[name] = captured;
      capturedKey = null;
      captured = '';
    }
    if (path.join('/') === 'rss/channel/item') {
      const title = plainText(item.title, 300);
      const link = articleLink(item.link);
      if (title && link && !seenLinks.has(link) && articles.length < maximumArticles) {
        seenLinks.add(link);
        articles.push({ title, link, publisher: plainText(item.source, 100), publishedAt: publicationTime(item.pubDate?.trim()) });
      }
      item = null;
    }
    path.pop();
  };
  parser.write(xml).close();
  if (!channelSeen || !feedTitle || (itemCount && !articles.length)) {
    throw new Error('Google News did not return a valid news channel.');
  }
  // Scalar declarations let the existing Card designer/Vistas projection expose
  // selected positions only. No raw XML, descriptions, images, or private item
  // arrays enter state. Feed order is retained; it is not a newest-first promise.
  let parameters;
  try { parameters = new URL(query).searchParams; } catch { parameters = new URLSearchParams(); }
  const reading = { 'requested-query': query, 'feed-title': feedTitle,
    'feed-language': parameters.get('hl'), 'feed-country': parameters.get('gl'),
    'feed-edition': parameters.get('ceid'), 'article-count': articles.length,
    headlines: articles.length ? articles.map((article, index) => `${index + 1}. ${article.title}${article.publisher ? ` (${article.publisher})` : ''}`).join('\n') : 'No articles found.',
    'updated-at': receivedAt };
  for (let index = 1; index <= maximumArticles; index += 1) {
    const article = articles[index - 1];
    reading[`article-${index}-title`] = article?.title ?? null;
    reading[`article-${index}-publisher`] = article?.publisher ?? null;
    reading[`article-${index}-link`] = article?.link ?? null;
    reading[`article-${index}-published-at`] = article?.publishedAt ?? null;
  }
  return reading;
}

async function readXml(response) {
  if (!response.body) throw new Error('Google News returned an empty response.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { complete = true; break; }
      size += value.byteLength;
      if (size > maximumResponseBytes) throw new Error('Google News response exceeds 512 KiB.');
      chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function fetchNews(query, signal, fetchImpl) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error('Google News request timed out after 15 seconds.')), requestTimeoutMs);
  const requestSignal = AbortSignal.any([signal, timeout.signal]);
  try {
    const response = await fetchImpl(query, {
      headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'Localserve-News/1.0' },
      redirect: 'error', signal: requestSignal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Google News request failed (HTTP ${response.status}).`);
    }
    const xml = await readXml(response);
    requestSignal.throwIfAborted();
    return parseNews(xml, query, Date.now());
  } catch (error) {
    if (requestSignal.aborted) throw requestSignal.reason;
    throw error;
  } finally {
    // This is a wall-time network deadline, including pause. Shared host gates
    // still wait for resume before committing the reading and announcing it.
    clearTimeout(timer);
  }
}

export function createNewsAdapter({ fetchImpl = (...args) => fetch(...args) } = {}) {
  let configured = null;
  let allSearchIds = new Set();
  return {
    validateConfiguration(settings) { return configuration(settings) !== null; },
    async start(settings) {
      configured = configuration(settings);
      if (!configured) throw new Error('Add and enable a valid search in News Settings.');
      allSearchIds = new Set(settings.searches.map(search => search.id));
    },
    async stop() {
      // The server cancels and drains work before stopping/reconfiguring.
      configured = null;
      allSearchIds.clear();
    },
    async execute(actionId, parameters, context) {
      context.signal.throwIfAborted();
      if (actionId !== 'refresh') throw new Error('Unknown News action.');
      if (!configured) throw new Error('News is not configured.');
      const id = parameters['search-id'] || (configured.searches.length === 1 ? configured.searches[0].id : null);
      const search = configured.searches.find(search => search.id === id);
      if (!search) throw new Error('Choose an enabled News search.');
      let reading;
      try {
        reading = await fetchNews(search.query, context.signal, fetchImpl);
      } catch (error) {
        // Failures preserve this target's successful data. Cancellation has
        // revoked host services, so it must not attempt even a warning write.
        if (!context.signal.aborted) await context.log(`News refresh failed for ${search.name}: ${error.message}`, 'warning');
        throw error;
      }
      context.signal.throwIfAborted();
      const state = await context.readState();
      const retained = Object.fromEntries(Object.entries(state.searches || {}).filter(([key]) => allSearchIds.has(key)));
      retained[search.id] = reading;
      // Commit first, then log/emit. These are separate operations; a crash
      // can lose an occurrence. Restart never replays a saved refresh/event.
      await context.saveState({ searches: retained });
      await context.log(`News refreshed for ${search.name}: ${reading['article-count']} articles.`, 'success');
      const payload = { 'search-id': search.id, 'search-name': search.name,
        query: search.query, 'article-count': reading['article-count'] };
      if (reading['article-1-title'] !== null) payload['first-title'] = reading['article-1-title'];
      await context.emit('news-updated', payload);
      return { completed: true };
    },
  };
}

export default createNewsAdapter();
