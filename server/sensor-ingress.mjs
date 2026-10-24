/** The one credential-free native LAN report boundary. Exact Host/private peer
 * checks run in server.mjs first. Browsers cannot turn this into a public RPC. */
import { HttpError } from './storage.mjs';
import { validateSensorReport } from './sensor-protocol.mjs';
import {PhoneDisplayCache} from './phone-display.mjs';

export class SensorIngress {
  constructor(registry) { this.registry=registry; this.display=new PhoneDisplayCache();this.queue=Promise.resolve(); this.pending=0; this.windows=new Map(); this.globalWindow={at:0,count:0}; }
  async receive(request) {
    if (request.method !== 'POST') throw new HttpError(405,'Use POST for sensor reports.');
    if (request.headers.origin || request.headers['sec-fetch-site'] || request.headers['x-localserve-sensors'] !== '1') throw new HttpError(403,'Use the native Sensors sender.');
    if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers['content-type'] || '')) throw new HttpError(415,'JSON is required.');
    const record=this.registry.get('sensors');
    this.registry.assertReady(record);
    if (record.plugin.runtime.ingest !== 'sensors-v1') throw new HttpError(404,'Sensors receiver unavailable.');
    if (this.registry.engine.gate.paused) throw new HttpError(409,'Server is paused.');
    if (this.pending>=4) throw new HttpError(429,'Sensor receiver is busy; send the next fresh report later.');
    this.pending++;
    const controller=new AbortController();
    const abort=()=>controller.abort(new Error('Sensor sender disconnected.'));
    request.once('aborted',abort);
    const timeout=setTimeout(()=>{controller.abort(new Error('Sensor report timed out.'));request.destroy();},5000);
    try {
      let size=0;const chunks=[];
      for await (const chunk of request) { size+=chunk.length;if(size>65536)throw new HttpError(413,'Sensor report exceeds 64 KiB.');chunks.push(chunk); }
      let packet;try {packet=JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw new HttpError(400,'Invalid sensor JSON.');}
      packet=validateSensorReport(packet);
      return await this.process(packet,controller.signal,{});
    } finally {clearTimeout(timeout);request.off('aborted',abort);this.pending--;}
  }
  async relay(input,signal,{timeoutMs}={}) {
    if(this.pending>=4)throw new HttpError(429,'Sensor receiver is busy.');
    const packet=validateSensorReport(input),age=Date.now()-packet.sentAt;
    if(age < -30000 || age>90000)throw new HttpError(409,'Relay sensor report expired or phone clock is incorrect.');
    if(!Number.isFinite(timeoutMs)||timeoutMs<60000||timeoutMs>1215000)throw new HttpError(400,'Invalid relay reception interval.');
    packet.readings=packet.readings.filter(sample=>sample.ageMs+Math.max(0,age)<=120000);
    for(const sample of packet.readings)sample.ageMs+=Math.max(0,age);
    packet.phoneEvents=(packet.phoneEvents||[]).filter(event=>event.kind!=='location'||event.fields['age-ms']+Math.max(0,age)<=120000);
    for(const event of packet.phoneEvents)if(event.kind==='location')event.fields['age-ms']+=Math.max(0,age);
    this.pending++;
    try{return await this.process(packet,signal,{transport:'relay',relayTimeoutMs:timeoutMs});}
    finally{this.pending--;}
  }
  async process(packet,signal,transport){
      const record=this.registry.get('sensors');this.registry.assertReady(record);
      const receivedAt=Date.now();
      const settings=record.config.snapshot().settings;
      const known=settings.devices.some(device=>device.id===packet.deviceId);
      if (!known && settings.devices.length>=20) throw new HttpError(429,'The Sensors device limit is 20.');
      if (receivedAt-this.globalWindow.at>=1000) this.globalWindow={at:receivedAt,count:0};
      if (++this.globalWindow.count>80) throw new HttpError(429,'Sensor report rate exceeded.');
      const previous=this.windows.get(packet.deviceId)||0;
      if (receivedAt-previous<settings['report-ms']) throw new HttpError(429,'Send fresh reports at the configured interval.');
      if (this.windows.size>=20 && !this.windows.has(packet.deviceId)) this.windows.delete(this.windows.keys().next().value);
      this.windows.set(packet.deviceId,receivedAt);
      const operation=this.queue.then(async()=>{
        signal.throwIfAborted();this.registry.assertReady(record);
        if (this.registry.engine.gate.paused) throw new HttpError(409,'Server is paused.');
        let config=record.config.snapshot();
        if (!config.settings.devices.some(device=>device.id===packet.deviceId)) {
          if (config.settings.devices.length>=20) throw new HttpError(429,'The Sensors device limit is 20.');
          // First reports create ordinary editable device entries. All other
          // settings survive; a conflicting administrator save is not retried.
          const next=structuredClone(config.settings);
          let name=packet.deviceName, suffix=2;
          while(next.devices.some(device=>device.name.toLowerCase()===name.toLowerCase())) {
            const ending=' '+suffix++;name=packet.deviceName.slice(0,32-ending.length)+ending;
          }
          next.devices.push({id:packet.deviceId,name,enabled:true});
          await this.registry.saveConfiguration('sensors',{revision:config.revision,settings:next});
          config=record.config.snapshot();
        }
        if (!config.settings.devices.find(device=>device.id===packet.deviceId)?.enabled) throw new HttpError(403,'This device is disabled.');
        if (Date.now()-receivedAt>4000) throw new HttpError(429,'Report expired in the queue; send a fresh report.');
        const previous=record.state.snapshot().devices?.[packet.deviceId];
        const runtime=record.runtime;
        const result=await this.registry.ingestSensors(packet,receivedAt,signal,config.revision,transport);
        // Observe only a committed, accepted report from the same generation.
        // Never cache duplicate packets or publish ahead of the worker's claims.
        if(result.accepted&&runtime===record.runtime&&record.config.snapshot().revision===config.revision)
          this.display.capture(packet,receivedAt,record,previous,transport);
        return {...result,reportIntervalMs:config.settings['report-ms']};
      });
      this.queue=operation.catch(()=>{});
      return await operation;
  }

}
