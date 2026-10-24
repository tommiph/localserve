/** LAN controls use mocked sockets and isolated wildcard-bound servers. No
 * installed state, other services, device effects or firewall edits are tested.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { requestOrigin, validateListen, isPrivateIPv4 } from '../server/network.mjs';
import { createLocalserve, defaultConfig } from '../server.mjs';

test('LAN Host requires the actual private destination, local peer and exact port', () => {
  const request = { headers: { host: '10.23.42.3:7041' }, socket: { localAddress: '10.23.42.3', remoteAddress: '10.23.42.8' } };
  assert.equal(requestOrigin(request, 7041), 'http://10.23.42.3:7041');
  for (const host of ['evil.example:7041', '10.23.42.9:7041', '10.23.42.3:80', '0.0.0.0:7041', 'user@10.23.42.3:7041']) {
    assert.throws(() => requestOrigin({ ...request, headers: { host } }, 7041));
  }
  for (const remoteAddress of ['8.8.8.8', '169.254.1.2', '::', '10.23.42.8.example']) {
    assert.throws(() => requestOrigin({ ...request, socket: { ...request.socket, remoteAddress } }, 7041));
  }
  assert.equal(requestOrigin({ headers: { host: 'localhost:7041' }, socket: { localAddress: '127.0.0.1', remoteAddress: '127.0.0.1' } }, 7041), 'http://localhost:7041');
  assert.equal(requestOrigin({ headers: { host: '[::1]:7041' }, socket: { localAddress: '::1', remoteAddress: '::1' } }, 7041), 'http://[::1]:7041');
  assert.equal(requestOrigin({ headers: { host: '10.23.42.3' }, socket: request.socket }, 80), 'http://10.23.42.3');
  for (const host of ['127.0.0.1', '::1', '10.23.42.3']) assert.equal(validateListen({host, port: 0}).host, host);
  for (const host of ['8.8.8.8', 'example.com', '::', '0.0.0.0']) assert.throws(() => validateListen({host, port: 7041}));
});

test('specific LAN binding keeps localhost working and enforces same-address Origin for admin and Controls', async t => {
  const lan = Object.values(networkInterfaces()).flat().find(entry => entry.family === 'IPv4' && isPrivateIPv4(entry.address));
  if (!lan) return t.skip('No private IPv4 host interface available.');
  const temporary = fileURLToPath(new URL('./.tmp/', import.meta.url));
  await fs.mkdir(temporary, {recursive: true});
  const root = await fs.mkdtemp(path.join(temporary, 'network-'));
  await fs.writeFile(path.join(root, 'config.json'), JSON.stringify({...defaultConfig, listen: {host: lan.address, port: 0}}));
  const app = await createLocalserve(root, {automatic: false});
  t.after(async () => { await app.close(); assert.ok(path.resolve(root).startsWith(path.resolve(temporary) + path.sep)); await fs.rm(root, {recursive: true, force: true}); });
  assert.equal(app.server.address().address, '127.0.0.1');
  assert.match(app.origin, /127\.0\.0\.1/);
  const port = app.server.address().port;
  const lanOrigin = `http://${lan.address}:${port}`;
  const lanState = await fetch(lanOrigin + '/api/state');
  assert.equal(lanState.status, 200);
  assert.equal((await lanState.json()).server.address, lanOrigin);
  const host = `localhost:${port}`, origin = `http://${host}`;
  // Raw HTTP preserves custom Host headers; fetch can normalize them back to
  // its URL, hiding the alternate-address case this check needs to exercise.
  const raw = (endpoint, headers = {}, values) => new Promise((resolve, reject) => {
    const body = values === undefined ? null : JSON.stringify(values);
    const request = http.request(app.origin + endpoint, {method: body === null ? 'GET' : 'POST',
      headers: {...(body === null ? {} : {'Content-Type':'application/json'}), ...headers}}, response => {
      let output = ''; response.on('data', chunk => { output += chunk; });
      response.on('end', () => resolve({status:response.statusCode, body:JSON.parse(output)}));
    });
    request.on('error', reject); request.end(body);
  });
  const response = await raw('/api/state', {Host:host});
  assert.equal(response.status, 200);
  assert.equal(response.body.server.address, origin);
  const write = endpoint => raw(endpoint, {Host:host, Origin:origin, 'X-Localserve-Token':app.snapshot().token}, {name:'LAN test'});
  assert.equal((await write('/api/config')).status, 200);
  const wrong = await raw('/api/config', {Host:host, Origin:app.origin, 'X-Localserve-Token':app.snapshot().token}, {});
  assert.equal(wrong.status, 403, 'Token cannot bypass different-address Origin');
  assert.equal((await raw('/api/control-view/simulator/test/run', {Host:host, Origin:app.origin}, {})).status, 403);
  const spoofed = await new Promise((resolve,reject) => {
    const request = http.get(app.origin + '/api/state', {headers: {Host:`evil.example:${port}`}}, response => {response.resume(); resolve(response.statusCode);}); request.on('error',reject);
  });
  assert.equal(spoofed, 403);
});

test('HTTP LAN UUID fallback uses Web Crypto, keeps v4 bits, and retains a native implementation', async () => {
  const source = await fs.readFile(new URL('../web/browser-compat.js', import.meta.url), 'utf8');
  const crypto = {getRandomValues: bytes => webcrypto.getRandomValues(bytes)};
  vm.runInNewContext(source, {crypto, Uint8Array});
  const identifiers = Array.from({length:100}, () => crypto.randomUUID());
  assert.equal(new Set(identifiers).size, 100);
  for (const id of identifiers) assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  const native = () => 'native';
  vm.runInNewContext(source, {crypto: {randomUUID:native}, Uint8Array});
  assert.equal(native(), 'native');
});
