/** One fixed public HTTPS read, with no credentials, redirects or retries. */
const maximumBytes = 1024 * 1024;
export async function readAircraft(url, signal, fetchImpl) {
  const response = await fetchImpl(url, { redirect: 'error', signal,
    headers: { Accept: 'application/json', 'User-Agent': 'Localserve-adsb.lol/1.0' } });
  if (!response.ok) {
    const raw = response.headers.get('retry-after');
    const seconds = /^\d+$/.test(raw || '') ? Number(raw) : null;
    const date = raw && seconds === null ? Date.parse(raw) : NaN;
    await response.body?.cancel();
    const error = new Error(`adsb.lol request failed (HTTP ${response.status}).`);
    error.status = response.status;
    error.retryMs = Math.min(86400000, Math.max(900000, seconds !== null ? seconds * 1000 : Number.isFinite(date) ? date - Date.now() : 900000));
    throw error;
  }
  if (!response.body) throw new Error('adsb.lol returned an empty response.');
  const reader = response.body.getReader(), chunks = [];
  let size = 0, complete = false;
  // Native fetch cancels its stream on abort. Also cancel an injected/custom
  // stream so no late completion can outlive the request's wall deadline.
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort',abort,{once:true});
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) { complete = true; break; }
      size += value.byteLength;
      if (size > maximumBytes) throw new Error('adsb.lol response exceeds 1 MiB. Reduce the area radius.');
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('adsb.lol returned invalid JSON.'); }
  } finally {
    signal.removeEventListener('abort',abort);
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
