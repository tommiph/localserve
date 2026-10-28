/** Durable mode selection. Starting/configuring restores state without Events. */
import {randomUUID} from 'node:crypto';
const modeEntries=value=>value?.modes || [];
let settings;
export default {
  validateConfiguration(value){return Array.isArray(value.modes);},
  async start(value){settings=structuredClone(value);},
  async stop(){settings=null;},
  async execute(action,parameters,context){
    if(action!=='select-mode')throw Error('Unknown home mode action.');
    const mode=modeEntries(settings).find(item=>item.enabled&&item.id===parameters['mode-id']);
    if(!mode)throw Error('Choose an enabled home mode.');
    context.signal.throwIfAborted();
    const state=await context.readState();
    if(state['mode-id']!==undefined&&typeof state['mode-id']!=='string')throw Error('Stored home mode is invalid; original state retained.');
    if(state['mode-id']===mode.id)return {changed:false,taskStatus:'not-requested'};
    const previous=modeEntries(settings).find(item=>item.id===state['mode-id']);
    const payload={'mode-id':mode.id,'mode-name':mode.name,'previous-mode-id':state['mode-id']||'',
      'previous-mode-name':previous?.name||state['mode-name']||'','changed-at':Date.now(),'transition-id':randomUUID()};
    // Commit first. A crash may skip the Event/Task, but cannot replay them on restart.
    await context.saveState({...state,...payload,'mode-color':mode.color});
    const result=await context.emit('mode-changed',payload);
    return {changed:true,taskStatus:result?.modeTask?.status||'not-assigned',taskRunId:result?.modeTask?.runId||null};
  },
};
