/** Retention uses disposable roots only; no installed history is modified. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ActivityLog } from '../server/storage.mjs';
import { createLocalserve, defaultConfig } from '../server.mjs';

const temporaryRoot = fileURLToPath(new URL('./.tmp/', import.meta.url));
const day = 86400000;
const record = (id, at) => JSON.stringify({ id, at, message: id });

async function folder(t, beforeDelete = async () => {}) {
  await fs.mkdir(temporaryRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporaryRoot, 'retention-'));
  t.after(async () => {
    await beforeDelete();
    assert.ok(path.resolve(root).startsWith(path.resolve(temporaryRoot) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

test('startup removes expired disk entries, retains all recent history beyond the UI cache and preserves undated lines', async t => {
  const root = await folder(t), file = path.join(root, 'activity.jsonl');
  const now = 100 * day;
  await fs.writeFile(file, [record('old', now - 31 * day), record('boundary', now - 30 * day),
    record('first', now - day), record('second', now), '{partial', '{"message":"unknown date"}'].join('\n'));
  const log = await new ActivityLog(file, 2, { now: () => now, retentionDays: () => 30 }).load();
  const disk = await fs.readFile(file, 'utf8');
  assert.doesNotMatch(disk, /"old"/);
  for (const kept of ['boundary', 'first', 'second', '{partial', 'unknown date']) assert.ok(disk.includes(kept));
  assert.equal(log.latest().length, 2);
  assert.ok(!(await fs.readdir(root)).some(name => name.endsWith('.tmp')));
});

test('idle expiry and setting changes prune disk and memory while queued appends survive', async t => {
  const root = await folder(t), file = path.join(root, 'activity.jsonl');
  let now = 100 * day, days = 30;
  const log = await new ActivityLog(file, 10, { now: () => now, retentionDays: () => days }).load();
  await log.add('expires');
  now += 31 * day;
  assert.equal(log.latest().length, 0, 'Expired UI rows disappear before maintenance');
  await log.prune();
  assert.doesNotMatch(await fs.readFile(file, 'utf8'), /expires/);
  const writes = Array.from({ length: 25 }, (_, index) => log.add(`retained-${index}`));
  const pruning = log.prune(true);
  writes.push(log.add('after-prune'));
  await Promise.all([...writes, pruning]);
  const disk = await fs.readFile(file, 'utf8');
  for (let index = 0; index < 25; index++) assert.ok(disk.includes(`"retained-${index}"`));
  assert.ok(disk.includes('after-prune'));
  now += 2 * day; days = 1;
  await log.prune(true);
  assert.equal(log.latest().length, 0);
  assert.equal(await fs.readFile(file, 'utf8'), '');
});

test('failed atomic replacement preserves history, removes its temporary file and allows a later retry', async t => {
  const root = await folder(t), file = path.join(root, 'activity.jsonl');
  let now = 100 * day;
  const log = await new ActivityLog(file, 10, { now: () => now, retentionDays: () => 1 }).load();
  await log.add('old'); now += 2 * day;
  const before = await fs.readFile(file, 'utf8');
  const rename = fs.rename;
  fs.rename = async (from, to) => {
    if (to === file) throw Object.assign(new Error('Replacement denied'), { code: 'EACCES' });
    return rename(from, to);
  };
  try { await assert.rejects(log.prune(), /Replacement denied/); }
  finally { fs.rename = rename; }
  assert.equal(await fs.readFile(file, 'utf8'), before);
  assert.ok(!(await fs.readdir(root)).some(name => name.endsWith('.tmp')));
  await log.add('new');
  await log.prune();
  const disk = await fs.readFile(file, 'utf8');
  assert.doesNotMatch(disk, /"old"/); assert.match(disk, /"new"/);
});

test('one validated preference migrates, saves and cleans server plus disabled plugin Activity through restart', async t => {
  let app;
  const root = await folder(t, () => app?.close()), source = fileURLToPath(new URL('../plugins/simulator/', import.meta.url));
  const plugin = path.join(root, 'plugins/simulator');
  await fs.mkdir(path.join(plugin, 'server'), { recursive: true });
  await fs.mkdir(path.join(plugin, 'data'), { recursive: true });
  await fs.mkdir(path.join(root, 'data'), { recursive: true });
  for (const file of ['declaration.json', 'server/index.mjs']) await fs.copyFile(path.join(source, file), path.join(plugin, file));
  const legacy = { ...defaultConfig }; delete legacy.activityRetentionDays;
  await fs.writeFile(path.join(root, 'config.json'), JSON.stringify(legacy));
  const globalLog = path.join(root, 'data/activity.jsonl'), pluginLog = path.join(plugin, 'data/activity.jsonl');
  const seed = [record('expired-at-startup', Date.now() - 40 * day), record('expires-on-save', Date.now() - 7 * day), record('recent', Date.now())].join('\n');
  for (const file of [globalLog, pluginLog]) await fs.writeFile(file, seed);
  app = await createLocalserve(root, { automatic: false });
  assert.equal(app.config.snapshot().activityRetentionDays, 30);
  assert.equal(app.registry.services()[0].enabled, false);
  const call = async days => {
    const response = await fetch(app.origin + '/api/config', { method: 'POST', headers: {
      'Content-Type': 'application/json', Origin: app.origin, 'X-Localserve-Token': app.snapshot().token,
    }, body: JSON.stringify({ activityRetentionDays: days }) });
    return response.status;
  };
  for (const invalid of [0, -1, 3651, 1.5, '7', null]) assert.equal(await call(invalid), 400);
  assert.equal(app.config.snapshot().activityRetentionDays, 30);
  assert.equal(await call(3), 200);
  for (const file of [globalLog, pluginLog]) {
    const disk = await fs.readFile(file, 'utf8');
    assert.doesNotMatch(disk, /expired-at-startup|expires-on-save/); assert.match(disk, /recent/);
  }
  assert.ok(!app.registry.records.get('simulator').log.latest().some(entry => entry.id === 'expires-on-save'));
  await app.close();
  app = await createLocalserve(root, { automatic: false });
  assert.equal(app.config.snapshot().activityRetentionDays, 3);
  assert.equal(app.registry.services()[0].enabled, false);
  assert.equal(await call(3650), 200);
  assert.doesNotMatch(await fs.readFile(globalLog, 'utf8'), /expires-on-save/, 'Increasing retention cannot resurrect deleted records');
});
