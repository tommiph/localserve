/** Viewer receipts follow submitted commands without resending device input. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

async function viewer() {
  const nodes = new Map(),
    events = new Map(),
    timers = new Map();
  let sequence = 0,
    clock = 0,
    run = null,
    posts = 0,
    disabled = false,
    reject = false;
  for (const id of [
    'controls-board',
    'controls-feedback',
    'controls-status',
    'controls-cancel',
    'controls-logo',
    'controls-server-name',
    'controls-title',
  ])
    nodes.set('#' + id, {
      dataset: {},
      setAttribute() {},
      addEventListener() {},
      textContent: '',
      hidden: false,
    });
  const document = {
    hidden: false,
    visibilityState: 'visible',
    querySelector: (id) => nodes.get(id),
    documentElement: { dataset: {}, style: { setProperty() {} } },
    body: { classList: { toggle() {} } },
    addEventListener: (name, callback) => events.set('document:' + name, callback),
  };
  const context = vm.createContext({
    document,
    Date: { now: () => clock },
    AbortSignal,
    crypto: { randomUUID: () => String(++sequence).padStart(36, '0') },
    location: { pathname: '/controls/example/remote' },
    window: { addEventListener: (name, callback) => events.set('window:' + name, callback) },
    setInterval: () => 999,
    clearInterval() {},
    setTimeout: (callback, ms) => {
      const id = ++sequence;
      timers.set(id, { callback, ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    ControlsRenderer: { mount: (_host, value) => (disabled = value.busy), escape: (value) => value },
    fetch: async (_url, options = {}) => {
      if (options.method === 'POST') {
        posts++;
        if (reject) return { ok: false, status: 409, json: async () => ({ error: 'Unavailable' }) };
        run = { id: JSON.parse(options.body).requestId, status: 'running', message: 'Running' };
        return { ok: true, json: async () => ({ id: run.id, status: 'queued' }) };
      }
      return {
        ok: true,
        json: async () => ({
          options: { name: 'Localserve', theme: 'dark', fontScale: 100 },
          page: {
            id: 'p',
            revision: 1,
            name: 'Remote',
            pluginName: 'Example',
            presentation: 'mapped',
            items: [],
          },
          available: true,
          busy: run?.status === 'running',
          activeRunId: run?.status === 'running' ? run.id : null,
          runs: run ? [{ ...run }] : [],
          token: 'fixture',
        }),
      };
    },
  });
  vm.runInContext(
    (await fs.readFile(new URL('../web/controls-viewer.js', import.meta.url), 'utf8')) +
      ';globalThis.viewer={invoke,refresh};',
    context,
  );
  await new Promise((resolve) => setImmediate(resolve));
  return {
    context,
    document,
    timers,
    events,
    get posts() {
      return posts;
    },
    get disabled() {
      return disabled;
    },
    complete() {
      run.status = 'completed';
      run.message = 'Completed';
    },
    reject() {
      reject = true;
    },
    advance(value) {
      clock += value;
    },
    async submit() {
      await context.viewer.invoke('button');
      await new Promise((resolve) => setImmediate(resolve));
    },
    async follow() {
      const entry = [...timers].find(([, value]) => value.ms === 75);
      assert.ok(entry, 'A prompt receipt read is scheduled.');
      timers.delete(entry[0]);
      await entry[1].callback();
    },
  };
}
test('a completed receipt enables the next press before ordinary polling, with exactly one POST', async () => {
  const f = await viewer();
  await f.submit();
  assert.equal(f.disabled, true);
  assert.equal(f.posts, 1);
  f.complete();
  await f.follow();
  assert.equal(f.disabled, false);
  assert.equal(f.posts, 1);
  assert.equal(f.timers.size, 0);
});
test('receipt following stops while hidden and cannot become an unbounded retry loop', async () => {
  const f = await viewer();
  await f.submit();
  f.document.hidden = true;
  f.document.visibilityState = 'hidden';
  f.events.get('document:visibilitychange')();
  assert.equal(f.timers.size, 0);
  f.document.hidden = false;
  f.document.visibilityState = 'visible';
  await f.context.viewer.refresh();
  assert.equal(f.timers.size, 1);
  f.advance(35001);
  await f.follow();
  assert.equal(f.timers.size, 0);
  assert.equal(f.posts, 1);
});
test('an explicit rejected admission releases the local pending state without retry', async () => {
  const f = await viewer();
  f.reject();
  await f.submit();
  assert.equal(f.posts, 1);
  assert.equal(f.disabled, false);
  assert.equal(f.timers.size, 0);
});
