/** Presentation helpers shared by administrator views. These derive labels from
 * reported state only; they never execute actions or infer a device's state. */
const AdminUX = {
  serviceStatus(service, paused = false) {
    if (['loading', 'configuring'].includes(service.health)) return {label: service.health === 'loading' ? 'Loading' : 'Updating', className: 'waiting'};
    if (['error', 'restart-required'].includes(service.health)) return {label: service.health === 'error' ? 'Runtime error' : 'Restart required', className: 'waiting'};
    if (!service.configurationReady) return {label: 'Configure', className: 'waiting'};
    if (!service.enabled) return {label: 'Disabled', className: 'paused'};
    if (paused) return {label: 'Paused', className: 'paused'};
    return service.health === 'ready' ? {label: 'Ready', className: 'running'} : {label: 'Not running', className: 'waiting'};
  },

  reception(service) {
    // A completed check may only inspect a cache. Reception must instead come
    // from a plugin-declared reception timestamp, never from command delivery,
    // clock/Event time or a forecast's publication/validity period.
    const fields = (service.cardCatalog || []).filter(field => {
      const declaration = service.cardFields?.find(item => field.id === item.id || field.id.endsWith(':' + item.id));
      return field.type === 'timestamp' && /receiv|reception/i.test(field.label) && declaration?.source?.kind === 'state';
    });
    return fields.map(field => ({label: field.label, value: service.cardData?.values[field.id]}))
      .filter(item => item.value?.available && Number.isFinite(item.value.value))
      .sort((a, b) => b.value.value - a.value.value)[0] || null;
  },

  taskActivation(task, paused = false) {
    const rules = task.starts.filter(rule => rule.enabled).length;
    const steps = task.steps.filter(step => step.enabled).length;
    const allRules = task.starts.length;
    const activation = !task.enabled ? 'Task disabled' : paused ? 'Server paused'
      : allRules && !rules ? 'Automatic rules disabled' : rules ? `${rules} automatic rule${rules === 1 ? '' : 's'} enabled` : 'Manual only';
    return `${activation} · ${rules}/${allRules} rules · ${steps}/${task.steps.length} steps enabled`;
  },

  savesDefinition(endpoint) {
    return /(?:^|\/)api\/(?:games\/maze|config|universe|display|tasks(?:\/[^/]+(?:\/(?:enabled|delete))?)?|plugins\/[^/]+\/(?:config|enabled|cards(?:\/[^/]+(?:\/(?:enabled|delete))?)?|controls(?:\/[^/]+(?:\/(?:enabled|delete))?)?)|vistas(?:\/[^/]+(?:\/(?:enabled|delete))?)?)$/.test(endpoint);
  },
};

/** Administrator DOM reconciliation. Retained elements own their scrolling,
 * focus, disclosure state and embedded documents; server markup owns content. */
