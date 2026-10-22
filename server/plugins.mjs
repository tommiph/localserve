/** Folder discovery and the v1 runtime registry. Metadata never implies readiness.
 * Runtime declarations are trusted installed code; child processes are not sandboxes.
 */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { JsonStore, ActivityLog, HttpError } from './storage.mjs';
import { PluginRuntime } from './plugin-runtime.mjs';
import { isIdentifier, validateFields, validateValues, glyphs } from './plugin-schema.mjs';
import { validateCardFields, cardCatalog, validateCard, validateCardStore, projectCardData } from './cards.mjs';
import { validateInstances, pluginInstances, instanceEventId } from './plugin-instances.mjs';
import { validateControlsDeclaration } from './controls.mjs';
import { validateCardTemplates } from './card-templates.mjs';
import { doNotDisturbStatus, isTvAction, tvDoNotDisturbError } from './do-not-disturb.mjs';
import {localDisplayPath, requireLocalDisplay, requireUniverseDisplay,requirePhoneDisplay} from './local-pages.mjs';
import {reportedSensors,vectorSensorTypes,isDiscreteSensor} from './sensor-protocol.mjs';

const reservedIds = new Set(['overview', 'tasks', 'vistas', 'universe', 'controls', 'activity', 'settings', 'server', 'all', 'vr-library']);

function validateSettingsGuide(value) {
  if (value === undefined) return undefined;
  const text = (input, limit) => typeof input === 'string' && input.trim().length > 0 && input.length <= limit;
  if (!value || !text(value.title, 100) || !Array.isArray(value.sections)
    || value.sections.length < 1 || value.sections.length > 6) throw new Error('Invalid plugin Settings guide.');
  // Installed packages supply plain instructional text, never markup, links or
  // executable setup steps. Help metadata does not change the runtime contract.
  return {title: value.title.trim(), sections: value.sections.map(section => {
    if (!section || !text(section.title, 100) || !Array.isArray(section.steps)
      || section.steps.length < 1 || section.steps.length > 8
      || section.steps.some(step => !text(step, 1000))) throw new Error('Invalid plugin Settings guide section.');
    return {title: section.title.trim(), steps: section.steps.map(step => step.trim())};
  })};
}

function capabilities(values, kind) {
  if (!Array.isArray(values) || values.length > 64) throw new Error(`${kind} must be a list of at most 64 entries.`);
  const seen = new Set();
  return values.map(value => {
    if (!value || !isIdentifier(value.id) || seen.has(value.id)
      || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) throw new Error(`${kind} identifiers must be valid and unique.`);
    seen.add(value.id);
    const result = { id: value.id, name: value.name.trim(), description: String(value.description || '').slice(0, 1000) };
    if (kind === 'Action') {
      result.parameters = validateFields(value.parameters, true);
      result.defaults = Object.fromEntries(result.parameters.filter(field => field.default !== undefined).map(field => [field.id, field.default]));
      if (value.settingsOnly !== undefined) {
        if (value.settingsOnly !== true) throw new Error('Settings-only actions must explicitly opt in.');
        result.settingsOnly = true;
      }
      if (value.timeoutSeconds !== undefined) {
        if (!result.settingsOnly || !Number.isInteger(value.timeoutSeconds) || value.timeoutSeconds < 30 || value.timeoutSeconds > 1200) throw Error('Extended deadlines require a Settings-only action and 30–1200 seconds.');
        result.timeoutSeconds = value.timeoutSeconds;
      }
    } else {
      result.payload = validateFields(value.payload, true);
      if (value.occurrenceKey !== undefined) {
        const field = result.payload.find(field => field.id === value.occurrenceKey);
        if (!field || field.type !== 'string' || !field.required) throw new Error('Event occurrenceKey needs a required string payload field.');
        result.occurrenceKey = field.id;
      }
      if (value.testAction !== undefined) {
        if (!isIdentifier(value.testAction)) throw new Error('Invalid event test action.');
        result.testAction = value.testAction;
      }
    }
    return result;
  });
}

