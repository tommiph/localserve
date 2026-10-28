/** Private floor-plan layout data. Markers contain stable references only;
 * device actions and public readings belong to the existing Controls services. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {JsonStore, HttpError} from './storage.mjs';
import {glyphs} from './plugin-schema.mjs';
import {createHash} from 'node:crypto';
import {canonicalMapPng} from './home-map-image.mjs';

const maximumBytes = 256 * 1024;
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/;
const targetFields = Object.freeze({
  light: ['pluginId', 'slug', 'lightId'],
  group: ['pluginId', 'slug', 'groupId'],
  scene: ['pluginId', 'slug', 'itemId'],
  remote: ['pluginId', 'slug'],
  task: ['taskId'],
  card: ['pluginId', 'templateId', 'sourceId'],
});

function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) {
    throw new HttpError(400, 'Unknown home map property.');
  }
}
function name(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 64
    || /[\u0000-\u001f\u007f]/.test(value)) throw new HttpError(400, 'Enter a name of up to 64 characters.');
  return value.trim();
}
function reference(value) {
  object(value, ['kind', ...new Set(Object.values(targetFields).flat())]);
  const fields = targetFields[value.kind];
  if (!Object.hasOwn(targetFields, value.kind) || !fields
    || Object.keys(value).length !== fields.length + 1
    || fields.some(field => typeof value[field] !== 'string' || !idPattern.test(value[field]))) {
    throw new HttpError(400, 'Choose a valid published device, scene, Task, remote or Card.');
  }
  return Object.fromEntries(['kind', ...fields].map(field => [field, value[field]]));
}

/** Image identities describe server-managed files, never client paths or URLs.
 * The upload boundary must verify image bytes before assigning this metadata. */
export function validateMapImage(value) {
  if (value === null) return null;
  object(value, ['id', 'width', 'height']);
  if (typeof value.id !== 'string' || !/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(value.id)
    || !Number.isInteger(value.width) || !Number.isInteger(value.height)
    || value.width < 1 || value.height < 1 || value.width > 8192 || value.height > 8192
    || value.width * value.height > 24000000) throw new HttpError(400, 'Choose a supported floor-plan image.');
  return {id: value.id, width: value.width, height: value.height};
}

export function emptyHomeMap() {
  return {schemaVersion: 1, revision: 1, name: 'Home map', enabled: false, image: null, markers: []};
}

/** Percentage coordinates keep markers aligned with the image at any viewport.
 * Missing targets remain saved; viewers must resolve their current availability. */
export function validateHomeMap(value) {
  object(value, ['schemaVersion', 'revision', 'name', 'enabled', 'image', 'markers']);
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1
    || value.revision >= Number.MAX_SAFE_INTEGER || typeof value.enabled !== 'boolean'
    || !Array.isArray(value.markers) || value.markers.length > 128) {
    throw new HttpError(400, 'Choose up to 128 map markers.');
  }
  const ids = new Set();
  const markers = value.markers.map(marker => {
    object(marker, ['id', 'name', 'icon', 'enabled', 'x', 'y', 'target']);
    if (typeof marker.id !== 'string' || !idPattern.test(marker.id) || ids.has(marker.id)
      || !glyphs.includes(marker.icon) || typeof marker.enabled !== 'boolean'
      || !Number.isFinite(marker.x) || !Number.isFinite(marker.y)
      || marker.x < 0 || marker.x > 100 || marker.y < 0 || marker.y > 100) {
      throw new HttpError(400, 'Choose a unique marker, glyph and position inside the map.');
    }
    ids.add(marker.id);
    return {id: marker.id, name: name(marker.name), icon: marker.icon, enabled: marker.enabled,
      x: marker.x, y: marker.y, target: reference(marker.target)};
  });
  const result = {schemaVersion: 1, revision: value.revision, name: name(value.name),
    enabled: value.enabled, image: validateMapImage(value.image), markers};
  if (Buffer.byteLength(JSON.stringify(result, null, 2) + '\n') > maximumBytes) {
    throw new HttpError(400, 'Home map is too large.');
  }
  return result;
}

