/** Localserve read-only Oculus Go diagnostics through the configured ADB peer.
 * Validation/start only read this plugin's own protected credential file.
 */
import { connectAdb, targetAddress, validKey, keyFromSetting } from './adb.mjs';
import { createVault, helperReady } from './vault.mjs';
import { batteryReading, powerReading, activityReading, storageReading, thermalReading } from './readings.mjs';

const rates = [0.25, 0.5, 1];
const configured = settings => targetAddress(settings?.address)
  && /^[A-Za-z0-9_-]{1,100}$/.test(settings?.serial || '')
  && rates.includes(settings?.['poll-minutes'] ?? 0.25);
export function createOculusAdapter({ vault = createVault(), credentialReady = helperReady,
  connect = connectAdb, now = Date.now } = {}) {
  let settings = null, key = null;
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
    },
    async stop() { settings = null; key = null; },
    async execute(actionId, parameters, context) {
      if (actionId !== 'refresh') throw new Error('Unknown Oculus Go action.');
      context.signal.throwIfAborted();
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(20000)]);
      const previous = await context.readState(), received = {}, failures = [];
      let connection;
      try {
        connection = await connect(settings.address, key, signal);
        const serial = (await connection.read('identity')).trim();
        if (serial !== settings.serial) throw new Error('The Wi-Fi target does not match the configured headset serial.');
        if (settings['adb-key']) await vault.save(key, signal);
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
