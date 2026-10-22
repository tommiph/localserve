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

async function refreshVista(signal) {
  try {
    const response = await fetch(followsDisplay ? '/api/display' : `../api/vistas/${encodeURIComponent(vistaSlug)}`, { signal });
    if (signal.aborted) return;
    if (!response.ok) {
      if (response.status === 404) {
        vistaController?.destroy();
        vistaController = null;
        vistaDisplay.replaceChildren(Object.assign(document.createElement('p'), { className: 'vista-empty', textContent: 'Vista unavailable' }));
        lastVista = null;
      }
      throw new Error('Vista unavailable');
    }
    const current = await response.json();
    if (signal.aborted) return;
    lastVista = current;
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
    if (signal.aborted) return;
    vistaStatus.textContent = lastVista ? 'Disconnected' : 'Vista unavailable';
    vistaStatus.hidden = false;
    if (lastVista?.vista) vistaController?.update({ ...lastVista, options: { ...lastVista.options, connected: false } });
  }
}
// Serialize polls so slow responses cannot apply in reverse order.
let vistaRead = null;
async function pollVista() {
  if (vistaRead) return;
  const controller = new AbortController();
  vistaRead = controller;
  try { await refreshVista(controller.signal); }
  finally { if (vistaRead === controller) vistaRead = null; }
}
let vistaPoll = null;
function startVistaPolling() {
  if (vistaPoll !== null) return;
  vistaPoll = setInterval(pollVista, 2000);
  void pollVista();
}
startVistaPolling();
window.addEventListener('pagehide', () => {
  clearInterval(vistaPoll); vistaPoll = null;
  vistaRead?.abort(); vistaRead = null;
  vistaController?.destroy(); vistaController = null;
});
// Back/forward restoration recreates a disposed viewer from a fresh projection.
// An unavailable Vista keeps its read-only poll, so enabling it can recover.
window.addEventListener('pageshow', startVistaPolling);
