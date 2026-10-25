/* This page operates published capabilities only. Requests are never replayed;
   receipt polling observes execution, while device readings remain authoritative. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const glyph=id=>'<i class="material-symbol ms-'+String(id||'circle').replace(/[^a-z0-9-]/g,'')+'" aria-hidden="true"></i>';
  const remoteKey=item=>item.pluginId+':'+item.slug,cardKey=item=>item.pluginId+':'+item.templateId+':'+item.sourceId;
  const controlUrl=item=>'/api/control-view/'+encodeURIComponent(item.pluginId)+'/'+encodeURIComponent(item.slug);
  const palette=['#f8dfa2','#d9d9f3','#c1e8df','#f4c9c8','#c9e1f4','#dfc8e9'];
  let model=null,online=false,reading=false,timer=null,readController=null,epoch=0,clockOffset=0,pending=null,detail=null,selection=null;
  const drafts=new Map();
  try{const saved=JSON.parse(localStorage.getItem('sormus.control-room.cards'));if(Array.isArray(saved)&&saved.length<=6&&saved.every(id=>typeof id==='string'&&id.length<=250))selection=saved;}catch{}
  function uuid(){const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=[...b].map(n=>n.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}
  async function api(url,body,headers={},controller=new AbortController()){
    const timeout=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(url,{method:body?'POST':'GET',cache:'no-store',signal:controller.signal,headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
      const text=await response.text();if(text.length>2097152)throw Error('Response too large.');
      const data=JSON.parse(text);if(!response.ok){const error=Error(data.error||'This control is unavailable.');error.status=response.status;throw error;}return data;
    }finally{clearTimeout(timeout);}
  }
  function text(node,value){if(node.textContent!==String(value))node.textContent=value;}
  // Retain keyed buttons, Card iframes and scroll containers across polling.
  function reconcile(host,items,key,create,update,empty){
    const existing=new Map([...host.children].filter(el=>el.dataset.key).map(el=>[el.dataset.key,el])),wanted=new Set(items.map(key));
    for(const [id,node]of existing)if(!wanted.has(id))node.remove();
    host.querySelector('.empty')?.remove();
    items.forEach((item,index)=>{const id=key(item);let node=existing.get(id);if(!node){node=create(item,index);node.dataset.key=id;}if(host.children[index]!==node)host.insertBefore(node,host.children[index]||null);update(node,item,index);});
    if(!items.length){const p=document.createElement('p');p.className='empty';p.textContent=empty;host.append(p);}
  }
  function staleLabel(view){return view.stale?'Reading needs refreshing':!view.receivedAt?'No reading':new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit',hourCycle:model.options.timeFormat==='12'?'h12':'h23',timeZone:model.options.timeZone}).format(new Date(view.receivedAt));}
  function powerLabel(target){return target.reachable===false?'Unreachable':target.on===true?'On':target.on===false?'Off':'State unknown';}
  function canRun(){return online&&!model?.paused&&!pending;}
  function rooms(){return (model?.lighting||[]).flatMap(view=>view.groups.map(group=>({view,group,key:remoteKey(view)+':'+group.id})));}
  function selectedCards(){const seen=new Set();return (selection===null?model?.cards.filter(card=>{if(seen.has(card.pluginId))return false;seen.add(card.pluginId);return true;}).slice(0,3).map(cardKey):selection)||[];}
  function paintClock(){
    if(!model)return;
    try{text($('clock'),new Intl.DateTimeFormat(undefined,{weekday:'long',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:model.options.timeFormat==='12'?'h12':'h23',timeZone:model.options.timeZone}).format(new Date(Date.now()+clockOffset)));}catch{text($('clock'),'Time unavailable');}
  }
  function paint(){
    text($('connection'),online?model?.paused?'Server paused':'Home network · Connected':model?'Offline':'Connecting');$('connection').dataset.online=String(online&&!model?.paused);
    $('connection-notice').hidden=!model||online&&!model.paused;text($('connection-notice'),!online?'Connection lost. Controls are unavailable until the server reconnects.':'Server functions are paused.');
    if(!model)return;
    document.documentElement.dataset.theme=model.options.theme;if(window.ColorThemes)ColorThemes.apply(document,model.options.colorTheme);document.documentElement.style.setProperty('--home-scale',Math.max(.8,Math.min(1.3,(model.options.fontScale||100)/100)));
    text($('home-name'),model.name);document.title='Control room · '+model.name;paintClock();
    text($('footer-status'),online?'Connected to '+model.name:'Last received information · offline');
    const chips=model.remotes.map(remote=>({key:remoteKey(remote),icon:remote.icon,label:remote.name+' · '+(remote.summary||(!remote.available?'Unavailable':'Ready')),warning:!remote.available}));
    const lighting=model.lighting.filter(view=>view.stale);if(lighting.length)chips.push({key:'stale',icon:'clock',label:'Lighting readings need refreshing',warning:true});
    reconcile($('status-strip'),chips,item=>item.key,()=>{const node=document.createElement('span');node.className='status-chip';node.innerHTML='<span></span><span></span>';return node;},(node,item)=>{node.children[0].innerHTML=glyph(item.icon);text(node.children[1],item.label);node.dataset.warning=String(item.warning);},'No device controls published yet.');
    reconcile($('device-grid'),model.remotes,remoteKey,(item,index)=>{
      const node=document.createElement('button');node.className='device-tile';node.dataset.tone=String(index%4);node.innerHTML='<strong></strong><span class="device-state"></span><span class="device-hint"></span><span class="device-art" aria-hidden="true"></span>';node.onclick=()=>openRemote(remoteKey(item));return node;
    },(node,item)=>{text(node.querySelector('strong'),item.name);text(node.querySelector('.device-state'),item.summary||item.pluginName);text(node.querySelector('.device-hint'),item.available?'Open full remote':'Currently unavailable');node.querySelector('.device-art').innerHTML=glyph(item.icon);node.disabled=!online;},'Enabled remotes appear here. Set them up in Administration → Controls.');
    for(const type of ['scenes','tasks'])reconcile($(type==='scenes'?'scene-grid':'task-grid'),model[type],item=>type==='scenes'?remoteKey(item)+':'+item.id:item.id,(item,index)=>{
      const node=document.createElement('button');node.className='shortcut';node.innerHTML='<span class="orb"></span><span class="shortcut-copy"><strong></strong><small></small></span>'+glyph('play');node.querySelector('.orb').style.setProperty('--orb',palette[index%palette.length]);node.onclick=()=>start(type,node.dataset.key);return node;
    },(node,item)=>{node.querySelector('.orb').innerHTML=glyph(item.icon);text(node.querySelector('strong'),item.name);text(node.querySelector('small'),!online?'Disconnected':pending?.key===node.dataset.key?'Running…':!item.available?item.unavailableReason||'Unavailable':type==='scenes'?item.group:'Run Task');node.disabled=!canRun()||!item.available;node.dataset.pending=String(pending?.key===node.dataset.key);node.title=item.unavailableReason||'';},type==='scenes'?'Your enabled lighting scenes appear here.':'Publish Tasks in Administration → Controls → Controller setup.');
    reconcile($('room-grid'),rooms(),item=>item.key,()=>{const node=document.createElement('button');node.className='room-tile';node.innerHTML=glyph('home')+'<strong></strong><small></small>';node.onclick=()=>openRoom(node.dataset.key);return node;},(node,item)=>{text(node.querySelector('strong'),item.group.name);text(node.querySelector('small'),item.view.stale?'Reading needs refreshing':powerLabel(item.group)+(Number.isFinite(item.group.count)?' · '+item.group.count+' members':''));node.disabled=!online;},'Rooms appear when an enabled lighting remote reports gateway groups.');
    const chosen=new Set(selectedCards()),cards=model.cards.filter(item=>chosen.has(cardKey(item)));
    reconcile($('information-grid'),cards,cardKey,()=>{const node=document.createElement('article');node.className='information-panel';node.innerHTML='<div class="information-heading"><strong></strong><span></span></div><div class="information-card"><p class="empty">Loading…</p></div>';return node;},(node,item)=>{text(node.querySelector('strong'),item.name);text(node.querySelector('.information-heading span'),item.designName);},'Choose Cards to keep useful information here.');
    hydrateDetail();
  }
  // Remote documents own their existing controls and lifecycle. Opening a tile
  // never sends an action, and closing removes the iframe rather than hiding it.
  function showDetail(title,caption){
    detail=null;drafts.clear();$('detail-content').replaceChildren();text($('detail-title'),title);text($('detail-caption'),caption);$('detail').classList.remove('remote-dialog');if(!$('detail').open)$('detail').showModal();
  }
  function openRemote(key){const item=model.remotes.find(item=>remoteKey(item)===key);if(!item||!online)return;showDetail(item.name,item.pluginName);detail={type:'remote',key};$('detail').classList.add('remote-dialog');const frame=document.createElement('iframe');frame.title=item.name;frame.className='remote-frame';frame.src='/controls/'+encodeURIComponent(item.pluginId)+'/'+encodeURIComponent(item.slug);$('detail-content').append(frame);}
  function fields(view,target){
    return '<div class="detail-controls">'+['power','brightness','temperature','color'].filter(property=>target.controls?.[property]).map(property=>{
      const id=target.controls[property],label={power:'Power',brightness:'Brightness',temperature:'Warmth',color:'Colour'}[property];
      return '<label class="control-field"><span>'+label+'<output data-output="'+escape(id)+'"></output></span><input aria-label="'+escape(target.name+' · '+label)+'" data-control="'+escape(id)+'" data-property="'+property+'" '+(property==='power'?'type="checkbox" class="switch" role="switch"':property==='color'?'type="color"':'type="range" min="0" max="100" step="1"')+'><small data-reported="'+escape(id)+'"></small></label>';
    }).join('')+'</div>';
  }
  function openRoom(key){
    const item=rooms().find(item=>item.key===key);if(!item)return;
    showDetail(item.group.name,item.view.name);detail={type:'group',key,remote:remoteKey(item.view),id:item.group.id};
    $('detail-content').innerHTML='<p class="muted" data-detail-status></p>'+fields(item.view,item.group)+'<div class="member-lights"></div>';
    const members=item.group.memberIds===null?[]:item.view.lights.filter(light=>item.group.memberIds.includes(light.id));
    for(const light of members){const button=document.createElement('button');button.className='member-light';button.innerHTML=glyph('lightbulb')+'<strong>'+escape(light.name)+'</strong><small>'+escape(powerLabel(light))+'</small>';button.onclick=()=>openLight(remoteKey(item.view),light.id);$('detail-content').querySelector('.member-lights').append(button);}
    // Query within the current dialog, whose body can change without navigation.
    if(!members.length){const p=document.createElement('p');p.className='muted';p.textContent=item.group.memberIds===null?'Individual room members have not been reported.':'No controllable member lights reported.';$('detail-content').append(p);}
    hydrateDetail();
  }
  function openLight(remote,id){const view=model.lighting.find(view=>remoteKey(view)===remote),light=view?.lights.find(light=>light.id===id);if(!light)return;showDetail(light.name,view.name);detail={type:'light',remote,id};$('detail-content').innerHTML='<p class="muted" data-detail-status></p>'+fields(view,light);hydrateDetail();}
  function hydrateDetail(){
    if(!detail||!$('detail').open)return;
    if(detail.type==='remote'){if(!model.remotes.some(item=>remoteKey(item)===detail.key))text($('detail-content'),'This remote is no longer available.');return;}
    const view=model.lighting.find(view=>remoteKey(view)===detail.remote),target=view?.[detail.type==='group'?'groups':'lights'].find(item=>item.id===detail.id);
    const status=$('detail-content').querySelector('[data-detail-status]');text(status,target?powerLabel(target)+' · '+staleLabel(view):'This control is no longer available.');
    for(const input of $('detail-content').querySelectorAll('[data-control]')){
      const item=view?.items.find(item=>item.id===input.dataset.control),property=input.dataset.property;
      input.disabled=!canRun()||!view?.available||view.busy||!item?.available||!target;
      const reported=item?.reported,selected=drafts.get(input.dataset.control);
      if(selected&&view.receivedAt>selected.after&&(typeof reported==='number'?Math.abs(reported-selected.value)<=.6:reported===selected.value))drafts.delete(input.dataset.control);
      if(input!==document.activeElement&&!drafts.has(input.dataset.control)){if(property==='power')input.checked=reported===true;else input.value=reported??(property==='color'?'#ffffff':0);}
      text($('detail-content').querySelector('[data-reported="'+input.dataset.control+'"]'),'Reported: '+(reported===null||reported===undefined?'No data':property==='power'?reported?'On':'Off':reported+(property==='brightness'||property==='temperature'?'%':'')));
    }
  }
  // One explicit activation owns one identity. Network uncertainty keeps that
  // identity pending; subsequent polling checks receipts but never resends it.
  function feedback(name,message,waiting){
    $('receipt').hidden=false;text($('receipt-name'),name);text($('receipt-message'),message);$('receipt-symbol').innerHTML=glyph(waiting?'hourglass-half':'circle-info');$('dismiss-result').hidden=waiting;
    if($('detail').open&&detail?.type!=='remote'){
      let status=$('detail-content').querySelector('[data-command-status]');
      if(!status){status=document.createElement('p');status.className='muted';status.dataset.commandStatus='';status.setAttribute('role','status');$('detail-content').prepend(status);}
      text(status,message);
    }
  }
  async function start(type,key,value){
    if(!canRun())return;
    const item=type==='tasks'?model.tasks.find(item=>item.id===key):type==='scenes'?model.scenes.find(item=>remoteKey(item)+':'+item.id===key):model.lighting.find(item=>remoteKey(item)===detail?.remote);
    if(!item?.available||item.busy)return;
    const command=type==='control'?item.items.find(item=>item.id===key):null;if(type==='control'&&!command?.available)return;
    const current={type,key,name:type==='control'?$('detail-title').textContent:item.name,item,requestId:uuid(),deadline:Date.now()+120000,submitting:true};pending=current;
    if(type==='control')drafts.set(key,{value,after:Date.now()});feedback(current.name,'Sending…',true);paint();
    try{
      current.receipt=type==='tasks'?await api('/api/phone-home/run',{taskId:item.id,revision:item.revision,homeRevision:model.revision,expires:item.expires,requestId:current.requestId},{'X-Localserve-Home-Token':item.token}):await api(controlUrl(item)+'/run',{revision:item.revision,itemId:type==='scenes'?item.id:key,requestId:current.requestId,...(type==='control'?{value}:{})},{'X-Localserve-Control-Token':item.token});
      feedback(current.name,'Running…',true);
    }catch(error){
      if(error.status>=400&&error.status<500){pending=null;drafts.delete(key);feedback(current.name,error.message,false);}
      else{current.uncertain=true;feedback(current.name,'Result not confirmed. Check reported values or Task history before trying again.',false);}
    }finally{current.submitting=false;paint();}
  }
  async function receipt(controller){
    const current=pending;if(!current||current.submitting||current.uncertain||!current.receipt)return;
    if(Date.now()>current.deadline){current.uncertain=true;feedback(current.name,'Still awaiting a result. Check the remote or Task history.',false);return;}
    const result=current.type==='tasks'?await api('/api/phone-home/receipts/'+current.receipt.requestId,null,{'X-Localserve-Home-Token':current.receipt.token},controller):(await api(controlUrl(current.item),null,{},controller)).runs.find(run=>run.id===current.requestId);
    if(pending!==current)return;
    if(!result){current.uncertain=true;feedback(current.name,'Result no longer available. Check the remote history.',false);return;}
    if(['queued','running','accepted'].includes(result.status))return;
    pending=null;feedback(current.name,result.status==='completed'?(current.type==='control'?'Command completed. Check the reported reading below.':'Completed'):result.status==='cancelled'?'Cancelled':'Not completed. Check the remote or Task history.',false);
  }
  async function cards(controller,generation){
    const hosts=[...$('information-grid').children].filter(node=>{const r=node.getBoundingClientRect();return node.dataset.key&&r.bottom>0&&r.top<window.innerHeight;}).slice(0,4);
    await Promise.all(hosts.map(async host=>{
      const item=model.cards.find(item=>cardKey(item)===host.dataset.key);if(!item)return;
      try{const value=await api('/api/phone-home/cards/'+[item.pluginId,item.templateId,item.sourceId].map(encodeURIComponent).join('/'),null,{},controller);if(epoch!==generation||document.hidden||!host.isConnected)return;host._reading=value;CardRenderer.mount(host.querySelector('.information-card'),CardRenderer.render(value.card,value.data,value.catalog,{...value.options,connected:true}));}
      catch{if(epoch!==generation||document.hidden||!host.isConnected)return;const value=host._reading;if(value)CardRenderer.mount(host.querySelector('.information-card'),CardRenderer.render(value.card,value.data,value.catalog,{...value.options,connected:false}));else host.querySelector('.information-card').textContent='Card unavailable.';}
    }));
  }
  function disconnectCards(){for(const host of $('information-grid').children){const value=host._reading;if(value)CardRenderer.mount(host.querySelector('.information-card'),CardRenderer.render(value.card,value.data,value.catalog,{...value.options,connected:false}));}}
  async function refresh(){
    if(reading||document.hidden)return;reading=true;clearTimeout(timer);const generation=epoch,controller=new AbortController();readController=controller;
    try{
      const value=await api('/api/control-room',null,{},controller);if(epoch!==generation||document.hidden)return;
      if(!['remotes','scenes','tasks','lighting','cards'].every(key=>Array.isArray(value[key])))throw Error('Control room unavailable.');
      model=value;online=true;clockOffset=value.options.now-Date.now();paint();
      try{await receipt(controller);}catch{if(pending&&!pending.submitting){pending.uncertain=true;feedback(pending.name,'Result not confirmed. No action was retried.',false);}}
      if(epoch===generation&&!document.hidden){paint();await cards(controller,generation);}
    }catch{if(epoch===generation){online=false;paint();disconnectCards();if(!model){const p=document.createElement('p');p.className='empty';p.textContent='Unable to connect. Check that Sormus is running.';$('status-strip').replaceChildren(p);}}}
    finally{reading=false;readController=null;if(!document.hidden)timer=setTimeout(refresh,4000);}
  }
  // Browser preferences contain public Card identifiers only. Configuration,
  // command capabilities and execution receipts always come from the server.
  function viewOptions(){
    const host=$('card-choices'),selected=new Set(selectedCards());host.replaceChildren();
    for(const card of model?.cards||[]){const label=document.createElement('label');label.className='card-choice';label.innerHTML='<span><strong>'+escape(card.name)+'</strong><small>'+escape(card.pluginName+' · '+card.designName)+'</small></span><input type="checkbox" class="switch" role="switch" aria-label="Show '+escape(card.name+' · '+card.designName)+'">';const input=label.querySelector('input');input.checked=selected.has(cardKey(card));input.onchange=()=>{if(input.checked&&selected.size>=6){input.checked=false;feedback('Cards','Choose up to six Cards.',false);return;}if(input.checked)selected.add(cardKey(card));else selected.delete(cardKey(card));selection=[...selected];try{localStorage.setItem('sormus.control-room.cards',JSON.stringify(selection));}catch{}paint();};host.append(label);}
    if(!host.children.length){const p=document.createElement('p');p.className='empty';p.textContent='Cards from enabled plugins will appear here.';host.append(p);}
    $('options').showModal();
  }
  $('view-options').onclick=viewOptions;$('choose-cards').onclick=viewOptions;$('close-options').onclick=()=>$('options').close();
  $('close-detail').onclick=()=>$('detail').close();$('detail').addEventListener('close',()=>{detail=null;drafts.clear();$('detail-content').replaceChildren();});
  $('detail-content').addEventListener('input',event=>{const input=event.target;if(!input.matches('[data-control]'))return;const value=input.type==='checkbox'?input.checked:input.type==='color'?input.value:Number(input.value);drafts.set(input.dataset.control,{value,after:Date.now()});text($('detail-content').querySelector('[data-output="'+input.dataset.control+'"]'),input.type==='range'?value+'%':'');});
  $('detail-content').addEventListener('change',event=>{const input=event.target;if(input.matches('[data-control]')&&!input.disabled)void start('control',input.dataset.control,input.type==='checkbox'?input.checked:input.type==='color'?input.value:Number(input.value));});
  $('dismiss-result').onclick=()=>{if(pending?.uncertain)pending=null;$('receipt').hidden=true;paint();};
  document.addEventListener('visibilitychange',()=>{epoch++;clearTimeout(timer);if(document.hidden){readController?.abort();disconnectCards();}else void refresh();});
  window.addEventListener('pagehide',()=>{epoch++;clearTimeout(timer);clearInterval(clockTimer);readController?.abort();disconnectCards();});
  const clockTimer=setInterval(()=>{if(!document.hidden)paintClock();},1000);void refresh();
})();
