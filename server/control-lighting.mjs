/** Declared lighting presentation for Controls. Only typed public Card tables
 * become targets. Scene authoring validates values against reported targets;
 * callers never choose action names or arbitrary command arguments. */
import { randomUUID } from 'node:crypto';
import { HttpError } from './storage.mjs';

const validId = value => typeof value === 'string' && /^\d{1,10}$/.test(value) && Number(value) > 0 && Number(value) <= 0xffffffff;
const percent = value => Number.isFinite(value) && value >= 0 && value <= 100;
const contracts = {
  lightPower: ['id:string', 'on:boolean'], lightBrightness: ['id:string', 'value:number'],
  lightTemperature: ['id:string', 'value:number'], lightColor: ['id:string', 'color:string'],
  lightState: ['id:string', 'on:boolean', 'brightness:number', 'temperature:number', 'hue:number', 'saturation:number'],
  groupPower: ['id:string', 'on:boolean'], groupBrightness: ['id:string', 'value:number'], refresh: [],
};
export function validateLighting(value, actions, cardFields, allowed, settings = []) {
  if (value === undefined) return undefined;
  const keys = ['lights', 'details', 'groups', 'received', 'identitySetting', 'identityState', 'actions', 'inventoryState', 'sceneFadeSetting'];
  if (!value || typeof value !== 'object' || Object.keys(value).some(key => !keys.includes(key))
    || !Array.isArray(value.lights) || value.lights.length !== 2 || !Array.isArray(value.details) || value.details.length !== 2
    || !/^[a-z0-9-]+$/.test(value.identitySetting) || !/^[a-z0-9-]+$/.test(value.identityState)) throw new Error('Invalid lighting Controls declaration.');
  function table(id, columns) {
    const field = cardFields.find(field => field.id === id && field.type === 'table');
    if (!field || columns.some(([id, type]) => !field.columns.some(column => column.id === id && column.type === type))) throw new Error('Lighting Controls needs compatible public tables.');
  }
  if (value.inventoryState !== undefined && (typeof value.inventoryState !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value.inventoryState))) throw new Error('Invalid lighting inventory state key.');
  if (value.sceneFadeSetting !== undefined && !settings.some(field => field.id === value.sceneFadeSetting
    && field.type === 'number' && field.min === 0 && field.max === 60 && Number.isFinite(field.default)
    && field.default >= 0 && field.default <= 60)) throw new Error('Scene fades require a declared 0–60 second numeric setting.');
  value.lights.forEach(id => table(id, [['id','string'],['name','string'],['room','string'],['on','boolean'],['brightness','number'],['reachable','boolean']]));
  value.details.forEach(id => table(id, [['id','string'],['spectrum','string'],['temperature','number'],['hue','number'],['saturation','number']]));
  table(value.groups, [['id','string'],['name','string'],['on','boolean'],['brightness','number'],['count','number']]);
  if (!cardFields.some(field => field.id === value.received && field.type === 'timestamp') || !value.actions
    || Object.keys(value.actions).length !== Object.keys(contracts).length) throw new Error('Lighting Controls needs reception and explicit actions.');
  for (const [name, parameters] of Object.entries(contracts)) {
    const action = actions.find(action => action.id === value.actions[name] && allowed.includes(action.id));
    if (!action || action.parameters.length !== parameters.length || parameters.some(contract => {
      const [id, type] = contract.split(':'); return !action.parameters.some(field => field.id === id && field.type === type);
    })) throw new Error('Lighting Controls action contract does not match.');
  }
  return structuredClone(value);
}

