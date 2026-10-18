/** Bounded LAN sensor protocol shared by the ingress and trusted adapter.
 * Values are raw finite samples, not expressions, commands or inferred state. */
import { HttpError } from './storage.mjs';
import {validatePhoneEvents} from './phone-events.mjs';

export const sensorTypes = [
  [1,'Accelerometer','m/s²'],[2,'Magnetic field','µT'],[3,'Orientation (legacy)','°'],
  [4,'Gyroscope','rad/s'],[5,'Light','lux'],[6,'Pressure','hPa'],[7,'Temperature (legacy)','°C'],
  [8,'Proximity','cm'],[9,'Gravity','m/s²'],[10,'Linear acceleration','m/s²'],
  [11,'Rotation vector','quaternion'],[12,'Relative humidity','%'],[13,'Ambient temperature','°C'],
  [14,'Uncalibrated magnetic field','µT'],[15,'Game rotation vector','quaternion'],
  [16,'Uncalibrated gyroscope','rad/s'],[17,'Significant motion',''],[18,'Step detector',''],
  [19,'Step counter','steps'],[20,'Geomagnetic rotation vector','quaternion'],[21,'Heart rate','bpm'],
  [22,'Tilt detector',''],[23,'Wake gesture',''],[24,'Glance gesture',''],[25,'Pick-up gesture',''],
  [26,'Wrist tilt gesture',''],[27,'Device orientation',''],[28,'Pose 6DOF',''],
  [29,'Stationary detection',''],[30,'Motion detection',''],[31,'Heart beat',''],
  [32,'Dynamic sensor metadata',''],
  [34,'Low latency off-body detection',''],[35,'Uncalibrated accelerometer','m/s²'],
  [36,'Hinge angle','°'],[37,'Head tracker',''],[38,'Limited-axis accelerometer','m/s²'],
  [39,'Limited-axis gyroscope','rad/s'],[40,'Limited-axis uncalibrated accelerometer','m/s²'],
  [41,'Limited-axis uncalibrated gyroscope','rad/s'],[42,'Heading','°']
];
export const vectorSensorTypes=new Set([1,2,4,9,10,11,14,15,16,20,35,38,39,40,41]);

/** Android one-shot (2) and special-trigger (3) reports are occurrences,
 * even when successive gestures all carry the same raw value, usually 1. */
export function isDiscreteSensor(sensor) {
  return sensor.reportingMode===2 || sensor.reportingMode===3;
}

function fail(message) { throw new HttpError(400, message); }
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key))) fail('Invalid sensor report fields.');
}
function text(value, max, empty = false) {
  return typeof value === 'string' && (empty || value.trim().length > 0) && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
}
export function validateSensorReport(value) {
  keys(value,['version','deviceId','deviceName','sessionId','sequence','sentAt','catalog','readings','phoneEvents']);
  try {validatePhoneEvents(value.phoneEvents);} catch(error){fail(error.message);}
  if (value.version !== 1 || !/^android-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.deviceId)
    || !text(value.deviceName,32) || !/^[a-f0-9-]{36}$/.test(value.sessionId)
    || !Number.isSafeInteger(value.sequence) || value.sequence < 1
    || !Number.isSafeInteger(value.sentAt) || value.sentAt < 0
    || !Array.isArray(value.catalog) || value.catalog.length > 64
    || !Array.isArray(value.readings) || value.readings.length > 64) fail('Invalid sensor device, sequence or sensor count.');
  const ids = new Set();
  for (const sensor of value.catalog) {
    keys(sensor,['id','type','stringType','name','vendor','unit','selected','status','reportingMode','resolution','maximumRange','powerMa','minDelayUs']);
    if (!/^s-[a-f0-9]{16}$/.test(sensor.id) || ids.has(sensor.id)
      || !Number.isInteger(sensor.type) || sensor.type < 1 || sensor.type > 2147483647
      || !text(sensor.stringType,100,true) || !text(sensor.name,80) || !text(sensor.vendor,64,true)
      || !text(sensor.unit,24,true) || typeof sensor.selected !== 'boolean'
      || !['Streaming','Not selected','Permission required','Unavailable'].includes(sensor.status)
      || !Number.isInteger(sensor.reportingMode) || sensor.reportingMode < 0 || sensor.reportingMode > 3
      || ['resolution','maximumRange','powerMa','minDelayUs'].some(key => !Number.isFinite(sensor[key]) || sensor[key] < 0 || sensor[key] > 1e20)) fail('Invalid sensor metadata.');
    ids.add(sensor.id);
  }
  const readings = new Set();
  for (const sample of value.readings) {
    keys(sample,['sensorId','values','accuracy','timestampNanos','ageMs']);
    if (!ids.has(sample.sensorId) || readings.has(sample.sensorId)
      || !Array.isArray(sample.values) || !sample.values.length || sample.values.length > 16
      || sample.values.some(item => !Number.isFinite(item) || Math.abs(item) > 1e20)
      || !Number.isInteger(sample.accuracy) || sample.accuracy < -1 || sample.accuracy > 3
      || !/^[0-9]{1,20}$/.test(sample.timestampNanos)
      || !Number.isInteger(sample.ageMs) || sample.ageMs < 0 || sample.ageMs > 120000) fail('Invalid raw sensor sample.');
    if (!value.catalog.find(sensor=>sensor.id===sample.sensorId).selected) fail('An unselected sensor cannot send samples.');
    readings.add(sample.sensorId);
  }
  return structuredClone(value);
}

/** Cache only identity/type/component metadata for Event catalogues, not values. */
export function reportedSensors(state) {
  return new Map(Object.entries(state.devices || {}).map(([id,device])=>[id,
    (device.catalog || []).filter(sensor=>sensor.selected && sensor.status==='Streaming')
      .map(sensor=>({id:sensor.id,type:sensor.type,name:sensor.name,reportingMode:sensor.reportingMode,
        components:device.samples?.[sensor.id]?.values?.length || 0}))]));
}
