/** Explicit local/LAN binding and request checks. Host headers must match the
 * actual destination socket, never an arbitrary name supplied by a browser.
 */
import { isIP } from 'node:net';
import { HttpError } from './storage.mjs';

// HTTP browser restrictions apply even when the OS accepts a listening socket.
// Keep automatic port choices compatible with Fetch's bad-port table.
// https://fetch.spec.whatwg.org/#port-blocking
const browserBlockedPorts = new Set([0,1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,
  101,102,103,104,109,110,111,113,115,117,119,123,135,137,139,143,161,179,389,427,465,
  512,513,514,515,526,530,531,532,540,548,554,556,563,587,601,636,989,990,993,995,
  1719,1720,1723,2049,3659,4045,4190,5060,5061,6000,6566,6665,6666,6667,6668,6669,6679,6697,10080]);

export async function listenBrowserHttp(server, port, host) {
  for (let attempt = 0; attempt < 64; attempt++) {
    await new Promise((resolve,reject) => {
      const failed = error => {server.removeListener('error',failed);reject(error);};
      server.once('error',failed);
      server.listen(port,host,() => {server.removeListener('error',failed);resolve();});
    });
    if (port !== 0 || !browserBlockedPorts.has(server.address().port)) return;
    // Only this newly acquired socket is released. Explicit port choices and
    // occupied-port errors are never retried or redirected to another port.
    await new Promise((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
  }
  throw new Error('Unable to select a browser-compatible automatic HTTP port.');
}

function ipv4(address) {
  return address?.startsWith('::ffff:') ? address.slice(7) : address;
}

export function isPrivateIPv4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isLocalAddress(address) {
  const value = ipv4(address);
  return value === '::1' || (isIP(value) === 4 && value.split('.')[0] === '127') || isPrivateIPv4(value);
}

export function validateListen(listen) {
  if (!listen || (!['127.0.0.1', '::1'].includes(listen.host) && !isPrivateIPv4(listen.host))
    || !Number.isInteger(listen.port) || listen.port < 0 || listen.port > 65535) {
    throw new HttpError(400, 'Use 127.0.0.1, ::1, or a private IPv4 LAN address, and port 0–65535.');
  }
  return listen;
}

export function requestOrigin(request, port) {
  const local = ipv4(request.socket.localAddress), remote = ipv4(request.socket.remoteAddress);
  if (!isLocalAddress(local) || !isLocalAddress(remote)) throw new HttpError(403, 'Use the local network server address.');
  const host = request.headers.host;
  const destination = `${local.includes(':') ? `[${local}]` : local}:${port}`;
  const localhost = local === '::1' || local.startsWith('127.');
  // Exact numeric destination and port prevent DNS rebinding. localhost is an
  // explicit convenience only on a loopback socket. Forwarded headers are ignored.
  const permitted = [destination, ...(localhost ? [`localhost:${port}`] : [])];
  if (port === 80) permitted.push(local.includes(':') ? `[${local}]` : local, ...(localhost ? ['localhost'] : []));
  if (!permitted.includes(host)) {
    throw new HttpError(403, 'Use this server’s local or LAN address.');
  }
  return new URL(`http://${host}`).origin;
}
