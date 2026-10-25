/** Shared read-only card renderer. It has no administrator globals, API calls,
 * storage writes, action controls, or evaluated template expressions.
 */
const CardRenderer = (() => {
  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  function glyph(name) {
    return /^[a-z][a-z0-9-]*$/.test(name || '')
      ? `<i class="material-symbol ms-${name}" aria-hidden="true"></i>` : '';
  }

  function timestamp(value, options, timeOnly = false) {
    try {
      return new Intl.DateTimeFormat(options.locale, {
        timeZone: options.timeZone, ...(timeOnly ? {} : { dateStyle: 'medium' }), timeStyle: 'short',
        hourCycle: options.timeFormat === '12' ? 'h12' : 'h23',
      }).format(new Date(value));
    } catch { return 'Unavailable'; }
  }

  function relative(value, now) {
    const seconds = Math.max(0, Math.floor((now - value) / 1000));
    if (seconds < 1) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  function minutesUntil(value, now, locale) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
      .format(Math.max(0, Math.ceil((value - now) / 60000)))} min`;
  }

  function updateCountdowns(root, now, locale) {
    if (!Number.isFinite(now)) return;
    // Update text only: gallery/modal focus and scroll remain intact, and a
    // ticking display never changes saved data or collection fingerprints.
    for (const element of root.querySelectorAll('[data-countdown-at]')) {
      const at = Number(element.dataset.countdownAt);
      if (!Number.isFinite(at)) continue;
      const next = minutesUntil(at, now, locale);
      if (element.textContent !== next) element.textContent = next;
    }
    for (const frame of root.querySelectorAll('iframe[data-ready-card]')) {
      try {
        if (JSON.parse(frame.dataset.readyCard).connected && frame.contentDocument) updateCountdowns(frame.contentDocument, now, locale);
      } catch { /* Unloaded frames receive the next server-clock tick. */ }
    }
  }

  function formatValue(field, datum, options) {
    if (datum.type === 'log') {
      const entries = Array.isArray(datum.value) ? datum.value.slice(0, 5) : [];
      return entries.length ? `<ul class="display-card-log">${entries.map(entry => `<li><span>${escape(entry.message)}</span><time>${escape(timestamp(entry.at, options))}</time></li>`).join('')}</ul>` : '<span class="display-card-empty">No log entries</span>';
    }
    let value = datum.value;
    if (datum.type === 'timestamp' && field.format === 'minutes-until') {
      return `<span data-countdown-at="${escape(value)}">${escape(minutesUntil(value, options.now ?? Date.now(), options.locale))}</span>`;
    }
    if (datum.type === 'string' && field.format === 'link') {
      // Links are an explicit display format, not arbitrary HTML or an action.
      // Parse and allow only web URLs without credentials; escaping alone would
      // not prevent executable protocols such as javascript: in an href.
      try {
        const url = new URL(value);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid link');
        return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${escape(value)}</a>`;
      } catch { return '<span class="display-card-empty">Unavailable link</span>'; }
    }
    if (datum.type === 'timestamp') {
      value = field.format === 'relative' ? relative(value, options.now ?? Date.now())
        : timestamp(value, options, field.format === 'time');
    } else if (datum.type === 'number' && field.format === 'duration') {
      value = duration(value);
    } else if (datum.type === 'number' && field.format !== 'text') {
      const decimals = field.format === 'number'
        ? Math.max(0, Math.min(4, Math.trunc(Number(field.decimals) || 0)))
        : Math.min(4, String(value).split('.')[1]?.length || 0);
      value = new Intl.NumberFormat(options.locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
    } else if (datum.type === 'boolean') {
      value = field.format === 'text' ? String(value) : value ? 'Yes' : 'No';
    }
    return `${escape(value)}${field.unit ? ` <span class="display-card-unit">${escape(field.unit)}</span>` : ''}`;
  }

  function duration(value) {
    if (!Number.isFinite(value) || value < 0) return 'No data';
    const seconds=Math.floor(value), minutes=Math.floor(seconds/60), hours=Math.floor(minutes/60);
    return hours ? `${hours}:${String(minutes%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`
      : `${minutes}:${String(seconds%60).padStart(2,'0')}`;
  }

  function renderTable(field, datum, source, listOptions, options) {
    if (!source || source.type !== 'table') return '<div class="display-card-empty">Unavailable List source</div>';
    if (!datum?.available) return '<div class="display-card-empty">No data</div>';
    const selected = listOptions.columns.map(id => source.columns.find(column => column.id === id)).filter(Boolean);
    // Declaration-owned trailing columns also apply to saved selections,
    // without rewriting templates or adding unselected columns to public data.
    const columns = [...selected.filter(column => column.position !== 'last'),
      ...source.columns.filter(column => column.position === 'last' && selected.some(item => item.id === column.id))];
    const rows = datum.value.slice(0, listOptions.rows);
    if (!columns.length) return '<div class="display-card-empty">No columns selected.</div>';
    // Mixed tables let the browser measure actual timestamp text at the chosen
    // font/locale. Text columns receive the rest without a reserved date share.
    const fitDates = columns.some(column => column.type === 'timestamp')
      && columns.some(column => column.type !== 'timestamp');
    // Native table semantics remain intact at narrow widths. Cell clipping is
    // independent of the card body's Clip option, which controls vertical space.
    return `<table class="display-card-table${fitDates ? ' display-card-table-fit-dates' : ''}${listOptions.noWrap ? ' display-card-table-nowrap' : ''}" style="--list-font-size:${listOptions.fontSize}px" aria-label="${escape(field.label)}"><thead><tr>${columns.map(column => `<th scope="col"${column.type === 'timestamp' ? ' class="display-card-date-cell"' : ''}>${escape(column.label)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr>${columns.map(column => {
      const value = row[column.id];
      return `<td${column.type === 'timestamp' ? ' class="display-card-date-cell"' : ''}><div class="display-card-cell">${value === null || value === undefined ? '<span class="display-card-empty">No data</span>' : formatValue({ format: column.format || 'auto', unit: '' }, { type: column.type, value }, options)}</div></td>`;
    }).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}" class="display-card-empty">No items</td></tr>`}</tbody></table>`;
  }

  function render(card, data = {}, catalog = [], options = {}) {
    if (card.layout === 'readymade') return renderReadyMade(card, data, options);
    const layout = ['list', 'grid', 'highlight', 'table', 'webpage'].includes(card.layout) ? card.layout : 'list';
    const iconName = card.icon === 'inherit' ? data.icon : card.icon;
    const status = options.connected === false ? 'Disconnected' : data.status || 'Unavailable';
    const fields = (card.fields || []).filter(field => field.enabled);
    const safeCreditUrl = input => {
      try {
        const url = new URL(input);
        return url.protocol === 'https:' && !url.username && !url.password;
      } catch { return false; }
    };
    const credit = safeCreditUrl(data.attribution?.url) && safeCreditUrl(data.attribution?.licenseUrl) ? data.attribution : null;
    // Credit is declaration-owned public metadata. Hiding a Card's ordinary
    // footer moves provider attribution into its content instead of removing it.
    const attribution = credit ? `<span class="display-card-attribution"><a href="${escape(credit.url)}" target="_blank" rel="noopener noreferrer">${escape(credit.label)}</a> · <a href="${escape(credit.licenseUrl)}" target="_blank" rel="noopener noreferrer">${escape(credit.licenseLabel)}</a>${credit.notice ? ` · ${escape(credit.notice)}` : ''}</span>` : '';
    // The host owns both dimensions. Template size is only a designer preview
    // preference and must never cap a Vista's assigned space.
    // Isolate Card typography from the administrator's inherited CSS variable.
    const fontScale = Math.max(80, Math.min(130, options.fontScale || 100));
    return `<article class="display-card display-card-${layout}${card.crop === true ? ' display-card-crop' : ''}" style="--font-scale:${fontScale / 100}" aria-label="${escape(card.name || 'Card preview')}">
      ${card.showHeader === false ? '' : `<header class="display-card-heading"><div>${iconName === 'none' ? '' : glyph(iconName)}<h3>${escape(card.name || 'Card')}</h3></div><span class="display-card-status">${escape(status)}</span></header>`}
      <div class="display-card-fields" role="region" aria-label="Card information"${card.crop === true ? '' : ' tabindex="0"'}>${fields.length ? fields.map(field => {
        const source = catalog.find(source => source.id === field.binding);
        const datum = data.values?.[field.binding];
        const iconName = field.icon === 'auto' ? source?.icon : field.icon;
        const available = source && datum?.available;
        const missing = source ? 'No data' : 'Unavailable field';
        if (layout === 'webpage') {
          const input = available && source?.type === 'webpage' ? datum.value : null;
          let url;
          try {
            url = new URL(input?.url);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) url = null;
          } catch { url = null; }
          if (!url) return '<div class="display-card-empty">Webpage unavailable</div>';
          // An opaque sandbox origin isolates even a redirect back to Sormus.
          // Downloaded HTML is never placed in srcdoc or interpreted by our DOM.
          return `<iframe class="display-card-webpage-frame" title="${escape(field.label)}" src="${escape(url.href)}" data-webpage-key="${escape(JSON.stringify([url.href, input.revision, card.crop === true]))}" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer" loading="lazy" scrolling="${card.crop === true ? 'no' : 'auto'}" tabindex="${card.crop === true ? '-1' : '0'}"${card.crop === true ? ' inert' : ''}></iframe>`;
        }
        if (source?.type === 'table' || layout === 'table') {
          const settings = card.listOptions || { rows: 10, fontSize: 14, noWrap: false, columns: source?.columns.map(column => column.id) || [] };
          return renderTable(field, datum, source, settings, options);
        }
        return `<section class="display-card-field ${datum?.type === 'log' ? 'display-card-field-log' : ''}"><div class="display-card-label">${iconName === 'none' ? '' : glyph(iconName)}<span>${escape(field.label)}</span></div><div class="display-card-value ${datum?.type === 'string' ? 'display-card-value-text' : ''} ${available ? '' : 'display-card-empty'}">${available ? formatValue(field, datum, options) : missing}</div></section>`;
      }).join('') : `<div class="display-card-empty">${card.fields?.length ? 'No enabled fields.' : 'Add information to this card.'}</div>`}${card.showFooter === false ? attribution : ''}</div>
      ${card.showFooter === false ? '' : `<footer class="display-card-source">${glyph(data.icon)}${escape(data.pluginName || '')}${attribution}</footer>`}
    </article>`;
  }

  function mount(host, markup) {
    if (markup.includes('data-ready-card')) {
      const next = document.createElement('template'); next.innerHTML = markup;
      const previous = host.querySelector('.display-card-ready-frame'), desired = next.content.querySelector('.display-card-ready-frame');
      if (previous && desired && previous.getAttribute('src') === desired.getAttribute('src')) {
        // The package document remains connected: polls and Location edits
        // hydrate text/variant attributes without restarting CSS animations.
        previous.dataset.readyCard = desired.dataset.readyCard;
        previous.title = desired.title;
        host.firstElementChild.setAttribute('aria-label', next.content.firstElementChild.getAttribute('aria-label'));
        hydrateReadyMade(previous); return;
      }
      host.replaceChildren(next.content); return;
    }
    if (!host.firstElementChild?.classList.contains('display-card-webpage') || !markup.includes('display-card-webpage-frame')) {
      host.innerHTML = markup;
      return;
    }
    const next = document.createElement('template');
    next.innerHTML = markup;
    const previous = host.firstElementChild;
    const desired = next.content.firstElementChild;
    if (previous?.classList.contains('display-card-webpage') && desired?.classList.contains('display-card-webpage')) {
      const oldFrame = previous.querySelector('iframe');
      const newFrame = desired.querySelector('iframe');
      if (oldFrame && newFrame) {
        // Keep the connected browsing context through ordinary data/status polls.
        // Moving an iframe between parents would reload it even with the same URL.
        previous.className = desired.className;
        previous.setAttribute('aria-label', desired.getAttribute('aria-label'));
        const body = previous.querySelector('.display-card-fields');
        const desiredBody = desired.querySelector('.display-card-fields');
        for (const name of ['class', 'role', 'aria-label', 'tabindex']) {
          if (desiredBody.hasAttribute(name)) body.setAttribute(name, desiredBody.getAttribute(name));
          else body.removeAttribute(name);
        }
        oldFrame.title = newFrame.title;
        oldFrame.tabIndex = newFrame.tabIndex;
        oldFrame.inert = newFrame.inert;
        oldFrame.setAttribute('scrolling', newFrame.getAttribute('scrolling'));
        if (oldFrame.dataset.webpageKey !== newFrame.dataset.webpageKey) {
          oldFrame.dataset.webpageKey = newFrame.dataset.webpageKey;
          oldFrame.src = newFrame.getAttribute('src');
        }
        previous.querySelector('header')?.remove();
        previous.querySelector('footer')?.remove();
        const header = desired.querySelector('header');
        const footer = desired.querySelector('footer');
        if (header) previous.prepend(header);
        if (footer) previous.append(footer);
        return;
      }
    }
    host.replaceChildren(next.content);
  }

  function renderReadyMade(card, data, options) {
    const metadata = data.readyMade;
    let selection = metadata;
    if (metadata?.templates) {
      const template = metadata.templates.find(template => template.id === card.templateId), source = metadata.sources.find(source => source.id === card.sourceId);
      selection = template && source ? { template, source, bindings: Object.fromEntries(template.slots.map(slot => [slot.id, source.bindings[slot.field]])) } : null;
    }
    const template = selection?.template;
    if (!template || !/^\/plugin-card-assets\/[a-z0-9-]+\/[a-z0-9-]+\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.html$/.test(template.url)) return `<article class="display-card" aria-label="${escape(card.name)}"><div class="display-card-empty">Ready-made design or data source unavailable</div></article>`;
    const slots = Object.fromEntries(template.slots.map(slot => {
      let datum = data.values?.[selection.bindings[slot.id]];
      if (slot.percentOf) {
        // Use the two reported public readings, never a guessed capacity.
        const total = data.values?.[selection.bindings[slot.percentOf]];
        const known = datum?.available && total?.available && Number.isFinite(datum.value)
          && datum.value >= 0 && Number.isFinite(total.value) && total.value > 0;
        const percent = known ? datum.value / total.value * 100 : null;
        datum = { available: known && Number.isFinite(percent), value: percent };
      }
      const available = selection.source.enabled && datum?.available;
      if (slot.type === 'table') {
        const columns = slot.columns;
        const rows = available && Array.isArray(datum.value) ? datum.value.slice(0, slot.rows).map(row => Object.fromEntries(columns.map(column => {
          const raw = row[column.id], known = raw !== null && raw !== undefined;
          const value = !known ? 'No data' : column.type === 'timestamp'
            ? column.format === 'minutes-until' ? minutesUntil(raw, options.now ?? Date.now(), options.locale) : timestamp(raw, options, column.format === 'time')
            : column.type === 'number' ? column.format === 'duration' ? duration(raw) : new Intl.NumberFormat(options.locale, { maximumFractionDigits: 1 }).format(raw)
            : column.type === 'boolean' ? raw ? 'Yes' : 'No' : String(raw);
          return [column.id, { value, available: known, ...(known && column.format === 'minutes-until' ? { deadline: raw } : {}) }];
        }))) : [];
        return [slot.id, { rows, columns, available: Boolean(available) }];
      }
      let value = 'No data';
      if (available) {
        value = slot.type === 'timestamp' ? slot.format === 'minutes-until'
          ? minutesUntil(datum.value, options.now ?? Date.now(), options.locale)
          : timestamp(datum.value, options, slot.format === 'time')
          : slot.format === 'number' ? new Intl.NumberFormat(options.locale,
            { maximumFractionDigits: slot.decimals, useGrouping: slot.grouping !== false }).format(datum.value)
          : slot.type === 'boolean' ? datum.value ? 'Yes' : 'No' : String(datum.value);
      }
      return [slot.id, { value, raw: available ? datum.value : null, available: Boolean(available),
        ...(available && slot.format === 'minutes-until' ? { deadline: datum.value } : {}) }];
    }));
    const variant = template.variant;
    const variantValue = variant ? Object.entries(variant.choices).find(([, values]) => values.includes(String(slots[variant.slot]?.raw)))?.[0] || variant.fallback : 'default';
    const payload = { slots, variant: variantValue, name: selection.source.name, status: options.connected === false ? 'Disconnected · retained reading' : !selection.source.enabled ? 'Data source disabled' : data.status || 'Unavailable',
      connected: options.connected !== false, theme: options.theme || 'dark', fontScale: options.fontScale || 100,
      previewUrl: template.previewUrl, previewActive: options.connected !== false && selection.source.enabled && data.status === 'Ready' };
    return `<article class="display-card display-card-readymade" aria-label="${escape(card.name)}"><div class="display-card-fields" role="region" aria-label="Card information"><iframe class="display-card-ready-frame" title="${escape(card.name)}" src="${escape(template.url)}" sandbox="allow-same-origin" referrerpolicy="no-referrer" data-ready-card="${escape(JSON.stringify(payload))}"></iframe></div></article>`;
  }

  function hydrateReadyMade(frame) {
    try {
      const payload = JSON.parse(frame.dataset.readyCard), document = frame.contentDocument;
      // The child has no scripts or administrator data. Only declaration-owned
      // text slots and bounded scene tokens are filled; provider HTML stays text.
      if (!document?.querySelector('[data-ready-made]')) return;
      globalThis.LocalserveCardPreview?.attach(frame, payload.previewUrl, payload.previewActive, payload.status);
      const root = document.documentElement;
      root.dataset.variant = payload.variant;
      root.dataset.theme = payload.theme;
      root.dataset.connected = String(payload.connected);
      root.style.setProperty('--font-scale', Math.max(.8, Math.min(1.3, payload.fontScale / 100)));
      for (const element of document.querySelectorAll('[data-card-text]')) {
        const id = element.dataset.cardText;
        // Source-owned reception labels never hide a disabled/disconnected host.
        const text = id === 'source-name' ? payload.name : id === 'source-status' || element.hasAttribute('data-card-source-state') && payload.status !== 'Ready'
          ? payload.status : payload.slots[id]?.value || 'No data';
        if (element.textContent !== text) element.textContent = text;
        element.dataset.available = String(payload.slots[id]?.available ?? true);
        if (Number.isFinite(payload.slots[id]?.deadline)) element.dataset.countdownAt = String(payload.slots[id].deadline);
        else delete element.dataset.countdownAt;
      }
      for (const element of document.querySelectorAll('[data-card-color]')) {
        const value = payload.slots[element.dataset.cardColor]?.value;
        const valid = /^#[0-9a-f]{6}$/i.test(value || '');
        element.hidden = !valid;
        element.style.backgroundColor = valid ? value : '';
      }
      for (const element of document.querySelectorAll('[data-card-cell]')) {
        const [slot, row, column] = element.dataset.cardCell.split(':');
        hydrateCell(element, payload.slots[slot]?.rows?.[Number(row)]?.[column]);
      }
      for (const element of document.querySelectorAll('[data-card-meter]')) {
        const slot = payload.slots[element.dataset.cardMeter];
        const known = slot?.available && typeof slot.raw === 'number' && Number.isFinite(slot.raw);
        const label = element.dataset.meterLabel || element.getAttribute?.('aria-label') || 'Reading';
        element.dataset.meterLabel = label;
        element.dataset.available = String(Boolean(known));
        if (element.dataset.meterMode === 'value') {
          // Counts, temperatures and elapsed times are circular values, not
          // percentages. Their accent ring carries no implied 0–100 scale.
          element.style.setProperty('--reading-percent', known ? 100 : 0);
          element.setAttribute('role', 'img');
          element.setAttribute('aria-label', known ? `${label}: ${slot.value}${element.dataset.meterUnit || ''}` : `${label}: No data`);
          element.removeAttribute('aria-valuenow');
          element.removeAttribute('aria-valuetext');
          continue;
        }
        element.style.setProperty('--reading-percent', known ? Math.max(0, Math.min(100, slot.raw)) : 0);
        // An unknown gauge must not announce the ARIA meter's default zero.
        // Preserve the numeric reading as text while bounding its visual ring.
        element.setAttribute('role', known ? 'meter' : 'img');
        element.setAttribute('aria-label', known ? label : `${label}: No data`);
        if (known) {
          element.setAttribute('aria-valuenow', String(Math.max(0, Math.min(100, slot.raw))));
          element.setAttribute('aria-valuetext', String(slot.raw));
        } else {
          element.removeAttribute('aria-valuenow');
          element.removeAttribute('aria-valuetext');
        }
      }
      for (const element of document.querySelectorAll('[data-card-flash]')) {
        const slot = payload.slots[element.dataset.cardFlash];
        // Flash only a changed, known reading after the first hydration. Polls,
        // reconnects and missing values do not manufacture a new occurrence.
        if (slot?.available) {
          const reading = JSON.stringify(slot.raw);
          if (element.dataset.lastReading !== undefined && element.dataset.lastReading !== reading && payload.connected) element.dataset.flash = element.dataset.flash === 'a' ? 'b' : 'a';
          element.dataset.lastReading = reading;
        }
      }
      for (const table of document.querySelectorAll('[data-card-table]')) hydrateReadyTable(document, table, payload.slots[table.dataset.cardTable]);
    } catch { /* A missing/unloaded installed asset keeps its explicit empty state. */ }
  }

  function hydrateCell(element, cell) {
    const value = cell?.value || 'No data';
    if (element.textContent !== value) element.textContent = value;
    element.dataset.available = String(Boolean(cell?.available));
    if (Number.isFinite(cell?.deadline)) element.dataset.countdownAt = String(cell.deadline);
    else delete element.dataset.countdownAt;
  }

  function hydrateReadyTable(document, table, slot) {
    // Only native nodes and text are created. Package-owned selectors determine
    // placement; provider strings cannot become markup, URLs or CSS selectors.
    const signature = JSON.stringify(slot);
    if (table.dataset.reading === signature) return;
    table.dataset.reading = signature;
    const head = document.createElement('thead'), heading = document.createElement('tr');
    for (const column of slot?.columns || []) {
      const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = column.label; heading.append(cell);
    }
    head.append(heading);
    const body = document.createElement('tbody');
    for (const row of slot?.rows || []) {
      const line = document.createElement('tr');
      for (const column of slot.columns) {
        const cell = document.createElement('td'); hydrateCell(cell, row[column.id]); line.append(cell);
      }
      body.append(line);
    }
    if (!body.children.length) {
      const line = document.createElement('tr'), cell = document.createElement('td');
      cell.colSpan = slot?.columns?.length || 1; cell.textContent = slot?.available ? 'No items' : 'No data'; line.append(cell); body.append(line);
    }
    table.replaceChildren(head, body);
  }
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('load', event => {
    if (event.target?.matches?.('iframe[data-ready-card]')) hydrateReadyMade(event.target);
  }, true);

  return { render, mount, updateCountdowns, hydrateReadyMade };
})();
