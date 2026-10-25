/** Desktop lighting administration projects declared inventory only. Explicit
 * commands use the normal plugin queue; a single read after acknowledgement is
 * observation, never a retry of a command with an uncertain outcome. */
import {randomUUID} from 'node:crypto';
import {HttpError} from './storage.mjs';
import {lightingModel} from './control-lighting.mjs';
import {projectCardData} from './cards.mjs';
import {lightingEditActions,lightingEditName,lightingEditToken,lightingMemberIds} from './lighting-edit-contract.mjs';

const id = value => typeof value === 'string' && /^\d{1,10}$/.test(value) && Number(value)>0 && Number(value)<=0xffffffff;
const text = value => typeof value==='string' ? value.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,120) : null;
const percent = value => typeof value==='number' && Number.isFinite(value) && value>=0 && value<=100 ? value : null;
const boolean = value => typeof value==='boolean' ? value : null;
const hue = value => typeof value==='number' && Number.isFinite(value) && value>=0 && value<=360 ? value : null;
const editToken = value => typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)?value:null;
const unique = rows => Array.isArray(rows) && rows.length<=100 && rows.every(row=>row&&id(row.id)) && new Set(rows.map(row=>row.id)).size===rows.length;

export function projectLightingInventory(value) {
  if(value?.schemaVersion!==1 || !['lights','groups','devices'].every(key=>unique(value[key])))return null;
  return {
    lights:value.lights.map(row=>({id:row.id,name:text(row.name)||'Unnamed light',room:text(row.room),on:boolean(row.on),
      brightness:percent(row.brightness),reachable:boolean(row.reachable),spectrum:['none','white','rgb'].includes(row.spectrum)?row.spectrum:null,
      temperature:row.spectrum==='white'?percent(row.temperature):null,hue:row.spectrum==='rgb'?hue(row.hue):null,
      saturation:row.spectrum==='rgb'?percent(row.saturation):null})),
    groups:value.groups.map(row=>({id:row.id,name:text(row.name)||'Unnamed room',editToken:editToken(row.editToken),on:boolean(row.on),brightness:percent(row.brightness),
      deviceIds:Array.isArray(row.deviceIds)?[...new Set(row.deviceIds.filter(id))].slice(0,100):[]})),
    devices:value.devices.map(row=>({id:row.id,name:text(row.name)||'Unnamed device',editToken:editToken(row.editToken),type:Number.isInteger(row.type)&&row.type>=0&&row.type<=100?row.type:null,
      reachable:boolean(row.reachable),battery:percent(row.battery),model:text(row.model),firmware:text(row.firmware)})),
  };
}

