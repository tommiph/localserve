(function (root) {
  'use strict';
  var limit = 2048;

  function validUrl(value) {
    if (typeof value !== 'string' || value.length > limit) return null;
    value = value.replace(/^\s+|\s+$/g, '');
    // ES5/anchor parsing works on the 2017 TV. Reject credentials, backslashes
    // and control characters before its browser can normalize them away.
    if (!/^https?:\/\//i.test(value) || /[\x00-\x20\x7f\\]/.test(value)) return null;
    var authority = value.slice(value.indexOf('://') + 3).split(/[/?#]/)[0];
    if (!authority || authority.indexOf('@') !== -1) return null;
    var anchor = document.createElement('a');
    anchor.href = value;
    if (!anchor.hostname || !/^https?:$/.test(anchor.protocol)) return null;
    return anchor.href;
  }

  function payloadUrl(value) {
    var url = validUrl(value);
    if (url) return url;
    if (typeof value !== 'string' || value.length > limit) return null;
    try {
      var data = JSON.parse(value);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      url = validUrl(data.url);
      if (url) return url;
      // Samsung's remote launch may wrap metaTag in the PAYLOAD values member.
      url = validUrl(data.values);
      if (url) return url;
      if (typeof data.values === 'string' && data.values.length <= limit) {
        var values = JSON.parse(data.values);
        return values && validUrl(values.url);
      }
    } catch (ignore) {}
    return null;
  }

  function fromControl(control, fallback) {
    if (!control) return fallback;
    var url = validUrl(control.uri);
    if (url) return url;
    var entries = control.data;
    if (!Array.isArray(entries) || entries.length > 32) return fallback;
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (!entry || (entry.key !== 'PAYLOAD' && entry.key !== 'url')) continue;
      if (!Array.isArray(entry.value) || entry.value.length !== 1) continue;
      url = payloadUrl(entry.value[0]);
      if (url) return url;
    }
    return fallback;
  }

  function notice(value) {
    var match = /^(https?:\/\/[^/]+)\/tv-notices\/([a-f0-9]{48})\?seconds=([0-9.]+)$/.exec(validUrl(value) || '');
    if (!match) return null;
    var host = document.createElement('a'); host.href = match[1];
    var parts = host.hostname.split('.'), first = Number(parts[0]), second = Number(parts[1]);
    if (parts.length !== 4 || parts.some(function (part) { return !/^\d{1,3}$/.test(part) || Number(part) > 255; })
      || !(first === 10 || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168)) return null;
    var seconds = Number(match[3]);
    // Zero is an explicit untimed notice, never a zero-length return countdown.
    if (!isFinite(seconds) || seconds !== 0 && seconds < 1 || seconds > 3600) return null;
    return { id: match[2], origin: match[1], seconds: seconds };
  }
  root.VistaUrlTarget = { validUrl: validUrl, fromControl: fromControl, notice: notice };
}(this));
