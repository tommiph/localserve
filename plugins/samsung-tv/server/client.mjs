/** Local Samsung TV protocol with explicit target/TLS pinning,
 * bounded reads, finite owned sockets and no redirect/fallback/retry.
 */
import { isIP } from 'node:net';
import https from 'node:https';
import tls from 'node:tls';
import dgram from 'node:dgram';
import WebSocket from '../vendor/node_modules/ws/wrapper.mjs';
import sax from '../vendor/sax/lib/sax.js';
export function localHost(value) {
  if (isIP(value) !== 4) return false;
  const [a, b, , d] = value.split('.').map(Number);
  return (a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31) && d !== 0 && d !== 255;
}
export const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(value);
export const validPin = value => typeof value === 'string' && /^(?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/.test(value);
export const keys = ['POWER', 'POWEROFF', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'ENTER', 'RETURN', 'HOME', 'EXIT', 'MENU', 'SOURCE', 'HDMI', 'HDMI1', 'HDMI2', 'HDMI3', 'HDMI4', 'TV', 'VOLUP', 'VOLDOWN', 'MUTE', 'CHUP', 'CHDOWN', 'GUIDE', 'INFO', 'PLAY', 'PAUSE', 'STOP', 'REWIND', 'FF', ...Array.from({ length: 10 }, (_, i) => String(i))].map(key => 'KEY_' + key);
export const xmlEscape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);

