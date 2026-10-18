/** Localserve supervised lifecycle for read-only Sony PSN polling.
 * Offline validation/start only unlock this plugin's local session. No local
 * console probing or independent background producers are used.
 */
import { createVault, helperReady } from './vault.mjs';
import { createClient, validNpsso, validSession } from './client.mjs';

const text = (value, max = 200) => typeof value === 'string' && value.trim()
  ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, max) : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const percent = value => Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const stamp = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/u.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
export function durationSeconds(value) {
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value || '');
  if (!match || !match.slice(1).some(part => part !== undefined)) return null;
  const seconds = Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3] || 0) * 60 + Number(match[4] || 0);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}
function trophyCounts(value) {
  return value && ['bronze', 'silver', 'gold', 'platinum'].every(key => count(value[key]) !== null)
    ? value.bronze + value.silver + value.gold + value.platinum : null;
}

export function normalizePresence(raw) {
  const basic = raw?.basicPresence;
  if (!basic || typeof basic !== 'object' || Array.isArray(basic)) throw new Error('PSN presence response is invalid.');
  const primary = basic.primaryPlatformInfo || {};
  const status = ['online', 'offline', 'away'].includes(primary.onlineStatus || basic.onlineStatus) ? primary.onlineStatus || basic.onlineStatus : 'unknown';
  const online = status === 'online' ? true : status === 'offline' ? false : null;
  const titlesKnown = Array.isArray(basic.gameTitleInfoList);
  const game = online === true && titlesKnown ? basic.gameTitleInfoList.find(game => text(game?.titleName)) : null;
  const activeGame = text(game?.titleName);
  const id = /^\w{4}\d+_\d+$/.test(game?.npTitleId || '') ? game.npTitleId : null;
  return { 'online-status': status, online, platform: text(primary.platform || basic.platform, 40),
    'active-game': activeGame,
    'active-game-display': activeGame || (online === false || online === true && titlesKnown ? 'Not playing' : null),
    'game-running': online === null ? null : Boolean(game), 'title-id': id,
    'last-online': stamp(primary.lastOnlineDate || basic.lastOnlineDate) };
}

function putRows(output, id, countKey, rows, columns) {
  const shown = rows.slice(0, 10);
  output[countKey] = shown.length;
  for (let index = 0; index < 10; index += 1) for (const column of columns) {
    output[`${id}-${index + 1}-${column}`] = shown[index]?.[column] ?? null;
  }
}
export function gameReadings(result, titleId) {
  const output = { 'games-total': result.total, 'games-scanned': result.rows.length, 'games-truncated': result.truncated };
  const durations = result.rows.map(game => durationSeconds(game.playDuration));
  // Only call this an all-games total when PSN returned the complete library
  // and every title supplied a duration. Otherwise leave it unavailable.
  output['all-games-play-hours'] = !result.truncated && result.total === result.rows.length
    && durations.every(seconds => seconds !== null)
    ? Math.round(durations.reduce((sum, seconds) => sum + seconds, 0) / 3600 * 10) / 10 : null;
  const platform = value => {
    const category = text(value, 40);
    // Game category describes the software platform, which can differ from
    // the PS5 currently running a backward-compatible PS4 title.
    for (const [prefix, label] of [['ps5_', 'PS5'], ['ps4_', 'PS4'], ['ps3_', 'PS3'], ['psvita_', 'PS Vita'], ['psp_', 'PSP']]) {
      if (category?.toLowerCase().startsWith(prefix)) return label;
    }
    return category;
  };
  const rows = result.rows.map(game => ({ name: text(game.name), platform: platform(game.category),
    hours: durationSeconds(game.playDuration) === null ? null : durationSeconds(game.playDuration) / 3600,
    plays: count(game.playCount), first: stamp(game.firstPlayedDateTime), last: stamp(game.lastPlayedDateTime) }));
  // Order the bounded returned history before choosing ten public rows. Missing
  // dates remain last; stable sorting retains provider order for date ties.
  rows.sort((left, right) => (right.last ?? -Infinity) - (left.last ?? -Infinity));
  putRows(output, 'games', 'game-row-count', rows, ['name', 'platform', 'hours', 'plays', 'first', 'last']);
  const active = result.rows.find(game => game.titleId === titleId);
  const seconds = durationSeconds(active?.playDuration);
  output['active-play-hours'] = seconds === null ? null : seconds / 3600;
  return output;
}
export function collectionReadings(result) {
  const output = { 'collections-total': result.total, 'collections-scanned': result.rows.length, 'collections-truncated': result.truncated };
  const rows = result.rows.map(title => ({ name: text(title.trophyTitleName), platform: text(title.trophyTitlePlatform, 40),
    progress: percent(title.progress), earned: trophyCounts(title.earnedTrophies), available: trophyCounts(title.definedTrophies), last: stamp(title.lastUpdatedDateTime) }));
  rows.sort((left, right) => (right.last ?? -Infinity) - (left.last ?? -Infinity));
  putRows(output, 'collections', 'trophy-row-count', rows, ['name', 'platform', 'progress', 'earned', 'available', 'last']);
  return output;
}
function deviceReadings(raw) {
  const values = raw.accountDevices || raw.devices;
  if (!Array.isArray(values) || values.length > 1000) throw new Error('PSN console list is invalid.');
  const output = {};
  putRows(output, 'consoles', 'device-row-count', values.map(device => ({
    name: text(device.name || device.deviceName || device.device?.name || device.device?.deviceName),
    platform: text(device.platform || device.device?.platform || device.deviceType || device.device?.deviceType, 40),
    model: text(device.systemData?.model), software: text(device.systemVersion || device.systemData?.systemVersion, 80),
  })), ['name', 'platform', 'model', 'software']);
  return output;
}

