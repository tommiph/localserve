/** Push reports run inside Localserve's supervised plugin process. Storage keeps
 * only current samples and bounded sequence/Event cursors, never a raw archive. */
import { validateSensorReport, sensorTypes, vectorSensorTypes, isDiscreteSensor } from '../../../server/sensor-protocol.mjs';
import {randomUUID} from 'node:crypto';
import {phoneEventKey,phoneEventId} from '../../../server/phone-events.mjs';

const knownTypes=new Set(sensorTypes.map(([type])=>type));
const sameSensor=(left,right)=>left?.type===right.type && left.name===right.name && left.reportingMode===right.reportingMode
  && left.selected===right.selected && left.status===right.status;
export function createSensorsAdapter({now=Date.now}={}) {
  let settings=null;
  const live=new Set();
  function valid(value) {
    return value && [250,500,1000,2000,5000,10000,30000,60000].includes(value['report-ms'])
      && Number.isInteger(value['event-seconds']) && value['event-seconds']>=1 && value['event-seconds']<=3600
      && Number.isInteger(value['events-per-report']) && value['events-per-report']>=1 && value['events-per-report']<=16
      && Number.isInteger(value['offline-seconds']) && value['offline-seconds']>=5 && value['offline-seconds']<=600
      && [1/12,1/6,0.25,0.5].includes(value['maintenance-minutes']) && Array.isArray(value.devices) && value.devices.length<=20;
  }
  function rows(device, at) {
    device['sensor-count']=device.catalog.length;
    // Use a stable physical sensor for each documented Android type. Choose
    // before checking samples: a missing primary must not silently switch to
    // another sensor with different calibration. Never mix axes or devices.
    device['reading-status']=device.online?'Receiving reports':'No recent reports · retained readings';
    for(const [type,prefix,axes] of [[1,'acceleration',true],[4,'rotation',true],[8,'proximity',false],[5,'ambient-light',false]]) {
      const sensor=device.catalog.filter(item=>item.type===type && item.selected && item.status==='Streaming').sort((a,b)=>a.id.localeCompare(b.id))[0];
      const sample=sensor && device.samples[sensor.id];
      const fields={ [prefix+'-name']:sensor?.name,[prefix+'-unit']:sample?sensor.unit:undefined };
      if(axes) ['x','y','z'].forEach((axis,index)=>{fields[prefix+'-'+axis]=sample?.values[index];});
      else fields[prefix]=sample?.values[0];
      for(const [key,value] of Object.entries(fields)) {
        if(value===undefined)delete device[key];else device[key]=value;
      }
    }
    for(let group=0;group<8;group++) device['rows-'+group]=Math.max(0,Math.min(8,device.catalog.length-group*8));
    for(let index=0;index<64;index++) {
      const sensor=device.catalog[index], sample=sensor && device.samples[sensor.id];
      const row={name:sensor?.name,type:sensor?.type,values:sample?.values.join(', '),unit:sensor?.unit,
        accuracy:sample?.accuracy,age:sample?sample.ageMs+Math.max(0,at-sample.receivedAt):undefined,
        status:sensor ? !device.online?'No recent reports':sensor.status :undefined};
      for(const [column,value] of Object.entries(row)) {
        const key='s'+index+'-'+column;
        if(value===undefined)delete device[key];else device[key]=value;
      }
    }
  }
  function payload(device, sensor, sample) {
    const values={'device-id':device.id,'device-name':device.name,'sensor-id':sensor.id,'sensor-name':sensor.name,
      'sensor-type':sensor.type,unit:sensor.unit,accuracy:sample.accuracy,'timestamp-ns':sample.timestampNanos,
      'sent-at':sample.sentAt,'received-at':sample.receivedAt,'value-count':sample.values.length,
      'sample-age-ms':sample.ageMs,'string-type':sensor.stringType};
    sample.values.forEach((value,index)=>{values['value-'+index]=value;});
    if(vectorSensorTypes.has(sensor.type)) ['x','y','z'].forEach((key,index)=>{if(sample.values[index]!==undefined)values[key]=sample.values[index];});
    return values;
  }
  return {
    validateConfiguration:valid,
    async start(value) { if(!valid(value))throw new Error('Invalid Sensors configuration.');settings=structuredClone(value);live.clear(); },
    async stop() { settings=null;live.clear(); },
    async ingest(input, receivedAt, context) {
      context.signal.throwIfAborted();
      if(!settings)throw new Error('Sensors is not running.');
      const packet=validateSensorReport(input), configured=settings.devices.find(device=>device.id===packet.deviceId && device.enabled);
      if(!configured)throw new Error('This device is not enabled.');
      const state=await context.readState();state.devices ||= {};
      for(const id of Object.keys(state.devices)) if(!settings.devices.some(device=>device.id===id))delete state.devices[id];
      const old=state.devices[packet.deviceId];
      if(old?.sessionId===packet.sessionId && packet.sequence<=old.sequence || old?.retiredSessions?.includes(packet.sessionId)) return {accepted:false,reason:'duplicate-or-old-report'};
      const first=!live.has(packet.deviceId) || !old?.online || old.sessionId!==packet.sessionId;
      const resumed=live.has(packet.deviceId) && old?.online===false;
      const retired=old?.retiredSessions || [];
      if(old && old.sessionId!==packet.sessionId)retired.push(old.sessionId);
      const device={id:packet.deviceId,name:configured.name,'reported-name':packet.deviceName,online:true,
        'received-at':receivedAt,sessionId:packet.sessionId,sequence:packet.sequence,retiredSessions:retired.slice(-8),
        transitionId:resumed?randomUUID():old?.transitionId || '',
        catalog:packet.catalog,samples:{},events:first?{}:old.events || {},phoneClaims:first?{}:old.phoneClaims || {},cursor:first?0:old.cursor || 0};
      // Only samples from this still-selected catalogue survive. A changed
      // sensor definition/session baselines instead of reusing another sensor.
      for(const sensor of packet.catalog) {
        const previous=old?.catalog.find(item=>item.id===sensor.id);
        if(previous && !sameSensor(previous,sensor))delete device.events[sensor.id];
        if(!first && sensor.selected && sameSensor(previous,sensor) && old.samples[sensor.id]) device.samples[sensor.id]=old.samples[sensor.id];
      }
      for(const sample of packet.readings) {
        const previous=device.samples[sample.sensorId];
        if(previous && BigInt(sample.timestampNanos)<BigInt(previous.timestampNanos))continue;
        const same=previous && sample.timestampNanos===previous.timestampNanos;
        // Repeated on-change samples refresh their reported age, not their raw
        // value. This also lets a rate-limited still-current sample get a turn.
        device.samples[sample.sensorId]={...(same?previous:sample),ageMs:sample.ageMs,receivedAt,sentAt:packet.sentAt};
      }
      const events=[];
      // Phone callbacks are consumed once by the APK. Persist only their last
      // timestamps here, never notification text or an offline event backlog.
      for(const event of packet.phoneEvents || []) {
        const key=phoneEventKey(event),previous=device.phoneClaims[key];
        if(previous && BigInt(event.timestampNanos)<=BigInt(previous))continue;
        device.phoneClaims[key]=event.timestampNanos;
        if(!first)events.push({id:'phone-'+phoneEventId(event),payload:{'device-id':device.id,'device-name':device.name,
          'timestamp-ns':event.timestampNanos,...event.fields}});
      }
      // Legitimate sessions have <=34 immutable sources. Bound malformed native
      // clients too; these are claims only, never a private location history.
      while(Object.keys(device.phoneClaims).length>64)delete device.phoneClaims[Object.keys(device.phoneClaims)[0]];
      // Give discrete gestures the first bounded slots, retaining the rotating
      // order inside both groups. Continuous streams cannot crowd out a pickup.
      const rotated=packet.catalog.map((_,offset)=>packet.catalog[(device.cursor+offset)%packet.catalog.length]);
      const ordered=[...rotated.filter(isDiscreteSensor),...rotated.filter(sensor=>!isDiscreteSensor(sensor))];
      let sensorEvents=0;
      for(const sensor of ordered) {
        const sample=device.samples[sensor.id];let claim=device.events[sensor.id];
        if(!sample || sample.receivedAt!==receivedAt || sample.ageMs>settings['offline-seconds']*1000 || sensor.status!=='Streaming')continue;
        // A connected trigger sensor can have no sample until the first real
        // gesture. Accept that occurrence after an established metadata report,
        // but baseline cached/older samples and all restart/reconnect snapshots.
        const previous=old?.catalog.find(item=>item.id===sensor.id);
        const firstGesture=!first && isDiscreteSensor(sensor) && sameSensor(previous,sensor)
          && sample.ageMs<=Math.max(0,receivedAt-old['received-at']);
        if(!claim) {
          if(!firstGesture) {device.events[sensor.id]={at:receivedAt,timestamp:sample.timestampNanos};continue;}
          // Remember that this connected sensor has produced its first new
          // occurrence, even if this report's bounded slots are already full.
          // A null emitted timestamp keeps its latest sample eligible next time.
          claim={at:receivedAt-settings['event-seconds']*1000,timestamp:null};device.events[sensor.id]=claim;
        }
        // Timestamp claims commit before dispatch. Each distinct gesture may
        // match the same condition again; retained snapshots never repeat it.
        if(!first && sample.timestampNanos!==claim.timestamp && receivedAt-claim.at>=settings['event-seconds']*1000 && sensorEvents<settings['events-per-report']) {
          events.push({id:knownTypes.has(sensor.type)?'sensor-'+sensor.type:'other-reading',payload:payload(device,sensor,sample)});
          sensorEvents++;
          device.events[sensor.id]={at:receivedAt,timestamp:sample.timestampNanos};
        }
      }
      device.cursor=packet.catalog.length?(device.cursor+settings['events-per-report'])%packet.catalog.length:0;
      if(first) for(const [id,sample] of Object.entries(device.samples))device.events[id]={at:receivedAt,timestamp:sample.timestampNanos};
      rows(device,receivedAt);
      if(Buffer.byteLength(JSON.stringify(device),'utf8')>45000)throw new Error('Device snapshot exceeds 45000 bytes; select fewer sensors.');
      state.devices[device.id]=device;
      context.signal.throwIfAborted();await context.saveState(state);live.add(device.id);
      if(resumed)await context.emit('device-online',{'device-id':device.id,'device-name':device.name,'received-at':receivedAt,'transition-id':device.transitionId});
      for(const event of events) {context.signal.throwIfAborted();await context.emit(event.id,event.payload);}
      return {accepted:true,sensors:packet.catalog.length,events:events.length};
    },
    async execute(actionId,parameters,context) {
      if(actionId!=='refresh' || !settings)throw new Error('Unknown Sensors action.');
      const state=await context.readState();state.devices ||= {};
      const events=[];const at=now();
      for(const [id,device] of Object.entries(state.devices)) {
        const configured=settings.devices.find(item=>item.id===id);
        if(!configured) {delete state.devices[id];continue;}
        device.name=configured.name;
        const offline=!live.has(id) || at-device['received-at']>settings['offline-seconds']*1000;
        if(device.online && offline && live.has(id) && configured.enabled) {
          device.transitionId=randomUUID();
          events.push({'device-id':id,'device-name':device.name,'received-at':device['received-at'],'transition-id':device.transitionId});
        }
        if(offline)device.online=false;
        rows(device,at);
      }
      context.signal.throwIfAborted();await context.saveState(state);
      for(const payload of events)await context.emit('device-offline',payload);
      return {completed:true};
    }
  };
}
export default createSensorsAdapter();
