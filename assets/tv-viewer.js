/* Read-only Vista connection status and remote keys for a packaged TV parent.
   The session is a navigation challenge, never an administrator capability. */
(function (root) {
  'use strict';
  var session = null, connected = null, step = null, pause = null, remoteKeys = {};
  function path() { return location.pathname + (location.search || ''); }
  function parentFrame() { return root.parent && root.parent !== root; }
  function report() {
    if (!session || connected === null || !parentFrame()) return;
    root.parent.postMessage({type:'localserve-viewer-state', id:session,
      path:path(), connected:connected}, '*');
  }
  function consume(event) {
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
  }
  function move(code) {
    return !document.hidden && connected === true && step && (code === 37 || code === 39)
      ? step(code === 37 ? -1 : 1) : false;
  }
  root.LocalserveTvViewer = {
    state:function (value) { connected = value === true; report(); },
    install:function (callback, controls) { step = callback;pause = controls && controls.pause || null; }
  };
  function remote(code) {
    if (!session || !parentFrame() || document.hidden) return false;
    if (code === 10009 || code === 27 || code === remoteKeys.settings) {
      root.parent.postMessage({type:code === remoteKeys.settings ? 'localserve-viewer-settings' : 'localserve-viewer-back',id:session,path:path()},'*');return true;
    }
    if (pause && (code === remoteKeys.toggle || code === remoteKeys.play || code === remoteKeys.pause)) {
      pause(code === remoteKeys.play ? 'play' : code === remoteKeys.pause ? 'pause' : 'toggle');return true;
    }
    return false;
  }
  root.addEventListener('message', function (event) {
    if (!parentFrame() || event.source !== root.parent
      || event.origin !== 'null' && event.origin !== 'file://' && event.origin !== location.origin) return;
    var data = event.data;
    if (!data || typeof data.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(data.id)) return;
    if (data.type === 'localserve-viewer-probe' && data.path === path()) {
      session = data.id;remoteKeys = {};
      ['settings','toggle','play','pause'].forEach(function (name) {
        var code = data.remoteKeys && data.remoteKeys[name];
        if (typeof code === 'number' && isFinite(code) && Math.floor(code) === code && (code > 40 && code < 65536 || name === 'pause' && code === 19)) remoteKeys[name] = code;
      });report();
    } else if (data.type === 'localserve-viewer-key' && session === data.id) { if (!remote(data.keyCode)) move(data.keyCode); }
  });
  document.addEventListener('keydown', function (event) {
    if (event.repeat || document.hidden) return;
    if (remote(event.keyCode)) { consume(event);return; }
    var tag = event.target && event.target.tagName;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag || '') || event.target && event.target.isContentEditable) return;
    var code = event.keyCode || (event.key === 'ArrowLeft' ? 37 : event.key === 'ArrowRight' ? 39 : 0);
    if (move(code)) { consume(event); return; }
  },true);
}(window));
