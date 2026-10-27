/* Presentation preferences never contain credentials or shortcut capabilities. */
(function (root) {
  'use strict';
  function validKey(value) { return typeof value === 'string' && /^(?:app|input|display|scene|task):[a-zA-Z0-9_.:-]{1,180}$/.test(value); }
  function validApp(value) { return typeof value === 'string' && /^[\w.-]{1,128}$/.test(value); }
  function library(value) {
    value = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {query:typeof value.query === 'string' ? value.query.replace(/[\x00-\x1f\x7f]/g,'').slice(0,80) : '',
      key:validKey(value.key) && value.key.indexOf('app:') === 0 ? value.key : null,
      top:typeof value.top === 'number' && isFinite(value.top) ? Math.max(0,Math.min(100000,Math.round(value.top))) : 0};
  }
  function preferences(value) {
    var result = {theme:'aurora',motion:true,artwork:'icons',tileStyle:'labeled',favorites:[],customized:false,hiddenApps:[],library:library(null)};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
    if (['aurora','midnight','ember'].indexOf(value.theme) >= 0) result.theme = value.theme;
    result.motion = value.motion !== false;result.customized = value.customized === true;
    if (value.artwork === 'glyphs') result.artwork = 'glyphs';
    if (value.tileStyle === 'artwork') result.tileStyle = 'artwork';
    if (Array.isArray(value.favorites)) value.favorites.slice(0,64).forEach(function (key) {
      if (validKey(key) && result.favorites.indexOf(key) < 0) result.favorites.push(key);
    });
    if (Array.isArray(value.hiddenApps)) value.hiddenApps.slice(0,256).forEach(function (id) {
      if (validApp(id) && result.hiddenApps.indexOf(id) < 0) result.hiddenApps.push(id);
    });
    result.library = library(value.library);
    return result;
  }
  function favorites(items,prefs) {
    var visible = items.filter(function (item) { return item.kind !== 'app' || prefs.hiddenApps.indexOf(item.id) < 0; });
    var keys = prefs.customized ? prefs.favorites : visible.filter(function (item) { return item.kind === 'app'; }).slice(0,5).map(function (item) { return item.key; });
    if (!prefs.customized && items.some(function (item) { return item.key === 'display:display'; })) keys.push('display:display');
    return keys.map(function (key) { return visible.filter(function (item) { return item.key === key; })[0]; }).filter(Boolean);
  }
  function apps(items,prefs,includeHidden) {
    var query = prefs.library.query.trim().toLowerCase();
    return items.filter(function (item) {
      return item.kind === 'app' && (includeHidden || prefs.hiddenApps.indexOf(item.id) < 0)
        && (!query || item.name.toLowerCase().indexOf(query) >= 0);
    });
  }
  function restore(items,memory) {
    return items.filter(function (item) { return item.key === memory.key; })[0] || items[0] || null;
  }
  root.SormusLauncherModel = {preferences:preferences,favorites:favorites,validKey:validKey,validApp:validApp,library:library,apps:apps,restore:restore};
}(this));
