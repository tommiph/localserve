/** Supervise IPC requests and cancellation for one local plugin process. */
import { fork } from 'node:child_process';

export class PluginRuntime {
  constructor(hostCall, failed) {
    this.hostCall = hostCall;
    this.failed = failed;
    this.pending = new Map();
    this.hostCalls = new Set();
    this.sequence = 0;
    this.stopping = false;
    this.child = fork(new URL('./plugin-worker.mjs', import.meta.url), [], {
      execPath: process.execPath, execArgv: [], windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    // On Windows a manually disconnected fork may never emit close. Exit proves
    // process termination; spawn errors also settle cleanup before any PID exists.
    this.exited = new Promise(resolve => {
      this.child.once('exit', resolve);
      this.child.once('error', resolve);
    });
    this.child.on('message', message => void this.receive(message));
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', () => this.fail(new Error('Plugin process exited; an in-flight outcome may be unknown.')));
  }

  fail(error) {
    if (this.error) return;
    this.error = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    if (!this.stopping) this.failed(error);
  }

  request(operation, values, context = {}, timeout = 10000) {
    if (this.error || !this.child.connected) return Promise.reject(this.error || new Error('Plugin process is unavailable.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        context.signal?.removeEventListener('abort', cancel);
        this.pending.delete(id);
      };
      const pending = {
        context,
        resolve: value => { cleanup(); resolve(value); },
        reject: error => { cleanup(); reject(error); },
      };
      const cancel = () => {
        if (this.child.connected) this.child.send({ type: 'cancel', id });
        // A cooperative action gets a short grace period. Killing an unresponsive
        // child ends its other requests too; no command is automatically retried.
        clearTimeout(timer);
        timer = setTimeout(() => {
          pending.reject(context.signal?.reason || new Error('Plugin request timed out; outcome unknown.'));
          this.child.kill();
        }, 1000);
      };
      this.pending.set(id, pending);
      if (timeout) timer = setTimeout(cancel, timeout);
      context.signal?.addEventListener('abort', cancel, { once: true });
      this.child.send({ type: 'request', id, operation, values }, error => {
        if (error) pending.reject(error);
      });
      if (context.signal?.aborted) cancel();
    });
  }

  async receive(message) {
    if (message.type === 'result') {
      const pending = this.pending.get(message.id);
      if (message.error) pending?.reject(new Error(message.error));
      else pending?.resolve(message.result);
    } else if (message.type === 'host') {
      let result, error;
      try {
        const pending = this.pending.get(message.requestId);
        if (!pending) throw new Error('Request is no longer active.');
        const operation = this.hostCall(message.operation, message.values, pending.context);
        this.hostCalls.add(operation);
        try { result = await operation; }
        finally { this.hostCalls.delete(operation); }
      } catch (failure) { error = failure.message; }
      if (this.child.connected) this.child.send({ type: 'host-result', id: message.id, result, error }, () => {});
    }
  }

  async close() {
    this.stopping = true;
    if (!this.error && this.child.connected) {
      try { await this.request('stop', {}, {}, 1000); } catch { /* Exit still releases the child. */ }
    }
    if (this.child.connected) this.child.disconnect();
    this.child.kill();
    await this.exited;
    // A killed child cannot undo a host write already awaiting disk. Drain those
    // writes before the server releases its folder lock or reports a clean stop.
    await Promise.allSettled([...this.hostCalls]);
  }
}
