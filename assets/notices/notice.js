/* ES5 page shared by TV presentation and a silent administrator preview.
   Completion permits only this notice's previously captured one-use app return. */
(function () {
  'use strict';
  var match = /^\/tv-notices\/([a-f0-9]{48})$/.exec(location.pathname);
  var preview = location.search === '?preview=1';
  var token = match && match[1], timer = null, pollTimer = null, audio = null, finished = false;
  var content, endsAt, presented = false;
  var audioEngine = null, bufferSource = null, soundRequest = null;
  var soundPaused = false, soundGain = null;
  if (window.LocalserveTvViewer) window.LocalserveTvViewer.install(null,{pause:function (mode) {
    soundPaused = mode === 'play' ? false : mode === 'pause' ? true : !soundPaused;
    if (soundGain) soundGain.gain.value = soundPaused ? 0 : 1;
    if (audio) audio.muted = soundPaused;
    text('sound-status',soundPaused ? 'Sound muted · Play/Pause to resume' : content && content.sound ? 'Sound unmuted' : 'Sound off');
  }});
  function stopBufferedSound() {
    if (soundRequest) { soundRequest.abort(); soundRequest = null; }
    if (bufferSource) { try { bufferSource.stop(0); } catch (ignore) {} bufferSource = null; }
    if (audioEngine) {
      try { var closed = audioEngine.close(); if (closed && closed.catch) closed.catch(function () {}); } catch (ignore) {}
      audioEngine = null;
    }
  }
  function elapsedText(milliseconds) {
    var total = Math.max(0, Math.floor(milliseconds / 1000));
    var seconds = total % 60, minutes = Math.floor(total / 60) % 60, hours = Math.floor(total / 3600);
    function pad(value) { return value < 10 ? '0' + value : String(value); }
    return 'Open for ' + (hours ? pad(hours) + ':' : '') + pad(minutes) + ':' + pad(seconds);
  }
  function text(id, value) { document.getElementById(id).textContent = value; }
  function parentMessage(type, remainingMs) {
    if (!preview && window.parent !== window) window.parent.postMessage({ type: type, id: token, remainingMs: remainingMs }, '*');
  }
  function report(status, callback) {
    var request = new XMLHttpRequest();
    request.open('POST', '/api/tv-notices/' + token);
    request.timeout = 5000;
    request.setRequestHeader('Content-Type', 'application/json');
    request.onload = function () {
      if (request.status !== 200) return callback(null);
      try { callback(JSON.parse(request.responseText)); } catch (ignore) { callback(null); }
    };
    request.onerror = request.ontimeout = function () { callback(null); };
    request.send(JSON.stringify({ status: status }));
  }
  function finish(allowReturn) {
    if (finished || preview) return;
    finished = true; clearInterval(timer); clearInterval(pollTimer);
    stopBufferedSound();
    if (audio) { audio.loop = false; audio.pause(); audio.src = ''; }
    // Give the server one bounded chance to restore its captured app. The
    // packaged parent still closes locally when the server is unavailable.
    var returned = false;
    var restore = allowReturn !== false && !document.hidden;
    if(restore)parentMessage('localserve-notice-finishing');
    function returnToTv() {
      if (returned) return;
      returned = true; parentMessage('localserve-notice-finished');
    }
    report(restore ? 'finished' : 'abandoned', returnToTv);
    setTimeout(returnToTv, 6500);
  }
  function show(value) {
    if (!value || ['Notice', 'Alarm', 'Alert', 'Warning'].indexOf(value.template) < 0
      || typeof value.title !== 'string' || value.title.length > 120 || typeof value.message !== 'string' || value.message.length > 2000
      || typeof value.seconds !== 'number' || value.seconds < 1 || value.seconds > 3600) return;
    content = value;
    var automatic = value['auto-close'] !== false;
    document.body.setAttribute('data-template', value.template.toLowerCase());
    document.title = value.template + ' · ' + value.title;
    text('notice-type', value.template); text('notice-title', value.title);
    text('notice-message', value.message); text('server-name', value.serverName || 'Localserve');
    var factor = Math.max(.8, Math.min(1.3, (Number(value.fontScale) || 100) / 100));
    document.getElementById('notice-title').style.fontSize = 64 * factor + 'px';
    document.getElementById('notice-message').style.fontSize = 30 * factor + 'px';
    document.querySelector('header').style.fontSize = 18 * factor + 'px';
    document.querySelector('footer').style.fontSize = 18 * factor + 'px';
    document.querySelector('.remaining-track').style.display = automatic ? '' : 'none';
    if (preview) {
      text('return-label', 'Preview · sound off');
      text('countdown', automatic ? value.seconds + ' seconds' : elapsedText(0));
      if (!automatic) {
        var previewStart = Date.now();
        timer = setInterval(function () { text('countdown', elapsedText(Date.now() - previewStart)); }, 1000);
      }
      return;
    }
    if (finished || document.hidden) return finish();
    report('shown', function (response) {
      if (!response || finished) return;
      if (response.dismissed) return finish();
      if (document.hidden) return finish();
      presented = true;
      var remaining = automatic ? Math.max(0, Math.min(value.seconds * 1000, response.remainingMs)) : 0;
      if (automatic && !remaining) return finish();
      endsAt = Date.now() + remaining;
      var openedAt = Date.now() - Math.max(0, Number(response.elapsedMs) || 0);
      text('return-label', automatic ? 'Automatic return' : 'Press Back to dismiss');
      parentMessage('localserve-notice-ready', remaining);
      if (value.sound === true && response.first === true) {
        var soundReported = false, soundStopped = false;
        function soundPlaying() {
          if (soundReported || finished || soundStopped) return;
          soundReported = true;
          report('sound-playing', function () {});
        }
        function soundFailed() {
          if (finished || soundStopped) return;
          soundStopped = true; stopBufferedSound();
          if (audio) { audio.loop = false; audio.pause(); }
          text('sound-status', 'Sound unavailable');
          report('sound-unavailable', function () {});
        }
        var soundUrl = '/assets/notices/' + value.template.toLowerCase() + '.wav';
        var AudioEngine = window.AudioContext || window.webkitAudioContext;
        if (value['loop-sound'] === true && typeof AudioEngine === 'function') {
          // Decode our small local PCM cue once. The audio engine loops its
          // sample buffer without WAV seeks, repeated fetches or JS timers.
          try {
            audioEngine = new AudioEngine();
            soundRequest = new XMLHttpRequest();
            soundRequest.open('GET', soundUrl); soundRequest.responseType = 'arraybuffer'; soundRequest.timeout = 5000;
            soundRequest.onload = function () {
              var reply = soundRequest; soundRequest = null;
              if (finished || soundStopped) return;
              if (reply.status !== 200 || !reply.response || reply.response.byteLength > 65536) return soundFailed();
              audioEngine.decodeAudioData(reply.response, function (buffer) {
                if (finished || soundStopped || document.hidden || !audioEngine) return;
                try {
                  bufferSource = audioEngine.createBufferSource();
                  bufferSource.buffer = buffer; bufferSource.loop = true;
                  soundGain = audioEngine.createGain();soundGain.gain.value = soundPaused ? 0 : 1;
                  bufferSource.connect(soundGain);soundGain.connect(audioEngine.destination);
                  function startLoop() {
                    if (finished || soundStopped || document.hidden || !bufferSource) return;
                    try { bufferSource.start(0); soundPlaying(); } catch (ignore) { soundFailed(); }
                  }
                  if (audioEngine.state === 'suspended' && audioEngine.resume) {
                    var resumed = audioEngine.resume();
                    if (resumed && resumed.then) resumed.then(startLoop, soundFailed); else startLoop();
                  } else startLoop();
                } catch (ignore) { soundFailed(); }
              }, soundFailed);
            };
            soundRequest.onerror = soundRequest.ontimeout = soundFailed;
            soundRequest.send();
          } catch (ignore) { soundFailed(); }
        } else {
          audio = document.createElement('audio');
          // Some older Tizen browsers play a WAV once despite HTMLMediaElement.loop.
          // Restart this already-loaded local cue only after a natural end. This
          // is requested repetition, never a retry after a media/network failure.
          audio.loop = false;
          audio.muted = soundPaused;
          audio.src = soundUrl;
          // Sound ownership still belongs to the first claimed presentation;
          // repeating a cue never creates another reception write or sound claim.
          audio.onplaying = soundPlaying;
          audio.onerror = soundFailed;
          function playChime() {
            if (finished || soundStopped || document.hidden) return;
            try { var play = audio.play(); if (play && play.catch) play.catch(soundFailed); }
            catch (ignore) { soundFailed(); }
          }
          audio.onended = function () {
            if (value['loop-sound'] !== true || finished || soundStopped || document.hidden) return;
            try { audio.currentTime = 0; } catch (ignore) { return soundFailed(); }
            playChime();
          };
          playChime();
        }
      }
      function tick() {
        if (!automatic) { text('countdown', elapsedText(Date.now() - openedAt)); return; }
        var left = Math.max(0, endsAt - Date.now());
        text('countdown', Math.ceil(left / 1000) + ' seconds');
        document.getElementById('remaining').style.width = Math.min(100, left / (value.seconds * 1000) * 100) + '%';
        if (!left) finish();
      }
      tick(); timer = setInterval(tick, 250);
      if (!automatic) {
        var pollBusy = false;
        // Poll only this capability for explicit administrator dismissal. A
        // server outage leaves the requested untimed screen/audio running.
        pollTimer = setInterval(function () {
          if (pollBusy || finished) return;
          pollBusy = true;
          var check = new XMLHttpRequest();
          check.open('GET', '/api/tv-notices/' + token); check.timeout = 5000;
          check.onload = function () {
            pollBusy = false;
            if (check.status === 404) return finish();
            if (check.status === 200) try { if (JSON.parse(check.responseText).dismissed) finish(); } catch (ignore) {}
          };
          check.onerror = check.ontimeout = function () { pollBusy = false; };
          check.send();
        }, 5000);
      }
    });
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden && presented) finish(false); });
  document.addEventListener('keydown', function (event) {
    if (event.keyCode === 10009 || event.keyCode === 27) { event.preventDefault(); finish(); }
  });
  window.addEventListener('message', function (event) {
    if (!preview && window.parent !== window && event.source === window.parent
      && event.data && event.data.type === 'localserve-notice-dismiss' && event.data.id === token) finish(event.data.restore !== false);
  });
  window.addEventListener('pagehide', function(){finish(false);});
  if (preview) {
    try { show(JSON.parse(decodeURIComponent(location.hash.slice(1)))); } catch (ignore) {}
  } else if (token) {
    var request = new XMLHttpRequest();
    request.open('GET', '/api/tv-notices/' + token); request.timeout = 5000;
    request.onload = function () { if (request.status === 200) try { show(JSON.parse(request.responseText)); } catch (ignore) {} };
    request.send();
  }
}());