async function details(client, auth, titleId, previous, signal, now) {
  const tasks = [
    ['profile', () => client.get(auth, 'userProfile/v1/internal/users/{account}/profiles', signal), raw => {
      const profile = raw.profile || raw;
      return { plus: typeof profile.isPlus === 'boolean' ? profile.isPlus : null };
    }],
    ['summary', () => client.get(auth, 'trophy/v1/users/{account}/trophySummary', signal), raw => ({
      'trophy-level': count(raw.trophyLevel), 'trophy-progress': percent(raw.progress),
      bronze: count(raw.earnedTrophies?.bronze), silver: count(raw.earnedTrophies?.silver), gold: count(raw.earnedTrophies?.gold),
      platinum: count(raw.earnedTrophies?.platinum), 'trophies-total': trophyCounts(raw.earnedTrophies),
    })],
    ['games', () => client.pages(auth, 'gamelist/v2/users/{account}/titles', 'titles', signal), result => gameReadings(result, titleId)],
    ['collections', () => client.pages(auth, 'trophy/v1/users/{account}/trophyTitles', 'trophyTitles', signal), collectionReadings],
    ['consoles', () => client.get(auth, '', signal, true), deviceReadings],
  ];
  if (titleId) tasks.push(['active trophies', () => client.get(auth, 'trophy/v1/users/{account}/titles/trophyTitles?npTitleIds=' + encodeURIComponent(titleId), signal), raw => {
    const sets = raw.titles?.find(title => title.npTitleId === titleId)?.trophyTitles;
    if (!Array.isArray(sets)) return { 'active-trophies': null };
    const seen = new Set(); let total = 0;
    for (const set of sets) {
      if (!text(set.npCommunicationId) || seen.has(set.npCommunicationId)) continue;
      seen.add(set.npCommunicationId);
      const earned = trophyCounts(set.earnedTrophies);
      if (earned === null) return { 'active-trophies': null };
      total += earned;
    }
    return { 'active-trophies': seen.size ? total : null };
  }]);
  // Independent read-only endpoints share one action deadline. Each section
  // preserves its successful data on failure; diagnostics never use raw errors.
  const results = await Promise.allSettled(tasks.map(async ([name, read, map]) => map(await read())));
  signal.throwIfAborted();
  const output = {}; let failures = 0;
  results.forEach((result, index) => { if (result.status === 'fulfilled') Object.assign(output, result.value); else failures++; });
  return { ...output, 'details-status': failures ? 'Partial · failed sections retained' : 'Current',
    'details-received-at': failures ? previous['details-received-at'] ?? null : now,
    'details-attempted-at': now, 'details-title-id': titleId };
}

