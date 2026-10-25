/** Sormus gateway reads and explicit supervised TRÅDFRI lighting actions.
 * Every action owns and closes its gateway session; no background observers.
 */
import { createVault, helperReady } from './vault.mjs';
import { createHash } from 'node:crypto';
import { localHost, validAuth, resourceId, withGateway, gatewayRead, boundedIds, parseAccessory, parseGroup, lightPayload, transitionTicks } from './client.mjs';
import { lightRows, publicReading, hexToHsv } from './readings.mjs';
const rates = [0.5, 1, 5];
export function createTradfriAdapter({ vault = createVault(), credentialReady = helperReady, gateway = withGateway, now = Date.now } = {}) {
  let settings, auth;
  return {
    async validateConfiguration(values) {
      try { transitionTicks(values?.['fade-seconds']); } catch { return false; }
      if (!localHost(values?.host) || !rates.includes(values?.['poll-minutes'] ?? 1) || !await credentialReady()) return false;
      if (typeof values['security-code'] === 'string' && values['security-code'].trim()) return true;
      try { return validAuth(await vault.load(), values.host); } catch { return false; }
    },
    async start(values) {
      transitionTicks(values['fade-seconds']);
      settings = structuredClone(values);
      try { auth = await vault.load(); } catch (error) { if (!values['security-code']) throw error; auth = null; }
    },
    async stop() { settings = null; auth = null; },
    async execute(actionId, parameters, context) {
      context.signal.throwIfAborted();
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(20000)]);
      let result;
      try {
        result = await gateway(settings.host, signal, async client => {
          const code = settings['security-code'], codeHash = code ? createHash('sha256').update(code).digest('hex') : null;
          if (actionId === 'reconnect' && !code) throw new Error('Enter the gateway security code before explicit reauthentication.');
          if (code && (actionId === 'reconnect' || !validAuth(auth, settings.host) || auth.codeHash !== codeHash)) {
            // Only an explicitly configured replacement code creates credentials.
            // Persist the derived PSK before any later reads or control effects.
            await context.wait(0.01);
            signal.throwIfAborted();
            const created = await client.authenticate(settings['security-code']);
            signal.throwIfAborted();
            auth = { host: settings.host, identity: created.identity, psk: created.psk, codeHash };
            if (!validAuth(auth, settings.host)) throw new Error('Gateway authentication failed.');
            await vault.save(auth, signal);
          }
          if (!validAuth(auth, settings.host)) throw new Error('Gateway credentials are unavailable.');
          await client.connect(auth.identity, auth.psk);
          signal.throwIfAborted();
          if (actionId === 'reconnect') return { authenticated: true };
          if (actionId === 'refresh') {
            const devices = [], groups = [];
            for (const id of boundedIds(await gatewayRead(client, '15001'))) {
              signal.throwIfAborted(); devices.push(parseAccessory(await gatewayRead(client, '15001/' + id)));
            }
            for (const id of boundedIds(await gatewayRead(client, '15004'))) {
              signal.throwIfAborted(); groups.push(parseGroup(await gatewayRead(client, '15004/' + id)));
            }
            return { devices, groups };
          }
          const id = parameters.id;
          if (!resourceId(id)) throw new Error('Enter a reported light or group ID.');
          const groupAction = actionId.startsWith('group-');
          const path = (groupAction ? '15004/' : '15001/') + id;
          const raw = await gatewayRead(client, path);
          let payload;
          if (groupAction) {
            if (!['group-power', 'group-brightness'].includes(actionId)) throw new Error('Unknown TRÅDFRI action.');
            if (actionId === 'group-power' && typeof parameters.on !== 'boolean') throw new Error('Choose group power on or off.');
            if (actionId === 'group-brightness' && (!Number.isFinite(parameters.value) || parameters.value < 0 || parameters.value > 100)) throw new Error('Brightness must be 0–100.');
            payload = actionId === 'group-power'
              ? { 5850: parameters.on ? 1 : 0 }
              : { 5851: Math.round(parameters.value * 254 / 100), 5712: transitionTicks(settings['fade-seconds']) };
          } else {
            const device = parseAccessory(raw), light = device.lightList?.[0];
            if (String(device.instanceId) !== id || device.type !== 2 || !light || device.alive === false) throw new Error('The selected light is missing or unreachable.');
            let operation;
            if (actionId === 'light-state') {
              const percentage = value => Number.isFinite(value) && value >= 0 && value <= 100;
              if (typeof parameters.on !== 'boolean' || !percentage(parameters.brightness)) throw new Error('Unsupported lighting state.');
              operation = { onOff: parameters.on, dimmer: parameters.brightness };
              if (parameters.temperature !== undefined) {
                if (light.spectrum !== 'white' || !percentage(parameters.temperature)) throw new Error('This light does not support the captured white temperature.');
                operation.colorTemperature = parameters.temperature;
              }
              if (parameters.hue !== undefined || parameters.saturation !== undefined) {
                if (light.spectrum !== 'rgb' || !Number.isFinite(parameters.hue) || parameters.hue < 0 || parameters.hue > 360 || !percentage(parameters.saturation)) throw new Error('This light does not support the captured colour.');
                operation.hue = parameters.hue; operation.saturation = parameters.saturation;
              }
              // Serialize one combined update per bulb. In particular a captured
              // Off bulb never receives a separate dimmer write that could light it.
            } else if (actionId === 'light-power' && typeof parameters.on === 'boolean') operation = { onOff: parameters.on };
            else if (['light-brightness', 'light-temperature'].includes(actionId) && Number.isFinite(parameters.value) && parameters.value >= 0 && parameters.value <= 100) {
              if (actionId === 'light-temperature' && light.spectrum !== 'white') throw new Error('This light does not support white temperature.');
              operation = actionId === 'light-brightness' ? { dimmer: parameters.value } : { colorTemperature: parameters.value };
            } else if (actionId === 'light-color' && /^#[0-9a-f]{6}$/i.test(parameters.color || '')) {
              if (light.spectrum !== 'rgb') throw new Error('This light does not support color.');
              operation = hexToHsv(parameters.color);
            } else throw new Error('Unsupported lighting action or value.');
            // The gateway owns the fade after acknowledgement. Do not wait for
            // its duration, extend the action deadline or infer completed state.
            const fade = actionId === 'light-state' && context.lightingFadeSeconds !== undefined
              ? context.lightingFadeSeconds : settings['fade-seconds'];
            payload = lightPayload(device, operation, fade);
            if (actionId === 'light-state') {
              // Differential serialization omits unchanged power. Include power
              // explicitly even when already Off: a dimmer-only gateway PUT can
              // otherwise illuminate a bulb while restoring its saved settings.
              payload['3311'] ||= [{ '9003': light.instanceId }];
              payload['3311'][0]['5850'] = parameters.on ? 1 : 0;
            }
          }
          signal.throwIfAborted();
          if (!Object.keys(payload).length) return { commandSent: false };
          // Pause/cancellation can arrive while the preceding read is pending.
          // Re-enter the host's cooperative gate before the single device write.
          await context.wait(0.01);
          signal.throwIfAborted();
          const response = await client.request(path, 'put', payload);
          signal.throwIfAborted();
          if (!/^2\./.test(response.code)) throw new Error('The gateway rejected the command.');
          return { commandSent: true };
        });
      } catch (error) {
        context.signal.throwIfAborted();
        if (signal.aborted) throw new Error('TRÅDFRI did not respond within 20 seconds; any sent command may have an uncertain effect.');
        // Third-party diagnostics may echo credential/raw payloads. Keep only
        // our fixed domain errors; other failures become a categorical message.
        if (/^(Enter |Choose |Brightness |This light |The selected |Unsupported lighting |Unknown TRÅDFRI |The gateway rejected |Gateway response exceeds|The gateway resource list)/.test(error.message)) throw error;
        throw new Error('TRÅDFRI connection or request failed. Check gateway availability and credentials.');
      }
      context.signal.throwIfAborted();
      if (actionId === 'reconnect') {
        await context.log('Gateway credentials were protected and the connection verified. Clear the security-code setting.', 'success');
        return { completed: true };
      }
      if (actionId !== 'refresh') {
        await context.log(result.commandSent ? 'Lighting command acknowledged; a later refresh reports actual state.' : 'Lighting already matched the requested value.', 'info');
        return result;
      }
      const lights = lightRows(result.devices, result.groups), previous = await context.readState();
      const baseline = previous['gateway-host'] === settings.host ? previous['light-baseline'] || {} : {};
      let sequence = Number.isSafeInteger(previous.sequence) ? previous.sequence : 0;
      const changes = [], nextBaseline = {};
      for (const light of lights) {
        const current = [light.on, light.brightness, light.reachable, light.temperature, light.hue, light.saturation];
        const old = Array.isArray(baseline[light.id]) ? baseline[light.id] : [];
        nextBaseline[light.id] = current.map((value, index) => value ?? old[index] ?? null);
        // Missing individual properties retain their known baseline. Restoring
        // the same reported value cannot invent another light transition.
        if (current.some((value, index) => value !== null && old[index] != null && value !== old[index])) {
          changes.push({ id: light.id, name: light.name || light.id, 'change-id': String(++sequence),
            ...(light.on === null ? {} : { on: light.on }), ...(light.brightness === null ? {} : { brightness: light.brightness }),
            ...(light.reachable === null ? {} : { reachable: light.reachable }) });
        }
      }
      // Save the whole observed snapshot and occurrence claims before dispatch.
      // A crash can lose an event; restart never replays a device/control effect.
      const reading = { ...publicReading(lights, result.groups, now()), 'gateway-host': settings.host, 'light-baseline': nextBaseline, sequence };
      await context.saveState(reading);
      await context.log(`TRÅDFRI refreshed: ${lights.length} lights, ${result.groups.length} groups.`, 'success');
      for (const payload of changes) await context.emit('light-changed', payload);
      await context.emit('status-updated', { 'light-count': lights.length,
        ...(reading['lights-on'] === null ? {} : { 'lights-on': reading['lights-on'] }) });
      return { completed: true };
    },
  };
}
export default createTradfriAdapter();
