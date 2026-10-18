/** Shared inert markup and hydration for administrator previews and Controls
 * viewers. Only the viewer binds execution; previews never call an action API.
 */
'use strict';
const ControlsRenderer = {
  escape(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); },
  icon(value) { return `<i class="material-symbol ms-${this.escape(value)}" aria-hidden="true"></i>`; },
  reported(value) { return value === null || value === undefined ? 'No data' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value); },
  renderItem(item) {
    const escaped = this.escape.bind(this), id = 'control-input-' + item.id;
    let input = '';
    const value = item.reported ?? item.input?.default;
    if (item.kind === 'toggle' && item.input) input = `<label class="control-target" for="${escaped(id)}"><span>Target</span><input id="${escaped(id)}" class="switch" role="switch" type="checkbox" data-control-input="${escaped(item.id)}" ${value === true ? 'checked' : ''}><output>${value === true ? 'On' : 'Off'}</output></label>`;
    else if (item.kind === 'range' && item.input) input = `<label class="control-target" for="${escaped(id)}"><span>Target</span><input id="${escaped(id)}" type="range" min="${Number(item.input.min)}" max="${Number(item.input.max)}" step="1" value="${Number(value ?? item.input.min)}" data-control-input="${escaped(item.id)}"><output>${escaped(value)}</output></label>`;
    else if (item.kind === 'select' && item.input) input = `<label class="control-target" for="${escaped(id)}"><span>Target</span><select id="${escaped(id)}" data-control-input="${escaped(item.id)}">${(item.input.enum || []).map((choice, index) => `<option value="${escaped(choice)}" ${choice === value ? 'selected' : ''}>${escaped(item.input.enumLabels?.[index] ?? choice)}</option>`).join('')}</select></label>`;
    else input = `<button type="button" class="button control-mapped-button" data-control-item="${escaped(item.id)}">${this.icon(item.icon)}<span>${escaped(item.label)}</span></button>`;
    return `<section class="control-surface" data-control-id="${escaped(item.id)}">${['button', 'scene'].includes(item.kind) ? '' : `<h2>${this.icon(item.icon)}${escaped(item.label)}</h2>`}${input}${item.hasReading ? `<small class="control-reading">Reported: <span data-control-reading>${escaped(this.reported(item.reported))}</span></small>` : ''}</section>`;
  },
  mount(host, snapshot, { preview = false } = {}) {
    const page = snapshot.page;
    const signature = JSON.stringify([page.id, page.revision, page.columns, page.items.map(({ reported, available, ...item }) => item)]);
    if (host.dataset.controlSignature !== signature) {
      host.innerHTML = `<div class="controls-grid" style="--control-columns:${Math.max(1, Math.min(6, Number(page.columns) || 3))}">${page.items.map(item => this.renderItem(item)).join('')}</div>`;
      host.dataset.controlSignature = signature;
    }
    // Keep focus, partially chosen slider values and connected DOM across polls.
    // The Reported line is always provider data, never a sent/optimistic target.
    const surfaces = [...host.querySelectorAll('[data-control-id]')];
    for (const item of page.items) {
      const surface = surfaces.find(element => element.dataset.controlId === item.id);
      if (!surface) continue;
      const reading = surface.querySelector('[data-control-reading]');
      if (reading) reading.textContent = this.reported(item.reported);
      for (const control of surface.querySelectorAll('button,input,select')) control.disabled = preview || !snapshot.available || snapshot.busy || !item.available;
      const input = surface.querySelector('[data-control-input]');
      if (input) input.setAttribute?.('aria-label', item.label + ' target');
      if (input && input !== document.activeElement && input.dataset.changed !== 'true' && item.reported !== null && item.reported !== undefined) {
        if (item.kind === 'toggle') input.checked = item.reported === true;
        else input.value = String(item.reported);
      }
      if (input) this.updateInput(input);
    }
  },
  updateInput(input) {
    const output = input.closest('.control-target').querySelector('output');
    if (output) output.textContent = input.type === 'checkbox' ? input.checked ? 'On' : 'Off' : input.value;
  },
};
