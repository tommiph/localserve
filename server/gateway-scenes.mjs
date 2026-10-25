/** Administrator-only scene previews. Imports copy a bounded inspected snapshot
 * into the existing Controls store; they never activate a gateway scene. */
import {randomUUID} from 'node:crypto';
import {HttpError} from './storage.mjs';
import {authorLightingScene} from './control-lighting.mjs';
const id=value=>typeof value==='string'&&/^\d{1,10}$/.test(value)&&Number(value)>0&&Number(value)<=0xffffffff;
const name=value=>typeof value==='string'&&value.length>0&&value.length<=64&&!/[\u0000-\u001f\u007f]/.test(value);
export class GatewayScenes {
  constructor(registry,controls,room,now=Date.now){Object.assign(this,{registry,controls,room,now});this.previews=new Map();}
  async request(pluginId,pageId,values,signal){
    if(!values||Object.keys(values).some(key=>!['action','revision','pageRevision','groupId','sceneId','preview','name'].includes(key))
      ||!['inspect','import'].includes(values.action))throw new HttpError(400,'Choose a gateway scene operation.');
    const record=this.registry.get(pluginId),runtime=record.runtime,model=this.room.snapshot(pluginId);
    const page=this.controls.sceneDetails(pluginId,pageId),group=model.groups.find(group=>group.id===values.groupId);
    const action=record.plugin.actions.find(action=>action.id==='inspect-scenes'&&action.settingsOnly);
    const check=()=>{
      signal.throwIfAborted();const current=this.room.snapshot(pluginId);
      if(!action||!current.available||current.stale||!current.inventoryComplete||!group?.editToken
        ||current.revision!==values.revision||record.runtime!==runtime
        ||current.groups.find(item=>item.id===group.id)?.editToken!==group.editToken
        ||this.controls.sceneDetails(pluginId,pageId).revision!==values.pageRevision)
        throw new HttpError(409,'Refresh lighting and reopen the gateway scene browser.');
    };
    check();
    for(const [key,preview]of this.previews)if(preview.expires<=this.now())this.previews.delete(key);
    if(values.action==='import'){
      const preview=this.previews.get(values.preview);
      if(!preview||preview.pluginId!==pluginId||preview.pageId!==pageId||preview.groupId!==values.groupId
        ||preview.sceneId!==values.sceneId||preview.runtime!==runtime||preview.revision!==values.revision
        ||preview.pageRevision!==values.pageRevision||preview.groupToken!==group.editToken||preview.expires<=this.now())throw new HttpError(409,'Read this gateway scene again before importing.');
      // Consume before the durable save. A lost response never duplicates a
      // local scene; inspect the library before making another explicit copy.
      this.previews.delete(values.preview);
      const slug=this.controls.pages(pluginId).find(page=>page.id===pageId)?.slug;
      return this.controls.scene(pluginId,slug,null,{action:'create',revision:page.revision,name:values.name,lights:preview.lights},true,check);
    }
    if(model.busy)throw new HttpError(409,'Wait until lighting is idle before reading gateway scenes.');
    if(!id(values.groupId)||values.sceneId!==undefined&&!id(values.sceneId))throw new HttpError(400,'Choose a reported room and scene.');
    const result=await this.registry.execute(pluginId,action.id,{id:values.groupId,'scene-id':values.sceneId||''},{signal,configRevision:values.revision});
    check();
    if(result?.groupId!==group.id||result.groupToken!==group.editToken)throw new HttpError(409,'Room membership changed. Refresh lighting.');
    if(!values.sceneId){
      if(!Array.isArray(result.scenes)||result.scenes.length>32||result.scenes.some(item=>!id(item?.id)||!name(item.name)))throw new HttpError(409,'Gateway scene list is unavailable.');
      return {scenes:result.scenes.map(({id,name})=>({id,name})),truncated:result.truncated===true};
    }
    if(result.sceneId!==values.sceneId||!name(result.name)||!Array.isArray(result.issues)||result.issues.length>4
      ||result.issues.some(issue=>!name(issue)&&!(typeof issue==='string'&&issue.length<=160)))throw new HttpError(409,'Gateway scene details are unavailable.');
    if(result.issues.length)return {name:result.name,importable:false,issues:result.issues};
    const lighting=this.controls.sceneDetails(pluginId,pageId).lighting;
    authorLightingScene(record.plugin,lighting,result.lights,result.name);
    if(result.lights.some(light=>!group.deviceIds.includes(light.id)))throw new HttpError(409,'A scene light is outside this room.');
    const preview=randomUUID();while(this.previews.size>=8)this.previews.delete(this.previews.keys().next().value);
    this.previews.set(preview,{pluginId,pageId,runtime,revision:values.revision,pageRevision:values.pageRevision,
      groupId:group.id,sceneId:values.sceneId,groupToken:group.editToken,lights:structuredClone(result.lights),expires:this.now()+300000});
    return {name:result.name,importable:true,preview,lights:result.lights.map(light=>({id:light.id,name:lighting.lights.find(item=>item.id===light.id)?.name||light.id})),inspectedAt:this.now()};
  }
}
