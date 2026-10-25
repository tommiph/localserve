/** TRÅDFRI gateway access through bundled node-tradfri-client sessions.
 * No discovery, connection watcher, background keepalive or command retry.
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
  if (!Object.hasOwn(raw, '5750')) device.type = null;
  return device.createProxy();
}
export const parseGroup = raw => new lib.Group().parse(raw).createProxy();

export function createGatewaySession(factory = address => new lib.TradfriClient(address, {
  watchConnection: false, customLogger: () => {},
})) {
  let current = null, busy = false, generation = 0;
  const close = () => {
    const previous = current; current = null; generation++;
    previous?.client.destroy();
  };
  return {close, async run(host, signal, operation) {
    signal.throwIfAborted();
    if (!localHost(host)) throw new Error('Enter a private IPv4 gateway address.');
    if (busy) throw new Error('Gateway operation is already active.');
    busy = true;
    let abort, entry;
    try {
      if (current && current.host !== host) close();
      if (!current) {
        coap.CoapClient.setDefaultRequestOptions({retransmit:false});
        current = {host, client:factory(host), identity:null, psk:null, connected:false};
        const owned = current;
        owned.client.on('error', () => {
          if (current !== owned) return;
          if (owned.fail) owned.fail(); else close();
        });
      }
      entry = current;
      const admitted = generation;
      const check = () => {
        signal.throwIfAborted();
        if (current !== entry || generation !== admitted) throw new Error('Gateway session is no longer active.');
      };
      // Reuse only the same authenticated session. Cancellation, transport errors,
      // settings changes and stop destroy it; a later explicit operation can
      // establish a new session, without replaying any earlier request.
      const client = {
        async authenticate(code) {
          check(); entry.connected=false;
          const result=await entry.client.authenticate(code);check();return result;
        },
        async connect(identity, psk) {
          check();
          if (entry.connected && entry.identity===identity && entry.psk===psk) return true;
          entry.connected=false;
          await entry.client.connect(identity,psk);check();
          entry.identity=identity;entry.psk=psk;entry.connected=true;return true;
        },
        async request(path, method, payload) {
          check();const result=await entry.client.request(path,method,payload);check();return result;
        },
      };
      const boundary = new Promise((resolve,reject) => {
        const fail = error => {if(current===entry)close();reject(error);};
        entry.fail=()=>fail(new Error('Gateway transport failed.'));
        abort=()=>fail(signal.reason||new Error('Gateway operation cancelled.'));
        signal.addEventListener('abort',abort,{once:true});
        if(signal.aborted)abort();
      });
      return await Promise.race([Promise.resolve().then(()=>{check();return operation(client);}),boundary]);
    } catch(error) {
      if(current===entry)close();
      throw error;
    } finally {
      signal.removeEventListener('abort',abort);
      if(entry)delete entry.fail;
      busy=false;
    }
  }};
}

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
