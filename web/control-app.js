/** Browser-owned installation; never install automatically or intercept fetch.
 * In particular, no worker/cache may retain capabilities or queue TV commands.
 * HTTP LAN browsers may offer a shortcut instead of a full installation. */
(() => {
  'use strict';
  const button = document.querySelector('#control-install');
  const standalone = window.matchMedia('(display-mode: standalone)');
  let pendingPrompt = null;

  function updateButton() {
    button.hidden = !pendingPrompt || standalone.matches;
  }

  window.addEventListener('beforeinstallprompt', event => {
    if (!document.querySelector('link[rel="manifest"]')) return;
    event.preventDefault();
    pendingPrompt = event;
    updateButton();
  });
  button.addEventListener('click', async () => {
    const prompt = pendingPrompt;
    if (!prompt) return;
    // Each browser prompt can be consumed once, including dismissal. A later
    // browser event can offer another; polling must not repeatedly ask users.
    pendingPrompt = null;
    updateButton();
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      document.querySelector('#controls-feedback').textContent = 'Use your browser menu to install this app or add it to your home screen.';
    }
  });
  window.addEventListener('appinstalled', () => {
    pendingPrompt = null;
    updateButton();
  });
  standalone.addEventListener('change', updateButton);
})();
