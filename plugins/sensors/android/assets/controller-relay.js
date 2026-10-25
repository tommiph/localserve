/* The offline selector receives only public catalogue fields. Native code owns
   credentials, durable request identities and receipt polling. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),buttons=new Map();
  const palette=[['#ead493','#584a2c'],['#d7dfcb','#43533e'],['#d4dfe4','#3e5865'],['#e8cfbf','#6d4f3d'],['#dcd3e6','#61526e'],['#cbded7','#3c5c50']];
  let model={},group='scenes';
  const command=(name,value='')=>{location.href='https://controller.local/command/'+name+(value?'?key='+encodeURIComponent(value):'');};
  function glyph(id){const node=document.createElement('i');node.className='material-symbol ms-'+(/^[a-z0-9-]+$/.test(id)?id:'lightbulb');node.setAttribute('aria-hidden','true');return node;}
  function paint(){
    document.documentElement.dataset.theme=model.dark?'dark':'light';document.documentElement.dataset.nativeApp='scenes';
    $('app-connection').hidden=false;$('appearance').hidden=true;
    $('connection').textContent=model.online?'Away from home':'Offline';$('connection').dataset.online=String(Boolean(model.online));
    $('server-state').hidden=Boolean(model.online&&!model.catalog?.paused);
    $('server-state').textContent=!model.online?'Unable to connect. Your shortcuts will return when the connection recovers.':model.catalog?.paused?'Server functions are paused.':'';
    const list=model.catalog?.[group]||[],wanted=new Set(list.map(item=>item.key));
    for(const [key,node] of buttons)if(!wanted.has(key)){node.remove();buttons.delete(key);}
    $('choices').querySelector('.empty')?.remove();$('choices').setAttribute('aria-label',group==='scenes'?'Lighting scenes':group[0].toUpperCase()+group.slice(1));
    list.forEach((item,index)=>{
      let node=buttons.get(item.key);
      if(!node){node=document.createElement('button');node.type='button';node.className='scene-button';node.innerHTML='<span class="orb"></span><strong></strong><span class="button-state"></span>';let hash=0;const colorKey=item.type==='scene'?'scene:'+item.key.replaceAll('/',':'):'task:'+item.key;for(let i=0;i<colorKey.length;i++)hash=(hash*31+colorKey.charCodeAt(i))>>>0;const colors=palette[hash%palette.length];node.style.setProperty('--orb',colors[0]);node.style.setProperty('--orb-ink',colors[1]);node.onclick=()=>command('run',item.key);buttons.set(item.key,node);}
      if($('choices').children[index]!==node)$('choices').insertBefore(node,$('choices').children[index]||null);
      node.disabled=!model.online||!item.available||model.catalog.paused||Boolean(model.pending);
      node.querySelector('strong').textContent=item.name;node.setAttribute('aria-label','Run '+item.name);
      if(node.dataset.icon!==item.icon){node.querySelector('.orb').replaceChildren(glyph(item.icon));node.dataset.icon=item.icon;}
      node.dataset.pending=String(model.pendingKey===item.key);node.querySelector('.button-state').textContent=!model.online?'Offline':model.catalog.paused?'Paused':!item.available?item.unavailableReason||'Unavailable':'';
    });
    if(!list.length){const empty=document.createElement('p');empty.className='empty';empty.textContent=group==='remotes'||group==='cards'?'Connect to your home network to use '+(group==='remotes'?'full remotes.':'Cards.'):model.catalog?'No published items in this group.':'Waiting for Sormus to synchronize your shortcuts…';$('choices').append(empty);}
    document.querySelectorAll('[data-group]').forEach(node=>{if(node.dataset.group===group)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');});
    $('collection-help').textContent='Remote shortcuts can take one server polling interval. A queued request is not a completed action.';
    $('receipt').hidden=!model.pending&&!model.result;$('receipt-name').textContent=model.pendingName||model.result||'';$('receipt-status').textContent=model.status||'';
    $('receipt-symbol').replaceChildren(glyph(model.pending?'clock':'check'));$('dismiss').hidden=!model.dismissible;
  }
  window.ControllerRelay={render(value){try{model=JSON.parse(value);paint();}catch{}}};
  $('app-connection').onclick=event=>{event.preventDefault();command('settings');};document.querySelector('.brand').onclick=event=>event.preventDefault();
  $('dismiss').onclick=()=>command('dismiss');document.querySelectorAll('[data-group]').forEach(node=>{node.onclick=()=>{group=node.dataset.group;paint();};});
})();