export class LightingRoom {
  constructor(registry,controls,{now=Date.now}={}) {this.registry=registry;this.controls=controls;this.now=now;this.operations=new Map();this.claims=new Set();}
  source(pluginId) {
    const record=this.registry.get(pluginId),declaration=record.plugin.controls?.lighting;
    if(!declaration?.inventoryState)throw new HttpError(404,'Lighting control room unavailable.');
    return {record,declaration,config:record.config.snapshot(),reading:record.state.snapshot()};
  }
  snapshot(pluginId) {
    const {record,declaration,config,reading}=this.source(pluginId),paused=this.registry.engine.gate.paused;
    const identity=config.settings[declaration.identitySetting]===reading[declaration.identityState];
    const complete=identity?projectLightingInventory(reading[declaration.inventoryState]):null;
    const fallback=lightingModel(record.plugin,{presentation:'lighting'},projectCardData(record.plugin,record,paused),identity);
    const inventory=complete||{lights:fallback.lights,groups:fallback.groups.map(row=>({...row,deviceIds:[]})),devices:[]};
    const receivedAt=identity&&Number.isFinite(reading[declaration.received])?reading[declaration.received]:null;
    const gatewayStatus=record.gatewayConnection?.status||null;
    const stale=gatewayStatus==='unreachable'||!receivedAt||this.now()-receivedAt>Math.max(120000,(config.settings['poll-minutes']||1)*120000+30000);
    let ready=true;try{this.registry.assertReady(record);}catch{ready=false;}
    const operation=this.operations.get(pluginId);
    if(operation&&(operation.revision!==config.revision||operation.runtime!==record.runtime))this.operations.delete(pluginId);
    else if(operation?.phase==='awaiting'&&receivedAt>=operation.sentAt){
      const target=(operation.kind==='device'?inventory.devices:operation.kind==='light'?inventory.lights:inventory.groups).find(row=>row.id===operation.targetId);
      const actual=operation.property==='power'?target?.on:operation.property==='color'?[target?.hue,target?.saturation]:target?.[operation.property];
      const expected=operation.expected;
      const matches=operation.property==='configuration'?target?.editToken===expected:operation.property==='color'?actual.every(Number.isFinite)&&Math.min(Math.abs(actual[0]-expected[0]),360-Math.abs(actual[0]-expected[0]))<=3&&Math.abs(actual[1]-expected[1])<=2
        :typeof expected==='boolean'?actual===expected:typeof actual==='number'&&Math.abs(actual-expected)<=0.6;
      if(matches)operation.phase='confirmed';
    }
    const active=this.operations.get(pluginId);
    const sceneRun=this.controls.runs?.snapshot().runs.filter(run=>run.pluginId===pluginId).sort((a,b)=>b.startedAt-a.startedAt)[0];
    const failure=this.controls.failures?.get(pluginId);
    return {pluginId,revision:config.revision,available:ready&&!paused,paused,busy:Boolean(record.pending)||this.controls.active.has(pluginId),
      receivedAt,stale,gatewayStatus,inventoryComplete:Boolean(complete),management:Boolean(lightingEditActions(record.plugin)),...inventory,
      operation:active?{id:active.id,kind:active.kind,targetId:active.targetId,property:active.property,phase:active.phase,message:active.message,startedAt:active.startedAt}:null,
      limits:{devices:100,groups:100},
      diagnostics:{lastScene:sceneRun?{status:sceneRun.status,step:sceneRun.step,totalSteps:sceneRun.totalSteps,startedAt:sceneRun.startedAt,finishedAt:sceneRun.finishedAt??null}:null,
        lastFailure:failure?{at:failure.at,stage:failure.stage,type:failure.type,code:failure.code}:null},
    };
  }
  async command(pluginId,values,signal) {
    if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).some(key=>!['revision','requestId','kind','id','property','value'].includes(key)))throw new HttpError(400,'Invalid lighting command.');
    if(!/^[a-f0-9-]{36}$/i.test(values.requestId||''))throw new HttpError(400,'Use a new lighting command identifier.');
    const {record,declaration,config}=this.source(pluginId),model=this.snapshot(pluginId);
    if(values.revision!==config.revision)throw new HttpError(409,'Gateway settings changed. Refresh the control room.');
    if(!model.available||model.busy)throw new HttpError(409,'Wait until the gateway is ready and idle.');
    if(this.claims.has(values.requestId))throw new HttpError(409,'This command has already been submitted. Refresh reported values instead of repeating it.');
    let action,parameters={},expected=values.value;
    if(values.kind==='refresh'){
      if(values.id!==undefined||values.property!==undefined||values.value!==undefined)throw new HttpError(400,'Refresh does not take light settings.');
      action=declaration.actions.refresh;
    }else{
      if(!['light','group'].includes(values.kind)||!id(values.id))throw new HttpError(400,'Choose a reported light or room.');
      if(model.stale)throw new HttpError(409,'Refresh lighting before changing an old reading.');
      const target=(values.kind==='light'?model.lights:model.groups).find(row=>row.id===values.id);
      if(!target||target.reachable===false)throw new HttpError(409,'The selected device is missing or unreachable.');
      parameters.id=values.id;
      if(values.property==='power'&&typeof values.value==='boolean') {action=declaration.actions[values.kind+'Power'];parameters.on=values.value;}
      else if(values.property==='brightness'&&percent(values.value)!==null) {action=declaration.actions[values.kind+'Brightness'];parameters.value=values.value;}
      else if(values.kind==='light'&&values.property==='temperature'&&target.spectrum==='white'&&percent(values.value)!==null) {action=declaration.actions.lightTemperature;parameters.value=values.value;}
      else if(values.kind==='light'&&values.property==='color'&&target.spectrum==='rgb'&&/^#[a-f0-9]{6}$/i.test(values.value)){
        action=declaration.actions.lightColor;parameters.color=values.value;
        const rgb=values.value.slice(1).match(/../g).map(value=>parseInt(value,16)/255),max=Math.max(...rgb),min=Math.min(...rgb),delta=max-min;
        let hue=!delta?0:max===rgb[0]?((rgb[1]-rgb[2])/delta)%6:max===rgb[1]?(rgb[2]-rgb[0])/delta+2:(rgb[0]-rgb[1])/delta+4;
        expected=[(hue*60+360)%360,max?delta/max*100:0];
      }else throw new HttpError(400,'This setting is not supported by the selected device.');
    }
    const operation={id:randomUUID(),runtime:record.runtime,revision:config.revision,kind:values.kind,targetId:values.id,property:values.property,expected,phase:'sending',startedAt:this.now(),message:''};
    return this.perform(pluginId,record,declaration,config,values,operation,action,parameters,signal);
  }
  async manage(pluginId,values,signal) {
    if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).some(key=>!['revision','requestId','kind','id','name','members','expected'].includes(key)))throw new HttpError(400,'Invalid gateway edit.');
    const {record,declaration,config}=this.source(pluginId),model=this.snapshot(pluginId),actions=lightingEditActions(record.plugin);
    if(!actions||!model.inventoryComplete)throw new HttpError(409,'Refresh the complete gateway inventory before editing.');
    if(!model.available||model.busy||model.stale)throw new HttpError(409,'Wait until the gateway is ready, idle and recently refreshed.');
    if(values.revision!==config.revision)throw new HttpError(409,'Gateway settings changed. Reopen the editor.');
    if(!/^[a-f0-9-]{36}$/i.test(values.requestId||'')||this.claims.has(values.requestId))throw new HttpError(409,'Use a new editor request. Do not repeat an uncertain save.');
    if(!['device','group'].includes(values.kind)||!id(values.id))throw new HttpError(400,'Choose a reported device or room.');
    const target=(values.kind==='device'?model.devices:model.groups).find(item=>item.id===values.id);
    if(!target?.editToken||target.editToken!==values.expected)throw new HttpError(409,'This device or room changed. Refresh and reopen its editor.');
    let name,members;
    try{name=lightingEditName(values.name);if(values.kind==='group')members=lightingMemberIds(values.members);}
    catch(error){throw new HttpError(400,error.message);}
    if(values.kind==='device'&&values.members!==undefined)throw new HttpError(400,'A device rename cannot change room members.');
    if(values.kind==='group'){
      const lights=new Set(model.lights.map(light=>light.id)),before=target.deviceIds;
      const changed=[...before.filter(id=>!members.includes(id)),...members.filter(id=>!before.includes(id))];
      if(changed.some(id=>!lights.has(id)))throw new HttpError(400,'Choose lights only; other room members must stay unchanged.');
    }
    const parameters={id:values.id,name,expected:values.expected,...(members?{members:JSON.stringify(members)}:{})};
    const operation={id:randomUUID(),runtime:record.runtime,revision:config.revision,kind:values.kind,targetId:values.id,property:'configuration',
      expected:lightingEditToken(values.kind,values.id,name,members),phase:'sending',startedAt:this.now(),message:''};
    return this.perform(pluginId,record,declaration,config,values,operation,actions[values.kind],parameters,signal);
  }
  async perform(pluginId,record,declaration,config,values,operation,action,parameters,signal) {
    this.claims.add(values.requestId);if(this.claims.size>256)this.claims.delete(this.claims.values().next().value);
    this.operations.set(pluginId,operation);
    try{
      await this.registry.execute(pluginId,action,parameters,{signal,configRevision:config.revision});
      signal.throwIfAborted();
      operation.phase=values.kind==='refresh'?'refreshed':'awaiting';operation.sentAt=this.now();
      if(values.kind!=='refresh'){
        // Refresh once. A failed read must not turn a delivered command into a
        // failed-command retry or claim that the requested value was observed.
        try{await this.registry.execute(pluginId,declaration.actions.refresh,{}, {signal,configRevision:config.revision});}
        catch{operation.message='Command accepted; fresh readings are unavailable. No command was retried.';}
      }
      return this.snapshot(pluginId);
    }catch(error){operation.phase='uncertain';operation.message='Command not confirmed. Check reported values before trying again.';if(!error.status)error.status=409;throw error;}
  }
}
