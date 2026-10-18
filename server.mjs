/** Localserve backbone: local/LAN HTTP, persistent settings/Tasks, plugin
 * declarations, supervised runtimes and cooperative Task/Control execution.
 * Device capabilities are scoped by their installed trusted declarations.
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { JsonStore, ActivityLog, HttpError } from './server/storage.mjs';
import { PluginRegistry } from './server/plugins.mjs';
import { TaskEngine, builtInActions, validateTask } from './server/tasks.mjs';
import { glyphs } from './server/plugin-schema.mjs';
import { VistaStore } from './server/vistas.mjs';
import { UniverseStore } from './server/universe.mjs';
import { GamesStore,requireMazeDisplay } from './server/games.mjs';
import { SensorIngress } from './server/sensor-ingress.mjs';
import {phoneDisplay} from './server/phone-display.mjs';
import { ControlsStore } from './server/controls.mjs';
import { readCardAsset } from './server/card-templates.mjs';
import { attachTrayControl } from './server/tray-control.mjs';
import { validateListen, requestOrigin, isPrivateIPv4 } from './server/network.mjs';
import { TvNotices } from './server/tv-notices.mjs';
import { defaultDoNotDisturb, validateDoNotDisturb, doNotDisturbStatus } from './server/do-not-disturb.mjs';
import {localDisplayPath, requireLocalDisplay} from './server/local-pages.mjs';
import { controlAppManifest, controlAppHead } from './server/control-apps.mjs';

export const defaultConfig = { name: 'Localserve', version: '0.2.0', theme: 'dark', fontScale: 100, vistaFontScale: 100, timeFormat: '24', location: null, activityRetentionDays: 30,
  doNotDisturb: defaultDoNotDisturb, listen: { host: '127.0.0.1', port: 0 }, maxConcurrentRuns: 8 };
const contentTypes = { '.mp3':'audio/mpeg', '.ogg':'audio/ogg', '.m4a':'audio/mp4', '.wav': 'audio/wav', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png', '.webp': 'image/webp' };

function validateConfig(value) {
  // Validate persisted settings at startup and merged settings on each save.
  // The API separately rejects keys outside the editable settings allowlist.
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 64 || /[\u0000-\u001f]/.test(value.name)) throw new HttpError(400, 'Enter a server name between 1 and 64 characters.');
  if (!['12', '24'].includes(value.timeFormat)) throw new HttpError(400, 'Choose 12-hour or 24-hour time.');
  validateDoNotDisturb(value.doNotDisturb);
  if (!Number.isInteger(value.activityRetentionDays) || value.activityRetentionDays < 1 || value.activityRetentionDays > 3650) throw new HttpError(400, 'Keep Activity logs for 1 to 3650 whole days.');
  // Null means unconfigured, while zero is a valid coordinate. Never substitute
  // a guessed location for missing values or change the server's timezone.
  if (value.location !== null && (!value.location || Array.isArray(value.location)
    || Object.keys(value.location).some(key => !['latitude', 'longitude'].includes(key))
    || !Number.isFinite(value.location.latitude) || Math.abs(value.location.latitude) > 90
    || !Number.isFinite(value.location.longitude) || Math.abs(value.location.longitude) > 180)) {
    throw new HttpError(400, 'Enter latitude from −90 to 90 and longitude from −180 to 180, or clear both coordinates.');
  }
  if (!['light', 'dark'].includes(value.theme) || !Number.isInteger(value.fontScale) || value.fontScale < 80 || value.fontScale > 130 || value.fontScale % 5) throw new HttpError(400, 'Choose a valid theme and font size.');
  if (!Number.isInteger(value.vistaFontScale) || value.vistaFontScale < 80 || value.vistaFontScale > 130 || value.vistaFontScale % 5) throw new HttpError(400, 'Choose a Vista font size from 80% to 130% in 5% steps.');
  validateListen(value.listen);
  if (!Number.isInteger(value.maxConcurrentRuns) || value.maxConcurrentRuns < 1 || value.maxConcurrentRuns > 100) throw new HttpError(400, 'Concurrent runs must be between 1 and 100.');
  return { ...value, name: value.name.trim() };
}

async function readBody(request) {
  // Bound memory used by incoming JSON; API operations accept objects only.
  if (!request.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'JSON is required.');
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 512 * 1024) throw new HttpError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON object required');
    return value;
  }
  catch { throw new HttpError(400, 'Invalid JSON.'); }
}

export async function createLocalserve(root, options = {}) {
  // The CLI derives root from this source file. Tests pass a separate temporary
  // root and can disable automatic timers without accessing the live instance.
  const dataDirectory = path.join(root, 'data');
  await fs.mkdir(dataDirectory, { recursive: true });
  const realRoot = await fs.realpath(root), realData = await fs.realpath(dataDirectory);
  if (!realData.startsWith(realRoot + path.sep)) throw new Error('data/ must remain inside Localserve.');
  const lockFile = path.join(dataDirectory, 'server.lock');
  let lock;
  // Exclusive creation reserves this data folder before any stores are loaded.
  // Never inspect or terminate another process to resolve a lock conflict.
  try { lock = await fs.open(lockFile, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Localserve is already running, or its last stop was interrupted. See README: server.lock recovery.');
    throw error;
  }
  async function releaseLock() { await lock.close(); await fs.rm(lockFile, { force: true }); }
  let server, lanServer, registry;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: Date.now() }) + '\n');
    const config = await new JsonStore(path.join(root, 'config.json'), defaultConfig).load();
    // Scheduling and timestamps use the process's system timezone. Discard an
    // unsupported saved override without resetting other server preferences.
    if (Object.hasOwn(config.snapshot(), 'timezone')) {
      await config.update(current => { delete current.timezone; });
    }
    // A missing time format defaults to 24-hour display without changing schedules.
    if (!Object.hasOwn(config.snapshot(), 'timeFormat')) {
      await config.update(current => { current.timeFormat = '24'; });
    }
    if (!Object.hasOwn(config.snapshot(), 'location')) {
      await config.update(current => { current.location = null; });
    }
    if (!Object.hasOwn(config.snapshot(), 'activityRetentionDays')) {
      await config.update(current => { current.activityRetentionDays = defaultConfig.activityRetentionDays; });
    }
    if (!Object.hasOwn(config.snapshot(), 'vistaFontScale')) {
      // Seed a missing Vista scale from the administrator scale, then save it independently.
      await config.update(current => { current.vistaFontScale = current.fontScale; });
    }
    if (!Object.hasOwn(config.snapshot(), 'doNotDisturb')) {
      // Missing quiet-hour preferences default off to avoid suppressing Tasks.
      await config.update(current => { current.doNotDisturb = structuredClone(defaultDoNotDisturb); });
    }
    validateConfig(config.snapshot());
    const tasks = await new JsonStore(path.join(root, 'data/tasks.json'), []).load();
    // Rules use Server location, not per-rule coordinates. Discard unsupported
    // overrides without inferring a global location, and advance changed Task
    // revisions so a stale editor cannot restore those fields.
    if (tasks.snapshot().some(task => task.starts.some(rule => Object.hasOwn(rule, 'latitude') || Object.hasOwn(rule, 'longitude')))) {
      await tasks.update(items => {
        for (const task of items) {
          let changed = false;
          for (const rule of task.starts) {
            if (Object.hasOwn(rule, 'latitude') || Object.hasOwn(rule, 'longitude')) {
              delete rule.latitude;
              delete rule.longitude;
              changed = true;
            }
          }
          if (changed) task.revision += 1;
        }
      });
    }
    const state = await new JsonStore(path.join(root, 'data/state.json'), { paused: false, plugins: {}, runs: [], claims: [] }).load();
    const activity = await new ActivityLog(path.join(root, 'data/activity.jsonl'), 2000,
      { retentionDays: () => config.snapshot().activityRetentionDays }).load();
    registry = new PluginRegistry(path.join(root, 'plugins'), state, activity, config);
    const notices = await new TvNotices(root, config, () => server?.address()).load();
    registry.notices = notices;
    const engine = new TaskEngine(tasks, state, config, registry, activity);
    registry.attachEngine(engine);
    const sensorIngress = new SensorIngress(registry);
    // Compatible runtime declarations load trusted code in supervised children.
    // Recovery never replays unfinished effects or plugin events.
    await registry.discover();
    await engine.recover();
    const vistas = await new VistaStore(root, registry, config, activity).load();
    const universe = await new UniverseStore(root, registry, config, activity).load();
    registry.universe = universe;
    const games = await new GamesStore(root,registry,activity).load();
    const controls = await new ControlsStore(root, registry, config, activity).load();
    registry.controls = controls;
    engine.vistas = vistas;
    const token = randomBytes(32).toString('hex');
    let origin, closing = false, discoveryBusy = false, closePromise;
    const startedAt = Date.now();
    let retentionQueue = Promise.resolve(), retentionBusy = false;
    function cleanupActivity(force = false) {
      // Include disabled plugins. Use each owner's queue and contain failures to
      // the affected file; retention failure must not stop device/runtime work.
      const operation = retentionQueue.then(async () => {
        retentionBusy = true;
        try {
          const logs = [activity, ...Array.from(registry.records.values(), record => record.log)];
          const results = await Promise.allSettled(logs.map(log => log.prune(force)));
          await notices.expire();
          for (const result of results) if (result.status === 'rejected') console.error('Activity retention:', result.reason.message);
        } finally { retentionBusy = false; }
      });
      retentionQueue = operation.catch(error => console.error('Activity retention:', error.message));
      return retentionQueue;
    }
    const json = (response, code, body) => { response.writeHead(code, { 'Content-Type': contentTypes['.json'] }); response.end(JSON.stringify(body)); };

    function snapshot(browserAddress = origin) {
      // CPU and memory refer only to this process. CPU is an average since process
      // startup, not a sampled host load. Active step positions overlay history;
      // the run definition and final status remain separate from editable Tasks.
      const cpu = process.cpuUsage(), seconds = Math.max(process.uptime(), 0.001);
      return { config: config.snapshot(), games:games.admin(), universe: universe.snapshot(), paused: engine.gate.paused, services: registry.services(), controls: controls.admin(), tasks: tasks.snapshot(), vistas: vistas.snapshot(), vistaDisplay: vistas.displaySnapshot(),
        taskActions: [...builtInActions, ...registry.actions()], activity: activity.latest(),
        taskEvents: registry.events(), pluginGlyphs: glyphs, tvNotice: notices.admin(),
        doNotDisturb: doNotDisturbStatus(config.snapshot().doNotDisturb),
        runs: state.snapshot().runs.map(run => ({ ...run, step: engine.active.get(run.id)?.step || run.step })),
        server: { startedAt, uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), address: browserAddress,
          now: Date.now(),
          // A derived clock detail lets the browser display server time even if
          // its own system timezone differs. This is not an editable preference.
          timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
          cpuPercent: Math.round((cpu.user + cpu.system) / (seconds * 10000) * 10) / 10,
          memoryBytes: process.memoryUsage().rss, runningTasks: engine.active.size, discoveryErrors: registry.errors }, token };
    }

    server = http.createServer(async (request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src http: https:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
      try {
        if (closing) throw new HttpError(503, 'Server is stopping.');
        // LAN and localhost each keep their own exact Host/Origin pairing.
        // Tokens/capabilities still guard writes; this is not account authentication.
        const browserOrigin = requestOrigin(request, server.address().port);
        const url = new URL(request.url, browserOrigin);
        const noticeApi = /^\/api\/tv-notices\/([a-f0-9]{48})$/.exec(url.pathname);
        if (noticeApi) {
          // The unguessable per-notice URL grants only its bounded text and
          // reception lifecycle. It cannot run Tasks or issue device commands.
          response.setHeader('Referrer-Policy', 'no-referrer');
          if (request.method === 'GET') return json(response, 200, notices.view(noticeApi[1]));
          if (request.method !== 'POST' || request.headers.origin !== browserOrigin) throw new HttpError(403, 'Use this notice page’s server address.');
          const values = await readBody(request);
          if (Object.keys(values).length !== 1) throw new HttpError(400, 'Invalid notice reception.');
          return json(response, 200, await notices.report(noticeApi[1], values.status));
        }
        if (url.pathname === '/api/sensors/report') {
          if (url.search) throw new HttpError(400,'Sensor reports do not accept query parameters.');
          return json(response,200,await sensorIngress.receive(request));
        }
        if (request.method === 'GET' && url.pathname === '/api/control-view') return json(response, 200, controls.index());
        const controlView = /^\/api\/control-view\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\/(run|cancel|scene))?$/.exec(url.pathname);
        if (controlView) {
          const [, pluginId, slug, operation] = controlView;
          if (request.method === 'GET' && !operation) return json(response, 200, controls.viewer(pluginId, slug));
          if (request.method !== 'POST' || !operation) throw new HttpError(405, 'Method not allowed.');
          if (request.headers.origin !== browserOrigin) throw new HttpError(403, 'Use this Control page’s server address.');
          const values = await readBody(request), capability = request.headers['x-localserve-control-token'];
          const result = operation === 'run' ? await controls.invoke(pluginId, slug, capability, values)
            : operation === 'scene' ? await controls.scene(pluginId, slug, capability, values) : controls.cancel(pluginId, slug, capability, values);
          return json(response, operation === 'run' ? 202 : 200, result);
        }
        if (request.method === 'GET' && url.pathname === '/api/display') return json(response, 200, vistas.displayViewer());
        if (request.method === 'GET' && url.pathname === '/api/universe') return json(response, 200, universe.viewer());
        if (request.method === 'GET' && url.pathname === '/api/games/maze') return json(response,200,games.viewer());
        if (request.method === 'GET' && url.pathname === '/api/phone-information') {
          const devices=url.searchParams.getAll('device');
          if([...url.searchParams.keys()].some(key=>key!=='device')||devices.length>1
            || devices.length && !/^[a-zA-Z0-9-]{1,64}$/.test(devices[0])) throw new HttpError(400,'Choose a phone.');
          return json(response,200,phoneDisplay(registry,config,devices[0]||null,sensorIngress.display));
        }
        const viewerApi = /^\/api\/vistas\/([a-z0-9-]+)$/.exec(url.pathname);
        if (request.method === 'GET' && viewerApi) return json(response, 200, vistas.viewer(viewerApi[1]));
        if (url.pathname.startsWith('/api/')) {
          if (request.method === 'GET' && url.pathname === '/api/state') return json(response, 200, snapshot(browserOrigin));
          if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
          if (request.headers.origin !== browserOrigin || request.headers['x-localserve-token'] !== token) throw new HttpError(403, 'Refresh this administration page before making changes.');
          const values = await readBody(request);
          if (url.pathname === '/api/games/maze') {
            await games.save(values);
          } else if (url.pathname === '/api/games/maze/open-on-tv') {
            if(Object.keys(values).length!==1||!Number.isSafeInteger(values.revision))throw new HttpError(400,'Use the current game settings revision.');
            const controller=new AbortController();
            const cancelled=()=>{if(!response.writableEnded)controller.abort(new Error('Client disconnected'));};
            response.once('close',cancelled);
            try{return json(response,200,await games.openOnTv(values.revision,controller.signal));}
            finally{response.removeListener('close',cancelled);}
          } else if (url.pathname === '/api/universe') {
            await universe.save(values);
          } else if (url.pathname === '/api/config') {
            const permitted = ['name', 'theme', 'fontScale', 'vistaFontScale', 'timeFormat', 'location', 'listen', 'maxConcurrentRuns', 'activityRetentionDays', 'doNotDisturb'];
            if (!values || Object.keys(values).some(key => !permitted.includes(key))) throw new HttpError(400, 'Unknown setting.');
            await config.update(current => Object.assign(current, validateConfig({ ...current, ...values })));
            if (Object.hasOwn(values, 'activityRetentionDays')) await cleanupActivity(true);
            await activity.add('Server settings updated');
          } else if (url.pathname === '/api/tv-notices/dismiss') {
            if (Object.keys(values).some(key => key !== 'revision')) throw new HttpError(400, 'Invalid notice dismissal.');
            await notices.dismiss(values.revision);
            await activity.add('TV notice dismissed from administrator.');
          } else if (url.pathname === '/api/display') {
            if (Object.keys(values).some(key => !['vistaId', 'revision'].includes(key)) || !Number.isSafeInteger(values.revision)) throw new HttpError(400, 'Choose a Vista using the current display revision.');
            await vistas.show(values.vistaId, { revision: values.revision });
            await activity.add(`Display Vista selected: ${vistas.snapshot().find(vista => vista.id === values.vistaId)?.name}`);
          } else if (/^\/api\/vistas(?:\/[^/]+(?:\/(?:enabled|delete))?)?$/.test(url.pathname)) {
            const [, , , id, operation] = url.pathname.split('/');
            await vistas.save(values, id || null, operation || null);
          } else if (url.pathname === '/api/pause') {
            if (typeof values.paused !== 'boolean') throw new HttpError(400, 'Paused must be true or false.');
            await engine.setPaused(values.paused);
          } else if (url.pathname === '/api/plugins/refresh') await registry.discover();
          else if (/^\/api\/plugins\/[^/]+\/controls(?:\/[^/]+(?:\/(?:enabled|delete))?)?$/.test(url.pathname)) {
            const [, , , pluginId, , pageId, operation] = url.pathname.split('/');
            await controls.save(pluginId, values, pageId || null, operation || null);
          }
          else if (/^\/api\/plugins\/[^/]+\/cards(?:\/[^/]+(?:\/(?:enabled|delete))?)?$/.test(url.pathname)) {
            const [, , , pluginId, , cardId, operation] = url.pathname.split('/');
            if (operation) await registry.changeCard(pluginId, cardId, operation, values);
            else await registry.saveCard(pluginId, values, cardId || null);
          }
          else if (/^\/api\/plugins\/[^/]+\/config$/.test(url.pathname)) {
            const id = url.pathname.split('/')[3];
            await registry.saveConfiguration(id, values);
          } else if (/^\/api\/plugins\/[^/]+\/actions\/[^/]+$/.test(url.pathname)) {
            const [, , , id, , actionId] = url.pathname.split('/');
            if (Object.keys(values).some(key => !['parameters', 'revision'].includes(key))) throw new HttpError(400, 'Unknown action field.');
            if (values.revision !== undefined && (!Number.isSafeInteger(values.revision) || values.revision < 1)
              || id === 'webpage' && actionId === 'open-on-tv' && values.revision === undefined) throw new HttpError(400, 'Run this action using the current plugin settings revision.');
            const controller = new AbortController();
            const cancelled = () => { if (!response.writableEnded) controller.abort(new Error('Client disconnected')); };
            response.once('close', cancelled);
            try {
              const result = await registry.execute(id, actionId, values.parameters || {}, {signal: controller.signal, configRevision: values.revision});
              return json(response, 200, { result, ...snapshot(browserOrigin) });
            } catch (error) {
              if (!error.status) error.status = 409;
              throw error;
            } finally { response.removeListener('close', cancelled); }
          }
          else if (url.pathname === '/api/tasks') {
            const task = validateTask(values, null, registry.actions(), registry.events(), vistas.snapshot());
            await tasks.update(items => {
              if (items.some(item => item.name.toLowerCase() === task.name.toLowerCase())) throw new HttpError(409, 'A Task with this name already exists.');
              items.push(task);
            });
            await engine.syncRuleClocks();
            await activity.add(`Task created: ${task.name}`, { taskId: task.id });
          } else {
            const match = /^\/api\/(tasks|runs|plugins)\/([^/]+)(?:\/(run|rerun|cancel|delete|enabled))?$/.exec(url.pathname);
            if (!match) throw new HttpError(404, 'Operation not found.');
            const [, collection, id, operation] = match;
            if (collection === 'tasks' && operation === 'run') {
              if (!values || Object.keys(values).some(key => !['revision', 'eventRunId'].includes(key))
                || values.revision !== undefined && !Number.isSafeInteger(values.revision)
                || values.eventRunId !== undefined && (typeof values.eventRunId !== 'string' || values.eventRunId.length > 80 || !values.eventRunId)) throw new HttpError(400, 'Choose saved Event values and a current Task revision.');
              return json(response, 202, {run: await engine.manualStart(id, values)});
            }
            if (collection === 'runs' && operation === 'rerun') {
              if (!values || Object.keys(values).some(key => key !== 'revision') || !Number.isSafeInteger(values.revision)) throw new HttpError(400, 'Use the current Task revision to rerun.');
              return json(response, 202, {run: await engine.rerun(id, values)});
            }
            if (collection === 'runs' && operation === 'cancel') engine.cancel(id);
            else if (collection === 'plugins' && operation === 'enabled') {
              if (typeof values.enabled !== 'boolean') throw new HttpError(400, 'Enabled must be true or false.');
              await registry.saveConfiguration(id, { revision: values.revision, enabled: values.enabled });
            } else if (collection === 'tasks' && [undefined, 'delete', 'enabled'].includes(operation)) {
              let taskName, disabled = false;
              await tasks.update(items => {
                const index = items.findIndex(item => item.id === id);
                if (index < 0) throw new HttpError(404, 'Task not found.');
                const old = items[index]; taskName = old.name;
                // Compare revisions inside the write queue so two editors cannot
                // silently overwrite each other's changes from the same snapshot.
                if (values.revision !== old.revision) throw new HttpError(409, 'This Task changed. Close and reopen its editor before saving.');
                if (operation === 'delete') { items.splice(index, 1); disabled = true; }
                else if (operation === 'enabled') {
                  if (typeof values.enabled !== 'boolean') throw new HttpError(400, 'Enabled must be true or false.');
                  old.enabled = values.enabled; old.revision += 1; disabled = !old.enabled;
                } else {
                  const task = validateTask(values, old, registry.actions(), registry.events(), vistas.snapshot());
                  if (items.some(item => item.id !== id && item.name.toLowerCase() === task.name.toLowerCase())) throw new HttpError(409, 'A Task with this name already exists.');
                  items[index] = task; disabled = !task.enabled;
                }
              });
              // Cancel only after disabling/deleting has been committed to disk.
              if (disabled) engine.cancelTask(id);
              await engine.syncRuleClocks();
              await activity.add(`Task ${operation === 'delete' ? 'deleted' : 'updated'}: ${taskName}`, { taskId: id });
            } else throw new HttpError(404, 'Operation not found.');
          }
          await controls.sync();
          return json(response, 200, snapshot(browserOrigin));
        }
        if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, 'Method not allowed.');
        const cardAsset = /^\/plugin-card-assets\/([a-z0-9-]+)\/([a-z0-9-]+)\/([a-z0-9/.\-]+)$/.exec(url.pathname);
        if (cardAsset) {
          const asset = await readCardAsset(root, registry, cardAsset[1], cardAsset[2], cardAsset[3]);
          // Only declared package artwork is frameable. No child scripts,
          // network requests, forms or navigation are needed by fixed designs.
          // The Tizen wrapper is a file-origin ancestor above the HTTP Vista.
          // CSP checks every ancestor, so self alone blocks the nested Card.
          // Admit file ancestors for these public, inert HTML designs only;
          // administrator/Controls policies and private-file routes stay scoped.
          const cardAncestors = asset.extension === '.html' ? "'self' file:" : "'self'";
          response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; script-src 'none'; connect-src 'none'; frame-ancestors " + cardAncestors + "; base-uri 'none'; form-action 'none'");
          response.writeHead(200, { 'Content-Type': contentTypes[asset.extension] });
          return response.end(request.method === 'HEAD' ? undefined : asset.content);
        }
        const controlManifest = /^\/controls\/([a-z0-9-]+)\/([a-z0-9-]+)\/app\.webmanifest$/.exec(url.pathname);
        if (url.pathname === '/downloads/localserve-sensors.apk') {
          if (!['GET','HEAD'].includes(request.method) || url.search) throw new HttpError(405,'Use the Android download link.');
          if (registry.get('sensors').plugin.runtime?.ingest !== 'sensors-v1') throw new HttpError(404,'Sensors app unavailable.');
          const realRoot=await fs.realpath(root);
          let apk,stat,realPlugin,realDist;
          try {
            realPlugin=await fs.realpath(path.join(root,'plugins/sensors'));
            realDist=await fs.realpath(path.join(realPlugin,'android/dist'));
            apk=await fs.realpath(path.join(realDist,'localserve-sensors.apk'));stat=await fs.stat(apk);
          }
          catch {throw new HttpError(404,'Sensors app unavailable. Build the Android APK first.');}
          if (!realPlugin.startsWith(realRoot+path.sep) || !realDist.startsWith(realPlugin+path.sep) || !apk.startsWith(realDist+path.sep)
            || !stat.isFile() || stat.size>16*1024*1024) throw new HttpError(404,'Sensors app unavailable.');
          response.writeHead(200,{'Content-Type':'application/vnd.android.package-archive','Content-Length':stat.size,'Content-Disposition':'attachment; filename="localserve-sensors.apk"'});
          return response.end(request.method==='HEAD'?undefined:await fs.readFile(apk));
        }
        if (controlManifest) {
          if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, 'Method not allowed.');
          const manifest = controlAppManifest(controls.resolve(controlManifest[1], controlManifest[2]), config.snapshot().name);
          if (!manifest) throw new HttpError(404, 'Control app unavailable.');
          response.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8' });
          return response.end(request.method === 'HEAD' ? undefined : JSON.stringify(manifest));
        }
        const viewerPage = /^\/vistas\/([a-z0-9-]+)$/.exec(url.pathname);
        const gamePage = url.pathname === '/games/maze';
        if(gamePage){if(url.search)throw new HttpError(400,'Game URLs do not accept parameters.');games.viewer();await requireMazeDisplay(root);}
        const noticePage = /^\/tv-notices\/([a-f0-9]{48})$/.exec(url.pathname);
        if (noticePage) notices.current(noticePage[1]);
        const controlPage = /^\/controls\/([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(url.pathname);
        const controlDefinition = controlPage ? controls.resolve(controlPage[1], controlPage[2]) : null;
        if (viewerPage) vistas.viewer(viewerPage[1]); // Disabled URLs return 404.
        const relative = gamePage ? 'maze.html' : url.pathname === '/phone-information' ? 'phone-information.html' : url.pathname === '/sensors' ? 'sensors-install.html' : url.pathname === '/universe' ? 'universe.html' : noticePage ? 'assets/notices/notice.html' : controlPage || url.pathname === '/controls' ? 'controls.html' : viewerPage || url.pathname === '/display' ? 'vista.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
        // Administrator routes resolve to the server-connected client under web/.
        // Allow only named client files, shared CSS, and supported local assets;
        // realpath also prevents a permitted asset path escaping the project.
        const webFiles = new Set(['universe.html', 'universe-ui.js', 'index.html', 'app.js', 'admin-ux.js', 'variables-ui.js', 'activity-ui.js', 'run-ui.js', 'browser-compat.js', 'tasks-ui.js', 'time-ui.js', 'plugin-ui.js', 'card-renderer.js', 'card-designer.js', 'vista.html', 'vistas-ui.js', 'vista-renderer.js', 'vista-viewer.js', 'controls.html', 'controls-renderer.js', 'controls-viewer.js', 'control-app.js', 'controls-ui.js', 'lighting-controls.js', 'television-controls.js']);
        webFiles.add('sensors-install.html');
        webFiles.add('phone-information.html');
        webFiles.add('maze.html');webFiles.add('games-ui.js');
        const file = webFiles.has(relative) ? path.join(root, 'web', relative) : path.resolve(root, relative);
        if (localDisplayPath('/' + relative)) await requireLocalDisplay(root, '/' + relative);
        if (!webFiles.has(relative) && relative !== 'styles.css' && !(relative.startsWith('assets/') && Object.hasOwn(contentTypes, path.extname(file)))) throw new HttpError(404, 'File not found.');
        const realRoot = await fs.realpath(root), realFile = await fs.realpath(file);
        if (!realFile.startsWith(realRoot + path.sep)) throw new HttpError(404, 'File not found.');
        let content = await fs.readFile(realFile);
        if(relative==='maze.html'){
          games.viewer();
          response.setHeader('Referrer-Policy','no-referrer');
          response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-src 'none'; frame-ancestors 'self' file:; object-src 'none'; base-uri 'none'; form-action 'none'");
        }
        if (relative === 'controls.html') {
          // Supply metadata in the first HTML response so browser installation
          // does not depend on a successful telemetry/capability refresh.
          const manifest = controlDefinition ? controlAppManifest(controlDefinition, config.snapshot().name) : null;
          content = content.toString('utf8').replace('<!-- Control app metadata -->', controlAppHead(manifest));
        }
        if (localDisplayPath('/' + relative)) {
          // Public display scripts have an opaque origin and no connect/form
          // privileges, even if an embedding wrapper grants allow-same-origin.
          // Administrator, Controls and private-file policies remain unchanged.
          response.setHeader('Referrer-Policy', 'no-referrer');
          response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'none'; frame-src 'none'; frame-ancestors 'self' file:; sandbox allow-scripts; object-src 'none'; base-uri 'none'; form-action 'none'");
        }
        if (noticePage || relative.startsWith('assets/notices/')) {
          response.setHeader('Referrer-Policy', 'no-referrer');
          response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; media-src 'self'; connect-src 'self'; frame-ancestors 'self' file:; object-src 'none'; base-uri 'none'; form-action 'none'");
        }
        if(relative==='phone-information.html') {
          // OSM requires a browser Referer. Send only this origin, never a
          // selected phone identifier, route/query or callback values.
          response.setHeader('Referrer-Policy','origin');
          response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https://tile.openstreetmap.org; connect-src 'self'; frame-src 'none'; frame-ancestors 'self' file:; object-src 'none'; base-uri 'none'; form-action 'none'");
        }
        // The public Vista page is also inside the packaged Tizen frame, above
        // its inert Cards. Leaving this outer document at frame-ancestors none
        // blocks the entire viewer before any Card or script can load.
        // Only saved enabled Vistas, /display, and the explicit public test page
        // admit local packaged ancestors; admin and Controls remain unframeable.
        if (viewerPage || url.pathname === '/display' || url.pathname === '/universe' || relative === 'assets/tv-url-test.html') {
          response.setHeader('Content-Security-Policy', String(response.getHeader('Content-Security-Policy'))
            .replace("frame-ancestors 'none'", "frame-ancestors 'self' file:"));
        }
        response.writeHead(200, { 'Content-Type': contentTypes[path.extname(realFile)] });
        response.end(request.method === 'HEAD' ? undefined : content);
      } catch (error) {
        const status = error.status || (error.code === 'ENOENT' ? 404 : 500);
        if (status === 500) console.error('Localserve request failed:', error.message);
        json(response, status, { error: status === 500 ? 'Unable to save or read server data. Original data was retained.' : error.message });
      }
    });
    const listen = { ...config.snapshot().listen, ...options.listen };
    registry.localDisplayOrigin = () => isPrivateIPv4(listen.host) && server?.listening
      ? `http://${listen.host}:${server.address().port}` : null;
    validateListen(listen);
    // Port 0 asks the OS for an unused port. A busy explicit port fails startup;
    // Localserve does not replace listeners or change unrelated services.
    // LAN mode binds one explicit private interface plus localhost; there is
    // no wildcard/public-interface listener. Both share the same guarded handler.
    const browserHost = isPrivateIPv4(listen.host) ? '127.0.0.1' : listen.host;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(listen.port, browserHost, resolve); });
    if (isPrivateIPv4(listen.host)) {
      lanServer = http.createServer(server.listeners('request')[0]);
      await new Promise((resolve, reject) => { lanServer.once('error', reject); lanServer.listen(server.address().port, listen.host, resolve); });
    }
    origin = `http://${browserHost.includes(':') ? '[' + browserHost + ']' : browserHost}:${server.address().port}`;
    await activity.add('Server started');
    const schedulerTimer = options.automatic === false ? null : setInterval(() => engine.tick().catch(error => console.error('Scheduler:', error.message)), 500);
    const retentionTimer = options.automatic === false ? null : setInterval(() => {
      if (!closing && !retentionBusy) void cleanupActivity();
    }, 60000);
    const pluginTimer = options.automatic === false ? null : setInterval(async () => {
      // Skip timer overlap; the registry also serializes manual refreshes.
      if (discoveryBusy || closing) return;
      discoveryBusy = true;
      try {
        await registry.discover();
        await controls.sync();
        registry.pollDue();
      } catch (error) { console.error('Plugin discovery/polling:', error.message); }
      finally { discoveryBusy = false; }
    }, 3000);
    return { server, origin, config, tasks, state, activity, registry, engine, vistas, universe, games, controls, snapshot, cleanupActivity,
      async close() {
        // Repeated shutdown requests share one promise. Stop admitting work and
        // timers, drain runs/discovery, close HTTP, then release the folder lock.
        if (!closePromise) closePromise = (async () => {
          closing = true; clearInterval(schedulerTimer); clearInterval(pluginTimer); clearInterval(retentionTimer);
          registry.beginClose();
          await sensorIngress.queue;
          await controls.close();
          await engine.close();
          while (discoveryBusy) await new Promise(resolve => setTimeout(resolve, 10));
          await retentionQueue;
          await notices.store.queue;
          await registry.close();
          await vistas.store.queue;
          await vistas.display.queue;
          await universe.store.queue;
          await games.store.queue;
          if (lanServer?.listening) await new Promise((resolve, reject) => lanServer.close(error => error ? reject(error) : resolve()));
          await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
          await activity.add('Server stopped');
          await releaseLock();
        })();
        return closePromise;
      } };
  } catch (error) {
    // Failed startup releases only the lock acquired by this instance.
    if (lanServer?.listening) await new Promise(resolve => lanServer.close(resolve));
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await registry?.close();
    await releaseLock(); throw error;
  }
}

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
// Importing the factory for tests must not start a listener or open a browser.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const application = await createLocalserve(projectRoot);
  const desktop = await attachTrayControl(application, projectRoot);
  console.log(`Localserve: ${application.origin}`);
  console.log('Press Ctrl+C to stop this Localserve process.');
  if (process.argv.includes('--open')) execFile('cmd.exe', ['/c', 'start', '', application.origin], { windowsHide: true });
  let stopping = false;
  async function stop() { if (stopping) return; stopping = true; await desktop.shutdown(); }
  process.on('SIGINT', () => stop().catch(error => { console.error(error); process.exitCode = 1; }));
  process.on('SIGTERM', () => stop().catch(error => { console.error(error); process.exitCode = 1; }));
}
