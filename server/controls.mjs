/** Plugin-owned interactive pages. A viewer receives only saved controls and a
 * page/revision capability, never administrator credentials or action arguments.
 * Runs claim their request identity before admission and never replay on restart.
 */
import {displayPalette} from './color-themes.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { JsonStore, HttpError } from './storage.mjs';
import { isIdentifier, validateValues, validateValue, glyphs } from './plugin-schema.mjs';
import { projectCardData } from './cards.mjs';
import { validateLighting, lightingModel, captureLightingScene, authorLightingScene, editableLightingScene } from './control-lighting.mjs';
import { televisionRole } from './control-television.mjs';

function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new HttpError(400, 'Unknown Controls property.');
}
function label(value, maximum = 64) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new HttpError(400, 'Enter a valid control name.');
  return value.trim();
}
function checkStorageSize(value) {
  // Match JsonStore's readable on-disk encoding, including indentation. A store
  // accepted here must also fit the startup bound after a restart.
  if (Buffer.byteLength(JSON.stringify(value, null, 2) + '\n', 'utf8') > 2 * 1024 * 1024) throw new HttpError(400, 'This plugin’s saved Controls must fit within 2 MiB.');
}
export function validateControlsDeclaration(value, actions, runtime, cardFields = [], settings = []) {
  if (value === undefined) return null;
  object(value, ['actions', 'lighting', 'television', 'taskSceneAction']);
  if (value.television !== undefined && value.television !== true) throw new Error('Television presentation must explicitly opt in.');
  if (!runtime || !Array.isArray(value.actions) || !value.actions.length || value.actions.length > 64
    || new Set(value.actions).size !== value.actions.length || value.actions.some(id => id === 'delay' || !actions.some(action => action.id === id)
      || actions.find(action => action.id === id).settingsOnly
      || actions.find(action => action.id === id).parameters.some(field => field.format === 'secret' || field.type === 'list'))) throw new Error('Controls needs an explicit list of non-secret declared runtime actions.');
  const lighting = validateLighting(value.lighting, actions, cardFields, value.actions, settings);
  if (value.taskSceneAction !== undefined) {
    const action = actions.find(action => action.id === value.taskSceneAction);
    if (!lighting || !action || action.settingsOnly || value.actions.includes(action.id)
      || action.parameters.length !== 1 || action.parameters[0].id !== 'scene-id'
      || action.parameters[0].type !== 'string' || !action.parameters[0].required
      || action.parameters[0].format === 'secret' || action.parameters[0].maxLength !== 161) {
      throw new Error('Task scenes need a separate declared lighting action with one bounded scene-id parameter.');
    }
  }
  return { actions: [...value.actions], ...(lighting ? { lighting } : {}), ...(value.television ? { television: true } : {}),
    ...(value.taskSceneAction ? {taskSceneAction: value.taskSceneAction} : {}) };
}
export function controlActions(plugin) {
  return plugin.actions.filter(action => plugin.controls?.actions.includes(action.id));
}
function sceneFade(value, plugin, item) {
  if (value === undefined || value === null) return undefined;
  if (!plugin.controls?.lighting?.sceneFadeSetting || item.kind !== 'scene'
    || !item.steps.some(step => step.actionId !== 'delay')
    || item.steps.some(step => !['delay', plugin.controls.lighting.actions.lightState].includes(step.actionId))
    || !Number.isFinite(value) || value < 0 || value > 60) throw new HttpError(400, 'Choose a 0–60 second fade for a scene containing stored light settings only.');
  return Math.round(value * 10) / 10;
}
function validateBinding(binding, plugin, expectedType = null) {
  if (binding === null || binding === undefined) return null;
  object(binding, ['field', 'column', 'rowColumn', 'rowValue']);
  const field = plugin.cardFields.find(field => field.id === binding.field);
  if (!field) throw new HttpError(400, 'Choose a declared public reading.');
  if (field.type !== 'table') {
    if (Object.keys(binding).length !== 1 || !['string', 'number', 'boolean', 'timestamp'].includes(field.type)
      || expectedType && field.type !== expectedType) throw new HttpError(400, 'Reading type does not match this control.');
    return { field: field.id };
  }
  const column = field.columns.find(column => column.id === binding.column), rowColumn = field.columns.find(column => column.id === binding.rowColumn);
  if (!column || !rowColumn || rowColumn.type !== 'string' || typeof binding.rowValue !== 'string' || !binding.rowValue.length || binding.rowValue.length > 128
    || expectedType && column.type !== expectedType) throw new HttpError(400, 'Choose a typed public table column and stable row identity.');
  return { field: field.id, column: column.id, rowColumn: rowColumn.id, rowValue: binding.rowValue };
}
function validateStep(value, plugin, old, preserveMissing) {
  object(value, ['id', 'actionId', 'parameters', 'seconds']);
  if (typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value.id)) throw new HttpError(400, 'Invalid control step identity.');
  if (value.actionId === 'delay') {
    if (!Number.isFinite(value.seconds) || value.seconds < 0.01 || value.seconds > 10 || value.parameters !== undefined) throw new HttpError(400, 'Scene delays must be 0.01–10 seconds.');
    return { id: value.id, actionId: 'delay', seconds: value.seconds };
  }
  const action = controlActions(plugin).find(action => action.id === value.actionId);
  if (!action) {
    // Retain missing references while editing unrelated fields. New controls
    // cannot introduce undeclared actions, and unavailable steps cannot execute.
    if ((preserveMissing || old && JSON.stringify(old) === JSON.stringify(value)) && isIdentifier(value.actionId)
      && value.parameters && typeof value.parameters === 'object' && !Array.isArray(value.parameters)
      && Object.keys(value.parameters).length <= 32 && Object.values(value.parameters).every(entry => ['string', 'number', 'boolean'].includes(typeof entry)
        && (typeof entry !== 'string' || entry.length <= 4000) && (typeof entry !== 'number' || Number.isFinite(entry)))) return structuredClone(value);
    throw new HttpError(400, 'Choose an action exposed by this plugin’s Controls.');
  }
  if (value.seconds !== undefined) throw new HttpError(400, 'Only scene delays have a duration.');
  return { id: value.id, actionId: action.id, parameters: validateValues(action.parameters, value.parameters || {}, true) };
}
export function validateControlPage(value, plugin, existing = null, preserveMissing = false) {
  object(value, ['id', 'revision', 'schemaVersion', 'name', 'slug', 'enabled', 'icon', 'columns', 'items', 'presentation']);
  const presentation = value.presentation ?? 'mapped';
  if (!['mapped', 'lighting', 'television'].includes(presentation)
    || presentation !== 'mapped' && !plugin.controls?.[presentation] && !preserveMissing && existing?.presentation !== presentation) throw new HttpError(400, 'Choose an available Controls presentation.');
  if (value.schemaVersion !== 1 || typeof value.enabled !== 'boolean' || !glyphs.includes(value.icon)
    || typeof value.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug) || value.slug.length > 64
    || !Number.isInteger(value.columns) || value.columns < 1 || value.columns > 6 || !Array.isArray(value.items) || value.items.length > 64) throw new HttpError(400, 'Choose a URL name, glyph, 1–6 columns and at most 64 controls.');
  const identities = new Set();
  const items = value.items.map(item => {
    object(item, ['id', 'label', 'kind', 'enabled', 'icon', 'steps', 'parameter', 'binding', 'fadeSeconds']);
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) || item.id.startsWith('remote-') || identities.has(item.id)
      || !['button', 'scene', 'toggle', 'range', 'select'].includes(item.kind) || typeof item.enabled !== 'boolean'
      || !glyphs.includes(item.icon) || !Array.isArray(item.steps) || !item.steps.length || item.steps.length > 32
      || item.kind !== 'scene' && (item.steps.length !== 1 || item.steps[0].actionId === 'delay')) throw new HttpError(400, 'Choose a valid control type, identity and action steps.');
    identities.add(item.id);
    const old = existing?.items.find(entry => entry.id === item.id), stepIds = new Set();
    const steps = item.steps.map(step => {
      if (stepIds.has(step.id)) throw new HttpError(400, 'Scene step identities must be unique.');
      stepIds.add(step.id); return validateStep(step, plugin, old?.steps.find(entry => entry.id === step.id), preserveMissing);
    });
    if (steps.filter(step => step.actionId === 'delay').reduce((sum, step) => sum + step.seconds, 0) > 60) throw new HttpError(400, 'Scene delays may total at most 60 seconds.');
    let parameter = null, expectedType = null;
    if (['toggle', 'range', 'select'].includes(item.kind)) {
      const action = controlActions(plugin).find(action => action.id === steps[0].actionId);
      const field = action?.parameters.find(field => field.id === item.parameter);
      const valid = field && (item.kind === 'toggle' ? field.type === 'boolean' : item.kind === 'range'
        ? field.type === 'number' && !field.enum && Number.isFinite(field.min) && Number.isFinite(field.max) && field.min < field.max
        : ['string', 'number'].includes(field.type) && field.enum?.length);
      if (!valid) {
        if (!(preserveMissing || old && old.parameter === item.parameter && JSON.stringify(old.steps) === JSON.stringify(steps))) throw new HttpError(400, 'Choose a compatible adjustable action parameter.');
      }
      parameter = item.parameter; expectedType = field?.type || null;
    } else if (item.parameter !== undefined && item.parameter !== null) throw new HttpError(400, 'Only adjustable controls accept a value parameter.');
    let binding;
    try { binding = validateBinding(item.binding, plugin, expectedType); }
    catch (error) { if (!(preserveMissing || old && JSON.stringify(old.binding) === JSON.stringify(item.binding))) throw error; binding = structuredClone(item.binding); }
    const fadeSeconds = sceneFade(item.fadeSeconds, plugin, {...item, steps});
    return { id: item.id, label: label(item.label), kind: item.kind, enabled: item.enabled, icon: item.icon, steps, parameter, binding,
      ...(fadeSeconds !== undefined ? {fadeSeconds} : {}) };
  });
  return { schemaVersion: 1, id: existing?.id || randomUUID(), revision: (existing?.revision || 0) + 1,
    name: label(value.name), slug: value.slug, enabled: value.enabled, icon: value.icon, columns: value.columns, presentation, items };
}

