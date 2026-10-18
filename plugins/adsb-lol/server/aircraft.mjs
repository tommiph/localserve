/** Bounded public aircraft projection. Distances are calculated great-circle
 * nautical miles from reported positions, never inferred routes or destinations. */
export function coordinates(value) {
  if (typeof value !== 'string' || value.length > 64 || !/^[+-]?\d+(?:\.\d+)?\s*,\s*[+-]?\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const [latitude, longitude] = value.split(',').map(Number);
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}
export function configuration(settings) {
  if (!Array.isArray(settings?.areas) || settings.areas.length > 20 || ![1,2,5,10,15].includes(settings['poll-minutes'] ?? 2)) return null;
  const areas = settings.areas.filter(area => area.enabled).map(area => ({ ...area, point: coordinates(area.coordinates) }));
  if (!areas.length || areas.some(area => !area.point || !Number.isFinite(area.radius) || area.radius < 1 || area.radius > 250
    || ![30,60,120,300].includes(area['position-age']))) return null;
  return { areas, ids: new Set(settings.areas.map(area => area.id)), minutes: settings['poll-minutes'] ?? 2 };
}
export function areaIdentity(area) {
  return `${area.point.latitude},${area.point.longitude}/${area.radius}/${area['position-age']}`;
}
export function areaUrl(area) {
  return `https://api.adsb.lol/v2/point/${area.point.latitude}/${area.point.longitude}/${area.radius}`;
}
const numeric = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
const text = (value, max) => typeof value === 'string' && value.trim() && !/[\u0000-\u001f\u007f]/u.test(value) ? value.trim().slice(0,max) : null;
export function distanceNm(from, to) {
  const radians = value => value * Math.PI / 180;
  const lat = radians(to.latitude - from.latitude), lon = radians(to.longitude - from.longitude);
  const a = Math.sin(lat / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(lon / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(Math.min(1,a)), Math.sqrt(Math.max(0,1-a)));
}
export function parseAircraft(payload, area, receivedAt) {
  if (!payload || !Array.isArray(payload.ac) || payload.ac.length > 2000 || payload.msg !== 'No error') throw new Error('adsb.lol returned an invalid aircraft response.');
  const seen = new Set(), aircraft = [];
  for (const raw of payload.ac) {
    // A malformed identity cannot masquerade as a successful empty query and
    // rearm detection claims. Missing optional telemetry remains explicitly null.
    if (!raw || typeof raw.hex !== 'string' || !/^~?[a-f\d]{6}$/i.test(raw.hex)) throw new Error('adsb.lol returned an invalid aircraft identity.');
    const hex = raw.hex.toLowerCase();
    if (seen.has(hex)) throw new Error('adsb.lol returned duplicate aircraft identities.');
    seen.add(hex);
    const latitude = numeric(raw.lat,-90,90), longitude = numeric(raw.lon,-180,180), age = numeric(raw.seen_pos,0,86400);
    // lastPosition and approximate receiver positions are deliberately ignored.
    // Only explicitly aged primary position reports qualify for this nearby list.
    if (latitude === null || longitude === null || age === null || age > area['position-age']) continue;
    const distance = distanceNm(area.point,{ latitude, longitude });
    if (distance > area.radius) continue;
    const altitude = numeric(raw.alt_baro,-2000,100000), ground = raw.alt_baro === 'ground';
    aircraft.push({ hex, callsign: text(raw.flight,16), registration: text(raw.r,24), type: text(raw.t,12),
      altitude, ground: ground ? true : altitude === null ? null : false,
      'altitude-label': ground ? 'Ground' : altitude === null ? null : String(altitude),
      speed: numeric(raw.gs,0,3000), track: numeric(raw.track,0,360),
      distance: Math.round(distance * 10) / 10, latitude, longitude, 'position-age': age,
      squawk: typeof raw.squawk === 'string' && /^[0-7]{4}$/.test(raw.squawk) ? raw.squawk : null,
      emergency: text(raw.emergency,32), sortDistance: distance });
  }
  aircraft.sort((a,b) => a.sortDistance - b.sortDistance || a.hex.localeCompare(b.hex));
  const reading = { 'aircraft-count': aircraft.length, 'row-count': Math.min(10,aircraft.length),
    'list-limited': aircraft.length > 10, 'received-at': receivedAt,
    'reported-area': `${area.point.latitude},${area.point.longitude}`, 'radius-nm': area.radius,
    'excluded-count': payload.ac.length - aircraft.length,
    'nearest-callsign': aircraft[0]?.callsign ?? aircraft[0]?.hex ?? null,
    'nearest-distance': aircraft[0]?.distance ?? null, 'poll-status': 'Updated' };
  const columns = ['hex','callsign','registration','type','altitude-label','speed','distance'];
  for (let row = 0; row < 10; row++) for (const column of columns) {
    reading[`aircraft-${row + 1}-${column}`] = column === 'callsign'
      ? aircraft[row]?.callsign ?? aircraft[row]?.hex ?? null : aircraft[row]?.[column] ?? null;
  }
  return { reading, aircraft, seen: [...seen] };
}
