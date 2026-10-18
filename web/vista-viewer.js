/** A Vista page consumes only its read-only projection. No administrator API,
 * tokens, configuration editor, or device actions are used by this client.
 */
'use strict';
const vistaDisplay = document.querySelector('#vista-display');
const vistaStatus = document.querySelector('#vista-status');
let vistaController = VistaRenderer.create(vistaDisplay);
const vistaSlug = location.pathname.split('/').at(-1);
const followsDisplay = location.pathname === '/display';
let lastVista;

async function refreshVista() {
  try {
    const response = await fetch(followsDisplay ? '/api/display' : `../api/vistas/${encodeURIComponent(vistaSlug)}`);
    if (!response.ok) {
      if (response.status === 404) {
        vistaController?.destroy();
        vistaDisplay.replaceChildren(Object.assign(document.createElement('p'), { className: 'vista-empty', textContent: 'Vista unavailable' }));
        lastVista = null;
        clearInterval(vistaPoll);
      }
      throw new Error('Vista unavailable');
    }
    lastVista = await response.json();
    document.title = `${lastVista.vista?.name || 'Display'} · ${lastVista.options.name}`;
    vistaDisplay.setAttribute('aria-label', lastVista.vista?.name || 'Display');
    document.documentElement.dataset.theme = lastVista.options.theme;
    // Match the Vista favicon to the global theme, retaining relative assets.
    const logoPath = `../assets/logo${lastVista.options.theme === 'dark' ? '-dark' : ''}.svg`;
    const favicon = document.querySelector('link[rel="icon"]');
    if (favicon.getAttribute('href') !== logoPath) favicon.setAttribute('href', logoPath);
    document.documentElement.style.setProperty('--font-scale', lastVista.options.fontScale / 100);
    if (!lastVista.vista) {
      vistaController?.destroy(); vistaController = null;
      vistaDisplay.replaceChildren(Object.assign(document.createElement('p'), { className: 'vista-empty', textContent: 'No enabled Vista selected. Choose Show on display in the administrator or run a Show Vista Task.' }));
      vistaStatus.hidden = true;
      return;
    }
    if (!vistaController) vistaController = VistaRenderer.create(vistaDisplay);
    vistaController.update(lastVista);
    vistaStatus.hidden = true;
  } catch {
    vistaStatus.textContent = lastVista ? 'Disconnected' : 'Vista unavailable';
    vistaStatus.hidden = false;
    if (lastVista?.vista) vistaController?.update({ ...lastVista, options: { ...lastVista.options, connected: false } });
  }
}
// Serialize polls so slow responses cannot apply in reverse order.
let vistaRefreshing = false;
async function pollVista() {
  if (vistaRefreshing) return;
  vistaRefreshing = true;
  try { await refreshVista(); } finally { vistaRefreshing = false; }
}
const vistaPoll = setInterval(pollVista, 2000);
pollVista();
window.addEventListener('pagehide', () => { clearInterval(vistaPoll); vistaController?.destroy(); }, { once: true });
