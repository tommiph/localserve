/** Phone publishing and execution use isolated stores and log-only Tasks. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createLocalserve } from '../server.mjs';
import { remoteSummary } from '../server/phone-home.mjs';
import { listenBrowserHttp } from '../server/network.mjs';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';

test('automatic HTTP binding skips browser-blocked ports and preserves explicit choices and failures', async () => {
  class Listener extends EventEmitter {
    constructor(ports, error) {
      super();
      this.ports = ports;
      this.error = error;
      this.calls = [];
      this.closed = 0;
    }
    listen(port, host, ready) {
      this.calls.push({ port, host });
      if (this.error) {
        this.emit('error', this.error);
        return;
      }
      this.port = this.ports.shift();
      ready();
    }
    address() {
      return { port: this.port };
    }
    close(done) {
      this.closed++;
      done();
    }
  }
  const automatic = new Listener([6667, 10080, 7041]);
  await listenBrowserHttp(automatic, 0, '127.0.0.1');
  assert.equal(automatic.port, 7041);
  assert.equal(automatic.closed, 2);
  assert.equal(automatic.listenerCount('error'), 0);
  assert.deepEqual(
    automatic.calls,
    Array.from({ length: 3 }, () => ({ port: 0, host: '127.0.0.1' })),
  );
  const explicit = new Listener([7041]);
  await listenBrowserHttp(explicit, 7041, '127.0.0.1');
  assert.equal(explicit.calls.length, 1);
  assert.equal(explicit.closed, 0);
  const error = new Error('Occupied'),
    occupied = new Listener([], error);
  await assert.rejects(listenBrowserHttp(occupied, 7041, '127.0.0.1'), error);
  assert.equal(occupied.calls.length, 1);
  assert.equal(occupied.closed, 0);
  const bounded = new Listener(Array(64).fill(6667));
  await assert.rejects(listenBrowserHttp(bounded, 0, '127.0.0.1'), /Unable to select/);
  assert.equal(bounded.closed, 64);
});

async function fixture(t) {
  const base = fileURLToPath(new URL('./.tmp/', import.meta.url));
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'phone-home-'));
  const app = await createLocalserve(root, { automatic: false });
  t.after(async () => {
    await app.close();
    assert.ok(root.startsWith(base));
    await fs.rm(root, { recursive: true, force: true });
  });
  const post = async (route, body, headers = {}) => {
    const response = await fetch(app.origin + route, {
      method: 'POST',
      headers: {
        Origin: app.origin,
        'Content-Type': 'application/json',
        'X-Localserve-Token': app.snapshot().token,
        ...headers,
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const add = async (
    name = 'Shortcut',
    steps = [{ id: 'log', type: 'log', enabled: true, message: 'Phone shortcut' }],
  ) => {
    const response = await post('/api/tasks', { name, enabled: true, starts: [], steps });
    assert.equal(response.status, 200, JSON.stringify(response));
    return app.tasks.snapshot().find((task) => task.name === name);
  };
  const publish = async (tasks) =>
    post('/api/phone-home/settings', {
      revision: app.phoneHome.admin().revision,
      tasks: tasks.map((task) => ({ taskId: task.id, icon: 'play', enabled: true })),
    });
  const viewer = () => app.phoneHome.viewer();
  const admission = (task, view = viewer(), requestId = randomUUID()) => {
    const item = view.tasks.find((item) => item.id === task.id);
    return {
      body: {
        taskId: item.id,
        revision: item.revision,
        homeRevision: view.revision,
        expires: item.expires,
        requestId,
      },
      token: item.token,
    };
  };
  const run = ({ body, token }, headers = {}) =>
    post('/api/phone-home/run', body, {
      'X-Localserve-Token': 'not-an-admin-token',
      'X-Localserve-Home-Token': token,
      ...headers,
    });
  const settle = async () => {
    for (let n = 0; app.engine.active.size || app.engine.pending.size; n++) {
      if (n > 300) throw new Error('Task did not finish');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  return { app, root, post, add, publish, viewer, admission, run, settle };
}

test('remote summaries retain reported zero/off and never infer device state from buttons', () => {
  assert.equal(remoteSummary({ lighting: { lights: [{ on: false, brightness: 0 }] } }), 'Reported off');
  assert.equal(remoteSummary({ lighting: { groups: [{ on: true, brightness: 0 }] } }), 'Reported on · 0%');
  assert.equal(remoteSummary({ lighting: { lights: [{ on: true }, { on: null }] } }), 'State unknown');
  assert.equal(
    remoteSummary({ page: { items: [{ remoteRole: 'volume', hasReading: true, reported: 0 }] } }),
    'Reported volume 0',
  );
  assert.equal(remoteSummary({ page: { items: [{ remoteRole: 'power', hasReading: false }] } }), null);
});

test('Home defaults to no published Tasks and exposes no administrator state or values', async (t) => {
  const f = await fixture(t);
  await f.add('Private Task');
  const response = await fetch(f.app.origin + '/api/phone-home'),
    view = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(view.tasks, []);
  assert.deepEqual(view.remotes, []);
  assert.equal(view.token, undefined);
  assert.equal(view.config, undefined);
  assert.equal(view.activity, undefined);
  assert.ok(!JSON.stringify(view).includes('Private Task'));
  assert.equal(
    (await f.post('/api/phone-home/settings', { revision: 1, tasks: [] }, { 'X-Localserve-Token': 'wrong' }))
      .status,
    403,
  );
  assert.equal((await fetch(f.app.origin + '/api/phone-home?task=private')).status, 405);
});

function informationService() {
  return {
    id: 'information',
    name: 'Information',
    icon: 'sensors',
    enabled: true,
    config: { token: 'private-configuration' },
    pluginState: { internal: 'private-state' },
    cardCatalog: [
      { id: 'lux', type: 'number' },
      {
        id: 'rows',
        type: 'table',
        columns: [
          { id: 'title', type: 'string' },
          { id: 'secret', type: 'string' },
        ],
      },
      { id: 'unselected', type: 'string' },
    ],
    cardData: {
      pluginName: 'Information',
      icon: 'sensors',
      status: 'Ready',
      values: {
        lux: { type: 'number', available: true, value: 0 },
        rows: {
          type: 'table',
          available: true,
          value: [{ title: 'Headline', secret: 'private-column' }, { title: 'Extra row' }],
        },
        unselected: { type: 'string', available: true, value: 'private-unselected' },
      },
      readyMade: {
        templates: [
          {
            id: 'reading',
            name: 'Reading',
            url: '/plugin-card-assets/information/reading/index.html',
            slots: [
              { id: 'value', field: 'lux', type: 'number', format: 'number' },
              {
                id: 'headlines',
                field: 'rows',
                type: 'table',
                rows: 1,
                columns: [{ id: 'title', type: 'string' }],
              },
            ],
          },
        ],
        sources: [
          { id: 'phone', name: 'Phone', enabled: true, bindings: { lux: 'lux', rows: 'rows' } },
          { id: 'disabled', name: 'Disabled device', enabled: false, bindings: {} },
        ],
      },
    },
  };
}

test('a phone shell without the Card renderer keeps Home connected and explains the required app update', async () => {
  const nodes = new Map();
  const host = { dataset: { cardHost: 'card:information:reading:phone' }, innerHTML: '' };
  for (const id of ['content', 'sheet', 'connection', 'server-name'])
    nodes.set('#' + id, {
      dataset: {},
      innerHTML: '',
      textContent: '',
      addEventListener() {},
    });
  const requests = [];
  const context = vm.createContext({
    document: {
      hidden: false,
      querySelector: (selector) => nodes.get(selector),
      querySelectorAll: (selector) => (selector === '[data-card-host]' ? [host] : []),
      addEventListener() {},
    },
    window: { addEventListener() {} },
    localStorage: { getItem: () => null },
    AbortController,
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    fetch: async (route) => {
      requests.push(route);
      return {
        ok: true,
        json: async () => ({
          name: 'Localserve',
          paused: false,
          remotes: [],
          tasks: [],
          cards: [
            {
              pluginId: 'information',
              templateId: 'reading',
              sourceId: 'phone',
              name: 'Phone',
              icon: 'sensors',
              available: true,
            },
          ],
        }),
      };
    },
  });
  const source = await fs.readFile(new URL('../web/phone-home.js', import.meta.url), 'utf8');
  // Git checkouts may use either line ending; instrumentation must replace
  // only the final automatic start without depending on newline bytes.
  for (const code of [source.replace(/\r\n/g, '\n'), source.replace(/\r?\n/g, '\r\n')]) {
    const instrumented = code.replace(/\bstart\(\);(?=\s*\}\)\(\);\s*$)/, 'globalThis.phoneHomeTest = { refresh };');
    assert.notEqual(instrumented, code, 'Expected the final startup call');
    requests.length = 0;
    vm.runInContext(instrumented, context);
    await context.phoneHomeTest.refresh();
    assert.equal(nodes.get('#connection').textContent, 'Connected');
    assert.match(host.innerHTML, /Update the Localserve Android app/);
    assert.deepEqual(requests, ['/api/phone-home']);
  }
});

test('Home discovers installed ready-made designs without remotes or saved Cards and projects selected public readings only', async (t) => {
  const f = await fixture(t),
    service = informationService();
  f.app.phoneHome.registry = { services: () => [service] };
  const index = await fetch(f.app.origin + '/api/phone-home').then((response) => response.json());
  assert.equal(index.remotes.length, 0);
  assert.equal(index.cards.length, 1);
  assert.equal(index.cards[0].sourceId, 'phone');
  assert.equal(index.cards[0].name, 'Phone');
  assert.ok(!JSON.stringify(index).includes('bindings'));
  assert.ok(!JSON.stringify(index).includes('private-'));
  const response = await fetch(f.app.origin + '/api/phone-home/cards/information/reading/phone');
  assert.equal(response.status, 200);
  const card = await response.json();
  assert.equal(card.card.layout, 'readymade');
  assert.equal(card.data.values.lux.value, 0);
  assert.deepEqual(card.data.values.rows.value, [{ title: 'Headline' }]);
  assert.deepEqual(card.catalog.find((field) => field.id === 'rows').columns, [
    { id: 'title', type: 'string' },
  ]);
  assert.ok(!JSON.stringify(card).includes('private-'));
  assert.equal(card.options.theme, 'dark');
  assert.equal(card.options.fontScale, 100);
  assert.deepEqual(f.app.phoneHome.admin(), { revision: 1, tasks: [] });
  assert.equal(f.app.tasks.snapshot().length, 0);
});

test('Home Card reads revoke disabled plugins, sources and removed designs without serving retained data', async (t) => {
  const f = await fixture(t),
    service = informationService();
  f.app.phoneHome.registry = { services: () => [service] };
  const route = f.app.origin + '/api/phone-home/cards/information/reading/phone';
  service.enabled = false;
  assert.deepEqual(f.app.phoneHome.viewer().cards, []);
  assert.equal((await fetch(route)).status, 404);
  service.enabled = true;
  service.cardData.readyMade.sources[0].enabled = false;
  assert.equal((await fetch(route)).status, 404);
  service.cardData.readyMade.sources[0].enabled = true;
  assert.equal((await fetch(route + '?source=elsewhere')).status, 405);
  assert.equal((await fetch(route, { method: 'POST' })).status, 405);
  service.cardData.readyMade.templates = [];
  assert.equal((await fetch(route)).status, 404);
});
test('published Task starts once through a scoped capability and returns only its receipt', async (t) => {
  const f = await fixture(t),
    task = await f.add();
  assert.equal((await f.publish([task])).status, 200);
  const request = f.admission(task),
    result = await f.run(request);
  assert.equal(result.status, 202, JSON.stringify(result));
  await f.settle();
  assert.equal((await f.run(request)).status, 202);
  assert.equal(f.app.state.snapshot().runs.length, 1);
  assert.deepEqual(Object.keys(result.body).sort(), ['requestId', 'status', 'token']);
  const receipt = await fetch(f.app.origin + '/api/phone-home/receipts/' + request.body.requestId, {
    headers: { 'X-Localserve-Home-Token': result.body.token },
  });
  assert.equal((await receipt.json()).status, 'completed');
  assert.equal(
    (await fetch(f.app.origin + '/api/phone-home/receipts/' + request.body.requestId)).status,
    403,
  );
});
test('Home rejects cross-origin, injected Event arguments, expired tokens, revision changes and revoked shortcuts', async (t) => {
  const f = await fixture(t),
    task = await f.add();
  await f.publish([task]);
  const request = f.admission(task);
  assert.equal((await f.run(request, { Origin: 'https://outside.example' })).status, 403);
  assert.equal((await f.run({ ...request, body: { ...request.body, eventRunId: 'saved' } })).status, 400);
  assert.equal((await f.run({ ...request, body: { ...request.body, expires: 1 } })).status, 403);
  assert.equal((await f.run({ ...request, token: '0'.repeat(64) })).status, 403);
  await f.publish([]);
  assert.equal((await f.run(request)).status, 409);
  await f.publish([task]);
  const changed = f.admission(task);
  await f.post('/api/tasks/' + task.id, { ...task, name: 'Changed' });
  assert.equal((await f.run(changed)).status, 409);
  assert.equal(f.app.state.snapshot().runs.length, 0);
});
test('pause, disabled and Event-dependent Tasks remain unavailable and cannot be launched', async (t) => {
  const f = await fixture(t),
    task = await f.add();
  await f.publish([task]);
  await f.app.engine.setPaused(true);
  assert.equal(f.viewer().tasks[0].available, false);
  assert.equal((await f.run(f.admission(task))).status, 409);
  await f.app.engine.setPaused(false);
  await f.post('/api/tasks/' + task.id + '/enabled', { revision: task.revision, enabled: false });
  assert.equal(f.viewer().tasks[0].available, false);
  assert.equal((await f.run(f.admission(task))).status, 409);
  // Use a declared source only for validation; no fabricated Event is emitted.
  f.app.registry.events = () => [
    {
      id: 'plugin:example:event:changed',
      pluginId: 'example',
      eventId: 'changed',
      payload: [{ id: 'title', type: 'string', required: true, maxLength: 100 }],
    },
  ];
  assert.equal(
    (
      await f.post('/api/tasks', {
        name: 'Needs Event',
        enabled: true,
        starts: [
          {
            id: 'event',
            name: 'Event',
            type: 'event',
            enabled: true,
            eventId: 'plugin:example:event:changed',
          },
        ],
        steps: [{ id: 'log', type: 'log', enabled: true, message: '{{event.title}}' }],
      })
    ).status,
    200,
  );
  const eventTask = f.app.tasks.snapshot().find((task) => task.name === 'Needs Event');
  await f.publish([eventTask]);
  assert.equal(f.viewer().tasks[0].available, false);
  assert.equal((await f.run(f.admission(eventTask))).status, 409);
  assert.equal(f.app.state.snapshot().runs.length, 0);
});
test('simultaneous duplicate admissions and failed durable claims never execute twice', async (t) => {
  const f = await fixture(t),
    task = await f.add();
  await f.publish([task]);
  const request = f.admission(task);
  const results = await Promise.all([f.run(request), f.run(request)]);
  assert.ok(results.some((result) => result.status === 202));
  await f.settle();
  assert.equal(f.app.state.snapshot().runs.length, 1);
  const write = f.app.phoneHome.claims.write;
  f.app.phoneHome.claims.write = async () => {
    throw new Error('Disk unavailable');
  };
  assert.equal((await f.run(f.admission(task))).status, 500);
  f.app.phoneHome.claims.write = write;
  assert.equal(f.app.state.snapshot().runs.length, 1);
});
test('publishing is revisioned, does not edit Tasks and drains before shutdown', async (t) => {
  const f = await fixture(t),
    task = await f.add();
  const before = f.app.tasks.snapshot();
  assert.equal((await f.publish([task])).status, 200);
  assert.deepEqual(f.app.tasks.snapshot(), before);
  assert.equal((await f.post('/api/phone-home/settings', { revision: 1, tasks: [] })).status, 409);
  assert.equal((await f.publish([task, task])).status, 400);
  assert.equal((await f.publish([{ id: 'missing' }])).status, 400);
  f.app.phoneHome.closing = true;
  assert.equal((await f.run(f.admission(task))).status, 503);
});

test('restart keeps consumed requests and never replays an interrupted admission', async (t) => {
  const f = await fixture(t),
    task = await f.add();
  await f.publish([task]);
  const request = f.admission(task);
  await f.app.phoneHome.claims.update((items) =>
    items.push({
      id: request.body.requestId,
      taskId: task.id,
      expires: request.body.expires,
      status: 'interrupted',
    }),
  );
  await f.app.close();
  const restarted = await createLocalserve(f.root, { automatic: false });
  try {
    await assert.rejects(
      restarted.phoneHome.run(request.body, request.token),
      (error) => error.status === 403,
    );
    const current = restarted.phoneHome.viewer().tasks[0];
    const receipt = await restarted.phoneHome.run(
      { ...request.body, expires: current.expires },
      current.token,
    );
    assert.equal(receipt.status, 'interrupted');
    assert.equal(restarted.state.snapshot().runs.length, 0);
  } finally {
    await restarted.close();
  }
});

test('shutdown drains a blocked claim and refuses admission after the claim write', async (t) => {
  const f = await fixture(t),
    task = await f.add();
  await f.publish([task]);
  const write = f.app.phoneHome.claims.write.bind(f.app.phoneHome.claims);
  let release, entered;
  const writing = new Promise((resolve) => (entered = resolve)),
    blocked = new Promise((resolve) => (release = resolve));
  f.app.phoneHome.claims.write = async (value) => {
    entered();
    await blocked;
    await write(value);
  };
  const pending = f.app.phoneHome.run(f.admission(task).body, f.viewer().tasks[0].token);
  const rejected = assert.rejects(pending, (error) => error.status === 503);
  await writing;
  let drained = false;
  const close = f.app.phoneHome.close().then(() => (drained = true));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(drained, false);
  release();
  await rejected;
  await close;
  assert.equal(f.app.state.snapshot().runs.length, 0);
});