export class ControlsStore {
  constructor(root, registry, config, activity) {
    Object.assign(this, { root, registry, config, activity });
    this.stores = new Map(); this.active = new Map(); this.secret = randomBytes(32); this.closing = false;
    this.failures = new Map();
    this.runs = new JsonStore(path.join(root, 'data/control-runs.json'), { schemaVersion: 1, runs: [] });
  }
  async load() {
    await this.runs.load();
    const saved = this.runs.snapshot();
    if (saved.schemaVersion !== 1 || !Array.isArray(saved.runs) || saved.runs.length > 108) throw new Error('Invalid Controls run history; original file retained.');
    if (saved.runs.some(run => ['queued', 'running'].includes(run.status))) await this.runs.update(current => {
      for (const run of current.runs) if (['queued', 'running'].includes(run.status)) { run.status = 'interrupted'; run.finishedAt = Date.now(); run.message = 'Server restarted; no commands were replayed.'; }
    });
    await this.sync(); return this;
  }
  async sync() {
    for (const plugin of this.registry.plugins.filter(plugin => plugin.controls)) {
      if (this.stores.has(plugin.id)) continue;
      const entry = { store: null, error: '' }; this.stores.set(plugin.id, entry);
      try {
        if (!this.registry.records.has(plugin.id)) throw new Error('Plugin data unavailable.');
        const file = path.join(this.root, 'plugins', plugin.folder, 'data/controls.json');
        const realRoot = await fs.realpath(this.root), realData = await fs.realpath(path.dirname(file));
        if (!realData.startsWith(realRoot + path.sep)) throw new Error('Controls data must remain inside its plugin.');
        try { const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error('Invalid Controls file.'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        const store = await new JsonStore(file, { schemaVersion: 1, pages: [] }).load(), saved = store.snapshot();
        if (saved.schemaVersion !== 1 || !Array.isArray(saved.pages) || saved.pages.length > 50) throw new Error('Invalid Controls store.');
        const ids = new Set(), slugs = new Set();
        for (const page of saved.pages) {
          validateControlPage(page, plugin, page, true);
          if (typeof page.id !== 'string' || !Number.isSafeInteger(page.revision) || page.revision < 1 || ids.has(page.id) || slugs.has(page.slug)) throw new Error('Invalid Controls page identity/revision.');
          ids.add(page.id); slugs.add(page.slug);
        }
        entry.store = store;
      } catch { entry.error = 'Controls could not be loaded; original controls.json was retained.'; }
    }
    this.reconcile();
  }
  plugin(id) {
    const plugin = this.registry.plugins.find(plugin => plugin.id === id && plugin.controls);
    if (!plugin) throw new HttpError(404, 'Controls plugin unavailable.');
    return plugin;
  }
  pages(id) { return this.stores.get(id)?.store?.snapshot().pages || []; }
  taskScenes(pluginId) {
    const plugin = this.plugin(pluginId);
    if (!plugin.controls.taskSceneAction) return [];
    return this.pages(pluginId).flatMap(page => page.items.filter(item => item.kind === 'scene').map(item => ({
      id: `${page.id}/${item.id}`, name: `${page.name} · ${item.label}`,
      available: page.enabled && this.available(plugin, item),
    })));
  }
  requireTaskScene(pluginId, sceneId) {
    if (!this.taskScenes(pluginId).some(scene => scene.id === sceneId && scene.available)) {
      throw new HttpError(409, 'Choose an enabled stored lighting scene on an enabled Controls page.');
    }
    const [pageId, itemId] = sceneId.split('/');
    return {page: this.pages(pluginId).find(page => page.id === pageId), itemId};
  }
  async runTaskScene(pluginId, sceneId, context) {
    context.signal?.throwIfAborted();
    const {page, itemId} = this.requireTaskScene(pluginId, sceneId);
    // Use the normal durable Controls admission, captured page revision and
    // concurrency limits. The host supplies its own capability, never the Task.
    const run = await this.invoke(pluginId, page.slug, this.token(pluginId, page), {
      revision: page.revision, itemId, requestId: randomUUID(),
    }, context);
    const active = this.active.get(pluginId);
    if (active?.runId === run.id) await active.done;
    context.signal?.throwIfAborted();
    const result = this.runs.snapshot().runs.find(item => item.id === run.id);
    if (result?.status !== 'completed') throw new HttpError(409, result?.message || 'Lighting scene did not complete; no retry was made.');
    return {completed: true};
  }
  admin() {
    return this.registry.plugins.filter(plugin => plugin.controls).map(plugin => ({ pluginId: plugin.id,
      error: this.stores.get(plugin.id)?.error || '', pages: this.pages(plugin.id) }));
  }
  entry(id) {
    const plugin = this.plugin(id), entry = this.stores.get(id);
    if (!entry?.store) throw new HttpError(409, entry?.error || 'Controls store unavailable.');
    return { plugin, store: entry.store };
  }
  async save(pluginId, values, pageId = null, operation = null) {
    if (this.closing) throw new HttpError(503, 'Server is stopping.');
    const { plugin, store } = this.entry(pluginId); let saved;
    await store.update(current => {
      const index = current.pages.findIndex(page => page.id === pageId), existing = current.pages[index];
      if (pageId && !existing) throw new HttpError(404, 'Control page not found.');
      if (existing && values.revision !== existing.revision) throw new HttpError(409, 'These Controls changed. Close and reopen the editor.');
      if (operation) {
        object(values, operation === 'enabled' ? ['revision', 'enabled'] : ['revision']);
        if (!existing) throw new HttpError(404, 'Control page not found.');
        if (operation === 'delete') { current.pages.splice(index, 1); saved = existing; return; }
        if (operation !== 'enabled' || typeof values.enabled !== 'boolean') throw new HttpError(400, 'Choose Controls Enabled on or off.');
        existing.enabled = values.enabled; existing.revision++; saved = existing; checkStorageSize(current); return;
      }
      if (!existing && current.pages.length >= 50) throw new HttpError(400, 'A plugin supports at most 50 Control pages.');
      saved = validateControlPage(values, plugin, existing);
      if (current.pages.some(page => page.id !== saved.id && (page.slug === saved.slug || page.name.toLowerCase() === saved.name.toLowerCase()))) throw new HttpError(409, 'Choose a unique page name and URL name within this plugin.');
      if (existing) current.pages[index] = saved; else current.pages.push(saved);
      checkStorageSize(current);
    });
    // Commit edits/disable/delete before cancelling work. A stale invocation
    // cannot continue with a newly mapped button or a disabled page.
    this.reconcile();
    await this.activity.add(`Controls ${operation || (pageId ? 'updated' : 'created')}: ${saved.name}`, { pluginId, controlPageId: saved.id });
    return saved;
  }
  available(plugin, item) {
    if (!item?.enabled || !item.steps.length) return false;
    try {
      for (const step of item.steps) validateStep(step, plugin, null, false);
      sceneFade(item.fadeSeconds, plugin, item);
      if (['toggle', 'range', 'select'].includes(item.kind)) {
        const field = controlActions(plugin).find(action => action.id === item.steps[0].actionId)?.parameters.find(field => field.id === item.parameter);
        if (!field || (item.kind === 'toggle' ? field.type !== 'boolean' : item.kind === 'range'
          ? field.type !== 'number' || field.enum || !Number.isFinite(field.min) || !Number.isFinite(field.max) || field.min >= field.max : !['string', 'number'].includes(field.type) || !field.enum)) return false;
      }
      return true;
    } catch { return false; }
  }
  ready(pluginId) {
    try { this.registry.assertReady(this.registry.get(pluginId)); return !this.registry.engine.gate.paused && !this.closing; } catch { return false; }
  }
  options() { const config = this.config.snapshot(); return { name: config.name, theme: config.displayTheme ?? config.theme, colorTheme:displayPalette(config), fontScale: config.vistaFontScale ?? config.fontScale, timeFormat: config.timeFormat }; }
  index() {
    return { options: this.options(), pages: this.registry.plugins.filter(plugin => plugin.controls).flatMap(plugin => this.pages(plugin.id).filter(page => page.enabled).map(page => ({
      pluginId: plugin.id, pluginName: plugin.name, name: page.name, slug: page.slug, icon: page.icon, available: this.ready(plugin.id), url: `/controls/${plugin.id}/${page.slug}`,
    }))) };
  }
  resolve(pluginId, slug) {
    const plugin = this.plugin(pluginId), page = this.pages(pluginId).find(page => page.slug === slug && page.enabled);
    if (!page) throw new HttpError(404, 'Controls unavailable.');
    return { plugin, page };
  }
  token(pluginId, page) { return createHmac('sha256', this.secret).update(`${pluginId}/${page.id}/${page.revision}`).digest('hex'); }
  verify(pluginId, page, value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value) || !timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(this.token(pluginId, page), 'hex'))) throw new HttpError(403, 'Refresh this Control page before using it.');
  }
  lighting(plugin, page, data = null) {
    const record = this.registry.get(plugin.id), declaration = plugin.controls?.lighting;
    if (!declaration || page.presentation !== 'lighting') return null;
    // A replacement gateway must never inherit another gateway's targets or
    // captured settings while its first read is pending. These keys stay private.
    const identityMatches = record.config.snapshot().settings[declaration.identitySetting] === record.state.snapshot()[declaration.identityState];
    return lightingModel(plugin, page, data || projectCardData(plugin, record, this.registry.engine.gate.paused), identityMatches);
  }
  itemsFor(plugin, page) { return [...page.items, ...(this.lighting(plugin, page)?.items || [])]; }
  sceneDetails(pluginId, pageId) {
    const plugin=this.plugin(pluginId),page=this.pages(pluginId).find(item=>item.id===pageId);
    if(!page||!this.lighting(plugin,page))throw new HttpError(404,'Lighting remote unavailable.');
    const lighting=this.lighting(plugin,page);
    const fadeSetting=plugin.controls.lighting.sceneFadeSetting;
    const fadeDefault=fadeSetting ? this.registry.get(pluginId).config.snapshot().settings[fadeSetting]
      ?? plugin.settings.find(field=>field.id===fadeSetting).default : undefined;
    return {pageId:page.id,name:page.name,revision:page.revision,enabled:page.enabled,available:this.ready(pluginId)&&page.enabled,busy:this.active.has(pluginId),lighting,
      ...(fadeSetting ? {fadeDefault} : {}),
      scenes:page.items.filter(item=>item.kind==='scene'),
      editableScenes:Object.fromEntries(page.items.filter(item=>item.kind==='scene').map(scene=>[scene.id,editableLightingScene(plugin,lighting,scene)]))};
  }
  async administerScene(pluginId, pageId, values, run=false) {
    this.sceneDetails(pluginId,pageId);
    const page=this.pages(pluginId).find(item=>item.id===pageId);
    if(run){
      if(!page.items.some(item=>item.id===values.itemId&&item.kind==='scene'))throw new HttpError(404,'Scene unavailable.');
      return this.invoke(pluginId,page.slug,this.token(pluginId,page),values);
    }
    return this.scene(pluginId,page.slug,null,values,true);
  }
  async scene(pluginId, slug, token, values, administrator=false, admission=()=>{}) {
    object(values, ['action', 'revision', 'itemId', 'name', 'lightIds', 'lights', 'enabled', 'icon', 'fadeSeconds']);
    const plugin=this.plugin(pluginId),page=this.pages(pluginId).find(item=>item.slug===slug&&(administrator||item.enabled));
    if(!page)throw new HttpError(404,'Lighting remote unavailable.');
    if(!administrator)this.verify(pluginId,page,token);
    if (!administrator && (values.action==='create' || values.lights!==undefined)) throw new HttpError(403,'Use administration to design lighting settings.');
    if (!administrator && values.fadeSeconds!==undefined) throw new HttpError(403,'Use administration to change scene fades.');
    if (!this.lighting(plugin, page) || !['create', 'capture', 'edit', 'copy', 'enabled', 'delete'].includes(values.action)) throw new HttpError(400, 'Choose a lighting scene operation.');
    const fields = {create:['action','revision','name','lights','icon','fadeSeconds'], capture: ['action','revision','name','lightIds','icon','fadeSeconds'], edit: ['action','revision','itemId','name','lightIds','lights','icon','fadeSeconds'],
      copy: ['action','revision','itemId','name','icon','fadeSeconds'], enabled: ['action','revision','itemId','enabled'], delete: ['action','revision','itemId'] };
    object(values, fields[values.action]);
    if(values.lights!==undefined&&values.lightIds!==undefined)throw new HttpError(400,'Choose designed settings or current lighting.');
    if(values.icon!==undefined&&!glyphs.includes(values.icon))throw new HttpError(400,'Choose a bundled Material Symbols glyph.');
    if (values.revision !== page.revision) throw new HttpError(409, 'These scenes changed. Close and reopen the editor.');
    const needsReading=!administrator||['create','capture'].includes(values.action)||values.lightIds!==undefined||values.lights!==undefined;
    if (needsReading&&!this.ready(pluginId) || this.active.has(pluginId)) throw new HttpError(409, 'Wait until lighting is ready and no Control is running.');
    const { store } = this.entry(pluginId);
    await store.update(current => {
      admission();
      if (this.closing || needsReading&&!this.ready(pluginId) || this.active.has(pluginId)) throw new HttpError(409, 'Lighting is unavailable or busy.');
      const saved = current.pages.find(entry => entry.id === page.id && (administrator||entry.enabled));
      if (!saved || saved.revision !== values.revision) throw new HttpError(409, 'These scenes changed. Close and reopen the editor.');
      const item = saved.items.find(entry => entry.id === values.itemId && entry.kind === 'scene');
      if (!['create','capture'].includes(values.action) && !item) throw new HttpError(404, 'Scene unavailable.');
      if (values.action === 'delete') saved.items = saved.items.filter(entry => entry.id !== item.id);
      else if (values.action === 'enabled') {
        if (typeof values.enabled !== 'boolean') throw new HttpError(400, 'Choose scene Enabled on or off.');
        item.enabled = values.enabled;
      } else if (values.action === 'copy') {
        if (saved.items.length >= 64) throw new HttpError(400, 'This page supports at most 64 controls.');
        const copy = structuredClone(item);
        copy.id = randomUUID(); copy.label = label(values.name); copy.enabled = false;
        if(values.icon!==undefined)copy.icon=values.icon;
        if(Object.hasOwn(values,'fadeSeconds')){
          delete copy.fadeSeconds;
          const fade=sceneFade(values.fadeSeconds,plugin,copy);
          if(fade!==undefined)copy.fadeSeconds=fade;
        }
        copy.steps.forEach(step => { step.id = randomUUID(); }); saved.items.push(copy);
      } else {
        const name = label(values.name);
        let captured;
        if (['create','capture'].includes(values.action) || values.lightIds !== undefined || values.lights !== undefined) {
          const model = this.lighting(plugin, saved), record = this.registry.get(pluginId);
          const maxAge = Math.max(120000, this.registry.pollMilliseconds(record) * 2 + 30000);
          if (!model.receivedAt || Date.now() - model.receivedAt > maxAge || record.pending) throw new HttpError(409, 'Refresh lighting and wait for commands to finish before capturing.');
          captured = values.action==='create'||values.lights!==undefined ? authorLightingScene(plugin,model,values.lights,name) : captureLightingScene(plugin, model, values.lightIds, name);
        }
        if (['create','capture'].includes(values.action)) {
          if (saved.items.length >= 64) throw new HttpError(400, 'This page supports at most 64 controls.');
          if(values.icon!==undefined)captured.icon=values.icon;
          const fade=sceneFade(values.fadeSeconds,plugin,captured);
          if(fade!==undefined)captured.fadeSeconds=fade;
          saved.items.push(captured);
        } else {
          item.label = name;
          if(values.icon!==undefined)item.icon=values.icon;
          if (captured) item.steps = captured.steps;
          if(Object.hasOwn(values,'fadeSeconds')){
            delete item.fadeSeconds;
            const fade=sceneFade(values.fadeSeconds,plugin,item);
            if(fade!==undefined)item.fadeSeconds=fade;
          }
        }
      }
      if (new Set(saved.items.filter(entry => entry.kind === 'scene').map(entry => entry.label.toLowerCase())).size !== saved.items.filter(entry => entry.kind === 'scene').length) throw new HttpError(409, 'Choose a unique scene name.');
      const validated = validateControlPage(saved, plugin, saved);
      current.pages[current.pages.indexOf(saved)] = validated;
      checkStorageSize(current);
    });
    // The revision commits before any in-flight page is invalidated. Saving or
    // copying a scene has no device effect; only the normal Run path executes it.
    this.reconcile();
    await this.activity.add(`Lighting scene ${values.action}: ${page.name}`, { pluginId, controlPageId: page.id });
    return { saved: true };
  }
  viewer(pluginId, slug) {
    const { plugin, page } = this.resolve(pluginId, slug), record = this.registry.get(pluginId);
    const data = projectCardData(plugin, record, this.registry.engine.gate.paused);
    const lighting = this.lighting(plugin, page, data);
    const items = [...page.items, ...(lighting?.items || [])].filter(item => item.enabled || lighting && item.id.startsWith('remote-')).map(item => {
      const action = controlActions(plugin).find(action => action.id === item.steps[0]?.actionId), field = action?.parameters.find(field => field.id === item.parameter);
      let value = item.remoteReported ?? null;
      let binding = null;
      try { binding = validateBinding(item.binding, plugin, field?.type || null); } catch { /* Retained unavailable bindings report No data. */ }
      const entry = binding && data.values[binding.field];
      if (entry?.available) value = item.binding.column ? entry.value.find(row => row[item.binding.rowColumn] === item.binding.rowValue)?.[item.binding.column] ?? null : entry.value;
      return { id: item.id, label: item.label, kind: item.kind, icon: item.icon, available: this.available(plugin, item),
        ...(page.presentation === 'television' && plugin.controls.television ? { remoteRole: televisionRole(item) } : {}),
        hasReading: Boolean(item.binding) || Object.hasOwn(item, 'remoteReported'), reported: value, ...(field ? { input: { type: field.type, min: field.min, max: field.max, enum: field.enum, enumLabels: field.enumLabels, default: item.steps[0].parameters[field.id] } } : {}) };
    });
    const recent = this.runs.snapshot().runs.filter(run => run.pluginId === pluginId && run.pageId === page.id).slice(-5).map(({ id, itemId, status, step, totalSteps, message, startedAt, finishedAt }) => ({ id, itemId, status, step, totalSteps, message, startedAt, finishedAt }));
    return { page: { id: page.id, name: page.name, slug: page.slug, revision: page.revision, pluginId, pluginName: plugin.name, columns: page.columns, presentation: page.presentation || 'mapped', icon: page.icon, items },
      ...(lighting ? { lighting: { lights: lighting.lights, groups: lighting.groups, receivedAt: lighting.receivedAt, glyphs,
        scenes: page.items.filter(item => item.kind === 'scene').map(item => ({ id: item.id, label: item.label, icon:item.icon, enabled: item.enabled, available: this.available(plugin, item), steps: item.steps.length })) } } : {}),
      options: this.options(), available: this.ready(pluginId), busy: this.active.has(pluginId),
      activeRunId: this.active.get(pluginId)?.page.id === page.id ? this.active.get(pluginId).runId : null,
      token: this.token(pluginId, page), runs: recent };
  }
  reconcile() {
    for (const [pluginId, active] of this.active) {
      const page = this.pages(pluginId).find(page => page.id === active.page.id && page.enabled && page.revision === active.page.revision);
      try {
        const record = this.registry.get(pluginId), plugin = this.plugin(pluginId);
        this.registry.assertReady(record);
        if (!page || record.config.snapshot().revision !== active.configurationRevision
          || !this.available(plugin, this.itemsFor(plugin, page).find(item => item.id === active.itemId))) throw new Error();
      }
      catch { active.controller.abort(new Error('Controls or plugin changed; remaining steps were cancelled.')); }
    }
  }
  async invoke(pluginId, slug, token, values, context = {}) {
    context.signal?.throwIfAborted();
    object(values, ['itemId', 'requestId', 'revision', 'value']);
    const { plugin, page } = this.resolve(pluginId, slug); this.verify(pluginId, page, token);
    if (values.revision !== page.revision || typeof values.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(values.requestId)) throw new HttpError(409, 'Use this page’s current revision and a fresh request identity.');
    const item = this.itemsFor(plugin, page).find(item => item.id === values.itemId);
    if (!item || !this.available(plugin, item)) throw new HttpError(409, 'This control is unavailable.');
    const steps = structuredClone(item.steps);
    if (item.parameter) {
      const action = controlActions(plugin).find(action => action.id === steps[0].actionId), field = action?.parameters.find(field => field.id === item.parameter);
      if (!field) throw new HttpError(409, 'Adjustable control unavailable.');
      if (item.kind === 'color' && !/^#[0-9a-f]{6}$/i.test(values.value || '')) throw new HttpError(400, 'Choose a colour in #RRGGBB format.');
      validateValue(field, values.value); steps[0].parameters[item.parameter] = values.value;
    } else if (Object.hasOwn(values, 'value')) throw new HttpError(400, 'Mapped buttons and scenes do not accept parameter overrides.');
    let run, active, created = false;
    try {
      await this.runs.update(current => {
        context.signal?.throwIfAborted();
        const currentPage = this.resolve(pluginId, slug).page;
        if (currentPage.id !== page.id || currentPage.revision !== page.revision) throw new HttpError(409, 'Refresh these Controls before using them.');
        const old = current.runs.find(run => run.id === values.requestId);
        if (old) {
          if (old.pluginId !== pluginId || old.pageId !== page.id || old.itemId !== item.id || old.revision !== page.revision) throw new HttpError(409, 'This request identity was already used.');
          run = old; return;
        }
        if (!this.ready(pluginId)) throw new HttpError(409, 'Controls unavailable or server paused.');
        if (this.active.has(pluginId) || this.active.size >= 8) throw new HttpError(429, 'Controls busy. Wait for the current command to finish.');
        active = { page: structuredClone(page), controller: new AbortController(), runId: values.requestId, itemId: item.id, fadeSeconds: item.fadeSeconds,
          configurationRevision: this.registry.get(pluginId).config.snapshot().revision, context };
        // Link the owning Task before persisting admission. Cancellation during
        // that write must prevent the first command, and shutdown drains done.
        active.abortOwner = () => active.controller.abort(context.signal.reason);
        context.signal?.addEventListener('abort', active.abortOwner, {once: true});
        if (context.signal?.aborted) active.abortOwner();
        // Shutdown can arrive while the durable claim is being written. Reserve
        // completion now, before that await, so close drains the entire admission.
        active.done = new Promise(resolve => { active.finish = resolve; });
        this.active.set(pluginId, active); created = true;
        run = { id: values.requestId, pluginId, pageId: page.id, revision: page.revision, itemId: item.id, status: 'queued', step: 0, totalSteps: steps.length, startedAt: Date.now(), message: 'Waiting',
          ...(context.taskId ? {taskId: context.taskId, taskRunId: context.runId, taskStepId: context.stepId} : {}) };
        const running = current.runs.filter(entry => ['queued', 'running'].includes(entry.status));
        const finished = current.runs.filter(entry => !['queued', 'running'].includes(entry.status) && Date.now() - entry.startedAt < 7 * 86400000).slice(-99);
        current.runs = [...running, ...finished].sort((a, b) => a.startedAt - b.startedAt);
        current.runs.push(run);
      });
    } catch (error) {
      if (created && this.active.get(pluginId) === active) this.active.delete(pluginId);
      if (active) context.signal?.removeEventListener('abort', active.abortOwner);
      active?.finish();
      throw error;
    }
    if (created) {
      // Begin only after the durable claim succeeds. HTTP acceptance survives
      // viewer disconnect; explicit Cancel/disable/stop cooperatively ends work.
      if (this.closing) active.controller.abort(new Error('Server stopping.'));
      active.operation = this.perform(pluginId, active, steps).catch(async error => {
        this.rememberFailure(pluginId,active,error,'history-result');
        // A failed history replacement may also prevent saving the terminal
        // status. Do not replay; leave its durable claim for restart recovery.
        await this.activity.add(`Controls history unavailable: ${active.page.name}; no remaining commands were replayed.`, { pluginId, controlPageId: active.page.id, level: 'warning' }).catch(() => {});
      }).finally(() => {
        context.signal?.removeEventListener('abort', active.abortOwner);
        if (this.active.get(pluginId) === active) this.active.delete(pluginId);
        active.finish();
      });
    }
    return { id: run.id, status: run.status };
  }
  async updateRun(id, patch) {
    for(let attempt=0;;attempt++)try {
      await this.runs.update(current => {const run=current.runs.find(run=>run.id===id);if(run)Object.assign(run,patch);});
      return;
    }catch(error){
      // Windows file sharing can briefly block atomic replacement. Retry only
      // this receipt write, never admission, a command or the execution loop.
      if(process.platform!=='win32'||error.syscall!=='rename'||!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt>=2)throw error;
      await new Promise(resolve=>setTimeout(resolve,50*(attempt+1)));
    }
  }
  rememberFailure(pluginId,active,error,stage) {
    const code=['EPERM','EBUSY','EACCES','ENOSPC','EROFS','EIO','ERR_INVALID_ARG_TYPE'].includes(error.code)?error.code:null;
    const type=['Error','TypeError','RangeError','DataCloneError','AbortError','TimeoutError'].includes(error.name)?error.name:'Error';
    this.failures.set(pluginId,{at:Date.now(),runId:active.runId,stage,code,type});
  }
  assertSceneFade(pluginId, actionId, context) {
    const active=this.active.get(pluginId),plugin=this.plugin(pluginId);
    if(!active || active.runId!==context.lightingScene || active.signal!==context.signal || context.signal.aborted
      || !Number.isFinite(context.lightingFadeSeconds)
      || active.controller.signal.aborted || !plugin.controls?.lighting?.sceneFadeSetting
      || actionId!==plugin.controls.lighting.actions.lightState || active.fadeSeconds!==context.lightingFadeSeconds
      || this.registry.get(pluginId).config.snapshot().revision!==active.configurationRevision
      || this.pages(pluginId).find(page=>page.id===active.page.id)?.revision!==active.page.revision)
      throw new HttpError(409,'Lighting scene changed or stopped; no fade override was applied.');
    sceneFade(active.fadeSeconds,plugin,active.page.items.find(item=>item.id===active.itemId));
  }
  async perform(pluginId, active, steps) {
    const signal = AbortSignal.any([active.controller.signal, AbortSignal.timeout(300000)]);
    active.signal=signal;
    try {
      active.phase='history-start';
      await this.updateRun(active.runId, { status: 'running', message: 'Running' });
      for (let index = 0; index < steps.length; index++) {
        active.phase='readiness';
        signal.throwIfAborted(); this.reconcile(); signal.throwIfAborted();
        await this.registry.engine.gate.wait(signal);
        this.registry.assertReady(this.registry.get(pluginId));
        active.phase='history-step';await this.updateRun(active.runId, { step: index + 1 });
        // A write yields to edits, pause and configuration changes. Recheck the
        // saved ownership and current declaration before the next effect.
        this.reconcile(); signal.throwIfAborted();
        await this.registry.engine.gate.wait(signal);
        const step = steps[index];
        active.phase='command';
        if (step.actionId === 'delay') await this.registry.engine.gate.delay(step.seconds * 1000, signal);
        else await this.registry.execute(pluginId, step.actionId, step.parameters, {...active.context, signal,
          ...(active.fadeSeconds!==undefined ? {lightingScene:active.runId,lightingFadeSeconds:active.fadeSeconds,
            configRevision:active.configurationRevision} : {})});
      }
      active.phase='history-complete';await this.updateRun(active.runId, { status: 'completed', finishedAt: Date.now(), message: 'Commands completed. Reported readings confirm device state.' });
      await this.activity.add(`Controls completed: ${active.page.name}`, { pluginId, controlPageId: active.page.id });
    } catch (error) {
      if(!signal.aborted)this.rememberFailure(pluginId,active,error,active.phase||'execution');
      await this.updateRun(active.runId, { status: signal.aborted ? 'cancelled' : 'failed', finishedAt: Date.now(),
        message: signal.aborted ? 'Remaining steps cancelled. Check any command already sent before trying again.' : 'Control failed. Check plugin Activity and any command already sent before trying again.' });
      await this.activity.add(`Controls ${signal.aborted ? 'cancelled' : 'failed'}: ${active.page.name}`, { pluginId, controlPageId: active.page.id, level: 'warning' });
    }
  }
  cancel(pluginId, slug, token, values) {
    object(values, ['runId']); const { page } = this.resolve(pluginId, slug); this.verify(pluginId, page, token);
    const active = this.active.get(pluginId);
    if (!active || active.page.id !== page.id || active.runId !== values.runId) throw new HttpError(404, 'Active Controls run not found.');
    active.controller.abort(new Error('Cancelled from Control page.')); return { cancelled: true };
  }
  async close() {
    this.closing = true;
    for (const active of this.active.values()) active.controller.abort(new Error('Server stopping.'));
    await Promise.allSettled([...this.active.values()].map(active => active.done));
    for (const entry of this.stores.values()) await entry.store?.queue;
    await this.runs.queue;
  }
}
