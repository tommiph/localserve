/* Read-only Vista viewer for older Samsung TV web engines. It uses the same
 * public projection as the regular viewer, but only ES5, XHR and Flexbox. */
(function () {
  'use strict';

  var host = document.getElementById('vista-display');
  var status = document.getElementById('vista-status');
  var followsDisplay = location.pathname === '/display';
  var segments = location.pathname.split('/');
  var slug = segments[segments.length - 1];
  var payload = null;
  var selections = {};
  var layoutSignature = '';
  var views = {};
  var clockReceivedAt = 0;
  var busy = false;
  var connected = false;
  var api = followsDisplay ? '/api/display' : '/api/vistas/' + encodeURIComponent(slug);
  document.body.className += ' legacy-vista';

  function vistaFontFactor() {
    return Math.max(80, Math.min(130, Number(payload && payload.options.fontScale) || 100)) / 100;
  }

  function scaleFontRules(rules, factor) {
    for (var i = 0; rules && i < rules.length; i += 1) {
      var rule = rules[i];
      if (rule.style && /^\d+(?:\.\d+)?px$/.test(rule.style.fontSize)) {
        // Cache the package's original size: polling must never compound scale.
        // Only font-size changes; fixed layout, artwork and physical sizes stay.
        if (rule._localserveFontPixels === undefined) rule._localserveFontPixels = parseFloat(rule.style.fontSize);
        rule.style.fontSize = rule._localserveFontPixels * factor + 'px';
      }
      if (rule.cssRules) scaleFontRules(rule.cssRules, factor);
    }
  }

  function applyVistaFontSize(doc) {
    // Old TVs have no CSS variables. Modify only these package-owned, same-origin
    // stylesheets; never traverse a Webpage Card's provider browsing context.
    for (var i = 0; doc.styleSheets && i < doc.styleSheets.length; i += 1) {
      try { scaleFontRules(doc.styleSheets[i].cssRules, vistaFontFactor()); }
      catch (error) { /* A stylesheet still loading is retried on the next poll. */ }
    }
  }

  function element(tag, className, value) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function empty(message) {
    clear(host);
    host.style.padding = '0';
    var screen = element('div', 'legacy-empty');
    var masthead = element('div', 'legacy-empty-masthead');
    var logo = element('img', 'legacy-empty-logo');
    logo.src = document.documentElement.getAttribute('data-theme') === 'light'
      ? '../assets/logo.svg' : '../assets/logo-dark.svg';
    logo.alt = '';
    masthead.appendChild(logo);
    masthead.appendChild(element('span', 'legacy-empty-brand', (payload && payload.options && payload.options.name) || 'Localserve'));
    screen.appendChild(masthead);

    var content = element('div', 'legacy-empty-content');
    content.appendChild(element('div', 'legacy-empty-rule'));
    content.appendChild(element('div', 'legacy-empty-eyebrow', 'VISTA'));
    content.appendChild(element('h1', 'legacy-empty-title', payload && payload.vista ? payload.vista.name : 'Display'));
    content.appendChild(element('p', 'legacy-empty-message', message));
    screen.appendChild(content);
    screen.appendChild(element('div', 'legacy-empty-bottom'));
    host.appendChild(screen);
  }

  function findSource(catalog, binding) {
    for (var i = 0; i < catalog.length; i += 1) {
      if (catalog[i].id === binding) return catalog[i];
    }
    return null;
  }

  function formatted(value, type, field) {
    if (value === null || value === undefined) return 'No data';
    if (type === 'boolean') return value ? 'Yes' : 'No';
    if (type === 'number' && field && field.format === 'duration') return readyCell(field,value).value;
    if (type === 'timestamp') {
      var date = new Date(value);
      if (isNaN(date.getTime())) return 'No data';
      if (field && field.format === 'date') return date.toLocaleDateString();
      if (field && field.format === 'time') return date.toLocaleTimeString();
      return date.toLocaleString();
    }
    if (type === 'number' && typeof value === 'number' && isFinite(value)) {
      var digits = field && typeof field.decimals === 'number' ? field.decimals : 0;
      return value.toFixed(Math.max(0, Math.min(4, digits))) + (field && field.unit ? ' ' + field.unit : '');
    }
    return String(value) + (field && field.unit ? ' ' + field.unit : '');
  }

  function tableTime(value) {
    if (value === null || value === undefined) return 'No data';
    var date = new Date(value);
    if (isNaN(date.getTime())) return 'No data';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var hours = date.getHours();
    var suffix = '';
    if (payload && payload.options && payload.options.timeFormat === '12') {
      suffix = hours < 12 ? ' am' : ' pm';
      hours = hours % 12 || 12;
    }
    var minute = date.getMinutes();
    return months[date.getMonth()] + ' ' + date.getDate() + ', ' +
      date.getFullYear() + ', ' + (hours < 10 && !suffix ? '0' : '') + hours + ':' +
      (minute < 10 ? '0' : '') + minute + suffix;
  }

  function clockTime(value) {
    if (value === null || value === undefined) return 'No data';
    var date = new Date(value);
    if (isNaN(date.getTime())) return 'No data';
    var hours = date.getHours();
    var suffix = '';
    if (payload && payload.options && payload.options.timeFormat === '12') {
      suffix = hours < 12 ? ' am' : ' pm';
      hours = hours % 12 || 12;
    }
    var minute = date.getMinutes();
    return (hours < 10 && !suffix ? '0' : '') + hours + ':' +
      (minute < 10 ? '0' : '') + minute + suffix;
  }

  function readyNumber(value, decimals) {
    var number = Number(value);
    if (!isFinite(number)) return 'No data';
    return number.toFixed(Math.max(0, Math.min(4, Number(decimals) || 0)))
      .replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }

  function readyCell(column, raw) {
    if (raw === null || raw === undefined) return { value: 'No data', available: false };
    if (column.type === 'timestamp') {
      if (column.format === 'minutes-until') {
        var now = payload && payload.options && payload.options.now || Date.now();
        return { value: Math.max(0, Math.ceil((raw - now) / 60000)) + ' min',
          available: true, deadline: raw };
      }
      return { value: column.format === 'time' ? clockTime(raw) : tableTime(raw), available: true };
    }
    if (column.type === 'number' && column.format === 'duration') {
      if (!isFinite(raw) || raw < 0) return {value:'No data',available:false};
      var seconds=Math.floor(raw),minutes=Math.floor(seconds/60),hours=Math.floor(minutes/60);
      var pad=function(value){return value<10?'0'+value:String(value);};
      return {value:hours?hours+':'+pad(minutes%60)+':'+pad(seconds%60):minutes+':'+pad(seconds%60),available:true};
    }
    if (column.type === 'number') return { value: readyNumber(raw, 1), available: true };
    if (column.type === 'boolean') return { value: raw ? 'Yes' : 'No', available: true };
    return { value: String(raw), available: true };
  }

  function setReadyCell(node, cell) {
    var value = cell ? cell.value : 'No data';
    if (node.textContent !== value) node.textContent = value;
    var available = String(Boolean(cell && cell.available));
    if (node.getAttribute('data-available') !== available) node.setAttribute('data-available', available);
    if (cell && cell.deadline) node.setAttribute('data-countdown-at', String(cell.deadline));
    else if (node.removeAttribute) node.removeAttribute('data-countdown-at');
  }

  function renderReadyTable(doc, table, slot) {
    var signature = JSON.stringify(slot);
    if (table._legacySignature === signature) return;
    table._legacySignature = signature;
    if (!slot) return;
    var headerSignature = JSON.stringify(slot.columns);
    if (table._legacyHeaderSignature !== headerSignature) {
      clear(table);
      var head = doc.createElement('thead');
      var header = doc.createElement('tr');
      for (var i = 0; i < slot.columns.length; i += 1) {
        var heading = doc.createElement('th');
        heading.textContent = slot.columns[i].label;
        header.appendChild(heading);
      }
      head.appendChild(header);
      table.appendChild(head);
      table.appendChild(doc.createElement('tbody'));
      table._legacyHeaderSignature = headerSignature;
    }
    var body = table.children[1];
    var rowCount = Math.max(1, slot.rows.length);
    while (body.children.length > rowCount) body.removeChild(body.lastChild);
    while (body.children.length < rowCount) body.appendChild(doc.createElement('tr'));
    for (var r = 0; r < slot.rows.length; r += 1) {
      var row = body.children[r];
      while (row.children.length > slot.columns.length) row.removeChild(row.lastChild);
      while (row.children.length < slot.columns.length) row.appendChild(doc.createElement('td'));
      for (var c = 0; c < slot.columns.length; c += 1) {
        setReadyCell(row.children[c], slot.rows[r][slot.columns[c].id]);
      }
    }
    if (!slot.rows.length) {
      var emptyRow = body.children[0];
      while (emptyRow.firstChild) emptyRow.removeChild(emptyRow.firstChild);
      var emptyCell = doc.createElement('td');
      emptyCell.setAttribute('colspan', String(slot.columns.length || 1));
      emptyCell.textContent = slot.available ? 'No items' : 'No data';
      emptyRow.appendChild(emptyCell);
    }
  }

  function renderReadyMeter(doc, node, slot, theme) {
    if (!node.getAttribute('data-meter-label')) node.setAttribute('data-meter-label', node.getAttribute('aria-label') || 'Reading');
    var signature = JSON.stringify([slot && slot.available, slot && slot.raw, theme]);
    if (node._legacyMeterSignature === signature) return;
    node._legacyMeterSignature = signature;
    if (!slot || !slot.available || typeof slot.raw !== 'number' || !isFinite(slot.raw)) {
      if (node._legacyMeterRing) {
        node.removeChild(node._legacyMeterRing);
        node._legacyMeterRing = null;
      }
      node.setAttribute('data-available', 'false');
      node.setAttribute('role', 'img');
      node.removeAttribute('aria-valuenow');
      node.removeAttribute('aria-valuetext');
      node.setAttribute('aria-label', (node.getAttribute('data-meter-label') || node.getAttribute('aria-label') || 'Reading') + ': No data');
      return;
    }
    var valueMode = node.getAttribute('data-meter-mode') === 'value';
    var value = valueMode ? 100 : Math.max(0, Math.min(100, slot.raw));
    var accents = { nordic: '#e6c28c', 'gaming-lounge': '#aacbff',
      'departure-lounge': '#e6bf83', orbital: '#d0bffc',
      platform: '#91d5ed', observatory: '#83e0cb', grid: '#83e0cb', sensorium: '#b5a6ff',
      'home-cinema': '#d9b7d2', 'signal-lab': '#88e1be' };
    var lightAccents = { nordic: '#896331', 'gaming-lounge': '#335ea4',
      'departure-lounge': '#8c5822', orbital: '#79619e',
      platform: '#136784', observatory: '#167d70', grid: '#167d70', sensorium: '#7460b8',
      'home-cinema': '#895878', 'signal-lab': '#277b5e' };
    var template = doc.documentElement.getAttribute('data-legacy-template');
    var accent = (theme === 'light' ? lightAccents : accents)[template] ||
      (theme === 'light' ? '#136784' : '#91d5ed');
    var svg = node._legacyMeterRing;
    if (!svg) {
      svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'legacy-meter-ring');
      svg.setAttribute('viewBox', '0 0 128 128');
      svg.setAttribute('aria-hidden', 'true');
      for (var i = 0; i < 2; i += 1) {
        var circle = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', '64');
        circle.setAttribute('cy', '64');
        circle.setAttribute('r', '61');
        circle.setAttribute('fill', 'none');
        circle.setAttribute('stroke-width', '5');
        if (i) circle.setAttribute('transform', 'rotate(-90 64 64)');
        svg.appendChild(circle);
      }
      node.appendChild(svg);
      node._legacyMeterRing = svg;
    }
    var length = 2 * Math.PI * 61;
    svg.children[0].setAttribute('stroke', theme === 'light' ? '#c9d9d7' : '#49636a');
    svg.children[1].setAttribute('stroke', accent);
    svg.children[1].setAttribute('stroke-dasharray', String(length));
    svg.children[1].setAttribute('stroke-dashoffset', String(length * (1 - value / 100)));
    node.setAttribute('data-available', 'true');
    if (valueMode) {
      node.setAttribute('role', 'img');
      node.setAttribute('aria-label', (node.getAttribute('data-meter-label') || node.getAttribute('aria-label') || 'Reading') + ': ' + slot.value + (node.getAttribute('data-meter-unit') || ''));
      node.removeAttribute('aria-valuenow');
      node.removeAttribute('aria-valuetext');
    } else {
      node.setAttribute('role', 'meter');
      node.setAttribute('aria-label', node.getAttribute('data-meter-label') || 'Reading');
      node.setAttribute('aria-valuenow', String(value));
      node.setAttribute('aria-valuetext', String(slot.raw));
    }
  }

  function glyph(name) {
    if (!/^[a-z][a-z0-9-]*$/.test(name || '')) return null;
    return element('i', 'material-symbol ms-' + name);
  }

  function renderTable(field, datum, source, settings) {
    var wrapper = element('div', 'legacy-table-wrap');
    if (!source || !source.columns || !datum || !datum.available || !Array.isArray(datum.value)) {
      wrapper.appendChild(element('div', 'legacy-muted', 'No data'));
      return wrapper;
    }
    var ids = settings && settings.columns ? settings.columns : [];
    var columns = [];
    for (var i = 0; i < ids.length; i += 1) {
      for (var j = 0; j < source.columns.length; j += 1) {
        if (source.columns[j].id === ids[i]) { columns.push(source.columns[j]); break; }
      }
    }
    if (!columns.length) columns = source.columns.slice(0, 7);
    var table = element('table', 'legacy-table' + (settings && settings.noWrap ? ' legacy-table-nowrap' : ''));
    table.style.fontSize = Math.max(10, Math.min(24, settings && settings.fontSize || 14)) * vistaFontFactor() + 'px';
    var header = element('tr');
    for (var c = 0; c < columns.length; c += 1) {
      header.appendChild(element('th', columns[c].type === 'timestamp' ? 'legacy-date-cell' : '', columns[c].label));
    }
    table.appendChild(header);
    var limit = settings && settings.rows ? Math.min(10, settings.rows) : 10;
    for (var r = 0; r < datum.value.length && r < limit; r += 1) {
      var row = element('tr');
      for (var k = 0; k < columns.length; k += 1) {
        var column = columns[k];
        var cell = element('td', column.type === 'timestamp' ? 'legacy-date-cell' : '');
        cell.appendChild(element('div', 'legacy-table-cell', column.type === 'timestamp'
          ? tableTime(datum.value[r][column.id])
          : formatted(datum.value[r][column.id], column.type, column)));
        row.appendChild(cell);
      }
      table.appendChild(row);
    }
    if (!datum.value.length) wrapper.appendChild(element('div', 'legacy-muted', 'No items'));
    else wrapper.appendChild(table);
    return wrapper;
  }

  function renderCard(entry) {
    var card = entry.card;
    var data = entry.data || {};
    var catalog = entry.catalog || [];
    if (card.layout === 'readymade') return renderReadyMade(entry);
    var article = element('article', 'legacy-card');
    article.className += ' legacy-card-' + (card.layout || 'list');
    if (card.showHeader !== false) {
      var heading = element('header', 'legacy-card-heading');
      var label = element('div', 'legacy-card-heading-label');
      var icon = glyph(card.icon === 'inherit' ? data.icon : card.icon);
      if (icon) label.appendChild(icon);
      label.appendChild(element('h2', '', card.name || 'Card'));
      heading.appendChild(label);
      heading.appendChild(element('span', 'legacy-card-status', data.status || 'Unavailable'));
      article.appendChild(heading);
    }
    var body = element('div', 'legacy-card-body');
    var fields = card.fields || [];
    var shown = 0;
    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i];
      if (!field.enabled) continue;
      shown += 1;
      var source = findSource(catalog, field.binding);
      var datum = data.values && data.values[field.binding];
      if ((source && source.type === 'table') || (datum && datum.type === 'table')) {
        body.appendChild(renderTable(field, datum, source, card.listOptions));
      } else if (source && source.type === 'webpage') {
        var url = datum && datum.available && datum.value && datum.value.url;
        if (url && /^https?:\/\//.test(url)) {
          var frame = element('iframe', 'legacy-webpage');
          frame.src = url;
          frame.title = field.label || 'Webpage';
          frame.setAttribute('sandbox', 'allow-scripts allow-forms');
          frame.setAttribute('scrolling', 'no');
          body.appendChild(frame);
        } else body.appendChild(element('div', 'legacy-muted', 'Webpage unavailable'));
      } else if (datum && datum.type === 'log' && Array.isArray(datum.value)) {
        for (var n = 0; n < datum.value.length && n < 5; n += 1) {
          body.appendChild(element('div', 'legacy-field', datum.value[n].message));
        }
      } else {
        var line = element('div', 'legacy-field');
        line.appendChild(element('div', 'legacy-field-label', field.label || (source && source.label) || 'Reading'));
        line.appendChild(element('div', 'legacy-field-value', datum && datum.available
          ? formatted(datum.value, datum.type, field) : source ? 'No data' : 'Unavailable field'));
        body.appendChild(line);
      }
    }
    if (!shown) body.appendChild(element('div', 'legacy-muted', 'No enabled fields'));
    article.appendChild(body);
    if (card.showFooter !== false) {
      var footer = element('footer', 'legacy-card-footer');
      var footerIcon = glyph(data.icon);
      if (footerIcon) footer.appendChild(footerIcon);
      footer.appendChild(element('span', '', data.pluginName || ''));
      article.appendChild(footer);
    }
    return article;
  }

  function renderReadyMade(entry) {
    var metadata = entry.data && entry.data.readyMade;
    var template = metadata && metadata.template;
    var source = metadata && metadata.source;
    var bindings = metadata && metadata.bindings;
    if (!template || !source || !bindings ||
      !/^\/plugin-card-assets\/[a-z0-9-]+\/[a-z0-9-]+\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.html$/.test(template.url)) {
      return element('article', 'legacy-card legacy-muted', 'Ready-made design unavailable');
    }
    var article = element('article', 'legacy-card legacy-ready-card');
    var frame = element('iframe', 'legacy-ready-frame');
    frame.src = template.url;
    frame.title = entry.card.name || 'Card';
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('scrolling', 'no');
    frame._legacyEntry = entry;
    frame.onload = function () { hydrateReadyFrame(frame); };
    article.appendChild(frame);
    return article;
  }

  function hydrateReadyFrame(frame) {
    var entry = frame._legacyEntry;
    var metadata = entry && entry.data && entry.data.readyMade;
    var template = metadata && metadata.template;
    var source = metadata && metadata.source;
    var bindings = metadata && metadata.bindings;
    if (!template || !source || !bindings) return;
      try {
        var doc = frame.contentDocument;
        if (!doc || !doc.querySelector('[data-ready-made]')) return;
        if (window.LocalserveCardPreview) window.LocalserveCardPreview.attach(frame, template.previewUrl,
          connected && source.enabled !== false && entry.data.status === 'Ready',
          !connected ? 'Disconnected' : source.enabled === false ? 'Data source disabled' : entry.data.status);
        if (frame._legacyStyledDocument !== doc) {
          var link = doc.createElement('link');
          link.rel = 'stylesheet';
          link.href = '/assets/vista-legacy-ready.css?v=21';
          link.onload = function () {
            applyVistaFontSize(doc);
            if (frame._legacyOnReady) {
              var ready = frame._legacyOnReady;
              frame._legacyOnReady = null;
              ready();
            }
          };
          doc.head.appendChild(link);
          frame._legacyStyledDocument = doc;
        }
        var theme = payload.options.theme === 'light' ? 'light' : 'dark';
        doc.documentElement.setAttribute('data-theme', theme);
        doc.documentElement.setAttribute('data-legacy-template', template.id);
        applyVistaFontSize(doc);
        var slots = {};
        for (var s = 0; s < template.slots.length; s += 1) {
          var definition = template.slots[s];
          var reading = entry.data.values && entry.data.values[bindings[definition.id]];
          if (definition.percentOf) {
            // Match the modern renderer using only the declared public readings.
            var total = entry.data.values && entry.data.values[bindings[definition.percentOf]];
            var ratioKnown = reading && reading.available && total && total.available
              && typeof reading.value === 'number' && isFinite(reading.value) && reading.value >= 0
              && typeof total.value === 'number' && isFinite(total.value) && total.value > 0;
            var percent = ratioKnown ? reading.value / total.value * 100 : null;
            reading = { available: Boolean(ratioKnown && isFinite(percent)), value: percent };
          }
          var known = source.enabled !== false && reading && reading.available;
          if (definition.type === 'table') {
            var rows = [];
            if (known && Array.isArray(reading.value)) {
              for (var r = 0; r < reading.value.length && r < definition.rows; r += 1) {
                var row = {};
                for (var c = 0; c < definition.columns.length; c += 1) {
                  var column = definition.columns[c];
                  row[column.id] = readyCell(column, reading.value[r][column.id]);
                }
                rows.push(row);
              }
            }
            slots[definition.id] = { rows: rows, columns: definition.columns, available: Boolean(known) };
          } else {
            var value = 'No data';
            if (known) {
              value = definition.type === 'timestamp'
                ? definition.format === 'minutes-until'
                  ? Math.max(0, Math.ceil((reading.value - (payload && payload.options && payload.options.now || Date.now())) / 60000)) + ' min'
                  : definition.format === 'time' ? clockTime(reading.value) : tableTime(reading.value)
                : definition.format === 'number' ? readyNumber(reading.value, definition.decimals)
                : definition.type === 'boolean' ? reading.value ? 'Yes' : 'No'
                : String(reading.value);
            }
            slots[definition.id] = { value: value, raw: known ? reading.value : null, available: Boolean(known),
              deadline: known && definition.format === 'minutes-until' ? reading.value : null };
          }
        }
        var variant = template.variant;
        var variantValue = variant ? variant.fallback : 'default';
        if (variant && slots[variant.slot]) {
          var rawVariant = String(slots[variant.slot].raw);
          for (var choice in variant.choices) {
            if (Object.prototype.hasOwnProperty.call(variant.choices, choice) &&
                variant.choices[choice].indexOf(rawVariant) !== -1) {
              variantValue = choice;
              break;
            }
          }
        }
        doc.documentElement.setAttribute('data-variant', variantValue);
        doc.documentElement.setAttribute('data-connected', String(connected));
        var nodes = doc.querySelectorAll('[data-card-text]');
        for (var i = 0; i < nodes.length; i += 1) {
          var id = nodes[i].getAttribute('data-card-text');
          var value = id === 'source-name' ? source.name : id === 'source-status'
            ? !connected ? 'Disconnected · retained reading' : source.enabled === false ? 'Data source disabled' : entry.data.status :
              slots[id] ? slots[id].value : 'No data';
          value = value || 'No data';
          if (nodes[i].getAttribute('data-card-source-state') != null) {
            var hostStatus = !connected ? 'Disconnected · retained reading' : source.enabled === false ? 'Data source disabled' : entry.data.status;
            if (hostStatus !== 'Ready') value = hostStatus || 'Unavailable';
          }
          if (nodes[i].textContent !== value) nodes[i].textContent = value;
          nodes[i].setAttribute('data-available', String(id === 'source-name' || id === 'source-status' || Boolean(slots[id] && slots[id].available)));
          if (slots[id] && slots[id].deadline) nodes[i].setAttribute('data-countdown-at', String(slots[id].deadline));
          else nodes[i].removeAttribute('data-countdown-at');
        }
        var colors = doc.querySelectorAll('[data-card-color]');
        for (var ci = 0; ci < colors.length; ci += 1) {
          var colorSlot = slots[colors[ci].getAttribute('data-card-color')];
          var colorValue = colorSlot && colorSlot.value;
          var validColor = /^#[0-9a-f]{6}$/i.test(colorValue || '');
          colors[ci].hidden = !validColor;
          colors[ci].style.backgroundColor = validColor ? colorValue : '';
        }
        var cells = doc.querySelectorAll('[data-card-cell]');
        for (var j = 0; j < cells.length; j += 1) {
          var parts = cells[j].getAttribute('data-card-cell').split(':');
          var slot = slots[parts[0]];
          setReadyCell(cells[j], slot && slot.rows[Number(parts[1])] && slot.rows[Number(parts[1])][parts[2]]);
        }
        var tables = doc.querySelectorAll('[data-card-table]');
        for (var k = 0; k < tables.length; k += 1) {
          renderReadyTable(doc, tables[k], slots[tables[k].getAttribute('data-card-table')]);
        }
        var meters = doc.querySelectorAll('[data-card-meter]');
        for (var m = 0; m < meters.length; m += 1) {
          renderReadyMeter(doc, meters[m], slots[meters[m].getAttribute('data-card-meter')], theme);
        }
      } catch (ignore) {}
  }

  function availableEntries(node, entries) {
    var result = [];
    var references = node.cards || [];
    for (var i = 0; i < references.length; i += 1) {
      var key = references[i].pluginId + '/' + references[i].cardId;
      if (entries[key]) result.push(entries[key]);
    }
    return result;
  }

  function advanceSelections(node, entries, now) {
    var changed = false;
    if (!node || node.enabled === false) return false;
    if (node.type === 'row' || node.type === 'column') {
      for (var i = 0; i < (node.children || []).length; i += 1) {
        if (advanceSelections(node.children[i], entries, now)) changed = true;
      }
      return changed;
    }
    var options = availableEntries(node, entries);
    var previous = selections[node.id];
    if (!previous || previous.count !== options.length) {
      selections[node.id] = { index: 0, count: options.length, nextAt: now + (node.intervalSeconds || 10) * 1000 };
      return true;
    }
    if (options.length > 1 && (node.rotation === 'interval' || node.rotation === 'both') && now >= previous.nextAt) {
      previous.index = (previous.index + 1) % options.length;
      previous.nextAt = now + (node.intervalSeconds || 10) * 1000;
      return true;
    }
    return false;
  }

  function sizeChild(child, spec) {
    var value = String(spec || '1fr');
    if (/^(?:[0-9]+(?:\.[0-9]+)?)(?:px|%)$/.test(value)) child.style.flex = '0 0 ' + value;
    else if (value === 'auto') child.style.flex = '1 1 auto';
    else child.style.flex = (parseFloat(value) || 1) + ' 1 0%';
  }

  function syncCardNode(current, next) {
    if ((current.tagName || current.tag) !== (next.tagName || next.tag) ||
        current.className !== next.className || current.children.length !== next.children.length) return false;
    if (!current.children.length) {
      if (current.textContent !== next.textContent) current.textContent = next.textContent;
      if ((current.tagName || current.tag).toLowerCase() === 'iframe' && current.src !== next.src) current.src = next.src;
      return true;
    }
    for (var i = 0; i < current.children.length; i += 1) {
      if (!syncCardNode(current.children[i], next.children[i])) current.replaceChild(next.children[i], current.children[i]);
    }
    return true;
  }

  function updateView(view, entries) {
    var options = availableEntries(view.node, entries);
    var selection = selections[view.node.id];
    var entry = options.length ? options[selection ? selection.index : 0] : null;
    var key = entry ? entry.pluginId + '/' + entry.card.id : '';
    var template = entry && entry.data && entry.data.readyMade && entry.data.readyMade.template;
    var mountSignature = JSON.stringify([key, entry && entry.card.layout, entry && entry.card.templateId,
      template && template.url]);
    var dataSignature = entry ? JSON.stringify([entry.card, entry.catalog, entry.data,
      payload.options.theme, payload.options.timeFormat, payload.options.fontScale]) : '';
    if (view.mountSignature !== mountSignature) {
      var previous = view.currentElement;
      var next = entry ? renderCard(entry) : element('div', 'legacy-slot-empty', 'No items');
      view.transitionId = (view.transitionId || 0) + 1;
      var transitionId = view.transitionId;
      var animate = previous && view.currentKey !== key && view.node.type === 'collection' &&
        view.node.animation !== 'none' && (!window.matchMedia ||
          !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      // A previous fade may still be finishing. Retain only the current Card.
      for (var child = view.element.firstChild; child;) {
        var following = child.nextSibling;
        if (child !== previous) view.element.removeChild(child);
        child = following;
      }
      if (!animate) {
        clear(view.element);
        view.element.appendChild(next);
      } else {
        previous.className += ' legacy-switch-old';
        view.element.appendChild(next);
        var begin = function () {
          if (view.transitionId !== transitionId || !previous.parentNode) return;
          previous.className += ' legacy-switch-leave';
          setTimeout(function () {
            if (previous.parentNode) previous.parentNode.removeChild(previous);
          }, 320);
        };
        var frame = entry && entry.card.layout === 'readymade' && next.firstChild;
        if (frame && frame._legacyEntry) {
          frame._legacyOnReady = begin;
          setTimeout(function () {
            if (frame._legacyOnReady) {
              frame._legacyOnReady = null;
              begin();
            }
          }, 1800);
        } else begin();
      }
      view.currentElement = next;
      view.currentKey = key;
      view.mountSignature = mountSignature;
      view.dataSignature = dataSignature;
      return;
    }
    if (view.dataSignature === dataSignature || !entry) return;
    view.dataSignature = dataSignature;
    if (entry.card.layout === 'readymade') {
      var frame = view.currentElement && view.currentElement.firstChild;
      if (frame && frame._legacyEntry) {
        frame._legacyEntry = entry;
        hydrateReadyFrame(frame);
      }
    } else {
      var next = renderCard(entry);
      if (!syncCardNode(view.currentElement, next)) {
        view.element.replaceChild(next, view.currentElement);
        view.currentElement = next;
      }
    }
  }

  function renderNode(node, entries, gap) {
    var box = element('div', 'legacy-vista-node');
    if (node.type === 'row' || node.type === 'column') {
      box.className += node.type === 'row' ? ' legacy-row' : ' legacy-column';
      var children = node.children || [];
      var added = 0;
      for (var i = 0; i < children.length; i += 1) {
        if (children[i].enabled === false) continue;
        var child = renderNode(children[i], entries, gap);
        sizeChild(child, children[i][node.type === 'row' ? 'width' : 'height']);
        var next = i + 1;
        while (next < children.length && children[next].enabled === false) next += 1;
        if (next < children.length) {
          if (node.type === 'row') child.style.marginRight = Math.max(0, gap) + 'px';
          else child.style.marginBottom = Math.max(0, gap) + 'px';
        }
        box.appendChild(child);
        added += 1;
      }
      if (!added) box.appendChild(element('div', 'legacy-slot-empty', 'No items'));
    } else {
      views[node.id] = { node: node, element: box, mountSignature: null, dataSignature: null,
        currentElement: null, currentKey: '' };
      updateView(views[node.id], entries);
    }
    return box;
  }

  function draw() {
    if (!payload) return;
    var entries = {};
    for (var i = 0; i < payload.cards.length; i += 1) {
      entries[payload.cards[i].pluginId + '/' + payload.cards[i].card.id] = payload.cards[i];
    }
    document.documentElement.setAttribute('data-theme', payload.options.theme === 'light' ? 'light' : 'dark');
    applyVistaFontSize(document);
    document.title = (payload.vista ? payload.vista.name : 'Display') + ' · ' + payload.options.name;
    var emptyMessage = !payload.vista ? 'No enabled Vista selected.' : !payload.cards.length
      ? 'No cards in this Vista yet. Add cards in Localserve when you are ready.'
      : !payload.vista.layout.enabled ? 'Vista layout disabled.' : '';
    if (emptyMessage) {
      if (layoutSignature !== 'empty:' + emptyMessage) {
        layoutSignature = 'empty:' + emptyMessage;
        views = {};
        empty(emptyMessage);
      }
      return;
    }
    var signature = JSON.stringify([payload.vista.id, payload.vista.layout,
      payload.vista.gap, payload.vista.padding]);
    if (layoutSignature !== signature) {
      layoutSignature = signature;
      views = {};
      selections = {};
      advanceSelections(payload.vista.layout, entries, Date.now());
      clear(host);
      host.style.padding = Math.max(0, payload.vista.padding || 0) + 'px';
      host.appendChild(renderNode(payload.vista.layout, entries, payload.vista.gap || 0));
    } else {
      advanceSelections(payload.vista.layout, entries, Date.now());
      for (var id in views) if (Object.prototype.hasOwnProperty.call(views, id)) updateView(views[id], entries);
    }
  }

  function tickCountdowns() {
    if (!payload || status.style.display === 'block') return;
    var now = payload.options.now && clockReceivedAt
      ? payload.options.now + Date.now() - clockReceivedAt : Date.now();
    for (var id in views) {
      if (!Object.prototype.hasOwnProperty.call(views, id)) continue;
      var frame = views[id].currentElement && views[id].currentElement.firstChild;
      try {
        var doc = frame && frame._legacyEntry && frame.contentDocument;
        if (!doc) continue;
        var nodes = doc.querySelectorAll('[data-countdown-at]');
        for (var i = 0; i < nodes.length; i += 1) {
          var at = Number(nodes[i].getAttribute('data-countdown-at'));
          if (!isFinite(at)) continue;
          var next = Math.max(0, Math.ceil((at - now) / 60000)) + ' min';
          if (nodes[i].textContent !== next) nodes[i].textContent = next;
        }
      } catch (ignore) {}
    }
  }

  function setConnected(next) {
    if (connected === next) return;
    connected = next;
    // Only our mounted same-origin ready-made frames receive this signal.
    // Retain the actual document/readings; freeze ambient CSS and timers when
    // disconnected, then hydrate the same frames on the next successful poll.
    for (var id in views) {
      if (!Object.prototype.hasOwnProperty.call(views, id)) continue;
      var frame = views[id].currentElement && views[id].currentElement.firstChild;
      if (!frame || !frame._legacyEntry) continue;
      try {
        var doc = frame.contentDocument;
        if (!doc) continue;
        doc.documentElement.setAttribute('data-connected', String(connected));
        if (connected) hydrateReadyFrame(frame);
        else {
          var labels = doc.querySelectorAll('[data-card-text="source-status"]');
          for (var i = 0; i < labels.length; i += 1) labels[i].textContent = 'Disconnected · retained reading';
        }
      } catch (ignore) {}
    }
  }

  function refresh() {
    if (busy) return;
    busy = true;
    var request = new XMLHttpRequest();
    request.open('GET', api, true);
    request.onreadystatechange = function () {
      if (request.readyState !== 4) return;
      busy = false;
      if (request.status === 200) {
        try {
          payload = JSON.parse(request.responseText);
          clockReceivedAt = Date.now();
          setConnected(true);
          draw();
          status.style.display = 'none';
          tickCountdowns();
          return;
        } catch (ignore) {}
      }
      status.textContent = payload ? 'Disconnected' : 'Vista unavailable';
      status.style.display = 'block';
      setConnected(false);
      if (!payload) empty('Vista unavailable.');
    };
    request.onerror = function () {
      busy = false;
      status.textContent = 'Disconnected';
      status.style.display = 'block';
      setConnected(false);
    };
    request.send(null);
  }

  // Universe supplies one selected public Card, without starting a second read
  // loop or permitting plugin actions. The normal Vista lifecycle stays intact.
  if (document.body.getAttribute('data-card-host') === 'universe') {
    window.LocalserveLegacyCard = {
      update: function (entry, options, online) {
        payload = { options: options, cards: entry && entry.card ? [entry] : [],
          vista: { id: 'universe', name: 'Universe', padding: 0, gap: 0,
            layout: { id: 'universe-card', type: 'card', enabled: true,
              cards: entry && entry.card ? [{ pluginId: entry.pluginId, cardId: entry.cardId }] : [] } } };
        clockReceivedAt = Date.now();
        if (entry && entry.card) draw();
        else { clear(host); views = {}; layoutSignature = ''; }
        setConnected(online);
        tickCountdowns();
      },
      connected: setConnected,
      tick: tickCountdowns
    };
    return;
  }
  refresh();
  setInterval(refresh, 2000);
  setInterval(function () { if (connected) { draw(); tickCountdowns(); } }, 1000);
}());
