/** Trusted local plugin code runs in a child, not in the HTTP process.
 * IPC scopes host services to a request; this is fault containment, not a sandbox.
 */
import { pathToFileURL } from 'node:url';

let adapter;
let sequence = 0;
const callbacks = new Map();
const controllers = new Map();

function send(message) {
  if (process.connected) process.send(message);
}

function hostCall(requestId, operation, values) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    callbacks.set(id, { resolve, reject });
    send({ type: 'host', id, requestId, operation, values });
  });
}

function context(requestId, signal, noticeUrl, lightingFadeSeconds) {
  return {
    signal,
    noticeUrl,
    lightingFadeSeconds,
    cloudRelay: values => hostCall(requestId,'cloud-relay',values),
    log: (message, level = 'info') => hostCall(requestId, 'log', { message, level }),
    emit: (eventId, payload = {}) => hostCall(requestId, 'event', { eventId, payload }),
    readState: () => hostCall(requestId, 'read-state', {}),
    saveState: value => hostCall(requestId, 'save-state', value),
    wait: seconds => hostCall(requestId, 'wait', { seconds }),
    openWebpageOnTv: pageId => hostCall(requestId, 'open-webpage-on-tv', {pageId}),
    captureNoticeReturn: appId => hostCall(requestId,'capture-notice-return',{appId}),
    closeLocalserveTv: () => hostCall(requestId,'close-localserve-tv',{}),
  };
}

async function handleRequest(message) {
  const controller = new AbortController();
  controllers.set(message.id, controller);
  try {
    let result;
    if (message.operation === 'load') {
      const module = await import(pathToFileURL(message.values.entry).href);
      adapter = module.default;
      if (!adapter || ['validateConfiguration', 'start', 'stop', 'execute'].some(name => typeof adapter[name] !== 'function')) {
        throw new Error('Plugin does not implement runtime API v1.');
      }
      result = await adapter.validateConfiguration(message.values.settings);
    } else if (message.operation === 'configure') {
      result = await adapter.validateConfiguration(message.values.settings);
    } else if (message.operation === 'start') {
      result = await adapter.start(message.values.settings);
    } else if (message.operation === 'stop') {
      result = await adapter.stop();
    } else if (message.operation === 'preview') {
      result = typeof adapter.preview === 'function' ? await adapter.preview() : null;
    } else if (message.operation === 'inspect') {
      if(typeof adapter.inspect!=='function')throw new Error('Plugin has no setup reader.');
      result=await adapter.inspect(message.values.operation,{signal:controller.signal});
    } else if (message.operation === 'suspend-preview') {
      result = typeof adapter.suspend === 'function' ? await adapter.suspend() : null;
    } else if (message.operation === 'execute') {
      result = await adapter.execute(message.values.actionId, message.values.parameters, context(message.id, controller.signal, message.values.noticeUrl, message.values.lightingFadeSeconds));
    } else if(message.operation==='notice-return') {
      if(typeof adapter.returnNotice!=='function')throw new Error('Notice return is unavailable.');
      result=await adapter.returnNotice(message.values,context(message.id,controller.signal));
    } else if (message.operation === 'ingest') {
      if (typeof adapter.ingest !== 'function') throw new Error('Plugin cannot receive native reports.');
      result = await adapter.ingest(message.values.packet, message.values.receivedAt, {...context(message.id, controller.signal),reportTransport:message.values.transport||'lan',relayTimeoutMs:message.values.relayTimeoutMs||0});
    } else throw new Error('Unknown runtime operation.');
    send({ type: 'result', id: message.id, result: result ?? null });
  } catch (error) {
    send({ type: 'result', id: message.id, error: String(error.message).slice(0, 1000) });
  } finally {
    controllers.delete(message.id);
  }
}

process.on('message', message => {
  if (message.type === 'host-result') {
    const callback = callbacks.get(message.id);
    if (!callback) return;
    callbacks.delete(message.id);
    if (message.error) callback.reject(new Error(message.error));
    else callback.resolve(message.result);
  } else if (message.type === 'cancel') {
    controllers.get(message.id)?.abort(new Error('Operation cancelled'));
  } else if (message.type === 'request') {
    // Cancellation and host replies must remain responsive while an action awaits.
    // The parent serializes actions and lifecycle transitions for each plugin.
    void handleRequest(message);
  }
});

process.on('disconnect', () => {
  // Never leave a child behind after its owning Localserve process disappears.
  for (const controller of controllers.values()) controller.abort();
  process.exit(0);
});
