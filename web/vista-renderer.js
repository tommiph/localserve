/** Shared Vista compositor. Both administrator preview and viewer use this
 * controller; it never executes plugin actions or reads administrator state.
 */
const VistaRenderer = (() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const key = reference => `${reference.pluginId}/${reference.cardId}`;

  function resolveTransition(style, previous, random = Math.random) {
    if (style !== 'random') return style;
    // Choose only on an actual card switch, not each poll. Avoid an immediate
    // repeat within this collection; None is never a random animation choice.
    const choices = ['fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'zoom', 'flip'].filter(choice => choice !== previous);
    return choices[Math.floor(random() * choices.length)];
  }

  // Timing is kept independently of DOM refreshes and server polling. A new
  // layout resets it; ordinary data refreshes retain the selected card/deadline.
  function choose(node, entries, previous, now, paused = false) {
    const available = node.cards.map(reference => entries.get(key(reference))).filter(entry => entry?.card);
    const fingerprints = Object.fromEntries(available.map(entry => {
      const values = Object.fromEntries(entry.card.fields.filter(field => field.enabled).map(field => {
        const datum = entry.data.values?.[field.binding];
        if (datum?.type !== 'table' || !datum.available) return [field.binding, datum];
        // Admin previews receive the full catalog, while public responses are
        // already trimmed. Both must ignore updates to hidden table cells/rows.
        let list = entry.card.layout === 'table' ? entry.card.listOptions : null;
        if (entry.card.layout === 'readymade') {
          const metadata = entry.data.readyMade;
          const template = metadata?.template || metadata?.templates?.find(template => template.id === entry.card.templateId);
          const slot = template?.slots.find(slot => slot.id === field.id && slot.type === 'table');
          if (slot) list = { rows: slot.rows, columns: slot.columns.map(column => column.id) };
        }
        if (!list) return [field.binding, datum];
        return [field.binding, { ...datum, value: datum.value.slice(0, list.rows).map(row =>
          Object.fromEntries(list.columns.map(column => [column, row[column] ?? null]))) }];
      }));
      const readyMade = entry.card.layout === 'readymade' ? entry.data.readyMade : null;
      const source = readyMade?.source || readyMade?.sources?.find(source => source.id === entry.card.sourceId);
      // A ready-made heading uses its chosen source name. Renaming another
      // Location must not rotate a collection showing this card.
      return [key(entry), JSON.stringify([entry.data.status, entry.data.pluginName, entry.data.icon, values, source?.name])];
    }));
    let selected = available.find(entry => key(entry) === previous?.selected) || available[0];
    let changed = false;
    if (!paused && selected && previous && node.type === 'collection') {
      if (['update', 'both'].includes(node.rotation)) {
        // First snapshot seeds fingerprints without producing an update. If
        // several members change in one poll, the last changed member wins.
        const updated = available.filter(entry => previous.fingerprints[key(entry)] !== undefined && previous.fingerprints[key(entry)] !== fingerprints[key(entry)]);
        if (updated.length) { selected = updated.at(-1); changed = true; }
      }
      if (!changed && ['interval', 'both'].includes(node.rotation) && now >= previous.nextAt && available.length > 1) {
        selected = available[(available.indexOf(selected) + 1) % available.length];
        changed = true;
      }
    }
    return { selected: selected ? key(selected) : null, fingerprints,
      nextAt: !previous || changed || previous.selected !== (selected ? key(selected) : null) ? now + (node.intervalSeconds || 10) * 1000 : previous.nextAt };
  }

  function create(host) {
    let clockReference = null;
    function displayNow() {
      return clockReference ? clockReference.at
        + (clockReference.connected ? performance.now() - clockReference.receivedAt : 0) : Date.now();
    }
    let layoutSignature = '', slots = new Map(), payload, stopped = false, rotationPaused = false;
    const selections = new Map();

    function build(node, gap) {
      const element = document.createElement('div');
      element.className = ['row', 'column'].includes(node.type) ? `vista-container vista-${node.type}` : 'vista-slot';
      element.dataset.nodeId = node.id;
      if (['row', 'column'].includes(node.type)) {
        const children = node.children.filter(child => child.enabled);
        const axis = node.type === 'row' ? 'gridTemplateColumns' : 'gridTemplateRows';
        element.style[axis] = children.map(child => child[node.type === 'row' ? 'width' : 'height'] === 'auto' ? 'auto' : child[node.type === 'row' ? 'width' : 'height']).join(' ') || '1fr';
        // Cross-axis sizes remain independent: a row's child can have its own
        // height; a column's child can have its own width. fr fills that axis.
        element.style.gap = `${gap}px`;
        children.forEach(child => {
          const childElement = build(child, gap);
          const crossAxis = node.type === 'row' ? 'height' : 'width';
          if (!child[crossAxis].endsWith('fr') && child[crossAxis] !== 'auto') childElement.style[crossAxis] = child[crossAxis];
          element.append(childElement);
        });
        if (!children.length) element.innerHTML = '<div class="vista-empty">No items</div>';
      } else slots.set(node.id, { element, node, markup: '', selected: null });
      return element;
    }

    function display(slot, entry, options, selected) {
      const markup = entry?.card ? CardRenderer.render(entry.card, entry.data, entry.catalog, options)
        : `<div class="vista-empty">${escape(slot.node.cards.length ? 'No enabled cards available' : 'Choose a card')}</div>`;
      if (slot.markup === markup) return;
      const previous = slot.element.firstElementChild;
      const scroll = previous?.querySelector('.display-card-fields');
      const scrollTop = scroll?.scrollTop || 0, scrollLeft = scroll?.scrollLeft || 0;
      const focused = scroll && document.activeElement === scroll;
      const switched = slot.selected && selected && slot.selected !== selected;
      CardRenderer.mount(slot.element, markup);
      const current = slot.element.firstElementChild;
      if (!switched) {
        const nextScroll = current?.querySelector('.display-card-fields');
        if (nextScroll) { nextScroll.scrollTop = scrollTop; nextScroll.scrollLeft = scrollLeft; if (focused) nextScroll.focus({ preventScroll: true }); }
      }
      if (switched && slot.node.animation !== 'none' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const animation = resolveTransition(slot.node.animation, slot.lastAnimation);
        slot.lastAnimation = animation;
        const transform = { 'slide-left': 'translateX(100%)', 'slide-right': 'translateX(-100%)', 'slide-up': 'translateY(100%)', 'slide-down': 'translateY(-100%)', zoom: 'scale(.85)', flip: 'perspective(800px) rotateY(90deg)' }[animation];
        current.animate([{ opacity: 0, transform: transform || 'none' }, { opacity: 1, transform: 'none' }], { duration: slot.node.durationMs, easing: 'ease-out' });
      }
      slot.markup = markup; slot.selected = selected;
    }

    function tick() {
      if (!payload || stopped) return;
      const entries = new Map(payload.cards.map(entry => [key(entry), entry]));
      for (const [id, slot] of slots) {
        const choice = choose(slot.node, entries, selections.get(id), performance.now(),rotationPaused);
        selections.set(id, choice);
        display(slot, entries.get(choice.selected), { ...payload.options, now: displayNow() }, choice.selected);
      }
    }

    function update(next) {
      // The server's epoch anchors a monotonic client clock between polls.
      // Countdown formatting is separate from bound-data rotation fingerprints.
      // A failed poll freezes the clock rather than continuing a stale countdown.
      if (next.options.connected !== false && Number.isFinite(next.options.now)) {
        clockReference = { at: next.options.now, receivedAt: performance.now(), connected: true };
      } else if (next.options.connected === false && clockReference?.connected) {
        clockReference = { at: displayNow(), receivedAt: performance.now(), connected: false };
      }
      payload = next;
      // Empty slots and ordinary Cards in an administrator preview must use
      // the same typography as the end-user Vista, not the surrounding editor.
      host.style.setProperty('--font-scale', Math.max(80, Math.min(130, next.options.fontScale || 100)) / 100);
      const signature = JSON.stringify([next.vista.id, next.vista.layout, next.vista.gap, next.vista.padding]);
      if (signature !== layoutSignature) {
        slots = new Map(); selections.clear();
        host.style.padding = `${next.vista.padding}px`;
        host.replaceChildren(next.vista.layout.enabled ? build(next.vista.layout, next.vista.gap) : Object.assign(document.createElement('div'), { className: 'vista-empty', textContent: 'Layout disabled' }));
        layoutSignature = signature;
      }
      tick();
    }
    function step(direction) {
      if (stopped || !payload || payload.options.connected === false || ![-1, 1].includes(direction)) return false;
      const entries = new Map(payload.cards.map(entry => [key(entry), entry]));
      let changed = false;
      for (const [id, slot] of slots) {
        if (slot.node.type !== 'collection' || slot.node.enabled === false) continue;
        const available = slot.node.cards.map(reference => entries.get(key(reference))).filter(entry => entry?.card);
        if (available.length < 2) continue;
        const choice = choose(slot.node, entries, selections.get(id), performance.now(),true);
        const index = Math.max(0, available.findIndex(entry => key(entry) === slot.selected));
        choice.selected = key(available[(index + direction + available.length) % available.length]);
        choice.nextAt = performance.now() + (slot.node.intervalSeconds || 10) * 1000;
        selections.set(id, choice);
        display(slot, entries.get(choice.selected), {...payload.options, now:displayNow()}, choice.selected);
        changed = true;
      }
      return changed;
    }
    const timer = setInterval(tick, 250);
    function pause(value) {
      rotationPaused = value === true;
      if (!rotationPaused) for (const [id, choice] of selections) choice.nextAt = performance.now() + (slots.get(id)?.node.intervalSeconds || 10) * 1000;
      return rotationPaused;
    }
    return { update, step, pause, destroy() { stopped = true; clearInterval(timer); slots.clear(); selections.clear(); } };
  }
  return { create, choose, resolveTransition };
})();
