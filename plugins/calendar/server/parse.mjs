import { Worker } from 'node:worker_threads';

/** A malicious recurrence must not block the plugin's cooperative cancellation.
 * Only this owned parser thread is terminated; no server/device process is hit. */
export async function expandCalendar(text, now, signal) {
  signal.throwIfAborted();
  const worker = new Worker(new URL('./parse-worker.mjs',import.meta.url),{
    workerData:{text,now},resourceLimits:{maxOldGenerationSizeMb:64,maxYoungGenerationSizeMb:16,stackSizeMb:2},execArgv:[],
  });
  let abort, timer;
  try {
    return await new Promise((resolve,reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort',abort,{once:true});
      timer = setTimeout(() => reject(new Error('Calendar parsing exceeded its three-second limit.')),3000);
      worker.once('message',message => message.error ? reject(new Error('Calendar feed is invalid or exceeds supported recurrence limits.')) : resolve(message.result));
      worker.once('error',() => reject(new Error('Calendar parser could not complete.')));
      worker.once('exit',code => { if (code !== 0) reject(new Error('Calendar parser stopped.')); });
      if (signal.aborted) abort();
    });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort',abort);
    await worker.terminate();
  }
}