export function createPlaystationAdapter({ vault = createVault(), fetchImpl = fetch, now = Date.now,
  credentialReady = helperReady, client: suppliedClient } = {}) {
  const client = suppliedClient || createClient({ vault, fetchImpl, now });
  let auth = null, npsso = '';
  return {
    async validateConfiguration(settings) {
      if (!await credentialReady() || typeof settings?.npsso !== 'string' || settings.npsso !== '' && !validNpsso(settings.npsso)) return false;
      if (validNpsso(settings.npsso)) return true;
      try { return Boolean(validSession(await vault.load())); } catch { return false; }
    },
    async start(settings) {
      npsso = settings.npsso.trim();
      try { auth = await vault.load(); }
      catch (error) {
        // An explicitly entered replacement credential can repair an unreadable
        // session, but only a verified Sony exchange replaces that file. Failed
        // authentication leaves the original encrypted file intact.
        if (!validNpsso(npsso)) throw error;
        auth = null;
      }
      if (!validSession(auth) && !validNpsso(npsso)) throw new Error('Connect PSN using a valid NPSSO token.');
    },
    async stop() { auth = null; npsso = ''; },
    async execute(actionId, parameters, context) {
      context.signal.throwIfAborted();
      if (actionId !== 'refresh') throw new Error('Unknown PlayStation action.');
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(20000)]);
      let presence;
      try {
        auth = await client.authorize(auth, npsso, signal);
        presence = normalizePresence(await client.get(auth, 'userProfile/v1/internal/users/{account}/basicPresences?type=primary', signal));
      } catch (error) {
        if (!context.signal.aborted) await context.log('PSN refresh failed. Check the connection or enter a fresh NPSSO value. Previous readings retained.', 'warning');
        context.signal.throwIfAborted();
        throw new Error('PSN refresh failed. Check the connection or enter a fresh NPSSO value.');
      }
      const state = await context.readState();
      const sameAccount = state['account-id'] === auth.accountId;
      const previous = sameAccount ? state : {};
      const receivedAt = now();
      const gameChanged = previous['title-id'] !== presence['title-id'];
      let detail = {};
      if (!sameAccount || gameChanged || !Number.isFinite(previous['details-attempted-at']) || receivedAt - previous['details-attempted-at'] >= 300000) {
        detail = await details(client, auth, presence['title-id'], previous, signal, now());
      }
      signal.throwIfAborted();
      const baseline = sameAccount && Number.isFinite(previous['received-at']);
      const changed = baseline && ['online-status', 'platform', 'active-game', 'title-id'].some(key => previous[key] !== presence[key]);
      const sequence = (count(previous['change-sequence']) ?? 0) + (changed ? 1 : 0);
      const reading = { ...previous, ...detail, ...presence, 'online-id': auth.onlineId, 'account-id': auth.accountId,
        'received-at': receivedAt, 'change-sequence': sequence };
      if (gameChanged) {
        // Never attach the previous game's stats to a newly reported title when
        // its detail endpoint failed, or claim a known zero for an absent game.
        reading['active-play-hours'] = detail['active-play-hours'] ?? null;
        reading['active-trophies'] = detail['active-trophies'] ?? null;
      }
      if (!presence['title-id']) { reading['active-play-hours'] = null; reading['active-trophies'] = null; }
      // Presence transition identity commits before effects; a crash can lose
      // an event but restart never replays it. Tokens never enter runtime state.
      await context.saveState(reading);
      await context.log('PSN status refreshed' + (detail['details-status']?.startsWith('Partial') ? ' · some detail sections unavailable.' : '.'), detail['details-status']?.startsWith('Partial') ? 'warning' : 'success');
      const payload = { 'online-id': auth.onlineId, status: presence['online-status'],
        ...(presence.online === null ? {} : { online: presence.online }),
        ...(presence['game-running'] === null ? {} : { 'game-running': presence['game-running'], game: presence['active-game'] || '' }),
        ...(presence.platform ? { platform: presence.platform } : {}) };
      if (changed) await context.emit('presence-changed', { ...payload, 'change-id': `${auth.accountId}:${sequence}` });
      await context.emit('status-updated', payload);
      return { completed: true, changed };
    },
  };
}

export default createPlaystationAdapter();
