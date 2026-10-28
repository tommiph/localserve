/** Central package catalogue. Refresh reads local metadata without installing
 * clients, enabling plugins or exporting private connection settings. */
const DownloadsUI = {
  data:null,loading:false,error:'',
  async load(){
    if(this.loading)return;
    this.loading=true;this.error='';
    try{this.data=(await request('api/downloads')).items;}
    catch(error){this.error=error.message;}
    finally{this.loading=false;if(currentView==='downloads')renderView();}
  },
  size(bytes){return Number.isFinite(bytes)?bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':Math.max(1,Math.ceil(bytes/1024))+' KB':'—';},
  render(){
    if(!this.data&&!this.loading&&!this.error)void this.load();
    const relay=state.services.find(service=>service.id==='google-apps-script');
    return pageHeading('Downloads','Applications and setup files','<button class="button" data-action="downloads-refresh" '+(this.loading?'disabled':'')+'>'+icon('rotate')+'Refresh</button>')+
      '<p class="field-help">Versions describe the files available here, not the versions installed on a phone, TV or headset. Controller is the only phone app you need.</p>'+
      (this.error?'<p class="form-error">'+escapeHtml(this.error)+'</p>':'')+
      `<section class="panel"><div class="panel-header"><h2>Applications and source</h2></div>${this.data?`<div class="table-scroll"><table class="service-table responsive-downloads"><thead><tr><th>Download</th><th>Platform</th><th>Version</th><th>Status</th><th>Size</th><th>Get file</th></tr></thead><tbody>${this.data.map(item=>`<tr data-live-key="download:${item.id}"><td><strong>${escapeHtml(item.name)}</strong><small class="download-description">${escapeHtml(item.kind)} · ${escapeHtml(item.description)}</small></td><td data-label="Platform">${escapeHtml(item.platform)}</td><td data-label="Version">${escapeHtml(item.version||'—')}</td><td data-label="Status"><span class="status-pill ${item.available?'running':'waiting'}">${escapeHtml(item.status)}</span></td><td data-label="Size">${this.size(item.bytes)}</td><td data-label="Get file">${item.available?`<a class="button" href="${escapeHtml(item.url)}">${icon('download')}Download</a>`:'<span class="muted">Build required</span>'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state" role="status">Reading available downloads…</div>'}</section>`+
      '<section class="panel"><div class="panel-header"><h2>Windows server</h2></div><div class="panel-body"><p>The published Windows installer and portable ZIP are on GitHub. The release page lists their versions and verification files; an unpublished local build can be newer.</p><a class="button" href="https://github.com/tommiph/sormus/releases" target="_blank" rel="noopener">'+icon('download')+'Windows downloads</a></div></section>'+
      `<section class="panel"><div class="panel-header"><h2>Setup help</h2></div><div class="panel-body"><dl class="controller-contents"><div><dt>Controller</dt><dd>Install over the existing app to keep its settings. Open Controller setup to connect phones and choose their Tasks.</dd></div><div><dt>TV applications</dt><dd>Signed widgets need an authorized Tizen developer connection. Source ZIPs need your own SDK and signing certificate. A download does not install an app on your TV.</dd></div><div><dt>Oculus Go</dt><dd>The headset APK belongs on Oculus Go. Use the VR library to manage headset applications.</dd></div><div><dt>Google Apps Script</dt><dd>Use Code.gs in your private Google project, then follow the Google Apps Script plugin's setup guide.</dd></div></dl><div class="row-actions"><button class="button" data-view="phone-home">${icon('smartphone')}Controller setup</button>${relay?`<button class="button" data-view="google-apps-script">${icon('cloud')}Relay setup</button><button class="button" data-action="cloud-google" data-revision="${relay.config.revision}">${icon('download')}Private Google configuration</button>`:''}</div>${relay?'<p class="field-help">Private Google configuration contains access keys. Use it only in your own project and never publish or share it.</p>':''}</div></section>`;
  },
};
