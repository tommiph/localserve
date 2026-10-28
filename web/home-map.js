/** Published map interactions reuse existing durable execution routes. A click
 * opens controls; only an explicit Run or released input sends one command. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const glyph=id=>'<i class="material-symbol ms-'+String(id||'circle').replace(/[^a-z0-9-]/g,'')+'" aria-hidden="true"></i>';
  let model=null,online=false,reading=false,generation=0,timer=null,reader=null,selected=null,selectedTarget=null,pending=null,zoom=1,appearance='';
  const drafts=new Map();
  const text=(node,value)=>{if(node&&node.textContent!==String(value))node.textContent=String(value);};
  const current=()=>{const marker=model?.markers.find(marker=>marker.id===selected);return marker&&JSON.stringify(marker.target)===selectedTarget?marker:null;};
  const canRun=marker=>online&&!model?.paused&&!pending&&marker?.available;
  function uuid(){const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=bytes[6]&15|64;bytes[8]=bytes[8]&63|128;const value=[...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');return [value.slice(0,8),value.slice(8,12),value.slice(12,16),value.slice(16,20),value.slice(20)].join('-');}
  async function api(url,body,headers={},controller=new AbortController()){
    const timeout=setTimeout(()=>controller.abort(),12000);
    try{const response=await fetch(url,{method:body?'POST':'GET',cache:'no-store',signal:controller.signal,headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
      const value=await response.json();if(!response.ok){const error=Error(value.error||'Unavailable.');error.status=response.status;throw error;}return value;
    }finally{clearTimeout(timeout);}
  }
  function feedback(title,message,waiting=false){
    $('map-receipt').hidden=false;text($('map-receipt-title'),title);text($('map-receipt-message'),message);$('map-dismiss').hidden=waiting;
    if($('map-detail').open){let note=$('map-detail-content').querySelector('[data-map-command-status]');if(!note){note=document.createElement('p');note.className='muted';note.dataset.mapCommandStatus='';note.setAttribute('role','status');$('map-detail-content').append(note);}text(note,message);}
  }
  function paint(){
    if(!model)return;
    text($('map-name'),model.name);text($('map-connection'),online?'Home map':'Connection lost');
    // Clock timestamps do not change this page's visual appearance.
    const stable=JSON.stringify([model.options.theme,model.options.fontScale,model.options.colorTheme]);
    if(stable!==appearance){appearance=stable;document.documentElement.dataset.theme=model.options.theme;document.documentElement.style.setProperty('--home-scale',String((model.options.fontScale||100)/100));if(window.ColorThemes)ColorThemes.apply(document,model.options.colorTheme);}
    const stage=$('map-stage'),image=model.image;
    const layout=image?.id||'blank';if(stage.dataset.layout!==layout){stage.dataset.layout=layout;fit();}
    stage.style.aspectRatio=image?image.width+'/'+image.height:'16/10';stage.classList.toggle('has-image',!!image);
    let photo=stage.querySelector('img');
    if(!image)photo?.remove();else if(photo?.dataset.image!==image.id){photo?.remove();photo=document.createElement('img');photo.alt='Apartment floor plan';photo.dataset.image=image.id;photo.src='/api/home-map/image/'+image.id;photo.draggable=false;photo.onerror=()=>{if(photo.isConnected){$('map-notice').hidden=false;text($('map-notice'),'Floor plan unavailable. Ask the administrator to upload it again.');}};stage.prepend(photo);}
    const nodes=new Map([...stage.querySelectorAll('[data-marker]')].map(node=>[node.dataset.marker,node]));
    const ids=new Set(model.markers.map(marker=>marker.id));for(const [id,node]of nodes)if(!ids.has(id))node.remove();
    for(const marker of model.markers){let node=nodes.get(marker.id);if(!node){node=document.createElement('button');node.type='button';node.className='map-marker';node.dataset.marker=marker.id;node.onclick=()=>open(marker.id);stage.append(node);}
      node.style.left=marker.x+'%';node.style.top=marker.y+'%';node.classList.toggle('is-on',online&&marker.on===true);node.classList.toggle('is-unavailable',!online||!marker.available);
      const content=glyph(marker.icon)+'<span>'+escape(marker.name)+'</span>';if(node.innerHTML!==content)node.innerHTML=content;
      node.setAttribute('aria-label',marker.name+' · '+(online?marker.state:'Connection lost'));node.title=marker.name+' · '+(online?marker.state:'Connection lost');
    }
    $('map-empty').hidden=!!image||model.markers.length>0;
    text($('map-empty'),model.enabled?'No map markers yet.':'This map is not shared.');
    $('map-notice').hidden=online&&!model.paused;
    text($('map-notice'),!online?'Connection lost. Controls are unavailable.':model.paused?'Server functions are paused.':'');
    paintDetail();
  }
  function open(id){
    const marker=model?.markers.find(marker=>marker.id===id);if(!marker)return;
    selected=id;selectedTarget=JSON.stringify(marker.target);drafts.clear();text($('map-detail-title'),marker.name);text($('map-detail-caption'),marker.target.kind);
    $('map-detail-content').replaceChildren();$('map-detail').classList.toggle('remote-dialog',marker.action?.type==='remote');
    const host=$('map-detail-content'),action=marker.action;
    const status=document.createElement('p');status.className='muted';status.dataset.mapStatus='';host.append(status);
    if(action?.type==='remote'&&online){const frame=document.createElement('iframe');frame.className='remote-frame';frame.title=marker.name;frame.src=action.url;host.append(frame);}
    else if(action?.type==='card'){const card=document.createElement('div');card.className='map-card';host.append(card);}
    else if(action?.type==='lighting'){
      const fields=document.createElement('div');fields.className='map-fields';
      fields.innerHTML=Object.keys(action.commands).filter(key=>['power','brightness','temperature','color'].includes(key)).map(key=>`<label class="map-field"><span>${{power:'Power',brightness:'Brightness',temperature:'Warmth',color:'Colour'}[key]}<output data-selected="${key}"></output></span><input data-property="${key}" aria-label="${escape(marker.name+' '+key)}" ${key==='power'?'type="checkbox" class="switch" role="switch"':key==='color'?'type="color"':'type="range" min="0" max="100" step="1"'}><small data-reading="${key}"></small></label>`).join('');host.append(fields);
    }else if(action?.type==='scene'||action?.type==='task'){const button=document.createElement('button');button.type='button';button.className='map-run';button.dataset.mapRun='';button.textContent=action.type==='scene'?'Apply scene':'Run task';button.onclick=()=>void run();host.append(button);}
    $('map-detail').showModal();paintDetail();if(action?.type==='card')void readCard(generation);
  }
  function paintDetail(){
    if(!$('map-detail').open)return;
    const marker=current(),host=$('map-detail-content');text(host.querySelector('[data-map-status]'),!online?'Connection lost.':marker?marker.state:'This marker is no longer shared.');
    if(!marker?.action){host.querySelector('iframe')?.remove();host.querySelector('.map-card')?.replaceChildren();}
    const run=host.querySelector('[data-map-run]');if(run)run.disabled=!canRun(marker);
    for(const input of host.querySelectorAll('[data-property]')){
      const key=input.dataset.property,command=marker?.action?.commands?.[key];input.disabled=!canRun(marker)||!command?.available;
      const reported=command?.reported,selectedValue=drafts.get(key);
      if(selectedValue&&reported===selectedValue.value)drafts.delete(key);
      if(document.activeElement!==input&&!drafts.has(key)){if(input.type==='checkbox')input.checked=reported===true;else input.value=reported??(input.type==='color'?'#ffffff':0);}
      const chosen=drafts.get(key)?.value??reported;text(host.querySelector('[data-selected="'+key+'"]'),key==='power'?'':chosen==null?'':String(chosen)+(['brightness','temperature'].includes(key)?'%':''));
      text(host.querySelector('[data-reading="'+key+'"]'),'Reported: '+(reported===null||reported===undefined?'No reading':key==='power'?reported?'On':'Off':reported+(['brightness','temperature'].includes(key)?'%':'')));
    }
  }
  async function run(property,value){
    const marker=current(),action=marker?.action;if(!canRun(marker)||!action)return;
    const command=action.type==='lighting'?action.commands[property]:null;if(action.type==='lighting'&&!command?.available)return;
    const item={id:uuid(),action,name:marker.name,submitting:true,deadline:Date.now()+120000};pending=item;feedback(item.name,'Sending…',true);paintDetail();
    if(property)drafts.set(property,{value});
    try{
      item.receipt=action.type==='task'?await api('/api/phone-home/run',{taskId:action.taskId,revision:action.revision,homeRevision:action.homeRevision,expires:action.expires,requestId:item.id},{'X-Localserve-Home-Token':action.token}):await api('/api/control-view/'+action.pluginId+'/'+action.slug+'/run',{revision:action.revision,itemId:command?.id||action.itemId,requestId:item.id,...(command?{value}:{})},{'X-Localserve-Control-Token':action.token});
      feedback(item.name,'Running…',true);
    }catch(error){if(error.status>=400&&error.status<500){pending=null;drafts.clear();feedback(item.name,error.message);}else{item.uncertain=true;feedback(item.name,'Result not confirmed. Check the device or Task history before trying again.');}}
    finally{item.submitting=false;paintDetail();}
  }
  async function receipt(controller){
    const item=pending;if(!item||item.submitting||item.uncertain||!item.receipt)return;
    if(Date.now()>item.deadline){item.uncertain=true;feedback(item.name,'Still awaiting a result. Check the device or Task history.');return;}
    const action=item.action,result=action.type==='task'?await api('/api/phone-home/receipts/'+item.receipt.requestId,null,{'X-Localserve-Home-Token':item.receipt.token},controller):
      (await api('/api/control-view/'+action.pluginId+'/'+action.slug,null,{},controller)).runs.find(run=>run.id===item.id);
    if(pending!==item)return;
    if(!result){item.uncertain=true;feedback(item.name,'Result is no longer available. Check the device or Task history.');return;}
    if(['queued','running','accepted'].includes(result.status))return;
    pending=null;feedback(item.name,result.status==='completed'?'Completed. Device readings update when reported.':result.status==='cancelled'?'Cancelled.':'Not completed. Check the device or Task history.');paintDetail();
  }
  async function readCard(epoch){
    const marker=current(),host=$('map-detail-content').querySelector('.map-card');if(!host||!marker?.action||marker.action.type!=='card')return;
    try{const value=await api(marker.action.url);if(epoch!==generation||document.hidden||!host.isConnected||current()?.id!==marker.id)return;CardRenderer.mount(host,CardRenderer.render(value.card,value.data,value.catalog,{...value.options,connected:online}));}
    catch{if(host.isConnected&&current()?.id===marker.id)text(host,'Card unavailable.');}
  }
  async function refresh(){
    if(reading||document.hidden)return;reading=true;clearTimeout(timer);const epoch=generation,controller=new AbortController();reader=controller;
    try{const value=await api('/api/home-map',null,{},controller);if(epoch!==generation||document.hidden)return;model=value;online=true;paint();
      try{await receipt(controller);}catch{if(pending&&!pending.submitting){pending.uncertain=true;feedback(pending.name,'Result not confirmed. No command was retried.');}}
      if(epoch===generation&&!document.hidden)await readCard(epoch);
    }catch{if(epoch===generation){online=false;if(model)paint();else{text($('map-connection'),'Unable to connect');text($('map-empty'),'Check that Sormus is running.');}}}
    finally{reading=false;reader=null;if(!document.hidden)timer=setTimeout(refresh,4000);}
  }
  function fit(){const viewport=$('map-viewport'),image=model?.image;zoom=Math.max(1,Math.min(4,zoom));
    const base=Math.min(1500,viewport.clientWidth-80,(viewport.clientHeight-80)*(image?image.width/image.height:16/10));
    $('map-frame').style.width=Math.max(200,base*zoom)+'px';$('map-frame').style.maxWidth='none';
    $('map-zoom-out').disabled=zoom<=1;$('map-zoom-in').disabled=zoom>=4;
  }
  $('map-detail-close').onclick=()=>$('map-detail').close();
  $('map-detail').addEventListener('close',()=>{selected=null;selectedTarget=null;drafts.clear();$('map-detail-content').replaceChildren();});
  $('map-detail-content').addEventListener('input',event=>{const input=event.target,key=input.dataset.property;if(!key)return;const value=input.type==='checkbox'?input.checked:input.type==='color'?input.value:Number(input.value);drafts.set(key,{value});text($('map-detail-content').querySelector('[data-selected="'+key+'"]'),key==='power'?'':String(value)+(['brightness','temperature'].includes(key)?'%':''));});
  $('map-detail-content').addEventListener('change',event=>{const input=event.target;if(input.dataset.property&&!input.disabled)void run(input.dataset.property,input.type==='checkbox'?input.checked:input.type==='color'?input.value:Number(input.value));});
  $('map-dismiss').onclick=()=>{if(pending?.uncertain)pending=null;$('map-receipt').hidden=true;paintDetail();};
  $('map-zoom-in').onclick=()=>{zoom+=.25;fit();};$('map-zoom-out').onclick=()=>{zoom-=.25;fit();};$('map-fit').onclick=()=>{zoom=1;fit();$('map-viewport').scrollTo(0,0);};
  window.addEventListener('resize',fit);
  document.addEventListener('visibilitychange',()=>{generation++;clearTimeout(timer);reader?.abort();if(!document.hidden)void refresh();});
  window.addEventListener('pagehide',()=>{generation++;clearTimeout(timer);reader?.abort();});
  void refresh().then(fit);
})();
