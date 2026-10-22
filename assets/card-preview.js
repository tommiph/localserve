/* Same-origin JPEG preview for inert ready-made cards, including ES5 TV hosts. */
(function () {
  'use strict';
  window.LocalserveCardPreview = {
    attach: function (frame, url, active, inactiveLabel) {
      var doc = frame.contentDocument, image = doc && doc.querySelector('[data-card-preview]');
      if (!image) return;
      function label(value) {
        var labels = doc.querySelectorAll('[data-card-preview-status]');
        for (var n = 0; n < labels.length; n += 1) labels[n].textContent = value;
      }
      var previous = frame._preview;
      if (previous && previous.document === doc && previous.url === url && previous.active === active) {
        label(active ? previous.status : inactiveLabel || 'No live frame'); return;
      }
      if (previous) previous.stop();
      if (!active || !/^\/api\/plugin-preview\/[a-z][a-z0-9-]{0,63}\/frame\.jpg$/.test(url || '')) {
        image.removeAttribute('src'); image.style.visibility = 'hidden'; label(inactiveLabel || 'No live frame'); return;
      }
      // Keep a decoded front image intact while its hidden sibling loads.
      var buffer = image.cloneNode(false);
      buffer.removeAttribute('id'); buffer.removeAttribute('src'); buffer.style.visibility = 'hidden';
      image.parentNode.insertBefore(buffer, image.nextSibling);
      var images = [image, buffer], front = null, pending = null;
      var stopped = false, timer = null, probe = null, deadline = null, serial = 0, state;
      function status(value) { if (state) state.status = value; label(value); }
      function clearImages() {
        serial += 1;
        for (var i = 0; i < images.length; i += 1) {
          images[i].removeAttribute('src'); images[i].style.visibility = 'hidden';
        }
        front = pending = null;
        status('No live frame');
      }
      function stop() {
        if (frame._preview === state) state.active = false;
        stopped = true; clearTimeout(timer); clearTimeout(probe); clearTimeout(deadline); clearImages();
        if (buffer.parentNode) buffer.parentNode.removeChild(buffer);
      }
      function attached() {
        return document.documentElement.contains(frame) && frame.contentDocument === doc;
      }
      function hidden() { return document.hidden || !frame.getClientRects().length; }
      function next() {
        if (stopped) return;
        if (!attached()) { stop(); return; }
        if (hidden()) { clearImages(); status('Preview hidden'); timer = setTimeout(next, 500); return; }
        var target = front === image ? buffer : image, request = ++serial;
        pending = target; target.style.visibility = 'hidden';
        target.removeAttribute('src');
        function current() { return pending === target && !stopped && request === serial; }
        function finish(success) {
          if (!current()) return;
          pending = null; clearTimeout(probe); clearTimeout(deadline);
          if (!success) { clearImages(); timer = setTimeout(next, 1000); return; }
          // Swap only complete frames; never change the parent Card's fade.
          target.style.visibility = 'visible';
          if (front) front.style.visibility = 'hidden';
          front = target; status('Live'); timer = setTimeout(next, 200);
        }
        function ready() {
          if (!current()) return;
          if (!attached()) { stop(); return; }
          if (hidden()) { finish(false); return; }
          // Older Chromium can block load/error handlers on nodes inside an
          // inert sandbox. Read decoded image state from this host's timer.
          if (target.complete) { finish(target.naturalWidth > 0); return; }
          probe = setTimeout(ready, 40);
        }
        deadline = setTimeout(function () { finish(false); }, 2500);
        target.src = url + '?v=' + new Date().getTime();
        probe = setTimeout(ready, 40);
      }
      state = frame._preview = {url: url, document: doc, active: active, stop: stop, status: 'Waiting for frame'};
      status(state.status);
      next();
    }
  };
}());
