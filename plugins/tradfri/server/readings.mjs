import {lightingEditToken} from '../../../server/lighting-edit-contract.mjs';

const text = (value, max = 100) => typeof value === 'string' && value.trim()
  ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, max) : null;
const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value * 10) / 10 : null;
const bool = value => typeof value === 'boolean' ? value : null;
export function lightColor(light) {
  if (light?.spectrum === 'white') {
    if (!Number.isFinite(light.temperature) || light.temperature < 0 || light.temperature > 100) return null;
    // The bundled gateway library maps 0–100% to 250–454 mireds. Convert
    // that reported setting to approximate kelvin, rounded to 10 K.
    const mireds = 250 + light.temperature / 100 * 204;
    return `${Math.round(1_000_000 / mireds / 10) * 10} K`;
  }
  const hue = light?.hue, saturation = light?.saturation;
  if (light?.spectrum !== 'rgb' || !Number.isFinite(hue) || hue < 0 || hue > 360
    || !Number.isFinite(saturation) || saturation < 0 || saturation > 100) return null;
  // Hue/saturation are reported by the gateway. Full-value RGB makes the
  // selected chromaticity readable independently from the brightness dial.
  const chroma = saturation / 100, section = (hue % 360) / 60;
  const secondary = chroma * (1 - Math.abs(section % 2 - 1));
  const channels = section < 1 ? [chroma, secondary, 0] : section < 2 ? [secondary, chroma, 0]
    : section < 3 ? [0, chroma, secondary] : section < 4 ? [0, secondary, chroma]
      : section < 5 ? [secondary, 0, chroma] : [chroma, 0, secondary];
  return '#' + channels.map(channel => Math.round((channel + 1 - chroma) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}
export function lightRows(devices, groups) {
  return devices.filter(device => device.type === 2 && device.lightList?.length).map(device => {
    const light = device.lightList[0], group = groups.find(group => group.deviceIDs?.includes(device.instanceId));
    return { id: String(device.instanceId), name: text(device.name), room: text(group?.name), on: bool(light.onOff),
      brightness: percent(light.dimmer), reachable: bool(device.alive), spectrum: text(light.spectrum, 20),
      temperature: light.spectrum === 'white' ? percent(light.colorTemperature) : null,
      hue: light.spectrum === 'rgb' && Number.isFinite(light.hue) ? light.hue : null,
      saturation: light.spectrum === 'rgb' ? percent(light.saturation) : null,
      battery: percent(device.deviceInfo?.battery), firmware: text(device.deviceInfo?.firmwareVersion) };
  }).sort((a, b) => Number(a.id) - Number(b.id));
}
/** Administrator inventory is separate from bounded public Card tables. Only
 * named telemetry is retained; credentials and raw gateway resources stay out. */
export function administrationInventory(devices, groups) {
  return {
    schemaVersion: 1,
    lights: lightRows(devices, groups).slice(0, 100),
    groups: groups.slice(0, 100).map(group => ({id: String(group.instanceId), name: text(group.name),
      on: bool(group.onOff), brightness: percent(group.dimmer),
      editToken: lightingEditToken('group',group.instanceId,group.name,(group.deviceIDs||[]).map(String)),
      deviceIds: Array.isArray(group.deviceIDs) ? group.deviceIDs.slice(0, 100).map(String) : []})),
    devices: devices.slice(0, 100).map(device => ({id: String(device.instanceId), name: text(device.name),
      editToken: lightingEditToken('device',device.instanceId,device.name),
      type: Number.isInteger(device.type) ? device.type : null, reachable: bool(device.alive),
      battery: percent(device.deviceInfo?.battery), model: text(device.deviceInfo?.modelNumber),
      firmware: text(device.deviceInfo?.firmwareVersion)})),
  };
}
export function publicReading(lights, groups, receivedAt) {
  const reading = { 'connection-status': 'Connected', 'light-count': lights.length,
    'lights-on': lights.every(light => light.on !== null) ? lights.filter(light => light.on).length : null,
    'group-count': groups.length, 'light-row-count': Math.min(10, lights.length),
    'light-bank-2-count': Math.max(0, Math.min(10, lights.length - 10)), 'lights-truncated': lights.length > 20,
    'group-row-count': Math.min(10, groups.length), 'groups-truncated': groups.length > 10, 'received-at': receivedAt,
    'lights-summary': lights.slice(0, 100).map(light => `${light.id} · ${light.name || 'Unnamed'} · ${light.room || 'Ungrouped'} · ${light.on === null ? 'Unknown' : light.on ? 'On' : 'Off'} · ${light.brightness === null ? 'No brightness data' : light.brightness + '%'} · ${light.reachable === null ? 'Reachability unknown' : light.reachable ? 'Reachable' : 'Unreachable'}`).join('\n').slice(0, 16000) || null };
  for (let i = 0; i < 20; i++) for (const column of ['id', 'name', 'room', 'on', 'brightness', 'reachable', 'spectrum', 'temperature', 'hue', 'saturation', 'firmware']) reading[`light-${i + 1}-${column}`] = lights[i]?.[column] ?? null;
  for (let i = 0; i < 4; i++) {
    // A bulb can retain its dimmer setting while switched off. Only the Nordic
    // gauge represents effective brightness; Lists retain the reported value.
    reading[`light-${i + 1}-display-brightness`] = lights[i]?.on === false ? 0 : lights[i]?.brightness ?? null;
    reading[`light-${i + 1}-color`] = lightColor(lights[i]);
  }
  for (let i = 0; i < 10; i++) {
    const group = groups[i];
    for (const [column, value] of Object.entries({ id: group ? String(group.instanceId) : null, name: text(group?.name),
      on: bool(group?.onOff), brightness: percent(group?.dimmer), count: Array.isArray(group?.deviceIDs) ? group.deviceIDs.length : null })) reading[`group-${i + 1}-${column}`] = value;
  }
  return reading;
}
export function hexToHsv(hex) {
  const [r, g, b] = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = 0;
  if (delta) hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { hue: (hue * 60 + 360) % 360, saturation: max ? delta / max * 100 : 0 };
}
