/* Native video belongs to the packaged parent, never its web frames. A late
 * show callback is followed by hide after navigation or application switches. */
(function (root) {
  'use strict';
  function rectangle(size, corner) {
    var width = Number(size);
    if ([25, 33, 50].indexOf(width) < 0 || ['tl','tr','bl','br'].indexOf(corner) < 0) return null;
    return [(corner.charAt(1) === 'r' ? 98 - width : 2) + '%',
      (corner.charAt(0) === 'b' ? 98 - width : 2) + '%', width + '%', width + '%'];
  }
  function create(api, report) {
    var sources = [], generation = 0, reading = 0, busy = false, mayBeVisible = false, hideRequested = false;
    var supported = Boolean(api && api.tvwindow && api.systeminfo);
    function errorText(error) {
      return error && error.name === 'SecurityError' ? 'TV permission was denied.'
        : error && error.name === 'NotSupportedError' ? 'This TV cannot display that video window.'
        : 'The TV could not complete the video operation. Check the input and try explicitly again.';
    }
    function drain() {
      if (busy || !hideRequested || !mayBeVisible) return;
      hideRequested = false; busy = true;
      try {
        api.tvwindow.hide(function () { busy = false; mayBeVisible = false; report('Video window hidden.'); },
          function (error) { busy = false; report(errorText(error), true); }, 'MAIN');
      } catch (error) { busy = false; report(errorText(error), true); }
    }
    return {
      supported: supported,
      discover: function (complete) {
        var request = ++reading;
        if (!supported) { complete([], 'Live TV / HDMI is available only in the installed Samsung TV app.'); return; }
        try {
          api.systeminfo.getPropertyValue('VIDEOSOURCE', function (value) {
            if (request !== reading) return;
            sources = (value.connected || []).filter(function (source) {
              return source && (source.type === 'TV' || source.type === 'HDMI')
                && typeof source.number === 'number' && isFinite(source.number);
            });
            complete(sources.map(function (source, index) {
              return {id:String(index), label:source.type === 'TV' ? 'Live TV' : 'HDMI ' + source.number};
            }), sources.length ? 'Select a source, then Show video.' : 'No connected TV or HDMI sources were reported.');
          }, function (error) { if (request === reading) { sources = []; complete([], errorText(error)); } });
        } catch (error) { sources = []; complete([], errorText(error)); }
      },
      show: function (id, size, corner) {
        var rect = rectangle(size, corner), source = sources[Number(id)];
        if (!supported || busy || mayBeVisible || !rect || !/^(0|[1-9][0-9]*)$/.test(id) || !source) return false;
        var request = ++generation;
        hideRequested = false; busy = true; report('Selecting video source…');
        function failed(error) {
          busy = false;
          if (request === generation) report(errorText(error), true);
          drain();
        }
        try {
          api.tvwindow.setSource(source, function () {
            busy = false;
            if (request !== generation) { drain(); return; }
            busy = true; mayBeVisible = true;
            try {
              api.tvwindow.show(function () {
                busy = false;
                if (request !== generation) { drain(); return; }
                report('Video window shown.');
              }, function (error) { hideRequested = true; failed(error); }, rect, 'MAIN', 'FRONT');
            } catch (error) { hideRequested = true; failed(error); }
          }, failed, 'MAIN');
        } catch (error) { failed(error); }
        return true;
      },
      hide: function () { generation++; hideRequested = true; drain(); }
    };
  }
  root.VistaPip = {create:create, rectangle:rectangle};
}(this));