const AdminDOM = {
  scopes: new WeakMap(), pending: new Map(), installed: false,

  key(node) {
    if (node.nodeType !== 1) return null;
    const identity = node.getAttribute('data-live-key') || node.id;
    if (identity) return `${node.nodeName}:${identity}`;
    if (node.nodeName === 'IFRAME') return `IFRAME:${node.getAttribute('data-webpage-key') || node.getAttribute('src')}`;
    for (const name of ['data-view','data-activity-scope','data-variable-details','data-activity-details','data-activity-filter']) {
      if (node.hasAttribute(name)) return `${node.nodeName}:${name}:${node.getAttribute(name)}`;
    }
    if (node.hasAttribute('data-action')) return `${node.nodeName}:action:${['data-action','data-id','data-setting','data-plugin-id'].map(name => node.getAttribute(name) || '').join('|')}`;
    if (node.nodeName === 'OPTION') return `OPTION:${node.value}`;
    if (['INPUT','SELECT','TEXTAREA'].includes(node.nodeName) && node.name) return `${node.nodeName}:name:${node.name}`;
    return null;
  },

  selected(host) {
    const selection = host.ownerDocument.getSelection();
    if (selection && !selection.isCollapsed) {
      for (let index=0; index<selection.rangeCount; index++) {
        if (selection.getRangeAt(index).intersectsNode(host)) return true;
      }
    }
    // Focus inside a Card frame belongs to its embedded document. Leave it
    // connected and unchanged until the user returns to administrator controls.
    const active = host.ownerDocument.activeElement;
    return active?.nodeName === 'IFRAME' && host.contains(active);
  },

  update(host, markup, options = {}) {
    if (!host) return false;
    const changedScope = options.scope !== undefined && this.scopes.get(host) !== options.scope;
    this.pending.delete(host);
    if (!changedScope && this.selected(host)) {
      // Keep only the latest presentation while text is selected for copying.
      // Server hydration and all other independent regions continue normally.
      this.pending.set(host,{markup,options});
      return false;
    }
    const template = host.ownerDocument.createElement('template');
    template.innerHTML = markup;
    if (changedScope) {
      this.scopes.set(host,options.scope);
      host.replaceChildren(template.content);
    } else {
      const scrolling = [host,...host.querySelectorAll('*'),host.ownerDocument.scrollingElement]
        .filter(node => node && (node.scrollTop || node.scrollLeft))
        .map(node => ({node,top:node.scrollTop,left:node.scrollLeft}));
      this.children(host,template.content);
      for (const {node,top,left} of scrolling) if (node.isConnected) {
        if (node.scrollTop !== top) node.scrollTop = top;
        if (node.scrollLeft !== left) node.scrollLeft = left;
      }
    }
    options.onUpdate?.();
    return true;
  },

  children(parent, desired) {
    const original = [...parent.childNodes], used = new Set();
    const keyed = new Map(original.map(node => [this.key(node),node]).filter(([key]) => key !== null));
    let cursor = parent.firstChild;
    for (const next of [...desired.childNodes]) {
      const key = this.key(next);
      let node = key === null ? original.find(candidate => !used.has(candidate) && this.key(candidate) === null && candidate.nodeType === next.nodeType && candidate.nodeName === next.nodeName) : keyed.get(key);
      if (node && (used.has(node) || node.nodeType !== next.nodeType || node.nodeName !== next.nodeName)) node = null;
      if (!node) node = next.cloneNode(true);
      used.add(node);
      if (node !== cursor) parent.insertBefore(node,cursor);
      this.patch(node,next);
      cursor = node.nextSibling;
    }
    for (const node of original) if (!used.has(node)) node.remove();
  },

  patch(node, next) {
    if (node.nodeType !== 1) {
      if (node.nodeValue !== next.nodeValue) node.nodeValue = next.nodeValue;
      return;
    }
    const active = node === node.ownerDocument.activeElement;
    const field = ['INPUT','SELECT','TEXTAREA'].includes(node.nodeName);
    const draft = field && node.type !== 'hidden' && node.closest('form[data-plugin-action]');
    const value = field ? node.value : null;
    const preserve = name => node.nodeName === 'DETAILS' && name === 'open'
      || field && (active || draft) && ['value','checked','selected'].includes(name);
    for (const attribute of [...node.attributes]) {
      if (!preserve(attribute.name) && !next.hasAttribute(attribute.name)) node.removeAttribute(attribute.name);
    }
    for (const attribute of [...next.attributes]) {
      if (!preserve(attribute.name) && node.getAttribute(attribute.name) !== attribute.value) node.setAttribute(attribute.name,attribute.value);
    }
    // An active native dropdown keeps its option nodes until focus leaves it.
    // Editable controls retain their live value, caret and composition session.
    if (field && active) return;
    this.children(node,next);
    if (field) {
      const desired = draft && (node.nodeName !== 'SELECT' || [...node.options].some(option => option.value === value)) ? value : next.value;
      if (node.value !== desired) node.value = desired;
      if (!draft && node.nodeName === 'INPUT' && node.checked !== next.checked) node.checked = next.checked;
    }
  },

  text(node, value) {
    const text = String(value);
    if (node && node.textContent !== text && !this.selected(node)) node.textContent = text;
  },

  install() {
    if (this.installed) return;
    this.installed = true;
    const flush = () => {
      for (const [host,entry] of [...this.pending]) {
        if (!host.isConnected) this.pending.delete(host);
        else if (!this.selected(host)) this.update(host,entry.markup,entry.options);
      }
    };
    document.addEventListener('selectionchange',flush);
    document.addEventListener('focusin',flush);
  },
};
