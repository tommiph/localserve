/* The selector only runs existing published capabilities. No action arguments,
   tokens or receipt content is stored in browser preferences or retried. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const glyph = id => '<i class="material-symbol ms-' + String(id || 'play').replace(/[^a-z0-9-]/g,'') + '" aria-hidden="true"></i>';
  const palette = [['#ead493','#584a2c'],['#d7dfcb','#43533e'],['#d4dfe4','#3e5865'],['#e8cfbf','#6d4f3d'],['#dcd3e6','#61526e'],['#cbded7','#3c5c50']];
  let model = null, group = 'scenes', online = false, reading = false, sending = false;
  let pending = null, outcome = null, timer = null, resultTimer = null, generation = 0, readController;
  const buttons = new Map();
  // The native shell intercepts this one connection link. No JavaScript bridge
  // grants device access, and the ordinary browser retains its Home link.
  const nativeApp = /(?:^| )LocalserveScenes\/1\.0(?: |$)/.test(window.navigator?.userAgent || '');
  if (nativeApp) {
    document.documentElement.dataset.nativeApp = 'scenes';
    $('app-connection').hidden = false;$('android-download').hidden = true;
    const brand = document.querySelector('.brand');brand.href = 'scenes';brand.setAttribute('aria-label','Scenes');
  }
  let dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  try { const saved = localStorage.getItem('localserve.scenes.appearance');if (saved === 'light' || saved === 'dark') dark = saved === 'dark'; } catch {}
  function appearance() {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('appearance').innerHTML = glyph(dark ? 'sun' : 'moon');
    $('appearance').setAttribute('aria-label',dark ? 'Use light appearance' : 'Use dark appearance');
    document.querySelector('meta[name="theme-color"]').content = dark ? '#171c19' : '#f7f6f2';
  }
  $('appearance').onclick = () => { dark = !dark;appearance();try { localStorage.setItem('localserve.scenes.appearance',dark ? 'dark' : 'light'); } catch {} };
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
  function entries() { return (model?.[group] || []).map(item=>({...item,key:key(item,group)})); }
  function color(id) { let hash=0;for (let i=0;i<id.length;i++) hash=(hash*31+id.charCodeAt(i))>>>0;return palette[hash%palette.length]; }
  function paint() {
    $('connection').textContent = online ? model?.paused ? 'Paused' : 'Connected' : model ? 'Disconnected' : 'Connecting';
    $('connection').dataset.online = String(online && !model?.paused);
    $('server-state').hidden = online && !model?.paused || !model;
    $('server-state').textContent = !online ? 'Connection lost. Actions are unavailable until Localserve reconnects.' : 'Server functions are paused.';
    if (!model) return;
    $('server-name').textContent = nativeApp ? 'Scenes' : model.name;document.title = model.name+' · Scenes';
    $('scene-count').textContent = model.scenes.length;$('task-count').textContent = model.tasks.length;
    $('heading').textContent = group === 'scenes' ? 'Lighting scenes' : 'Tasks';
    $('eyebrow').textContent = group === 'scenes' ? 'YOUR LIGHTS' : 'YOUR SHORTCUTS';
    const list = entries();$('item-count').textContent = list.length+' '+(group === 'scenes' ? list.length===1 ? 'scene' : 'scenes' : list.length===1 ? 'Task' : 'Tasks');
    document.querySelector('.heading-mark').innerHTML = glyph(group === 'scenes' ? 'lightbulb' : 'play');
    $('choices').setAttribute('aria-label',group === 'scenes' ? 'Lighting scenes' : 'Tasks');
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
      b.disabled = !online || model.paused || !item.available || sending || Boolean(pending);
      b.dataset.pending=String(pending?.key===item.key && !pending.uncertain);b.dataset.done=String(outcome?.key===item.key && outcome.status==='completed');
      b.setAttribute('aria-label','Run '+item.name);b.querySelector('strong').textContent=item.name;
      b.title=item.available ? '' : item.unavailableReason || 'Unavailable';
      const icon = outcome?.key===item.key && outcome.status==='completed' ? 'check' : item.icon;
      if (b._icon!==icon) { b.querySelector('.orb').innerHTML=glyph(icon);b._icon=icon; }
      b.querySelector('.button-state').textContent = pending?.key===item.key ? pending.uncertain ? 'Check result' : model.paused ? 'Paused' : 'Running…' : !online ? 'Disconnected' : model.paused ? 'Paused' : !item.available ? item.unavailableReason || 'Unavailable' : groups.size>1 ? item.group || '' : '';
    });
    if (!list.length) {
      const p=document.createElement('p');p.className='empty';p.innerHTML=glyph(group==='scenes'?'lightbulb':'play');
      p.append(document.createTextNode(group==='scenes' ? 'Your lighting scenes will appear here. Save and enable a scene on a lighting remote to get started.' : 'Choose your Task shortcuts in Administration → Phone home. Only published Tasks appear here.'));
      $('choices').append(p);
    }
    $('collection-help').textContent = group==='tasks' && list.length ? 'Tap to run a Task. Tasks needing captured Event values are unavailable here.' : '';
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
      if (pending && !sending && !pending.uncertain)await checkReceipt(pending);
    } catch {
      if (epoch===generation) {online=false;paint();if (!model) $('choices').textContent='Unable to connect. Keep Localserve running and check the server address.';}
    } finally {reading=false;readController=null;if (!document.hidden)timer=setTimeout(refresh,3000);}
  }
  $('choices').onclick = event=>{const b=event.target.closest('button[data-key]');if (b && !b.disabled)void start(b.dataset.key);};
  document.querySelectorAll('[data-group]').forEach(b=>{b.onclick=()=>{if (group!==b.dataset.group) {group=b.dataset.group;paint();}};});
  $('dismiss').onclick=()=>{if (pending?.uncertain)pending=null;outcome=null;$('receipt').hidden=true;paint();};
  document.addEventListener('visibilitychange',()=>{generation++;clearTimeout(timer);if (document.hidden)readController?.abort();else void refresh();});
  window.addEventListener('pagehide',()=>{generation++;clearTimeout(timer);clearTimeout(resultTimer);readController?.abort();});
  appearance();void refresh();
})();
