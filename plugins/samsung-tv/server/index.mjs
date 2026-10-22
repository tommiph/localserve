/** Localserve Samsung TV polling and explicit supervised remote actions.
 * Polling reads device/UPnP data; it never pairs, wakes or sends remote keys.
 */
import { createVault, helperReady } from './vault.mjs';
import { localHost, validPin, validToken, createHttpClient, connectRemote, keys, xmlEscape, wake } from './client.mjs';
import {createYouTubeControl, YouTubeControlError} from './youtube-control.mjs';
const text = (value, max = 200) => typeof value === 'string' && value.trim() ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, max) : null;
const volume = value => /^(?:\d|[1-9]\d|100)$/.test(value || '') ? Number(value) : null;
const mute = value => value === '1' ? true : value === '0' ? false : null;
const clock = value => typeof value === 'string' && /^\d{1,5}:\d{2}:\d{2}$/.test(value) && value.split(':').slice(1).every(part => Number(part) < 60) ? value : null;
const configured = values => localHost(values?.host) && [8001, 8002].includes(values?.port)
  && [0.5, 1, 5].includes(values?.['poll-minutes'] ?? 1)
  && typeof values?.['remote-name'] === 'string' && values['remote-name'].trim().length > 0
  && Number.isFinite(values?.['command-interval-ms'] ?? 100)
  && (values?.['command-interval-ms'] ?? 100) >= 0 && (values?.['command-interval-ms'] ?? 100) <= 5000
  && (values.fingerprint === '' || validPin(values.fingerprint));