export async function responseText(response, signal, maximum = 256 * 1024) {
  if (!response.ok || response.status >= 300) { await response.body?.cancel(); throw new Error('Samsung TV rejected the request.'); }
  if (Number(response.headers.get('content-length')) > maximum) { await response.body?.cancel(); throw new Error('TV response exceeds its limit.'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Samsung TV returned an empty response.');
  const chunks = []; let size = 0;
  try {
    while (true) {
      signal.throwIfAborted(); const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > maximum) throw new Error('TV response exceeds its limit.'); chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally { await reader.cancel().catch(() => {}); }
}
export function soapValues(xml) {
  const parser = sax.parser(true, { trim: true, xmlns: true });
  const values = {}, stack = []; let count = 0;
  parser.ondoctype = () => { throw new Error('TV XML must not contain a DTD.'); };
  parser.onopentag = node => {
    if (++count > 2000 || stack.length >= 32) throw new Error('TV XML exceeds its structure limit.');
    if (node.local === 'Fault') throw new Error('Samsung TV rejected the SOAP request.');
    stack.push({ name: node.local, text: '' });
  };
  const append = text => { if (stack.length) stack.at(-1).text += text; };
  parser.ontext = append; parser.oncdata = append;
  parser.onclosetag = () => { const node = stack.pop(); if (node.text.length > 4096) throw new Error('TV XML value exceeds its limit.'); values[node.name] = node.text; };
  parser.write(xml).close(); return values;
}
const soapActions = new Set(['GetVolume', 'GetMute', 'SetVolume', 'SetMute', 'GetTransportInfo', 'GetPositionInfo', 'SetAVTransportURI', 'Play', 'Pause', 'Stop']);
export function createHttpClient(fetchImpl = fetch) {
  return {
    async info(host, signal) {
      if (!localHost(host)) throw new Error('Enter a private IPv4 TV address.');
      const response = await fetchImpl(`http://${host}:8001/api/v2/`, { redirect: 'manual', signal });
      const value = JSON.parse(await responseText(response, signal));
      if (!value?.device || typeof value.device !== 'object' || Array.isArray(value.device)) throw new Error('Samsung TV information is invalid.');
      return value.device;
    },
    async soap(host, action, args, kind, signal) {
      if (!localHost(host) || !soapActions.has(action) || !['RenderingControl', 'AVTransport'].includes(kind)) throw new Error('Unsupported TV request.');
      const service = 'urn:schemas-upnp-org:service:' + kind + ':1';
      const body = '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:' + action + ' xmlns:u="' + service + '"><InstanceID>0</InstanceID>'
        + (kind === 'RenderingControl' ? '<Channel>Master</Channel>' : '') + args + '</u:' + action + '></s:Body></s:Envelope>';
      const response = await fetchImpl(`http://${host}:9197/upnp/control/${kind}1`, { method: 'POST', redirect: 'manual', signal,
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${service}#${action}"` }, body });
      return soapValues(await responseText(response, signal, 64 * 1024));
    },
  };
}
export function pinnedAgent(host, fingerprint, { connect = tls.connect } = {}) {
  if (!localHost(host) || !validPin(fingerprint)) throw new Error('Set this TV’s SHA-256 certificate fingerprint before using port 8002.');
  const agent = new https.Agent({ keepAlive: false });
  agent.createConnection = (options, callback) => {
    // Samsung uses a self-signed certificate. Hand the socket to HTTP only
    // after an exact pin match; credentials cannot precede that verification.
    const socket = connect({ ...options, host, port: 8002, rejectUnauthorized: false });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; socket.removeListener('error', onError);
      if (error) socket.destroy(); callback(error, value);
    };
    const onError = () => finish(new Error('TV TLS connection failed.'));
    socket.once('error', onError);
    socket.once('secureConnect', () => {
      const actual = socket.getPeerCertificate()?.fingerprint256;
      if (actual?.toUpperCase() !== fingerprint.toUpperCase()) finish(new Error('TV certificate fingerprint changed. Update the pin only after checking this TV.'));
      else finish(null, socket);
    });
    return undefined;
  };
  return agent;
}
export async function connectRemote(settings, auth, signal, { saveToken = async () => {}, socketFactory = (url, options) => new WebSocket(url, options), agentFactory = pinnedAgent } = {}) {
  signal.throwIfAborted();
  if (!localHost(settings.host) || ![8001, 8002].includes(settings.port) || auth?.host !== settings.host || auth.port !== settings.port || !validToken(auth.token)) throw new Error('Configure this TV’s saved pairing token before remote actions.');
  const agent = settings.port === 8002 ? agentFactory(settings.host, settings.fingerprint) : undefined;
  const url = new URL(`${settings.port === 8002 ? 'wss' : 'ws'}://${settings.host}:${settings.port}/api/v2/channels/samsung.remote.control`);
  url.searchParams.set('name', Buffer.from(settings['remote-name']).toString('base64'));
  url.searchParams.set('token', auth.token);
  const socket = socketFactory(url, { handshakeTimeout: 6000, maxPayload: 256 * 1024, followRedirects: false, perMessageDeflate: false, agent });
  let failure = null, ready = false, acceptingConnection = false, pendingApps = null, connectResolve, connectReject;
  const connected = new Promise((resolve, reject) => { connectResolve = resolve; connectReject = reject; });
  const close = () => { signal.removeEventListener('abort', abort); socket.terminate(); agent?.destroy(); };
  const fail = error => { if (failure) return; failure = error; connectReject(error); pendingApps?.reject(error); pendingApps = null; close(); };
  const abort = () => fail(signal.reason || new Error('TV action cancelled.'));
  signal.addEventListener('abort', abort, { once: true });
  socket.on('error', () => fail(new Error('Samsung TV remote connection failed.')));
  socket.on('close', () => fail(new Error('Samsung TV closed the remote connection.')));
  socket.on('message', raw => {
    void (async () => {
      if (failure || signal.aborted) return;
      let message;
      try { message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
      catch { throw new Error('Samsung TV returned an invalid remote message.'); }
      if (message.event === 'ms.channel.unauthorized') throw new Error('The TV declined its saved pairing token. Reconnect with an authorized token.');
      if (message.event === 'ms.channel.connect' && !ready && !acceptingConnection) {
        // Claim this handshake before the asynchronous vault write. Duplicate
        // provider messages cannot race credential rotation or command release.
        acceptingConnection = true;
        if (message.data?.token && validToken(String(message.data.token)) && String(message.data.token) !== auth.token) {
          await saveToken({ host: settings.host, port: settings.port, token: String(message.data.token) }, signal);
        }
        signal.throwIfAborted(); ready = true; connectResolve();
      }
      if (message.event === 'ed.installedApp.get' && pendingApps) {
        const payload = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
        const rows = Array.isArray(payload) ? payload : payload?.data;
        if (!Array.isArray(rows) || rows.length > 200) throw new Error('TV app list is invalid or exceeds 200 entries.');
        const pending = pendingApps; pendingApps = null; pending.resolve(rows);
      }
    })().catch(error => fail(error));
  });
  if (signal.aborted) abort();
  try {
    await connected;
    const send = payload => new Promise((resolve, reject) => {
      signal.throwIfAborted(); if (failure) return reject(failure);
      socket.send(JSON.stringify(payload), error => { if (signal.aborted) reject(signal.reason); else error ? reject(new Error('TV command delivery is uncertain.')) : resolve(); });
    });
    return { close, send,
      async apps() {
        if (pendingApps) throw new Error('An app read is already pending.');
        const response = new Promise((resolve, reject) => { pendingApps = { resolve, reject }; });
        response.catch(() => {}); // Attach before the asynchronous send callback.
        try { await send({ method: 'ms.channel.emit', params: { event: 'ed.installedApp.get', to: 'host' } }); }
        catch (error) { fail(error); }
        return response;
      },
    };
  } catch (error) { close(); throw error; }
}
export function magicPacket(mac) {
  if (typeof mac !== 'string' || !/^(?:[a-f0-9]{2}[:-]){5}[a-f0-9]{2}$/i.test(mac) || /^00(?:[:-]00){5}$/.test(mac) || parseInt(mac.slice(0, 2), 16) % 2) throw new Error('Enter the TV’s wired unicast MAC address.');
  const bytes = Buffer.from(mac.replace(/[:-]/g, ''), 'hex');
  return Buffer.concat([Buffer.alloc(6, 255), ...Array(16).fill(bytes)]);
}
export async function wake(mac, signal, createSocket = () => dgram.createSocket('udp4')) {
  signal.throwIfAborted(); const packet = magicPacket(mac), socket = createSocket();
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = error => { if (done) return; done = true; signal.removeEventListener('abort', abort); try { socket.close(); } catch {} error ? reject(error) : resolve(); };
    const abort = () => finish(signal.reason); signal.addEventListener('abort', abort, { once: true });
    socket.on('error', () => finish(new Error('TV wake packet failed.')));
    socket.bind(() => { if (done || signal.aborted) return; socket.setBroadcast(true); socket.send(packet, 9, '255.255.255.255', error => finish(error ? new Error('TV wake packet delivery failed.') : null)); });
  });
}
