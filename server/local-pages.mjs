/** Resolve only contained project display HTML, without HTTP/DNS or credentials. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {HttpError} from './storage.mjs';

export function localDisplayPath(value) {
  return typeof value === 'string' && value.length <= 2000
    && /^\/assets\/pages\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.html$/.test(value) ? value : null;
}

export async function requireLocalDisplay(root, value) {
  if (!localDisplayPath(value)) throw new HttpError(400, 'Choose an HTML page under /assets/pages/.');
  try {
    const assets = await fs.realpath(path.join(root, 'assets'));
    const base = await fs.realpath(path.join(root, 'assets/pages'));
    const file = await fs.realpath(path.join(root, value.slice(1)));
    const realRoot = await fs.realpath(root);
    if (!assets.startsWith(realRoot + path.sep) || !base.startsWith(assets + path.sep)
      || !file.startsWith(base + path.sep) || !(await fs.stat(file)).isFile()) throw new Error();
    return file;
  } catch {throw new HttpError(404, 'Local display page not found inside assets/pages/.');}
}

/** Universe is a fixed public server route, not a member of the opaque custom
 * HTML sandbox. Keep that route's serving/CSP policy separate from assets/pages. */
export async function requireUniverseDisplay(root) {
  try {
    const realRoot = await fs.realpath(root);
    const web = await fs.realpath(path.join(root, 'web'));
    const file = await fs.realpath(path.join(root, 'web/universe.html'));
    if (!web.startsWith(realRoot + path.sep) || !file.startsWith(web + path.sep)
      || !(await fs.stat(file)).isFile()) throw new Error();
    return file;
  } catch { throw new HttpError(404, 'Universe display page is unavailable.'); }
}

/** Fixed read-only phone viewer; never admit arbitrary web files or API URLs. */
export async function requirePhoneDisplay(root) {
  try {
    const base=await fs.realpath(root),web=await fs.realpath(path.join(root,'web'));
    const file=await fs.realpath(path.join(root,'web/phone-information.html'));
    if(!web.startsWith(base+path.sep)||!file.startsWith(web+path.sep)||!(await fs.stat(file)).isFile())throw new Error();
    return file;
  } catch {throw new HttpError(404,'Phone information display is unavailable.');}
}