export function validateDeclaration(value) {
  if (!value || !isIdentifier(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 64) throw new Error('A declaration needs a valid id and name.');
  if (reservedIds.has(value.id)) throw new Error('This plugin id is reserved for server navigation.');
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) throw new Error('Unsupported declaration schema version.');
  const settings = validateFields(value.settings);
  if(value.taskBuilder!==undefined&&value.taskBuilder!==true)throw new Error('Task builder must explicitly opt in.');
  const settingsGuide = validateSettingsGuide(value.settingsGuide);
  if (settings.some(field => ['name', 'enabled', 'icon', 'revision'].includes(field.id))) throw new Error('A plugin setting uses a reserved identifier.');
  let runtime = null;
  if (value.runtime !== undefined) {
    if (value.schemaVersion !== 1 || value.apiVersion !== 1) throw new Error('Runtime plugins require schemaVersion 1 and apiVersion 1.');
    const entry = value.runtime?.entry;
    if (typeof entry !== 'string' || !/^[a-zA-Z0-9_/-]+\.mjs$/.test(entry)
      || entry.startsWith('/') || entry.split('/').includes('..') || !entry.startsWith('server/')) throw new Error('Runtime entry must be a relative .mjs file inside server/.');
    runtime = { entry };
    if (value.runtime.preview !== undefined) {
      if (value.runtime.preview !== 'jpeg-v1') throw new Error('Unknown preview protocol.');
      runtime.preview = 'jpeg-v1';
    }
    if (value.runtime.ingest !== undefined) {
      if (value.id !== 'sensors' || value.runtime.ingest !== 'sensors-v1') throw new Error('Unknown native report protocol.');
      runtime.ingest = 'sensors-v1';
    }
    if (value.runtime.stateMaxBytes !== undefined) {
      const limit = value.runtime.stateMaxBytes;
      if (!Number.isInteger(limit) || limit < 65536 || limit > 1048576) {
        throw new Error('Runtime stateMaxBytes must be 65536–1048576 bytes.');
      }
      runtime.stateMaxBytes = limit;
    }
  }
  const actions = capabilities(value.actions || [], 'Action');
  const events = capabilities(value.events || [], 'Event');
  let connectionSetup;
  if (value.connectionSetup !== undefined) {
    const setup = value.connectionSetup;
    const field = settings.find(field => field.id === setup?.addressSetting && field.type === 'string' && field.format !== 'secret');
    const validAction = id => actions.some(action => action.id === id && action.settingsOnly && action.parameters.length === 0);
    if (!runtime || !field || !validAction(setup.testAction) || setup.repairAction !== undefined && (!validAction(setup.repairAction) || setup.repairAction === setup.testAction)
      || typeof setup.help !== 'string' || !setup.help.trim() || setup.help.length > 1000) throw new Error('Connection setup needs an address and parameter-free Settings actions.');
    connectionSetup = {addressSetting: field.id, testAction: setup.testAction, help: setup.help,
      ...(setup.repairAction ? {repairAction: setup.repairAction} : {})};
  }
  let listActions;
  if (value.listActions !== undefined) {
    if (!Array.isArray(value.listActions) || value.listActions.length > 8) throw new Error('Invalid Settings list actions.');
    const seen = new Set();
    listActions = value.listActions.map(item => {
      const list = settings.find(field => field.id === item?.setting && field.type === 'list');
      const action = actions.find(action => action.id === item?.actionId && !action.settingsOnly);
      if (!list || !action || seen.has(action.id) || action.parameters.length !== 1
        || !action.parameters.some(field => field.id === item.targetParameter && field.type === 'string' && field.format !== 'secret')
        || !list.fields.some(field => field.id === 'id' && field.type === 'string')
        || value.instances?.setting !== list.id || value.polling?.targetParameter !== item.targetParameter) {
        throw new Error('Settings list actions need a named list and one declared source parameter.');
      }
      seen.add(action.id);
      return {setting: list.id, actionId: action.id, targetParameter: item.targetParameter};
    });
  }
  if (value.defaultCardLayout !== undefined && !['grid', 'list', 'highlight', 'table', 'webpage'].includes(value.defaultCardLayout)) {
    throw new Error('Invalid default Card layout.');
  }
  let attribution;
  if (value.attribution !== undefined) {
    const { label, url, licenseUrl, licenseLabel, notice } = value.attribution || {};
    const safeUrl = input => {
      try {
        const parsed = new URL(input);
        return typeof input === 'string' && input.length <= 300 && parsed.protocol === 'https:'
          && !parsed.username && !parsed.password;
      } catch { return false; }
    };
    if (typeof label !== 'string' || label.length > 100 || typeof notice !== 'string' || notice.length > 200
      || typeof licenseLabel !== 'string' || licenseLabel.length > 64
      || !safeUrl(url) || !safeUrl(licenseUrl)) throw new Error('Invalid plugin data attribution.');
    attribution = { label, url, licenseUrl, licenseLabel, notice };
  }
  const instances = validateInstances(value.instances, settings, events);
  const cardFields = validateCardFields(value.cardFields, events, settings);
  let settingsLookup;
  if (value.settingsLookup !== undefined) {
    // Setup-only lookup reuses normal authenticated actions and named-source
    // item editors. It cannot become a scheduled effect or bypass readiness.
    const lookup = value.settingsLookup;
    const list = settings.find(field => field.id === lookup?.setting && field.type === 'list');
    const action = actions.find(action => action.id === lookup?.actionId && action.settingsOnly);
    if (!list || instances?.setting !== list.id || !action || !action.parameters.some(field => field.id === lookup.queryParameter && field.type === 'string' && field.required)
      || !list.fields.some(field => field.id === lookup.valueField && field.type === 'string' && field.format !== 'secret')
      || !Array.isArray(lookup.readingFields) || lookup.readingFields.length > 20
      || lookup.readingFields.some(id => !cardFields.some(field => field.id === id))) throw new Error('Settings lookup needs a declared setup action, list value and public reading fields.');
    settingsLookup = {setting:list.id, actionId:action.id, queryParameter:lookup.queryParameter, valueField:lookup.valueField, readingFields:[...lookup.readingFields]};
  }
  if (events.some(event => event.testAction && !actions.some(action => action.id === event.testAction && !action.settingsOnly))) throw new Error('Event test actions must be declared non-Settings actions.');
  let polling = null;
  if (value.polling !== undefined) {
    const action = actions.find(action => action.id === value.polling?.actionId);
    const interval = settings.find(field => field.id === value.polling?.intervalSetting);
    // Polling invokes an ordinary supervised action with its declared defaults.
    // Intervals are bounded numeric minutes; there is no arbitrary timer code
    // or HTTP endpoint in this optional declaration-driven scheduling contract.
    if (!runtime || !action || action.settingsOnly || !interval || interval.type !== 'number'
      || !Number.isFinite(interval.min) || interval.min <= 0
      || !Number.isFinite(interval.max) || interval.max > 525600
      || !Number.isFinite(interval.default)) throw new Error('Polling requires a runtime action and bounded minute setting.');
    validateValues(action.parameters, {}, true);
    polling = { actionId: action.id, intervalSetting: interval.id };
    if (value.polling.targetParameter !== undefined) {
      if (!instances || !action.parameters.some(field => field.id === value.polling.targetParameter && field.type === 'string')) throw new Error('Instance polling needs a declared string target parameter.');
      polling.targetParameter = value.polling.targetParameter;
    }
  }
  return {
    id: value.id, name: value.name.trim(), version: String(value.version || '').slice(0, 64),
    description: String(value.description || '').slice(0, 1000),
    icon: glyphs.includes(value.icon) ? value.icon : 'plug', schemaVersion: value.schemaVersion || 1,
    apiVersion: runtime ? 1 : null, runtime, settings, polling, instances,
    defaultCardLayout: value.defaultCardLayout || 'grid', ...(attribution ? { attribution } : {}),
    ...(settingsGuide ? {settingsGuide} : {}),
    ...(connectionSetup ? {connectionSetup} : {}),
    ...(value.taskBuilder ? {taskBuilder:true} : {}),
    ...(listActions ? {listActions} : {}),
    events, actions, ...(settingsLookup ? {settingsLookup} : {}), controls: validateControlsDeclaration(value.controls, actions, runtime, cardFields), cardFields,
    cardTemplates: validateCardTemplates(value.cardTemplates, cardFields),
  };
}

async function containedDirectory(parent, child) {
  await fs.mkdir(child, { recursive: true });
  const realParent = await fs.realpath(parent);
  const realChild = await fs.realpath(child);
  if (!realChild.startsWith(realParent + path.sep)) throw new Error('Plugin paths must remain inside their owning directory.');
}

