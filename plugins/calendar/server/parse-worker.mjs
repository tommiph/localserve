/** Disposable parsing boundary: no sockets, files, scripts or event effects. */
import { parentPort, workerData } from 'node:worker_threads';
import { parseCalendar } from './parser.mjs';
try { parentPort.postMessage({result:parseCalendar(workerData.text,workerData.now)}); }
catch { parentPort.postMessage({error:true}); }
