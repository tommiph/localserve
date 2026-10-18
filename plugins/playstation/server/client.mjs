/** Read-only Sony PSN authentication, presence and account-detail requests.
 * Fixed endpoints only; no purchases, messages, friend changes or console control.
 */
import { createHash } from 'node:crypto';
const authBase = 'https://ca.account.sony.com/api/authz/v3/oauth';
const apiBase = 'https://m.np.playstation.com/api/';
const scope = 'psn:mobile.v2.core psn:clientapp';
const redirectUri = 'com.scee.psxandroid.scecompcall://redirect';
const basic = 'Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=';
export const validNpsso = value => typeof value === 'string' && /^[A-Za-z0-9_-]{64}$/.test(value.trim());
export const credentialHash = value => createHash('sha256').update(value.trim()).digest('hex');

export function ownAccountId(tokens, previous) {
  // Decode only JWTs received directly from Sony HTTPS, never caller-supplied
  // identities. Decimal account IDs must remain strings beyond integer precision.
  for (const [token, key] of [[tokens.access_token, 'account_id'], [tokens.id_token, 'sub']]) {
    try {
      const value = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())[key];
      if (typeof value === 'string' && /^\d{1,20}$/.test(value)) return value;
    } catch {}
  }
  if (/^\d{1,20}$/.test(previous?.accountId || '')) return previous.accountId;
  throw new Error('Sony did not provide a valid account identifier.');
}
export function validSession(value) {
  return value && typeof value.accessToken === 'string' && value.accessToken.length > 0 && value.accessToken.length <= 12000
    && typeof value.refreshToken === 'string' && value.refreshToken.length > 0 && value.refreshToken.length <= 12000
    && /^\d{1,20}$/.test(value.accountId || '') && Number.isFinite(value.expiresAt)
    && typeof value.onlineId === 'string' && value.onlineId.length > 0 && value.onlineId.length <= 100;
}

async function jsonBody(response, maximum = 512 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('PSN returned an empty response.');
  const chunks = []; let bytes = 0, complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { complete = true; break; }
      bytes += value.byteLength;
      if (bytes > maximum) throw new Error('PSN response exceeds its limit.');
      chunks.push(value);
    }
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.error) throw new Error('Invalid PSN response.');
    return value;
  } catch { throw new Error('PSN returned invalid or oversized data.'); }
  finally { if (!complete) await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function createClient({ fetchImpl = fetch, now = Date.now, vault }) {
  async function request(url, options, signal, manual = false) {
    try {
      const response = await fetchImpl(url, { ...options, redirect: manual ? 'manual' : 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
      if (!manual && !response.ok) { await response.body?.cancel(); throw new Error('HTTP failure'); }
      return response;
    } catch {
      signal.throwIfAborted();
      // Provider errors may echo tokens/headers. Never log their body, URL or
      // exception text, including a failed authorization redirect.
      throw new Error('PSN request failed. Check the connection or enter a fresh NPSSO value.');
    }
  }
  async function tokens(fields, signal, previous) {
    const response = await request(authBase + '/token', { method: 'POST', headers: {
      'Content-Type': 'application/x-www-form-urlencoded', Authorization: basic,
    }, body: new URLSearchParams({ ...fields, token_format: 'jwt' }) }, signal);
    const value = await jsonBody(response, 32768);
    const expires = value.expires_in;
    if (typeof value.access_token !== 'string' || !value.access_token || value.access_token.length > 12000
      || typeof (value.refresh_token || previous?.refreshToken) !== 'string'
      || !(value.refresh_token || previous?.refreshToken) || (value.refresh_token || previous?.refreshToken).length > 12000
      || !Number.isFinite(expires) || expires <= 0 || expires > 86400) throw new Error('Sony returned an invalid session.');
    return { accessToken: value.access_token, refreshToken: value.refresh_token || previous.refreshToken,
      accountId: ownAccountId(value, previous), expiresAt: now() + expires * 1000,
      onlineId: previous?.onlineId || '', npssoHash: previous?.npssoHash || null };
  }
  async function get(auth, route, signal, devices = false) {
    if (!/^\d{1,20}$/.test(auth.accountId)) throw new Error('Invalid PSN account identifier.');
    const url = devices ? 'https://dms.api.playstation.com/api/v1/devices/accounts/me?includeFields=device,systemData&platform=PS5,PS4,PS3,PSVita'
      : apiBase + route.replaceAll('{account}', auth.accountId);
    return jsonBody(await request(url, { headers: { Authorization: 'Bearer ' + auth.accessToken } }, signal));
  }
  return {
    get,
    async connect(npsso, signal = new AbortController().signal) {
      if (!validNpsso(npsso)) throw new Error('Enter only the 64-character NPSSO value from Sony.');
      const query = new URLSearchParams({ access_type: 'offline', client_id: '09515159-7237-4370-9b40-3806e67c0891',
        redirect_uri: redirectUri, response_type: 'code', scope });
      const response = await request(authBase + '/authorize?' + query, { headers: { Cookie: 'npsso=' + npsso.trim() } }, signal, true);
      let location;
      try { location = new URL(response.headers.get('location')); } catch {}
      const code = location?.searchParams.get('code');
      await response.body?.cancel();
      if (![302, 303].includes(response.status) || location?.protocol !== 'com.scee.psxandroid.scecompcall:'
        || location.hostname !== 'redirect' || location.username || location.password
        || location.searchParams.getAll('code').length !== 1 || !code || code.length > 1024) {
        throw new Error('Sony sign-in failed. Enter a fresh NPSSO value.');
      }
      const auth = await tokens({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' }, signal);
      const profile = await get(auth, 'userProfile/v1/internal/users/{account}/profiles', signal);
      const onlineId = profile.onlineId || profile.profile?.onlineId;
      if (typeof onlineId !== 'string' || !onlineId || onlineId.length > 100) throw new Error('Sony account profile is unavailable.');
      auth.onlineId = onlineId; auth.npssoHash = credentialHash(npsso);
      signal.throwIfAborted(); await vault.save(auth, signal);
      return auth;
    },
    async authorize(saved, npsso, signal) {
      let auth = saved;
      if (validNpsso(npsso) && (!auth || auth.npssoHash !== credentialHash(npsso))) auth = await this.connect(npsso, signal);
      if (!validSession(auth)) throw new Error('Enter an NPSSO value to connect PSN.');
      if (auth.expiresAt <= now() + 60000) {
        const next = await tokens({ grant_type: 'refresh_token', refresh_token: auth.refreshToken, scope }, signal, auth);
        // Renewed credentials commit before data reads. Losing a rotated refresh
        // token must not force us to replay authentication after a later API error.
        signal.throwIfAborted(); await vault.save(next, signal); auth = next;
      }
      return auth;
    },
    async pages(auth, route, key, signal) {
      const rows = []; let offset = 0, total = null;
      for (let page = 0; page < 2; page += 1) {
        const value = await get(auth, route + (route.includes('?') ? '&' : '?') + `limit=100&offset=${offset}`, signal);
        if (!Array.isArray(value[key]) || value[key].length > 100) throw new Error('PSN returned an invalid list.');
        rows.push(...value[key]);
        if (Number.isSafeInteger(value.totalItemCount) && value.totalItemCount >= rows.length) total = value.totalItemCount;
        if (value[key].length < 100 || total !== null && rows.length >= total) return { rows, total: total ?? rows.length, truncated: false };
        const next = Number(value.nextOffset);
        if (!Number.isSafeInteger(next) || next <= offset) break;
        offset = next;
      }
      return { rows, total, truncated: total === null || rows.length < total };
    },
  };
}
