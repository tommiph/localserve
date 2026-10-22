/** Viewer lifecycle checks use only synthetic HTTP replies and inert DOM nodes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const code = await fs.readFile(new URL('../web/vista-viewer.js', import.meta.url), 'utf8');
function fixture(fetch) {
  const handlers = {}, intervals = new Map(), updates = [];
  let serial = 0, disposed = 0;
  const display = {children: [], setAttribute() {}, replaceChildren(node) { this.children = [node]; }};
  const status = {hidden: true}, favicon = {getAttribute() {return '';}, setAttribute() {}};
  const document = {title: '', documentElement: {dataset: {}, style: {setProperty() {}}},
    querySelector(selector) {return selector === '#vista-display' ? display : selector === '#vista-status' ? status : favicon;},
    createElement() {return {};}};
  const context = vm.createContext({document, location: {pathname: '/vistas/test'}, fetch, AbortController,
    VistaRenderer: {create() {return {update(value) {updates.push(value);}, destroy() {disposed++;}};}},
    window: {addEventListener(name, handler) {handlers[name] = handler;}},
    setInterval(callback) {const id = ++serial; intervals.set(id, callback); return id;},
    clearInterval(id) {intervals.delete(id);}});
  vm.runInContext(code + '\nglobalThis.viewer = {pollVista};', context);
  return {context, document, display, status, intervals, updates, handlers, get disposed() {return disposed;}};
}
const reply = (name = 'Recovered') => ({ok: true, status: 200, json: async () => ({
  vista: {name}, cards: [], options: {name: 'Fixture', theme: 'dark', fontScale: 100},
})});
const settle = async () => {for (let i = 0; i < 8; i++) await Promise.resolve();};

test('an unavailable own-URL Vista recovers on the next read without restoring disabled content', async () => {
  let available = false;
  const f = fixture(async () => available ? reply() : {ok: false, status: 404});
  await settle();
  assert.equal(f.intervals.size, 1);
  assert.equal(f.updates.length, 0);
  assert.equal(f.display.children[0].textContent, 'Vista unavailable');
  assert.equal(f.status.hidden, false);
  available = true;
  await f.context.viewer.pollVista();
  assert.equal(f.updates.at(-1).vista.name, 'Recovered');
  assert.equal(f.status.hidden, true);
  assert.equal(f.intervals.size, 1);
});

test('pagehide aborts old reads and pageshow starts one fresh viewer without late-result replacement', async () => {
  let resolveOld, calls = 0;
  const f = fixture(() => ++calls === 1 ? new Promise(resolve => {resolveOld = resolve;}) : Promise.resolve(reply('Restored')));
  f.handlers.pagehide();
  assert.equal(f.intervals.size, 0);
  f.handlers.pageshow();
  f.handlers.pageshow();
  await settle();
  assert.equal(calls, 2);
  assert.equal(f.intervals.size, 1);
  assert.equal(f.document.title, 'Restored · Fixture');
  resolveOld(reply('Obsolete'));
  await settle();
  assert.equal(f.document.title, 'Restored · Fixture');
  assert.equal(f.updates.length, 1);
  f.handlers.pagehide();
  assert.equal(f.intervals.size, 0);
  assert.ok(f.disposed >= 2);
});
