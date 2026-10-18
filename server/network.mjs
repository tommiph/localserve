/** Explicit local/LAN binding and request checks. Host headers must match the
 * actual destination socket, never an arbitrary name supplied by a browser.
 */
import { isIP } from 'node:net';
import { HttpError } from './storage.mjs';

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
