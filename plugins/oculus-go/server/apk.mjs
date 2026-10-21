/** Bounded ZIP and Android binary-XML reader. APK contents are never executed. */
import fs from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';

const MAX_MANIFEST = 4 * 1024 * 1024;
export const validPackage = value => typeof value === 'string' && value.length <= 200
  && /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(value);
export const protectedPackage = value => !validPackage(value)
  || /^(?:android|com\.android|com\.oculus|com\.facebook|com\.qualcomm|com\.qti|org\.openpacific)(?:\.|$)/i.test(value)
  || ['com.tommi.homevr','org.localserve.go'].includes(value);

async function read(handle, size, position) {
  const data = Buffer.alloc(size);
  const result = await handle.read(data, 0, size, position);
  if (result.bytesRead !== size) throw Error('APK is incomplete.');
  return data;
}
function requireRange(buffer, start, size) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(size) || start < 0 || size < 0 || start + size > buffer.length) throw Error('Invalid APK manifest bounds.');
}
export function parseManifest(data) {
  requireRange(data, 0, 8);
  if (data.readUInt16LE(0) !== 3 || data.readUInt32LE(4) !== data.length) throw Error('APK needs an Android binary manifest.');
  let strings = [], result = {}, position = data.readUInt16LE(2);
  const stringAt = index => index === 0xffffffff ? '' : strings[index] ?? '';
  while (position < data.length) {
    requireRange(data, position, 8);
    const type = data.readUInt16LE(position), header = data.readUInt16LE(position + 2), size = data.readUInt32LE(position + 4);
    if (header < 8 || size < header) throw Error('Invalid APK manifest chunk.');
    requireRange(data, position, size);
    const chunk = data.subarray(position, position + size);
    if (type === 1) {
      requireRange(chunk, 0, 28);
      const count = chunk.readUInt32LE(8), flags = chunk.readUInt32LE(16), start = chunk.readUInt32LE(20);
      if (count > 65536) throw Error('APK string table is too large.');
      requireRange(chunk, header, count * 4);
      strings = [];
      for (let i = 0; i < count; i++) {
        let offset = start + chunk.readUInt32LE(header + i * 4);
        const length = utf8 => {
          requireRange(chunk, offset, utf8 ? 1 : 2);
          let n = utf8 ? chunk[offset++] : chunk.readUInt16LE(offset); if (!utf8) offset += 2;
          if (n & (utf8 ? 0x80 : 0x8000)) {
            requireRange(chunk, offset, utf8 ? 1 : 2);
            n = utf8 ? ((n & 0x7f) << 8) | chunk[offset++] : ((n & 0x7fff) * 65536) + chunk.readUInt16LE(offset);
            if (!utf8) offset += 2;
          }
          return n;
        };
        if (flags & 0x100) { length(true); const n = length(true); requireRange(chunk, offset, n + 1); strings.push(chunk.toString('utf8', offset, offset + n)); }
        else { const n = length(false); requireRange(chunk, offset, n * 2 + 2); strings.push(chunk.toString('utf16le', offset, offset + n * 2)); }
      }
    }
    if (type === 0x102) {
      requireRange(chunk, 0, 36);
      const tag = stringAt(chunk.readUInt32LE(20)), start = 16 + chunk.readUInt16LE(24), stride = chunk.readUInt16LE(26), count = chunk.readUInt16LE(28);
      if (stride < 20 || count > 1024) throw Error('Invalid APK attributes.');
      requireRange(chunk, start, stride * count);
      const attrs = {};
      for (let i = 0; i < count; i++) {
        const at = start + i * stride, name = stringAt(chunk.readUInt32LE(at + 4)), raw = chunk.readUInt32LE(at + 8), kind = chunk[at + 15], value = chunk.readUInt32LE(at + 16);
        attrs[name] = raw !== 0xffffffff ? stringAt(raw) : kind === 3 ? stringAt(value) : kind >= 0x10 && kind <= 0x1f ? value : null;
      }
      if (tag === 'manifest') result = {...result, packageName: attrs.package, versionCode: Number(attrs.versionCode), versionName: String(attrs.versionName ?? ''), split: attrs.split || ''};
      if (tag === 'uses-sdk') result.minSdk = Number(attrs.minSdkVersion ?? 1);
      if (tag === 'application' && typeof attrs.label === 'string') result.label = attrs.label;
    }
    position += size;
  }
  if (!validPackage(result.packageName) || !Number.isSafeInteger(result.versionCode) || result.versionCode < 0 || result.split) throw Error('APK is not a supported standalone application.');
  const minSdk = result.minSdk ?? 1;
  if (!Number.isSafeInteger(minSdk) || minSdk < 1) throw Error('APK minimum Android version is unsupported.');
  return {...result, minSdk};
}

export async function inspectApk(handle, size) {
  if (!Number.isSafeInteger(size) || size < 22 || size > 8 * 1024 ** 3) throw Error('APK size is unsupported.');
  const tail = await read(handle, Math.min(size, 65557), size - Math.min(size, 65557));
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break; }
  if (end < 0 || tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6)) throw Error('APK ZIP directory is invalid.');
  const count = tail.readUInt16LE(end + 10), bytes = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
  if (count === 0xffff || bytes > 16 * 1024 * 1024 || offset + bytes > size - 22) throw Error('APK ZIP64 or oversized directory is unsupported.');
  const directory = await read(handle, bytes, offset), abis = new Set();
  let cursor = 0, manifest = null;
  for (let i = 0; i < count; i++) {
    requireRange(directory, cursor, 46);
    if (directory.readUInt32LE(cursor) !== 0x02014b50) throw Error('APK ZIP entry is invalid.');
    const nameLength = directory.readUInt16LE(cursor + 28), extra = directory.readUInt16LE(cursor + 30), comment = directory.readUInt16LE(cursor + 32);
    requireRange(directory, cursor + 46, nameLength + extra + comment);
    const name = directory.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const abi = /^lib\/([^/]+)\/[^/]+\.so$/.exec(name); if (abi) abis.add(abi[1]);
    if (name === 'AndroidManifest.xml') {
      if (manifest) throw Error('APK contains duplicate manifests.');
      manifest = {flags: directory.readUInt16LE(cursor + 8), method: directory.readUInt16LE(cursor + 10), compressed: directory.readUInt32LE(cursor + 20), size: directory.readUInt32LE(cursor + 24), offset: directory.readUInt32LE(cursor + 42)};
    }
    cursor += 46 + nameLength + extra + comment;
  }
  if (!manifest || manifest.flags & 1 || ![0, 8].includes(manifest.method) || manifest.size > MAX_MANIFEST || manifest.compressed > MAX_MANIFEST) throw Error('APK manifest is missing or unsupported.');
  const local = await read(handle, 30, manifest.offset);
  if (local.readUInt32LE(0) !== 0x04034b50) throw Error('APK local entry is invalid.');
  const start = manifest.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  if (start + manifest.compressed > offset) throw Error('APK manifest overlaps its directory.');
  const compressed = await read(handle, manifest.compressed, start);
  const xml = manifest.method === 0 ? compressed : inflateRawSync(compressed, {maxOutputLength: MAX_MANIFEST});
  if (xml.length !== manifest.size) throw Error('APK manifest size is invalid.');
  return {...parseManifest(xml), nativeCode: [...abis].sort().join(', ')};
}
