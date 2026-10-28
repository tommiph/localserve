/* The selector only runs existing published capabilities. No action arguments,
   tokens or receipt content is stored in browser preferences or retried. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const glyph = id => '<i class="material-symbol ms-' + String(id || 'play').replace(/[^a-z0-9-]/g,'') + '" aria-hidden="true"></i>';
  const palette = [['#ead493','#584a2c'],['#d7dfcb','#43533e'],['#d4dfe4','#3e5865'],['#e8cfbf','#6d4f3d'],['#dcd3e6','#61526e'],['#cbded7','#3c5c50']];
  let model = null, group = 'scenes', online = false, reading = false, sending = false;
  let pending = null, outcome = null, timer = null, resultTimer = null, generation = 0, readController;
  let library = {remotes:[],cards:[]}, detailTimer, detailController, detailEpoch=0;
  const buttons = new Map();
  // The native shell intercepts this one connection link. No JavaScript bridge
  // grants device access, and the ordinary browser retains its Home link.
  const nativeApp = /(?:^| )Localserve(?:Scenes|Controller)\/1\.0(?: |$)/.test(window.navigator?.userAgent || '');
  if (nativeApp) {
    document.documentElement.dataset.nativeApp = 'scenes';
    $('app-connection').hidden = false;
    const brand = document.querySelector('.brand');brand.href = 'scenes';brand.setAttribute('aria-label','Controller');
  }
  let dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  try { const saved = localStorage.getItem('localserve.scenes.appearance');if (saved === 'light' || saved === 'dark') dark = saved === 'dark'; } catch {}
  const controllerApp=/LocalserveController\/1\.0/.test(window.navigator?.userAgent||'');
  if(controllerApp){dark=!/ControllerTheme\/light/.test(window.navigator.userAgent);$('appearance').hidden=true;}
  function appearance() {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('appearance').innerHTML = glyph(dark ? 'sun' : 'moon');
    $('appearance').setAttribute('aria-label',dark ? 'Use light appearance' : 'Use dark appearance');
    document.querySelector('meta[name="theme-color"]').content = dark ? '#171c19' : '#f7f6f2';
  }
  $('appearance').onclick = () => { dark = !dark;appearance();try { localStorage.setItem('localserve.scenes.appearance',dark ? 'dark' : 'light'); } catch {} };
  window.addEventListener('controller-appearance',event=>{if(controllerApp&&typeof event.detail==='boolean'){dark=event.detail;appearance();}});
  function uuid() {
    const b = crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
    const h = [...b].map(n=>n.toString(16).padStart(2,'0')).join('');
    return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
  }
  async function api(url, body, headers = {}, controller = new AbortController()) {
    const timeout = setTimeout(()=>controller.abort(),12000);
    try {
      const response = await fetch(url,{method:body ? 'POST' : 'GET',cache:'no-store',signal:controller.signal,
        headers:{...(body ? {'Content-Type':'application/json'} : {}),...headers},...(body ? {body:JSON.stringify(body)} : {})});
      const raw = await response.text();if (raw.length > 1048576) throw Error('Server response is too large.');
      const data = JSON.parse(raw);
      if (!response.ok) { const error = Error(data.error || 'This action is unavailable.');error.status = response.status;throw error; }
      return data;
    } finally {clearTimeout(timeout);}
  }
  const key = (item,type) => type === 'scenes' ? 'scene:'+item.pluginId+':'+item.slug+':'+item.id : 'task:'+item.id;
  const controlUrl = item => '/api/control-view/'+encodeURIComponent(item.pluginId)+'/'+encodeURIComponent(item.slug);
  function entries() {
    if(group==='remotes')return library.remotes.map(item=>({...item,key:'remote:'+item.pluginId+':'+item.slug,icon:item.icon||'gamepad',available:true}));
    if(group==='cards')return library.cards.map(item=>({...item,key:'card:'+item.pluginId+':'+item.templateId+':'+item.sourceId}));
    return (model?.[group] || []).map(item=>({...item,key:key(item,group)}));
  }
  function color(id) { let hash=0;for (let i=0;i<id.length;i++) hash=(hash*31+id.charCodeAt(i))>>>0;return palette[hash%palette.length]; }

  // Public mode controls retain buttons/focus during refresh. Only a real
  // selection sends one UUID-bound command; uncertain commands are not retried.
  var homeModePending = false;
  function paintHomeModes(value,connected,visible) {
    var host=document.getElementById('home-modes');if(!host)return;
    host.hidden=!value || !Array.isArray(value.items) || !value.items.length || visible===false;if(host.hidden)return;
    var row=host.querySelector('.home-mode-row');
    if(!row){row=document.createElement('div');row.className='home-mode-row row';host.appendChild(row);var note=document.createElement('p');note.className='home-mode-feedback';note.setAttribute('role','status');host.appendChild(note);}
    var items=value.items || [],wanted=items.map(function(mode){return mode.id;});
    Array.prototype.slice.call(row.children).forEach(function(button){if(wanted.indexOf(button.getAttribute('data-mode-id'))<0)row.removeChild(button);});
    items.forEach(function(mode,index){
      var button=Array.prototype.slice.call(row.children).filter(function(node){return node.getAttribute('data-mode-id')===mode.id;})[0];
      if(!button){button=document.createElement('button');button.type='button';button.className='home-mode-button';button.setAttribute('data-mode-id',mode.id);button.appendChild(document.createElement('i'));button.appendChild(document.createElement('span'));}
      if(row.children[index]!==button)row.insertBefore(button,row.children[index]||null);
      button.children[0].className='material-symbol ms-'+String(mode.icon).replace(/[^a-z0-9-]/g,'');button.children[0].setAttribute('aria-hidden','true');button.children[1].textContent=mode.name;
      var selected=value.currentId===mode.id,color=/^#[a-f0-9]{6}$/i.test(mode.color)?mode.color:'#69bda7';
      button.setAttribute('aria-pressed',String(selected));button.disabled=homeModePending||!connected||!value.available||selected;
      button.style.borderColor=color;button.style.backgroundColor=selected?color:'';
      var rgb=[1,3,5].map(function(at){var x=parseInt(color.substr(at,2),16)/255;return x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4);});
      button.style.color=selected?(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>.179?'#000':'#fff'):'';
      button.onclick=function(){
        if(homeModePending||button.disabled)return;
        var bytes=new Uint8Array(16),id;try{window.crypto.getRandomValues(bytes);bytes[6]=bytes[6]&15|64;bytes[8]=bytes[8]&63|128;id=Array.prototype.map.call(bytes,function(x){return ('0'+x.toString(16)).slice(-2);}).join('');id=id.slice(0,8)+'-'+id.slice(8,12)+'-'+id.slice(12,16)+'-'+id.slice(16,20)+'-'+id.slice(20);}catch(ignore){host.querySelector('.home-mode-feedback').textContent='This browser cannot make a safe mode request.';return;}
        homeModePending=true;paintHomeModes(value,connected,visible);host.querySelector('.home-mode-feedback').textContent='Selecting '+mode.name+'�';
        var request=new XMLHttpRequest(),finished=false;
        function finish(message){if(finished)return;finished=true;homeModePending=false;host.querySelector('.home-mode-feedback').textContent=message;refresh();}
        request.open('POST','/api/phone-home/run',true);request.timeout=6500;request.setRequestHeader('Content-Type','application/json');request.setRequestHeader('X-Localserve-Home-Token',value.token);
        request.onload=function(){var result;try{result=JSON.parse(request.responseText);}catch(ignore){}if(request.status<200||request.status>=300){finish(result&&result.error||'Mode selection was not confirmed. Check Activity before selecting again.');return;}finish(result.taskStatus==='not-started'?'Mode selected. Assigned Task did not start; check Activity.':result.changed?'Mode selected.':'This mode is already active.');};
        request.onerror=request.ontimeout=function(){finish('Connection interrupted. Check the current mode and Activity before selecting again.');};
        request.send(JSON.stringify({modeId:mode.id,revision:value.revision,expires:value.expires,requestId:id}));
      };
    });
  }

  function paint() {
    paintHomeModes(model&&model.modes,online);
    document.documentElement.dataset.commandPending=String(Boolean(pending||sending));
    $('connection').textContent = online ? model?.paused ? 'Home network · paused' : 'Home network' : model ? 'Offline' : 'Connecting';
    $('connection').dataset.online = String(online && !model?.paused);
    $('server-state').hidden = online && !model?.paused || !model;
    $('server-state').textContent = !online ? 'Connection lost. Actions are unavailable until Sormus reconnects.' : 'Server functions are paused.';
    if (!model) return;
    $('server-name').textContent = 'Controller';document.title = 'Controller';
    $('scene-count').textContent = model.scenes.length;$('task-count').textContent = model.tasks.length;
    $('heading').textContent = group === 'scenes' ? 'Lighting scenes' : 'Tasks';
    $('eyebrow').textContent = group === 'scenes' ? 'YOUR LIGHTS' : 'YOUR SHORTCUTS';
    const list = entries();$('item-count').textContent = list.length+' '+(group === 'scenes' ? list.length===1 ? 'scene' : 'scenes' : list.length===1 ? 'Task' : 'Tasks');
    document.querySelector('.heading-mark').innerHTML = glyph(group === 'scenes' ? 'lightbulb' : 'play');
    $('choices').setAttribute('aria-label',group === 'scenes' ? 'Lighting scenes' : group==='tasks'?'Tasks':group==='remotes'?'Remotes':'Cards');
    document.querySelectorAll('[data-group]').forEach(b=>{if (b.dataset.group===group)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    const wanted = new Set(list.map(item=>item.key));
    for (const [id,b] of buttons) if (!wanted.has(id)) { b.remove();buttons.delete(id); }
    $('choices').querySelector('.empty')?.remove();
    const groups = new Set(list.map(item=>item.group).filter(Boolean));
    list.forEach((item,index)=>{
      let b = buttons.get(item.key);
      if (!b) {
        b = document.createElement('button');b.type='button';b.className='scene-button';b.dataset.key=item.key;
        b.innerHTML='<span class="orb"></span><strong></strong><span class="button-state"></span>';
        const colors=color(item.key);b.style.setProperty('--orb',colors[0]);b.style.setProperty('--orb-ink',colors[1]);
        buttons.set(item.key,b);
      }
      if ($('choices').children[index]!==b) $('choices').insertBefore(b,$('choices').children[index]||null);
      const viewer=group==='cards'||group==='remotes';
      b.disabled = !online || !item.available || (!viewer&&(model.paused || sending || Boolean(pending)));
      b.dataset.pending=String(pending?.key===item.key && !pending.uncertain);b.dataset.done=String(outcome?.key===item.key && outcome.status==='completed');
      b.setAttribute('aria-label',(viewer?'Open ':'Run ')+item.name);b.querySelector('strong').textContent=item.name;
      b.title=item.available ? '' : item.unavailableReason || 'Unavailable';
      const icon = outcome?.key===item.key && outcome.status==='completed' ? 'check' : item.icon;
      if (b._icon!==icon) { b.querySelector('.orb').innerHTML=glyph(icon);b._icon=icon; }
      b.querySelector('.button-state').textContent = viewer ? group==='cards'?item.designName||'Card':item.pluginName||'Full remote' : pending?.key===item.key ? pending.uncertain ? 'Check result' : model.paused ? 'Paused' : 'Running…' : !online ? 'Disconnected' : model.paused ? 'Paused' : !item.available ? item.unavailableReason || 'Unavailable' : groups.size>1 ? item.group || '' : '';
    });
    if (!list.length) {
      const p=document.createElement('p');p.className='empty';p.innerHTML=glyph(group==='scenes'?'lightbulb':'play');
      p.append(document.createTextNode(group==='scenes' ? 'Your administrator’s lighting scenes will appear here.' : group==='tasks' ? 'Your administrator’s published Tasks will appear here.' : group==='remotes' ? 'Your administrator’s enabled remotes will appear here.' : 'Cards from enabled plugins will appear here.'));
      $('choices').append(p);
    }
    $('collection-help').textContent = group==='tasks' && list.length ? 'Tap to run a Task. Tasks needing captured Event values are unavailable here.' : '';
  }
  function closeDetail() {detailEpoch++;clearTimeout(detailTimer);detailController?.abort();$('controller-detail').replaceChildren();}
  async function openViewer(item) {
    const sheet=$('controller-sheet');$('controller-sheet-title').textContent=item.name;closeDetail();sheet._read=null;sheet.showModal();
    const current=detailEpoch,host=$('controller-detail');
    if(group==='remotes') {
      const path='/controls/'+encodeURIComponent(item.pluginId)+'/'+encodeURIComponent(item.slug);
      const frame=document.createElement('iframe');frame.className='controller-remote';frame.title=item.name;frame.src=path;host.append(frame);return;
    }
    const card=document.createElement('div');card.className='controller-card';host.append(card);
    async function read() {
      if(document.hidden||!sheet.open||current!==detailEpoch)return;
      detailController=new AbortController();
      try {
        const value=await api('/api/phone-home/cards/'+[item.pluginId,item.templateId,item.sourceId].map(encodeURIComponent).join('/'),null,{},detailController);
        if(current!==detailEpoch||document.hidden||!sheet.open)return;
        CardRenderer.mount(card,CardRenderer.render(value.card,value.data,value.catalog,{...value.options,connected:online}));
      }catch {if(current===detailEpoch)card.textContent='Card unavailable. Check the server connection.';}
      finally {if(current===detailEpoch&&sheet.open&&!document.hidden)detailTimer=setTimeout(read,3000);}
    }
    void read();sheet._read=read;
  }
  function feedback(name,text,running) {
    $('receipt').hidden=false;$('receipt-name').textContent=name;$('receipt-status').textContent=text;
    $('receipt').dataset.running=String(running);$('receipt-symbol').innerHTML=glyph(running?'hourglass-half':outcome?.status==='completed'?'check':'circle-info');
    $('dismiss').hidden=running;
  }
  function finish(status,text) {
    const current=pending;pending=null;sending=false;outcome={key:current?.key,status};
    feedback(current?.name || 'Action',text,false);paint();
    clearTimeout(resultTimer);
    if (status==='completed') resultTimer=setTimeout(()=>{outcome=null;$('receipt').hidden=true;paint();},4500);
  }
  async function start(id) {
    if (pending || sending || !online || model?.paused) return;
    const item=entries().find(item=>item.key===id);if (!item?.available)return;
    clearTimeout(resultTimer);outcome=null;sending=true;
    const current={key:id,name:item.name,type:group,item,requestId:uuid(),deadline:Date.now()+120000};pending=current;
    feedback(item.name,'Starting…',true);paint();
    try {
      const result=await (current.type==='scenes'
        ? api(controlUrl(item)+'/run',{revision:item.revision,itemId:item.id,requestId:current.requestId},{'X-Localserve-Control-Token':item.token})
        : api('/api/phone-home/run',{taskId:item.id,revision:item.revision,homeRevision:model.revision,expires:item.expires,requestId:current.requestId},{'X-Localserve-Home-Token':item.token}));
      if (pending!==current)return;
      current.receipt=result;feedback(item.name,'Running…',true);await checkReceipt(current);
    } catch(error) {
      if (pending!==current)return;
      if (error.status>=400 && error.status<500)finish('not-started',error.message);
      else { current.uncertain=true;feedback(item.name,'Result not confirmed. Check the remote or Task history before running again.',false); }
    } finally {sending=false;paint();}
  }
  async function checkReceipt(current) {
    if (pending!==current || current.uncertain || !current.receipt)return;
    if (Date.now()>current.deadline) {current.uncertain=true;feedback(current.name,'Still awaiting a result. Check the remote or Task history.',false);return;}
    const result=current.type==='tasks'
      ? await api('/api/phone-home/receipts/'+current.receipt.requestId,null,{'X-Localserve-Home-Token':current.receipt.token})
      : (await api(controlUrl(current.item))).runs.find(run=>run.id===current.requestId);
    if (pending!==current)return;
    if (!result) {current.uncertain=true;feedback(current.name,'Result is no longer available. Check the remote history.',false);return;}
    if (['queued','running','accepted'].includes(result.status)) { feedback(current.name,model?.paused ? 'Waiting · server paused' : 'Running…',true);return; }
    finish(result.status,result.status==='completed' ? 'Completed' : result.status==='cancelled' ? 'Cancelled' : 'Not completed. Check the remote or Task history.');
  }
  async function refresh() {
    if (reading || document.hidden)return;
    reading=true;clearTimeout(timer);const epoch=generation;readController=new AbortController();
    try {
      const data=await api('/api/scene-selector',null,{},readController);
      if (epoch!==generation || document.hidden)return;
      if (!Array.isArray(data.scenes)||!Array.isArray(data.tasks))throw Error('Selector unavailable.');
      model=data;online=true;paint();
      try {const value=await api('/api/phone-home',null,{},readController);if(epoch===generation){library={remotes:value.remotes||[],cards:value.cards||[]};if(group==='remotes'||group==='cards')paint();}}catch {}
      if (pending && !sending && !pending.uncertain)await checkReceipt(pending);
    } catch {
      if (epoch===generation) {online=false;paint();if (!model) $('choices').textContent='Unable to connect. Keep Sormus running and check the server address.';}
    } finally {reading=false;readController=null;if (!document.hidden)timer=setTimeout(refresh,3000);}
  }
  $('choices').onclick = event=>{const b=event.target.closest('button[data-key]');if(b&&!b.disabled){if(group==='cards'||group==='remotes')void openViewer(entries().find(item=>item.key===b.dataset.key));else void start(b.dataset.key);}};
  document.querySelectorAll('[data-group]').forEach(b=>{b.onclick=()=>{if (group!==b.dataset.group) {group=b.dataset.group;paint();}};});
  $('dismiss').onclick=()=>{if (pending?.uncertain)pending=null;outcome=null;$('receipt').hidden=true;paint();};
  $('controller-close').onclick=()=>$('controller-sheet').close();
  $('controller-sheet').addEventListener?.('close',closeDetail);
  document.addEventListener('visibilitychange',()=>{generation++;clearTimeout(timer);clearTimeout(detailTimer);if(document.hidden){readController?.abort();detailController?.abort();}else{void refresh();if($('controller-sheet').open)void $('controller-sheet')._read?.();}});
  window.addEventListener('pagehide',()=>{generation++;clearTimeout(timer);clearTimeout(resultTimer);readController?.abort();});
  appearance();void refresh();
})();
