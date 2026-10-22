import {CameraCapture,listCameras} from './capture.mjs';
let settings, capture, generation=0, retryAt=0;
// Suspension clears the RAM frame before awaiting the owned helper's exit.
async function suspend() { generation++; const previous=capture;capture=null; if(previous)await previous.close(); }
export default {
  validateConfiguration(value) { return process.platform==='win32'
    && ['device-index','width','height','fps','quality','motion-confirm-frames','light-confirm-frames'].every(key=>Number.isInteger(value[key]))
    && value['device-index']>=0 && value['device-index']<=31 && value['dark-threshold']<value['bright-threshold']; },
  async start(value) { settings=value;retryAt=0; },
  stop:suspend, suspend,
  preview() { return capture?.preview() || null; },
  async execute(id, parameters, context) {
    context.signal.throwIfAborted();
    if(id==='list-cameras') {
      const devices=await listCameras(context.signal);context.signal.throwIfAborted();
      const state=await context.readState();state.devices=devices;state['device-list']=devices.map(row=>`${row.index}: ${row.name}`).join('; ') || 'No cameras found';await context.saveState(state);return {devices};
    }
    if(id!=='refresh')throw Error('Unknown webcam action.');
    if(Date.now()<retryAt)return {status:'Waiting for webcam retry'};
    const serial=generation;
    try {
      if(!capture || capture.closed) {
        capture=new CameraCapture(settings);
      }
      const source=capture;
      const abort=()=>{void suspend();};context.signal.addEventListener('abort',abort,{once:true});
      let reading;
      try {reading=await source.frame(context.signal);}
      finally {context.signal.removeEventListener('abort',abort);}
      const check=()=>{context.signal.throwIfAborted();if(serial!==generation||capture!==source)throw Error('Camera session changed.');};
      check();const old=await context.readState();check();
      await context.saveState({...reading, status:'Live', devices:old.devices || [], 'device-list':old['device-list'] || ''});check();
      // Save numeric readings before dispatch; image bytes never enter host storage.
      const events=source.analyzer.takeEvents();
      for(const [event,payload]of events){check();await context.emit(event,payload);}
      check();await context.emit('readings',{'motion':reading.motion,'motion-percent':reading['motion-percent'],brightness:reading.brightness,condition:reading.condition,'captured-at':reading['captured-at']});
      return {status:'Live'};
    } catch(error) {
      if(serial!==generation||context.signal.aborted)throw error;
      retryAt=Date.now()+15000;await suspend();
      const old=await context.readState();
      await context.saveState({status:'Unavailable',motion:null,brightness:null,condition:null,'motion-percent':null,'captured-at':null,width:null,height:null,devices:old.devices || [],'device-list':old['device-list'] || ''});
      throw error;
    }
  }
};
