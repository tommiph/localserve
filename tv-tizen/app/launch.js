(function () {
  'use strict';
  var defaultUrl = 'http://192.0.2.1:7041/display';
  var storageKey = 'localserve.vista.default-url.v1';
  try { defaultUrl = VistaUrlTarget.validUrl(localStorage.getItem(storageKey)) || defaultUrl; } catch (ignore) {}
  var target = defaultUrl;
  var page = null;
  var started = false;
  var pending = defaultUrl;
  var loadTimer = null;
  var showTimer = null;
  var freshWhileHidden = false;
  var resumedFromHidden = false;
  var notice = null;
  var settingsOpen = false, healthy = false, failure = '', healthTimer = null;
  var probeId = '', probeSerial = 0;
  var connectionGraceMs = 30000, connectionFailing = false;
  var launcher = document.getElementById('launcher');
  var status = document.getElementById('status');
  var pipOpen = false;
  var remoteKeys = {}, noticeSettings = false;
  var pip = VistaPip.create(typeof tizen === 'undefined' ? null : tizen, function (message, failed) {
    node('pip-status').textContent = message;
    if (failed && !document.hidden && !notice) {
      // Reporting a failed hide must not recursively issue another native call.
      clearTimeout(loadTimer); clearTimeout(healthTimer);
      settingsOpen = true; pipOpen = true; launcher.hidden = false; launcher.className = 'settings-open';
      node('loading-panel').hidden = true; node('launcher-actions').hidden = true;
      node('connection-settings').hidden = true; node('pip-panel').hidden = false;
      node('pip-hide').focus();
    }
  });

  function node(id) { return document.getElementById(id); }
  function clearConnectionTimers() {
    clearTimeout(loadTimer); loadTimer = null;
    clearTimeout(healthTimer); healthTimer = null;
    connectionFailing = false;
  }
  function lockFields() { ['server-host','server-port','server-path'].forEach(function (id) { node(id).readOnly = true; }); }
  function consume(event) {
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
  }
  function exitApplication() {
    pip.hide();clearTimeout(loadTimer);clearTimeout(healthTimer);clearTimeout(showTimer);closeNotice(false);
    try { tizen.application.getCurrentApplication().exit(); }
    catch (ignore) { status.textContent = 'Unable to close the app. Use the TV remote to leave it.'; }
  }
  function probeRemote(frame,url,id) {
    var remote = VistaUrlTarget.remote(url);
    if (remote) frame.contentWindow.postMessage({type:'localserve-viewer-probe',id:id,path:remote.viewerPath,remoteKeys:remoteKeys},remote.opaque ? '*' : remote.origin);
  }
  function dismissNotice(settingsAfter) {
    if (!notice) return;
    noticeSettings = settingsAfter === true;
    var current = notice;
    current.frame.contentWindow.postMessage({type:'localserve-notice-dismiss',id:current.id,restore:!noticeSettings},current.origin);
    clearTimeout(current.timer);current.timer = setTimeout(function () { if (notice === current) closeNotice(true); },400);
  }
  function showSettings(message) {
    pip.hide(); pipOpen = false; node('pip-panel').hidden = true;
    if (notice) { failure = message || ''; return; }
    clearConnectionTimers();
    status.textContent = message || 'Enter the Sormus server address.';
    launcher.hidden = false; launcher.className = 'settings-open';
    node('loading-panel').hidden = true; node('launcher-actions').hidden = true;
    node('connection-settings').hidden = false;
    if (!settingsOpen) {
      var values = VistaUrlTarget.parts(defaultUrl);
      node('server-protocol').value = values.protocol;
      node('server-host').value = values.host;
      node('server-port').value = values.port;
      node('server-path').value = values.path;
      lockFields();node('server-host').focus();
    }
    settingsOpen = true;
  }
  function hideSettings() {
    lockFields();
    pipOpen = false; node('pip-panel').hidden = true;
    settingsOpen = false; launcher.className = '';
    node('connection-settings').hidden = true;
    node('loading-panel').hidden = false; node('launcher-actions').hidden = false;
  }
  function armHealthTimer() {
    clearTimeout(healthTimer);
    healthTimer = null; connectionFailing = false;
    if (document.hidden || settingsOpen || !VistaUrlTarget.viewer(target)) return;
    healthTimer = setTimeout(function () {
      healthTimer = null;
      if (document.hidden || settingsOpen) return;
      healthy = false;
      showSettings('The server is not responding. Check its address and connection.');
    }, connectionGraceMs);
  }
  function deferConnectionFailure(message) {
    if (document.hidden || settingsOpen || loadTimer !== null || connectionFailing) return;
    // Keep the existing page during a brief outage. Repeated failed reports
    // share the first failure's deadline instead of postponing it indefinitely.
    connectionFailing = true;
    clearTimeout(healthTimer);
    healthTimer = setTimeout(function () {
      healthTimer = null;
      if (document.hidden || settingsOpen) return;
      healthy = false;
      showSettings(message);
    }, connectionGraceMs);
  }
  function leaveSettings() {
    if (page && healthy) { hideSettings(); launcher.hidden = true; page.focus(); armHealthTimer(); }
    else try { tizen.application.getCurrentApplication().exit(); } catch (ignore) {}
  }

  function refreshSources() {
    node('pip-show').disabled = true;
    node('pip-status').textContent = 'Reading connected inputs…';
    pip.discover(function (sources, message) {
      var select = node('pip-source');
      while (select.firstChild) select.removeChild(select.firstChild);
      sources.forEach(function (source) {
        var option = document.createElement('option'); option.value = source.id; option.textContent = source.label;
        select.appendChild(option);
      });
      node('pip-status').textContent = message;
      node('pip-show').disabled = !sources.length || !healthy || !VistaUrlTarget.viewer(target);
      if (sources.length && (!healthy || !VistaUrlTarget.viewer(target)))
        node('pip-status').textContent = 'Open a connected Vista before showing video.';
    });
  }
  function showPipSettings(refresh) {
    // Native video covers HTML; hide it before exposing local controls.
    pip.hide();
    if (!settingsOpen) showSettings();
    pipOpen = true; node('connection-settings').hidden = true; node('pip-panel').hidden = false;
    if (refresh !== false) refreshSources();
    node('pip-source').focus();
  }
  node('pip-settings').onclick = function () { showPipSettings(true); };
  node('pip-back').onclick = function () { showSettings(); node('pip-settings').focus(); };
  node('pip-refresh').onclick = refreshSources;
  node('pip-hide').onclick = function () { pip.hide(); };
  node('pip-show').onclick = function () {
    if (!healthy || document.hidden || notice || !VistaUrlTarget.viewer(target)) return;
    var source = node('pip-source').value, size = node('pip-size').value, corner = node('pip-corner').value;
    // Leave first so no native window is created over the settings form.
    leaveSettings();
    if (!pip.show(source, size, corner)) {
      showPipSettings(false); node('pip-status').textContent = 'Video is busy or unavailable. Hide video, then try again.';
    }
  };

  function requestedControl() {
    try {
      var request = tizen.application.getCurrentApplication().getRequestedAppControl();
      return request && request.appControl;
    } catch (ignore) { return null; }
  }

  function openPage(url, force) {
    // Keep the packaged parent alive: redirects would discard its appcontrol
    // listener, so a second Task could not replace an already displayed URL.
    if (!page) {
      page = document.createElement('iframe');
      page.id = 'page';
      page.title = 'Displayed page';
      page.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin');
      page.hidden = false;
      page.onload = function () {
        var viewer = VistaUrlTarget.viewer(target);
        probeRemote(page,target,probeId);
        if (viewer) {
          // A network-error document can also fire load. Only this navigation's
          // same-origin Vista response can confirm a working server connection.
        } else {
          clearConnectionTimers(); healthy = true;
          if (!settingsOpen) { launcher.hidden = true; page.focus(); }
        }
      };
      page.onerror = function () { deferConnectionFailure('Unable to open the page. Check the server address and Page URL path.'); };
    }
    if (force || target !== url || !page.getAttribute('src')) {
      pip.hide();
      target = url;
      hideSettings(); healthy = false; failure = '';
      probeId = Date.now().toString(36) + '-' + (++probeSerial);
      clearConnectionTimers();
      status.textContent = 'Opening page…';
      launcher.hidden = false;
      // Some old TV builds do not render a frame first navigated while hidden.
      // Keep its layout active; the packaged launcher covers it during loading.
      loadTimer = setTimeout(function () {
        healthy = false;
        showSettings('The page has not finished loading. Check its URL and connection, then try again.');
      }, connectionGraceMs);
      page.src = url;
      if (!page.parentNode) document.body.appendChild(page);
    } else if (healthy) {
      hideSettings(); launcher.hidden = true; page.focus(); armHealthTimer();
    }
  }

  function closeNotice(restore) {
    if (!notice) return;
    var previous = notice, openSettings = noticeSettings;noticeSettings = false;
    notice = null; clearTimeout(previous.timer);
    if (previous.frame.parentNode) previous.frame.parentNode.removeChild(previous.frame);
    // A user switch or a newer ordinary launch wins. Never exit an app that has
    // already moved to the background, or relaunch an unknown other application.
    if (!restore || document.hidden) return;
    if (openSettings) { showSettings();return; }
    if (previous.restore && page) {
      if (failure) { showSettings(failure); failure = ''; }
      else { launcher.hidden = true; page.focus(); }
    } else {
      exitApplication();
    }
  }

  function openTarget(url) {
    var definition = VistaUrlTarget.notice(url);
    if (!definition) { closeNotice(false); openPage(url, false); return; }
    // A duplicate launch must not replay audio or extend the countdown. The
    // server also admits only one notice lease, rather than queueing stale alerts.
    if (notice) return;
    pip.hide();
    var frame = document.createElement('iframe');
    frame.id = 'notice-page'; frame.title = 'TV notice';
    frame.onload = function () { if (notice === definition) probeRemote(frame,url,definition.id); };
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.setAttribute('allow', 'autoplay');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    definition.frame = frame;
    definition.path = VistaUrlTarget.parts(url).viewerPath;
    definition.restore = Boolean(page && !resumedFromHidden && !document.hidden);
    notice = definition;
    // A page that cannot report ready still releases the TV locally. No server
    // connection is needed to return, and there are no hidden-frame navigations.
    definition.timer = setTimeout(function () { if (notice === definition) closeNotice(true); }, 20000);
    frame.src = url;
    document.body.appendChild(frame);
    frame.focus();
  }

  window.addEventListener('message', function (event) {
    var viewer = VistaUrlTarget.viewer(target), remote = VistaUrlTarget.remote(target), data = event.data;
    if (remote && page && event.source === page.contentWindow && (event.origin === remote.origin || remote.opaque && event.origin === 'null')
      && data && data.id === probeId && data.path === remote.viewerPath && !document.hidden) {
      if (data.type === 'localserve-viewer-back' && !notice) { exitApplication();return; }
      if (data.type === 'localserve-viewer-settings' && !notice) { showSettings();return; }
      if (viewer && data.type === 'localserve-viewer-state' && typeof data.connected === 'boolean') {
        if (document.hidden) return;
        if (data.connected) {
          healthy = true; failure = '';
          clearTimeout(loadTimer); loadTimer = null;
          if (!settingsOpen && !notice) {
            var wasCovered = !launcher.hidden;
            launcher.hidden = true;
            if (wasCovered) page.focus();
          }
          armHealthTimer();
        } else deferConnectionFailure('Unable to read the server display. Check the server address and connection.');
        return;
      }
    }
    if (!notice || event.source !== notice.frame.contentWindow || event.origin !== notice.origin
      || !event.data || event.data.id !== notice.id) return;
    if (document.hidden) return;
    if(data.type==='localserve-notice-finishing' && !notice.finishing){
      notice.finishing=true;var finishing=notice;clearTimeout(finishing.timer);
      finishing.timer=setTimeout(function(){if(notice===finishing)closeNotice(true);},6500);return;
    }
    if (data.path === notice.path && data.type === 'localserve-viewer-back') { dismissNotice(false);return; }
    if (data.path === notice.path && data.type === 'localserve-viewer-settings') { dismissNotice(true);return; }
    if (event.data.type === 'localserve-notice-finished') { closeNotice(true); return; }
    if (event.data.type !== 'localserve-notice-ready' || notice.ready
      || typeof event.data.remainingMs !== 'number' || !isFinite(event.data.remainingMs)
      || (notice.seconds === 0 ? event.data.remainingMs !== 0
        : event.data.remainingMs <= 0 || event.data.remainingMs > notice.seconds * 1000)) return;
    var current = notice;
    current.ready = true; clearTimeout(current.timer);
    // Let the page finish/acknowledge its lease first. The one-second local
    // fallback still returns without a server or a responsive child document.
    current.timer = current.seconds === 0 ? null
      : setTimeout(function () { if (notice === current) closeNotice(true); }, event.data.remainingMs + 1000);
  });

  function handleLaunch() {
    pending = VistaUrlTarget.fromControl(requestedControl(), defaultUrl);
    if (document.hidden) {
      pip.hide();
      clearConnectionTimers();
      freshWhileHidden = true;
    } else if (started) {
      clearTimeout(showTimer);
      showTimer = null;
      openTarget(pending);
      resumedFromHidden = false;
    }
  }

  window.addEventListener('appcontrol', handleLaunch);
  document.addEventListener('visibilitychange', function () {
    clearTimeout(showTimer);
    showTimer = null;
    if (document.hidden) {
      clearConnectionTimers();
      pip.hide();
      closeNotice(false);
      resumedFromHidden = true;
      freshWhileHidden = false;
      pending = defaultUrl;
      return;
    }
    // A menu reopen can resume the same application without fresh appcontrol.
    // Do not re-read its cached last request: that would restore the old URL.
    // Give a new remote appcontrol event one task boundary to win instead.
    showTimer = setTimeout(function () {
      showTimer = null;
      if (!freshWhileHidden) pending = defaultUrl;
      freshWhileHidden = false;
      if (started) openTarget(pending);
      resumedFromHidden = false;
    }, 250);
  });
  document.getElementById('retry').onclick = function () {
    if (started) openPage(target, true);
  };
  node('settings').onclick = function () { showSettings(); };
  node('connection-back').onclick = leaveSettings;
  node('use-display').onclick = function () { node('server-path').value = '/display'; };
  node('connection-settings').onsubmit = function (event) {
    consume(event);
    var url = VistaUrlTarget.settings({protocol:node('server-protocol').value,
      host:node('server-host').value.replace(/^\s+|\s+$/g, ''),
      port:node('server-port').value, path:node('server-path').value});
    if (!url) { status.textContent = 'Enter a valid IP or hostname, port (1–65535) and path starting with /.'; return; }
    try { localStorage.setItem(storageKey, url); }
    catch (ignore) { status.textContent = 'This TV could not save the address. It will apply until the app closes.'; }
    defaultUrl = url; pending = url; openPage(url, true);
  };
  document.addEventListener('keydown', function (event) {
    if (event.repeat) return;
    var code = event.keyCode;
    if (remoteKeys.settings !== undefined && code === remoteKeys.settings) {
      consume(event);if (notice) dismissNotice(true);else showSettings();return;
    }
    if (!settingsOpen && (code === remoteKeys.toggle || code === remoteKeys.play || code === remoteKeys.pause)) {
      var remote = VistaUrlTarget.remote(notice ? notice.frame.src || notice.origin + '/tv-notices/' + notice.id : target);
      if (remote && (notice || page && healthy)) {
        var frame = notice ? notice.frame : page;
        frame.contentWindow.postMessage({type:'localserve-viewer-key',id:notice ? notice.id : probeId,path:remote.viewerPath,keyCode:code},remote.opaque ? '*' : remote.origin);
        consume(event);
      }
      return;
    }
    if (settingsOpen && !pipOpen && code === 13 && ['server-host','server-port','server-path'].indexOf(document.activeElement && document.activeElement.id) >= 0) {
      var input = document.activeElement;input.readOnly = !input.readOnly;input.blur();input.focus();consume(event);return;
    }
    if (settingsOpen && (code === 37 || code === 39)) {
      var select = document.activeElement;
      if (select && select.tagName === 'SELECT' && select.options.length) {
        select.selectedIndex = (select.selectedIndex + (code === 37 ? -1 : 1) + select.options.length) % select.options.length;
        consume(event); return;
      }
    }
    if (settingsOpen && (code === 38 || code === 40)) {
      lockFields();
      var controls = pipOpen ? ['pip-source','pip-size','pip-corner','pip-show','pip-hide','pip-refresh','pip-back']
        : ['server-protocol','server-host','server-port','server-path','connect','use-display','pip-settings','connection-back'];
      controls = controls.filter(function (id) { return !node(id).disabled; });
      var active = controls.indexOf(document.activeElement && document.activeElement.id);
      var next = (Math.max(0, active) + (code === 38 ? -1 : 1) + controls.length) % controls.length;
      node(controls[next]).focus(); consume(event); return;
    }
    if (!settingsOpen && !notice && healthy && (code === 37 || code === 39)) {
      var viewer = VistaUrlTarget.viewer(target);
      if (viewer) { page.contentWindow.postMessage({type:'localserve-viewer-key', id:probeId, keyCode:code}, viewer.origin); consume(event); }
      return;
    }
    if (event.keyCode === 10009 || event.keyCode === 27) {
      consume(event);
      if (notice) {
        // Give the child time to stop looping audio and release its durable
        // claim before removing the frame. The local fallback works offline.
        dismissNotice(false);
        return;
      }
      exitApplication();
    }
  });
  window.addEventListener('pagehide', function () { pip.hide(); });
  handleLaunch();
  // Tizen keeps its native splash until the packaged document finishes loading.
  // A remote iframe created during parsing/defer participates in that load and
  // can hold the splash indefinitely. Create it only after load, in a later task
  // so the local launcher can paint first. appcontrol events meanwhile only
  // update pending; startup uses the latest requested destination once.
  window.addEventListener('load', function () {
    [['settings','ChannelUp'],['toggle','MediaPlayPause'],['play','MediaPlay'],['pause','MediaPause']].forEach(function (entry) {
      try { var key = tizen.tvinputdevice.getKey(entry[1]);if (key && typeof key.code === 'number') { tizen.tvinputdevice.registerKey(entry[1]);remoteKeys[entry[0]] = key.code; } } catch (ignore) {}
    });
    setTimeout(function () {
      started = true;
      if (!document.hidden) openTarget(pending);
    }, 250);
  });
}());
