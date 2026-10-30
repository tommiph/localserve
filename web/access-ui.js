/** Sign-in is optional; browser sessions do not grant native/display capabilities. */
const AccessUI={
  pending:false,
  lock(){AdminSync.invalidate();csrfToken='';document.documentElement.style.visibility='hidden';workspace.textContent='Sign in to continue.';location.replace('/login?return='+encodeURIComponent(location.pathname));},
  render(){
    const access=state.access;if(!access)return '';const disabled=this.pending?'disabled':'';
    return `<section class="panel settings-group" aria-label="Administrator access"><div class="panel-header"><h2>Administrator access</h2><button class="button" data-action="access-configure" ${disabled}>${icon('lock')}${access.enabled?'Change password':'Enable sign-in'}</button></div><div class="panel-body"><p><strong>${access.enabled?'Sign-in enabled':'Sign-in off'}</strong> · Optional local password for administrator settings, Task editing, credentials and restores. Published displays and scoped remote controls keep their existing access.</p><p class="field-help">Sessions last up to ${access.sessionHours} hours. This is a trusted local HTTP server; sign-in does not add connection encryption. Native phone/headset approvals and Sensors remain separate.</p>${access.enabled?`<div class="row-actions"><button class="button" data-action="access-disable" ${disabled}>Turn sign-in off</button><button class="button" data-action="access-logout" ${disabled}>Sign out this browser</button></div><div class="access-sessions">${access.sessions.map(session=>`<article class="access-session" data-live-key="access:${session.id}"><div><h3>${escapeHtml(session.name)}${session.current?' · This session':''}</h3><p>Last used ${escapeHtml(formatServerTimestamp(session.lastSeenAt))} · Expires ${escapeHtml(formatServerTimestamp(session.expiresAt))}</p></div><div class="row-actions"><button class="button" data-action="access-rename" data-id="${session.id}" aria-label="Rename ${escapeHtml(session.name)}" ${disabled}>${icon('pen')}Rename</button><button class="button" data-action="access-revoke" data-id="${session.id}" aria-label="Revoke session for ${escapeHtml(session.name)}" ${disabled}>${session.current?'Sign out':'Revoke'}</button></div></article>`).join('')}</div>`:'<p class="field-help">No password is configured by default. Enable sign-in only when you want it; your current access stays unchanged until you save.</p>'}</div></section>`;
  },
  async handle(action,control){
    if(this.pending)return;
    const access=state.access;
    if(action==='access-configure'||action==='access-disable'){
      const enable=action!=='access-disable';
      showDialog(`<form id="access-settings-form">${dialogHeader(enable?(access.enabled?'Change password':'Enable sign-in'):'Turn sign-in off')}<div class="dialog-body access-form"><div id="form-error" class="form-error" role="alert" hidden></div>${access.enabled?formField('Current password','lock','<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="256">'):''}${enable?`${formField('New password','lock','<input name="password" type="password" autocomplete="new-password" minlength="10" maxlength="256" required>','Use 10 to 256 characters. No default password is supplied.')}${formField('Confirm new password','lock','<input name="confirmPassword" type="password" autocomplete="new-password" minlength="10" maxlength="256" required>')}${!access.enabled?formField('Name this browser','display','<input name="name" value="This browser" maxlength="64" required autocomplete="off">'):''}`:''}<p>${enable?'Saving signs in this browser and revokes every previous administrator session.':'Turning sign-in off revokes all administrator sessions and restores administration without a password on this PC/private LAN.'}</p><p class="field-help">Devices, published controls, Tasks, plugin settings and pause state are unchanged. Offline recovery is available on the server PC; see Administrator access in the guide.</p></div>${dialogFooter(enable?'Save and sign in':'Turn sign-in off')}</form>`,{kind:'access-settings',revision:access.revision,enabled:enable});return;
    }
    if(action==='access-rename'||action==='access-revoke'){
      const session=access.sessions.find(s=>s.id===control.dataset.id);if(!session)return;const remove=action==='access-revoke';
      showDialog(`<form id="access-session-form">${dialogHeader(remove?'Revoke session':'Name browser session')}<div class="dialog-body access-form"><div id="form-error" class="form-error" role="alert" hidden></div>${remove?`<p>Revoke ${escapeHtml(session.name)}? ${session.current?'This browser will be signed out.':'Its next administrator request will require sign-in.'} Already admitted operations may finish.</p>`:formField('Browser name','display',`<input name="name" value="${escapeHtml(session.name)}" maxlength="64" required autocomplete="off">`)}</div>${dialogFooter(remove?'Revoke session':'Save name')}</form>`,{kind:'access-session',id:session.id,revision:session.revision,remove});return;
    }
    if(action==='access-logout'){this.pending=true;try{await request('/api/access/logout',{});this.lock();}finally{this.pending=false;}}
  },
  async submit(form){
    if(this.pending)return;this.pending=true;const context=dialogContext;form.querySelector('[type="submit"]').disabled=true;
    try{
      let endpoint,values;
      if(form.id==='access-settings-form'){
        values={revision:context.revision,enabled:context.enabled};
        if(context.enabled){if(form.elements.password.value!==form.elements.confirmPassword.value)throw Error('The new passwords do not match.');values.password=form.elements.password.value;if(form.elements.name)values.name=form.elements.name.value;}
        if(form.elements.currentPassword)values.currentPassword=form.elements.currentPassword.value;endpoint='/api/access/settings';
      }else{endpoint=context.remove?'/api/access/revoke':'/api/access/session-name';values={id:context.id};if(!context.remove)Object.assign(values,{revision:context.revision,name:form.elements.name.value});}
      const result=await request(endpoint,values);if(result.signedOut){this.lock();return;}
      form.querySelectorAll('[type="password"]').forEach(input=>{input.value='';});if(dialogContext===context)closeDialog();await refreshState();notify('Administrator access updated.');
    }catch(error){if(dialogContext===context)showFormError(error.message);}finally{this.pending=false;if(form.isConnected)form.querySelector('[type="submit"]').disabled=false;if(state&&!dialog.open)renderView();}
  }
};
