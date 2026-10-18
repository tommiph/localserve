/** Read-only phone screen: declared Card fields and fixed native phone contracts.
 * Never return private state, notification text, settings or action tokens. */
import {HttpError} from './storage.mjs';
import {instanceBinding} from './plugin-instances.mjs';

/** Latest accepted callbacks only, bounded to configured devices. This object
 * belongs to one running receiver, is never serialized and is empty on restart. */
export class PhoneDisplayCache {
  constructor(){this.devices=new Map();}
  context(record){return {runtime:record.runtime,revision:record.config.snapshot().revision};}
  capture(packet,receivedAt,record,previous) {
    const config=record.config.snapshot();
    for(const id of this.devices.keys())if(!config.settings.devices.some(d=>d.id===id&&d.enabled))this.devices.delete(id);
    const identity=this.context(record),old=this.devices.get(packet.deviceId);
    const same=old&&old.runtime===identity.runtime&&old.revision===identity.revision&&old.session===packet.sessionId
      &&receivedAt-old.at<=config.settings['offline-seconds']*1000;
    const entry=same?old:{...identity,session:packet.sessionId,events:{}};
    for(const event of packet.phoneEvents||[]) {
      const claim=event.kind==='geofence'?'geofence:'+event.fields['region-id']:event.kind==='activity'?'activity:'+event.fields.activity:event.kind;
      if(previous?.sessionId===packet.sessionId&&previous.phoneClaims?.[claim]
        &&BigInt(event.timestampNanos)<=BigInt(previous.phoneClaims[claim]))continue;
      const fields=structuredClone(event.fields);
      // Notification content is neither retained nor exposed by this display.
      if(event.kind==='notification'){delete fields.title;delete fields.text;}
      entry.events[event.kind]={fields,receivedAt};
    }
    entry.at=receivedAt;this.devices.set(packet.deviceId,entry);
  }
  snapshot(id,record) {
    const config=record?.config.snapshot(),entry=this.devices.get(id);
    if(!entry)return {};
    if(!config?.enabled||entry.runtime!==record.runtime||entry.revision!==config.revision
      ||!config.settings.devices.some(d=>d.id===id&&d.enabled)){this.devices.delete(id);return {};}
    return structuredClone(entry.events);
  }
}

export function phoneDisplay(registry, configuration, deviceId = null, cache = null) {
  const plugin=registry.services().find(service=>service.id==='sensors');
  const devices=plugin?.enabled ? (plugin.config?.settings.devices || []).filter(device=>device.enabled) : [];
  if(deviceId && !devices.some(device=>device.id===deviceId))throw new HttpError(404,'Phone unavailable.');
  const device=devices.find(device=>device.id===deviceId)||devices[0];
  const values={};
  if(device)for(const field of plugin.cardFields) {
    // Declared state/table Card fields only. Events and private cursors cannot
    // become display fields if the plugin gains more capabilities later.
    if(!['state','rows'].includes(field.source.kind))continue;
    const datum=plugin.cardData.values[instanceBinding(plugin,device,field)];
    if(datum)values[field.id]=structuredClone(datum);
  }
  const config=configuration.snapshot();
  return {device:device?{id:device.id,name:device.name}:null,devices:devices.map(({id,name})=>({id,name})),values,
    phone:device&&cache?cache.snapshot(device.id,registry.records.get('sensors')):{},
    status:plugin?.cardData.status||'Unavailable',options:{timeFormat:config.timeFormat,
      timeZone:new Intl.DateTimeFormat().resolvedOptions().timeZone,now:Date.now()}};
}
