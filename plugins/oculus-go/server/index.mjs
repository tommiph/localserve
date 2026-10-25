/** Sormus Oculus Go diagnostics and explicit manual package management.
 * Validation/start only read this plugin's own protected credential file.
 */
import { connectAdb, targetAddress, validKey, keyFromSetting } from './adb.mjs';
import { createVault, helperReady } from './vault.mjs';
import { batteryReading, powerReading, activityReading, storageReading, thermalReading } from './readings.mjs';
import {fileURLToPath} from 'node:url';
import {ApkCatalog, installable} from './library.mjs';
import {protectedPackage} from './apk.mjs';

const rates = [0.25, 0.5, 1];
const configured = settings => targetAddress(settings?.address)
  && /^[A-Za-z0-9_-]{1,100}$/.test(settings?.serial || '')
  && rates.includes(settings?.['poll-minutes'] ?? 0.25);
export function createOculusAdapter({ vault = createVault(), credentialReady = helperReady,
  connect = connectAdb, now = Date.now, root = fileURLToPath(new URL('../../../', import.meta.url)), catalogFactory = (root, folder) => new ApkCatalog(root, folder) } = {}) {
  let settings = null, key = null, catalog = null;
  return {
    async validateConfiguration(values) {
      if (!configured(values) || !await credentialReady()) return false;
      if (values['adb-key']) return Boolean(keyFromSetting(values['adb-key']));
      try { return validKey(await vault.load()); } catch { return false; }
    },
    async start(values) {
      settings = structuredClone(values);
      key = values['adb-key'] ? keyFromSetting(values['adb-key']) : await vault.load();
      if (!configured(settings) || !validKey(key)) throw new Error('Configure Oculus Go Wi-Fi, serial and ADB authorization.');
      catalog = catalogFactory(root, settings['library-folder']);
    },
    async stop() { settings = null; key = null; catalog = null; },
    async execute(actionId, parameters, context) {
      if (actionId.startsWith('library-')) {
        if (!settings?.['library-enabled']) throw Error('Enable the APK library in Oculus Go Settings first.');
        const signal = context.signal; signal.throwIfAborted();
        let connection, opened;
        try {
          if (actionId === 'library-install') {
            await catalog.scan(signal); opened = await catalog.open(parameters.id); installable(opened.item);
          }
          await context.wait(0.001); signal.throwIfAborted();
          connection = await connect(settings.address, key, signal, {management: true});
          if ((await connection.read('identity')).trim() !== settings.serial) throw Error('The Wi-Fi target does not match the configured headset serial.');
          if (settings['adb-key']) await vault.save(key, signal);
          const installed = await connection.packages();
          if (actionId === 'library-inventory') return {packages: installed};
          const packageName = opened?.item.packageName || parameters.package;
          if (protectedPackage(packageName)) throw Error('This application is protected from library changes.');
          const before = await connection.packageInfo(packageName);
          if (before?.system || before && !installed.includes(packageName)) throw Error('Only ordinary user applications may be changed.');
          if (actionId === 'library-inspect') {
            if (!before || !installed.includes(packageName)) throw Error('This application is not installed as a user application.');
            return before;
          }
          if (actionId === 'library-install') {
            if (before && before.versionCode > opened.item.versionCode) throw Error('A newer version is already installed. Downgrades are not supported.');
            await context.wait(0.001); signal.throwIfAborted();
            await connection.install(opened.handle.createReadStream({autoClose: false, highWaterMark: 64 * 1024}), opened.item.size, () => context.wait(0.001));
            signal.throwIfAborted();
            const after = await connection.packageInfo(packageName);
            if (!after || after.versionCode !== opened.item.versionCode) throw Error('Installation returned, but the expected version could not be verified. Check the headset before retrying.');
            return {installed: true, packageName, versionCode: after.versionCode};
          }
          if (actionId === 'library-uninstall') {
            if (!before || !installed.includes(packageName)) throw Error('This application is not installed as a user application.');
            await context.wait(0.001); signal.throwIfAborted();
            await connection.uninstall(packageName);
            if ((await connection.packages()).includes(packageName)) throw Error('Removal returned, but the application is still reported installed.');
            return {uninstalled: true, packageName};
          }
          throw Error('Unknown library operation.');
        } finally { connection?.close(); await opened?.handle.close(); }
      }
      if (!['refresh', 'test-connection'].includes(actionId)) throw new Error('Unknown Oculus Go action.');
      context.signal.throwIfAborted();
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(20000)]);
      const previous = await context.readState(), received = {}, failures = [];
      let connection;
      try {
        connection = await connect(settings.address, key, signal);
        const serial = (await connection.read('identity')).trim();
        if (serial !== settings.serial) throw new Error('The Wi-Fi target does not match the configured headset serial.');
        if (settings['adb-key']) await vault.save(key, signal);
        if (actionId === 'test-connection') {
          signal.throwIfAborted();
          await context.log('Oculus Go connection and headset identity verified.', 'success');
          return {connected: true, message: 'Connected. The headset accepted its saved ADB key and its serial matches.'};
        }
        for (const [section, parse] of [['battery', batteryReading], ['power', powerReading],
          ['activity', activityReading], ['storage', storageReading], ['thermal', thermalReading]]) {
          try { Object.assign(received, parse(await connection.read(section))); }
          catch (error) { signal.throwIfAborted(); failures.push(section); }
        }
        signal.throwIfAborted();
        if (failures.length === 5) throw new Error('Headset diagnostics are unavailable.');
      } catch (error) {
        context.signal.throwIfAborted();
        if (signal.aborted) throw new Error('Oculus Go did not respond within 20 seconds. Check its Wi-Fi address and wireless ADB.');
        throw error;
      } finally { connection?.close(); }
      const sameTarget = previous['target-identity'] === `${settings.address}/${settings.serial}`;
      // Preserve failed sections only for the same physical target. A settings
      // change cannot attach one headset's old readings to another's identity.
      const receivedAt = now();
      const reading = { ...(sameTarget ? previous : {}), ...received,
        'connection-status': 'Connected', 'connection-type': 'Wi-Fi', 'address': settings.address,
        'received-at': receivedAt, 'details-status': failures.length ? `Partial · ${failures.join(', ')} unavailable; prior readings retained` : 'Current',
        'target-identity': `${settings.address}/${settings.serial}`,
        'controller-status': 'Not reported by Go firmware' };
      if (failures.includes('power')) reading['headset-state'] = 'Unknown';
      if (reading['headset-state'] === 'Standby') { reading['active-app'] = null; reading['active-package'] = null; }
      // A missing activity section cannot confirm that no app is playing.
      // Standby is independently reported by the power section.
      reading['active-app-display'] = reading['active-app'] ||
        (reading['headset-state'] === 'Standby' ||
          (!failures.includes('activity') && reading['headset-state'] === 'Awake') ? 'Not playing' : null);
      // Start a session only for a verified foreground package; a failed
      // activity read must not extend a stale app's elapsed-time claim.
      const packageName = !failures.includes('activity') && reading['headset-state'] === 'Awake' ? reading['active-package'] : null;
      const sameSession = packageName && sameTarget && previous['active-package'] === packageName
        && Number.isFinite(previous['foreground-minutes']) && Number.isFinite(previous['foreground-started-at']);
      reading['foreground-started-at'] = packageName ? sameSession ? previous['foreground-started-at'] : receivedAt : null;
      reading['foreground-minutes'] = packageName ? Math.round((receivedAt - reading['foreground-started-at']) / 60000 * 10) / 10 : null;
      const fingerprint = JSON.stringify([reading['headset-state'] || 'Unknown', reading['active-package'] || null]);
      const changed = sameTarget && previous['presence-fingerprint'] !== undefined && previous['presence-fingerprint'] !== fingerprint;
      reading['presence-fingerprint'] = fingerprint;
      reading['change-sequence'] = (Number.isSafeInteger(previous['change-sequence']) ? previous['change-sequence'] : 0) + (changed ? 1 : 0);
      // Commit transition claims before events. Restart never replays effects;
      // missing power/app sections do not claim an observed presence transition.
      const known = !failures.includes('power') && !failures.includes('activity') && reading['headset-state'] !== 'Unknown';
      if (!known) {
        reading['presence-fingerprint'] = sameTarget ? previous['presence-fingerprint'] : undefined;
        reading['change-sequence'] -= changed ? 1 : 0;
      }
      context.signal.throwIfAborted();
      await context.saveState(reading);
      await context.log(failures.length ? 'Oculus Go refreshed with unavailable diagnostic sections.' : 'Oculus Go diagnostics refreshed.', failures.length ? 'warning' : 'success');
      const payload = { ...(reading['headset-state'] && reading['headset-state'] !== 'Unknown' ? { state: reading['headset-state'] } : {}),
        ...(received['battery-percent'] === null || received['battery-percent'] === undefined ? {} : { battery: received['battery-percent'] }),
        ...(received.charging === null || received.charging === undefined ? {} : { charging: received.charging }),
        ...(received['active-package'] ? { package: reading['active-package'] || '' } : {}) };
      if (changed && known) await context.emit('headset-changed', { ...payload, 'change-id': String(reading['change-sequence']) });
      await context.emit('status-updated', payload);
      return { completed: true, partial: failures.length > 0 };
    },
  };
}
export default createOculusAdapter();
