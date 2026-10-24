/* The parent owns HDMI and connection settings. The scoped server frame may
 * request one of two fixed layouts, never a source, rectangle or launch URL. */
(function () {
  'use strict';
  var defaultUrl = 'http://192.0.2.1:7041/playstation-mode';
  var storageKey = 'localserve.playstation.server.v1';
  var layoutKey = 'localserve.playstation.layout.v1', layout = 'split', infoKey = null, remoteKeys = {};
  var appearanceKey = 'localserve.playstation.hud.v1', styles = ['edges','top','right','bottom','left','ticker','none'], appearance = {style:'edges',opacity:100};
  function validAppearance(value) { return value && styles.indexOf(value.style) >= 0 && typeof value.opacity === 'number' && isFinite(value.opacity) && value.opacity >= 0 && value.opacity <= 100; }
  function validLayout(value) { return value === 'split' || value === 'hud'; }
  function fixedUrl(value) {
    var url = VistaUrlTarget.validUrl(value), viewer = url && VistaUrlTarget.parts(url);
    return viewer && viewer.path === '/playstation-mode' ? url : null;
  }
  try { defaultUrl = fixedUrl(localStorage.getItem(storageKey)) || defaultUrl; } catch (ignore) {}
  try { var savedLayout = localStorage.getItem(layoutKey);if (validLayout(savedLayout)) layout = savedLayout; } catch (ignore) {}
  try { var savedAppearance = JSON.parse(localStorage.getItem(appearanceKey));if (validAppearance(savedAppearance)) appearance = {style:savedAppearance.style,opacity:savedAppearance.opacity}; } catch (ignore) {}
  var page = null, started = false, healthy = false, settingsOpen = false, attempted = false;
  var probe = '', serial = 0, guard = null, healthGuard = null, resumeTimer = null;
  function node(id) { return document.getElementById(id); }
  function send(data) { if (page && probe) { data.id = probe;data.path = '/playstation-mode';page.contentWindow.postMessage(data,origin()); } }
  function sendAppearance() { send({type:'localserve-ps-appearance',style:appearance.style,opacity:appearance.opacity}); }
  function saveAppearance() { try { localStorage.setItem(appearanceKey,JSON.stringify(appearance)); } catch (ignore) {}sendAppearance(); }
  function readAppearance() {
    var next = {style:node('hud-style').value,opacity:Number(node('hud-opacity').value)};
    if (validAppearance(next)) { appearance = next;saveAppearance(); }
  }
  function lockFields() { ['host','port'].forEach(function (id) { node(id).readOnly = true; }); }
  var hdmi = PlaystationHdmi.create(typeof tizen === 'undefined' ? null : tizen,function (message,error,applied) {
    if (validLayout(applied)) {
      layout = applied;document.documentElement.setAttribute('data-layout',layout);
      try { localStorage.setItem(layoutKey,layout); } catch (ignore) {}
      send({type:'localserve-ps-layout',layout:layout,native:true});
      sendAppearance();
    }
    if (error && !document.hidden) settings(message,true);
    send({type:'localserve-ps-native-status',message:message});
  });
  function origin() { var a = document.createElement('a');a.href = defaultUrl;return a.protocol + '//' + a.host; }
  function consume(event) { if (event.preventDefault) event.preventDefault();if (event.stopPropagation) event.stopPropagation(); }
  function settings(message, nativeFailure) {
    if (!nativeFailure) hdmi.hide();
    clearTimeout(guard);clearTimeout(healthGuard);
    node('status').textContent = message || 'Connection settings';node('launcher').hidden = false;node('connection').hidden = false;
    if (!settingsOpen) {
      var parts = VistaUrlTarget.parts(defaultUrl);
      node('protocol').value = parts.protocol;node('host').value = parts.host;node('port').value = parts.port;node('layout').value = layout;
      node('hud-style').value = appearance.style;node('hud-opacity').value = appearance.opacity;updateOpacity();lockFields();node('host').focus();
    }
    settingsOpen = true;node('resume').disabled = !healthy;
  }
  function armHealth() {
    clearTimeout(healthGuard);
    if (!document.hidden && !settingsOpen) healthGuard = setTimeout(function () { healthy = false;settings('Localserve stopped responding. Check the server connection.'); },9000);
  }
  function showGame() {
    if (!healthy || document.hidden) return;
    settingsOpen = false;node('connection').hidden = true;node('launcher').hidden = true;page.focus();armHealth();
    if (!attempted) {
      attempted = true;
      if (!hdmi.open(layout) && !settingsOpen) settings('HDMI is busy. Choose Return to game to try again.',true);
    }
  }
  function challenge() {
    probe = Date.now().toString(36) + '-' + (++serial);
    send({type:'localserve-ps-probe',layouts:['split','hud'],appearance:true,layoutKey:infoKey,remoteKeys:remoteKeys});
    sendAppearance();
  }
  function switchLayout(next) {
    if (!validLayout(next) || !healthy || settingsOpen || document.hidden) return;
    if (!hdmi.layout(next)) send({type:'localserve-ps-native-status',message:'HDMI is busy. Try the display control again.'});
  }
  function cycleAppearance() {
    if (!healthy || settingsOpen || document.hidden) return;
    appearance.style = styles[(styles.indexOf(appearance.style) + 1) % styles.length];saveAppearance();
    if (layout !== 'hud') switchLayout('hud');
  }
  function updateOpacity() { node('opacity-value').textContent = node('hud-opacity').value + '%'; }
  node('hud-opacity').oninput = updateOpacity;
  function openPage() {
    hdmi.hide();attempted = false;healthy = false;settingsOpen = false;
    clearTimeout(guard);clearTimeout(healthGuard);node('connection').hidden = true;node('launcher').hidden = false;node('status').textContent = 'Connecting to Localserve…';
    if (!page) {
      page = document.createElement('iframe');page.id = 'page';page.title = 'PlayStation information';
      page.setAttribute('sandbox','allow-scripts allow-same-origin');page.onload = challenge;
      page.onerror = function () { healthy = false;settings('Unable to load the PlayStation screen. Check the server address.'); };
    }
    probe = '';page.src = defaultUrl;if (!page.parentNode) document.body.appendChild(page);
    guard = setTimeout(function () { healthy = false;settings('Localserve is unavailable. Enter its current server address.'); },20000);
  }
  window.addEventListener('message',function (event) {
    var data = event.data;
    if (!page || event.source !== page.contentWindow || event.origin !== origin() || !probe || !data || data.id !== probe || data.path !== '/playstation-mode' || document.hidden) return;
    if (data.type === 'localserve-ps-back') { exit();return; }
    if (data.type === 'localserve-ps-settings') { settings();return; }
    if (data.type === 'localserve-ps-layout-request') { switchLayout(data.layout);return; }
    if (data.type === 'localserve-ps-cycle') { cycleAppearance();return; }
    if (data.type !== 'localserve-ps-state' || typeof data.connected !== 'boolean') return;
    healthy = data.connected;node('resume').disabled = !healthy;
    if (!healthy) { settings('The PlayStation screen cannot read Localserve. Check the server connection.');return; }
    clearTimeout(guard);
    if (!settingsOpen) showGame();
  });
  node('connection').onsubmit = function (event) {
    consume(event);
    var next = VistaUrlTarget.settings({protocol:node('protocol').value,host:node('host').value.replace(/^\s+|\s+$/g,''),port:node('port').value,path:'/playstation-mode'});
    if (!next) { node('status').textContent = 'Enter a valid server IP or hostname and port from 1 to 65535.';return; }
    try { localStorage.setItem(storageKey,next); }
    catch (ignore) { node('status').textContent = 'This address could not be saved. It applies until the app closes.'; }
    if (validLayout(node('layout').value)) layout = node('layout').value;
    readAppearance();lockFields();defaultUrl = next;openPage();
  };
  node('resume').onclick = function () { if (validLayout(node('layout').value)) layout = node('layout').value;readAppearance();lockFields();attempted = false;showGame(); };
  function exit() { hdmi.hide();try { tizen.application.getCurrentApplication().exit(); } catch (ignore) {} }
  node('exit').onclick = exit;
  document.addEventListener('keydown',function (event) {
    if (event.repeat) return;
    var code = event.keyCode;
    if (code === 10009 || code === 27) { consume(event);exit();return; }
    if (remoteKeys.settings !== undefined && code === remoteKeys.settings) { consume(event);settings();return; }
    if (settingsOpen) {
      var active = document.activeElement;
      if (code === 13 && (active === node('host') || active === node('port'))) {
        active.readOnly = !active.readOnly;active.blur();active.focus();consume(event);
      } else if (code === 38 || code === 40) {
        lockFields();var ids = ['protocol','host','port','layout','hud-style','hud-opacity','save','resume','exit'].filter(function (id) { return !node(id).disabled; });
        var index = ids.indexOf(document.activeElement && document.activeElement.id);
        node(ids[(Math.max(0,index) + (code === 38 ? -1 : 1) + ids.length) % ids.length]).focus();consume(event);
      } else if ((code === 37 || code === 39) && (active === node('protocol') || active === node('layout') || active === node('hud-style'))) {
        active.selectedIndex = (active.selectedIndex + (code === 37 ? -1 : 1) + active.options.length) % active.options.length;consume(event);
      } else if ((code === 37 || code === 39) && active === node('hud-opacity')) {
        active.value = Math.max(0,Math.min(100,Number(active.value) + (code === 37 ? -5 : 5)));updateOpacity();consume(event);
      }
    } else if (healthy && (code === remoteKeys.toggle || code === remoteKeys.play || code === remoteKeys.pause)) {
      send({type:'localserve-ps-key',keyCode:code});consume(event);
    } else if (healthy && code === remoteKeys.cycle) { cycleAppearance();consume(event);
    } else if (healthy && infoKey !== null && code === infoKey) { switchLayout(layout === 'hud' ? 'split' : 'hud');consume(event);
    } else if (healthy && [13,37,38,39,40].indexOf(code) >= 0) {
      page.contentWindow.postMessage({type:'localserve-ps-key',id:probe,path:'/playstation-mode',keyCode:code},origin());consume(event);
    }
  });
  document.addEventListener('visibilitychange',function () {
    clearTimeout(resumeTimer);clearTimeout(guard);clearTimeout(healthGuard);hdmi.hide();healthy = false;attempted = false;probe = '';
    if (!document.hidden && started) resumeTimer = setTimeout(openPage,250);
  });
  window.addEventListener('pagehide',function () { hdmi.hide(); });
  window.addEventListener('appcontrol',function () { if (started && !document.hidden) { clearTimeout(resumeTimer);openPage(); } });
  window.addEventListener('load',function () {
    // Info is optional; Back → Display mode remains available on every remote.
    try { var key = tizen.tvinputdevice.getKey('Info');if (key && typeof key.code === 'number') { tizen.tvinputdevice.registerKey('Info');infoKey = key.code; } } catch (ignore) {}
    [['settings','ChannelUp'],['cycle','ChannelDown'],['toggle','MediaPlayPause'],['play','MediaPlay'],['pause','MediaPause']].forEach(function (entry) {
      try { var key = tizen.tvinputdevice.getKey(entry[1]);if (key && typeof key.code === 'number') { tizen.tvinputdevice.registerKey(entry[1]);remoteKeys[entry[0]] = key.code; } } catch (ignore) {}
    });
    setTimeout(function () { started = true;if (!document.hidden) openPage(); },250);
  });
}());
