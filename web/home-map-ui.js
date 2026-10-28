/** Administrator map authoring keeps one captured draft. Refreshes update the
 * saved preview only; marker movements and uploads never operate a device. */
const HomeMapUI = {
  draft:null, catalogue:[], selected:null, images:new Map(), loading:new Map(), pending:false,
  render() {
    const map=state.homeMap;
    if(!map)return pageHeading('Home map','Floor plans and shared controls')+'<p>Refresh the administrator to load Home map.</p>';
    return pageHeading('Home map','Place shared lights, scenes, Tasks and information on your floor plan',
      '<button class="button" data-view="controls">'+icon('arrow-left')+'Controls</button>')+
      `<section class="panel"><div class="panel-header"><h2>${escapeHtml(map.name)}</h2><div class="row-actions"><button class="switch" role="switch" aria-label="Map enabled" aria-checked="${map.enabled}" data-action="map-enabled"></button><a class="button" href="/home-map" target="_blank" rel="noopener">${icon('arrow-up-right-from-square')}Open map</a><button class="button primary" data-action="map-edit">${icon('pen')}Edit layout</button></div></div><div class="panel-body"><p class="field-help">Upload a floor plan or use the blank canvas. Add markers for capabilities already shared in Controller. Only enabled markers appear on the map; editing never changes a device.</p><div class="home-map-stage home-map-preview" data-map-preview style="aspect-ratio:${map.image?map.image.width+'/'+map.image.height:'16/10'}">${map.image?`<img alt="Floor plan" data-map-image="${map.image.id}" ${this.images.has(map.image.id)?`src="${this.images.get(map.image.id)}"`:''}>`:''}${map.markers.map(marker=>`<span class="map-marker ${marker.enabled?'':'is-disabled'}" style="left:${marker.x}%;top:${marker.y}%" title="${escapeHtml(marker.name)}">${icon(marker.icon)}<span>${escapeHtml(marker.name)}</span></span>`).join('')}${!map.image&&!map.markers.length?'<p class="map-empty">Start with a floor plan or place your first marker.</p>':''}</div><p class="field-help">${map.markers.filter(marker=>marker.enabled).length} enabled markers · ${map.enabled?'Map shared on your local network':'Map disabled'}</p></div></section>`;
  },
  async image(id) {
    if(this.images.has(id))return this.images.get(id);
    if(this.loading.has(id))return this.loading.get(id);
    const promise=(async()=>{
      const response=await fetch('/api/home-map/image/'+id,{cache:'no-store',headers:{'X-Localserve-Token':csrfToken}});
      if(!response.ok)throw Error('Floor plan unavailable. Upload the image again.');
      const value=await this.dataUrl(await response.blob());this.images.set(id,value);
      while(this.images.size>3)this.images.delete(this.images.keys().next().value);return value;
    })().finally(()=>this.loading.delete(id));
    this.loading.set(id,promise);return promise;
  },
  preview() {
    for(const image of workspace.querySelectorAll('[data-map-image]')){
      const id=image.dataset.mapImage;if(image.hasAttribute('src'))continue;
      this.image(id).then(src=>{if(image.isConnected&&image.dataset.mapImage===id)image.src=src;}).catch(()=>{if(image.isConnected)image.alt='Floor plan unavailable. Upload the image again.';});
    }
  },
  dataUrl(blob) { return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Unable to read image.'));reader.readAsDataURL(blob);}); },
  async open() {
    if(this.pending||dialog.open)return;
    this.pending=true;
    try{const catalogue=await request('/api/home-map/catalogue');if(dialog.open||currentView!=='home-map')return;
      this.catalogue=catalogue;this.draft=structuredClone(state.homeMap);this.selected=null;
      showDialog(`<form id="home-map-form">${dialogHeader('Edit home map')}<div class="dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div><div class="field-row">${formField('Name','tag',`<input name="mapName" value="${escapeHtml(this.draft.name)}" required maxlength="64">`)}<div class="card-option"><span>Share map</span><button type="button" class="switch" role="switch" aria-label="Share map" aria-checked="${this.draft.enabled}" data-action="map-draft-enabled"></button></div></div><p class="field-help">Choose a target, add a marker, then drag it to its location. Arrow keys move a focused marker by 1%; hold Shift for 5%. Coordinates follow the image when the window changes size.</p><div class="home-map-editor"><section class="map-layout-column"><div class="map-toolbar"><label class="button map-upload">${icon('upload')}Upload floor plan<input type="file" accept="image/png,image/jpeg,image/webp" data-map-upload></label><button type="button" class="button" data-action="map-image-remove">${icon('xmark')}Blank canvas</button></div><p class="field-help" data-upload-status>PNG, JPEG or WebP. Images stay private to this installation.</p><div class="home-map-stage" data-map-stage></div></section><aside class="map-inspector"><h3>Markers</h3>${formField('Find a target','magnifying-glass','<input type="search" data-map-search placeholder="Light, scene, Task or Card">')}${formField('Shared target','my-location','<select data-map-target aria-label="Shared target"></select>')}<button type="button" class="button" data-action="map-marker-add">${icon('plus')}Add marker</button><p class="field-help">Missing something? Enable its remote or publish the Task in Controller setup. Cards come from enabled plugins.</p><div data-map-list class="map-marker-list"></div><div data-map-inspector></div></aside></div></div>${dialogFooter('Save layout')}</form>`,{kind:'home-map'});
      this.context=dialogContext;this.paintStage();this.paintList();this.paintTargets();this.bind();
      initialFormValues=serializeForm(dialog.querySelector('form'));
    }catch(error){notify(error.message);}finally{this.pending=false;}
  },
  valid() { return dialog.open&&dialogContext===this.context; },
  readDraft() {
    const result=structuredClone(this.draft),form=dialog.querySelector('#home-map-form');
    if(form)result.name=form.elements.mapName.value.trim();return result;
  },
  paintTargets() {
    const select=dialog.querySelector('[data-map-target]'),search=dialog.querySelector('[data-map-search]').value.trim().toLowerCase(),old=select.value;
    select.replaceChildren(new Option('Choose a shared target',''));
    this.catalogue.forEach((entry,index)=>{if((entry.name+' '+entry.group+' '+entry.target.kind).toLowerCase().includes(search))select.add(new Option(entry.name+' · '+entry.group+' · '+entry.target.kind,String(index)));});
    if([...select.options].some(option=>option.value===old))select.value=old;
    dialog.querySelector('[data-action="map-marker-add"]').disabled=!select.value||this.draft.markers.length>=128;
  },
  paintStage() {
    const host=dialog.querySelector('[data-map-stage]'),image=this.draft.image;
    host.style.aspectRatio=image?image.width+'/'+image.height:'16/10';
    const existing=host.querySelector('img');
    if(!image)existing?.remove();
    else if(existing?.dataset.image!==image.id){
      existing?.remove();const node=document.createElement('img');node.alt='Floor plan';node.dataset.image=image.id;node.draggable=false;host.prepend(node);
      this.image(image.id).then(src=>{if(this.valid()&&node.isConnected)node.src=src;}).catch(error=>{if(this.valid())this.error(error.message);});
    }
    const nodes=new Map([...host.querySelectorAll('button[data-marker]')].map(node=>[node.dataset.marker,node]));
    for(const [id,node]of nodes)if(!this.draft.markers.some(marker=>marker.id===id))node.remove();
    for(const marker of this.draft.markers){let node=nodes.get(marker.id);
      if(!node){node=document.createElement('button');node.type='button';node.className='map-marker';node.dataset.marker=marker.id;host.append(node);}
      node.style.left=marker.x+'%';node.style.top=marker.y+'%';node.classList.toggle('is-disabled',!marker.enabled);node.classList.toggle('is-selected',this.selected===marker.id);
      node.setAttribute('aria-label',marker.name+'; use arrow keys to position');node.setAttribute('aria-pressed',String(this.selected===marker.id));
      node.innerHTML=icon(marker.icon)+'<span>'+escapeHtml(marker.name)+'</span>';
    }
  },
  paintList() {
    const host=dialog.querySelector('[data-map-list]');
    host.innerHTML=this.draft.markers.map(marker=>`<div class="map-marker-row ${this.selected===marker.id?'selected':''}"><button type="button" class="text-button" data-action="map-marker-select" data-id="${marker.id}">${icon(marker.icon)}${escapeHtml(marker.name)}</button><div class="row-actions"><button type="button" class="icon-button" data-action="map-marker-copy" data-id="${marker.id}" aria-label="Copy ${escapeHtml(marker.name)}">${icon('copy')}</button><button type="button" class="icon-button delete" data-action="map-marker-delete" data-id="${marker.id}" aria-label="Delete ${escapeHtml(marker.name)}">${icon('trash-can')}</button><button type="button" class="switch" role="switch" aria-label="${escapeHtml(marker.name)} enabled" aria-checked="${marker.enabled}" data-action="map-marker-enabled" data-id="${marker.id}"></button></div></div>`).join('')||'<p class="field-help">No markers yet.</p>';
    this.paintInspector();
  },
  paintInspector() {
    const host=dialog.querySelector('[data-map-inspector]'),marker=this.draft.markers.find(marker=>marker.id===this.selected);
    if(!marker){host.innerHTML='<p class="field-help">Select a marker to edit its label, glyph and position.</p>';return;}
    const target=this.catalogue.find(entry=>JSON.stringify(entry.target)===JSON.stringify(marker.target));
    host.innerHTML=`<h3>Edit marker</h3><p class="field-help">${escapeHtml(target?target.name+' · '+target.group:'Target no longer shared. Replace this marker to choose another.')}</p>${formField('Label','tag',`<input data-map-property="name" maxlength="64" required value="${escapeHtml(marker.name)}">`)}<details class="scene-glyph-picker"><summary>${icon(marker.icon)} Marker symbol</summary>${formField('Find a symbol','magnifying-glass','<input type="search" data-map-symbol-search placeholder="Search symbols">')}<div class="glyph-grid scene-glyph-choices" data-map-symbols aria-label="Marker symbols"></div></details><div class="field-row">${['x','y'].map(key=>formField(key.toUpperCase()+' (%)','open-with',`<input type="number" data-map-property="${key}" min="0" max="100" step="0.1" required value="${marker[key]}">`)).join('')}</div>`;
    this.paintSymbols();
  },
  paintSymbols() {
    const search=dialog.querySelector('[data-map-symbol-search]'),host=dialog.querySelector('[data-map-symbols]'),marker=this.draft.markers.find(marker=>marker.id===this.selected);if(!search||!host||!marker)return;
    const query=search.value.trim().toLowerCase(),symbols=[marker.icon,...state.pluginGlyphs.filter(glyph=>glyph!==marker.icon&&(!query||glyph.includes(query)))].filter(glyph=>!query||glyph.includes(query)).slice(0,80);
    host.innerHTML=symbols.map(glyph=>`<button type="button" class="glyph-choice" data-action="map-marker-glyph" data-glyph="${glyph}" aria-label="${glyph}" aria-pressed="${marker.icon===glyph}" title="${glyph}">${icon(glyph)}</button>`).join('')||'<p class="field-help">No matching symbols.</p>';
  },
  error(message) { const node=dialog.querySelector('#form-error');if(node){node.hidden=false;node.textContent=message;} },
  bind() {
    const form=dialog.querySelector('form'),host=form.querySelector('[data-map-stage]');
    form.addEventListener('input',event=>{
      if(event.target.matches('[data-map-search]'))this.paintTargets();
      if(event.target.matches('[data-map-symbol-search]'))this.paintSymbols();
      const key=event.target.dataset.mapProperty,marker=this.draft.markers.find(marker=>marker.id===this.selected);
      if(key&&marker){const value=['x','y'].includes(key)?Number(event.target.value):event.target.value;if(['x','y'].includes(key)&&(!Number.isFinite(value)||value<0||value>100))return;marker[key]=value;this.paintStage();}
    });
    form.addEventListener('change',event=>{
      if(event.target.matches('[data-map-target]'))this.paintTargets();
      if(event.target.matches('[data-map-property]'))this.paintList();
      if(event.target.matches('[data-map-upload]'))void this.upload(event.target.files[0],event.target);
    });
    let drag=null;
    host.addEventListener('pointerdown',event=>{
      const button=event.target.closest('[data-marker]');if(!button||event.button!==0)return;
      const marker=this.draft.markers.find(marker=>marker.id===button.dataset.marker);this.selected=marker.id;this.paintList();this.paintStage();
      drag={id:marker.id,pointer:event.pointerId,x:event.clientX,y:event.clientY,originX:marker.x,originY:marker.y};button.setPointerCapture(event.pointerId);event.preventDefault();button.focus({preventScroll:true});
    });
    host.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.pointer)return;const bounds=host.getBoundingClientRect(),marker=this.draft.markers.find(marker=>marker.id===drag.id);if(!marker)return;
      marker.x=Math.round(Math.max(0,Math.min(100,drag.originX+(event.clientX-drag.x)/bounds.width*100))*10)/10;
      marker.y=Math.round(Math.max(0,Math.min(100,drag.originY+(event.clientY-drag.y)/bounds.height*100))*10)/10;this.paintStage();
    });
    const finish=()=>{if(drag){drag=null;this.paintInspector();updateDraftStatus();}};
    host.addEventListener('pointerup',finish);host.addEventListener('pointercancel',finish);
    host.addEventListener('keydown',event=>{const button=event.target.closest('[data-marker]');if(!button||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();const marker=this.draft.markers.find(marker=>marker.id===button.dataset.marker),step=event.shiftKey?5:1;this.selected=marker.id;
      const axis=['ArrowLeft','ArrowRight'].includes(event.key)?'x':'y',direction=['ArrowLeft','ArrowUp'].includes(event.key)?-1:1;
      marker[axis]=Math.max(0,Math.min(100,Math.round((marker[axis]+direction*step)*10)/10));this.paintStage();this.paintList();updateDraftStatus();
    });
  },
  async upload(file,input) {
    if(!file||this.uploading)return;const context=this.context,status=dialog.querySelector('[data-upload-status]');
    this.uploading=true;input.disabled=true;dialog.querySelector('[data-action="map-image-remove"]').disabled=true;dialog.querySelector('[type="submit"]').disabled=true;status.textContent='Preparing floor plan…';
    try{
      if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>12*1024*1024)throw Error('Choose a PNG, JPEG or WebP image smaller than 12 MiB.');
      const source=await this.dataUrl(file),image=new Image();image.src=source;await image.decode();
      if(!image.naturalWidth||!image.naturalHeight)throw Error('Image cannot be read.');
      const scale=Math.min(1,4096/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob||blob.size>6*1024*1024)throw Error('Converted image is too large. Choose a smaller image.');
      if(!this.valid()||context!==this.context)return;
      const response=await fetch('/api/home-map/upload',{method:'POST',headers:{'Content-Type':'image/png','X-Localserve-Token':csrfToken,'X-Home-Map-Revision':String(this.draft.revision)},body:blob});
      const metadata=await response.json();if(!response.ok)throw Error(metadata.error||'Upload failed.');
      if(!this.valid()||context!==this.context)return;
      this.images.set(metadata.id,await this.dataUrl(blob));this.draft.image=metadata;this.paintStage();status.textContent='Floor plan ready. Save layout to apply it.';updateDraftStatus();
    }catch(error){if(this.valid()&&context===this.context){status.textContent='Floor plan was not changed.';this.error(error.message);}}
    finally{this.uploading=false;if(this.valid()&&context===this.context){input.disabled=false;input.value='';dialog.querySelector('[data-action="map-image-remove"]').disabled=false;dialog.querySelector('[type="submit"]').disabled=false;}}
  },
  async handle(action,control) {
    if(action==='map-edit')return this.open();
    if(action==='map-enabled')return mutate('/api/home-map/settings',{...state.homeMap,enabled:!state.homeMap.enabled});
    if(!this.valid())return;
    if(action==='map-draft-enabled'){this.draft.enabled=!this.draft.enabled;control.setAttribute('aria-checked',String(this.draft.enabled));}
    if(action==='map-image-remove'){this.draft.image=null;this.paintStage();}
    if(action==='map-marker-glyph'){const selected=this.draft.markers.find(marker=>marker.id===this.selected);if(selected)selected.icon=control.dataset.glyph;}
    const marker=this.draft.markers.find(marker=>marker.id===control.dataset.id);
    if(action==='map-marker-add'){
      const selection=dialog.querySelector('[data-map-target]').value,entry=selection!==''?this.catalogue[Number(selection)]:null;
      if(!entry||this.draft.markers.length>=128)return;
      const positions=[[50,50],[60,50],[40,50],[50,60],[50,40],[60,60],[40,40],[60,40],[40,60]],position=positions.find(([x,y])=>!this.draft.markers.some(marker=>Math.abs(marker.x-x)<8&&Math.abs(marker.y-y)<8))||[50,50];
      const item={id:crypto.randomUUID(),name:entry.name.slice(0,64),icon:entry.icon,enabled:true,x:position[0],y:position[1],target:structuredClone(entry.target)};
      this.draft.markers.push(item);this.selected=item.id;
    }
    if(marker&&action==='map-marker-select')this.selected=marker.id;
    if(marker&&action==='map-marker-enabled')marker.enabled=!marker.enabled;
    if(marker&&action==='map-marker-delete'){this.draft.markers=this.draft.markers.filter(item=>item.id!==marker.id);this.selected=null;}
    if(marker&&action==='map-marker-copy'&&this.draft.markers.length<128){const copy={...structuredClone(marker),id:crypto.randomUUID(),name:(marker.name+' copy').slice(0,64),enabled:false,x:Math.min(100,marker.x+3),y:Math.min(100,marker.y+3)};this.draft.markers.push(copy);this.selected=copy.id;}
    this.paintStage();this.paintList();this.paintTargets();updateDraftStatus();
  },
  async submit() {
    if(this.pending||this.uploading)return;this.pending=true;
    const button=dialog.querySelector('[type="submit"]');button.disabled=true;
    try{await mutate('/api/home-map/settings',this.readDraft());closeDialog();renderView();notify('Home map saved');}
    catch(error){this.error(error.message);}finally{this.pending=false;if(button.isConnected)button.disabled=false;}
  },
};
