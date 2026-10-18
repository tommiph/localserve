/** TRÅDFRI gateway access through bundled node-tradfri-client sessions.
 * No discovery, connection watcher, automatic reconnect or request retry.
 */
import lib from '../vendor/node_modules/node-tradfri-client/build/index.js';
import coap from '../vendor/node_modules/node-coap-client/build/CoapClient.js';
import { isIP } from 'node:net';
export function localHost(value) {
  if (isIP(value) !== 4) return false;
  const [a, b, , d] = value.split('.').map(Number);
  return (a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31) && d !== 0 && d !== 255;
}
export const resourceId = value => typeof value === 'string' && /^\d{1,10}$/.test(value) && Number(value) > 0 && Number(value) <= 0xffffffff;
export const validAuth = (value, host) => value?.host === host && typeof value.identity === 'string'
  && value.identity.length > 0 && value.identity.length <= 128 && typeof value.psk === 'string' && value.psk.length > 0 && value.psk.length <= 128;
export function parseAccessory(raw) {
  const device = new lib.Accessory().parse(raw);
  // The library constructor defaults alive=false. Only a reported reachability
  // flag is telemetry; an omitted flag stays unknown instead of inventing Off.
  if (!Object.hasOwn(raw, '9019')) device.alive = null;
  return device.createProxy();
}
export const parseGroup = raw => new lib.Group().parse(raw).createProxy();

export async function withGateway(host, signal, operation, factory = address => new lib.TradfriClient(address, {
  watchConnection: false, customLogger: () => {},
})) {
  signal.throwIfAborted();
  if (!localHost(host)) throw new Error('Enter a private IPv4 gateway address.');
  // The library's CoAP singleton is private to this supervised worker process.
  // Keep protocol writes single-send too: a missing ACK has an uncertain effect.
  coap.CoapClient.setDefaultRequestOptions({ retransmit: false });
  const client = factory(host);
  client.on('error', () => {}); // Library errors can contain raw provider data.
  let abort;
  const boundary = new Promise((resolve, reject) => {
    abort = () => { client.destroy(); reject(signal.reason || new Error('Gateway operation cancelled.')); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try { return await Promise.race([Promise.resolve().then(() => operation(client)), boundary]); }
  finally {
    signal.removeEventListener('abort', abort);
    client.destroy();
  }
}
export async function gatewayRead(client, path) {
  const response = await client.request(path, 'get');
  if (response.code !== '2.05') throw new Error('The gateway rejected a diagnostic read.');
  if (Buffer.byteLength(JSON.stringify(response.payload)) > 65536) throw new Error('Gateway response exceeds its limit.');
  return response.payload;
}
export function boundedIds(values) {
  if (!Array.isArray(values) || values.length > 100 || values.some(id => !resourceId(String(id)))) throw new Error('The gateway resource list is invalid or exceeds 100 entries.');
  return [...new Set(values.map(String))].sort((a, b) => Number(a) - Number(b));
}
export function transitionTicks(seconds = 0.4) {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60) {
    throw new Error('Fade duration must be between 0 and 60 seconds.');
  }
  // The legacy gateway represents transition duration in tenths of a second.
  // Preserve explicit zero and send an integer rather than a floating remainder.
  return Math.round(seconds * 10);
}
export function lightPayload(accessory, operation, fadeSeconds = 0.4) {
  const ticks = transitionTicks(fadeSeconds);
  const updated = accessory.clone();
  updated.lightList[0].merge({ ...operation, transitionTime: ticks / 10 });
  const payload = updated.serialize(accessory);
  if (payload['3311']?.[0]) payload['3311'][0]['5712'] = ticks;
  return payload;
}
