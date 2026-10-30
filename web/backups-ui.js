/** Configuration recovery uses the ordinary administrator and dialog flow. */
const BackupsUI={
  pending:false,
  kind(value){return ({manual:'Manual snapshot','before-update':'Before update','before-restore':'Restore safety snapshot'})[value]||'Snapshot';},
  render(){
    const data=state.backups;if(!data)return '';
    const disabled=this.pending||data.busy||data.pending||data.error?'disabled':'';
    return `<section class="panel settings-group" aria-label="Backup and restore"><div class="panel-header"><h2>Backup and restore</h2><button class="button primary" data-action="backup-create" ${disabled}>${icon('copy')}Create backup</button></div>
      <div class="panel-body"><p>Encrypted local snapshots of Tasks, Vistas, Cards, Controls, plugin settings, credentials and your home map. Stored in <code>data/backups</code>; keep a separate copy of that whole folder for recovery on this Windows account and computer.</p><p class="field-help">Application files, APK/media libraries, Activity history and runtime receipts are excluded. Preview changes before restoring. Restores apply on a normal restart with Tasks and plugins disabled and the server paused.</p>
      ${data.error?`<p class="form-error" role="alert">${escapeHtml(data.error)}</p>`:''}
      ${data.pending?`<div class="aside-note" role="status"><p><strong>Restore staged.</strong> Use the Sormus tray menu → Restart server to apply it. Editing is locked until restart or cancellation. The server stays paused after cancellation.</p><button class="button" data-action="backup-cancel" ${this.pending?'disabled':''}>Cancel staged restore</button></div>`:''}
      <div class="row-actions"><button class="button" data-action="backup-options" ${disabled}>${icon('sliders')}Backup options</button><span class="field-help">Before updates: ${data.settings.beforeUpdates?'On':'Off'} · Keep ${data.settings.keepAutomatic} automatic snapshots. Manual and restore safety snapshots stay until deleted.</span></div>
      <div class="backup-list">${data.items.map(item=>`<article class="backup-row" data-live-key="backup:${item.id}"><div><h3>${escapeHtml(this.kind(item.kind))}</h3><p>${escapeHtml(formatServerTimestamp(item.createdAt))} · v${escapeHtml(item.version)} · ${item.files} files · ${Math.max(1,Math.ceil(item.bytes/1024))} KB</p></div><div class="row-actions"><button class="button" data-action="backup-preview" data-id="${item.id}" aria-label="Preview restore ${escapeHtml(formatServerTimestamp(item.createdAt))}" ${disabled}>${icon('rotate-left')}Preview restore</button><button class="button" data-action="backup-delete" data-id="${item.id}" aria-label="Delete backup ${escapeHtml(formatServerTimestamp(item.createdAt))}" ${disabled}>${icon('trash-can')}Delete</button></div></article>`).join('')||'<p class="empty-state">No snapshots yet. Create your first backup.</p>'}</div></div></section>`;
  },
  async handle(action,control){
    if(this.pending)return;const id=control.dataset.id;
    if(action==='backup-options'){
      const data=state.backups.settings;
      showDialog(`<form id="backup-options-form">${dialogHeader('Backup options')}<div class="dialog-body backup-dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div><label><input type="checkbox" name="beforeUpdates" ${data.beforeUpdates?'checked':''}> Back up before updates</label>${formField('Keep automatic snapshots','clock',`<input name="keepAutomatic" type="number" min="1" max="50" step="1" required value="${data.keepAutomatic}">`,'Keep 1 to 50 pre-update snapshots. Reducing this number removes older automatic snapshots after a successful backup or settings save. Manual and restore safety snapshots are retained.')}<p class="field-help">Setup backs up before replacing application files. A manual ZIP update creates a settings snapshot on the first start of the new version.</p></div>${dialogFooter()}</form>`,{kind:'backup-options'});return;
    }
    if(action==='backup-delete'){
      const item=state.backups.items.find(item=>item.id===id);if(!item)return;
      showDialog(`<form id="backup-delete-form">${dialogHeader('Delete backup')}<div class="dialog-body backup-dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div><p>Delete the ${escapeHtml(this.kind(item.kind).toLowerCase())} from ${escapeHtml(formatServerTimestamp(item.createdAt))}? This removes only this snapshot.</p></div>${dialogFooter('Delete backup')}</form>`,{kind:'backup-delete',id});return;
    }
    this.pending=true;renderView();
    try{
      if(action==='backup-create'){await mutate('/api/backups/create',{});notify('Encrypted backup created and verified.');}
      else if(action==='backup-cancel'){await mutate('/api/backups/cancel',{});notify('Restore cancelled. Server remains paused.');}
      else if(action==='backup-preview'){
        const preview=await request('/api/backups/preview',{id});if(dialog.open||currentView!=='settings')return;
        showDialog(`<form id="backup-restore-form">${dialogHeader('Preview restore')}<div class="dialog-body backup-dialog-body"><div id="form-error" class="form-error" role="alert" hidden></div><p>${escapeHtml(formatServerTimestamp(preview.backup.createdAt))} · v${escapeHtml(preview.backup.version)} · ${preview.tasks} Tasks · ${preview.plugins} plugins</p><p>${escapeHtml(preview.notice)}</p><p>A safety snapshot of your current settings is created before staging. Cancel closes this preview without changing settings.</p><details><summary>${preview.changes.length} file changes before disabling Tasks and plugins</summary><ul class="backup-changes">${preview.changes.map(change=>`<li><strong>${escapeHtml(change.change)}</strong> <code>${escapeHtml(change.path)}</code></li>`).join('')||'<li>No saved file differences.</li>'}</ul></details><label><input type="checkbox" name="review" required> I will review restored Tasks, plugins and connections before enabling them.</label></div>${dialogFooter(state.paused?'Stage restore':'Pause and stage restore')}</form>`,{kind:'backup-restore',token:preview.token});
      }
    }finally{this.pending=false;if(!dialog.open)renderView();}
  },
  async submit(form){
    if(this.pending)return;this.pending=true;const context=dialogContext;form.querySelector('[type="submit"]').disabled=true;
    try{
      if(form.id==='backup-options-form')await mutate('/api/backups/settings',{beforeUpdates:form.elements.beforeUpdates.checked,keepAutomatic:Number(form.elements.keepAutomatic.value)});
      else if(form.id==='backup-delete-form')await mutate('/api/backups/delete',{id:context.id});
      else if(form.id==='backup-restore-form'){
        if(!form.elements.review.checked)throw Error('Confirm that you will review the restored setup.');
        if(!state.paused)await mutate('/api/pause',{paused:true});
        await mutate('/api/backups/restore',{token:context.token});
      }
      if(dialogContext===context)closeDialog();renderView();notify(form.id==='backup-restore-form'?'Restore staged. Restart Sormus from its tray menu.':'Backup settings saved.');
    }catch(error){if(dialogContext===context)showFormError(error.message);}finally{this.pending=false;if(form.isConnected)form.querySelector('[type="submit"]').disabled=false;if(!dialog.open)renderView();}
  }
};
