/* Read-only PSN presentation. No Sony credentials, device commands or console
 * state inference enters this page. Native HDMI belongs to its packaged parent. */
(function (root) {
  'use strict';
  var snapshot = null, pages = [], pageId = 'games-0', activityPage = 0, connected = false;
  var request = null, pollTimer = null, rotationTimer = null, hiddenGeneration = 0, paused = false;
  var parentSession = '', clockOffset = 0;
  var layout = 'split', parentLayouts = false, layoutKey = null;
  var remoteKeys = {};
  var hudStyles = ['edges','top','right','bottom','left','ticker','none'], hudStyle = 'edges', hudOpacity = 100, parentAppearance = false;
  function applyAppearance(style, opacity) {
    if (hudStyles.indexOf(style) < 0 || typeof opacity !== 'number' || !isFinite(opacity) || opacity < 0 || opacity > 100) return;
    hudStyle = style;hudOpacity = opacity;
    document.documentElement.setAttribute('data-hud-style',style);
    node('game-hud').style.opacity = String(opacity / 100);
    text('hud-style-toggle',style === 'none' ? 'No HUD' : 'HUD: ' + style.charAt(0).toUpperCase() + style.slice(1));
  }
  function cycleAppearance() {
    if (window.parent === window) { applyAppearance(hudStyles[(hudStyles.indexOf(hudStyle) + 1) % hudStyles.length],hudOpacity);applyLayout('hud'); }
    else if (parentSession && parentAppearance) window.parent.postMessage({type:'localserve-ps-cycle',id:parentSession,path:'/playstation-mode'},'*');
  }
  var trophyGame = '', trophyCount = null, trophyReceipt = null, toastUntil = 0;
  function node(id) { return document.getElementById(id); }
  function esc(value) { return String(value == null ? '—' : value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function value(id) {
    var field = snapshot && snapshot.values[id];
    return field && field.available ? field.value : null;
  }
  function number(input, digits) {
    return typeof input === 'number' && isFinite(input) ? input.toFixed(digits || 0).replace(/\.0$/,'') : '—';
  }
  function duration(seconds) {
    if (typeof seconds !== 'number' || !isFinite(seconds) || seconds < 0) return '—';
    var total = Math.floor(seconds), hours = Math.floor(total / 3600), minutes = Math.floor(total / 60) % 60;
    return (hours ? hours + ':' : '') + (hours && minutes < 10 ? '0' : '') + minutes + ':' + ('0' + total % 60).slice(-2);
  }
  function date(input, timeOnly) {
    if (typeof input !== 'number' || !isFinite(input)) return '—';
    try {
      var options = {hour:'2-digit',minute:'2-digit',hour12:snapshot && snapshot.options.timeFormat === '12',
        timeZone:snapshot && snapshot.options.timeZone};
      if (!timeOnly) { options.month = 'short'; options.day = 'numeric'; }
      return new Intl.DateTimeFormat(undefined, options).format(new Date(input));
    } catch (ignore) { return new Date(input).toISOString().slice(timeOnly ? 11 : 5,16).replace('T',' ') + ' UTC'; }
  }
  function formatted(input, type) {
    return input === null || input === undefined ? '—' : type === 'timestamp' ? date(input,false)
      : type === 'boolean' ? input ? 'Yes' : 'No' : type === 'number' ? number(input,1) : String(input);
  }
  function text(id, input) { var element = node(id);if (element) element.textContent = input === null || input === undefined ? '—' : String(input); }
  function html(id, markup) {
    var element = node(id);
    // Preserve the ticker and carousel documents when a poll has identical data.
    if (element._markup !== markup) { element.innerHTML = markup; element._markup = markup; }
  }
  function freshness() {
    var at = value('received-at'), now = Date.now() + clockOffset;
    return connected && snapshot && snapshot.enabled && snapshot.status === 'Ready' && typeof at === 'number'
      && now >= at - 60000 && now - at <= Math.max(120000,snapshot.options.pollSeconds * 3000);
  }
  function validLayout(input) { return input === 'split' || input === 'hud'; }
  function applyLayout(input) {
    layout = input;document.documentElement.setAttribute('data-layout',layout);
    node('layout-toggle').disabled = window.parent !== window && !parentLayouts;
    node('layout-toggle').setAttribute('aria-pressed',String(layout === 'hud'));
    text('layout-toggle',layout === 'hud' ? 'Split view' : 'Full-screen HUD');
    text('layout-hint',window.parent === window ? 'H · View · L · HUD layout' : parentAppearance ? 'CH− Layout · CH+ Settings' : 'CH+ Settings');
    node('hud-style-toggle').hidden = layout !== 'hud';
    node('hud-style-toggle').disabled = window.parent !== window && !parentAppearance;
    node('layout-toggle').title = window.parent !== window && !parentLayouts ? 'Update the PlayStation TV app to switch layouts.' : 'Switch between split view and the full-screen game HUD';
  }
  function toggleLayout() {
    var next = layout === 'hud' ? 'split' : 'hud';
    if (window.parent === window) applyLayout(next);
    else if (parentSession && parentLayouts) window.parent.postMessage({type:'localserve-ps-layout-request',id:parentSession,path:'/playstation-mode',layout:next},'*');
  }
  function clearToast() { toastUntil = 0;node('hud-toast').hidden = true; }
  function gameTheme(name) {
    // Match the reported franchise name, including its Japanese branding.
    // Word boundaries exclude unrelated words such as "evilish"/"biohazardous".
    return typeof name === 'string' && /\bresident[\s-]*evil(?:\b|[0-9])|\bbiohazard(?:\b|[0-9])|バイオハザード/i.test(name)
      ? 'resident-evil' : 'standard';
  }
  function renderHud() {
    var running = value('game-running') === true, name = value('active-game'), progress = running ? value('active-trophy-progress') : null;
    var theme = running && snapshot && snapshot.enabled ? gameTheme(name) : 'standard';
    document.documentElement.setAttribute('data-game-theme',theme);
    text('hud-link-label',theme === 'resident-evil' ? 'RESIDENT EVIL' : 'PLAYER LINK');
    text('hud-session-label',theme === 'resident-evil' ? 'SESSION RECORD' : 'OBSERVED SESSION');
    text('hud-stats-label',theme === 'resident-evil' ? 'GAME ARCHIVE' : 'GAME RECORD');
    text('hud-trophies-label',theme === 'resident-evil' ? 'TROPHY ARCHIVE' : 'TROPHY SYNC');
    var knownProgress = typeof progress === 'number' && isFinite(progress) && progress >= 0 && progress <= 100;
    text('hud-game',running ? name || 'Current game' : 'Waiting for a game');
    node('hud-game').title = running ? name || 'Current game' : '';
    text('hud-platform',value('platform'));text('hud-player',[value('online-id'),value('online-status')].filter(Boolean).join(' · ') || 'No presence reading');
    text('hud-hours',running ? number(value('active-play-hours'),1) : '—');text('hud-plays',running ? number(value('active-play-count')) : '—');
    text('hud-last-played',running ? 'Last played ' + date(value('active-last-played'),false) : 'Game statistics appear when PSN reports a game');
    text('hud-earned',running ? number(value('active-trophies')) + ' / ' + number(value('active-trophies-available')) : '—');
    text('hud-progress',knownProgress ? number(progress) + '% complete' : 'Progress unavailable');
    node('hud-progress-fill').setAttribute('width',String(knownProgress ? progress * 8 : 0));
    html('hud-grades',['platinum','gold','silver','bronze'].map(function (grade) {
      return '<div class="' + grade + '"><i class="fa fa-trophy" aria-hidden="true"></i><strong>'
        + esc(running ? number(value('active-' + grade)) : '—') + '</strong><span>' + grade + '</span></div>';
    }).join(''));
    var receipt = running ? value('active-trophies-received-at') : null, count = running ? value('active-trophies') : null;
    text('hud-trophy-time',receipt !== null ? 'Summary received ' + date(receipt,true) + ' · PSN may lag' : 'No trophy summary received');
    // Timer nodes update separately so the single-line track keeps its position.
    var line = '<b>' + esc(running ? name || 'Current game' : 'Waiting for a game') + '</b><span>'
      + esc([value('online-id'),value('platform'),value('online-status')].filter(Boolean).join(' · '))
      + '</span><span>Observed session <strong id="hud-line-time">—</strong></span><span>'
      + esc(running ? number(value('active-play-hours'),1) + 'h · ' + number(value('active-play-count')) + ' plays' : 'No current game statistics')
      + '</span><span>Trophies ' + esc(running ? number(value('active-trophies')) + '/' + number(value('active-trophies-available')) : '—')
      + ' · ' + esc(knownProgress ? number(progress) + '%' : 'Progress unavailable') + '</span><span>'
      + ['platinum','gold','silver','bronze'].map(function (grade) { return esc(grade + ' ' + (running ? number(value('active-' + grade)) : '—')); }).join(' · ')
      + '</span><span>' + esc(running ? 'Last played ' + date(value('active-last-played'),false) : 'Waiting for PSN')
      + '</span><span>' + esc(receipt !== null ? 'Trophies received ' + date(receipt,true) + ' · PSN may lag' : 'No trophy receipt') + '</span>';
    html('hud-line-track','<span class="hud-line-group">' + line + '</span><span class="hud-line-group" aria-hidden="true">'
      + line.replace('id="hud-line-time"','id="hud-line-time-copy"') + '</span>');
    var game = running ? value('title-id') || name || '' : '';
    // A summary change is a sync observation, not an instantaneous unlock event.
    if (freshness() && game && game === trophyGame && typeof count === 'number' && typeof trophyCount === 'number'
      && count > trophyCount && typeof receipt === 'number' && typeof trophyReceipt === 'number' && receipt > trophyReceipt) {
      text('hud-toast-text','+' + number(count - trophyCount) + ' trophies synced');toastUntil = Date.now() + 8000;
    } else if (!game || game !== trophyGame || !freshness()) clearToast();
    trophyGame = game;trophyCount = count;trophyReceipt = receipt;
  }
  function activityLabel(item) {
    if (item.kind === 'online') return 'Online session started';
    if (item.kind === 'offline') return 'Online session ended';
    if (item.kind === 'game') return item.game ? 'Now playing · ' + item.game : 'Game ended';
    return 'Presence · ' + item.status;
  }
  function renderActivity() {
    var rows = snapshot ? snapshot.activity : [], count = Math.max(1,Math.ceil(rows.length / 5));
    activityPage = Math.min(activityPage,count - 1);
    html('activity-list', rows.length ? rows.slice(activityPage * 5,activityPage * 5 + 5).map(function (item) {
      var detail = item.kind === 'game' ? item.previousGame ? 'Previous · ' + item.previousGame : item.game
        : item.game || (item.previousGame ? 'Last game · ' + item.previousGame : 'PSN ' + item.status);
      if (item.seconds !== null) detail += ' · observed duration ' + duration(item.seconds);
      return '<div class="activity-row"><time>' + esc(date(item.at,true)) + '</time><span class="activity-symbol">'
        + (item.kind === 'online' ? '↗' : item.kind === 'offline' ? '↙' : '◇')
        + '</span><div class="activity-copy"><strong>' + esc(activityLabel(item)) + '</strong><small>'
        + esc(date(item.at,false) + ' · ' + detail) + '</small></div></div>';
    }).join('') : '<p class="empty">Session and game changes will appear here after PSN reports them.</p>');
    text('feed-status',rows.length + ' observations · ' + (activityPage + 1) + '/' + count);
    text('activity-note','Observed by PSN polling · Up/Down history · Retention ' + (snapshot ? snapshot.options.retentionDays : '—') + ' days');
  }
  function buildPages() {
    if (value('game-running') === true) {
      var progress = value('active-trophy-progress');
      var knownProgress = typeof progress === 'number' && isFinite(progress) && progress >= 0 && progress <= 100;
      var name = value('active-game') || 'Current game';
      pages = [{id:'active-game',kind:'game',title:'Game trophies',markup:
        '<div class="game-focus"><div class="game-focus-name" title="' + esc(name) + '">' + esc(name) + '</div>'
        + '<div class="game-focus-total"><strong>' + esc(number(value('active-trophies'))) + '<small> / '
        + esc(number(value('active-trophies-available'))) + ' earned</small></strong><span>'
        + (knownProgress ? esc(number(progress)) + '% progress' : 'Progress unavailable') + '</span></div>'
        + '<svg class="game-focus-bar" viewBox="0 0 800 6" preserveAspectRatio="none" role="img" aria-label="'
        + (knownProgress ? esc(number(progress)) + '% trophy progress' : 'Trophy progress unavailable')
        + '"><rect width="800" height="6"/><rect class="game-focus-fill" width="' + (knownProgress ? progress * 8 : 0) + '" height="6"/></svg>'
        + '<div class="game-focus-grades">' + ['platinum','gold','silver','bronze'].map(function (grade) {
          return '<div class="' + grade + '"><i class="fa fa-trophy" aria-hidden="true"></i><strong>'
            + esc(number(value('active-' + grade))) + '</strong><span>' + grade + '</span></div>';
        }).join('') + '</div><div class="game-focus-meta">'
        + esc(number(value('active-play-hours'),1)) + 'h played · ' + esc(number(value('active-play-count'))) + ' plays'
        + '</div><div class="game-focus-dates">First played ' + esc(date(value('active-first-played'),false))
        + ' · Last played ' + esc(date(value('active-last-played'),false)) + '</div></div>'}];
      pageId = 'active-game';return;
    }
    var result = [];
    (snapshot ? snapshot.catalog : []).filter(function (field) { return field.type === 'table'; }).forEach(function (field) {
      var rows = value(field.id) || [], columns = field.columns || [];
      // Keep names on each page; split wide tables so dates do not compete
      // with five tiny numeric columns on a television viewed at a distance.
      var groupSize = field.id === 'consoles' ? 2 : 3;
      for (var group = 1; group < Math.max(2,columns.length); group += groupSize) {
        var shown = [columns[0]].concat(columns.slice(group,group + groupSize));
        for (var start = 0; start < Math.max(1,rows.length); start += 5) {
          var part = rows.slice(start,start + 5);
          result.push({id:field.id + '-' + start + '-' + group,title:field.label + (group > 1 ? ' · Details' : '') + (rows.length > 5 ? ' · ' + (Math.floor(start / 5) + 1) : ''),markup:part.length
            ? '<table><thead><tr>' + shown.map(function (column) { return '<th>' + esc(column.label) + '</th>'; }).join('')
              + '</tr></thead><tbody>' + part.map(function (row) { return '<tr>' + shown.map(function (column) {
                return '<td title="' + esc(formatted(row[column.id],column.type)) + '">' + esc(formatted(row[column.id],column.type)) + '</td>';
              }).join('') + '</tr>'; }).join('') + '</tbody></table>'
            : '<p class="empty">No ' + esc(field.label.toLowerCase()) + ' reading is available.</p>'});
        }
      }
    });
    var fields = snapshot ? snapshot.catalog.filter(function (field) { return field.type !== 'table'; }) : [];
    for (var index = 0; index < fields.length; index += 10) result.push({id:'telemetry-' + index,title:'Account telemetry · ' + (Math.floor(index / 10) + 1),
      markup:'<div class="telemetry">' + fields.slice(index,index + 10).map(function (field) {
        return '<div class="telemetry-item"><span>' + esc(field.label) + '</span><strong>' + esc(formatted(value(field.id),field.type)) + '</strong></div>';
      }).join('') + '</div>'});
    pages = result.length ? result : [{id:'empty',title:'PlayStation readings',markup:'<p class="empty">Enable and configure the PlayStation plugin in Localserve.</p>'}];
    if (!pages.some(function (page) { return page.id === pageId; })) pageId = pages[0].id;
  }
  function renderPage() {
    var index = pages.map(function (page) { return page.id; }).indexOf(pageId), page = pages[index];
    if (!page) return;
    text('detail-eyebrow',page.kind === 'game' ? 'CURRENT GAME' : 'PLAYER INTELLIGENCE');
    text('detail-title',page.title); html('detail-content',page.markup);
    html('page-dots',pages.length > 1 ? pages.map(function (item) { return '<span class="page-dot' + (item.id === pageId ? ' active' : '') + '"></span>'; }).join('') : '');
    text('detail-controls',page.kind === 'game' ? 'Play/Pause Motion · CH+ Settings · Back Return' : '◀ ▶ Details · Play/Pause · CH+ Settings');
    text('detail-status',page.kind === 'game' ? value('active-trophies-received-at') !== null
      ? 'Trophies received ' + date(value('active-trophies-received-at'),true) : 'No trophy summary received for this game'
      : (paused ? 'Paused · ' : '') + (index + 1) + '/' + pages.length + ' · ' + (value('details-status') || 'No detail reading'));
  }
  function step(amount) {
    if (pages.length < 2) return;
    var index = pages.map(function (page) { return page.id; }).indexOf(pageId);
    pageId = pages[(index + amount + pages.length) % pages.length].id; renderPage(); armRotation();
  }
  function armRotation() {
    clearTimeout(rotationTimer);
    rotationTimer = null;
    if (pages.length > 1 && !document.hidden && !paused && connected) rotationTimer = setTimeout(function () { rotationTimer = null;step(1); },20000);
  }
  function render() {
    text('server-brand',snapshot.options.serverName || 'Localserve');
    document.documentElement.setAttribute('data-online',String(value('online') === true));
    text('account',value('online-id') || (snapshot.enabled ? 'Account unavailable' : 'PlayStation disabled'));
    text('presence',snapshot.enabled ? value('online-status') || snapshot.status : 'Disabled');
    text('plus',value('plus') === true ? 'PLUS MEMBER' : value('plus') === false ? '' : '');
    text('game',value('active-game-display') || 'No game reading');
    text('game-label',value('game-running') === true ? 'NOW PLAYING · PSN REPORTED' : 'PLAYSTATION NETWORK');
    text('level',number(value('trophy-level')));text('progress',value('trophy-progress') === null ? '—' : number(value('trophy-progress')) + '%');
    var progress = value('trophy-progress');
    node('progress-ring').setAttribute('stroke-dasharray',(typeof progress === 'number' ? Math.max(0,Math.min(100,progress)) / 100 * 307.876 : 0) + ' 307.876');
    if (typeof progress === 'number') node('progress-meter').setAttribute('aria-valuenow',String(progress));
    else node('progress-meter').removeAttribute('aria-valuenow');
    text('total',number(value('trophies-total')));text('hours',number(value('all-games-play-hours')));
    ['platinum','gold','silver','bronze'].forEach(function (id) { text(id,number(value(id))); });
    var collections = value('collections') || [];
    var items = collections.map(function (row) { return '<span class="ticker-item">' + esc(row.name || 'Unnamed collection')
      + '<b>' + esc(number(row.progress)) + '% · ' + esc(number(row.earned)) + '/' + esc(number(row.available)) + '</b></span>'; }).join('');
    node('trophy-track').className = 'ticker-track' + (items ? '' : ' static');
    html('trophy-track',items ? '<span class="ticker-group">' + items + '</span><span class="ticker-group" aria-hidden="true">' + items + '</span>'
      : '<span class="ticker-item">No trophy collection reading available</span>');
    buildPages(); renderPage(); renderActivity(); renderHud(); updateClock();
    if (pages.length < 2 || !rotationTimer) armRotation();
  }
  function updateClock() {
    var now = Date.now() + clockOffset, fresh = freshness(), online = value('online') === true;
    text('clock',date(now,true));
    if (!snapshot) return;
    var observed = value('session-observed-at'), started = value('session-started-at');
    var session = online && typeof observed === 'number'
      ? (started !== null ? 'Session observed ' : 'Seen online ') + duration(((fresh ? now : value('received-at')) - observed) / 1000) : null;
    text('game-meta',[value('platform'),value('active-play-hours') !== null ? number(value('active-play-hours'),1) + 'h in this game' : null,
      value('active-trophies') !== null ? number(value('active-trophies')) + ' game trophies' : null,session].filter(Boolean).join(' · ') || 'No current game statistics');
    text('reception',value('received-at') !== null ? (fresh ? 'PSN received ' : 'Retained · received ') + date(value('received-at'),true) : 'Waiting for PSN readings');
    text('connection-state',!connected ? 'Server disconnected · retained readings' : !snapshot.enabled ? 'PlayStation plugin is disabled'
      : fresh ? 'PSN observations · polling every ' + snapshot.options.pollSeconds + 's' : snapshot.status + ' · waiting for a fresh PSN reading');
    var gameStart = value('game-session-started-at'), running = value('game-running') === true;
    text('hud-clock',date(now,true));
    var gameTime = running && typeof gameStart === 'number' ? duration(((fresh ? now : value('received-at')) - gameStart) / 1000) : '—';
    text('hud-timer',gameTime);text('hud-line-time',gameTime);text('hud-line-time-copy',gameTime);
    text('hud-session-note',running && typeof gameStart === 'number' ? (fresh ? 'First observed ' : 'Retained · first observed ') + date(gameStart,true) : 'Starts when Localserve first sees the game');
    text('hud-signal',!connected ? 'Server disconnected · retained readings' : fresh ? 'PSN received ' + date(value('received-at'),true) + ' · ' + snapshot.options.pollSeconds + 's polling' : 'Waiting for a fresh PSN reading');
    node('hud-toast').hidden = !fresh || document.hidden || Date.now() >= toastUntil;
  }
  function stateMessage() {
    if (parentSession && window.parent !== window) window.parent.postMessage({type:'localserve-ps-state',id:parentSession,path:'/playstation-mode',connected:connected},'*');
  }
  function changeConnection(value) {
    connected = value;if (!value) { clearToast();trophyGame = '';trophyCount = null;trophyReceipt = null; }
    document.documentElement.setAttribute('data-connected',String(value)); stateMessage(); updateClock();
  }
  var closingTicket = '';
  function closeFromServer(ticket) {
    if(!parentSession||document.hidden||!ticket||!/^[a-f0-9]{32}$/.test(ticket.id)
      ||!/^[a-f0-9]{48}$/.test(ticket.token)||ticket.id===closingTicket)return;
    closingTicket=ticket.id;
    var session=parentSession,epoch=hiddenGeneration,ack=new XMLHttpRequest();
    ack.open('POST','/api/playstation-mode/close',true);ack.timeout=2500;ack.setRequestHeader('Content-Type','application/json');
    ack.onload=function(){
      if(ack.status===200&&session===parentSession&&epoch===hiddenGeneration&&!document.hidden)
        window.parent.postMessage({type:'localserve-ps-back',id:session,path:'/playstation-mode'},'*');
    };
    ack.send(JSON.stringify({id:ticket.id,token:ticket.token}));
  }
  function poll() {
    clearTimeout(pollTimer);
    if (document.hidden || request) return;
    var generation = hiddenGeneration, xhr = new XMLHttpRequest(); request = xhr;
    xhr.open('GET','/api/playstation-mode',true);xhr.timeout = 7000;
    function done() {
      if (request !== xhr) return;
      request = null;
      if (generation !== hiddenGeneration || document.hidden) return;
      try {
        if (xhr.status !== 200 || xhr.responseText.length > 262144) throw new Error('Unavailable');
        var data = JSON.parse(xhr.responseText);
        if (!data || !Array.isArray(data.catalog) || !Array.isArray(data.activity) || !data.values || !data.options) throw new Error('Unavailable');
        snapshot = data;clockOffset = data.options.now - Date.now();changeConnection(true);render();closeFromServer(data.closeRequest);
      } catch (ignore) { changeConnection(false); clearTimeout(rotationTimer);rotationTimer = null; }
      pollTimer = setTimeout(poll,5000);
    }
    xhr.onload = done;xhr.onerror = done;xhr.ontimeout = done;xhr.send();
  }
  function key(code) {
    if (code === remoteKeys.settings && parentSession) window.parent.postMessage({type:'localserve-ps-settings',id:parentSession,path:'/playstation-mode'},'*');
    else if (code === 76 || code === remoteKeys.cycle) cycleAppearance();
    else if (code === 72 || (layoutKey !== null && code === layoutKey)) toggleLayout();
    else if (code === 37 || code === 39) step(code === 37 ? -1 : 1);
    else if (code === 38 || code === 40) {
      var count = Math.max(1,Math.ceil((snapshot ? snapshot.activity.length : 0) / 5));
      activityPage = (activityPage + (code === 38 ? -1 : 1) + count) % count;renderActivity();
    } else if (code === 13 || code === remoteKeys.toggle || code === remoteKeys.play || code === remoteKeys.pause) {
      paused = code === remoteKeys.play ? false : code === remoteKeys.pause ? true : !paused;
      document.documentElement.setAttribute('data-motion',paused ? 'paused' : 'running');renderPage();armRotation();
    }
    else if ((code === 10009 || code === 27) && parentSession) window.parent.postMessage({type:'localserve-ps-back',id:parentSession,path:'/playstation-mode'},'*');
    else return false;
    return true;
  }
  window.addEventListener('message',function (event) {
    if (event.source !== window.parent || window.parent === window || !['null','file://',window.location.origin].some(function (origin) { return event.origin === origin; })) return;
    var data = event.data;
    if (!data || data.path !== '/playstation-mode') return;
    if (data.type === 'localserve-ps-probe' && typeof data.id === 'string' && /^[a-z0-9-]{1,80}$/.test(data.id)) {
      parentSession = data.id;parentLayouts = Array.isArray(data.layouts) && data.layouts.indexOf('split') >= 0 && data.layouts.indexOf('hud') >= 0;
      parentAppearance = data.appearance === true;
      remoteKeys = {};['settings','cycle','toggle','play','pause'].forEach(function (name) { var code = data.remoteKeys && data.remoteKeys[name];if (typeof code === 'number' && isFinite(code) && code > 40 && code < 65536 || name === 'pause' && code === 19) remoteKeys[name] = code; });
      layoutKey = parentLayouts && typeof data.layoutKey === 'number' && isFinite(data.layoutKey) && data.layoutKey > 40 ? data.layoutKey : null;
      applyLayout('split');stateMessage();
    }
    else if (data.id === parentSession && data.type === 'localserve-ps-layout' && data.native === true && parentLayouts && validLayout(data.layout)) applyLayout(data.layout);
    else if (data.id === parentSession && data.type === 'localserve-ps-appearance' && parentAppearance) applyAppearance(data.style,data.opacity);
    else if (data.id === parentSession && data.type === 'localserve-ps-native-status' && typeof data.message === 'string') text('video-status',data.message.slice(0,200));
    else if (data.id === parentSession && data.type === 'localserve-ps-key' && ([13,37,38,39,40].indexOf(data.keyCode) >= 0 || Object.keys(remoteKeys).some(function (name) { return remoteKeys[name] === data.keyCode; }) || layoutKey !== null && data.keyCode === layoutKey)) key(data.keyCode);
  });
  document.addEventListener('keydown',function (event) { if (!event.repeat && key(event.keyCode)) { event.preventDefault();event.stopPropagation(); } });
  document.addEventListener('visibilitychange',function () {
    hiddenGeneration++;document.documentElement.setAttribute('data-hidden',String(document.hidden));clearTimeout(pollTimer);clearTimeout(rotationTimer);rotationTimer = null;
    clearToast();trophyGame = '';trophyCount = null;trophyReceipt = null;
    if (request) { var old = request;request = null;old.abort(); }
    if (!document.hidden) { poll();armRotation(); }
  });
  function fit() { var scale = Math.min(window.innerWidth / 1920,window.innerHeight / 1080);node('stage').style.webkitTransform = node('stage').style.transform = 'scale(' + scale + ')'; }
  node('layout-toggle').onclick = toggleLayout;node('hud-style-toggle').onclick = cycleAppearance;applyAppearance('edges',100);applyLayout('split');
  window.addEventListener('resize',fit);fit();setInterval(updateClock,1000);poll();
  root.PlaystationModeView = {escape:esc,duration:duration,activityLabel:activityLabel,gameTheme:gameTheme};
}(this));
