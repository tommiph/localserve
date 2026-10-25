/** Administrator selection and connection guidance for Controller. */
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
    const address=this.homeAddress(),relay=state.services.find(item=>item.id==='google-apps-script'),approval=typeof CloudRelayUI==='undefined'?null:CloudRelayUI.approval;
    const enrollment=relay?.config?`<div class="controller-enrollment"><h3>Connect a phone</h3><p>Set up Google Apps Script once for access away from home. For each new phone, choose Connect a phone and enter the code in Controller. Connection details arrive automatically.</p><button class="button" data-action="cloud-phone-code" data-revision="${relay.config.revision}" ${CloudRelayUI.pending?'disabled':''}>${icon('smartphone')}Connect a phone</button>${approval&&approval.expiresAt>Date.now()?`<div class="controller-approval" role="status"><strong>Enter this code in Controller</strong><output class="controller-approval-code">${escapeHtml(approval.code)}</output><span>One phone · expires ${escapeHtml(formatServerTimestamp(approval.expiresAt))}</span></div>`:''}<p class="field-help">The code works once and expires after five minutes. Approve only a phone you recognize. Remote access needs a configured, enabled Google Apps Script plugin.</p></div>`:'';
    return `<section class="panel"><div class="panel-header"><h2>${icon('smartphone')}Connect Controller</h2></div><div class="panel-body"><div class="phone-handoff">${address?`<div class="phone-handoff-address"><p>Connect your phone to the same Wi-Fi as this server. In Controller settings, enter the server address below.</p><label class="field"><span class="field-label">Server address</span><input id="phone-home-address" readonly value="${escapeHtml(new URL(address).origin)}"></label><button class="button" data-action="phone-home-copy-address">${icon('copy')}Copy address</button><p class="field-help">Or scan this code to try Controller in your phone browser.</p></div>${this.qr(address)}`:'<p>Phone access needs a LAN address in Settings → Network. A localhost address reaches this PC only.</p><button class="button" data-view="settings">Open network settings</button>'}</div><ol class="setup-steps"><li>Install Controller on your phone and connect it to this server.</li><li>For access away from home, configure Google Apps Script and connect this phone with a code.</li><li>Use Choose Tasks above to select phone shortcuts. Lighting scenes, enabled remotes and compatible Cards appear automatically.</li></ol>${enrollment}<p class="field-help">Phone reporting is optional. Sensors can stay disabled if you only use scenes, Tasks and remotes.</p></div></section>`;
  },
  async copyAddress() {
    const input=document.getElementById('phone-home-address'); if(!input)return;
    try { await navigator.clipboard.writeText(input.value); notify('Phone address copied'); }
    catch { input.focus(); input.select(); notify('Select and copy the phone address.'); }
  },
  render() {
    const home=state.phoneHome,back='<button class="button" data-view="controls">'+icon('arrow-left')+'Controls</button>';
    if(!home)return pageHeading('Controller setup','Refresh administration to load phone access.',back);
    const published=home.tasks.map(item=>({item,task:state.tasks.find(task=>task.id===item.taskId)}));
    return pageHeading('Controller setup','Choose what is available on your phone',back+'<button class="button" data-view="downloads">'+icon('download')+'Get Controller</button><a class="button" href="/scenes" target="_blank" rel="noopener">'+icon('arrow-up-right-from-square')+'Open Controller</a>')+
      `<section class="panel controller-setup-summary"><div class="panel-header"><h2>${icon('play')}Tasks on Controller <span class="panel-count">${published.length}</span></h2><button class="button primary" data-action="phone-home-edit">${icon('check')}Choose Tasks</button></div><div class="panel-body"><p>Choose which saved Tasks people can start from Controller's Tasks tab. This does not enable a Task or change its automatic rules.</p><p class="field-help">Tasks that depend on a triggering Event need captured values and may be unavailable for manual use. A shortcut cannot bypass a paused server, disabled plugin or missing setup.</p></div>${published.length?`<div class="table-scroll"><table class="service-table"><thead><tr><th>Task</th><th>Phone shortcut</th><th>Task status</th></tr></thead><tbody>${published.map(({item,task})=>`<tr data-live-key="phone-task-${escapeHtml(item.taskId)}"><td>${icon(item.icon)} ${escapeHtml(task?.name||'Deleted Task')}</td><td>${item.label?escapeHtml(item.label)+' · ':''}${item.enabled?'Visible':'Hidden'}</td><td>${task?(task.enabled?'Enabled':'Disabled'):'Unavailable'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state">No Tasks selected. Choose Tasks to add the first phone shortcut.</div>'}</section>`+this.connection()+
      '<section class="panel"><div class="panel-header"><h2>'+icon('info')+'What appears in Controller</h2></div><div class="panel-body"><dl class="controller-contents"><div><dt>Lights</dt><dd>Your enabled lighting scenes. Manage them in Controls → Lighting scenes.</dd></div><div><dt>Tasks</dt><dd>The Tasks selected above. Create and edit them on the server Tasks page.</dd></div><div><dt>Remotes</dt><dd>Enabled TV, lighting and other remotes from Controls → Remotes.</dd></div><div><dt>Cards</dt><dd>Compatible ready-made Cards from configured plugin sources.</dd></div></dl><p class="field-help">Google Apps Script handles remote access. Server settings, plugin setup and editing stay in administration.</p></div></section>';
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
      `<form id="phone-home-form">${dialogHeader('Choose Tasks for Controller')}<div class="dialog-body"><p>Select up to 32 Tasks for Controller. Selecting a Task adds a phone shortcut; it does not enable or edit the Task.</p><div id="form-error" class="form-error" role="alert" hidden></div>${
        state.tasks.length
          ? state.tasks
              .map((task, index) => {
                const saved = home.tasks.find((item) => item.taskId === task.id);
                const glyphs = [...new Set([saved?.icon || 'play', ...icons])];
                return `<fieldset class="panel phone-task-publish" data-phone-task="${escapeHtml(task.id)}"><legend>${escapeHtml(task.name)}</legend><div class="panel-body"><label class="check-field phone-publish-toggle"><input name="publish" type="checkbox" ${saved ? 'checked' : ''}> Show in Controller</label><div class="form-grid">${this.field('Short label (optional)', 'tag', `<input name="label" type="text" maxlength="40" value="${escapeHtml(saved?.label || '')}" placeholder="${escapeHtml(task.name)}">`, index)}${this.field('Glyph', 'shapes', `<select name="icon">${glyphs.map((id) => `<option value="${id}" ${id === (saved?.icon || 'play') ? 'selected' : ''}>${escapeHtml(id.replaceAll('-', ' '))}</option>`).join('')}</select>`, index)}${this.field('Shortcut enabled', 'toggle-on', `<input name="enabled" class="switch" role="switch" type="checkbox" ${saved?.enabled !== false ? 'checked' : ''}>`, index)}</div></div></fieldset>`;
              })
              .join('')
          : '<p>Create a Task on the Tasks page, then select it here.</p>'
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
    notify('Controller shortcuts saved');
  } catch (error) {
    if (dialogContext === context) {
      context.submitted = false;
      form.querySelector('[type="submit"]').disabled = false;
      showFormError(error.message);
    }
  }
});
