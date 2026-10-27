/* Remote-first provider. Data refresh preserves tile nodes, focus and scroll.
 * Shortcut commands use existing scoped capabilities and are never retried. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var storageKey = 'sormus.launcher.appearance.v1';
  var prefs = SormusLauncherModel.preferences(null), model = null, items = [], apps = [], sources = [];
  var tab = 'home', editing = false, managing = false, online = false, reading = false, readTimer = null;
  var challenge = '', parentOrigin = '', nativeApps = false, lastRead = 0, statusTimer = null;
  var pending = null, receiptTimer = null, clockOffset = 0, focusBeforeDrawer = null;
  var inWidget = window.parent !== window, lastInventory = 0, videoOpen = false;
  var memories = {}, saveTimer = null, iconTimer = null, iconCache = {}, iconRequested = {}, restorePending = false;
  try { prefs = SormusLauncherModel.preferences(JSON.parse(localStorage.getItem(storageKey))); } catch (ignore) {}
  function glyph(name) {
    var icon = document.createElement('i');icon.className = 'material-symbol ms-' + String(name || 'apps').replace(/[^a-z0-9-]/g,'');icon.setAttribute('aria-hidden','true');return icon;
  }
  function send(type,values) {
    if (!inWidget || !challenge) return false;
    var data = values || {};data.type = type;data.challenge = challenge;window.parent.postMessage(data,parentOrigin);return true;
  }
  function feedback(message) {
    clearTimeout(statusTimer);$('status').textContent = message;$('status').hidden = !message;
    if (message) statusTimer = setTimeout(function () { $('status').hidden = true; },5000);
  }
  function save() {
    clearTimeout(saveTimer);saveTimer = null;
    try { localStorage.setItem(storageKey,JSON.stringify(prefs)); } catch (ignore) { feedback('This TV could not save your preferences.'); }
  }
  function saveSoon() { clearTimeout(saveTimer);saveTimer = setTimeout(save,250); }
  function memory() { return tab === 'apps' ? prefs.library : memories[tab] || {key:null,top:0}; }
  function rememberView() {
    if (managing || !$('search-panel').hidden) return;
    var previous = memory(), active = document.activeElement, item = active && active._item;
    var value = {key:item && item.kind !== 'category' ? item.key : previous.key,top:$('content').scrollTop};
    if (tab === 'apps') { value.query = prefs.library.query;prefs.library = SormusLauncherModel.library(value);saveSoon(); }
    else memories[tab] = value;
  }
  function restoreView(focusContent) {
    var value = memory(), buttons = Array.prototype.slice.call($('primary').querySelectorAll('button[data-key]'));
    var choices = buttons.map(function (button) { return {key:button.getAttribute('data-key'),element:button}; });
    var chosen = SormusLauncherModel.restore(choices,value);
    $('content').scrollTop = value.top || 0;
    if (focusContent && chosen) { chosen.element.focus();reveal(chosen.element); }
    return !!chosen;
  }
  function iconKey(app) { return JSON.stringify([app.id,app.version || '']); }
  function showIcon(button,item) {
    var key = item.kind === 'app' ? iconKey(item) : '', image = prefs.artwork === 'icons' && key ? iconCache[key] : null;
    if (image && button._failedArt === image) image = null;
    var token = image || item.icon;if (button._art === token) return;button._art = token;
    var holder = button.firstChild;while (holder.firstChild) holder.removeChild(holder.firstChild);
    if (image) {
      var picture = document.createElement('img');picture.alt = '';picture.src = image;
      picture.onerror = function () { button._failedArt = image;button._art = null;showIcon(button,button._item); };
      holder.appendChild(picture);
    } else holder.appendChild(glyph(item.icon));
  }
  function requestIcons() {
    clearTimeout(iconTimer);
    if (prefs.artwork !== 'icons' || !inWidget || !challenge || document.hidden || !$('drawer').hidden || !$('search-panel').hidden) return;
    var bounds = $('content').getBoundingClientRect(), ids = [], requested = [], more = false;
    Array.prototype.forEach.call($('primary').querySelectorAll('button[data-key]'),function (button) {
      var item = button._item;if (!item || item.kind !== 'app' || !item.hasIcon) return;
      var key = iconKey(item), rect = LauncherNavigation.measure(button);
      if (iconRequested[key] || rect.bottom < bounds.top || rect.top > bounds.bottom || rect.right < bounds.left || rect.left > bounds.right) return;
      if (ids.length >= 12) { more = true;return; }
      iconRequested[key] = true;ids.push(item.id);requested.push(item);
    });
    if (ids.length) {
      var generation = challenge;
      api('/api/launcher/artwork?names=' + encodeURIComponent(JSON.stringify(requested.map(function (app) { return app.name; }))),null,null,function (error,data) {
        if (generation !== challenge || document.hidden) return;
        var fallback = [];
        requested.forEach(function (item) {
          if (!apps.some(function (app) { return app.id === item.id && app.version === item.version; })) return;
          var row = !error && data && Array.isArray(data.icons) ? data.icons.filter(function (value) { return value.name === item.name; })[0] : null;
          var image = row && typeof row.image === 'string' && row.image.length <= 65536 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(row.image) ? row.image : null;
          if (image) iconCache[iconKey(item)] = image;else fallback.push(item.id);
        });
        Array.prototype.forEach.call($('primary').querySelectorAll('button[data-key]'),function (button) { showIcon(button,button._item); });
        if (fallback.length) send('sormus-launcher-icons',{ids:fallback});
      });
    }
    if (more) iconTimer = setTimeout(requestIcons,120);
  }
  function scheduleIcons() { clearTimeout(iconTimer);iconTimer = setTimeout(requestIcons,100); }
  function resetIconRequests() {
    iconRequested = {};
    apps.forEach(function (app) { var key = iconKey(app);if (Object.prototype.hasOwnProperty.call(iconCache,key)) iconRequested[key] = true; });
  }
  function atmosphere() {
    document.body.setAttribute('data-theme',prefs.theme);document.body.setAttribute('data-motion',prefs.motion ? 'on' : 'off');
    var buttons = document.querySelectorAll('.swatch');
    for (var i = 0; i < buttons.length; i++) buttons[i].setAttribute('aria-pressed',String(buttons[i].getAttribute('data-theme') === prefs.theme));
    $('motion').textContent = 'Ambient motion: ' + (prefs.motion ? 'On' : 'Off');
    $('artwork').textContent = 'App artwork: ' + (prefs.artwork === 'icons' ? 'Icons' : 'Glyphs');
    $('artwork').setAttribute('aria-pressed',String(prefs.artwork === 'icons'));
    $('tile-style').textContent = 'App tiles: ' + (prefs.tileStyle === 'artwork' ? 'Artwork only' : 'Labeled');
    $('tile-style').setAttribute('aria-pressed',String(prefs.tileStyle === 'artwork'));
  }
  function uuid() {
    var values = new Uint8Array(16);window.crypto.getRandomValues(values);values[6] = values[6] & 15 | 64;values[8] = values[8] & 63 | 128;
    var text = '';for (var i = 0; i < values.length; i++) text += (values[i] + 256).toString(16).slice(1);
    return text.slice(0,8) + '-' + text.slice(8,12) + '-' + text.slice(12,16) + '-' + text.slice(16,20) + '-' + text.slice(20);
  }
  function api(url,body,headers,complete) {
    var request = new XMLHttpRequest();request.open(body ? 'POST' : 'GET',url,true);request.timeout = 6500;
    if (body) request.setRequestHeader('Content-Type','application/json');
    Object.keys(headers || {}).forEach(function (key) { request.setRequestHeader(key,headers[key]); });
    var finished = false;
    function done(error,value) { if (finished) return;finished = true;complete(error,value); }
    request.onload = function () {
      try {
        var value = JSON.parse(request.responseText);
        if (request.status < 200 || request.status >= 300) done({status:request.status,message:value.error || 'Request could not be completed.'});else done(null,value);
      } catch (ignore) { done({message:'The server response could not be read.'}); }
    };
    request.onerror = request.ontimeout = function () { done({message:'Connection interrupted. Check the result before trying again.'}); };
    request.send(body ? JSON.stringify(body) : null);
  }
  function application(app) {
    var name = app.name.toLowerCase(), brand = '', icon = 'apps';
    if (name.indexOf('youtube') >= 0) { brand = 'youtube';icon = 'play-arrow'; }
    else if (name.indexOf('netflix') >= 0) { brand = 'netflix';icon = 'movie'; }
    else if (name.indexOf('emby') >= 0) { brand = 'emby';icon = 'play-circle'; }
    else if (name.indexOf('moonlight') >= 0) { brand = 'moonlight';icon = 'dark-mode'; }
    else if (/playstation|ps5/.test(name)) { brand = 'playstation';icon = 'sports-esports'; }
    else if (/vista/.test(name)) icon = 'view-quilt';
    else if (/browser|internet/.test(name)) icon = 'public';
    return {key:'app:' + app.id,id:app.id,name:app.name,detail:'Installed on this TV',kind:'app',brand:brand,icon:icon,available:nativeApps,
      version:app.version || '',hasIcon:app.hasIcon === true,hidden:prefs.hiddenApps.indexOf(app.id) >= 0};
  }
  function catalogue() {
    items = apps.map(application).concat(sources.map(function (source) {
      return {key:'input:' + source.id,id:source.id,name:source.name,kind:'input',icon:'tv',detail:source.connected ? 'Signal available' : 'No signal',available:true};
    }));
    if (!model) return;
    items = items.concat(model.displays.map(function (value) {
      return {key:'display:' + value.id,id:value.id,name:value.name,kind:'display',icon:value.icon,detail:value.detail,path:value.path,available:true};
    }));
    ['scenes','tasks'].forEach(function (group) {
      (model[group] || []).forEach(function (value) {
        items.push({key:(group === 'scenes' ? 'scene:' + value.pluginId + ':' + value.slug + ':' : 'task:') + value.id,id:value.id,name:value.name,kind:group === 'scenes' ? 'scene' : 'task',icon:value.icon || 'bolt',detail:group === 'scenes' ? value.group || 'Lighting scene' : 'Published Task',available:value.available && !model.paused,source:value});
      });
    });
  }
  function currentFavorites() { return SormusLauncherModel.favorites(items,prefs); }
  function pin(key) {
    if (!SormusLauncherModel.validKey(key)) return;
    if (!prefs.customized) prefs.favorites = currentFavorites().map(function (item) { return item.key; });
    prefs.customized = true;var index = prefs.favorites.indexOf(key);
    if (index >= 0) prefs.favorites.splice(index,1);else if (prefs.favorites.length < 64) prefs.favorites.push(key);
    else { feedback('You can save up to 64 favorites.');return; }
    save();paint();feedback(index >= 0 ? 'Removed from favorites' : 'Added to favorites');
  }
  function makeTile() {
    var button = document.createElement('button');button.className = 'tile';button.type = 'button';
    var icon = document.createElement('span');icon.className = 'tile-icon';button.appendChild(icon);
    button.appendChild(document.createElement('strong'));button.appendChild(document.createElement('small'));
    var pinIcon = glyph('star');pinIcon.className += ' pin';button.appendChild(pinIcon);
    button.onclick = function () { activate(button._item); };return button;
  }
  function reconcile(container,list) {
    var wanted = {}, nodes = {}, current = document.activeElement, currentKey = current && current.getAttribute('data-key');
    var scrollLeft = container.scrollLeft;
    var markedKeys = prefs.customized ? prefs.favorites : currentFavorites().map(function (item) { return item.key; });
    Array.prototype.forEach.call(container.querySelectorAll('button[data-key]'),function (button) { nodes[button.getAttribute('data-key')] = button; });
    list.forEach(function (item,index) {
      wanted[item.key] = true;var button = nodes[item.key] || makeTile();button._item = item;
      button.setAttribute('data-key',item.key);button.className = 'tile ' + item.kind + (item.brand ? ' app-' + item.brand : '') + (editing && item.kind !== 'category' ? ' editing' : '') + (managing && item.hidden ? ' app-hidden' : '') + (item.kind === 'app' && prefs.tileStyle === 'artwork' && !editing && !managing ? ' full-art' : '');
      button.setAttribute('aria-label',item.name);
      button.setAttribute('aria-disabled',String(!editing && !managing && !item.available));
      var marked = markedKeys.indexOf(item.key) >= 0;
      button.lastChild.hidden = !marked || item.kind === 'category';
      showIcon(button,item);
      button.querySelector('strong').textContent = item.name;
      button.querySelector('small').textContent = managing && item.kind === 'app' ? item.hidden ? 'Hidden · OK to show' : 'Shown · OK to hide'
        : editing && item.kind !== 'category' ? marked ? 'OK to remove favorite' : 'OK to add favorite' : item.detail;
      if (container.children[index] !== button) container.insertBefore(button,container.children[index] || null);
    });
    Array.prototype.slice.call(container.children).forEach(function (node) {
      var key = node.getAttribute('data-key');if (!key || !wanted[key]) container.removeChild(node);
    });
    container.scrollLeft = scrollLeft;
    if (currentKey && nodes[currentKey] && !wanted[currentKey]) {
      if (container.firstChild) container.firstChild.focus();else $('navigation').querySelector('[aria-current]').focus();
    }
  }
  function empty(container,title,message) {
    var box = document.createElement('div');box.className = 'empty';var label = document.createElement('strong');label.textContent = title;
    box.appendChild(label);box.appendChild(document.createTextNode(message));container.appendChild(box);
  }
  var tabs = {
    home:['HOME','Favorites','Select an app, input or shortcut.'],
    apps:['ON YOUR TV','Apps','Open an app, or add it to your favorites.'],
    inputs:['INPUTS','TV & HDMI','Select a source. Return opens the launcher.'],
    displays:['SORMUS','Displays & experiences','Vistas, immersive worlds and games.'],
    scenes:['LIGHTING','Lighting scenes','Select a scene to apply it.'],
    tasks:['SHORTCUTS','Tasks','Your published Task shortcuts.']
  };
  function paint() {
    catalogue();var labels = tabs[tab];$('eyebrow').textContent = managing ? 'APP VISIBILITY' : editing ? 'EDITING FAVORITES' : labels[0];$('title').textContent = managing ? 'Manage apps' : labels[1];
    $('subtitle').textContent = managing ? 'Select apps to show or hide. Choose the checkmark when finished.'
      : editing ? 'Select tiles to add or remove favorites. Choose the checkmark when finished.' : labels[2];
    var nav = $('navigation').querySelectorAll('button');
    for (var i = 0; i < nav.length; i++) { if (nav[i].getAttribute('data-tab') === tab) nav[i].setAttribute('aria-current','page');else nav[i].removeAttribute('aria-current'); }
    var personalize = $('personalize');
    personalize.setAttribute('aria-label',managing ? 'Finish managing apps' : editing ? 'Finish editing favorites' : 'Personalize launcher');
    if (personalize._editing !== (editing || managing)) {
      while (personalize.firstChild) personalize.removeChild(personalize.firstChild);
      personalize.appendChild(glyph(editing || managing ? 'check' : 'tune'));personalize._editing = editing || managing;
    }
    var list = tab === 'home' ? currentFavorites() : tab === 'apps' ? SormusLauncherModel.apps(items,prefs,managing)
      : items.filter(function (item) { return item.kind === ({inputs:'input',displays:'display',scenes:'scene',tasks:'task'})[tab]; });
    $('search-apps').hidden = tab !== 'apps';$('app-filter').hidden = tab !== 'apps' || !prefs.library.query;
    $('app-filter').textContent = prefs.library.query;
    $('search-query').textContent = prefs.library.query || 'Search apps';$('search-count').textContent = list.length + (list.length === 1 ? ' app' : ' apps');
    $('first-title').textContent = tab === 'home' ? 'Quick access' : tab === 'apps' ? 'Installed apps' : tab === 'inputs' ? 'Inputs' : tab === 'displays' ? 'Available displays' : tab === 'scenes' ? 'Available scenes' : 'Published Tasks';
    $('primary').className = 'tiles ' + (tab === 'home' ? 'row' : 'grid');reconcile($('primary'),list);
    if (!list.length) {
      var note = tab === 'apps' && prefs.library.query ? 'Try a different name or clear the search.'
        : tab === 'apps' && apps.length && !managing ? 'Use Manage apps in personalization to show hidden apps.'
        : tab === 'apps' || tab === 'inputs' ? inWidget ? 'The TV has not reported any items. Open personalization and choose Refresh apps and inputs.' : 'Open Sormus Launcher on your TV to see its ' + (tab === 'apps' ? 'installed apps.' : 'inputs.')
        : tab === 'scenes' ? 'Enable scenes for end-user access in the Sormus lighting scene editor.'
        : tab === 'tasks' ? 'Publish Task shortcuts in Controller setup in the administrator.'
        : tab === 'home' ? 'Open personalization in the header and choose Edit favorites.' : 'Enable a Vista or experience in the administrator.';
      empty($('primary'),tab === 'home' ? 'No favorites selected' : 'Nothing here yet',note);
    }
    $('secondary-section').hidden = tab !== 'home';
    if (tab === 'home') reconcile($('secondary'),[
      {key:'category:apps',kind:'category',name:'Apps',icon:'apps',detail:nativeApps ? apps.filter(function (app) { return prefs.hiddenApps.indexOf(app.id) < 0; }).length + ' apps' : inWidget ? 'TV app list unavailable' : 'Open on TV',available:true,tab:'apps'},
      {key:'category:inputs',kind:'category',name:'TV & HDMI',icon:'tv',detail:sources.length ? sources.length + ' inputs' : 'TV inputs',available:true,tab:'inputs'},
      {key:'category:displays',kind:'category',name:'Sormus',icon:'view-quilt',detail:'Displays, worlds & games',available:true,tab:'displays'},
      {key:'category:scenes',kind:'category',name:'Lighting',icon:'lightbulb',detail:'Lighting scenes',available:true,tab:'scenes'},
      {key:'category:tasks',kind:'category',name:'Tasks',icon:'bolt',detail:'Published shortcuts',available:true,tab:'tasks'}]);
    $('version').textContent = 'Sormus ' + (model ? model.version : '') + (inWidget ? ' · TV launcher' : ' · Browser');
    if (restorePending && tab === 'apps' && list.length) { restorePending = false;restoreView(true); }
    scheduleIcons();
  }
  function changeTab(next,focusContent) {
    if (!tabs[next]) return;rememberView();if (next !== 'apps') managing = false;tab = next;paint();
    var restored = restoreView(focusContent);restorePending = next === 'apps' && !!focusContent && !restored && !nativeApps;
  }
  function activate(item) {
    if (!item) return;
    if (item.kind === 'category') { changeTab(item.tab,true);return; }
    if (managing && item.kind === 'app') {
      var hiddenIndex = prefs.hiddenApps.indexOf(item.id);
      if (hiddenIndex >= 0) prefs.hiddenApps.splice(hiddenIndex,1);else if (prefs.hiddenApps.length < 256) prefs.hiddenApps.push(item.id);
      save();paint();return;
    }
    if (editing) { pin(item.key);return; }
    if (!item.available) { feedback('This item is unavailable. Check its configuration in the administrator.');return; }
    if (item.kind === 'app') { rememberView();save();if (!send('sormus-launcher-launch',{id:item.id})) feedback('Open this app from Sormus Launcher on the TV.');return; }
    if (item.kind === 'input') { if (!send('sormus-launcher-input',{id:item.id})) feedback('TV inputs are available in the installed launcher.');return; }
    if (item.kind === 'display') { if (!send('sormus-launcher-display',{path:item.path})) window.location.href = item.path;return; }
    run(item);
  }
  function run(item) {
    if (pending || !online || !model || model.paused) { feedback(pending ? 'A shortcut is still awaiting its result.' : 'The server is unavailable or paused.');return; }
    var source = item.source, requestId;
    try { requestId = uuid(); } catch (ignore) { feedback('This TV cannot create a safe shortcut request.');return; }
    pending = {item:item,requestId:requestId,started:Date.now(),receipt:null};var current = pending;
    var scene = item.kind === 'scene', url = scene ? '/api/control-view/' + source.pluginId + '/' + source.slug + '/run' : '/api/phone-home/run';
    var body = scene ? {revision:source.revision,itemId:source.id,requestId:requestId} : {taskId:source.id,revision:source.revision,homeRevision:model.revision,expires:source.expires,requestId:requestId};
    var headers = {};headers[scene ? 'X-Localserve-Control-Token' : 'X-Localserve-Home-Token'] = source.token;
    feedback('Starting ' + item.name + '…');
    api(url,body,headers,function (error,value) {
      if (pending !== current) return;
      if (error) { if (error.status >= 400 && error.status < 500) pending = null;feedback(error.message + (pending ? ' Check its history before running again.' : ''));return; }
      current.receipt = value;receipt();
    });
  }
  function receipt() {
    var current = pending;if (!current || !current.receipt || document.hidden) return;
    if (Date.now() - current.started > 120000) { feedback('Still awaiting a result. Check its history before running again.');return; }
    var source = current.item.source, scene = current.item.kind === 'scene';
    var url = scene ? '/api/control-view/' + source.pluginId + '/' + source.slug : '/api/phone-home/receipts/' + current.receipt.requestId;
    var headers = {};if (!scene) headers['X-Localserve-Home-Token'] = current.receipt.token;
    api(url,null,headers,function (error,value) {
      if (pending !== current) return;
      if (error) { feedback('Result not confirmed. Check its history before running again.');return; }
      var result = scene ? (value.runs || []).filter(function (run) { return run.id === current.requestId; })[0] : value;
      if (!result) { feedback('Result is no longer available. Check its history before running again.');return; }
      if (['queued','running','accepted'].indexOf(result.status) >= 0) { feedback('Running ' + current.item.name + '…');receiptTimer = setTimeout(receipt,1500);return; }
      pending = null;feedback(current.item.name + ': ' + (result.status === 'completed' ? 'completed' : result.status === 'cancelled' ? 'cancelled' : 'not completed — check its history'));
    });
  }
  function read() {
    if (reading || document.hidden) return;reading = true;clearTimeout(readTimer);
    api('/api/launcher',null,{},function (error,value) {
      reading = false;
      if (!error && value && Array.isArray(value.displays) && Array.isArray(value.scenes) && Array.isArray(value.tasks)) {
        model = value;online = true;lastRead = Date.now();clockOffset = value.options.now - Date.now();paint();
      } else { online = false;paint(); }
      if (!document.hidden) readTimer = setTimeout(read,5000);
    });
  }
  function setQuery(value) {
    prefs.library = SormusLauncherModel.library({query:value,key:null,top:0});save();
    $('content').scrollTop = 0;paint();
  }
  function search(open) {
    if (open) {
      rememberView();$('search-panel').hidden = false;paint();
      $('search-keys').querySelector('button').focus();
    } else {
      $('search-panel').hidden = true;restoreView(true);scheduleIcons();
      if (!$('primary').querySelector('button')) $('search-apps').focus();
    }
  }
  function order() {
    var container = $('favorite-order');while (container.firstChild) container.removeChild(container.firstChild);
    currentFavorites().forEach(function (item,index,list) {
      var row = document.createElement('div');row.className = 'favorite-row';var label = document.createElement('span');label.textContent = item.name;row.appendChild(label);
      [['chevron-left','Move earlier',-1],['chevron-right','Move later',1],['close','Remove',0]].forEach(function (action) {
        var button = document.createElement('button');button.appendChild(glyph(action[0]));button.setAttribute('aria-label',action[1] + ' ' + item.name);
        button.disabled = action[2] === -1 && index === 0 || action[2] === 1 && index === list.length - 1;
        button.onclick = function () {
          if (!action[2]) pin(item.key);
          else {
            var listKeys = prefs.customized ? prefs.favorites.slice() : list.map(function (entry) { return entry.key; });
            var from = listKeys.indexOf(item.key), to = listKeys.indexOf(list[index + action[2]].key);
            listKeys[from] = listKeys[to];listKeys[to] = item.key;
            prefs.favorites = listKeys;prefs.customized = true;save();paint();
          }
          order();$('close-drawer').focus();
        };
        row.appendChild(button);
      });container.appendChild(row);
    });
  }
  function drawer(open) {
    if (open) { rememberView();focusBeforeDrawer = document.activeElement;order();$('drawer').hidden = false;$('close-drawer').focus(); }
    else { $('drawer').hidden = true;if (focusBeforeDrawer && document.documentElement.contains(focusBeforeDrawer)) focusBeforeDrawer.focus();else $('personalize').focus();resetIconRequests();scheduleIcons(); }
  }
  function visibleControls() {
    var parent = !$('search-panel').hidden ? $('search-panel') : $('drawer').hidden ? $('shell') : $('drawer');
    return Array.prototype.slice.call(parent.querySelectorAll('button')).filter(function (element) { return !element.disabled && element.offsetHeight > 0 && element.offsetWidth > 0; });
  }
  function reveal(element) {
    var row = element.parentNode;
    if (row.className && /\brow\b/.test(row.className)) {
      var bounds = row.getBoundingClientRect(), rect = LauncherNavigation.measure(element);
      if (rect.left < bounds.left + 8) row.scrollLeft -= bounds.left - rect.left + 12;
      if (rect.right > bounds.right - 8) row.scrollLeft += rect.right - bounds.right + 12;
    }
    var scroller = !$('search-panel').hidden ? document.querySelector('.search-dialog') : $('drawer').hidden ? $('content') : document.querySelector('.drawer-panel');
    var frame = scroller.getBoundingClientRect(), target = LauncherNavigation.measure(element);
    if (scroller.contains(element)) {
      if (target.top < frame.top + 12) scroller.scrollTop -= frame.top - target.top + 18;
      if (target.bottom > frame.bottom - 12) scroller.scrollTop += target.bottom - frame.bottom + 18;
    }
  }
  function key(code) {
    if (videoOpen) {
      if (code === 10009 || code === 27) send('sormus-launcher-hide-input');
      return [37,38,39,40,13,10009,27].indexOf(code) >= 0;
    }
    if (code === 10009 || code === 27) {
      if (!$('search-panel').hidden) search(false);
      else if (!$('drawer').hidden) drawer(false);else if (editing || managing) { editing = false;managing = false;paint();restoreView(true); }
      else if (tab !== 'home') { changeTab('home');$('navigation').querySelector('[data-tab=home]').focus(); }
      else if (!send('sormus-launcher-exit')) feedback('Use your browser to leave the launcher.');
      return true;
    }
    var active = document.activeElement;
    if (code === 13) { if (active && active.tagName === 'BUTTON') active.click();return true; }
    if ([37,38,39,40].indexOf(code) < 0) return false;
    var controls = visibleControls();if (!controls.length) return true;
    if (!active || controls.indexOf(active) < 0) { controls[0].focus();return true; }
    var entries = controls.map(function (element) {
      var group = $('search-panel').contains(element) ? element.parentNode === $('search-keys') ? 'keyboard' : element.parentNode.className === 'search-actions' ? 'search-actions' : 'search-header'
        : element.parentNode === $('primary') ? 'primary' : element.parentNode === $('secondary') ? 'secondary'
        : $('drawer').contains(element) ? 'drawer' : 'header';
      return {element:element,group:group,rect:LauncherNavigation.measure(element)};
    });
    var current = null, header = null, preferred = null;
    entries.forEach(function (entry) {
      if (entry.element === active) current = entry;
      if (entry.element.getAttribute('data-tab') === tab) header = entry;
      if (entry.group === 'primary' && entry.element.getAttribute('data-key') === memory().key) preferred = entry;
    });
    var next = LauncherNavigation.next(entries,current,code,header,preferred);
    if (next && next.element !== active) { next.element.focus();reveal(next.element); }return true;
  }
  document.addEventListener('keydown',function (event) { if (key(event.keyCode)) { event.preventDefault();event.stopPropagation(); } });
  window.addEventListener('message',function (event) {
    var data = event.data;if (!inWidget || event.source !== window.parent || !data) return;
    if (data.type === 'sormus-launcher-probe' && typeof data.challenge === 'string' && data.challenge.length < 100) {
      if (challenge === data.challenge && tab === 'apps' && $('drawer').hidden && $('search-panel').hidden && !managing) restoreView(true);
      parentOrigin = event.origin;challenge = data.challenge;
      if (lastRead && Date.now() - lastRead < 8000) send('sormus-launcher-ready');
      send('sormus-launcher-inventory');send('sormus-launcher-sources');return;
    }
    if (event.origin !== parentOrigin || data.challenge !== challenge) return;
    if (data.type === 'sormus-launcher-video') videoOpen = data.active === true;
    if (data.type === 'sormus-launcher-key') key(data.code);
    if (data.type === 'sormus-launcher-apps' && Array.isArray(data.apps)) {
      nativeApps = data.native === true;apps = data.apps.filter(function (app) { return app && typeof app.id === 'string' && /^[\w.-]{1,128}$/.test(app.id) && typeof app.name === 'string'; }).slice(0,256);
      apps.sort(function (a,b) { return a.name.localeCompare(b.name) || a.id.localeCompare(b.id); });resetIconRequests();lastInventory = Date.now();paint();
    }
    if (data.type === 'sormus-launcher-icons' && Array.isArray(data.icons) && data.icons.length <= 12) {
      data.icons.forEach(function (value) {
        var app = apps.filter(function (item) { return item.id === value.id && (item.version || '') === (value.version || ''); })[0];
        if (!app) return;
        var image = typeof value.image === 'string' && value.image.length <= 65536 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value.image) ? value.image : null;
        iconCache[iconKey(app)] = image;
      });
      Array.prototype.forEach.call($('primary').querySelectorAll('button[data-key]'),function (button) { showIcon(button,button._item); });
    }
    if (data.type === 'sormus-launcher-inputs' && Array.isArray(data.sources)) {
      sources = data.sources.filter(function (source) { return source && typeof source.id === 'string' && /^(HDMI|TV):\d{1,2}$/.test(source.id) && typeof source.name === 'string'; }).slice(0,16);paint();
    }
    if (data.type === 'sormus-launcher-result') feedback(data.message || 'Request completed');
  });
  Array.prototype.forEach.call($('navigation').querySelectorAll('button'),function (button) { button.onclick = function () { changeTab(button.getAttribute('data-tab'),true); }; });
  $('personalize').onclick = function () { if (editing || managing) { editing = false;managing = false;paint();restoreView(true); }else drawer(true); };
  $('close-drawer').onclick = function () { drawer(false); };
  $('manage').onclick = function () {
    managing = false;editing = true;drawer(false);paint();
    var first = $('primary').querySelector('button');
    if (first) { first.focus();reveal(first); }else $('navigation').querySelector('[data-tab=apps]').focus();
  };
  $('manage-apps').onclick = function () {
    rememberView();editing = false;managing = true;drawer(false);changeTab('apps',true);
  };
  $('search-apps').onclick = function () { search(true); };
  $('close-search').onclick = $('search-done').onclick = function () { search(false); };
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('').forEach(function (letter) {
    var button = document.createElement('button');button.type = 'button';button.textContent = letter;
    button.onclick = function () { setQuery(prefs.library.query + letter); };$('search-keys').appendChild(button);
  });
  $('search-space').onclick = function () { setQuery(prefs.library.query + ' '); };
  $('search-delete').onclick = function () { setQuery(prefs.library.query.slice(0,-1)); };
  $('search-clear').onclick = function () { setQuery(''); };
  $('connection').onclick = function () { if (!send('sormus-launcher-settings')) feedback('Set the server address in the installed TV app.'); };
  $('refresh').onclick = function () { send('sormus-launcher-inventory');send('sormus-launcher-sources');read();feedback('Refreshing'); };
  $('motion').onclick = function () { prefs.motion = !prefs.motion;save();atmosphere(); };
  $('artwork').onclick = function () { prefs.artwork = prefs.artwork === 'icons' ? 'glyphs' : 'icons';save();atmosphere();paint();scheduleIcons(); };
  $('tile-style').onclick = function () { prefs.tileStyle = prefs.tileStyle === 'artwork' ? 'labeled' : 'artwork';save();atmosphere();paint(); };
  Array.prototype.forEach.call(document.querySelectorAll('.swatch'),function (button) { button.onclick = function () { prefs.theme = button.getAttribute('data-theme');save();atmosphere(); }; });
  setInterval(function () {
    if (document.hidden) return;var date = new Date(Date.now() + clockOffset);
    try { $('clock').textContent = new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hour12:model && model.options.timeFormat === '12',timeZone:model ? model.options.timeZone : undefined}).format(date); }
    catch (ignore) { $('clock').textContent = date.toLocaleTimeString(); }
    if (lastRead && Date.now() - lastRead < 8000) send('sormus-launcher-ready');
  },2000);
  document.addEventListener('visibilitychange',function () {
    rememberView();save();clearTimeout(readTimer);clearTimeout(receiptTimer);clearTimeout(statusTimer);clearTimeout(iconTimer);$('status').hidden = true;
    if (!document.hidden) {
      if (tab === 'apps' && $('drawer').hidden && $('search-panel').hidden && !managing) restoreView(true);
      read();receipt();scheduleIcons();if (Date.now() - lastInventory > 60000) { send('sormus-launcher-inventory');send('sormus-launcher-sources'); }
    }
  });
  document.addEventListener('focusin',function (event) { if (event.target._item) rememberView(); });
  $('content').addEventListener('scroll',function () { rememberView();scheduleIcons(); });
  window.addEventListener('pagehide',function () { rememberView();save(); });
  atmosphere();paint();read();$('navigation').querySelector('button').focus();
}());
