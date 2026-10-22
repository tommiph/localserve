/** Scoped phone shortcuts. Publishing grants manual execution, never editing or
 * historical Event access. Durable request claims prevent ambiguous retries. */
import path from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { JsonStore, HttpError } from './storage.mjs';
import { glyphs } from './plugin-schema.mjs';
import { selectedCardData } from './cards.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function remoteSummary(view) {
  const lights = view.lighting?.lights?.length ? view.lighting.lights : view.lighting?.groups;
  if (lights?.length) {
    const known = lights.filter((light) => typeof light.on === 'boolean');
    if (known.length !== lights.length) return 'State unknown';
    const on = known.filter((light) => light.on).length;
    return known.length === 1
      ? (on ? 'Reported on' : 'Reported off') +
          (on && Number.isFinite(known[0].brightness) ? ' · ' + known[0].brightness + '%' : '')
      : `${on} of ${known.length} on`;
  }
  const volume = view.page?.items?.find(
    (item) => item.remoteRole === 'volume' && item.hasReading && Number.isFinite(item.reported),
  );
  return volume ? 'Reported volume ' + volume.reported : null;
}
export class PhoneHome {
  constructor(root, tasks, engine, controls, config, state, registry) {
    Object.assign(this, { root, tasks, engine, controls, config, state, registry });
    this.secret = randomBytes(32);
    this.closing = false;
    this.operations = new Set();
  }
  async load() {
    this.store = await new JsonStore(path.join(this.root, 'data/phone-home.json'), {
      revision: 1,
      tasks: [],
    }).load();
    this.claims = await new JsonStore(path.join(this.root, 'data/phone-home-runs.json'), []).load();
    this.validate(this.store.snapshot());
    if (!Array.isArray(this.claims.snapshot()) || this.claims.snapshot().length > 256)
      throw new Error('Invalid phone shortcut receipts; original data was retained.');
    return this;
  }
  validate(value) {
    if (
      !value ||
      Object.keys(value).some((key) => !['revision', 'tasks'].includes(key)) ||
      !Number.isSafeInteger(value.revision) ||
      value.revision < 1 ||
      !Array.isArray(value.tasks) ||
      value.tasks.length > 32
    )
      throw new HttpError(400, 'Choose up to 32 phone shortcuts.');
    const ids = new Set();
    for (const item of value.tasks) {
      if (
        !item ||
        Object.keys(item).some((key) => !['taskId', 'icon', 'enabled', 'label'].includes(key)) ||
        item.label !== undefined && (typeof item.label !== 'string' || item.label.length > 40 || item.label.trim() !== item.label) ||
        typeof item.taskId !== 'string' ||
        item.taskId.length > 80 ||
        ids.has(item.taskId) ||
        !glyphs.includes(item.icon) ||
        typeof item.enabled !== 'boolean'
      )
        throw new HttpError(400, 'Choose each Task once with a valid glyph and enabled state.');
      ids.add(item.taskId);
    }
  }
  admin() {
    return this.store.snapshot();
  }
  async save(value) {
    this.validate(value);
    await this.store.update((current) => {
      if (this.closing) throw new HttpError(503, 'Server is stopping.');
      if (value.revision !== current.revision)
        throw new HttpError(409, 'Phone shortcuts changed. Reopen the editor.');
      for (const item of value.tasks)
        if (!this.tasks.snapshot().some((task) => task.id === item.taskId))
          throw new HttpError(400, 'A selected Task no longer exists.');
      current.tasks = structuredClone(value.tasks);
      current.revision++;
    });
  }
  sign(text) {
    return createHmac('sha256', this.secret).update(text).digest('hex');
  }
  taskToken(id, revision, expires, homeRevision) {
    return this.sign(JSON.stringify([id, revision, expires, homeRevision]));
  }
  equal(a, b) {
    return (
      typeof a === 'string' &&
      /^[a-f0-9]{64}$/.test(a) &&
      timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
    );
  }
  available(task) {
    try {
      this.engine.assertStart(task, null, task.revision);
      return true;
    } catch {
      return false;
    }
  }
  cardIndex(services = this.registry?.services() || []) {
    // Installed designs and enabled named sources are sufficient. Phone
    // favorites never create or edit the administrator's saved Cards.
    return services
      .filter((service) => service.enabled)
      .flatMap((service) => {
        const catalog = service.cardData?.readyMade;
        return (catalog?.templates || []).flatMap((template) =>
          catalog.sources
            .filter((source) => source.enabled)
            .map((source) => ({
              pluginId: service.id,
              templateId: template.id,
              sourceId: source.id,
              name: source.name,
              designName: template.name,
              pluginName: service.name,
              icon: service.icon,
              available: !this.closing,
            })),
        );
      });
  }
  card(pluginId, templateId, sourceId) {
    const services = this.registry?.services() || [];
    const entry = this.cardIndex(services).find(
      (item) => item.pluginId === pluginId && item.templateId === templateId && item.sourceId === sourceId,
    );
    if (!entry?.available) throw new HttpError(404, 'Card unavailable.');
    const service = services.find((item) => item.id === pluginId);
    const card = { name: entry.name, layout: 'readymade', templateId, sourceId, fields: [] };
    const config = this.config.snapshot();
    return {
      card,
      ...selectedCardData(card, service.cardData, service.cardCatalog),
      options: {
        theme: 'dark',
        fontScale: 100,
        timeFormat: config.timeFormat,
        timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
        now: Date.now(),
      },
    };
  }
  viewer() {
    const home = this.store.snapshot(),
      expires = (Math.floor(Date.now() / 60000) + 5) * 60000;
    const pages = this.controls.index().pages.map((page) => {
      let summary = null;
      try {
        summary = remoteSummary(this.controls.viewer(page.pluginId, page.slug));
      } catch {
        /* An unavailable mapping remains visible without guessed state. */
      }
      return { ...page, summary };
    });
    return {
      name: this.config.snapshot().name,
      paused: this.engine.gate.paused,
      revision: home.revision,
      remotes: pages,
      cards: this.cardIndex(),
      tasks: home.tasks
        .filter((item) => item.enabled)
        .flatMap((item) => {
          const task = this.tasks.snapshot().find((task) => task.id === item.taskId);
          if (!task) return [];
          return [
            {
              id: task.id,
              name: item.label || task.name,
              taskName: task.name,
              icon: item.icon,
              revision: task.revision,
              available: !this.closing && this.available(task),
              expires,
              token: this.taskToken(task.id, task.revision, expires, home.revision),
            },
          ];
        }),
    };
  }
  run(value, token) {
    const operation = this.admit(value, token);
    this.operations.add(operation);
    operation.finally(() => this.operations.delete(operation)).catch(() => {});
    return operation;
  }
  async admit(value, token) {
    if (
      !value ||
      Object.keys(value).some(
        (key) => !['taskId', 'revision', 'homeRevision', 'requestId', 'expires'].includes(key),
      ) ||
      !uuid.test(value.requestId) ||
      !Number.isSafeInteger(value.expires) ||
      !Number.isSafeInteger(value.revision) ||
      !Number.isSafeInteger(value.homeRevision) ||
      typeof value.taskId !== 'string'
    )
      throw new HttpError(400, 'Use a current phone shortcut.');
    if (
      !this.equal(token, this.taskToken(value.taskId, value.revision, value.expires, value.homeRevision)) ||
      value.expires <= Date.now() ||
      value.expires > Date.now() + 360000
    )
      throw new HttpError(403, 'Refresh Home before running this shortcut.');
    const existing = this.claims.snapshot().find((item) => item.id === value.requestId);
    if (existing) {
      if (existing.taskId !== value.taskId) throw new HttpError(409, 'Request already used.');
      return this.receipt(existing);
    }
    const check = () => {
      const home = this.store.snapshot();
      if (this.closing) throw new HttpError(503, 'Server is stopping.');
      if (
        home.revision !== value.homeRevision ||
        !home.tasks.some((item) => item.enabled && item.taskId === value.taskId)
      )
        throw new HttpError(409, 'Shortcut changed. Refresh Home.');
    };
    check();
    // Reserve the UUID before starting the engine. Failed or interrupted claims
    // remain consumed until their capability expires; recovery never replays.
    await this.claims.update((items) => {
      check();
      if (items.some((item) => item.id === value.requestId))
        throw new HttpError(409, 'Request already submitted. Check its status.');
      const retained = items.filter((item) => item.expires > Date.now());
      if (retained.length >= 256)
        throw new HttpError(429, 'Too many recent requests. Wait before running another shortcut.');
      items.splice(0, items.length, ...retained, {
        id: value.requestId,
        taskId: value.taskId,
        expires: value.expires,
        status: 'interrupted',
      });
    });
    check();
    let run;
    try {
      run = await this.engine.manualStart(value.taskId, { revision: value.revision });
    } catch (error) {
      await this.claims.update((items) => {
        items.find((item) => item.id === value.requestId).status = 'not-started';
      });
      throw new HttpError(
        error.status || 409,
        'Task could not start. Check its settings or run history in the administrator.',
      );
    }
    await this.claims.update((items) => {
      const item = items.find((item) => item.id === value.requestId);
      item.runId = run.id;
      item.status = 'accepted';
    });
    return this.status(value.requestId, this.sign('receipt:' + value.requestId));
  }
  receipt(item) {
    const run = item.runId && this.state.snapshot().runs.find((run) => run.id === item.runId);
    return { requestId: item.id, status: run?.status || item.status, token: this.sign('receipt:' + item.id) };
  }
  status(id, token) {
    if (!uuid.test(id) || !this.equal(token, this.sign('receipt:' + id)))
      throw new HttpError(403, 'Receipt unavailable.');
    const item = this.claims.snapshot().find((item) => item.id === id);
    if (!item) throw new HttpError(404, 'Receipt expired.');
    return this.receipt(item);
  }
  async close() {
    this.closing = true;
    await Promise.allSettled([...this.operations]);
    await this.store.queue;
    await this.claims.queue;
  }
}
