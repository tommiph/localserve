/** Small read-only legacy ADB transport. Connects only to the configured Go;
 * never starts/contacts the shared host ADB server, scans or exposes a shell.
 * Wire framing/auth follow AOSP's Android 8.1 protocol, with Node crypto/net.
 */
import net from 'node:net';
import { createPrivateKey, privateEncrypt, constants } from 'node:crypto';

export const commands = Object.freeze({
  identity: 'getprop ro.serialno',
  battery: 'dumpsys battery',
  activity: 'dumpsys activity activities',
  power: 'dumpsys vrpowermanager',
  storage: 'df /data',
  thermal: 'for z in /sys/class/thermal/thermal_zone*; do echo ZONE:$z; cat $z/type $z/temp 2>/dev/null; done',
});
export function targetAddress(value) {
  const match = /^(\d+\.\d+\.\d+\.\d+):(\d{1,5})$/.exec(value || '');
  if (!match || net.isIP(match[1]) !== 4) return null;
  const [a, b, c, d] = match[1].split('.').map(Number), port = Number(match[2]);
  const local = a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31;
  if (!local || !port || port > 65535 || d === 0 || d === 255) return null;
  return { host: [a, b, c, d].join('.'), port };
}
export function validKey(value) {
  try {
    const key = createPrivateKey(value?.privateKey);
    return key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails.modulusLength === 2048;
  } catch { return false; }
}
export function keyFromSetting(value) {
  // The shared masked Settings control is a single-line input. Accept PEM
  // encoded as Base64, so browser paste cannot silently strip its newlines.
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > 4000) return null;
  const key = { privateKey: Buffer.from(value, 'base64').toString('utf8') };
  return validKey(key) ? key : null;
}
export function signToken(token, privateKey) {
  if (token.length !== 20) throw new Error('ADB sent an invalid authentication challenge.');
  // ADB supplies a SHA-1 digest already. Hashing it again would reject the
  // existing authorized host key; sign its ASN.1 DigestInfo directly.
  const digestInfo = Buffer.concat([Buffer.from('3021300906052b0e03021a05000414', 'hex'), token]);
  return privateEncrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, digestInfo);
}
const codes = Object.fromEntries(['CNXN', 'AUTH', 'OPEN', 'OKAY', 'WRTE', 'CLSE'].map(name => [name, Buffer.from(name).readUInt32LE()]));
const names = Object.fromEntries(Object.entries(codes).map(([name, code]) => [code, name]));
const checksum = data => data.reduce((sum, byte) => (sum + byte) >>> 0, 0);
export function packet(name, a = 0, b = 0, value = Buffer.alloc(0)) {
  const data = Buffer.from(value), header = Buffer.alloc(24), code = codes[name];
  [code, a, b, data.length, checksum(data), (code ^ 0xffffffff) >>> 0].forEach((word, index) => header.writeUInt32LE(word, index * 4));
  return Buffer.concat([header, data]);
}

export async function connectAdb(address, key, signal, { socketFactory = net.createConnection } = {}) {
  signal.throwIfAborted();
  const target = targetAddress(address);
  if (!target || !validKey(key)) throw new Error('Configure a local Wi-Fi address and an authorized ADB key.');
  const socket = socketFactory(target);
  let buffer = Buffer.alloc(0), failure = null, waiter = null, queue = [], nextId = 0;
  const fail = error => {
    if (failure) return;
    failure = error;
    if (waiter) { waiter.reject(error); waiter = null; }
    socket.destroy();
  };
  const abort = () => fail(signal.reason || new Error('ADB read cancelled.'));
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  socket.on('error', () => fail(new Error('Oculus Go is unavailable at the configured Wi-Fi address.')));
  socket.on('close', () => {
    signal.removeEventListener('abort', abort);
    fail(new Error('Oculus Go closed its ADB connection.'));
  });
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 1024 * 1024) return fail(new Error('ADB response exceeds its limit.'));
    while (buffer.length >= 24) {
      const code = buffer.readUInt32LE(0), size = buffer.readUInt32LE(12);
      if (!names[code] || size > 256 * 1024 || buffer.readUInt32LE(20) !== ((code ^ 0xffffffff) >>> 0)) return fail(new Error('ADB returned an invalid frame.'));
      if (buffer.length < 24 + size) break;
      const data = buffer.subarray(24, 24 + size);
      if (checksum(data) !== buffer.readUInt32LE(16)) return fail(new Error('ADB response checksum is invalid.'));
      const frame = { name: names[code], a: buffer.readUInt32LE(4), b: buffer.readUInt32LE(8), data };
      buffer = buffer.subarray(24 + size);
      if (waiter) { const pending = waiter; waiter = null; pending.resolve(frame); }
      else { queue.push(frame); if (queue.length > 32) return fail(new Error('ADB response queue exceeds its limit.')); }
    }
  });
  const receive = () => {
    signal.throwIfAborted();
    if (failure) return Promise.reject(failure);
    if (queue.length) return Promise.resolve(queue.shift());
    return new Promise((resolve, reject) => { waiter = { resolve, reject }; });
  };
  const send = (...args) => { signal.throwIfAborted(); if (failure) throw failure; socket.write(packet(...args)); };
  const close = () => { signal.removeEventListener('abort', abort); socket.destroy(); };
  try {
    // Advertise the checksum-bearing legacy version and no shell-v2 feature.
    // Each poll owns one connection, serial streams, and a whole-action deadline.
    send('CNXN', 0x01000000, 256 * 1024, 'host::localserve\0');
    let frame = await receive();
    if (frame.name === 'AUTH' && frame.a === 1) {
      send('AUTH', 2, 0, signToken(frame.data, key.privateKey));
      frame = await receive();
    }
    if (frame.name === 'AUTH') throw new Error('The headset has not authorized this ADB key.');
    if (frame.name !== 'CNXN' || frame.a < 0x01000000 || frame.b < 4096) throw new Error('The target is not a compatible ADB device.');
    return {
      close,
      async read(section) {
        if (!Object.hasOwn(commands, section)) throw new Error('Unsupported Oculus Go read.');
        const id = ++nextId, chunks = [];
        let remote = null, total = 0;
        send('OPEN', id, 0, `shell:${commands[section]}\0`);
        while (true) {
          const reply = await receive();
          if (reply.b !== id) continue; // Ignore acknowledgements for a closed stream.
          if (reply.name === 'CLSE') {
            if (remote === null) throw new Error('The headset does not provide this diagnostic section.');
            return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
          }
          if (reply.name === 'OKAY' && remote === null && reply.a) { remote = reply.a; continue; }
          if (reply.name !== 'WRTE' || reply.a !== remote) throw new Error('ADB diagnostic stream is invalid.');
          total += reply.data.length;
          if (total > 512 * 1024) throw new Error('Headset diagnostic output exceeds its limit.');
          chunks.push(reply.data);
          send('OKAY', id, remote);
        }
      },
    };
  } catch (error) { close(); throw error; }
}