/** Revision checks run inside the atomic store queue so concurrent editors
 * cannot replace each other's accepted changes. Closing drains pending writes. */
export class HomeMap {
  constructor(root) {
    this.file = path.join(root, 'data', 'home-map.json');
    this.directory = path.join(root, 'data', 'home-map', 'images');
    this.uploads = new Map();
    this.closing = false;
  }
  async load() {
    try {
      const info = await fs.lstat(this.file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > maximumBytes) throw new Error('Invalid home map file; original data was retained.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.store = await new JsonStore(this.file, emptyHomeMap()).load();
    validateHomeMap(this.store.snapshot());
    await fs.mkdir(this.directory,{recursive:true});
    const realRoot=await fs.realpath(path.dirname(this.file)),realDirectory=await fs.realpath(this.directory);
    if(!realDirectory.startsWith(realRoot+path.sep))throw new Error('Home map images must remain inside data/.');
    this.directory=realDirectory;
    return this;
  }
  admin() { return this.store.snapshot(); }
  async save(input) {
    const value = validateHomeMap(input);
    await this.store.update(current => {
      if (this.closing) throw new HttpError(503, 'Server is stopping.');
      if (value.revision !== current.revision) throw new HttpError(409, 'Home map changed. Reopen the editor.');
      if(value.image&&JSON.stringify(value.image)!==JSON.stringify(current.image)){
        const upload=this.uploads.get(value.image.id);
        if(!upload||upload.revision!==current.revision||upload.expires<Date.now()
          ||JSON.stringify(upload.image)!==JSON.stringify(value.image))throw new HttpError(409,'Upload this floor plan again before saving.');
      }
      Object.assign(current, value, {revision: current.revision + 1});
    });
    return this.admin();
  }
  prepareImage(bytes,revision) {
    const image=canonicalMapPng(bytes),id=createHash('sha256').update(image.bytes).digest('hex')+'.png';
    const operation=this.store.queue.then(async()=>{
      if(this.closing)throw new HttpError(503,'Server is stopping.');
      if(this.admin().revision!==revision)throw new HttpError(409,'Home map changed. Reopen the editor.');
      for(const [key,item]of this.uploads)if(item.expires<Date.now())this.uploads.delete(key);
      if(this.uploads.size>=8&&!this.uploads.has(id))throw new HttpError(429,'Finish or cancel the current floor-plan uploads before adding more.');
      const destination=path.join(this.directory,id);
      try{await fs.writeFile(destination,image.bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
      const metadata={id,width:image.width,height:image.height};
      this.uploads.set(id,{image:metadata,revision,expires:Date.now()+15*60000});
      // Unreferenced files never enter the public image route. Bound retained
      // drafts and remove obsolete files only from this managed image folder.
      const keep=new Set([id,this.admin().image?.id,...this.uploads.keys()]);
      for(const file of await fs.readdir(this.directory))if(/^[a-f0-9]{64}\.png$/.test(file)&&!keep.has(file))await fs.rm(path.join(this.directory,file),{force:true});
      return metadata;
    });
    this.store.queue=operation.catch(()=>{});return operation;
  }
  async image(id,administrator=false) {
    const map=this.admin(),draft=this.uploads.get(id);
    if(!/^[a-f0-9]{64}\.png$/.test(id)||!(map.image?.id===id&&(administrator||map.enabled)
      ||administrator&&draft&&draft.expires>Date.now()))throw new HttpError(404,'Floor plan unavailable.');
    const file=path.join(this.directory,id);
    try{
      const info=await fs.lstat(file);if(!info.isFile()||info.isSymbolicLink())throw new Error();
      const bytes=await fs.readFile(file);
      if(createHash('sha256').update(bytes).digest('hex')+'.png'!==id)throw new Error();
      return bytes;
    }catch{throw new HttpError(404,'Floor plan unavailable. Upload the image again.');}
  }
  async close() { this.closing = true; await this.store?.queue; }
}
