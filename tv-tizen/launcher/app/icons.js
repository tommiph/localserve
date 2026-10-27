/* Read installed apps' Smart Hub cache artwork, then their reported icon path.
 * Only current inventory IDs reach this reader. Rasterize locally
 * before sharing pixels with the provider; no paths or original metadata leave
 * the packaged parent. Missing/denied icons are cached as glyph fallbacks. */
(function (root) {
  'use strict';
  function iconUri(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x1f\x7f\\?#]/.test(value) || /(?:^|\/)\.\.?(?:\/|$)/.test(value)) return null;
    if (value.indexOf('file:///') === 0) return value;
    return value.charAt(0) === '/' && value.charAt(1) !== '/' ? 'file://' + value : null;
  }
  function rasterize(data,complete) {
    var image = new Image();
    image.onload = function () {
      try {
        var width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
        // ApplicationInformation can point at a square package placeholder,
        // unrelated to the store banner. Accept genuinely widescreen art only.
        if (!width || !height || width > 4096 || height > 4096 || Math.abs(width / height - 16 / 9) > .12) { complete(null);return; }
        var canvas = document.createElement('canvas');canvas.width = 160;canvas.height = 90;
        var scale = Math.min(160 / width,90 / height), context = canvas.getContext('2d');
        context.drawImage(image,(160 - width * scale) / 2,(90 - height * scale) / 2,width * scale,height * scale);
        var value = canvas.toDataURL('image/png');complete(value.length <= 65536 ? value : null);
      } catch (ignore) { complete(null); }
    };
    image.onerror = function () { complete(null); };image.src = data;
  }
  function smartHubUri(app) {
    // This is the TV operating system's app-scoped cache, not a PC path.
    return app && typeof app.id === 'string' && /^[\w.-]{1,128}$/.test(app.id) && app.id !== '.' && app.id !== '..'
      ? 'file:///opt/share/webappservice/apps_icon/FirstScreen/' + app.id + '/167x94.png' : null;
  }
  function smartHubIds(app,application) {
    var ids = [app.id], metadata = [];
    function add(value) {
      if (typeof value !== 'string') return;
      var match = /\/FirstScreen\/([\w.-]{1,128})\//.exec(value), id = match ? match[1] : /^\d{8,14}$/.test(value) ? value : null;
      if (id && smartHubUri({id:id}) && ids.indexOf(id) < 0 && ids.length < 5) ids.push(id);
    }
    add(app.iconPath);
    try { metadata = application.getAppMetaData(app.id); } catch (ignore) {}
    if (Array.isArray(metadata)) metadata.slice(0,64).forEach(function (entry) {
      if (entry) add(entry.value);
    });
    return ids;
  }
  function create(filesystem,decode) {
    var cache = {}, order = [], bytes = 0;decode = decode || rasterize;
    function retain(key,value) {
      cache[key] = value;order.push(key);bytes += value ? value.length : 0;
      while (order.length > 256 || bytes > 8 * 1024 * 1024) {
        var oldest = order.shift();bytes -= cache[oldest] ? cache[oldest].length : 0;delete cache[oldest];
      }
    }
    return {read:function (app,complete) {
      var key = JSON.stringify([app.id,app.version || '',app.iconPath || '',app.artworkIds || []]);
      if (Object.prototype.hasOwnProperty.call(cache,key)) { complete(cache[key]);return; }
      var candidates = (app.artworkIds || [app.id]).slice(0,5).map(function (id) { return smartHubUri({id:id}); }).concat([iconUri(app.iconPath)]).filter(function (uri,index,list) { return uri && list.indexOf(uri) === index; });
      var finished = false, stream = null;
      function done(value) {
        if (finished) return;finished = true;clearTimeout(timer);
        if (stream) { try { stream.close(); } catch (ignore) {}stream = null; }
        value = typeof value === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 65536 ? value : null;
        retain(key,value);complete(value);
      }
      var timer = setTimeout(function () { done(null); },3000);
      if (!filesystem || typeof filesystem.resolve !== 'function') { done(null);return; }
      function next() {
        if (finished) return;
        var uri = candidates.shift();if (!uri) { done(null);return; }
        try { filesystem.resolve(uri,function (file) {
        if (finished) return;
        if (!file.isFile || !isFinite(file.fileSize) || file.fileSize < 8 || file.fileSize > 262144) { next();return; }
        file.openStream('r',function (opened) {
          if (finished) { try { opened.close(); } catch (ignore) {}return; }
          stream = opened;
          try {
            var value = stream.readBase64(file.fileSize);stream.close();stream = null;
            var mime = /^iVBORw0KGgo/.test(value) ? 'image/png' : /^\/9j\//.test(value) ? 'image/jpeg' : null;
            if (!mime || value.length > 349528) { next();return; }
            decode('data:' + mime + ';base64,' + value,function (image) { if (image) done(image);else next(); });
          } catch (ignore) { if (stream) { try { stream.close(); } catch (ignored) {}stream = null; }next(); }
        },next);
      },next,'r'); } catch (ignore) { next(); }
      }
      next();
    }};
  }
  root.LauncherIcons = {create:create,iconUri:iconUri,smartHubUri:smartHubUri,smartHubIds:smartHubIds};
}(this));
