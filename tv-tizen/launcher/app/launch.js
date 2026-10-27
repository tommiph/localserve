/* Packaged connection shell. Only its current provider frame can request
 * bounded launch operations against the TV's own installed-app inventory. */
(function () {
  'use strict';
  var storageKey = 'sormus.launcher.provider.v1';
  var requestKey = 'sormus.launcher.last-request.v1';
  var providerPath = '/assets/launcher/index.html';
  var defaultUrl = '';
  // Keep the current screen during brief outages; only fresh readiness resets this wait.
  var connectionWait = 30000;
  var page = null, target = null, challenge = '', sequence = 0;
  var timer = null, health = null, settingsOpen = false, healthy = false;
  var apps = [], appBusy = false, inventoryEpoch = 0;
  var iconReader = LauncherIcons.create(typeof tizen === 'undefined' ? null : tizen.filesystem);
  var iconQueue = [], iconBusy = false, iconGeneration = 0;
  function stopIcons() { iconGeneration++;iconQueue = []; }
  function pumpIcons() {
    if (iconBusy || !iconQueue.length || document.hidden || settingsOpen) return;
    var app = iconQueue.shift(), generation = iconGeneration;iconBusy = true;
    iconReader.read(app,function (image) {
      iconBusy = false;
      if (generation === iconGeneration && apps.some(function (current) { return current.id === app.id && current.version === app.version && current.iconPath === app.iconPath; }))
        send({type:'sormus-launcher-icons',icons:[{id:app.id,version:app.version,image:image}]});
      pumpIcons();
    });
  }
  var inputs = LauncherInputs.create(typeof tizen === 'undefined' ? null : tizen,function (value) {
    if (value.sources) send({type:'sormus-launcher-inputs',sources:value.sources,supported:value.supported});
    else if (value.message) { send({type:'sormus-launcher-video',active:false});send({type:'sormus-launcher-result',ok:false,message:value.message}); }
    else if (value.closed) send({type:'sormus-launcher-video',active:false});
  });
  function node(id) { return document.getElementById(id); }
  function consume(event) { event.preventDefault(); event.stopPropagation(); }
  function clearTimers() { clearTimeout(timer); clearTimeout(health); timer = null; health = null; }
  function lockFields() { node('host').readOnly = true; node('port').readOnly = true; }
  function settings(message) {
    stopIcons();inputs.hide();clearTimers();node('cover').hidden = false;node('splash').hidden = true;node('settings').hidden = false;
    node('status').textContent = message || 'Enter your server address.';
    if (!settingsOpen) {
      var parts = VistaUrlTarget.parts(defaultUrl);
      node('protocol').value = parts ? parts.protocol : 'http:';
      node('host').value = parts ? parts.host : '';
      node('port').value = parts ? parts.port : '7041';
      lockFields();node('host').focus();
    }
    settingsOpen = true;node('return').disabled = !healthy;
  }
  function send(data) {
    if (!page || !target) return;
    data.challenge = challenge;page.contentWindow.postMessage(data, target.origin);
  }
  function inventory() {
    var epoch = ++inventoryEpoch;
    try {
      tizen.application.getAppsInfo(function (list) {
        if (epoch !== inventoryEpoch) return;
        stopIcons();
        apps = list.filter(function (app) {
          return app && app.id !== 'SormusL001.Launcher' && app.show !== false
            && typeof app.id === 'string' && /^[\w.-]{1,128}$/.test(app.id)
            && typeof app.name === 'string' && app.name.length > 0;
        }).slice(0, 256).map(function (app) { return {id:app.id,name:app.name.slice(0,100),
          version:typeof app.version === 'string' ? app.version.slice(0,64) : '',iconPath:app.iconPath,artworkIds:LauncherIcons.smartHubIds(app,tizen.application)}; });
        send({type:'sormus-launcher-apps',apps:apps.map(function (app) { return {id:app.id,name:app.name,version:app.version,artworkIds:app.artworkIds,hasIcon:!!(LauncherIcons.smartHubUri(app) || LauncherIcons.iconUri(app.iconPath))}; }),native:true});
      }, function () { send({type:'sormus-launcher-apps',apps:[],native:false}); });
    } catch (ignore) { send({type:'sormus-launcher-apps',apps:[],native:false}); }
  }
  function probe() { send({type:'sormus-launcher-probe',version:'1.2.3'}); }
  function armHealth() {
    clearTimeout(health);
    if (!document.hidden && !settingsOpen) health = setTimeout(function () { healthy = false; settings('The server is not responding. Check the address or retry.'); }, connectionWait);
  }
  function connect(value) {
    var parts = VistaUrlTarget.parts(value);
    if (!parts || parts.path !== providerPath) { settings('Enter a valid server address.');return; }
    stopIcons();inputs.hide();clearTimers();sequence++;challenge = String(Date.now()) + '-' + sequence;
    target = parts;healthy = false;settingsOpen = false;lockFields();
    node('cover').hidden = false;node('splash').hidden = false;node('settings').hidden = true;
    if (page) page.parentNode.removeChild(page);
    page = document.createElement('iframe');page.id = 'page';page.title = 'Sormus Launcher';
    page.setAttribute('sandbox','allow-scripts allow-same-origin');
    page.onload = probe;page.src = value;document.body.insertBefore(page,node('cover'));
    timer = setTimeout(function () { timer = null;healthy = false;settings('Unable to connect within 30 seconds. Check the server address.'); },connectionWait);
  }
  function close() { stopIcons();inputs.hide();clearTimers();try { tizen.application.getCurrentApplication().exit(); } catch (ignore) { settings('Use the TV Home button to leave the launcher.'); } }
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!page || !target || document.hidden || event.source !== page.contentWindow || event.origin !== target.origin || !data || data.challenge !== challenge) return;
    if (data.type === 'sormus-launcher-ready') {
      clearTimeout(timer);timer = null;healthy = true;armHealth();
      if (!settingsOpen) { node('cover').hidden = true;page.focus(); }
      return;
    }
    if (data.type === 'sormus-launcher-inventory') { inventory();return; }
    if (data.type === 'sormus-launcher-icons' && Array.isArray(data.ids) && data.ids.length <= 12 && !settingsOpen) {
      data.ids.forEach(function (id) {
        var app = apps.filter(function (item) { return item.id === id; })[0];
        if (app && iconQueue.length < 64 && !iconQueue.some(function (item) { return item.id === id; })) iconQueue.push(app);
      });pumpIcons();return;
    }
    if (data.type === 'sormus-launcher-sources') { inputs.read();return; }
    if (settingsOpen || !healthy) return;
    if (data.type === 'sormus-launcher-settings') { settings();return; }
    if (data.type === 'sormus-launcher-exit') { if (inputs.active()) inputs.hide();else close();return; }
    if (data.type === 'sormus-launcher-hide-input') { inputs.hide();send({type:'sormus-launcher-video',active:false});return; }
    if (data.type === 'sormus-launcher-refresh') { connect(defaultUrl);return; }
    if (data.type === 'sormus-launcher-input' && typeof data.id === 'string') {
      if (inputs.open(data.id)) send({type:'sormus-launcher-video',active:inputs.active()});
      else send({type:'sormus-launcher-result',ok:false,message:'Input is busy or unavailable.'});return;
    }
    if (data.type === 'sormus-launcher-display' && typeof data.path === 'string' && !appBusy
        && /^\/(?:display|universe|phone-information|playstation-mode|games\/maze|vistas\/[a-z0-9-]{1,64})$/.test(data.path)) {
      if (!apps.some(function (app) { return app.id === 'HwGlance01.HomeGlance'; })) {
        send({type:'sormus-launcher-result',ok:false,message:'Install Sormus Vistas to open displays on this TV.'});return;
      }
      appBusy = true;
      var displayTimer = setTimeout(function () { appBusy = false;send({type:'sormus-launcher-result',ok:false,message:'Display launch was not confirmed. Check the TV before trying again.'}); },8000);
      function displayDone(ok) { clearTimeout(displayTimer);appBusy = false;send({type:'sormus-launcher-result',ok:ok,message:ok ? 'Opened' : 'The TV could not open this display.'}); }
      try {
        var control = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/view',target.origin + data.path);
        tizen.application.launchAppControl(control,'HwGlance01.HomeGlance',function () { displayDone(true); },function () { displayDone(false); });
      } catch (ignore) { displayDone(false); }
      return;
    }
    if (data.type === 'sormus-launcher-launch' && typeof data.id === 'string'
        && apps.some(function (app) { return app.id === data.id; }) && !appBusy) {
      appBusy = true;
      // A missing acknowledgement is never retried: the app might be open.
      var release = setTimeout(function () { appBusy = false;send({type:'sormus-launcher-result',ok:false,message:'Launch was not confirmed. Check the TV before trying again.'}); },8000);
      function done(ok) { clearTimeout(release);appBusy = false;send({type:'sormus-launcher-result',ok:ok,message:ok ? 'Opened' : 'This TV could not open that app.'}); }
      try { tizen.application.launch(data.id,function () { done(true); },function () { done(false); }); }
      catch (ignore) { done(false); }
    }
  });
  node('settings').onsubmit = function (event) {
    consume(event);
    var value = VistaUrlTarget.settings({protocol:node('protocol').value,host:node('host').value.trim(),port:node('port').value,path:providerPath});
    if (!value) { node('status').textContent = 'Enter a hostname or IP and a port from 1 to 65535.';return; }
    defaultUrl = value;try { localStorage.setItem(storageKey,value); } catch (ignore) {}
    connect(value);
  };
  node('retry').onclick = function () { connect(defaultUrl); };
  node('return').onclick = function () { if (healthy) { lockFields();settingsOpen = false;node('cover').hidden = true;page.focus();armHealth(); } };
  function key(event) {
    var code = event.keyCode;
    if (!settingsOpen) {
      if ((code === 10009 || code === 27) && inputs.active()) { consume(event);inputs.hide();return; }
      if (code === 10009 || code === 27) { consume(event);send({type:'sormus-launcher-key',code:10009});return; }
      if ([37,38,39,40,13].indexOf(code) >= 0) { consume(event);send({type:'sormus-launcher-key',code:code}); }
      return;
    }
    var active = document.activeElement;
    // While the IME owns an editable field, arrows/OK belong to its keyboard.
    // Done/Cancel return to field navigation without submitting the form.
    if (active && active.tagName === 'INPUT' && !active.readOnly) {
      if ([65376,65385,10009,27].indexOf(code) >= 0) {
        consume(event);active.readOnly = true;active.blur();active.focus();
      }
      return;
    }
    if (code === 10009 || code === 27) {
      consume(event);if (active && active.tagName === 'INPUT' && !active.readOnly) { active.readOnly = true;return; }
      if (healthy) node('return').click();else close();return;
    }
    if (code === 13 && active && active.tagName === 'INPUT') {
      // A readonly element already has focus. Refocus after unlocking so Tizen
      // receives an editable focus transition and displays its native keyboard.
      consume(event);active.blur();active.readOnly = false;active.focus();return;
    }
    if (code === 38 || code === 40 || code === 37 || code === 39) {
      if ((code === 37 || code === 39) && active && active.tagName === 'SELECT') return;
      consume(event);lockFields();
      var controls = Array.prototype.slice.call(node('settings').querySelectorAll('input,select,button')).filter(function (control) { return !control.disabled; });
      var index = controls.indexOf(active), step = code === 38 || code === 37 ? -1 : 1;
      controls[(index + step + controls.length) % controls.length].focus();
    }
  }
  document.addEventListener('keydown',key);
  document.addEventListener('visibilitychange',function () {
    if (document.hidden) { stopIcons();inputs.hide();clearTimers();inventoryEpoch++; }
    else if (!settingsOpen && page) { probe();inventory();armHealth(); }
  });
  window.addEventListener('unload',function () { stopIcons();inputs.hide();clearTimers(); });
  try { defaultUrl = VistaUrlTarget.validUrl(localStorage.getItem(storageKey)) || ''; } catch (ignore) {}
  function launchRequest(fresh) {
    try {
      var request = tizen.application.getCurrentApplication().getRequestedAppControl();
      var value = VistaUrlTarget.fromControl(request && request.appControl,defaultUrl);
      // Tizen can retain the preceding app-control payload on an ordinary
      // menu launch. Do not let it overwrite a subsequently edited address.
      var priorRequest = localStorage.getItem(requestKey);
      if (value && VistaUrlTarget.parts(value).path === providerPath && (fresh || !defaultUrl || value !== priorRequest)) {
        defaultUrl = value;localStorage.setItem(storageKey,value);localStorage.setItem(requestKey,value);
      }
    } catch (ignore) {}
    if (defaultUrl) connect(defaultUrl);else timer = setTimeout(function () { settings('Set the address of your Sormus PC.'); },connectionWait);
  }
  window.addEventListener('appcontrol',function () { launchRequest(true); });launchRequest(false);
}());