export function infoReading(info) {
  return { 'connection-status': 'Reachable', 'tv-name': text(info.name), model: text(info.modelName || info.model),
    'model-description': text(info.description), 'operating-system': text(info.OS, 80), resolution: text(info.resolution, 80),
    'network-type': text(info.networkType, 40), 'firmware-version': text(info.firmwareVersion, 80),
    'reported-power': text(info.PowerState || info.powerState, 40) };
}
export function appReading(raw, receivedAt) {
  const rows = raw.filter(app => app && (typeof app.appId === 'string' || Number.isSafeInteger(app.appId)) && /^[\w.-]{1,128}$/.test(String(app.appId)) && text(app.name))
    .map(app => ({ id: String(app.appId), name: text(app.name), type: typeof app.app_type === 'number' ? String(app.app_type) : text(app.app_type, 40) }));
  const reading = { 'app-count': rows.length, 'app-row-count': Math.min(10, rows.length), 'apps-truncated': rows.length > 10, 'apps-received-at': receivedAt };
  for (let i = 0; i < 10; i++) for (const column of ['id', 'name', 'type']) reading[`app-${i + 1}-${column}`] = rows[i]?.[column] ?? null;
  return reading;
}
export function remoteMessage(actionId, parameters) {
  if (actionId === 'key' || actionId === 'input' || actionId === 'power-off') {
    const key = actionId === 'power-off' ? 'KEY_POWEROFF' : actionId === 'input' ? 'KEY_' + parameters.input : parameters.key;
    if (!keys.includes(key) || actionId === 'input' && !['TV', 'HDMI1', 'HDMI2', 'HDMI3', 'HDMI4'].includes(parameters.input)) throw new Error('Choose a supported remote key or input.');
    return { method: 'ms.remote.control', params: { Cmd: 'Click', DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' } };
  }
  if (actionId === 'launch-app' || actionId === 'open-browser') {
    let appId = parameters.id, argument = parameters.arguments || '', mode = parameters.mode || 'DEEP_LINK';
    if (actionId === 'open-browser') { appId = 'org.tizen.browser'; argument = safeUrl(parameters.url); mode = 'NATIVE_LAUNCH'; }
    if (!/^[\w.-]{1,128}$/.test(appId || '') || !['DEEP_LINK', 'NATIVE_LAUNCH'].includes(mode) || typeof argument !== 'string' || argument.length > 2048) throw new Error('Enter a supported app ID, launch mode and bounded arguments.');
    return { method: 'ms.channel.emit', params: { event: 'ed.apps.launch', to: 'host', data: { action_type: mode, appId, metaTag: argument } } };
  }
  if (actionId === 'send-text') {
    if (typeof parameters.text !== 'string' || !parameters.text.length || parameters.text.length > 1000) throw new Error('Enter 1–1000 characters.');
    return { method: 'ms.remote.control', params: { Cmd: Buffer.from(parameters.text).toString('base64'), DataOfCmd: 'base64', TypeOfRemote: 'SendInputString' } };
  }
  if (actionId === 'pointer') {
    if (![parameters.x, parameters.y].every(value => Number.isInteger(value) && Math.abs(value) <= 2000)) throw new Error('Pointer values must be integers between -2000 and 2000.');
    return { method: 'ms.remote.control', params: { Cmd: 'Move', Position: { x: parameters.x, y: parameters.y, Time: '1000' }, TypeOfRemote: 'ProcessMouseDevice' } };
  }
  throw new Error('Unsupported Samsung TV action.');
}
export function safeUrl(value) {
  let url;
  try { url = new URL(value); } catch {}
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || value.length > 2048) throw new Error('Enter an HTTP or HTTPS URL without credentials.');
  return url.href;
}
export function createSamsungAdapter({ vault = createVault(), credentialReady = helperReady, http = createHttpClient(), remote = connectRemote, youtube = createYouTubeControl(), wakeImpl = wake, now = Date.now, commandClock = () => performance.now() } = {}) {
  let settings, auth, lastCommandAt = null;
  const paceCommand = async (context, signal) => {
    const interval = settings['command-interval-ms'] ?? 100;
    const remaining = lastCommandAt === null ? 0 : Math.max(0, interval - (commandClock() - lastCommandAt));
    // Keep the host pause/DND/cancellation gate even when extra spacing is off.
    // This clock is monotonic and local to the current configured runtime.
    await context.wait(Math.max(10, remaining) / 1000);
    signal.throwIfAborted();
    lastCommandAt = commandClock();
  };
  const readAuth = async values => {
    if (values.token) return { host: values.host, port: values.port, token: values.token };
    return vault.load();
  };
  return {
    async validateConfiguration(values) {
      return Boolean(configured(values) && (values.token === '' || validToken(values.token)) && await credentialReady());
    },
    async start(values) {
      settings = structuredClone(values);
      lastCommandAt = null;
      try { auth = await readAuth(values); } catch { auth = null; }
    },
    async stop() { settings = null; auth = null; lastCommandAt = null; },
    async execute(actionId, parameters, context) {
      context.signal.throwIfAborted();
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(20000)]);
      const previous = await context.readState(), sameTarget = previous['target-host'] === settings.host;
      let reading = sameTarget ? structuredClone(previous) : {};
      let remotePhase = null;
      try {
        if (actionId === 'test-connection' || actionId === 'repair-connection') {
          const repairing = actionId === 'repair-connection';
          if (!auth || !validToken(auth.token)) throw new Error('Configure an authorized TV pairing token first.');
          if (repairing) {
            if (settings.token || settings.port !== 8002 || auth.port !== 8002) throw new Error('Configure the existing protected TLS pairing before updating its address. Plain port 8001 needs an authorized replacement token.');
            if (!validPin(auth.fingerprint)) throw new Error('Configure a verified pairing first: test the previous TV address, or supply an authorized replacement token and test the connection.');
            if (auth.fingerprint.toUpperCase() !== settings.fingerprint.toUpperCase()) throw new Error('TV certificate fingerprint changed. Keep the verified certificate when updating this TV’s address.');
          }
          // Only this explicit setup action may move a protected pairing. The
          // pinned transport checks identity before releasing any token bytes.
          const candidate = repairing ? {...auth, host: settings.host} : auth;
          let verified = candidate, connection;
          try {
            connection = await remote(settings, candidate, signal, {saveToken: async next => {verified = next;}});
            signal.throwIfAborted();
            await connection.apps();
            await context.wait(0.01); signal.throwIfAborted();
            await vault.save(verified, signal); auth = verified;
          } finally { connection?.close(); }
          await context.log(repairing ? 'TV pairing address updated and remote connection verified.' : 'TV remote connection verified.', 'success');
          return {connected: true, message: repairing ? 'Pairing address updated. Remote control is connected.' : 'Remote control is connected. The TV accepted its saved pairing.'};
        }
        if (actionId === 'play-youtube') {
          if (settings['youtube-playback'] !== true) throw new YouTubeControlError('Enable YouTube playback in Samsung TV Settings first.');
          if (!/^[A-Za-z0-9_-]{11}$/.test(parameters['video-id'] || '')) throw new YouTubeControlError('Enter an eleven-character YouTube Video ID.');
          if (!Number.isInteger(settings['youtube-port']) || settings['youtube-port'] < 1 || settings['youtube-port'] > 65535) throw new YouTubeControlError('Configure the YouTube control port in Samsung TV Settings first.');
          // Validate the entire launch before its first effect. No remote
          // handshake or app launch is attempted for incomplete parameters.
          remoteMessage('launch-app', {id: parameters['app-id']});
        }
        if (actionId === 'refresh') {
          const info = await http.info(settings.host, signal), data = infoReading(info);
          const failed = [], known = {};
          for (const [name, action, kind, map] of [
            ['volume', 'GetVolume', 'RenderingControl', value => ({ volume: volume(value.CurrentVolume) })],
            ['mute', 'GetMute', 'RenderingControl', value => ({ muted: mute(value.CurrentMute) })],
            ['transport', 'GetTransportInfo', 'AVTransport', value => ({ 'playback-state': text(value.CurrentTransportState, 40) })],
            ['position', 'GetPositionInfo', 'AVTransport', value => ({ 'playback-position': clock(value.RelTime), 'playback-duration': clock(value.TrackDuration) })],
          ]) {
            try {
              const result = map(await http.soap(settings.host, action, '', kind, AbortSignal.any([signal, AbortSignal.timeout(3500)])));
              Object.assign(data, result); Object.assign(known, result);
            } catch { signal.throwIfAborted(); failed.push(name); }
          }
          signal.throwIfAborted();
          reading = { ...reading, ...data, 'target-host': settings.host, 'received-at': now(),
            'details-status': failed.length ? `Partial · ${failed.join(', ')} unavailable; prior readings retained` : 'Current' };
          const baseline = sameTarget ? previous['reading-baseline'] || {} : {};
          const current = Object.fromEntries(Object.entries(known).filter(([, value]) => value !== null));
          const changed = Object.entries(current).some(([key, value]) => Object.hasOwn(baseline, key) && baseline[key] !== value);
          reading['reading-baseline'] = { ...baseline, ...current };
          reading.sequence = (Number.isSafeInteger(previous.sequence) ? previous.sequence : 0) + (changed ? 1 : 0);
          // Reading/transition claims persist before Tasks. Missing sections keep
          // baselines and omit payload fields, so no false rearm or restart replay.
          await context.saveState(reading);
          await context.log(failed.length ? 'Samsung TV refreshed; some UPnP sections are unavailable.' : 'Samsung TV readings refreshed.', failed.length ? 'warning' : 'success');
          const payload = { ...(current.volume === undefined ? {} : { volume: current.volume }),
            ...(current.muted === undefined ? {} : { muted: current.muted }),
            ...(current['playback-state'] === undefined ? {} : { playback: current['playback-state'] }) };
          if (changed) await context.emit('tv-changed', { ...payload, 'change-id': String(reading.sequence) });
          await context.emit('status-updated', payload);
          return { completed: true, partial: failed.length > 0 };
        }
        if (['volume', 'mute', 'play-media', 'play', 'pause', 'stop'].includes(actionId)) {
          await paceCommand(context, signal);
          signal.throwIfAborted();
          if (actionId === 'volume') {
            if (!Number.isInteger(parameters.value) || parameters.value < 0 || parameters.value > 100) throw new Error('Volume must be 0–100.');
            await http.soap(settings.host, 'SetVolume', `<DesiredVolume>${parameters.value}</DesiredVolume>`, 'RenderingControl', signal);
          } else if (actionId === 'mute') {
            if (typeof parameters.muted !== 'boolean') throw new Error('Choose mute on or off.');
            await http.soap(settings.host, 'SetMute', `<DesiredMute>${parameters.muted ? 1 : 0}</DesiredMute>`, 'RenderingControl', signal);
          } else if (actionId === 'play-media') {
            const url = safeUrl(parameters.url);
            // Assign once, then Play once. A rejection never causes retry or an
            // optimistic reading; older TV firmware may have already auto-played.
            await http.soap(settings.host, 'SetAVTransportURI', `<CurrentURI>${xmlEscape(url)}</CurrentURI><CurrentURIMetaData></CurrentURIMetaData>`, 'AVTransport', signal);
            await context.wait(0.01);
            signal.throwIfAborted(); await http.soap(settings.host, 'Play', '<Speed>1</Speed>', 'AVTransport', signal);
          } else await http.soap(settings.host, { play: 'Play', pause: 'Pause', stop: 'Stop' }[actionId], actionId === 'play' ? '<Speed>1</Speed>' : '', 'AVTransport', signal);
        } else if (actionId === 'wake') {
          await paceCommand(context, signal); signal.throwIfAborted();
          await wakeImpl(settings.mac, signal);
        }
        else {
          let connection;
          try {
            // No unpaired automatic fallback. Only the saved token is submitted
            // to this exact TV/port, with TLS certificate pinning for port 8002.
            if (settings.token && validToken(settings.token)) await vault.save(auth, signal);
            remotePhase = 'connecting';
            connection = await remote(settings, auth, signal, { saveToken: async (next, activeSignal) => {
              await vault.save(next, activeSignal); activeSignal.throwIfAborted(); auth = next;
            } });
            remotePhase = 'connected';
            if (actionId === 'refresh-apps') {
              reading = { ...reading, ...appReading(await connection.apps(), now()), 'target-host': settings.host };
              signal.throwIfAborted(); await context.saveState(reading); await context.log('TV installed-app list refreshed.', 'success');
              return { completed: true };
            }
            // A connection may finish after the user pauses server functions.
            // Gate each effect, including both text/media protocol stages.
            await paceCommand(context, signal); signal.throwIfAborted();
            if (actionId === 'send-text') {
              remotePhase = 'sending';
              await connection.send({ method: 'ms.channel.emit', params: { event: 'custom.remote.textReceived', to: 'broadcast' } });
              await context.wait(0.01); signal.throwIfAborted();
            }
            if (actionId === 'play-youtube') {
              remotePhase = 'sending';
              await connection.send(remoteMessage('launch-app', {id: parameters['app-id'], mode: 'DEEP_LINK'}));
              connection.close();
              connection = null;
              await context.wait(3);
              signal.throwIfAborted();
              await youtube.play(settings, parameters['video-id'], signal, () => context.wait(0.01));
            } else if (actionId === 'show-notice') {
              // The host reserves this URL before execution. Do not accept an
              // arbitrary caller URL, app ID, sound file or return application.
              if (!/^http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/tv-notices\/[a-f0-9]{48}\?seconds=[0-9.]+$/.test(context.noticeUrl || '')) throw new Error('Configure a server-generated TV notice first.');
              remotePhase = 'sending';
              await connection.send(remoteMessage('launch-app', {
                id: 'HwGlance01.HomeGlance', mode: 'DEEP_LINK', arguments: context.noticeUrl,
              }));
            } else {
              const message = remoteMessage(actionId, parameters);
              // Once send is attempted, a failure cannot establish whether the
              // TV acted. Before this boundary we can safely report no command.
              remotePhase = 'sending';
              await connection.send(message);
            }
          } finally { connection?.close(); }
        }
        signal.throwIfAborted();
        // This timestamp means delivery/acknowledgement, not confirmed playback,
        // input or power. Actual telemetry changes only on subsequent reads.
        await context.saveState({ ...reading, 'target-host': settings.host, 'last-command': actionId, 'command-sent-at': now() });
        await context.log('Samsung TV command sent; subsequent readings confirm supported state.', 'info');
        return { commandSent: true };
      } catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof YouTubeControlError) throw error;
        if (signal.aborted) throw new Error(remotePhase && remotePhase !== 'sending'
          ? 'Samsung TV remote connection or app read timed out before any control command was sent. Check that the TV is on and its saved pairing is authorized.'
          : 'Samsung TV did not respond within 20 seconds; any sent command may have an uncertain effect.');
        if (/^(Enter |Choose |Configure |Set this TV|Volume must|Pointer values|Unsupported Samsung|Samsung TV (rejected|information|returned|closed|remote)|The TV declined|TV (XML|response|app list|certificate|command)|An app read)/.test(error.message)) throw error;
        throw new Error('Samsung TV connection or request failed. Check its address, availability and saved pairing settings.');
      }
    },
  };
}
export default createSamsungAdapter();
