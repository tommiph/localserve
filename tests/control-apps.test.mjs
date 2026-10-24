/** Installation metadata and browser lifecycle checks, with no device actions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { controlAppManifest, controlAppHead } from '../server/control-apps.mjs';
import { createLocalserve } from '../server.mjs';

const project = new URL('../', import.meta.url);
function definition(presentation = 'television') {
  return {
    plugin: { id: 'test-plugin', controls: { television: true, lighting: {} } },
    page: { id: 'saved-page', slug: 'remote', name: 'My remote', presentation },
  };
}

test('each remote has local, scoped installation metadata without private values', () => {
  for (const presentation of ['television', 'lighting']) {
    const saved = definition(presentation);
    saved.page.items = [{ parameters: { secret: 'PRIVATE_ARGUMENT' } }];
    saved.plugin.settings = { token: 'PRIVATE_CREDENTIAL' };
    const manifest = controlAppManifest(saved, 'My server');
    assert.equal(manifest.name, 'My remote · My server');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.scope, manifest.start_url);
    assert.equal(manifest.start_url, '/controls/test-plugin/remote');
    assert.equal(manifest.theme_color, '#000000');
    assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512']);
    assert.ok(manifest.icons.every(icon => icon.purpose === 'any maskable' && icon.src.startsWith('/assets/controls/')));
    assert.doesNotMatch(JSON.stringify(manifest), /PRIVATE_|token|parameters/);
    const identity = manifest.id;
    saved.page.name = 'Renamed';
    saved.page.slug = 'renamed';
    assert.equal(controlAppManifest(saved, 'Renamed server').id, identity);
  }
  assert.equal(controlAppManifest(definition('mapped'), 'Server'), null);
  const noOptIn = definition();
  noOptIn.plugin.controls = {};
  assert.equal(controlAppManifest(noOptIn, 'Server'), null);
  const manifest = controlAppManifest(definition(), '<Server "name">');
  const head = controlAppHead(manifest);
  assert.match(head, /rel="manifest"/);
  assert.doesNotMatch(head, /<Server/);
  assert.match(head, /&lt;Server &quot;name&quot;&gt;/);
});

test('manifest HTTP routes enforce page lifecycle, methods and existing private boundaries', async t => {
  const temporary = fileURLToPath(new URL('./.tmp/', import.meta.url));
  await fs.mkdir(temporary, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporary, 'control-apps-'));
  // A source-only Simulator pretends to be a television presentation; no device
  // adapter, saved installation data or polling is present in this fixture.
  const folder = path.join(root, 'plugins/simulator');
  await fs.mkdir(path.join(folder, 'server'), { recursive: true });
  const declaration = JSON.parse(await fs.readFile(new URL('plugins/simulator/declaration.json', project)));
  declaration.controls = { actions: ['pulse'], television: true };
  await fs.writeFile(path.join(folder, 'declaration.json'), JSON.stringify(declaration));
  await fs.copyFile(new URL('plugins/simulator/server/index.mjs', project), path.join(folder, 'server/index.mjs'));
  await fs.mkdir(path.join(root, 'web'));
  await fs.copyFile(new URL('web/controls.html', project), path.join(root, 'web/controls.html'));
  const app = await createLocalserve(root, { automatic: false });
  t.after(async () => {
    await app.close();
    const parent = path.resolve(temporary);
    assert.ok(path.resolve(root).startsWith(parent + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  await app.controls.save('simulator', {
    schemaVersion: 1, name: 'TV test', slug: 'remote', presentation: 'television',
    enabled: true, columns: 1, icon: 'display', items: [],
  });
  const endpoint = app.origin + '/controls/simulator/remote/app.webmanifest';
  let response = await fetch(endpoint);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/manifest\+json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const manifest = await response.json();
  assert.equal(manifest.start_url, '/controls/simulator/remote');
  const html = await fetch(app.origin + manifest.start_url);
  assert.match(await html.text(), /href="\/controls\/simulator\/remote\/app.webmanifest"/);
  assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  response = await fetch(endpoint, { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
  assert.equal((await fetch(endpoint, { method: 'POST' })).status, 405);
  assert.equal((await fetch(app.origin + '/plugins/simulator/data/config.json')).status, 404);
  const saved = app.controls.pages('simulator')[0];
  await app.controls.save('simulator', { ...saved, enabled: false }, saved.id);
  assert.equal((await fetch(endpoint)).status, 404);
});

test('installation consumes one explicit prompt and does not queue or replay actions', async () => {
  const events = new Map(), buttons = new Map();
  const button = { hidden: true, addEventListener: (name, callback) => buttons.set(name, callback) };
  const mode = { matches: false, addEventListener() {} };
  const context = vm.createContext({
    window: { matchMedia: () => mode, addEventListener: (name, callback) => events.set(name, callback) },
    document: { querySelector: selector => selector === '#control-install' ? button : {} },
  });
  const source = await fs.readFile(new URL('web/control-app.js', project), 'utf8');
  vm.runInContext(source, context);
  let prompts = 0, prevented = 0;
  const event = { preventDefault: () => prevented++, prompt: async () => prompts++, userChoice: Promise.resolve({ outcome: 'dismissed' }) };
  events.get('beforeinstallprompt')(event);
  assert.equal(button.hidden, false);
  await buttons.get('click')();
  await buttons.get('click')();
  assert.equal(prompts, 1);
  assert.equal(prevented, 1);
  assert.equal(button.hidden, true);
  mode.matches = true;
  events.get('beforeinstallprompt')(event);
  assert.equal(button.hidden, true);
  events.get('appinstalled')();
  assert.equal(button.hidden, true);
  assert.doesNotMatch(source, /serviceWorker\.register|caches\.|localStorage|fetch\(/);
});
