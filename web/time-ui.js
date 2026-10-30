/** Editable time combobox. Presentation follows the server preference; saved
 * schedule values stay HH:mm. Quarter-hour choices do not limit typed minutes.
 */
const TimeUI = {
  active: null,
  activeIndex: 0,

  parse(value) {
    const match = /^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?$/i.exec(String(value).trim());
    if (!match) return '';
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    if (match[3]) {
      if (hour < 1 || hour > 12) return '';
      hour = hour % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0);
    } else if (hour > 23) return '';
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  },

  format(value, format = config.timeFormat) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return 'Set time';
    if (format !== '12') return value;
    const [hour, minute] = value.split(':').map(Number);
    return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
  },

  choices() {
    return Array.from({ length: 96 }, (_, index) => {
      return `${String(Math.floor(index / 4)).padStart(2, '0')}:${String(index % 4 * 15).padStart(2, '0')}`;
    });
  },

  optionMarkup(id, value) {
    return this.choices().map((time, index) => {
      return `<button type="button" role="option" tabindex="-1" id="${id}-${index}" data-action="select-time" data-time="${time}" aria-selected="${time === value}">${this.format(time)}</button>`;
    }).join('');
  },

  render(value, name = 'time', required = true, inputId = '') {
    const id = `time-options-${crypto.randomUUID()}`;
    return `<div class="time-combobox">
      <input ${inputId?`id="${escapeHtml(inputId)}"`:''} name="${escapeHtml(name)}Text" type="text" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}" autocomplete="off" ${required?'required':''} value="${value?this.format(value):''}" placeholder="${config.timeFormat === '12' ? 'h:mm AM/PM' : 'HH:mm'}" data-time-input>
      <input name="${escapeHtml(name)}" type="hidden" value="${escapeHtml(value)}" data-time-value>
      <button class="time-menu-button" type="button" data-action="toggle-time-menu" aria-label="Choose time">${icon('chevron-down')}</button>
      <div id="${id}" class="time-options" role="listbox" aria-label="Times" popover="manual">${this.optionMarkup(id, value)}</div>
    </div>`;
  },

  normalize(input, display = false) {
    const value = this.parse(input.value);
    input.closest('.time-combobox').querySelector('[data-time-value]').value = value;
    input.setCustomValidity(value || !input.required && !input.value.trim() ? '' : 'Enter a valid time, such as 19:15 or 7:15 PM.');
    if (display && value) input.value = this.format(value);
    return value;
  },

  open(root) {
    this.close();
    this.active = root;
    const input = root.querySelector('[data-time-input]');
    const list = root.querySelector('.time-options');
    const bounds = input.getBoundingClientRect();
    // Native popover places the list above the dialog's scrolling/clipping areas.
    // Position it near the input without changing the editor's geometry.
    const below = window.innerHeight - bounds.bottom - 12;
    const above = bounds.top - 12;
    const openBelow = below >= 160 || below >= above;
    const height = Math.min(240, Math.max(80, openBelow ? below : above));
    list.style.left = `${bounds.left}px`;
    list.style.top = `${openBelow ? bounds.bottom + 4 : bounds.top - height - 4}px`;
    list.style.width = `${bounds.width}px`;
    list.style.maxHeight = `${height}px`;
    list.showPopover();
    input.setAttribute('aria-expanded', 'true');
    const value = this.parse(input.value);
    const [hour, minute] = (value || '00:00').split(':').map(Number);
    this.highlight(Math.min(95, Math.round((hour * 60 + minute) / 15)));
    input.focus({ preventScroll: true });
  },

  highlight(index) {
    this.activeIndex = Math.max(0, Math.min(95, index));
    const input = this.active.querySelector('[data-time-input]');
    const options = this.active.querySelectorAll('[role="option"]');
    options.forEach((option, position) => option.classList.toggle('active', position === this.activeIndex));
    input.setAttribute('aria-activedescendant', options[this.activeIndex].id);
    options[this.activeIndex].scrollIntoView({ block: 'nearest' });
  },

  select(value) {
    const input = this.active.querySelector('[data-time-input]');
    input.value = this.format(value);
    this.normalize(input);
    // The existing Task editor updates its summary from the canonical value.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    this.close();
    input.focus({ preventScroll: true });
  },

  close() {
    if (!this.active) return;
    const input = this.active.querySelector('[data-time-input]');
    this.active.querySelector('.time-options').hidePopover();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    this.active = null;
  },

  refreshFormat() {
    this.close();
    document.querySelectorAll('.time-combobox').forEach(root => {
      const value = root.querySelector('[data-time-value]').value;
      const input = root.querySelector('[data-time-input]');
      if (value) input.value = this.format(value);
      input.placeholder = config.timeFormat === '12' ? 'h:mm AM/PM' : 'HH:mm';
      const list = root.querySelector('.time-options');
      list.innerHTML = this.optionMarkup(list.id, value);
    });
  },

  install() {
    document.addEventListener('focusout', event => {
      if (event.target.matches('[data-time-input]')) this.normalize(event.target, true);
    });
    document.addEventListener('pointerdown', event => {
      if (this.active && !this.active.contains(event.target)) this.close();
    });
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-action]');
      if (button?.dataset.action === 'toggle-time-menu') {
        const root = button.closest('.time-combobox');
        if (this.active === root) this.close(); else this.open(root);
      }
      if (button?.dataset.action === 'select-time') this.select(button.dataset.time);
    });
    document.addEventListener('keydown', event => {
      if (!event.target.matches('[data-time-input]')) return;
      const root = event.target.closest('.time-combobox');
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (this.active !== root) this.open(root);
        else this.highlight(this.activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
      } else if (this.active === root && ['Home', 'End', 'Enter', 'Escape', 'Tab'].includes(event.key)) {
        if (event.key !== 'Tab') event.preventDefault();
        if (event.key === 'Escape') event.stopPropagation();
        if (event.key === 'Enter') this.select(this.choices()[this.activeIndex]);
        else if (event.key === 'Home' || event.key === 'End') this.highlight(event.key === 'Home' ? 0 : 95);
        else this.close();
      }
    });
    // Scrolling or resizing changes the anchor's position; dismiss stale menus.
    document.querySelector('#editor-dialog').addEventListener('scroll', event => {
      if (this.active && !event.target.matches('.time-options')) this.close();
    }, true);
    window.addEventListener('resize', () => this.close());
  },
};
