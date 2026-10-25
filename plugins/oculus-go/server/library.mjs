/** Local APK catalogue. Only indexed, unchanged regular files may be opened. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectApk, protectedPackage} from './apk.mjs';

const fingerprint = stat => `${stat.size}:${stat.mtimeMs}:${stat.ino}`;
export class ApkCatalog {
  constructor(root, folder) { this.root = root; this.folder = path.resolve(root, folder || 'library/oculus-go'); this.files = new Map(); this.cache = new Map(); this.apps = []; this.errors = []; this.lastScan = null; this.scanning = null; }
  async scan(signal = new AbortController().signal) {
    if (this.scanning) return this.scanning;
    this.scanning = this.performScan(signal).finally(() => { this.scanning = null; });
    return this.scanning;
  }
  async performScan(signal) {
    const files = new Map(), apps = new Map(), errors = [], nextCache = new Map();
    let count = 0, metadata = {};
    try {
      const file = path.join(this.root, 'plugins/oculus-go/data/library-metadata.json');
      const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw Error('Invalid library metadata.');
      metadata = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) { if (error.code !== 'ENOENT') errors.push('Library descriptions could not be read.'); }
    // The configured directory is user data. Child links are rejected rather
    // than followed into another library or private folder.
    const base = await fs.lstat(this.folder).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (base && (!base.isDirectory() || base.isSymbolicLink())) throw Error('Choose a regular APK library folder.');
    const realBase = base ? await fs.realpath(this.folder) : null;
    const visit = async (directory, depth) => {
      if (depth > 12) throw Error('APK folder nesting exceeds 12 levels.');
      for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
        signal.throwIfAborted(); if (++count > 10000) throw Error('APK library exceeds 10,000 entries.');
        if (entry.isSymbolicLink()) continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) { await visit(file, depth + 1); continue; }
        if (!entry.isFile() || !/\.apk$/i.test(entry.name)) continue;
        try {
          const stat = await fs.lstat(file), stamp = fingerprint(stat), real = await fs.realpath(file);
          if (!stat.isFile() || stat.isSymbolicLink() || !real.startsWith(realBase + path.sep)) throw Error('APK must remain in its library.');
          let info = this.cache.get(real);
          if (!info || info.stamp !== stamp) {
            const handle = await fs.open(real, 'r');
            try { info = {stamp, ...await inspectApk(handle, stat.size)}; }
            finally { await handle.close(); }
          }
          signal.throwIfAborted(); nextCache.set(real, info);
          const id = createHash('sha256').update(real + '\0' + stamp).digest('hex').slice(0, 24);
          const version = {id, name: entry.name, size: stat.size, versionCode: info.versionCode, versionName: info.versionName, minSdk: info.minSdk, nativeCode: info.nativeCode, modified: stat.mtimeMs};
          files.set(id, {file: real, stamp, ...info, ...version});
          const meta = metadata[info.packageName] || {};
          if (!apps.has(info.packageName)) apps.set(info.packageName, {id: info.packageName, packageName: info.packageName,
            title: String(meta.title || info.label || info.packageName).slice(0, 200), description: String(meta.description || '').slice(0, 4000),
            tags: Array.isArray(meta.tags) ? meta.tags.filter(x => typeof x === 'string').slice(0, 20).map(x => x.slice(0, 80)) : [],
            source: '', video: '', image: '/api/art/' + encodeURIComponent(info.packageName), added: stat.mtimeMs, versions: []});
          const app = apps.get(info.packageName); app.added = Math.max(app.added, stat.mtimeMs); app.versions.push(version);
        } catch (error) { signal.throwIfAborted(); if (errors.length < 50) errors.push(entry.name.slice(0, 160) + ': ' + error.message); }
      }
    };
    if (base) await visit(this.folder, 0);
    for (const app of apps.values()) app.versions.sort((a,b) => b.versionCode - a.versionCode || b.modified - a.modified);
    this.files = files; this.cache = nextCache; this.apps = [...apps.values()].sort((a,b) => a.title.localeCompare(b.title)); this.errors = errors; this.lastScan = Date.now();
    return this.snapshot();
  }
  snapshot() { return {name: 'Sormus', version: 1, apps: structuredClone(this.apps), scanning: Boolean(this.scanning), lastScan: this.lastScan, errors: [...this.errors]}; }
  async open(id) {
    if (!/^[a-f0-9]{24}$/.test(id || '') || !this.files.has(id)) throw Error('Select an APK from the current library.');
    const item = this.files.get(id), real = await fs.realpath(item.file), stat = await fs.lstat(item.file);
    if (real !== item.file || !stat.isFile() || stat.isSymbolicLink() || fingerprint(stat) !== item.stamp) throw Error('APK changed. Scan the library before continuing.');
    const handle = await fs.open(real, 'r');
    if (fingerprint(await handle.stat()) !== item.stamp) { await handle.close(); throw Error('APK changed while opening.'); }
    return {item, handle};
  }
  async fileInfo(id, signal) {
    const {item, handle} = await this.open(id);
    try {
      const hash = createHash('sha256');
      for await (const chunk of handle.createReadStream({autoClose: false})) { signal?.throwIfAborted(); hash.update(chunk); }
      if (fingerprint(await handle.stat()) !== item.stamp) throw Error('APK changed while hashing.');
      return {id, name: item.name, size: item.size, sha256: hash.digest('hex'), packageName: item.packageName, versionCode: item.versionCode, versionName: item.versionName, download: '/api/download/' + id};
    } finally { await handle.close(); }
  }
}
export function installable(item) {
  if (protectedPackage(item.packageName)) throw Error('This package is protected from library changes.');
  if (item.minSdk > 25 || item.nativeCode && !item.nativeCode.split(', ').some(abi => ['armeabi', 'armeabi-v7a'].includes(abi))) throw Error('This APK does not declare Oculus Go Android 7 / ARM32 compatibility.');
}
