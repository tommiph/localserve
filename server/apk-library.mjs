/** Manual VR library admission, durable job intent and narrowly scoped native API. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomBytes, randomInt, randomUUID, timingSafeEqual} from 'node:crypto';
import {JsonStore, HttpError} from './storage.mjs';
import {isPrivateIPv4} from './network.mjs';
import {pipeline} from 'node:stream/promises';

export const nativeLibraryRoute = pathname => /^\/api\/(?:catalog|status|scan|scenes|device\/install(?:\/cancel)?|device\/uninstall(?:\/prepare)?|(?:file|download)\/[a-f0-9]{24}|art\/[A-Za-z][A-Za-z0-9_.]{1,199})$/.test(pathname);
const digest = token => createHash('sha256').update(token).digest();
const checkKeys = (value, keys) => {
  if (!value || Object.keys(value).some(key => !keys.includes(key))) throw new HttpError(400, 'Invalid library request.');
};
export class ApkLibrary {
  constructor(root, registry, {catalogFactory, vault, now = Date.now} = {}) {
    this.root = root; this.registry = registry; this.catalogFactory = catalogFactory; this.now = now;
    this.vault = vault;
    this.store = new JsonStore(path.join(root, 'data/vr-library-job.json'), {job: null});
    this.confirmations = new Map(); this.active = null; this.inventory = null; this.closed = false;
    this.credentialQueue = Promise.resolve();
  }
  async load() {
    // An absent optional plugin cannot prevent the server from starting.
    try {
      const [{ApkCatalog, installable}, {validPackage, protectedPackage}, {createVault}] = await Promise.all([
        import('../plugins/oculus-go/server/library.mjs'), import('../plugins/oculus-go/server/apk.mjs'), import('../plugins/oculus-go/server/vault.mjs')]);
      this.catalogFactory ||= (root, folder) => new ApkCatalog(root, folder);
      this.vault ||= createVault(path.join(this.root, 'plugins/oculus-go/data/home-vr.dpapi'));
      this.installable = installable; this.validPackage = validPackage; this.protectedPackage = protectedPackage;
    } catch { this.moduleError = 'The Oculus Go package library is not installed.'; }
    try {
      const directory = path.join(this.root,'plugins/oculus-go/android/dist');
      const receipt = JSON.parse(await fs.readFile(path.join(directory,'verification.json'),'utf8'));
      const stat = await fs.lstat(path.join(directory,'localserve-go.apk'));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(receipt.sha256) || !receipt.unconfigured || receipt.packageName !== 'org.localserve.go') throw Error('Invalid client build.');
      this.clientApp = {version:receipt.version,size:stat.size,sha256:receipt.sha256,url:'/api/vr-library/client-apk'};
    } catch { this.clientApp = null; }
    try {
      await this.store.load(); const {job} = this.store.snapshot();
      if (job && (!['Preparing','Installing','Removing','Installed','Removed','Failed'].includes(job.state) || typeof job.id !== 'string')) throw Error('Invalid library job record.');
      if (job && ['Preparing','Installing','Removing'].includes(job.state)) await this.store.update(value => { value.job.state = 'Failed'; value.job.error = 'Interrupted. Check the headset before starting another operation; nothing was replayed.'; });
    } catch { this.storageError = 'VR library job history cannot be read. Original data was retained.'; }
    return this;
  }
  record() {
    if (this.closed) throw new HttpError(503, 'VR library is stopping.');
    if (this.moduleError) throw new HttpError(404, this.moduleError);
    if (this.storageError) throw new HttpError(503, this.storageError);
    const record = this.registry.records.get('oculus-go');
    if (!record?.plugin.actions.some(action => action.id === 'library-install')) throw new HttpError(404, 'Install the Oculus Go plugin to use VR library.');
    const config = record.config.snapshot();
    if (!config.enabled || !config.settings['library-enabled']) throw new HttpError(409, 'Enable Oculus Go and APK library in plugin Settings first.');
    return {record, config};
  }
  current(revision) {
    const result = this.record();
    if (revision !== result.config.revision) throw new HttpError(409, 'Oculus Go settings changed. Refresh VR library before continuing.');
    return result;
  }
  catalog() {
    const {config} = this.record();
    if (this.catalogRevision !== config.revision) {
      this.scanController?.abort(); this.confirmations.clear(); this.inventory = null;
      this.index = this.catalogFactory(this.root, config.settings['library-folder']); this.catalogRevision = config.revision;
    }
    return this.index;
  }
  scan(revision) {
    this.current(revision); const index = this.catalog();
    if (index.scanning) return;
    this.scanController = new AbortController();
    this.scanPromise = index.scan(this.scanController.signal).catch(error => { index.errors = [error.message]; });
  }
  snapshot() {
    try {
      const {config} = this.record(), index = this.catalog();
      return {available: true, revision: config.revision, folder: config.settings['library-folder'], homeVrEnabled: config.settings['home-vr-enabled'] === true,
        ...index.snapshot(), clientApp:this.clientApp, job: this.store.snapshot().job, busy: Boolean(this.active), inventory: this.inventory?.revision === config.revision ? this.inventory : null};
    } catch (error) { return {available: false, reason: error.message, apps: [], job: null, busy: false}; }
  }
  async authenticate(request) {
    const {config} = this.record();
    const remote = (request.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (request.headers.origin || !(isPrivateIPv4(remote) || remote === '127.0.0.1' || remote === '::1') || !config.settings['home-vr-enabled']) throw new HttpError(403, 'Home VR access is not available.');
    const supplied = /^Bearer ([^\s]{16,512})$/.exec(request.headers.authorization || '')?.[1];
    if (!supplied) throw new HttpError(401, 'Home VR authorization is required.');
    if (this.authRevision !== config.revision) {
      const saved = config.settings['home-vr-token'] || (await this.vault.load())?.token;
      this.current(config.revision);
      this.authDigest = typeof saved === 'string' && saved.length >= 16 ? digest(saved) : null;
      this.authRevision = config.revision;
    }
    if (!this.authDigest || !timingSafeEqual(this.authDigest, digest(supplied))) throw new HttpError(401, 'Home VR authorization does not match this installation.');
    return config.revision;
  }
  credentials(operation) {
    const pending=this.credentialQueue.then(operation);
    this.credentialQueue=pending.catch(()=>{});
    return pending;
  }
  saveToken(revision) { return this.credentials(()=>this.protectToken(revision)); }
  async protectToken(revision) {
    const {config} = this.current(revision), token = config.settings['home-vr-token'];
    if (typeof token !== 'string' || !/^[^\s]{16,512}$/.test(token)) throw new HttpError(400, 'Enter the matching Home VR token in Oculus Go Settings first.');
    await this.vault.save({token}); this.current(revision); this.authRevision = null; this.enrollment=null;
    return {saved: true};
  }
  clientCode(revision) { return this.credentials(()=>this.createClientCode(revision)); }
  async createClientCode(revision) {
    const {config} = this.current(revision);
    if (!config.settings['home-vr-enabled']) throw new HttpError(409,'Enable Home VR headset access in Oculus Go Settings first.');
    if (!this.clientApp) throw new HttpError(409,'Build the Localserve Go app before connecting a headset.');
    let token = config.settings['home-vr-token'] || (await this.vault.load())?.token;
    this.current(revision);
    if (!token) { token=randomBytes(32).toString('hex'); await this.vault.save({token}); this.authRevision=null; }
    if(typeof token!=='string'||!/^[^\s]{16,512}$/.test(token))throw new HttpError(409,'Configure a valid headset access token first.');
    this.current(revision);
    const code=String(randomInt(1000000)).padStart(6,'0'),expiresAt=this.now()+5*60000;
    // Only one short-lived enrollment exists. A new request revokes the old
    // code; five guesses revoke it too. Long-lived credentials never enter URLs.
    this.enrollment={hash:digest(code),revision,expiresAt,attempts:0,token};
    return {code,expiresAt};
  }
  async enroll(request, values) {
    checkKeys(values,['code']);const {config}=this.record();
    const remote=(request.socket.remoteAddress||'').replace(/^::ffff:/,'');
    if(request.headers.origin || !isPrivateIPv4(remote) || !config.settings['home-vr-enabled']) throw new HttpError(403,'Use the Localserve app on your private LAN.');
    const enrollment=this.enrollment;
    if(!enrollment || enrollment.revision!==config.revision || enrollment.expiresAt<=this.now()) {this.enrollment=null;throw new HttpError(409,'Create a new connection code in VR library.');}
    enrollment.attempts++;
    const matches=typeof values.code==='string' && /^\d{6}$/.test(values.code) && timingSafeEqual(digest(values.code),enrollment.hash);
    if(!matches){if(enrollment.attempts>=5)this.enrollment=null;throw new HttpError(403,'Connection code is incorrect or expired.');}
    this.enrollment=null;
    return {token:enrollment.token};
  }
  async clientDownload() {
    this.record();
    if(!this.clientApp)throw new HttpError(404,'Localserve Go APK is unavailable.');
    const file=path.join(this.root,'plugins/oculus-go/android/dist/localserve-go.apk'),stat=await fs.lstat(file),real=await fs.realpath(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==this.clientApp.size||real!==path.resolve(file))throw new HttpError(409,'Client APK changed. Restart after rebuilding.');
    const data=await fs.readFile(file);
    if(digest(data).toString('hex')!==this.clientApp.sha256)throw new HttpError(409,'Client APK verification failed.');
    return data;
  }
  async readInventory(revision, signal) {
    this.current(revision);
    if (this.active) throw new HttpError(409, 'Wait for the package operation to finish.');
    const result = await this.execute('library-inventory',{},revision,signal);
    this.current(revision);
    this.inventory = {revision, at: this.now(), packages: result.packages};
    return this.inventory;
  }
  async prepareUninstall(packageName, revision, signal) {
    this.current(revision); this.catalog();
    if (this.protectedPackage(packageName)) throw new HttpError(400, 'This application is protected.');
    if (this.active) throw new HttpError(409, 'Wait for the package operation to finish.');
    await this.execute('library-inspect',{package: packageName},revision,signal);
    this.current(revision);
    for (const [key, value] of this.confirmations) if (value.expires <= this.now()) this.confirmations.delete(key);
    if (this.confirmations.size >= 32) throw new HttpError(429, 'Too many pending confirmations. Wait two minutes.');
    const confirmation = randomBytes(24).toString('hex');
    this.confirmations.set(confirmation, {packageName, revision, expires: this.now() + 120000});
    return {confirmation, packageName};
  }
  async execute(action, parameters, revision, signal) {
    try { return await this.registry.execute('oculus-go',action,parameters,{configRevision:revision,signal,packageLibrary:true}); }
    catch (error) { if (!error.status) error.status = 409; throw error; }
  }
  async start(values, revision) {
    this.current(revision); checkKeys(values, ['id','packageName','confirmation']);
    if (this.active) throw new HttpError(409, 'A package operation is already in progress.');
    if (this.registry.engine.gate.paused) throw new HttpError(409, 'Enable server functions before changing applications.');
    let item, packageName, action, parameters;
    if (values.id) {
      if (values.packageName || values.confirmation) throw new HttpError(400, 'Choose one package operation.');
      const opened = await this.catalog().open(values.id);
      try { item = opened.item; this.installable(item); } finally { await opened.handle.close(); }
      packageName = item.packageName; action = 'library-install'; parameters = {id: values.id};
    } else {
      const confirmation = this.confirmations.get(values.confirmation);
      if (!confirmation || confirmation.packageName !== values.packageName || confirmation.revision !== revision || confirmation.expires <= this.now()) throw new HttpError(409, 'Confirm removal again; the confirmation expired or settings changed.');
      this.confirmations.delete(values.confirmation);
      packageName = values.packageName; action = 'library-uninstall'; parameters = {package: packageName};
    }
    this.current(revision);
    if (this.active) throw new HttpError(409, 'A package operation is already in progress.');
    const controller = new AbortController(), active = {controller, promise: null}; this.active = active;
    const job = {id: randomUUID(), fileId: values.id || '', packageName, title: this.catalog().apps.find(app => app.packageName === packageName)?.title || packageName,
      operation: item ? 'install' : 'uninstall', state: 'Preparing', error: '', startedAt: this.now(), finishedAt: null};
    const claimed = this.store.update(value => { value.job = job; });
    // Return the durable claim immediately. The owned promise remains pending
    // throughout execution so shutdown/cancellation can drain the exact effect.
    active.promise = (async () => {
      try {
        await claimed;
        this.current(revision); controller.signal.throwIfAborted();
        await this.store.update(value => { value.job.state = item ? 'Installing' : 'Removing'; });
        this.current(revision); controller.signal.throwIfAborted();
        const result = await this.registry.execute('oculus-go',action,parameters,{configRevision: revision, signal: controller.signal, packageLibrary: true});
        controller.signal.throwIfAborted();
        await this.store.update(value => { value.job.state = item ? 'Installed' : 'Removed'; value.job.finishedAt = this.now(); });
        this.inventory = null; return result;
      } catch (error) {
        await this.store.update(value => { value.job.state = 'Failed'; value.job.error = String(error.message).slice(0, 700) + ' Check the headset before retrying; no operation was replayed.'; value.job.finishedAt = this.now(); });
        throw error;
      } finally { if (this.active === active) this.active = null; }
    })();
    active.promise.catch(() => {});
    await claimed;
    return {job: this.store.snapshot().job, completion: active.promise};
  }
  cancel(id) {
    if (!this.active || this.store.snapshot().job?.id !== id) throw new HttpError(409, 'This package operation is no longer active.');
    this.active.controller.abort(new Error('Cancelled; a package change may already have reached the headset.'));
    return {cancelled: true};
  }
  async art(packageName) {
    if (!this.validPackage(packageName) || !this.catalog().apps.some(app => app.packageName === packageName)) throw new HttpError(404, 'Artwork unavailable.');
    const directory = path.join(this.root, 'plugins/oculus-go/data/library-art');
    for (const extension of ['.png','.jpg','.webp']) {
      const file = path.join(directory, packageName + extension);
      try {
        const stat = await fs.lstat(file), real = await fs.realpath(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024 || !real.startsWith(path.resolve(directory) + path.sep)) continue;
        const data = await fs.readFile(real);
        const valid = extension === '.png' ? data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) : extension === '.jpg' ? data[0] === 255 && data[1] === 216 : data.toString('ascii',0,4) === 'RIFF' && data.toString('ascii',8,12) === 'WEBP';
        if (valid) return {data, type: extension === '.png' ? 'image/png' : extension === '.jpg' ? 'image/jpeg' : 'image/webp'};
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    throw new HttpError(404, 'Artwork unavailable.');
  }
  async close() {
    this.closed = true; this.enrollment=null; this.scanController?.abort(); this.active?.controller.abort(new Error('Server stopping; package outcome may be unknown.'));
    await this.active?.promise?.catch(() => {}); await this.scanPromise; await this.credentialQueue; await this.store.queue;
  }
}

/** Bearer authorization grants only the native client's fixed library routes. */
export async function serveNativeLibrary(library, request, response, url, {json, readBody}) {
  if (url.search) throw new HttpError(400, 'Library URLs do not accept query parameters.');
  const revision = await library.authenticate(request), route = url.pathname;
  const controller = new AbortController(), disconnect = () => { if (!response.writableEnded) controller.abort(new Error('Client disconnected.')); };
  response.once('close', disconnect);
  try {
    if (request.method === 'GET' && ['/api/catalog','/api/status','/api/scenes','/api/device/install'].includes(route)) {
      if (route === '/api/device/install') return json(response, 200, {job: library.store.snapshot().job});
      if (route === '/api/scenes') return json(response, 200, {source: 'Localserve', lightsOnline: false, tvOnline: false, scenes: [], errors: []});
      const index = library.catalog(); if (!index.lastScan && !index.scanning) library.scan(revision);
      const catalog = index.snapshot();
      return json(response, 200, route === '/api/catalog' ? catalog : {name: 'Localserve', apps: catalog.apps.length, files: index.files.size, scanning: catalog.scanning, lastScan: catalog.lastScan, errors: catalog.errors});
    }
    const file = /^\/api\/(file|download)\/([a-f0-9]{24})$/.exec(route), art = /^\/api\/art\/(.+)$/.exec(route);
    if (['GET','HEAD'].includes(request.method) && art) {
      const image = await library.art(art[1]); response.writeHead(200, {'Content-Type': image.type, 'Content-Length': image.data.length}); return response.end(request.method === 'HEAD' ? undefined : image.data);
    }
    if (['GET','HEAD'].includes(request.method) && file) {
      if (file[1] === 'file') return json(response, 200, await library.catalog().fileInfo(file[2], controller.signal));
      const {item, handle} = await library.catalog().open(file[2]);
      try {
        let start = 0, end = item.size - 1, code = 200;
        if (request.headers.range) {
          const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
          if (!range) throw new HttpError(416, 'Choose a single byte range.');
          start = Number(range[1]); end = range[2] ? Number(range[2]) : end; code = 206;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end >= item.size) throw new HttpError(416, 'Byte range is outside this APK.');
        }
        library.current(revision);
        response.writeHead(code, {'Content-Type':'application/vnd.android.package-archive','Content-Length': end-start+1, 'Accept-Ranges':'bytes',
          'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(item.name), ...(code === 206 ? {'Content-Range': `bytes ${start}-${end}/${item.size}`} : {})});
        if (request.method === 'HEAD') return response.end();
        await pipeline(handle.createReadStream({start,end,autoClose:false}), response, {signal:controller.signal}); return;
      } finally { await handle.close(); }
    }
    if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
    const body = await readBody(request); library.current(revision);
    if (route === '/api/scan') { checkKeys(body, []); library.scan(revision); return json(response, 202, {scanning:true}); }
    if (route === '/api/device/install') {
      checkKeys(body, ['id']); if (!body.id) throw new HttpError(400,'Choose a library file.');
      const result = await library.start(body,revision); return json(response,202,{job:result.job});
    }
    if (route === '/api/device/install/cancel') {checkKeys(body,['id']);return json(response,200,library.cancel(body.id));}
    if (route === '/api/device/uninstall/prepare') {
      checkKeys(body,['packageName']); return json(response,200,await library.prepareUninstall(body.packageName,revision,controller.signal));
    }
    if (route === '/api/device/uninstall') {
      checkKeys(body,['packageName','confirmation']); const result = await library.start(body,revision);
      return json(response,200,await result.completion);
    }
    throw new HttpError(404,'Library operation unavailable.');
  } finally { response.removeListener('close',disconnect); }
}

export async function libraryAdminOperation(library, operation, body, signal) {
  const {revision, ...values} = body; library.current(revision);
  if (operation === 'scan') { checkKeys(values, []); library.scan(revision); return {scanning:true}; }
  if (operation === 'inventory') { checkKeys(values, []); return library.readInventory(revision,signal); }
  if (operation === 'save-token') { checkKeys(values, []); return library.saveToken(revision); }
  if (operation === 'client-code') {checkKeys(values,[]);return library.clientCode(revision);}
  if (operation === 'prepare-uninstall') { checkKeys(values,['packageName']); return library.prepareUninstall(values.packageName,revision,signal); }
  if (operation === 'cancel') { checkKeys(values,['id']); return library.cancel(values.id); }
  if (operation === 'install' || operation === 'uninstall') {
    checkKeys(values, operation === 'install' ? ['id'] : ['packageName','confirmation']);
    if (operation === 'install' && !values.id || operation === 'uninstall' && !values.packageName) throw new HttpError(400,'Choose an application.');
    return {job:(await library.start(values,revision)).job};
  }
  throw new HttpError(404,'Library operation unavailable.');
}
