/* Personal favorites contain IDs only. Capabilities and reported values stay
 * in memory and are refreshed from scoped viewer APIs; commands never retry. */
(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector),
    content = $('#content'),
    sheet = $('#sheet');
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
    );
  const icon = (id) => `<i class="material-symbol ms-${esc(id)}" aria-hidden="true"></i>`;
  const storage = {
    get(key, fallback) {
      try {
        return JSON.parse(localStorage.getItem(key)) ?? fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        message('This browser cannot retain preferences.');
      }
    },
  };
  let favorites = storage.get('localserve.home.favorites', null),
    sound = storage.get('localserve.home.sound', false) === true;
  if (!Array.isArray(favorites) || favorites.some((id) => typeof id !== 'string')) favorites = null;
  let model = null,
    view = 'home',
    online = false,
    reading = false,
    timer,
    signature = '',
    modal = null,
    remote = null,
    busy = false,
    remoteReceipt = null,
    receiptTimer,
    feedbackTimer,
    audio;
  const cardReadings = new Map();
  let readingCards = false,
    cardTimer;
  const remoteKey = (page) => 'remote:' + page.pluginId + ':' + page.slug;
  const taskKey = (task) => 'task:' + task.id;
  const cardKey = (card) => 'card:' + card.pluginId + ':' + card.templateId + ':' + card.sourceId;
  const endpoint = (page) => '/api/control-view/' + page.pluginId + '/' + page.slug;
  function all() {
    return [
      ...(model?.remotes || []).map((page) => ({
        key: remoteKey(page),
        name: page.name,
        icon: page.icon || 'gamepad',
        type: 'remote',
        value: page,
      })),
      ...(model?.tasks || []).map((task) => ({
        key: taskKey(task),
        name: task.name,
        icon: task.icon,
        type: 'task',
        value: task,
      })),
      ...(model?.cards || []).map((card) => ({
        key: cardKey(card),
        name: card.name,
        icon: card.icon,
        type: 'card',
        value: card,
      })),
    ];
  }
  function keys() {
    return (
      favorites ?? [
        ...(model?.remotes || []).slice(0, 2).map(remoteKey),
        ...(model?.tasks || []).slice(0, 4).map(taskKey),
        ...(model?.cards || []).slice(0, 3).map(cardKey),
      ]
    );
  }
  function message(text) {
    $('#feedback').textContent = text;
    $('#feedback').hidden = false;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => ($('#feedback').hidden = true), 4500);
  }
  function chime() {
    if (!sound) return;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      audio ??= new Context();
      void audio.resume();
      const start = audio.currentTime,
        osc = audio.createOscillator(),
        gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(620, start);
      osc.frequency.exponentialRampToValueAtTime(930, start + 0.09);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.035, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(start);
      osc.stop(start + 0.15);
    } catch {
      /* Audio availability does not affect control execution. */
    }
  }
  function uuid() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map((n) => n.toString(16).padStart(2, '0')).join('');
    return (
      hex.slice(0, 8) +
      '-' +
      hex.slice(8, 12) +
      '-' +
      hex.slice(12, 16) +
      '-' +
      hex.slice(16, 20) +
      '-' +
      hex.slice(20)
    );
  }
  async function api(path, values, header) {
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(path, {
        method: values ? 'POST' : 'GET',
        credentials: 'omit',
        cache: 'no-store',
        headers: values ? { 'Content-Type': 'application/json', ...header } : header,
        body: values ? JSON.stringify(values) : undefined,
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) {
        const error = new Error(body.error || 'Request unavailable.');
        error.status = response.status;
        throw error;
      }
      return body;
    } finally {
      clearTimeout(timeout);
    }
  }
  function status() {
    $('#connection').textContent = online ? (model?.paused ? 'Server paused' : 'Connected') : 'Offline';
    $('#connection').dataset.connected = String(online && !model?.paused);
    document.querySelectorAll('[data-open]').forEach((button) => {
      const item = all().find((item) => item.key === button.dataset.open);
      button.disabled = !online || !item?.value.available;
    });
    document.querySelectorAll('[data-status]').forEach((label) => {
      const item = all().find((item) => item.key === label.dataset.status);
      label.textContent = !online
        ? 'Offline'
        : item?.value.available
          ? item.type === 'card'
            ? item.value.designName
            : item.value.summary || 'Ready'
          : 'Unavailable';
    });
  }
  function tile(item, compact = false) {
    return `<button class="${compact ? 'quick' : 'tile'}" data-open="${esc(item.key)}">${icon(item.icon)}<span><strong>${esc(item.name)}</strong>${compact ? `<small>${item.type === 'task' ? 'Run Task' : esc(item.value.pluginName)}</small>` : ''}</span>${compact ? '' : `<small data-status="${esc(item.key)}">${item.value.available ? 'Ready' : 'Unavailable'}</small>${icon('chevron-right').replace('material-symbol', 'material-symbol arrow')}`}</button>`;
  }
  function render(force = false) {
    if (!model) return;
    const items = all(),
      selected = keys()
        .map((id) => items.find((item) => item.key === id))
        .filter(Boolean);
    const next = JSON.stringify([view, items.map((item) => [item.key, item.name, item.icon]), keys()]);
    status();
    if (!force && next === signature) return;
    signature = next;
    const title =
      view === 'home' ? 'Home' : view === 'remotes' ? 'Remotes' : view === 'cards' ? 'Cards' : 'Tasks';
    let body = `<div class="page-title"><div><p class="eyebrow">YOUR SPACE</p><h1>${title}</h1></div><button class="text-button" data-action="${view === 'home' ? 'edit' : 'preferences'}">${view === 'home' ? 'Edit' : icon('sliders')}</button></div>`;
    if (view === 'home') {
      const remotes = selected.filter((item) => item.type === 'remote'),
        tasks = selected.filter((item) => item.type === 'task');
      body += remotes.length
        ? `<div class="tiles">${remotes.map((item) => tile(item)).join('')}</div>`
        : '<div class="empty"><p>Your favorite remotes belong here.</p><button class="text-button" data-action="edit">Choose favorites</button></div>';
      body += `<div class="section-title"><h2>Quick actions</h2><button class="text-button" data-nav="tasks">See all</button></div>`;
      body += tasks.length
        ? `<div class="tiles">${tasks.map((item) => tile(item, true)).join('')}</div>`
        : '<p class="subtle">Publish Tasks in Administration → Phone home, then add your favorites.</p>';
      const cards = selected.filter((item) => item.type === 'card');
      body += `<div class="section-title"><h2>Information</h2><button class="text-button" data-nav="cards">See all</button></div>`;
      body += cards.length
        ? `<div class="home-cards">${cards.map((item) => `<section class="home-card"><div class="home-card-heading"><span>${icon(item.icon)}${esc(item.name)}</span><button class="round" data-open="${esc(item.key)}" aria-label="Expand ${esc(item.name)}">${icon('open-in-full')}</button></div>${cardHost(item)}</section>`).join('')}</div>`
        : '<p class="subtle">Add ready-made Cards from enabled plugins with Home → Edit.</p>';
      body += `<div class="section-title"><span class="subtle">Personalize your space</span><button class="text-button" data-action="preferences" aria-label="Phone preferences">${icon('sliders')}</button></div>`;
    } else {
      const shown = items.filter(
        (item) => item.type === (view === 'tasks' ? 'task' : view === 'cards' ? 'card' : 'remote'),
      );
      body += shown.length
        ? `<div class="tiles">${shown.map((item) => tile(item, view === 'tasks')).join('')}</div>`
        : `<div class="empty">${view === 'tasks' ? 'No Tasks have been published. Choose them in Administration → Phone home.' : view === 'cards' ? 'Enable a plugin with a ready-made design and a data source to see its Cards here.' : 'No enabled remote pages. Create and enable a page in Administration → Controls.'}</div>`;
      if (view === 'tasks')
        body +=
          '<p class="subtle">Tasks run manually. Tasks that require captured Event values must be run from the administrator.</p>';
    }
    content.innerHTML = body;
    status();
    paintCards();
    scheduleCards();
    document.querySelectorAll('.bottom-nav button').forEach((button) => {
      if (button.dataset.nav === view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }
  function cardHost(item) {
    return `<div class="phone-card-frame" data-card-host="${esc(item.key)}" aria-label="${esc(item.name)}"><p class="subtle">Loading Card…</p></div>`;
  }
  function openCard(item) {
    openSheet(item.name, cardHost(item), 'card');
    modal.key = item.key;
    paintCards();
    scheduleCards();
  }
  function paintCards() {
    for (const host of document.querySelectorAll('[data-card-host]')) {
      // Older installed shells can still use remotes and Tasks while their
      // route policy excludes Card assets. Keep that failure local to Cards.
      if (typeof CardRenderer === 'undefined') {
        host.innerHTML = '<p class="subtle">Update the Localserve Android app to display Cards.</p>';
        continue;
      }
      const reading = cardReadings.get(host.dataset.cardHost);
      if (reading)
        CardRenderer.mount(
          host,
          CardRenderer.render(reading.card, reading.data, reading.catalog, {
            ...reading.options,
            connected: online && !document.hidden && !reading.disconnected,
          }),
        );
    }
  }
  function scheduleCards() {
    clearTimeout(cardTimer);
    if (!document.hidden) cardTimer = setTimeout(refreshCards, 120);
  }
  async function refreshCards() {
    if (
      readingCards ||
      !online ||
      document.hidden ||
      pendingRemoteReceipt() ||
      typeof CardRenderer === 'undefined'
    )
      return;
    readingCards = true;
    try {
      // Only visible Cards are polled. One bounded batch cannot grow with a
      // long Favorites list, and polling never replaces a connected iframe.
      const bounds = (sheet.open ? sheet : content).getBoundingClientRect();
      const hosts = [...(sheet.open ? sheet : content).querySelectorAll('[data-card-host]')]
        .filter((host) => {
          const rect = host.getBoundingClientRect();
          return rect.bottom > bounds.top && rect.top < bounds.bottom;
        })
        .slice(0, 4);
      await Promise.all(
        hosts.map(async (host) => {
          const key = host.dataset.cardHost;
          const item = all().find((item) => item.key === key && item.type === 'card');
          if (!item) return;
          const card = item.value;
          try {
            const reading = await api(
              '/api/phone-home/cards/' + card.pluginId + '/' + card.templateId + '/' + card.sourceId,
            );
            if (!host.isConnected || !model.cards.some((entry) => cardKey(entry) === key)) return;
            cardReadings.set(key, reading);
            if (!document.hidden) paintCards();
          } catch (error) {
            if (!host.isConnected) return;
            if (error.status === 404 || error.status === 403) {
              cardReadings.delete(key);
              host.innerHTML = '<p class="subtle">Card unavailable.</p>';
            } else {
              const reading = cardReadings.get(key);
              if (reading) reading.disconnected = true;
              if (reading)
                CardRenderer.mount(
                  host,
                  CardRenderer.render(reading.card, reading.data, reading.catalog, {
                    ...reading.options,
                    connected: false,
                  }),
                );
              else host.innerHTML = '<p class="subtle">Card unavailable. Check the server connection.</p>';
            }
          }
        }),
      );
    } finally {
      readingCards = false;
    }
  }
  function openSheet(title, body, kind) {
    modal = { kind, returnFocus: modal?.returnFocus || document.activeElement };
    $('#sheet-content').innerHTML =
      `<div class="sheet-grip"></div><div class="sheet-heading"><h2 id="sheet-title">${esc(title)}</h2><button class="round" data-action="close" aria-label="Close">${icon('xmark')}</button></div>${body}`;
    if (!sheet.open) sheet.showModal();
    else sheet.querySelector('button')?.focus();
  }
  function closeSheet() {
    if (busy) return;
    sheet.close();
  }
  sheet.addEventListener('close', () => {
    const focus = modal?.returnFocus;
    modal = null;
    remote = null;
    remoteReceipt = null;
    clearTimeout(receiptTimer);
    focus?.focus({ preventScroll: true });
  });
  sheet.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });
  function edit() {
    const draft = [...keys()],
      items = all();
    openSheet(
      'Your favorites',
      '<p class="subtle">Choose what belongs on Home. Use the arrows to arrange it.</p><div id="favorite-options"></div><div class="sheet-actions"><button class="primary" data-action="favorites-save">Done</button></div>',
      'favorites',
    );
    modal.draft = draft;
    modal.items = items;
    renderFavorites();
  }
  function renderFavorites() {
    const active = document.activeElement,
      focusKey = active?.dataset.favorite || active?.dataset.move,
      direction = active?.dataset.direction;
    const ordered = [
      ...modal.draft.map((id) => modal.items.find((item) => item.key === id)).filter(Boolean),
      ...modal.items.filter((item) => !modal.draft.includes(item.key)),
    ];
    $('#favorite-options').innerHTML = ordered.length
      ? ordered
          .map(
            (item) =>
              `<div class="favorite-row"><label><input type="checkbox" data-favorite="${esc(item.key)}" ${modal.draft.includes(item.key) ? 'checked' : ''}>${icon(item.icon)}<span>${esc(item.name)}<small>${item.type === 'card' ? esc(item.value.designName) + ' · Card' : item.type === 'task' ? 'Task' : 'Remote'}</small></span></label>${modal.draft.includes(item.key) ? `<button data-move="${esc(item.key)}" data-direction="-1" aria-label="Move ${esc(item.name)} up" ${modal.draft.indexOf(item.key) === 0 ? 'disabled' : ''}>${icon('arrow-up')}</button><button data-move="${esc(item.key)}" data-direction="1" aria-label="Move ${esc(item.name)} down" ${modal.draft.indexOf(item.key) === modal.draft.length - 1 ? 'disabled' : ''}>${icon('arrow-down')}</button>` : ''}</div>`,
          )
          .join('')
      : '<p class="empty">Enable plugins, remote pages or Task shortcuts in the administrator first.</p>';
    if (focusKey)
      [...$('#favorite-options').querySelectorAll('input,button')]
        .find(
          (node) =>
            (node.dataset.favorite || node.dataset.move) === focusKey &&
            node.dataset.direction === direction &&
            !node.disabled,
        )
        ?.focus({ preventScroll: true });
  }
  function preferences() {
    openSheet(
      'Make it yours',
      `<p class="subtle">Favorites are saved on this phone for this server address. A different address or port uses separate choices.</p><p class="subtle">Server ${esc(model?.version ? 'v'+model.version : 'version unavailable')}. Reload Home after an interface update; APK and server updates are separate.</p><label class="sound-control"><span>Interface sounds<small class="subtle"> · quiet feedback on touch</small></span><input type="checkbox" id="sounds" ${sound ? 'checked' : ''}></label><button class="secondary" data-action="edit">Choose favorites</button>`,
      'preferences',
    );
  }
  async function openRemote(page) {
    openSheet(page.name, '<p class="live-status">Loading controls…</p>', 'remote');
    const context = modal;
    context.page = page;
    try {
      const data = await api(endpoint(page));
      if (modal !== context) return;
      remote = data;
      context.revision = data.page.revision;
      renderRemote();
    } catch (error) {
      if (modal === context)
        $('#sheet-content').insertAdjacentHTML(
          'beforeend',
          `<p class="live-status">${esc(error.message)}</p>`,
        );
    }
  }
  function field(item) {
    const input = item.input;
    if (!input)
      return `<button class="secondary" data-item="${esc(item.id)}">${icon(item.icon || 'play')}${esc(item.label)}</button>`;
    const known = item.hasReading && item.reported !== null && item.reported !== undefined,
      value = known ? item.reported : input.default;
    if (item.kind === 'range')
      return `<div class="sheet-control"><label>${esc(item.label)}<output data-reading="${esc(item.id)}">${known ? esc(item.reported) : 'Unknown'}</output></label><input aria-label="${esc(item.label)}" data-input="${esc(item.id)}" type="range" min="${input.min}" max="${input.max}" value="${Number.isFinite(value) ? value : input.min}"></div>`;
    if (item.kind === 'toggle')
      return `<button class="secondary" data-toggle="${esc(item.id)}">${icon(item.icon || 'power-off')}${esc(item.label)}<span data-reading="${esc(item.id)}">${known ? (item.reported ? 'On' : 'Off') : 'Unknown'}</span></button>`;
    if (item.kind === 'select')
      return `<div class="sheet-control"><label>${esc(item.label)}</label><select aria-label="${esc(item.label)}" data-input="${esc(item.id)}"><option value="">Choose…</option>${(input.enum || []).map((option, index) => `<option value="${index}">${esc(input.enumLabels?.[index] || option)}</option>`).join('')}</select></div>`;
    return '';
  }
  function renderRemote() {
    const data = remote,
      lighting = data.lighting;
    let body = '';
    if (lighting) {
      const targets = [
        ...(lighting.groups || []).map((target) => ({ ...target, kind: 'Group' })),
        ...(lighting.lights || []).map((target) => ({ ...target, kind: 'Light' })),
      ];
      modal.targets = targets;
      if (!targets.some((target) => target.kind + ':' + target.id === modal.target))
        modal.target = targets[0] ? targets[0].kind + ':' + targets[0].id : null;
      body += `<div class="sheet-control"><label for="light-target">Lights</label><select id="light-target">${targets.map((target) => `<option value="${esc(target.kind + ':' + target.id)}" ${modal.target === target.kind + ':' + target.id ? 'selected' : ''}>${esc(target.name)} · ${esc(target.kind)}</option>`).join('')}</select></div><div id="light-controls"></div>`;
      const scenes = data.page.items.filter((item) => item.kind === 'scene');
      if (scenes.length)
        body += `<h3>Scenes</h3><div class="scene-list">${scenes.map((item) => `<button data-item="${esc(item.id)}">${esc(item.label)}</button>`).join('')}</div>`;
    } else if (data.page.presentation === 'television') {
      const buttonFor = (role) => data.page.items.find((item) => !item.input && item.remoteRole === role);
      const buttons = (roles) => roles.map(buttonFor).filter(Boolean).map(field).join('');
      // Direction keys retain their physical relationship regardless of the
      // saved mapping order. Missing directions leave inert spaces, not commands.
      const pad = [null, 'up', null, 'left', 'enter', 'right', null, 'down', null]
        .map((role) =>
          role && buttonFor(role) ? field(buttonFor(role)) : '<span aria-hidden="true"></span>',
        )
        .join('');
      body += `<div class="remote-keys">${buttons(['power', 'off', 'wake', 'home'])}</div>
        <div class="remote-keys remote-pad" role="group" aria-label="Directional navigation">${pad}</div>
        <div class="remote-keys">${buttons(['back', 'play', 'pause', 'volume-down', 'mute', 'volume-up'])}</div>${data.page.items
          .filter((item) => item.input && ['volume', 'muted', 'input'].includes(item.remoteRole))
          .map(field)
          .join('')}`;
      const apps = data.page.items.filter((item) => ['app', 'scene'].includes(item.remoteRole));
      if (apps.length)
        body += `<h3>Shortcuts</h3><div class="scene-list">${apps.slice(0, 8).map(field).join('')}</div>`;
    } else
      body += `<div class="scene-list">${data.page.items
        .filter((item) => !item.input)
        .slice(0, 12)
        .map(field)
        .join('')}</div>${data.page.items
        .filter((item) => item.input)
        .slice(0, 8)
        .map(field)
        .join('')}`;
    $('#sheet-content').innerHTML =
      `<div class="sheet-grip"></div><div class="sheet-heading"><h2 id="sheet-title">${esc(data.page.name)}</h2><button class="round" data-action="close" aria-label="Close">${icon('xmark')}</button></div>${body}<p class="live-status" id="remote-status" role="status"></p><div class="sheet-actions"><a class="primary" href="${esc(modal.page.url)}">Full remote ${icon('arrow-right')}</a></div>`;
    if (lighting) renderLight();
    hydrateRemote();
    sheet.querySelector('button')?.focus({ preventScroll: true });
  }
  function renderLight() {
    const target = modal.targets.find((target) => target.kind + ':' + target.id === modal.target);
    if (!target) return;
    $('#light-controls').innerHTML = ['power', 'brightness', 'temperature', 'color']
      .map((key) => remote.page.items.find((item) => item.id === target.controls[key]))
      .filter(Boolean)
      .map(field)
      .join('');
  }
  function hydrateRemote() {
    if (!remote || modal?.kind !== 'remote') return;
    document.querySelectorAll('[data-item],[data-input],[data-toggle]').forEach((control) => {
      const id = control.dataset.item || control.dataset.input || control.dataset.toggle,
        item = remote.page.items.find((item) => item.id === id);
      control.disabled =
        busy || pendingRemoteReceipt() || remote.busy || !online || !remote.available || !item?.available;
      if (
        item?.hasReading &&
        item.reported !== null &&
        item.reported !== undefined &&
        document.activeElement !== control &&
        control.matches('input[type="range"]')
      )
        control.value = item.reported;
    });
    document.querySelectorAll('[data-reading]').forEach((label) => {
      const item = remote.page.items.find((item) => item.id === label.dataset.reading);
      label.textContent =
        item?.hasReading && item.reported !== null && item.reported !== undefined
          ? item.kind === 'toggle'
            ? item.reported
              ? 'On'
              : 'Off'
            : String(item.reported)
          : 'Unknown';
    });
    const line = $('#remote-status');
    if (line && !busy)
      line.textContent = !online
        ? 'Offline · showing last received values'
        : !remote.available
          ? 'Remote unavailable. Check server and plugin settings.'
          : 'Values are reported by the plugin.';
  }
  async function invoke(item, value) {
    if (busy || pendingRemoteReceipt() || remote?.busy || !online || !remote?.available) return;
    const focus = document.activeElement;
    busy = true;
    hydrateRemote();
    chime();
    const context = modal,
      snapshot = remote;
    const requestId = uuid();
    remoteReceipt = { id: requestId, context, deadline: Date.now() + 35000 };
    try {
      await api(
        endpoint(context.page) + '/run',
        {
          itemId: item.id,
          requestId,
          revision: snapshot.page.revision,
          ...(value !== undefined ? { value } : {}),
        },
        { 'X-Localserve-Control-Token': snapshot.token },
      );
      message('Command submitted');
    } catch (error) {
      if (error.status >= 400 && error.status < 500) remoteReceipt = null;
      message(error.message + ' Check the remote before trying again.');
    } finally {
      busy = false;
      if (modal === context) {
        hydrateRemote();
        if (focus?.isConnected && !focus.disabled) focus.focus({ preventScroll: true });
      }
      void refresh();
    }
  }
  function pendingRemoteReceipt() {
    return remoteReceipt && remoteReceipt.context === modal && Date.now() < remoteReceipt.deadline;
  }
  function openTask(task) {
    openSheet(
      task.taskName || task.name,
      `<p class="subtle">Start this Task from the beginning? Its configured actions may control your devices.</p><div class="sheet-actions"><button class="primary" data-action="task-run">${icon('play')}Run Task</button><button class="secondary" data-action="close">Cancel</button></div><p id="task-status" class="live-status" role="status"></p>`,
      'task',
    );
    modal.task = { ...task };
    modal.homeRevision = model.revision;
  }
  async function runTask() {
    if (busy || modal?.submitted || !online) return;
    busy = true;
    modal.submitted = true;
    const context = modal,
      task = context.task;
    $('[data-action="task-run"]').disabled = true;
    $('#task-status').textContent = 'Submitting…';
    chime();
    try {
      const receipt = await api(
        '/api/phone-home/run',
        {
          taskId: task.id,
          revision: task.revision,
          homeRevision: context.homeRevision,
          expires: task.expires,
          requestId: uuid(),
        },
        { 'X-Localserve-Home-Token': task.token },
      );
      if (modal === context) {
        context.receipt = receipt;
        $('#task-status').textContent = 'Task ' + receipt.status + '.';
      }
    } catch (error) {
      if (modal === context)
        $('#task-status').textContent = error.message + ' Check Task history before starting again.';
    } finally {
      busy = false;
    }
  }
  async function refresh() {
    if (reading || document.hidden) return;
    reading = true;
    try {
      model = await api('/api/phone-home');
      online = true;
      $('#server-name').textContent = model.name;
      document.title = model.name + ' · Home';
      render();
      for (const key of cardReadings.keys())
        if (!model.cards?.some((card) => cardKey(card) === key)) cardReadings.delete(key);
      if (modal?.kind === 'card' && !model.cards?.some((card) => cardKey(card) === modal.key)) {
        closeSheet();
        message('This Card is no longer available.');
      }
      await refreshCards();
      const context = modal;
      if (context?.kind === 'remote' && !busy) {
        if (!model.remotes.some((page) => remoteKey(page) === remoteKey(context.page))) {
          closeSheet();
          message('This remote is no longer published.');
        } else {
          try {
            const data = await api(endpoint(context.page));
            if (modal === context) {
              if (context.revision && data.page.revision !== context.revision) {
                closeSheet();
                message('Remote changed. Open it again.');
              } else {
                remote = data;
                if (pendingRemoteReceipt()) {
                  const run = data.runs.find((run) => run.id === remoteReceipt.id);
                  if (run && !['queued', 'running'].includes(run.status) && !data.busy) remoteReceipt = null;
                }
                hydrateRemote();
              }
            }
          } catch {
            if (remote) remote.available = false;
            hydrateRemote();
          }
        }
      } else if (context?.receipt) {
        try {
          const result = await api('/api/phone-home/receipts/' + context.receipt.requestId, null, {
            'X-Localserve-Home-Token': context.receipt.token,
          });
          if (modal === context) {
            $('#task-status').textContent = 'Task ' + result.status + '.';
            if (!['running', 'accepted'].includes(result.status)) context.receipt = null;
          }
        } catch {
          if (modal === context) {
            $('#task-status').textContent = 'Receipt unavailable. Check Task history.';
            context.receipt = null;
          }
        }
      }
    } catch {
      online = false;
      status();
      hydrateRemote();
      paintCards();
      if (!model)
        content.innerHTML =
          '<div class="page-title"><h1>Home</h1></div><p class="empty">Server unavailable. Check your Wi-Fi and server address.</p><button class="secondary" data-action="retry">Try again</button>';
    } finally {
      reading = false;
      clearTimeout(receiptTimer);
      if (pendingRemoteReceipt() && !busy && online && !document.hidden)
        receiptTimer = setTimeout(refresh, 75);
    }
  }
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.nav) {
      if (sheet.open) return;
      chime();
      view = button.dataset.nav;
      render(true);
      content.focus({ preventScroll: true });
      return;
    }
    if (button.dataset.open) {
      chime();
      const item = all().find((item) => item.key === button.dataset.open);
      if (item?.type === 'remote') void openRemote(item.value);
      else if (item?.type === 'card') openCard(item);
      else if (item?.type === 'task') openTask(item.value);
      return;
    }
    if (button.dataset.move) {
      const index = modal.draft.indexOf(button.dataset.move),
        next = index + Number(button.dataset.direction);
      if (index >= 0 && next >= 0 && next < modal.draft.length) {
        [modal.draft[index], modal.draft[next]] = [modal.draft[next], modal.draft[index]];
        renderFavorites();
      }
      return;
    }
    if (button.dataset.item || button.dataset.toggle) {
      const item = remote?.page.items.find(
        (item) => item.id === (button.dataset.item || button.dataset.toggle),
      );
      if (item)
        void invoke(
          item,
          button.dataset.toggle ? !(item.hasReading ? item.reported : item.input.default) : undefined,
        );
      return;
    }
    const action = button.dataset.action;
    if (action === 'close') closeSheet();
    if (action === 'edit') edit();
    if (action === 'favorites-save') {
      favorites = [...modal.draft];
      storage.set('localserve.home.favorites', favorites);
      closeSheet();
      render(true);
      chime();
    }
    if (action === 'preferences') preferences();
    if (action === 'task-run') void runTask();
    if (action === 'retry') void refresh();
  });
  document.addEventListener('change', (event) => {
    const target = event.target;
    if (target.dataset.favorite) {
      modal.draft = target.checked
        ? [...modal.draft, target.dataset.favorite]
        : modal.draft.filter((id) => id !== target.dataset.favorite);
      renderFavorites();
    }
    if (target.id === 'sounds') {
      sound = target.checked;
      storage.set('localserve.home.sound', sound);
      chime();
    }
    if (target.id === 'light-target') {
      modal.target = target.value;
      renderLight();
      hydrateRemote();
    }
    if (target.dataset.input) {
      const item = remote?.page.items.find((item) => item.id === target.dataset.input);
      if (!item) return;
      const value = item.kind === 'range' ? Number(target.value) : item.input.enum[Number(target.value)];
      if (target.value !== '') void invoke(item, value);
    }
  });
  function start() {
    clearInterval(timer);
    void refresh();
    timer = setInterval(refresh, 2500);
  }
  content.addEventListener('scroll', scheduleCards, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInterval(timer);
      clearTimeout(receiptTimer);
      clearTimeout(cardTimer);
      paintCards();
      void audio?.suspend();
    } else start();
  });
  window.addEventListener('pagehide', () => {
    clearInterval(timer);
    clearTimeout(receiptTimer);
    clearTimeout(cardTimer);
    void audio?.suspend();
  });
  window.addEventListener('pageshow', start);
  start();
})();