async function checkPrivateFile(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Plugin data files must be regular local files.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export class PluginRegistry {
  constructor(directory, preferences, activity, globalConfig = null) {
    Object.assign(this, { directory, preferences, activity, globalConfig });
    this.plugins = [];
    this.errors = [];
    this.records = new Map();
    this.fingerprint = '';
    this.queue = Promise.resolve();
    this.closing = false;
  }

  attachEngine(engine) { this.engine = engine; }

  discover() {
    const operation = this.queue.then(() => this.scan());
    this.queue = operation.catch(() => {});
    return operation;
  }

  async scan() {
    if (this.closing) return;
    await fs.mkdir(this.directory, { recursive: true });
    const plugins = [], errors = [], seen = new Set();
    const folders = (await fs.readdir(this.directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const folder of folders) {
      if (!folder.isDirectory() || folder.isSymbolicLink()) continue;
      try {
        const folderPath = path.join(this.directory, folder.name);
        await containedDirectory(this.directory, folderPath);
        const file = path.join(folderPath, 'declaration.json');
        const metadata = await fs.lstat(file);
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 1024 * 1024) throw new Error('declaration.json must be a regular file below 1 MB.');
        const plugin = { ...validateDeclaration(JSON.parse(await fs.readFile(file, 'utf8'))), folder: folder.name };
        if (seen.has(plugin.id)) throw new Error('Duplicate plugin id.');
        seen.add(plugin.id);
        plugins.push(plugin);
      } catch (error) {
        if (error.code !== 'ENOENT') errors.push({ folder: folder.name, message: error.message });
      }
    }
    // Removed declarations stop their own workers and operations, while saved
    // global Task references remain intact. No dependent definitions are deleted.
    for (const [id, record] of this.records) {
      if (!plugins.some(plugin => plugin.id === id)) {
        record.health = 'removed';
        this.cancelOperations(record);
        await record.actionQueue;
        await record.runtime?.close();
        this.records.delete(id);
      }
    }
    this.plugins = plugins;
    for (const plugin of plugins) {
      const existing = this.records.get(plugin.id);
      if (existing) {
        const contract = value => JSON.stringify({ runtime: value.runtime, settings: value.settings, actions: value.actions, events: value.events, polling: value.polling, instances: value.instances, settingsLookup:value.settingsLookup, folder: value.folder });
        if (contract(existing.plugin) !== contract(plugin)) {
          this.cancelOperations(existing);
          existing.health = 'restart-required';
          existing.error = 'Plugin declaration changed. Restart Localserve to load the new contract.';
        } else existing.plugin = plugin;
        continue;
      }
      try { await this.load(plugin); }
      catch (error) { errors.push({ folder: plugin.folder, message: error.message }); }
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({ plugins, errors })).digest('hex');
    this.errors = errors;
    if (fingerprint !== this.fingerprint) {
      this.fingerprint = fingerprint;
      for (const error of errors) await this.activity.add(`Plugin rejected: ${error.folder}: ${error.message}`, { level: 'warning' });
    }
  }

  async load(plugin) {
    const folder = path.join(this.directory, plugin.folder);
    const data = path.join(folder, 'data');
    await containedDirectory(folder, data);
    for (const file of ['config.json', 'state.json', 'activity.jsonl']) await checkPrivateFile(path.join(data, file));
    // Seed Enabled from global preferences only when plugin config.json is
    // missing. The plugin-owned configuration is authoritative once saved.
    const config = await new JsonStore(path.join(data, 'config.json'), {
      revision: 1, enabled: this.preferences.snapshot().plugins?.[plugin.id]?.enabled ?? false,
      icon: plugin.icon, settings: validateValues(plugin.settings, {}, true),
    }).load();
    const saved = config.snapshot();
    if (!Number.isInteger(saved.revision) || saved.revision < 1 || typeof saved.enabled !== 'boolean'
      || !glyphs.includes(saved.icon)) throw new Error('Invalid plugin configuration; original data was retained.');
    const state = await new JsonStore(path.join(data, 'state.json'), {}).load();
    await this.migrateInstances(plugin, config, state, data);
    await this.migrateQueryUrls(plugin, config, data);
    validateValues(plugin.settings, config.snapshot().settings);
    const log = await new ActivityLog(path.join(data, 'activity.jsonl'), 500,
      { retentionDays: () => this.globalConfig?.snapshot().activityRetentionDays ?? 30 }).load();
    const record = { plugin, config, state, log, cards: null, cardsError: '', runtime: null, configured: false, health: 'not-loaded',
      error: '', operations: new Set(), actionQueue: Promise.resolve(), settingsQueue: Promise.resolve(), pending: 0,
      pollDueAt: null, lastPollAt: null, pollObservation: null, pollGeneration: 0, pollPending: false, pollOperation: Promise.resolve(), instancePolls: new Map() };
    this.records.set(plugin.id, record);
    // Invalid card definitions quarantine the designer only. They must not stop
    // an otherwise healthy integration or overwrite the user's original file.
    try {
      const file = path.join(data, 'cards.json');
      await checkPrivateFile(file);
      const cards = await new JsonStore(file, { schemaVersion: 1, cards: [] }).load();
      validateCardStore(cards.snapshot(), plugin, config.snapshot().settings);
      record.cards = cards;
    } catch (error) { record.cardsError = error.message; }
    if (plugin.runtime) {
      try { await this.startRuntime(record); }
      catch (error) {
        record.health = 'error';
        record.error = error.message;
      }
    }
  }

  async migrateQueryUrls(plugin, config, data) {
    const migration = plugin.instances?.queryUrlMigration;
    const settings = config.snapshot().settings;
    if (!migration || !migration.parameters.some(parameter => Object.hasOwn(settings, parameter.setting))) return;
    const next = structuredClone(settings);
    const items = next[plugin.instances.setting];
    if (!Array.isArray(items)) throw new Error('Invalid legacy feed searches; original configuration retained.');
    for (const item of items) {
      if (typeof item.query !== 'string') throw new Error('Invalid legacy feed query; original configuration retained.');
      const url = new URL(migration.baseUrl);
      url.searchParams.set(migration.queryParameter, item.query);
      for (const parameter of migration.parameters) {
        const value = settings[parameter.setting] ?? parameter.default;
        if (typeof value !== 'string' || value.length > 100) throw new Error('Invalid legacy feed settings; original configuration retained.');
        url.searchParams.set(parameter.parameter, value);
      }
      item.query = url.href;
    }
    for (const parameter of migration.parameters) delete next[parameter.setting];
    validateValues(plugin.settings, next);
    // Run under the installation lock before runtime activation. Only config
    // changes: immutable IDs, readings, Cards, and Tasks retain their ownership.
    // Presence of the source parameter settings gates conversion; removing
    // them makes restart after commit a no-op.
    const backup = path.join(data, 'config.before-query-urls.json');
    await checkPrivateFile(backup);
    try { await fs.copyFile(path.join(data, 'config.json'), backup, constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    await config.update(current => { current.settings = next; current.revision += 1; });
  }

  async migrateInstances(plugin, config, state, data) {
    const declaration = plugin.instances;
    const settings = config.snapshot().settings;
    if (!declaration?.legacySetting || !Object.hasOwn(settings, declaration.legacySetting)) return;
    const legacyQuery = settings[declaration.legacySetting];
    if (typeof legacyQuery !== 'string' || settings[declaration.setting] !== undefined) throw new Error('Invalid legacy instance configuration; original data retained.');
    const items = legacyQuery.trim() ? [{ id: declaration.legacyId, name: legacyQuery.trim().slice(0, 32), query: legacyQuery.trim(), enabled: true }] : [];
    const next = { ...settings, [declaration.setting]: items };
    delete next[declaration.legacySetting];
    validateValues(plugin.settings, next);
    // Declaration-owned configuration conversion runs under the server folder
    // lock before activation. Recovery copies stay private beside the originals.
    for (const filename of ['config', 'state']) {
      const backup = path.join(data, `${filename}.before-instances.json`);
      await checkPrivateFile(backup);
      try { await fs.copyFile(path.join(data, `${filename}.json`), backup, constants.COPYFILE_EXCL); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    // State first, config last: a crash before config commits reruns safely using
    // converted state. Card/Event IDs stay bound to the compatibility instance;
    // conversion never rewrites server-owned Tasks or templates.
    await state.update(current => {
      if (!current[declaration.stateKey]) {
        const old = structuredClone(current);
        for (const key of Object.keys(current)) delete current[key];
        current[declaration.stateKey] = items.length ? { [declaration.legacyId]: old } : {};
      }
    });
    await config.update(current => { current.settings = next; current.revision += 1; });
  }

  async startRuntime(record) {
    const { plugin } = record;
    const folder = await fs.realpath(path.join(this.directory, plugin.folder));
    const entry = await fs.realpath(path.join(folder, plugin.runtime.entry));
    if (!entry.startsWith(folder + path.sep) || !(await fs.stat(entry)).isFile()) throw new Error('Runtime entry escapes its plugin folder.');
    record.health = 'loading';
    record.runtime = new PluginRuntime(
      (operation, values, context) => this.hostCall(record, operation, values, context),
      error => { record.health = 'error'; record.error = error.message; this.cancelOperations(record); },
    );
    try {
      record.configured = (await record.runtime.request('load', { entry, settings: record.config.snapshot().settings })) === true;
      record.health = 'idle';
      if (record.config.snapshot().enabled && record.configured) await this.activate(record);
    } catch (error) {
      record.health = 'error'; record.error = error.message;
      await record.runtime.close();
    }
  }

  async activate(record) {
    await record.runtime.request('start', { settings: record.config.snapshot().settings });
    record.health = 'ready';
    record.error = '';
    record.pollGeneration += 1;
    // One initial poll after activation, then completion-based intervals. A rate
    // edit preserves the last attempt, so changing the dropdown cannot trigger
    // an immediate extra request unless the newly selected interval is due.
    record.pollDueAt = record.plugin.polling
      ? (record.lastPollAt ?? Date.now() - this.pollMilliseconds(record)) + this.pollMilliseconds(record)
      : null;
    if (record.plugin.polling?.targetParameter) this.reconcileInstancePolls(record);
  }

  reconcileInstancePolls(record, now = Date.now()) {
    const items = pluginInstances(record.plugin, record.config.snapshot().settings).filter(item => item.enabled);
    const interval = this.pollMilliseconds(record);
    const clocks = new Map();
    items.forEach((item, index) => {
      const previous = record.instancePolls.get(item.id);
      const signature = JSON.stringify([item.id, item.query]);
      clocks.set(item.id, previous?.signature === signature
        ? { ...previous, nextAt: previous.lastAt === null ? previous.nextAt : previous.lastAt + interval }
        : { signature, lastAt: null, nextAt: now + index * interval / items.length });
    });
    record.instancePolls = clocks;
    record.pollDueAt = clocks.size ? Math.min(...[...clocks.values()].map(clock => clock.nextAt)) : null;
  }

  pollMilliseconds(record) {
    const setting = record.plugin.polling?.intervalSetting;
    if (!setting) return 0;
    const field = record.plugin.settings.find(field => field.id === setting);
    // An optional interval can be absent from saved configuration. Apply its
    // declaration default without rewriting the user's saved settings.
    return (record.config.snapshot().settings[setting] ?? field.default) * 60000;
  }

  pollDue(now = Date.now()) {
    if (this.closing || this.engine?.gate.paused) return;
    for (const record of this.records.values()) {
      if (!record.plugin.polling || record.pollDueAt === null || record.pollDueAt > now
        || record.pollPending || record.pending || record.health !== 'ready'
        || !record.config.snapshot().enabled || !record.configured) continue;
      // Reserve synchronously before enqueueing: discovery ticks must never
      // overlap polls or accumulate a backlog. Missed intervals coalesce into
      // one attempt; failures wait the full selected interval without retries.
      record.pollPending = true;
      let parameters = {};
      if (record.plugin.polling.targetParameter) {
        const target = [...record.instancePolls.entries()].sort((a, b) => a[1].nextAt - b[1].nextAt)[0];
        parameters = { [record.plugin.polling.targetParameter]: target[0] };
        // On resume, stagger overdue locations again rather than draining a
        // missed multi-location cycle in a rapid burst every discovery tick.
        const spacing = this.pollMilliseconds(record) / record.instancePolls.size;
        [...record.instancePolls.entries()].filter(([id, clock]) => id !== target[0] && clock.nextAt <= now)
          .sort((a, b) => a[1].nextAt - b[1].nextAt)
          .forEach(([, clock], index) => { clock.nextAt = now + (index + 1) * spacing; });
      }
      record.pollOperation = this.execute(record.plugin.id, record.plugin.polling.actionId, parameters)
        .catch(async error => {
          if (!this.closing && record.health === 'ready' && record.config.snapshot().enabled) {
            await this.writeLog(record, `Automatic poll failed: ${error.message}`, { level: 'warning' });
          }
        })
        .catch(error => console.error('Plugin poll logging:', error.message))
        .finally(() => { record.pollPending = false; });
    }
  }

  cancelOperations(record) {
    record.previewGeneration = (record.previewGeneration || 0) + 1;
    record.previewPending = null;
    for (const controller of record.operations) controller.abort(new Error('Plugin disabled, reconfigured, removed, or stopped'));
  }

  async suspendPreviews() {
    await Promise.allSettled([...this.records.values()].filter(record => record.plugin.runtime?.preview === 'jpeg-v1')
      .map(record => { record.previewPending = null; record.previewGeneration = (record.previewGeneration || 0) + 1;
        return record.runtime?.request('suspend-preview', {}, {}, 1500); }));
  }

  async previewFrame(id) {
    const record = this.get(id);
    if (record.plugin.runtime?.preview !== 'jpeg-v1') throw new HttpError(404, 'Preview unavailable.');
    this.assertReady(record);
    if (this.engine?.gate.paused || this.closing) throw new HttpError(503, 'Preview paused.');
    // Concurrent viewers share one bounded RAM-only IPC read; reads never start capture.
    if (record.previewPending) return record.previewPending;
    const revision = record.config.snapshot().revision, runtime = record.runtime, generation = record.previewGeneration || 0;
    const pending = (async () => {
      const frame = await runtime.request('preview', {}, {}, 2000);
      this.assertReady(record);
      if (this.engine?.gate.paused || runtime !== record.runtime || revision !== record.config.snapshot().revision
          || generation !== (record.previewGeneration || 0))
        throw new HttpError(503, 'Preview changed.');
      if (!frame || !Number.isFinite(frame.at) || Date.now() - frame.at > 2500 || frame.at > Date.now() + 1000
          || typeof frame.jpeg !== 'string' || frame.jpeg.length > 700000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(frame.jpeg))
        throw new HttpError(503, 'No current camera frame.');
      const jpeg = Buffer.from(frame.jpeg, 'base64');
      if (jpeg.length < 4 || jpeg.length > 512 * 1024 || jpeg[0] !== 255 || jpeg[1] !== 216
          || jpeg.at(-2) !== 255 || jpeg.at(-1) !== 217) throw new HttpError(503, 'Invalid camera frame.');
      return jpeg;
    })();
    record.previewPending = pending;
    try { return await pending; }
    finally { if (record.previewPending === pending) record.previewPending = null; }
  }

  get(id) {
    const record = this.records.get(id);
    if (!record) throw new HttpError(404, 'Plugin not found or its data could not be loaded.');
    return record;
  }

  saveConfiguration(id, values) {
    const record = this.get(id);
    const operation = record.settingsQueue.then(async () => {
      if (this.closing) throw new HttpError(503, 'Server is stopping.');
      if (Object.keys(values).some(key => !['revision', 'enabled', 'icon', 'settings'].includes(key))) throw new HttpError(400, 'Unknown plugin setting.');
      let next, runtimeChanged;
      await record.config.update(current => {
        if (values.revision !== current.revision) throw new HttpError(409, 'Plugin settings changed. Refresh before saving.');
        next = { ...current, ...values, revision: current.revision + 1 };
        if (typeof next.enabled !== 'boolean' || !glyphs.includes(next.icon)) throw new HttpError(400, 'Choose a valid Enabled state and glyph.');
        next.settings = validateValues(record.plugin.settings, next.settings);
        runtimeChanged = next.enabled !== current.enabled || JSON.stringify(next.settings) !== JSON.stringify(current.settings);
        Object.assign(current, next);
      });
      // Commit first, then revoke admissions and drain old work before applying.
      // Appearance-only saves share revision ordering without cancelling work.
      // A runtime application failure never rewinds a saved configuration file.
      if (runtimeChanged && record.runtime && !['error', 'restart-required'].includes(record.health)) {
        // Revoke readiness synchronously before the first awaited drain. Otherwise
        // another request could enter using the old readiness with new settings.
        record.health = 'configuring';
        record.pollObservation = null;
        this.cancelOperations(record);
        await record.actionQueue;
        try {
          await record.runtime.request('stop', {});
          record.configured = (await record.runtime.request('configure', { settings: next.settings })) === true;
          record.health = 'idle';
          if (next.enabled && record.configured) await this.activate(record);
        } catch (error) { record.health = 'error'; record.error = error.message; }
      }
      await this.writeLog(record, 'Plugin settings updated');
    });
    record.settingsQueue = operation.catch(() => {});
    return operation;
  }

  services() {
    const environment = { now: Date.now(), location: this.globalConfig?.snapshot().location };
    return this.plugins.map(plugin => {
      const record = this.records.get(plugin.id);
      const config = record?.config.snapshot();
      return { ...plugin, actions: this.instanceActions(plugin, config?.settings).map(action => ({...action, ...this.actionAvailability(plugin.id, action.id)})), declarationIcon: plugin.icon, icon: config?.icon || plugin.icon, enabled: config?.enabled || false,
        configurationReady: record?.configured || false, health: record?.health || 'error', error: record?.error || '',
        config, pluginState: record?.state.snapshot() || {}, pluginActivity: record?.log.latest() || [],
        cards: record?.cards?.snapshot().cards || [], cardsError: record?.cardsError || '',
        cardCatalog: cardCatalog(plugin, config?.settings), cardData: projectCardData(plugin, record, this.engine?.gate.paused, environment),
        pollSeconds: record ? this.pollMilliseconds(record) / 1000 : 0, lastPollAt: record?.lastPollAt ?? null,
        // Administrator-only execution evidence. Completion is not a claim that
        // every provider/source returned fresh data; declared reception is separate.
        pollObservation: record?.pollObservation ? structuredClone(record.pollObservation) : null,
        pollTargets: plugin.instances ? pluginInstances(plugin, config?.settings).filter(item => item.enabled).length : 1 };
    });
  }

  cardStore(id) {
    if (this.closing) throw new HttpError(503, 'Server is stopping.');
    const record = this.get(id);
    if (!record.cards) throw new HttpError(409, 'Card definitions could not be loaded. Original cards.json was retained.');
    return record;
  }

  async saveCard(pluginId, values, cardId = null) {
    const record = this.cardStore(pluginId);
    let saved;
    await record.cards.update(current => {
      const existing = cardId ? current.cards.find(card => card.id === cardId) : null;
      if (cardId && !existing) throw new HttpError(404, 'Card not found.');
      if (existing && existing.revision !== values.revision) throw new HttpError(409, 'This card changed. Close and reopen its editor before saving.');
      if (!existing && current.cards.length >= 100) throw new HttpError(400, 'A plugin can contain at most 100 cards.');
      saved = validateCard(values, record.plugin, existing, record.config.snapshot().settings);
      if (saved.layout === 'readymade') {
        const base = saved.name.slice(0, 60); let suffix = 2;
        while (current.cards.some(card => card.id !== existing?.id && card.name.toLowerCase() === saved.name.toLowerCase())) saved.name = `${base} ${suffix++}`;
      }
      if (current.cards.some(card => card.id !== existing?.id && card.name.toLowerCase() === saved.name.toLowerCase())) throw new HttpError(409, 'Use a different card title.');
      if (existing) current.cards[current.cards.indexOf(existing)] = saved;
      else current.cards.push(saved);
    });
    // Card writes affect presentation only: never execute an action, reconfigure
    // the runtime, or alter plugin Enabled. Activity is a separate awaited append.
    await this.activity.add(`Card ${cardId ? 'updated' : 'created'}: ${saved.name}`, { pluginId, cardId: saved.id });
    return saved;
  }

  async changeCard(pluginId, cardId, operation, values) {
    const record = this.cardStore(pluginId);
    const permitted = operation === 'enabled' ? ['revision', 'enabled'] : ['revision'];
    if (Object.keys(values).some(key => !permitted.includes(key))) throw new HttpError(400, 'Unknown card property.');
    let name;
    await record.cards.update(current => {
      const index = current.cards.findIndex(card => card.id === cardId);
      if (index < 0) throw new HttpError(404, 'Card not found.');
      const card = current.cards[index];
      if (values.revision !== card.revision) throw new HttpError(409, 'This card changed. Refresh before trying again.');
      name = card.name;
      if (operation === 'delete') current.cards.splice(index, 1);
      else if (operation === 'enabled') {
        if (typeof values.enabled !== 'boolean') throw new HttpError(400, 'Card Enabled must be true or false.');
        card.enabled = values.enabled;
        card.revision += 1;
      } else throw new HttpError(400, 'Unknown card operation.');
    });
    await this.activity.add(`Card ${operation === 'delete' ? 'deleted' : values.enabled ? 'enabled' : 'disabled'}: ${name}`, { pluginId, cardId });
  }

  actionAvailability(pluginId, actionId) {
    const record = this.records.get(pluginId);
    if (!record?.configured || record.health !== 'ready' || !record.config.snapshot().enabled) {
      return {available: false, unavailableReason: 'Enable and configure this plugin in Settings.'};
    }
    if (record.plugin.controls?.taskSceneAction === actionId
      && !this.controls?.taskScenes(pluginId).some(scene => scene.available)) {
      return {available: false, unavailableReason: 'Enable a stored lighting scene and its Controls page first.'};
    }
    if (pluginId === 'webpage' && actionId === 'open-on-tv') {
      const tv = this.records.get('samsung-tv');
      if (!tv?.configured || tv.health !== 'ready' || !tv.config.snapshot().enabled) {
        return {available: false, unavailableReason: 'Configure and enable Samsung TV first.'};
      }
    }
    return {available: true, unavailableReason: ''};
  }

  actions() {
    return this.plugins.flatMap(plugin => this.instanceActions(plugin, this.records.get(plugin.id)?.config.snapshot().settings).filter(action => !action.settingsOnly).map(action => {
      const record = this.records.get(plugin.id);
      return { ...action, id: `plugin:${plugin.id}:${action.id}`, pluginId: plugin.id, actionId: action.id,
        pluginName: plugin.name, icon: record?.config.snapshot().icon || plugin.icon,
        type: 'plugin', category: plugin.id, ...this.actionAvailability(plugin.id, action.id) };
    }));
  }

  instanceActions(plugin, settings = {}) {
    const actions = plugin.actions.map(action => {
      if (plugin.controls?.taskSceneAction !== action.id) return action;
      const scenes = this.controls?.taskScenes(plugin.id) || [];
      const first = scenes.find(scene => scene.available)?.id || '';
      // Stored scenes stay plugin-owned. Expose names/stable references only;
      // disabled choices remain explicit and removed Task selections are retained.
      return {...action, controlScene: true, parameters: action.parameters.map(field => ({...field,
        enum: scenes.length ? scenes.map(scene => scene.id) : [''],
        enumLabels: scenes.length ? scenes.map(scene => scene.name + (scene.available ? '' : ' (Unavailable)')) : ['No stored lighting scenes'],
        default: first})), defaults: {'scene-id': first}};
    });
    const parameter = plugin.polling?.targetParameter;
    if (!parameter) return actions;
    const items = pluginInstances(plugin, settings).filter(item => item.enabled);
    return actions.map(action => {
      // Related actions can target the same declared named source. Reuse its
      // choices instead of exposing internal IDs
      // as a text input; actions without that target keep their own parameters.
      if (!action.parameters.some(field => field.id === parameter && field.type === 'string')) return action;
      const parameters = action.parameters.map(field => field.id === parameter
        ? { ...field, ...(items.length ? { enum: items.map(item => item.id), enumLabels: items.map(item => item.name) } : {}), default: items[0]?.id || '' } : field);
      return { ...action, parameters, defaults: { ...action.defaults, [parameter]: items[0]?.id || '' } };
    });
  }

  events() {
    return this.plugins.flatMap(plugin => {
      const record=this.records.get(plugin.id);
      const instances=plugin.instances ? pluginInstances(plugin,record?.config.snapshot().settings) : [];
      const sensors=plugin.runtime?.ingest==='sensors-v1';
      if(sensors && record && !record.sensorEventSources)record.sensorEventSources=reportedSensors(record.state.snapshot());
      const knownEvents=new Set(plugin.events.map(event=>event.id));
      return plugin.events.flatMap(event => {
        const common = { ...event, pluginId: plugin.id, eventId: event.id, pluginName: plugin.name };
        if (!plugin.instances) return [{ ...common, id: `plugin:${plugin.id}:event:${event.id}` }];
        return instances.flatMap(instance => {
          const source={...common,id:instanceEventId(plugin,instance,event),name:`${instance.name} · ${event.name}`,
            instanceId:instance.id,instanceEnabled:instance.enabled,instanceKey:plugin.instances.eventKey};
          if(!sensors || !/^sensor-\d+$|^other-reading$/.test(event.id))return [source];
          const matches=(record?.sensorEventSources?.get(instance.id) || []).filter(sensor=>
            event.id==='other-reading'?!knownEvents.has('sensor-'+sensor.type):event.id==='sensor-'+sensor.type);
          // Hardware instances of the same type are separate rule producers,
          // including wake/non-wake variants and vendor-defined sensor types.
          return matches.map(sensor=>({...source,id:source.id+':'+sensor.id,sensorId:sensor.id,
            ...(isDiscreteSensor(sensor)?{occurrenceKey:'timestamp-ns',
              description:'Each new one-shot or special-trigger timestamp is a separate occurrence, even when its raw value stays 1. Initial/reconnected snapshots are baselined.'}:{}),
            payload:source.payload.filter(field=>{
              if(/^value-\d+$/.test(field.id))return Number(field.id.slice(6))<sensor.components;
              if(['x','y','z'].includes(field.id))return vectorSensorTypes.has(sensor.type) && ['x','y','z'].indexOf(field.id)<sensor.components;
              return true;
            }),
            // Keep the normal choice to device + physical sensor. Only exact
            // duplicate names need a short suffix to remain distinguishable.
            name:`${instance.name} · ${sensor.name}${(record?.sensorEventSources?.get(instance.id) || []).filter(other=>other.name===sensor.name).length>1 ? ' ('+sensor.id.slice(-4)+')' : ''}`}));
        });
      });
    });
  }

  assertReady(record) {
    if (this.closing || !record.config.snapshot().enabled || !record.configured || record.health !== 'ready') throw new HttpError(409, 'Plugin is unavailable. Check Enabled, configuration, and runtime status.');
  }

  ingestSensors(packet, receivedAt, signal, revision) {
    const record=this.get('sensors');this.assertReady(record);
    if (record.plugin.runtime.ingest !== 'sensors-v1') throw new HttpError(404,'Sensors receiver unavailable.');
    if (record.pending>=8) throw new HttpError(429,'Sensor processing queue is full.');
    const controller=new AbortController();
    const abort=()=>controller.abort(signal.reason);
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    record.pending++;record.operations.add(controller);
    const operation=record.actionQueue.then(async()=>{
      controller.signal.throwIfAborted();this.assertReady(record);
      if (record.config.snapshot().revision!==revision) throw new HttpError(409,'Sensors settings changed. Send a fresh report.');
      if (this.engine.gate.paused || Date.now()-receivedAt>4000) throw new HttpError(409,'Sensor report is paused or expired.');
      return record.runtime.request('ingest',{packet,receivedAt},
        {signal:controller.signal,sensorIngress:true},5000);
    });
    record.actionQueue=operation.catch(()=>{});
    return operation.finally(()=>{
      signal.removeEventListener('abort',abort);record.pending--;record.operations.delete(controller);
    });
  }

  assertTaskTarget(action, parameters) {
    if (action.controlScene) this.controls.requireTaskScene(action.pluginId, parameters['scene-id']);
  }

  assertTvQuietHours(id, actionId, context) {
    if (context.automatic === true && isTvAction(id, actionId)
      && doNotDisturbStatus(this.globalConfig?.snapshot().doNotDisturb).active) {
      // Mark the server-owned IPC context: the worker carries error text only.
      // This lets the Task distinguish quiet-hour inhibition from device errors.
      context.tvDoNotDisturbBlocked = true;
      throw tvDoNotDisturbError();
    }
  }

  execute(id, actionId, parameters, context = {}) {
    this.assertTvQuietHours(id, actionId, context);
    const record = this.get(id);
    this.assertReady(record);
    if (context.configRevision !== undefined && context.configRevision !== record.config.snapshot().revision) throw new HttpError(409, 'Plugin settings changed. Refresh before running this action.');
    if (this.engine?.gate.paused) throw new HttpError(409, 'Server is paused.');
    const action = record.plugin.actions.find(action => action.id === actionId);
    if (!action) throw new HttpError(400, 'Unknown plugin action.');
    if (record.plugin.controls?.taskSceneAction === actionId) {
      const validated = validateValues(action.parameters, parameters, true);
      if (!this.controls) throw new HttpError(409, 'Stored lighting scenes are unavailable.');
      // Do not enter this plugin's action queue here: the Controls runner must
      // acquire that same queue for each saved command. Waiting inside it would
      // deadlock. Controls supplies its own admission/serial/persistence guards.
      return this.controls.runTaskScene(id, validated['scene-id'], context);
    }
    if (id === 'webpage' && actionId === 'open-on-tv') {
      const readiness = this.actionAvailability(id, actionId);
      if (!readiness.available) throw new HttpError(409, readiness.unavailableReason);
    }
    if (action.settingsOnly && (context.taskId || context.automatic)) throw new HttpError(400, 'This action is available only in plugin Settings.');
    if (id === 'oculus-go' && actionId.startsWith('library-') && !context.packageLibrary) throw new HttpError(400, 'Use the VR library page to manage applications.');
    const validated = validateValues(action.parameters, parameters, true);
    const targetParameter = actionId === record.plugin.polling?.actionId ? record.plugin.polling.targetParameter : null;
    if (targetParameter && !validated[targetParameter]) {
      const targets = pluginInstances(record.plugin, record.config.snapshot().settings).filter(item => item.enabled);
      if (targets.length === 1) validated[targetParameter] = targets[0].id;
    }
    if (record.pending >= 32) throw new HttpError(429, 'Plugin action queue is full.');
    const controller = new AbortController();
    const abort = () => controller.abort(context.signal.reason);
    context.signal?.addEventListener('abort', abort, { once: true });
    if (context.signal?.aborted) abort();
    record.operations.add(controller);
    record.pending += 1;
    const operation = record.actionQueue.then(async () => {
      this.assertReady(record);
      controller.signal.throwIfAborted();
      await this.engine.gate.wait(controller.signal);
      this.assertReady(record);
      this.assertTvQuietHours(id, actionId, context);
      if (context.configRevision !== undefined && context.configRevision !== record.config.snapshot().revision) throw new HttpError(409, 'Plugin settings changed. Refresh before running this action.');
      const pollAction = actionId === record.plugin.polling?.actionId;
      const pollGeneration = record.pollGeneration;
      if (pollAction) record.lastPollAt = Date.now();
      if (pollAction) record.pollObservation = {attemptedAt: record.lastPollAt, finishedAt: null, status: 'running', error: ''};
      const targetId = validated[record.plugin.polling?.targetParameter];
      const targetClock = record.instancePolls.get(targetId);
      if (pollAction && targetClock) targetClock.lastAt = record.lastPollAt;
      const watchdog = new AbortController();
      // Measure the action deadline in running time; global pause does not consume
      // declared manual-action budget. Cancellation stays responsive while paused/queued.
      void this.engine.gate.delay((action.timeoutSeconds || 30) * 1000, watchdog.signal).then(() => {
        controller.abort(new Error('Plugin action timed out; outcome may be unknown.'));
      }).catch(() => {});
      try {
        // Only this declared TV action can reserve a notice. The URL is trusted
        // execution context, never an editable parameter or a shared host service.
        const noticeUrl = record.plugin.id === 'samsung-tv' && actionId === 'show-notice'
          ? await this.notices.create(validated, controller.signal) : undefined;
        await this.engine.gate.wait(controller.signal);
        this.assertReady(record);
        this.assertTvQuietHours(id, actionId, context);
        const sourceConfig = record.config.snapshot();
        const enabledPages = record.plugin.id === 'webpage' && actionId === 'open-on-tv'
          ? sourceConfig.settings.pages.filter(page => page.enabled) : [];
        const webpageTvLaunch = enabledPages.length ? {used: false, revision: sourceConfig.revision,
          pageId: validated['page-id'] || (enabledPages.length === 1 ? enabledPages[0].id : '')} : null;
        const requestContext = {...context, signal: controller.signal, webpageTvLaunch, actionId,
          ...(record.plugin.runtime.preview ? {previewGeneration: record.previewGeneration || 0} : {})};
        try {
          const result = await record.runtime.request('execute', { actionId, parameters: validated, noticeUrl }, requestContext, 0);
          if (pollAction && pollGeneration === record.pollGeneration) record.pollObservation = {
            attemptedAt: record.lastPollAt, finishedAt: Date.now(), status: 'completed', error: '',
          };
          return result;
        } catch (error) {
          if (requestContext.tvDoNotDisturbBlocked) throw tvDoNotDisturbError();
          throw error;
        }
      } catch (error) {
        if (pollAction && pollGeneration === record.pollGeneration) record.pollObservation = {
          attemptedAt: record.lastPollAt, finishedAt: Date.now(), status: controller.signal.aborted ? 'cancelled' : 'failed',
          error: String(error.message || 'Check failed.').slice(0, 1000),
        };
        throw error;
      } finally {
        watchdog.abort();
        // Manual refreshes also postpone the next automatic poll. A cancelled
        // old configuration must not overwrite a newly activated schedule.
        if (pollAction && pollGeneration === record.pollGeneration) {
          if (record.plugin.polling.targetParameter && targetClock) {
            targetClock.nextAt = Date.now() + this.pollMilliseconds(record);
            record.pollDueAt = Math.min(...[...record.instancePolls.values()].map(clock => clock.nextAt));
          } else if (record.plugin.polling.targetParameter) {
            record.pollDueAt = record.instancePolls.size ? Math.min(...[...record.instancePolls.values()].map(clock => clock.nextAt)) : null;
          } else record.pollDueAt = Date.now() + this.pollMilliseconds(record);
        }
      }
    });
    record.actionQueue = operation.catch(() => {});
    return operation.finally(() => {
      record.pending -= 1;
      record.operations.delete(controller);
      context.signal?.removeEventListener('abort', abort);
    });
  }

  async writeLog(record, message, fields = {}) {
    const values = { ...fields, source: record.plugin.name, pluginId: record.plugin.id };
    // The plugin keeps its own history. Global Activity is a second append, not a
    // cross-file transaction; a failed mirror does not undo a completed effect.
    await record.log.add(message, values);
    await this.activity.add(message, values);
  }

  async hostCall(record, operation, values, context) {
    context.signal?.throwIfAborted();
    this.assertReady(record);
    if (context.sensorIngress && this.engine.gate.paused) throw new HttpError(409,'Server is paused; send a fresh sensor report after resuming.');
    if (!context.sensorIngress) await this.engine.gate.wait(context.signal);
    this.assertReady(record);
    if (context.previewGeneration !== undefined && context.previewGeneration !== (record.previewGeneration || 0))
      throw new HttpError(409, 'Capture session changed.');
    if (operation === 'wait' || operation === 'open-webpage-on-tv') {
      this.assertTvQuietHours(record.plugin.id, context.actionId, context);
    }
    const fields = { taskId: context.taskId, runId: context.runId, stepId: context.stepId };
    if (operation === 'log') {
      if (typeof values.message !== 'string' || values.message.length > 2000 || !['info', 'success', 'warning'].includes(values.level)) throw new Error('Invalid plugin log entry.');
      await this.writeLog(record, values.message, { ...fields, level: values.level });
    } else if (operation === 'read-state') return record.state.snapshot();
    else if (operation === 'save-state') {
      // Article lists need more space than scalar telemetry. A package can opt
      // into a bounded larger snapshot; existing packages retain the 64 KiB
      // character limit. The opt-in measures UTF-8 bytes, including Unicode news.
      const declaredLimit = record.plugin.runtime.stateMaxBytes;
      const serialized = JSON.stringify(values);
      const size = declaredLimit ? Buffer.byteLength(serialized ?? '', 'utf8') : serialized?.length;
      if (!values || typeof values !== 'object' || Array.isArray(values)
        || size > (declaredLimit || 65536)) throw new Error('Plugin state exceeds its declared size limit or is not an object.');
      await record.state.update(current => {
        for (const key of Object.keys(current)) delete current[key];
        Object.assign(current, values);
      });
      if(record.plugin.runtime?.ingest==='sensors-v1')record.sensorEventSources=reportedSensors(values);
    } else if (operation === 'open-webpage-on-tv') {
      const claim = context.webpageTvLaunch;
      const config = record.config.snapshot();
      if (record.plugin.id !== 'webpage' || !claim || claim.used || claim.revision !== config.revision
        || !values || Object.keys(values).length !== 1 || values.pageId !== claim.pageId) {
        throw new Error('TV launch is available only once during the selected Webpage action.');
      }
      const page = config.settings.pages.find(page => page.id === claim.pageId && page.enabled);
      if (!page) throw new Error('Choose an enabled webpage.');
      let targetUrl = page.query;
      const phoneReady=()=>{
        const sensors=this.records.get('sensors')?.config.snapshot();
        if(!sensors?.enabled||!sensors.settings.devices?.some(device=>device.enabled))throw new HttpError(409,'Enable Sensors and a phone before opening phone information on TV.');
      };
      if (localDisplayPath(page.query) || page.query === '/universe' || page.query === '/phone-information') {
        if (page.query === '/universe') {
          if (!this.universe?.snapshot().enabled) throw new HttpError(409, 'Enable Universe before opening it on TV.');
          await requireUniverseDisplay(path.dirname(this.directory));
        } else if(page.query==='/phone-information') {phoneReady();await requirePhoneDisplay(path.dirname(this.directory));}
        else await requireLocalDisplay(path.dirname(this.directory), page.query);
        // The running listener supplies the LAN origin, including OS-selected
        // ports. Never send localhost, caller hosts or administrator capabilities.
        const origin = this.localDisplayOrigin?.();
        if (!origin) throw new HttpError(409, 'Configure a private LAN server address before opening a local page on TV.');
        targetUrl = origin + page.query;
      } else {
        const url = new URL(page.query);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || page.query.length > 2000) throw new Error('Invalid TV webpage URL.');
      }
      const readiness = this.actionAvailability('webpage', 'open-on-tv');
      if (!readiness.available) throw new Error(readiness.unavailableReason);
      // Resolving a local file yields to cancellation/settings writes. Do not
      // dispatch an old saved URL after its owning source was changed/disabled.
      context.signal?.throwIfAborted();
      this.assertReady(record);
      if (record.config.snapshot().revision !== claim.revision) throw new HttpError(409, 'Webpage settings changed before TV launch.');
      if (page.query === '/universe' && !this.universe?.snapshot().enabled) throw new HttpError(409, 'Enable Universe before opening it on TV.');
      if(page.query==='/phone-information')phoneReady();
      // Consume before queueing the one existing launch action. Source edits,
      // cancellation and shutdown abort this nested request through the shared
      // signal; no arbitrary target/action/URL or credentials come from IPC.
      claim.used = true;
      try {
        return await this.execute('samsung-tv', 'launch-app', {id: 'HwGlance01.HomeGlance', mode: 'DEEP_LINK', arguments: targetUrl},
          {signal: context.signal, taskId: context.taskId, runId: context.runId, stepId: context.stepId, automatic: context.automatic});
      } catch (error) {
        if (error.code === 'TV_DO_NOT_DISTURB') context.tvDoNotDisturbBlocked = true;
        throw error;
      }
    } else if (operation === 'wait') {
      if (!Number.isFinite(values.seconds) || values.seconds <= 0 || values.seconds > 10) throw new Error('Plugin wait must be greater than zero and at most 10 seconds.');
      await this.engine.gate.delay(values.seconds * 1000, context.signal);
      // A weekly boundary or saved toggle can occur during a worker's wait.
      this.assertTvQuietHours(record.plugin.id, context.actionId, context);
    } else if (operation === 'event') {
      const event = record.plugin.events.find(event => event.id === values.eventId);
      if (!event) throw new Error('Plugin attempted to emit an undeclared event.');
      const payload = validateValues(event.payload, values.payload, true);
      // Continuous raw sensor reports are current state, not an activity-log
      // archive. Actual Task runs still capture their immutable Event payloads.
      if (!(record.plugin.runtime?.ingest === 'sensors-v1' && /^sensor-|^other-reading$|^phone-/.test(event.id))) {
        await this.writeLog(record, `Event: ${event.name}`, { ...fields, eventId: event.id, payload });
      }
      return this.engine.emitPluginEvent(record.plugin.id, event.id, payload, context);
    } else throw new Error('Unknown plugin host service.');
    return null;
  }

  beginClose() {
    this.closing = true;
    for (const record of this.records.values()) this.cancelOperations(record);
  }

  async close() {
    this.beginClose();
    await this.queue;
    for (const record of this.records.values()) this.cancelOperations(record);
    for (const record of this.records.values()) {
      await record.settingsQueue;
      await record.actionQueue;
      await record.pollOperation;
      await record.runtime?.close();
      await record.log.queue;
      await record.state.queue;
      await record.cards?.queue;
    }
  }
}
