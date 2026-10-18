(function () {
  'use strict';
  var defaultUrl = 'http://192.0.2.1:7041/display';
  var target = defaultUrl;
  var page = null;
  var started = false;
  var pending = defaultUrl;
  var loadTimer = null;
  var showTimer = null;
  var freshWhileHidden = false;
  var resumedFromHidden = false;
  var notice = null;
  var launcher = document.getElementById('launcher');
  var status = document.getElementById('status');

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
        clearTimeout(loadTimer);
        loadTimer = null;
        launcher.hidden = true;
      };
    }
    if (force || target !== url || !page.getAttribute('src')) {
      target = url;
      clearTimeout(loadTimer);
      status.textContent = 'Opening page…';
      launcher.hidden = false;
      // Some old TV builds do not render a frame first navigated while hidden.
      // Keep its layout active; the packaged launcher covers it during loading.
      loadTimer = setTimeout(function () {
        status.textContent = 'The page has not finished loading. Check its URL and connection, then try again.';
        launcher.hidden = false;
        document.getElementById('retry').focus();
      }, 20000);
      page.src = url;
      if (!page.parentNode) document.body.appendChild(page);
    }
  }

  function closeNotice(restore) {
    if (!notice) return;
    var previous = notice;
    notice = null; clearTimeout(previous.timer);
    if (previous.frame.parentNode) previous.frame.parentNode.removeChild(previous.frame);
    // A user switch or a newer ordinary launch wins. Never exit an app that has
    // already moved to the background, or relaunch an unknown other application.
    if (!restore || document.hidden) return;
    if (previous.restore && page) {
      launcher.hidden = true;
      page.focus();
    } else {
      try { tizen.application.getCurrentApplication().exit(); }
      catch (ignore) { pending = defaultUrl; openPage(defaultUrl, false); }
    }
  }

  function openTarget(url) {
    var definition = VistaUrlTarget.notice(url);
    if (!definition) { closeNotice(false); openPage(url, false); return; }
    // A duplicate launch must not replay audio or extend the countdown. The
    // server also admits only one notice lease, rather than queueing stale alerts.
    if (notice) return;
    var frame = document.createElement('iframe');
    frame.id = 'notice-page'; frame.title = 'TV notice';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.setAttribute('allow', 'autoplay');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    definition.frame = frame;
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
    if (!notice || event.source !== notice.frame.contentWindow || event.origin !== notice.origin
      || !event.data || event.data.id !== notice.id) return;
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
  document.addEventListener('keydown', function (event) {
    if (event.keyCode === 10009 || event.keyCode === 27) {
      if (notice) {
        // Give the child time to stop looping audio and release its durable
        // claim before removing the frame. The local fallback works offline.
        var current = notice;
        current.frame.contentWindow.postMessage({type: 'localserve-notice-dismiss', id: current.id}, current.origin);
        clearTimeout(current.timer);
        current.timer = setTimeout(function () { if (notice === current) closeNotice(true); }, 400);
        return;
      }
      try { tizen.application.getCurrentApplication().exit(); } catch (ignore) {}
    }
  });
  handleLaunch();
  // Tizen keeps its native splash until the packaged document finishes loading.
  // A remote iframe created during parsing/defer participates in that load and
  // can hold the splash indefinitely. Create it only after load, in a later task
  // so the local launcher can paint first. appcontrol events meanwhile only
  // update pending; startup uses the latest requested destination once.
  window.addEventListener('load', function () {
    setTimeout(function () {
      started = true;
      if (!document.hidden) openTarget(pending);
    }, 250);
  });
}());
