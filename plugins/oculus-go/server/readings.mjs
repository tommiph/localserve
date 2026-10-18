/** Oculus Go diagnostic parsing with explicit missing values and bounded
 * public fields. No arbitrary Android properties or raw dumps are published.
 */
const finite = value => typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim()) && Number.isFinite(Number(value)) ? Number(value) : null;
const round = value => Math.round(value * 10) / 10;
export function batteryReading(raw) {
  const get = key => raw.match(new RegExp(`^\\s*${key}:\\s*(\\S+)`, 'm'))?.[1];
  const level = finite(get('level')), scale = finite(get('scale')), temperature = finite(get('temperature'));
  const powered = ['AC powered', 'USB powered', 'Wireless powered'].map(get);
  const charging = powered.includes('true') ? true : powered.every(value => value === 'false') ? false : null;
  return {
    'battery-percent': level !== null && scale > 0 && level >= 0 && level <= scale ? round(level / scale * 100) : null,
    charging, 'battery-temperature': temperature !== null && temperature >= -500 && temperature <= 1500 ? temperature / 10 : null,
    'battery-status': { 1: 'Unknown', 2: 'Charging', 3: 'Discharging', 4: 'Not charging', 5: 'Full' }[get('status')] || null,
  };
}
export function powerReading(raw) {
  // Only the named vendor state counts. A dump can contain historic or other
  // sleep-related words, so absence of STANDBY never implies Awake.
  const value = raw.match(/(?:mState|mPowerState|mCurrentState|currentState|state)\s*[:=]\s*(AWAKE|STANDBY|SLEEP|ASLEEP|ACTIVE|ON)\b/i)?.[1]?.toUpperCase();
  return { 'headset-state': ['AWAKE', 'ACTIVE', 'ON'].includes(value) ? 'Awake'
    : ['STANDBY', 'SLEEP', 'ASLEEP'].includes(value) ? 'Standby' : 'Unknown' };
}
export function activityReading(raw) {
  const pkg = raw.match(/mResumedActivity[^\n]*? ([a-zA-Z0-9_.]+)\//)?.[1]
    || raw.match(/mFocusedActivity[^\n]*? ([a-zA-Z0-9_.]+)\//)?.[1] || null;
  return { 'active-package': pkg, 'active-app': pkg?.startsWith('com.oculus.') ? 'Oculus system' : pkg };
}
export function storageReading(raw) {
  const rows = raw.trim().split(/\r?\n/), header = rows.find(line => /Filesystem/i.test(line)) || '';
  const blocks = /(?:1K|1024|kbytes)/i.test(header);
  const line = rows.findLast(row => /\s\/data\s*$/.test(row));
  const parts = line?.trim().split(/\s+/), total = finite(parts?.[1]), used = finite(parts?.[2]), free = finite(parts?.[3]);
  const valid = blocks && total > 0 && used !== null && used >= 0 && free !== null && free >= 0 && free <= total && used <= total;
  return { 'storage-total-gib': valid ? round(total / 1024 ** 2) : null,
    'storage-free-gib': valid ? round(free / 1024 ** 2) : null,
    'storage-free-percent': valid ? round(free / total * 100) : null,
    'storage-used-percent': valid ? round(used / total * 100) : null };
}
export function parseThermals(raw) {
  return raw.split(/ZONE:/).slice(1, 65).map(block => {
    const [zone, type, value] = block.trim().split(/\r?\n/).map(line => line.trim());
    const number = finite(value), id = zone.match(/thermal_zone\d+$/)?.[0];
    let divisor = null, label = type;
    // Go's kernel reports different units by sensor type. Only mapped types
    // receive a Celsius conversion; unknown types retain their raw values.
    if (/^tsens_tz_sensor\d+$/.test(type)) { divisor = 10; label = 'Chip sensor ' + type.replace('tsens_tz_sensor', ''); }
    else if (['battery', 'bms', 'pm8994_tz'].includes(type)) {
      divisor = 1000; label = { battery: 'Battery sensor', bms: 'Battery management', pm8994_tz: 'Power management' }[type];
    } else if (['msm_therm', 'emmc_therm', 'pa_therm0', 'pa_therm1', 'quiet_therm', 'xo_therm_buf'].includes(type)) divisor = 1;
    const celsius = number !== null && divisor !== null ? round(number / divisor) : null;
    return { zone: id, type: type?.slice(0, 100) || null, label: label?.slice(0, 100) || null,
      raw: number, celsius: celsius !== null && celsius >= -50 && celsius <= 150 ? celsius : null };
  }).filter(row => row.zone).sort((a, b) => Number(a.zone.replace('thermal_zone', '')) - Number(b.zone.replace('thermal_zone', '')));
}
export function thermalReading(raw) {
  const rows = parseThermals(raw), result = { 'sensor-count': rows.length, 'sensor-row-count': Math.min(10, rows.length), 'sensors-truncated': rows.length > 40 };
  const chips = rows.filter(row => /^tsens_tz_sensor\d+$/.test(row.type) && row.celsius !== null);
  result['chip-temperature-max'] = chips.length ? Math.max(...chips.map(row => row.celsius)) : null;
  result['chip-temperature-min'] = chips.length ? Math.min(...chips.map(row => row.celsius)) : null;
  result['thermal-summary'] = rows.slice(0, 40).map(row => `${row.zone} · ${row.label}: ${row.celsius !== null ? row.celsius + ' °C' : row.raw !== null ? row.raw + ' (raw; units unknown)' : 'No data'}`).join('\n') || null;
  for (let bank = 2; bank <= 4; bank++) result[`sensor-bank-${bank}-count`] = Math.max(0, Math.min(10, rows.length - (bank - 1) * 10));
  for (let i = 0; i < 40; i++) for (const key of ['zone', 'type', 'label', 'raw', 'celsius']) result[`sensor-${i + 1}-${key}`] = rows[i]?.[key] ?? null;
  return result;
}
