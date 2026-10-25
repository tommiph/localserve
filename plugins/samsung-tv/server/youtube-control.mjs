/** Explicit YouTube playback for the configured TV. DIAL supplies a private
 * screen identity; a short-lived YouTube Lounge session selects the video.
 * No discovery, cookies, account login, queue reads, retries or retained tokens.
 */
import {randomUUID} from 'node:crypto';
import {localHost, responseText, soapValues} from './client.mjs';

export class YouTubeControlError extends Error {}
const origin = 'https://www.youtube.com';
const pairingPath = '/api/lounge/pairing/get_lounge_token_batch';
const bindPath = '/api/lounge/bc/bind';
// Provider identities are opaque data. Bound them and reject header controls;
// URLSearchParams handles punctuation without interpreting it as URL syntax.
const privateValue = value => typeof value === 'string' && /^[\x21-\x7e]{1,2048}$/.test(value);

export function sessionIdentifiers(text) {
  // BrowserChannel replies contain length-prefixed JSON frames. Parse the
  // frames as data, never by eval or by extracting arbitrary provider markup.
  // A frame's advertised byte count can include its final newline. Trimming
  // the response first would corrupt that count and reject a valid handshake.
  let remaining = Buffer.from(text, 'utf8');
  while ([9, 10, 13, 32].includes(remaining[0])) remaining = remaining.subarray(1);
  const events = [];
  for (let count = 0; remaining.length && count < 64; count++) {
    const newline = remaining.indexOf(10);
    let payload;
    if (remaining[0] === 91) {
      payload = remaining.toString('utf8');
      remaining = Buffer.alloc(0);
    } else {
      const lengthText = remaining.subarray(0, newline).toString('ascii').trim();
      if (newline < 1 || !/^\d{1,6}$/.test(lengthText)) throw new YouTubeControlError('Samsung TV YouTube returned an invalid session frame.');
      const size = Number(lengthText);
      if (size < 1 || size > 256 * 1024 || remaining.length < newline + 1 + size) throw new YouTubeControlError('Samsung TV YouTube returned an incomplete session frame.');
      payload = remaining.subarray(newline + 1, newline + 1 + size).toString('utf8');
      remaining = remaining.subarray(newline + 1 + size);
      while ([9, 10, 13, 32].includes(remaining[0])) remaining = remaining.subarray(1);
    }
    let frame;
    try { frame = JSON.parse(payload); } catch { throw new YouTubeControlError('Samsung TV YouTube returned an invalid session.'); }
    if (!Array.isArray(frame) || frame.length > 256) throw new YouTubeControlError('Samsung TV YouTube session exceeds its limit.');
    for (const entry of frame) {
      if (!Array.isArray(entry) || !Number.isSafeInteger(entry[0]) || !Array.isArray(entry[1])) throw new YouTubeControlError('Samsung TV YouTube returned an invalid session.');
      events.push(entry[1]);
    }
  }
  const connections = events.filter(event => event[0] === 'c');
  const sessions = events.filter(event => event[0] === 'S');
  if (remaining.length || connections.length !== 1 || sessions.length !== 1
    || !privateValue(connections[0][1]) || !privateValue(sessions[0][1])) {
    throw new YouTubeControlError('Samsung TV YouTube did not establish a playback session.');
  }
  return {sid: connections[0][1], session: sessions[0][1]};
}

export function createYouTubeControl({fetchImpl = fetch} = {}) {
  async function post(path, parameters, fields, token, signal, gate) {
    await gate();
    signal.throwIfAborted();
    // Endpoints are package-owned constants. The saved TV pairing token/API key
    // never enters a request to Google; only this ephemeral Lounge token does.
    const url = new URL(path, origin);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    const response = await fetchImpl(url.href, {method: 'POST', redirect: 'error', signal,
      headers: {'Content-Type': 'application/x-www-form-urlencoded', Origin: origin,
        ...(token ? {'X-YouTube-LoungeId-Token': token} : {})},
      body: new URLSearchParams(fields).toString()});
    return responseText(response, signal);
  }

  return {
    async play(settings, videoId, signal, gate) {
      if (settings['youtube-playback'] !== true) throw new YouTubeControlError('Enable YouTube playback in Samsung TV Settings first.');
      if (!localHost(settings.host) || !Number.isInteger(settings['youtube-port'])
        || settings['youtube-port'] < 1 || settings['youtube-port'] > 65535
        || !/^[A-Za-z0-9_-]{11}$/.test(videoId || '')) throw new YouTubeControlError('Configure the YouTube control port and a valid Video ID.');
      try {
        await gate();
        signal.throwIfAborted();
        const response = await fetchImpl(`http://${settings.host}:${settings['youtube-port']}/ws/app/YouTube`, {
          redirect: 'error', signal,
        });
        const values = soapValues(await responseText(response, signal, 64 * 1024));
        if (values.name !== 'YouTube' || !privateValue(values.screenId)) throw new YouTubeControlError('Samsung TV YouTube did not report a screen identity. Open YouTube on the TV and check its control port.');
        let paired;
        try { paired = JSON.parse(await post(pairingPath, {}, {screen_ids: values.screenId}, null, signal, gate)); }
        catch (error) {
          if (error instanceof YouTubeControlError) throw error;
          throw new YouTubeControlError('Samsung TV YouTube could not obtain a playback token.');
        }
        const screens = paired?.screens;
        if (!Array.isArray(screens) || screens.length !== 1 || screens[0].screenId !== values.screenId
          || !privateValue(screens[0].loungeToken)) throw new YouTubeControlError('Samsung TV YouTube returned an unexpected playback identity.');
        const token = screens[0].loungeToken;
        const bound = await post(bindPath, {RID: '0', VER: '8', CVER: '1'}, {
          device: 'REMOTE_CONTROL', id: randomUUID().replaceAll('-', ''), name: 'Sormus',
          'mdx-version': '3', pairing_type: 'cast', app: 'Sormus',
        }, token, signal, gate);
        const session = sessionIdentifiers(bound);
        // Exactly one setPlaylist effect; no rebind/resend after uncertainty.
        // Session identifiers stay in memory and never become Card/Event data.
        await post(bindPath, {RID: '1', VER: '8', CVER: '1', SID: session.sid, gsessionid: session.session}, {
          count: '1', req0__sc: 'setPlaylist', req0_videoId: videoId,
          req0_currentTime: '0', req0_currentIndex: '-1', req0_audioOnly: 'false', req0_listId: '',
        }, token, signal, gate);
        signal.throwIfAborted();
        return {commandSent: true};
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof YouTubeControlError) throw error;
        throw new YouTubeControlError('Samsung TV YouTube playback request failed. No retry was sent; playback may be uncertain.');
      }
    },
  };
}
