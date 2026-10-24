/** Administrator publishing controls for the scoped phone Home surface. */
const PhoneHomeUI = {
  qrCache: null,
  homeAddress() {
    // Encode only the bound private origin, never a token or a draft address.
    try {
      const url=new URL(state.server?.lanAddress);
      const octets=url.hostname.split('.').map(Number);
      if(url.protocol!=='http:' || url.port==='0' || url.username || url.password || url.search || url.hash || url.pathname!=='/'
        || octets.length!==4 || !octets.every(n=>Number.isInteger(n)&&n>=0&&n<=255)
        || !(octets[0]===10 || octets[0]===172&&octets[1]>=16&&octets[1]<=31 || octets[0]===192&&octets[1]===168))return null;
      return url.origin+'/scenes';
    } catch { return null; }
  },
  qr(address) {
    if(!address || typeof qrcodegen==='undefined')return '';
    if(this.qrCache?.address===address)return this.qrCache.markup;
    try {
      const code=qrcodegen.QrCode.encodeSegments(qrcodegen.QrSegment.makeSegments(address),qrcodegen.QrCode.Ecc.MEDIUM,1,5);
      const quiet=4,size=code.size+quiet*2,paths=[];
      for(let y=0;y<code.size;y++)for(let x=0;x<code.size;x++)if(code.getModule(x,y))paths.push(`M${x+quiet},${y+quiet}h1v1h-1z`);
      const markup=`<figure class="phone-handoff-code"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Scan to open Controller on this LAN" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${paths.join('')}" fill="#000"/></svg><figcaption>Scan with your phone camera</figcaption></figure>`;
      this.qrCache={address,markup};return markup;
    } catch { return ''; } // The readable address remains usable if encoding fails.
  },
  connection() {
    const address=this.homeAddress();
    return `<section class="panel"><div class="panel-header"><h2>${icon('smartphone')}Connect your phone</h2></div><div class="panel-body"><div class="phone-handoff">${address ? `<div class="phone-handoff-address"><p>Connect the phone to the same LAN and open this address:</p><label class="field"><span class="field-label">Controller address</span><input id="phone-home-address" readonly value="${escapeHtml(address)}"></label><button type="button" class="button" data-action="phone-home-copy-address">${icon('copy')}Copy address</button><p class="field-help">Scanning opens Controller in your browser; it does not install the APK or enable phone reporting. Keep Localserve running.</p></div>${this.qr(address)}` : '<div><p>Phone access needs an explicit LAN address in Settings → Network. A localhost address reaches this PC only.</p><button type="button" class="button" data-view="settings">Open server Settings</button></div>'}</div><p class="field-help"><a href="/downloads/controller.apk">Download Controller for Android</a> for Lights, Tasks, full Remotes, Cards and optional phone reporting in Settings. Sensors can stay disabled. No firewall or access setting changes automatically.</p></div></section>`;
  },

  async copyAddress() {
    const input=document.getElementById('phone-home-address'); if(!input)return;
    try { await navigator.clipboard.writeText(input.value); notify('Phone address copied'); }
    catch { input.focus(); input.select(); notify('Select and copy the phone address.'); }
  },
  render() {
    const home = state.phoneHome;
    const back = `<button class="button" data-view="controls">${icon('arrow-left')}Controls</button>`;
    if (!home) return pageHeading('Phone home', 'Refresh the administrator to load phone access.', back);
    const published = home.tasks.map((item) => ({
      item,
      task: state.tasks.find((task) => task.id === item.taskId),
    }));
    return (
      pageHeading(
        'Phone home',
        'Favorites, remotes and manual Task shortcuts',
        `${back}<a class="button" href="downloads/controller.apk">${icon('download')}Get Controller</a><a class="button primary" href="scenes" target="_blank" rel="noopener">${icon('arrow-up-right-from-square')}Open Controller</a>`,
      ) + this.connection() + `<div class="phone-home-sources"><section class="panel"><div class="panel-header"><h2>${icon('settings-remote')}Remotes</h2></div><div class="panel-body"><p>Enabled Controls pages appear automatically. Configure the owning plugin and enable its page to make a remote available.</p><a class="button" href="controls" target="_blank" rel="noopener">Open Remotes</a></div></section><section class="panel"><div class="panel-header"><h2>${icon('favorite')}Cards and favorites</h2></div><div class="panel-body"><p>Choose Cards and arrange favorites in Home on each phone. These choices are personal to that browser and server address.</p><p class="field-help">Changing the server address or port uses a different favorites store; it does not migrate your previous choices.</p><a class="button" href="home" target="_blank" rel="noopener">Open Home</a></div></section></div>` +
      `<section class="panel"><div class="panel-header"><h2>${icon('play')}Published Tasks</h2><button class="button" data-action="phone-home-edit">${icon('pen')}Edit</button></div><div class="panel-body"><p>Choose which Tasks people can run from Home. Favorites and their order are personal to each phone. Enabled Controls pages appear automatically in Remotes.</p><p class="field-help">Publishing allows manual device actions on your trusted LAN. Event-dependent Tasks need captured values and remain unavailable here. Disabling a shortcut does not cancel a run already accepted.</p></div>${published.length ? `<div class="table-scroll"><table class="service-table"><thead><tr><th>Task</th><th>Phone shortcut</th><th>Task status</th></tr></thead><tbody>${published.map(({ item, task }) => `<tr data-live-key="phone-task-${escapeHtml(item.taskId)}"><td>${icon(item.icon)} ${escapeHtml(task?.name || 'Deleted Task')}</td><td>${item.label ? escapeHtml(item.label)+' · ' : ''}${item.enabled ? 'Enabled' : 'Disabled'}</td><td>${task ? (task.enabled ? 'Enabled' : 'Disabled') : 'Unavailable'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state">No Tasks published. Your existing Tasks stay private to administration until selected here.</div>'}</section>`
    );
  },
  field(label, glyph, input, index) {
    const id = 'field-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return formField(label, glyph, input).replaceAll(id, id + '-phone-' + index);
  },
  edit() {
    const home = state.phoneHome;
    if (!home) return;
    const choices = ['play', 'lightbulb', 'tv', 'movie', 'music', 'home', 'star', 'power-off', 'bed', 'sun'];
    const icons = choices.filter((id) => state.pluginGlyphs.includes(id));
    showDialog(
      `<form id="phone-home-form">${dialogHeader('Publish phone shortcuts')}<div class="dialog-body"><p>Select up to 32 Tasks. This grants manual execution from Home; it does not enable or edit the Task itself.</p><div id="form-error" class="form-error" role="alert" hidden></div>${
        state.tasks.length
          ? state.tasks
              .map((task, index) => {
                const saved = home.tasks.find((item) => item.taskId === task.id);
                const glyphs = [...new Set([saved?.icon || 'play', ...icons])];
                return `<fieldset class="panel phone-task-publish" data-phone-task="${escapeHtml(task.id)}"><legend>${escapeHtml(task.name)}</legend><div class="panel-body"><label class="check-field phone-publish-toggle"><input name="publish" type="checkbox" ${saved ? 'checked' : ''}> Publish on phone</label><div class="form-grid">${this.field('Short label (optional)', 'tag', `<input name="label" type="text" maxlength="40" value="${escapeHtml(saved?.label || '')}" placeholder="${escapeHtml(task.name)}">`, index)}${this.field('Glyph', 'shapes', `<select name="icon">${glyphs.map((id) => `<option value="${id}" ${id === (saved?.icon || 'play') ? 'selected' : ''}>${escapeHtml(id.replaceAll('-', ' '))}</option>`).join('')}</select>`, index)}${this.field('Shortcut enabled', 'toggle-on', `<input name="enabled" class="switch" role="switch" type="checkbox" ${saved?.enabled !== false ? 'checked' : ''}>`, index)}</div></div></fieldset>`;
              })
              .join('')
          : '<p>Create a Task first, then publish it here.</p>'
      }</div>${dialogFooter()}</form>`,
      { kind: 'phone-home', revision: home.revision },
    );
  },
};
document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'phone-home-form') return;
  event.preventDefault();
  const form = event.target,
    context = dialogContext;
  if (!form.isConnected || context?.kind !== 'phone-home' || context.submitted) return;
  const tasks = [...form.querySelectorAll('[data-phone-task]')]
    .filter((row) => row.querySelector('[name="publish"]').checked)
    .map((row) => ({
      taskId: row.dataset.phoneTask,
      icon: row.querySelector('[name="icon"]').value,
      enabled: row.querySelector('[name="enabled"]').checked,
      label: row.querySelector('[name="label"]').value.trim(),
    }));
  context.submitted = true;
  form.querySelector('[type="submit"]').disabled = true;
  try {
    await request('/api/phone-home/settings', { revision: context.revision, tasks });
    await refreshState(false);
    if (dialogContext === context) closeDialog();
    renderView();
    notify('Phone shortcuts saved');
  } catch (error) {
    if (dialogContext === context) {
      context.submitted = false;
      form.querySelector('[type="submit"]').disabled = false;
      showFormError(error.message);
    }
  }
});
