/** Map targets are an intersection with currently published capabilities.
 * Resolving a marker reads existing projections and never starts a command. */
export const mapTargetKey=target=>JSON.stringify(Object.entries(target).sort(([a],[b])=>a.localeCompare(b)));
export function mapTargets(view) {
  const entries=[];
  for(const page of view.lighting){
    for(const [kind,rows,field]of [['light',page.lights,'lightId'],['group',page.groups,'groupId']])for(const item of rows){
      const commands=Object.fromEntries(Object.entries(item.controls||{}).flatMap(([property,id])=>{
        const control=page.items.find(control=>control.id===id);
        return control?[[property,{id,available:control.available,reported:control.reported}]]:[];
      }));
      entries.push({target:{kind,pluginId:page.pluginId,slug:page.slug,[field]:item.id},name:item.name,
        group:page.name,icon:kind==='light'?'lightbulb':'house',available:page.available&&!page.busy&&item.reachable!==false,
        state:page.stale?'Reading needs refreshing':item.reachable===false?'Unreachable':item.on===true?'On':item.on===false?'Off':'State unknown',
        on:!page.stale?item.on:null,brightness:!page.stale?item.brightness:null,
        action:{type:'lighting',pluginId:page.pluginId,slug:page.slug,revision:page.revision,token:page.token,commands}});
    }
  }
  for(const scene of view.scenes)entries.push({target:{kind:'scene',pluginId:scene.pluginId,slug:scene.slug,itemId:scene.id},
    name:scene.name,group:scene.group,icon:scene.icon,available:scene.available,state:scene.available?'Scene':'Unavailable',
    action:{type:'scene',pluginId:scene.pluginId,slug:scene.slug,revision:scene.revision,token:scene.token,itemId:scene.id}});
  for(const task of view.tasks)entries.push({target:{kind:'task',taskId:task.id},name:task.name,group:'Tasks',icon:task.icon,
    available:task.available,state:task.available?'Task':task.unavailableReason||'Unavailable',
    action:{type:'task',taskId:task.id,revision:task.revision,homeRevision:view.revision,expires:task.expires,token:task.token}});
  for(const remote of view.remotes)entries.push({target:{kind:'remote',pluginId:remote.pluginId,slug:remote.slug},
    name:remote.name,group:remote.pluginName,icon:remote.icon,available:true,state:remote.summary||'Remote',
    action:{type:'remote',url:'/controls/'+encodeURIComponent(remote.pluginId)+'/'+encodeURIComponent(remote.slug)}});
  for(const card of view.cards)entries.push({target:{kind:'card',pluginId:card.pluginId,templateId:card.templateId,sourceId:card.sourceId},
    name:card.name+' · '+card.designName,group:card.pluginName,icon:card.icon,available:card.available,state:'Information',
    action:{type:'card',url:'/api/phone-home/cards/'+[card.pluginId,card.templateId,card.sourceId].map(encodeURIComponent).join('/')}});
  return entries;
}
export function homeMapCatalogue(view) {
  return mapTargets(view).map(({action,...entry})=>entry);
}
export function homeMapView(map,view) {
  const result={name:map.name,revision:map.revision,enabled:map.enabled,image:null,markers:[],paused:view.paused,options:view.options};
  if(!map.enabled)return result;
  result.image=map.image;
  const targets=new Map(mapTargets(view).map(entry=>[mapTargetKey(entry.target),entry]));
  result.markers=map.markers.filter(marker=>marker.enabled).map(marker=>{
    const entry=targets.get(mapTargetKey(marker.target));
    return {...marker,...(entry?{available:entry.available,state:entry.state,on:entry.on,brightness:entry.brightness,action:entry.action}:
      {available:false,state:'No longer shared. Choose another target in administration.'})};
  });
  return result;
}
