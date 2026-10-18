/** Inert TV remote presentation. Shared Controls viewer alone sends commands;
 * no holds, key-repeat, automatic app launches or optimistic state updates. */
'use strict';
const TelevisionControls = {
  tab: 'remote', search: '',
  mount(host, snapshot) {
    this.snapshot = snapshot;
    const items = snapshot.page.items, e = ControlsRenderer.escape.bind(ControlsRenderer);
    const signature = JSON.stringify([snapshot.page.id, snapshot.page.revision, this.tab,
      items.map(({reported,available,...item}) => item)]);
    if (host.dataset.televisionSignature !== signature) {
      const used = new Set();
      function button(item, symbol = null, title = null, extra = '') {
        if (!item) return '<span class="tv-empty-key" aria-hidden="true"></span>';
        used.add(item.id);
        return `<button type="button" class="tv-key ${extra}" data-control-item="${e(item.id)}" aria-label="${e(item.label)}" title="${e(item.label)}">${ControlsRenderer.icon(symbol || item.icon)}<span>${e(title || item.label)}</span></button>`;
      }
      const key = (role,symbol,title,extra) => button(items.find(item=>item.remoteRole===role),symbol,title,extra);
      const widget = role => {
        const item = items.find(item=>item.remoteRole===role);
        if (!item) return '';
        used.add(item.id); return ControlsRenderer.renderItem(item);
      };
      const apps = items.filter(item=>item.remoteRole==='app');
      const power = items.find(item => item.remoteRole === 'power') || items.find(item => item.remoteRole === 'off');
      let content;
      if (this.tab === 'remote') {
        content = `<div class="tv-remote-layout"><section class="tv-pad-panel"><div class="tv-power-row">${key('wake','power-off','Wake')}${key('source','right-left','Source')}${button(power,'power-off',power?.remoteRole === 'power' ? 'Power' : 'Power off','tv-power-off')}</div><div class="tv-direction-pad">${key('up','chevron-up','Up','tv-up')}${key('left','chevron-left','Left','tv-left')}${key('enter','circle','OK','tv-enter')}${key('right','chevron-right','Right','tv-right')}${key('down','chevron-down','Down','tv-down')}</div><div class="tv-navigation-row">${key('back','arrow-rotate-left','Back')}${key('home','house','Home')}${key('menu','bars','Menu')}</div></section><section class="tv-secondary"><div class="tv-rockers"><section><h3>Volume</h3>${key('volume-up','plus','Louder')}${key('mute','volume-xmark','Mute')}${key('volume-down','minus','Quieter')}</section><section><h3>Channel</h3>${key('channel-up','plus','Next')}${key('info','circle-info','Info')}${key('channel-down','minus','Previous')}</section></div><div class="tv-media-row">${key('play','play','Play')}${key('pause','pause','Pause')}${key('stop','stop','Stop')}</div>${widget('volume')}${widget('muted')}</section></div>`;
      } else if (this.tab === 'apps') {
        content = `<div class="tv-section-heading"><h3>Apps</h3><span>Saved app shortcuts</span></div><label class="tv-search">${ControlsRenderer.icon('magnifying-glass')}<input type="search" aria-label="Search TV apps" placeholder="Find an app" value="${e(this.search)}"></label><div class="tv-app-grid">${apps.map(item=>button(item)).join('')}</div>${apps.length ? '' : '<p class="empty-state">No enabled app shortcuts. Add mappings in Samsung TV Controls.</p>'}`;
      } else {
        content = `<div class="tv-section-heading"><h3>More controls</h3><span>Inputs and saved mappings</span></div>${widget('input')}<div class="tv-more-grid">${items.filter(item=>!['app','volume','muted','input'].includes(item.remoteRole)).map(item=>['range','toggle','select'].includes(item.kind) ? (used.add(item.id),ControlsRenderer.renderItem(item)) : button(item)).join('')}</div>`;
      }
      // Keep custom/duplicate mappings discoverable. Presentation never hides a
      // saved command simply because its label or role differs from the starter.
      if (this.tab === 'remote') {
        const extras = items.filter(item=>!used.has(item.id) && item.remoteRole!=='app' && item.remoteRole!=='input');
        if (extras.length) content += `<details class="tv-extra"><summary>Additional controls (${extras.length})</summary><div class="tv-more-grid">${extras.map(item=>['range','toggle','select'].includes(item.kind) ? ControlsRenderer.renderItem(item) : button(item)).join('')}</div></details>`;
      }
      host.innerHTML = `<div class="tv-shell"><section class="tv-heading"><div><p>${e(snapshot.page.pluginName)}</p><h2>Television</h2><span>Remote control</span></div><div class="tv-screen-art" aria-hidden="true">${ControlsRenderer.icon('display')}</div></section><nav class="tv-tabs" aria-label="TV remote views">${[['remote','Remote'],['apps','Apps'],['more','More']].map(([id,label])=>`<button type="button" data-tv-tab="${id}" aria-current="${this.tab===id?'page':'false'}">${label}</button>`).join('')}</nav>${content}<p class="tv-footnote">Commands are sent once. Reported readings confirm TV state.</p></div>`;
      host.dataset.televisionSignature = signature;
      host.querySelectorAll('[data-tv-tab]').forEach(button=>button.addEventListener('click',()=>{
        this.tab=button.dataset.tvTab;this.mount(host,this.snapshot);
      }));
      host.querySelector('[aria-label="Search TV apps"]')?.addEventListener('input',event=>{this.search=event.target.value;this.filter(host);});
    }
    // Hydrate through the shared renderer so focus, targets and reported
    // values follow exactly the same rules as ordinary mapped Controls.
    const surfaces = [...host.querySelectorAll('[data-control-id]')];
    for (const item of items) {
      const surface = surfaces.find(element=>element.dataset.controlId===item.id);
      const reading = surface?.querySelector('[data-control-reading]');
      if (reading) reading.textContent=ControlsRenderer.reported(item.reported);
      const input=surface?.querySelector('[data-control-input]');
      if (input) {
        input.setAttribute('aria-label',item.label+' target');
        if (input!==document.activeElement && input.dataset.changed!=='true' && item.reported!==null) {
          if (input.type==='checkbox') input.checked=item.reported===true;else input.value=String(item.reported);
        }
        ControlsRenderer.updateInput(input);
      }
    }
    for (const control of host.querySelectorAll('[data-control-item],[data-control-input]')) {
      const item=items.find(item=>item.id===(control.dataset.controlItem||control.dataset.controlInput));
      control.disabled=!snapshot.available||snapshot.busy||!item?.available;
    }
    this.filter(host);
  },
  filter(host) {
    host.querySelectorAll('.tv-app-grid button').forEach(button=>{button.hidden=!button.textContent.toLowerCase().includes(this.search.trim().toLowerCase());});
  },
};
