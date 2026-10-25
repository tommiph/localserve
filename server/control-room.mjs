/** End-user overview of already published capabilities. Reads never execute
 * actions, expose administrator state or expand a remote's target catalogue. */
export function controlRoomView(phoneHome, controls, lightingRoom, now = Date.now()) {
  const home=phoneHome.viewer(true,true),lighting=[];
  for(const page of home.remotes){
    try{
      const view=controls.viewer(page.pluginId,page.slug);
      if(!view.lighting)continue;
      let inventory=null;
      try{inventory=lightingRoom.snapshot(page.pluginId);}catch{/* Not all lighting adapters declare a full inventory. */}
      const received=view.lighting.receivedAt;
      const stale=inventory?inventory.stale:!Number.isFinite(received)||now-received>120000;
      lighting.push({pluginId:page.pluginId,slug:page.slug,name:page.name,revision:view.page.revision,token:view.token,
        available:view.available&&!stale,busy:view.busy,stale,receivedAt:received,
        lights:view.lighting.lights,
        groups:view.lighting.groups.map(group=>({...group,
          memberIds:inventory?.inventoryComplete?inventory.groups.find(row=>row.id===group.id)?.deviceIds.filter(id=>view.lighting.lights.some(light=>light.id===id))??[]:null})),
        items:view.page.items.filter(item=>item.id.startsWith('remote-')).map(({id,available,kind,reported})=>({id,available,kind,reported})),
      });
    }catch{/* A removed or unavailable page cannot expose retained capabilities. */}
  }
  return {...home,lighting,options:{...controls.options(),now,timeZone:new Intl.DateTimeFormat().resolvedOptions().timeZone}};
}
