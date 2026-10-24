/** Mobile lighting presentation. Commands still use the shared page capability,
 * durable claims and serial runner. Polls hydrate readings without resetting a
 * slider, colour choice or an open scene draft. No commands run on input/drag. */
'use strict';
const LightingControls = {
  tab: 'devices', query: '', selected: null, dialogMode: null, draftBaseline: '', pending: false,
  escape: ControlsRenderer.escape.bind(ControlsRenderer),
  icon: ControlsRenderer.icon.bind(ControlsRenderer),
  mount(host, snapshot, client) {
    this.host = host; this.snapshot = snapshot; this.client = client;
    const model = snapshot.lighting;
    const signature = JSON.stringify([snapshot.page.id, snapshot.page.revision, this.tab,
      model.lights.map(light => [light.id, light.name, light.room, light.spectrum]), model.groups.map(group => [group.id, group.name])]);
    if (host.dataset.lightingSignature !== signature) {
      host.innerHTML = this.render(); host.dataset.lightingSignature = signature;
      this.bindBoard();
    }
    const knownOn = model.lights.filter(light => light.on === true).length;
    const unknown = model.lights.filter(light => light.on === null).length;
    host.querySelector('[data-lighting-summary]').textContent = `${knownOn} ${knownOn === 1 ? 'light' : 'lights'} on${unknown ? ` · ${unknown} unknown` : ''}`;
    host.querySelector('[data-lighting-received]').textContent = this.reception(model.receivedAt);
    const disabled = !snapshot.available || snapshot.busy || this.pending;
    for (const button of host.querySelectorAll('[data-scene-operation], [data-new-scene]')) button.disabled = disabled;
    for (const scope of [host, this.dialogMode === 'light' ? document.querySelector('#lighting-editor') : null].filter(Boolean)) this.hydrate(scope, disabled);
    this.filter();
    if (this.dialogMode === 'light') {
      const current = this.currentTarget();
      const state = document.querySelector('#lighting-editor [data-detail-state]');
      if (state) state.textContent = current ? this.stateText(current) : 'Light unavailable';
    }
  },
  reception(at) {
    if (!Number.isFinite(at)) return 'No reported reading';
    const age = Date.now() - at;
    const time = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: this.snapshot.options.timeFormat === '12' });
    return `Last reported ${time}${age > 120000 ? ` · ${Math.floor(age / 60000)} min ago` : ''}`;
  },
  stateText(target) {
    if (target.reachable === false) return 'Unreachable';
    const state = target.on === null ? 'Power unknown' : target.on ? 'On' : 'Off';
    return state + (target.reachable === null ? ' · Reachability unknown' : '');
  },
  render() {
    const e = this.escape, model = this.snapshot.lighting;
    return `<div class="lighting-shell">
      <section class="lighting-hero"><div><p class="lighting-eyebrow">${e(this.snapshot.page.pluginName)}</p><h2>Your lighting</h2><p class="lighting-summary" data-lighting-summary></p><p class="lighting-reception" data-lighting-received></p></div><div class="lighting-hero-art" aria-hidden="true"><span class="lamp-glow"></span>${this.icon('lightbulb')}<span class="lamp-orbit"></span></div></section>
      <div class="lighting-toolbar"><nav class="lighting-tabs" aria-label="Lighting views">${[['devices','Devices',model.lights.length],['groups','Groups',model.groups.length],['scenes','Scenes',model.scenes.length]].map(([id,label,count]) => `<button type="button" data-lighting-tab="${id}" aria-current="${this.tab === id ? 'page' : 'false'}">${label}<span>${count}</span></button>`).join('')}</nav><button type="button" class="button lighting-capture" data-new-scene aria-label="Save as scene" title="Save as scene">${this.icon('plus')}<span>Save as scene</span></button></div>
      <div class="lighting-list-heading"><div><h3>${this.tab === 'devices' ? 'Devices' : this.tab === 'groups' ? 'Groups' : 'Scenes'}</h3><span>${this.tab === 'scenes' ? 'Saved lighting settings' : 'Select a light or group to adjust it'}</span></div><button type="button" class="lighting-icon-button" data-control-item="remote-refresh" aria-label="Refresh lighting" title="Refresh lighting">${this.icon('rotate')}</button></div>
      ${this.tab !== 'scenes' ? `<label class="lighting-search">${this.icon('magnifying-glass')}<input type="search" aria-label="Search lighting" placeholder="Find a ${this.tab === 'groups' ? 'group' : 'light'}" value="${e(this.query)}"></label>` : ''}
      <div class="lighting-grid">${this.tab === 'scenes' ? model.scenes.map(scene => this.sceneCard(scene)).join('') : (this.tab === 'groups' ? model.groups : model.lights).map(target => this.targetCard(target, this.tab === 'groups' ? 'group' : 'light')).join('')}</div>
      <p class="lighting-empty" ${this.tab === 'scenes' ? model.scenes.length ? 'hidden' : '' : (this.tab === 'groups' ? model.groups : model.lights).length ? 'hidden' : ''}>${this.tab === 'scenes' ? 'No scenes yet. Save the current lighting to create one.' : 'No reported lighting available. Refresh lighting when the gateway is ready.'}</p>
      <p class="lighting-footnote">${this.tab === 'scenes' ? 'Scenes run in order. Schedules and automation are managed in Tasks.' : 'Controls show the last reported state. Changes are confirmed by the next gateway reading.'}</p></div>`;
  },
  targetCard(target, type) {
    const e = this.escape;
    return `<section class="lighting-card" data-lighting-target="${type}-${e(target.id)}" data-search="${e((target.name + ' ' + (target.room || '')).toLowerCase())}">
      <div class="lighting-card-top"><button type="button" class="lighting-open" data-lighting-detail="${e(target.id)}" data-target-type="${type}"><span class="lighting-bulb" data-bulb>${this.icon(type === 'group' ? 'layer-group' : 'lightbulb')}</span><span><strong>${e(target.name)}</strong><small>${e(type === 'group' ? `${target.count ?? 'Unknown'} devices` : target.room || 'Ungrouped')}</small></span></button>${this.input(target.controls.power, 'power', target.name)}</div>
      <p class="lighting-state" data-target-state>${e(this.stateText(target))}</p>
      ${this.input(target.controls.brightness, 'brightness', target.name)}
      <div class="lighting-card-bottom"><span data-target-capability>${type === 'group' ? 'Group lighting' : target.spectrum === 'rgb' ? 'Colour' : target.spectrum === 'white' ? 'White spectrum' : 'Dimmable'}</span><button type="button" data-lighting-detail="${e(target.id)}" data-target-type="${type}">Adjust ${this.icon('arrow-right')}</button></div></section>`;
  },
  input(id, property, name, detail = false) {
    const e = this.escape, item = this.snapshot.page.items.find(item => item.id === id);
    if (!item) return '';
    const value = item.reported, inputId = 'lighting-input-' + id + (detail ? '-detail' : '');
    if (property === 'power') return `<label class="lighting-power control-target" for="${inputId}"><input id="${inputId}" class="switch" role="switch" type="checkbox" data-control-input="${e(id)}" aria-label="${e(name)} power" ${value === true ? 'checked' : ''}><output class="sr-only">${value === true ? 'On' : 'Off'}</output></label>`;
    if (property === 'color') return `<label class="lighting-color-picker control-target" for="${inputId}"><span>Choose colour</span><input id="${inputId}" type="color" value="${/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#ffffff'}" data-control-input="${e(id)}" aria-label="${e(name)} colour"><output>${e(value || 'No data')}</output></label>`;
    return `<label class="lighting-range control-target ${property === 'temperature' ? 'lighting-temperature' : ''}" for="${inputId}"><span>${this.icon(property === 'temperature' ? 'temperature-half' : 'sun')}<span>${property === 'temperature' ? 'White temperature' : 'Brightness'}</span><output>${e(value ?? 'No data')}</output><span class="lighting-percent">%</span></span><input id="${inputId}" type="range" min="0" max="100" step="1" value="${Number.isFinite(value) ? value : 0}" data-control-input="${e(id)}" aria-label="${e(name)} ${property}"><small data-reported-for="${e(id)}">Reported: ${e(value === null ? 'No data' : value + '%')}</small></label>`;
  },
  sceneCard(scene) {
    const e = this.escape;
    return `<section class="lighting-scene ${scene.enabled ? '' : 'scene-disabled'}"><div class="lighting-scene-symbol">${this.icon(scene.icon || 'lightbulb')}</div><div class="lighting-scene-heading"><h4>${e(scene.label)}</h4><p>${scene.steps} ${scene.steps === 1 ? 'step' : 'steps'} · ${scene.enabled ? scene.available ? 'Ready' : 'Unavailable' : 'Disabled'}</p></div><button type="button" class="button lighting-scene-run" data-control-item="${e(scene.id)}" ${!scene.enabled || !scene.available ? 'disabled' : ''}>${this.icon('play')}Apply scene</button><div class="lighting-scene-actions"><button type="button" data-scene-operation="edit" data-scene-id="${e(scene.id)}">${this.icon('pen')}Edit</button><button type="button" data-scene-operation="copy" data-scene-id="${e(scene.id)}">${this.icon('copy')}Copy</button><button type="button" data-scene-operation="delete" data-scene-id="${e(scene.id)}">${this.icon('trash-can')}Delete</button><label><span class="sr-only">${e(scene.label)} enabled</span><input class="switch" role="switch" type="checkbox" aria-label="${e(scene.label)} enabled" data-scene-enabled="${e(scene.id)}" ${scene.enabled ? 'checked' : ''}></label></div></section>`;
  },
  hydrate(scope, disabled) {
    for (const element of scope.querySelectorAll('[data-control-input]')) {
      const item = this.snapshot.page.items.find(item => item.id === element.dataset.controlInput);
      element.disabled = disabled || !item?.available;
      if (!item) continue;
      if (element !== document.activeElement && element.dataset.changed !== 'true' && item.reported !== null) {
        if (element.type === 'checkbox') element.checked = item.reported === true;
        else element.value = String(item.reported);
      }
      ControlsRenderer.updateInput(element);
      // Unknown is textual even when a native slider needs a numeric thumb.
      if (item.reported === null && element.dataset.changed !== 'true') element.closest('.control-target').querySelector('output').textContent = 'No data';
    }
    for (const button of scope.querySelectorAll('[data-control-item]')) {
      const item = this.snapshot.page.items.find(item => item.id === button.dataset.controlItem);
      button.disabled = disabled || !item?.available;
    }
    const wheel = scope.querySelector('.lighting-colour-wheel');
    if (wheel) {
      const input = scope.querySelector('input[type="color"]');
      wheel.setAttribute('aria-disabled', String(input.disabled));
      wheel.tabIndex = input.disabled ? -1 : 0;
    }
    for (const toggle of scope.querySelectorAll('[data-scene-enabled]')) toggle.disabled = disabled;
    for (const label of scope.querySelectorAll('[data-reported-for]')) {
      const item = this.snapshot.page.items.find(item => item.id === label.dataset.reportedFor);
      label.textContent = `Reported: ${item?.reported === null || !item ? 'No data' : item.reported + '%'}`;
    }
    for (const card of scope.querySelectorAll('[data-lighting-target]')) {
      const target = [...this.snapshot.lighting.lights.map(light => ({ ...light, key: 'light-' + light.id })), ...this.snapshot.lighting.groups.map(group => ({ ...group, key: 'group-' + group.id }))].find(target => target.key === card.dataset.lightingTarget);
      if (!target) continue;
      card.querySelector('[data-target-state]').textContent = this.stateText(target);
      card.dataset.on = target.on === true ? 'true' : 'false';
      card.dataset.unreachable = target.reachable === false ? 'true' : 'false';
      const color = /^#[0-9a-f]{6}$/i.test(target.color || '') ? target.color : '#e9d8a8';
      card.querySelector('[data-bulb]').style.setProperty('--bulb-color', color);
    }
  },
  filter() {
    for (const card of this.host.querySelectorAll('[data-search]')) card.hidden = !card.dataset.search.includes(this.query.toLowerCase().trim());
  },
  bindBoard() {
    this.host.querySelectorAll('[data-lighting-tab]').forEach(button => button.addEventListener('click', () => {
      this.tab = button.dataset.lightingTab; this.query = ''; this.mount(this.host, this.snapshot, this.client);
    }));
    this.host.querySelector('[aria-label="Search lighting"]')?.addEventListener('input', event => { this.query = event.target.value; this.filter(); });
    this.host.querySelector('[data-new-scene]').addEventListener('click', event => this.openScene('capture', null, event.currentTarget));
    this.host.querySelectorAll('[data-lighting-detail]').forEach(button => button.addEventListener('click', () => this.openLight(button.dataset.targetType, button.dataset.lightingDetail, button)));
    this.host.querySelectorAll('[data-scene-operation]').forEach(button => button.addEventListener('click', () => this.openScene(button.dataset.sceneOperation, button.dataset.sceneId, button)));
    this.host.querySelectorAll('[data-scene-enabled]').forEach(input => input.addEventListener('change', () => this.changeScene({ action: 'enabled', itemId: input.dataset.sceneEnabled, enabled: input.checked })));
  },
  currentTarget() { return this.snapshot.lighting[this.selected?.type === 'group' ? 'groups' : 'lights'].find(target => target.id === this.selected?.id); },
  openLight(type, id, opener) {
    this.selected = { type, id }; this.dialogMode = 'light'; this.opener = opener;
    const target = this.currentTarget(), dialog = document.querySelector('#lighting-editor'), e = this.escape;
    if (!target) return;
    dialog.className = 'lighting-dialog lighting-detail';
    dialog.innerHTML = `<div class="lighting-dialog-header"><button type="button" class="lighting-icon-button" data-lighting-close aria-label="Back to lighting">${this.icon('arrow-left')}</button><div><h2 id="lighting-editor-title">${e(target.name)}</h2><p data-detail-state>${e(this.stateText(target))}</p></div>${this.input(target.controls.power, 'power', target.name, true)}</div><div class="lighting-dialog-body">${target.spectrum === 'rgb' ? `<div class="lighting-colour-wheel" role="slider" tabindex="0" aria-label="${e(target.name)} colour hue" aria-valuemin="0" aria-valuemax="359" aria-valuenow="${Math.round(target.hue || 0)}" style="--hue:${Number(target.hue) || 0}deg"><div>${this.icon('palette')}<span>Colour</span></div><span class="lighting-wheel-thumb" aria-hidden="true"></span></div>${this.input(target.controls.color, 'color', target.name, true)}` : `<div class="lighting-white-orb">${this.icon(type === 'group' ? 'layer-group' : 'lightbulb')}</div>`}${this.input(target.controls.brightness, 'brightness', target.name, true)}${target.controls.temperature ? `<div class="lighting-white-labels"><span>Cool white</span><span>Warm white</span></div>${this.input(target.controls.temperature, 'temperature', target.name, true)}` : ''}<p class="lighting-footnote">Commands are sent once. Reported readings confirm the light’s state.</p></div>`;
    dialog.querySelector('[data-lighting-close]').onclick = () => this.closeDialog();
    dialog.oncancel = event => { event.preventDefault(); this.closeDialog(); };
    dialog.oninput = event => {
      if (!event.target.matches('[data-control-input]')) return;
      event.target.dataset.changed = 'true'; ControlsRenderer.updateInput(event.target);
    };
    dialog.onchange = event => { if (event.target.matches('[data-control-input]') && !event.target.disabled) void this.client.invoke(event.target.dataset.controlInput, event.target); };
    this.bindColourWheel(dialog);
    this.hydrate(dialog, !this.snapshot.available || this.snapshot.busy);
    dialog.showModal();
  },
  bindColourWheel(dialog) {
    const wheel = dialog.querySelector('.lighting-colour-wheel'), input = dialog.querySelector('input[type="color"]');
    if (!wheel || !input) return;
    let dragging = false, hue = Number(wheel.getAttribute('aria-valuenow'));
    function choose(value) {
      hue = (Math.round(value) + 360) % 360;
      const section = hue / 60, x = 1 - Math.abs(section % 2 - 1);
      const rgb = section < 1 ? [1,x,0] : section < 2 ? [x,1,0] : section < 3 ? [0,1,x] : section < 4 ? [0,x,1] : section < 5 ? [x,0,1] : [1,0,x];
      input.value = '#' + rgb.map(value => Math.round(value * 255).toString(16).padStart(2,'0')).join('');
      input.dataset.changed = 'true'; ControlsRenderer.updateInput(input);
      wheel.style.setProperty('--hue', hue + 'deg'); wheel.setAttribute('aria-valuenow', String(hue));
    }
    function point(event) {
      const bounds = wheel.getBoundingClientRect(), x = event.clientX - bounds.left - bounds.width / 2, y = event.clientY - bounds.top - bounds.height / 2;
      choose(Math.atan2(x, -y) * 180 / Math.PI);
    }
    wheel.onpointerdown = event => {
      if (input.disabled || event.button !== 0) return;
      dragging = true; wheel.setPointerCapture(event.pointerId); point(event); event.preventDefault();
    };
    wheel.onpointermove = event => { if (dragging) point(event); };
    wheel.onpointerup = event => {
      if (!dragging) return;
      dragging = false; wheel.releasePointerCapture(event.pointerId);
      // Drag updates only the local colour target. One release sends one action;
      // lost/cancelled pointer sequences never cause a command or an auto retry.
      if (!input.disabled) void this.client.invoke(input.dataset.controlInput, input);
    };
    wheel.onpointercancel = () => { dragging = false; };
    wheel.onkeydown = event => {
      const change = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -15, PageUp: 15 }[event.key];
      if (input.disabled || change === undefined) return;
      event.preventDefault(); choose(hue + change);
    };
    wheel.onkeyup = event => {
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageDown','PageUp'].includes(event.key) && !input.disabled) void this.client.invoke(input.dataset.controlInput, input);
    };
  },
  openScene(action, id, opener) {
    const scene = this.snapshot.lighting.scenes.find(scene => scene.id === id), e = this.escape;
    this.dialogMode = 'scene'; this.opener = opener;
    this.sceneRevision = this.snapshot.page.revision; this.sceneToken = this.snapshot.token;
    const dialog = document.querySelector('#lighting-editor'); dialog.className = 'lighting-dialog';
    const name = action === 'copy' ? `${scene.label.slice(0, 59)} copy` : scene?.label || '';
    dialog.innerHTML = `<form id="lighting-scene-form"><div class="lighting-dialog-header"><h2 id="lighting-editor-title">${action === 'capture' ? 'Save lighting as scene' : action === 'edit' ? 'Edit scene' : action === 'copy' ? 'Copy scene' : 'Delete scene'}</h2><button type="button" class="lighting-icon-button" data-lighting-close aria-label="Close scene editor">${this.icon('xmark')}</button></div><div class="lighting-dialog-body"><p class="lighting-form-error" role="alert" hidden></p>${action === 'delete' ? `<p>Delete ${e(scene.label)}?</p>` : `<label class="lighting-field">Scene name<input name="name" maxlength="64" required value="${e(name)}" autocomplete="off"></label>`}${['capture','edit'].includes(action) ? `${action === 'edit' ? '<label class="lighting-recapture"><input name="recapture" type="checkbox" class="switch" role="switch">Replace settings with current lighting</label>' : ''}<fieldset class="lighting-capture-list" ${action === 'edit' ? 'hidden' : ''}><legend>Lights to capture</legend><p>Captures reported settings. Saving does not change any lights. New scenes start disabled.</p>${this.snapshot.lighting.lights.map(light => `<label><input name="lightIds" type="checkbox" value="${e(light.id)}" ${light.capturable ? 'checked' : 'disabled'}><span><strong>${e(light.name)}</strong><small>${light.capturable ? `${light.on ? 'On' : 'Off'} · ${light.brightness}%` : 'Incomplete or unreachable reading'}</small></span></label>`).join('') || '<p>No complete lighting readings available.</p>'}</fieldset>` : ''}</div><div class="lighting-dialog-footer"><button type="button" class="button" data-lighting-close>Cancel</button><button type="submit" class="button ${action === 'delete' ? 'danger' : 'primary'}">${action === 'delete' ? 'Delete' : action === 'copy' ? 'Copy scene' : 'Save scene'}</button></div></form>`;
    const form = dialog.querySelector('form');
    if(action!=='delete'){
      const picker=document.createElement('details');picker.className='lighting-glyph-picker';
      picker.innerHTML=`<summary><span data-selected-glyph></span>Scene glyph</summary><input type="hidden" name="icon" value="${e(scene?.icon||'lightbulb')}"><input type="search" aria-label="Find scene glyph" placeholder="Find a glyph"><div class="lighting-glyph-grid" role="group" aria-label="Scene glyphs"></div><p class="lighting-glyph-count"></p>`;
      form.querySelector('.lighting-field').after(picker);
      const selection=picker.querySelector('[name="icon"]'),search=picker.querySelector('[type="search"]');
      const paint=()=>{
        picker.querySelector('[data-selected-glyph]').innerHTML=this.icon(selection.value);
        const matches=(this.snapshot.lighting.glyphs||[selection.value]).filter(id=>id.replaceAll('-',' ').includes(search.value.trim().toLowerCase().replaceAll('-',' ')));
        const grid=picker.querySelector('.lighting-glyph-grid');grid.innerHTML=matches.slice(0,96).map(id=>`<button type="button" data-glyph="${e(id)}" title="${e(id.replaceAll('-',' '))}" aria-label="${e(id.replaceAll('-',' '))}" aria-pressed="${id===selection.value}">${this.icon(id)}</button>`).join('');
        picker.querySelector('.lighting-glyph-count').textContent=matches.length>96?`Showing 96 of ${matches.length}. Type to narrow the choices.`:matches.length?'':'No matching glyphs.';
        grid.onclick=event=>{const button=event.target.closest('[data-glyph]');if(!button)return;selection.value=button.dataset.glyph;picker.querySelector('[data-selected-glyph]').innerHTML=this.icon(selection.value);grid.querySelectorAll('button').forEach(node=>node.setAttribute('aria-pressed',String(node===button)));};
      };search.oninput=paint;paint();
    }
    this.draftBaseline = this.serialize(form);
    dialog.querySelectorAll('[data-lighting-close]').forEach(button => { button.onclick = () => this.closeDialog(); });
    dialog.oncancel = event => { event.preventDefault(); this.closeDialog(); };
    dialog.oninput = null;
    dialog.onchange = event => { if (event.target.name === 'recapture') dialog.querySelector('fieldset').hidden = !event.target.checked; };
    form.onsubmit = async event => {
      event.preventDefault();
      const values = { action, ...(id ? { itemId: id } : {}) };
      if (action !== 'delete') {values.name = form.elements.name.value;values.icon=form.elements.icon.value;}
      if (action === 'capture' || form.elements.recapture?.checked) values.lightIds = [...form.querySelectorAll('[name="lightIds"]:checked')].map(input => input.value);
      await this.changeScene(values, { revision: this.sceneRevision, token: this.sceneToken, dialog });
    };
    dialog.showModal();
    if (action !== 'delete') form.elements.name.focus();
  },
  serialize(form) { return JSON.stringify([...new FormData(form).entries()]); },
  closeDialog(force = false) {
    if (this.pending) return;
    const dialog = document.querySelector('#lighting-editor'), form = dialog.querySelector('form');
    if (!force && this.dialogMode === 'scene' && form && this.serialize(form) !== this.draftBaseline) {
      const confirm = document.querySelector('#lighting-confirm');
      confirm.innerHTML = '<h2 id="lighting-confirm-title">Discard unsaved changes?</h2><p>Your scene changes have not been saved.</p><div><button type="button" class="button" data-keep autofocus>Keep editing</button><button type="button" class="button danger" data-discard>Discard changes</button></div>';
      confirm.querySelector('[data-keep]').onclick = () => confirm.close();
      confirm.querySelector('[data-discard]').onclick = () => { confirm.close(); this.closeDialog(true); };
      confirm.showModal(); return;
    }
    dialog.close(); this.dialogMode = null;
    if (this.opener?.isConnected) this.opener.focus();
    else this.host.querySelector('[data-new-scene]')?.focus();
  },
  async changeScene(values, context = {}) {
    if (this.pending) return;
    this.pending = true;
    const form = context.dialog?.querySelector('form');
    if (form) form.querySelector('[type="submit"]').disabled = true;
    try {
      // Capture the revision/token at editor opening. Background polls cannot
      // silently overwrite another user's scene edits or reinterpret this draft.
      await this.client.post('scene', { ...values, revision: context.revision ?? this.snapshot.page.revision }, context.token);
      this.pending = false;
      if (context.dialog) { this.tab = 'scenes'; this.closeDialog(true); }
      document.querySelector('#controls-feedback').textContent = values.action === 'capture' || values.action === 'copy' ? 'Scene saved · Disabled' : 'Scene saved';
      await this.client.refresh();
    } catch (error) {
      if (form) { const message = form.querySelector('[role="alert"]'); message.hidden = false; message.textContent = error.message; }
      else document.querySelector('#controls-feedback').textContent = error.message;
    } finally {
      this.pending = false;
      if (form) form.querySelector('[type="submit"]').disabled = false;
      this.mount(this.host, this.snapshot, this.client);
    }
  },
};
