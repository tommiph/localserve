/** Decorative standalone display, ES5 for older TV browsers. No device reads,
 * controls, network requests or administrator bindings are performed here. */
(function () {
  'use strict';
  var clockTimer, animationTimer;
  function padded(value) { return ('0' + value).slice(-2); }
  function updateClock() {
    var now = new Date();
    document.getElementById('live-clock').textContent = padded(now.getUTCHours()) + ':' + padded(now.getUTCMinutes()) + ':' + padded(now.getUTCSeconds());
    document.getElementById('live-date').textContent = now.getUTCFullYear() + '.' + padded(now.getUTCMonth() + 1) + '.' + padded(now.getUTCDate());
  }
  function animateDisplay() {
    var value = Math.floor(35 + Math.random() * 20);
    document.getElementById('gpu-val').textContent = value + '%';
    document.getElementById('gpu-bar').style.width = value + '%';
  }
  function logMessage(message) {
    var terminal = document.getElementById('terminal-log');
    var entry = document.createElement('div');
    entry.textContent = '[' + new Date().toTimeString().slice(3, 8) + '] ' + message;
    terminal.appendChild(entry);
    // Decorative button presses must not grow a long-lived TV document forever.
    while (terminal.children.length > 40) terminal.removeChild(terminal.firstChild);
    terminal.scrollTop = terminal.scrollHeight;
  }
  function switchView(mode) {
    document.getElementById('view-iframe').classList.toggle('hidden', mode !== 'iframe');
    document.getElementById('view-canvas').classList.toggle('hidden', mode === 'iframe');
    logMessage('Display context: ' + (mode === 'iframe' ? 'LOCAL VISUAL FEED' : 'HUD RADAR'));
  }
  function showDecorativeCommand(name) {
    var ticker = document.getElementById('status-ticker');
    ticker.textContent = 'DISPLAY: [' + name + ']';
    logMessage('Visual command: ' + name);
  }
  function synchronizeTimers() {
    clearInterval(clockTimer);
    clearInterval(animationTimer);
    if (document.hidden) return;
    updateClock();
    clockTimer = setInterval(updateClock, 1000);
    if (!displayPaused) animationTimer = setInterval(animateDisplay, 3000);
  }
  document.addEventListener('click', function (event) {
    var button = event.target;
    while (button && button !== document && button.tagName !== 'BUTTON') button = button.parentNode;
    if (!button || button === document) return;
    if (button.getAttribute('data-view')) switchView(button.getAttribute('data-view'));
    if (button.getAttribute('data-command')) showDecorativeCommand(button.getAttribute('data-command'));
  });
  document.addEventListener('visibilitychange', synchronizeTimers);
  window.addEventListener('pagehide', function () {
    clearInterval(clockTimer); clearInterval(animationTimer);
  });
  var displayPaused = false;
  if (window.LocalserveTvViewer) window.LocalserveTvViewer.install(null,{pause:function (mode) {
    displayPaused = mode === 'play' ? false : mode === 'pause' ? true : !displayPaused;
    document.documentElement.setAttribute('data-tv-paused',String(displayPaused));
    document.getElementById('status-ticker').textContent = displayPaused ? 'DISPLAY PAUSED · PLAY/PAUSE TO RESUME' : 'DISPLAY RUNNING';
    synchronizeTimers();
  }});
  switchView('canvas');
  synchronizeTimers();
}());