function colorOf(light) {
  if (light.spectrum !== 'rgb' || !Number.isFinite(light.hue) || light.hue < 0 || light.hue > 360 || !percent(light.saturation)) return null;
  const c = light.saturation / 100, h = light.hue % 360 / 60, x = c * (1 - Math.abs(h % 2 - 1));
  const channels = h < 1 ? [c,x,0] : h < 2 ? [x,c,0] : h < 3 ? [0,c,x] : h < 4 ? [0,x,c] : h < 5 ? [x,0,c] : [c,0,x];
  return '#' + channels.map(channel => Math.round((channel + 1 - c) * 255).toString(16).padStart(2, '0')).join('');
}
export function lightingModel(plugin, page, data, identityMatches = true) {
  const declaration = plugin.controls?.lighting;
  if (page.presentation !== 'lighting' || !declaration) return null;
  const rows = id => identityMatches && data.values[id]?.available ? data.values[id].value : [];
  const details = declaration.details.flatMap(rows), seen = new Set();
  const lights = declaration.lights.flatMap(rows).filter(light => {
    if (!validId(light.id) || seen.has(light.id)) return false;
    seen.add(light.id); return true;
  }).slice(0, 20).map(row => {
    const detail = details.find(detail => detail.id === row.id) || {};
    const light = { id: row.id, name: row.name || 'Unnamed light', room: row.room, on: row.on, brightness: row.brightness,
      reachable: row.reachable, spectrum: detail.spectrum, temperature: detail.temperature, hue: detail.hue, saturation: detail.saturation };
    return { ...light, color: colorOf(light), capturable: row.reachable === true && typeof row.on === 'boolean' && percent(row.brightness)
      && ['none', 'white', 'rgb'].includes(detail.spectrum)
      && (detail.spectrum !== 'white' || percent(detail.temperature))
      && (detail.spectrum !== 'rgb' || colorOf(light) !== null) };
  });
  const groups = rows(declaration.groups).filter(group => validId(group.id)).slice(0, 10).map(group => ({
    id: group.id, name: group.name || 'Unnamed group', on: group.on, brightness: group.brightness, count: group.count,
  }));
  const items = [];
  function add(target, type, property, actionId, parameter, value, kind) {
    const id = `remote-${type}-${target.id}-${property}`;
    const parameters = { id: target.id, [parameter]: value ?? (kind === 'toggle' ? false : kind === 'color' ? '#ffffff' : 0) };
    const item = { id, label: `${target.name} · ${property}`, kind, icon: 'lightbulb', enabled: target.reachable !== false,
      steps: [{ id: 'command', actionId, parameters }], parameter, binding: null, remoteReported: value };
    items.push(item); target.controls ||= {}; target.controls[property] = id;
  }
  for (const light of lights) {
    add(light, 'light', 'power', declaration.actions.lightPower, 'on', light.on, 'toggle');
    add(light, 'light', 'brightness', declaration.actions.lightBrightness, 'value', light.brightness, 'range');
    if (light.spectrum === 'white') add(light, 'light', 'temperature', declaration.actions.lightTemperature, 'value', light.temperature, 'range');
    if (light.spectrum === 'rgb') add(light, 'light', 'color', declaration.actions.lightColor, 'color', light.color, 'color');
  }
  for (const group of groups) {
    add(group, 'group', 'power', declaration.actions.groupPower, 'on', group.on, 'toggle');
    add(group, 'group', 'brightness', declaration.actions.groupBrightness, 'value', group.brightness, 'range');
  }
  items.push({ id: 'remote-refresh', label: 'Refresh lighting', kind: 'button', icon: 'rotate', enabled: true,
    steps: [{ id: 'refresh', actionId: declaration.actions.refresh, parameters: {} }], parameter: null, binding: null });
  return { lights, groups, items, receivedAt: identityMatches && data.values[declaration.received]?.available ? data.values[declaration.received].value : null };
}

export function captureLightingScene(plugin, model, lightIds, label) {
  if (!Array.isArray(lightIds) || !lightIds.length || lightIds.length > 20 || new Set(lightIds).size !== lightIds.length) throw new HttpError(400, 'Select 1–20 lights to capture.');
  const steps = lightIds.map(id => {
    const light = model.lights.find(light => light.id === id);
    if (!light?.capturable) throw new HttpError(409, 'Selected lights need complete, reachable reported readings. Refresh lighting first.');
    // One write carries power and dimmer/chromaticity together. Restoring an Off
    // light must not first turn it on through separate brightness/color commands.
    const parameters = { id, on: light.on, brightness: light.brightness };
    if (light.spectrum === 'white') parameters.temperature = light.temperature;
    if (light.spectrum === 'rgb') Object.assign(parameters, { hue: light.hue, saturation: light.saturation });
    return { id: randomUUID(), actionId: plugin.controls.lighting.actions.lightState, parameters };
  });
  return { id: randomUUID(), label, kind: 'scene', enabled: false, icon: 'lightbulb', steps, parameter: null, binding: null };
}

/** Author one combined state per known light. Saving has no device effects. */
export function authorLightingScene(plugin, model, lights, label) {
  if (!Array.isArray(lights) || !lights.length || lights.length > 20) throw new HttpError(400, 'Choose 1–20 lights for the scene.');
  const seen = new Set();
  const steps = lights.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !validId(value.id) || seen.has(value.id)) throw new HttpError(400, 'Choose each light once.');
    seen.add(value.id);
    const light = model.lights.find(light => light.id === value.id);
    if (!light || !['none','white','rgb'].includes(light.spectrum)) throw new HttpError(409, 'A selected light is no longer available. Reopen the editor.');
    const fields = ['id','on','brightness', ...(light.spectrum === 'white' ? ['temperature'] : light.spectrum === 'rgb' ? ['hue','saturation'] : [])];
    if (Object.keys(value).some(key => !fields.includes(key)) || typeof value.on !== 'boolean' || !percent(value.brightness)
      || light.spectrum === 'white' && !percent(value.temperature)
      || light.spectrum === 'rgb' && (!Number.isFinite(value.hue) || value.hue < 0 || value.hue > 360 || !percent(value.saturation))) throw new HttpError(400, 'Choose valid settings supported by each light.');
    return {id: randomUUID(), actionId: plugin.controls.lighting.actions.lightState, parameters: structuredClone(value)};
  });
  return {id: randomUUID(), label, kind:'scene', enabled:false, icon:'lightbulb', steps, parameter:null, binding:null};
}

/** Complex ordered scenes keep their original steps instead of being flattened. */
export function editableLightingScene(plugin, model, scene) {
  if (!scene.steps.length || scene.steps.some(step => step.actionId !== plugin.controls.lighting.actions.lightState)) return null;
  const values = scene.steps.map(step => structuredClone(step.parameters));
  try {authorLightingScene(plugin, model, values, scene.label);return values;} catch {return null;}
}
