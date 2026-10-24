/** One temporary TV notice. Launch/return claims commit before effects; this
 * store retains no credentials and cannot replay a return after a restart. */
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { JsonStore, HttpError } from './storage.mjs';
import { isPrivateIPv4 } from './network.mjs';

export const noticeTypes = ['Notice', 'Alarm', 'Alert', 'Warning'];
export function validateNotice(value) {
  if (!value || Object.keys(value).some(key => !['template', 'title', 'message', 'seconds', 'sound', 'auto-close', 'loop-sound'].includes(key))
    || !noticeTypes.includes(value.template) || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120
    || typeof value.message !== 'string' || !value.message.trim() || value.message.length > 2000
    || !Number.isFinite(value.seconds) || value.seconds < 1 || value.seconds > 3600 || typeof value.sound !== 'boolean'
    || value['auto-close'] !== undefined && typeof value['auto-close'] !== 'boolean'
    || value['loop-sound'] !== undefined && typeof value['loop-sound'] !== 'boolean') {
    throw new HttpError(400, 'Choose a notice template, title, message, sound and 1–3600 seconds.');
  }
  return {template: value.template, title: value.title.trim(), message: value.message.trim(), seconds: value.seconds, sound: value.sound,
    'auto-close': value['auto-close'] !== false, 'loop-sound': value['loop-sound'] === true};
}

export class TvNotices {
  constructor(root, config, address, now = Date.now) {
    this.store = new JsonStore(path.join(root, 'data/tv-notice.json'), {notice: null, revision: 0});
    this.config = config;
    this.address = address;
    this.now = now;
    this.returns = new Map();
  }
  async load() {
    await this.store.load();
    const revision = this.store.snapshot().revision;
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 0)) throw new Error('Invalid TV notice revision; original file retained.');
    const current = this.store.snapshot().notice;
    if (current) {
      const content = validateNotice(current.content);
      const persistent = current.status === 'shown' && !content['auto-close'];
      if (!/^[a-f0-9]{48}$/.test(current.id) || !['reserved', 'shown', 'dismissing','finishing'].includes(current.status)
        || (persistent ? current.expiresAt !== null || current.endsAt !== null || !Number.isFinite(current.shownAt)
          : !Number.isFinite(current.expiresAt) || current.expiresAt > this.now() + 3625000
            || current.status === 'shown' && !Number.isFinite(current.endsAt))) throw new Error('Invalid TV notice state; original file retained.');
      if (current.audioStatus !== undefined && !['playing', 'unavailable'].includes(current.audioStatus)) throw new Error('Invalid TV notice audio reception.');
      if(current.returnTarget && (typeof current.returnTarget.appId!=='string' || !/^[\w.-]{1,128}$/.test(current.returnTarget.appId)
        || typeof current.returnTarget.used!=='boolean'))throw new Error('Invalid notice return claim.');
    }
    await this.expire();
    return this;
  }
  async create(content, signal) {
    content = validateNotice(content);
    const config = this.config.snapshot(), port = this.address()?.port;
    if (!isPrivateIPv4(config.listen.host) || !port) throw new HttpError(409, 'Configure a private LAN server address before showing TV notices.');
    let notice;
    await this.store.update(current => {
      signal?.throwIfAborted();
      if (this.active(current.notice)) throw new HttpError(409, 'A TV notice is already active. Dismiss it or wait for it to close.');
      notice = { id: randomBytes(24).toString('hex'), content, status: 'reserved',
        expiresAt: this.now() + (content['auto-close'] ? content.seconds + 25 : 25) * 1000 };
      current.notice = notice;
      this.returns.clear();
      current.revision = (current.revision || 0) + 1;
    });
    // A failure after this commit keeps the lease: a delivered command can have
    // an uncertain outcome. Never retry/reuse it or place content in launch URLs.
    signal?.throwIfAborted();
    return `http://${config.listen.host}:${port}/tv-notices/${notice.id}?seconds=${content['auto-close'] ? content.seconds : 0}`;
  }
  active(notice) { return Boolean(notice && (notice.expiresAt === null || notice.expiresAt > this.now())); }
  async captureReturn(id,appId,restore) {
    if(typeof appId!=='string' || !/^[\w.-]{1,128}$/.test(appId) || appId==='HwGlance01.HomeGlance' || typeof restore!=='function')throw new Error('Invalid notice return target.');
    await this.store.update(current=>{
      if(!this.active(current.notice) || current.notice.id!==id || current.notice.status!=='reserved' || current.notice.returnTarget)throw new Error('Notice return was already captured.');
      current.notice.returnTarget={appId,used:false};
    });
    this.returns.set(id,restore);
  }
  current(id) {
    const notice = this.store.snapshot().notice;
    if (!this.active(notice) || notice.id !== id) throw new HttpError(404, 'TV notice unavailable.');
    return notice;
  }
  view(id) {
    const notice = this.current(id), config = this.config.snapshot();
    return { id, ...validateNotice(notice.content), status: notice.status, dismissed: ['dismissing','finishing'].includes(notice.status),
      elapsedMs: notice.status === 'shown' ? Math.max(0, this.now() - (notice.shownAt ?? notice.endsAt - notice.content.seconds * 1000)) : 0,
      remainingMs: notice.content['auto-close'] === false ? null : notice.status === 'shown' ? Math.max(0, notice.endsAt - this.now()) : notice.content.seconds * 1000,
      fontScale: config.vistaFontScale, serverName: config.name };
  }
  admin() {
    const {notice, revision = 0} = this.store.snapshot();
    return {revision, active: this.active(notice), ...(this.active(notice) ? {
      autoClose: notice.content['auto-close'] !== false, shownAt: notice.shownAt ?? null, dismissing: notice.status === 'dismissing',
    } : {})};
  }
  async dismiss(revision) {
    await this.store.update(current => {
      if (!Number.isSafeInteger(revision) || revision !== (current.revision || 0)) throw new HttpError(409, 'The active TV notice changed. Refresh before dismissing.');
      if (this.active(current.notice) && current.notice.status!=='finishing') {
        // Reserve a short closing window so another Task cannot race the TV's
        // five-second dismissal poll. Offline/stale screens cannot block forever
        // after the administrator explicitly requests closure.
        current.notice.status = 'dismissing';
        current.notice.expiresAt = this.now() + 10000;
      } else if(!this.active(current.notice)) current.notice = null;
      current.revision = (current.revision || 0) + 1;
    });
  }
  async report(id, status) {
    if (!['shown', 'finished','abandoned', 'sound-playing', 'sound-unavailable'].includes(status)) throw new HttpError(400, 'Invalid notice reception.');
    let first = false,finish=false,restore;
    await this.store.update(current => {
      this.current(id);
      if (status === 'finished' || status==='abandoned') {
        if(current.notice.status==='finishing')return;
        finish=true;
        if(status==='finished' && ['shown','dismissing'].includes(current.notice.status) && Number.isFinite(current.notice.shownAt)
          && current.notice.returnTarget && !current.notice.returnTarget.used)restore=this.returns.get(id);
        if(current.notice.returnTarget)current.notice.returnTarget.used=true;
        current.notice.status='finishing';current.notice.expiresAt=this.now()+10000;
        current.revision=(current.revision||0)+1;return;
      }
      if (status.startsWith('sound-')) {
        if (current.notice.status !== 'shown' || !current.notice.content.sound) throw new HttpError(409, 'This notice has no active sound.');
        // Reception reports browser playback, not audible volume or a TV state.
        if (!current.notice.audioStatus || status === 'sound-unavailable') current.notice.audioStatus = status.slice(6);
        return;
      }
      if (current.notice.status === 'reserved') {
        // Commit the one-shot sound claim before the page attempts playback.
        current.notice.status = 'shown';
        current.notice.shownAt = this.now();
        // One bounded record remains until explicit dismissal. A server outage
        // must neither close an untimed screen nor admit a second notice over it.
        current.notice.endsAt = current.notice.content['auto-close'] === false ? null : this.now() + current.notice.content.seconds * 1000;
        current.notice.expiresAt = current.notice.endsAt === null ? null : current.notice.endsAt + 5000;
        first = true;
      }
    });
    if(status==='finished' || status==='abandoned') {
      if(finish){
        this.returns.delete(id);
        // Consumption is durable before effects. Restart loses the callback;
        // it cannot replay a return or expose its target through the public URL.
        try {if(restore)await restore();}catch{}
        finally{await this.store.update(current=>{if(current.notice?.id===id){current.notice=null;current.revision=(current.revision||0)+1;}});}
      }
      return {finished:true};
    }
    return { ...this.view(id), first };
  }
  async expire() {
    const current = this.store.snapshot().notice;
    if (current && current.expiresAt !== null && current.expiresAt <= this.now()) await this.store.update(value => {
      if (value.notice && value.notice.expiresAt !== null && value.notice.expiresAt <= this.now()) {
        this.returns.delete(value.notice.id);
        value.notice = null; value.revision = (value.revision || 0) + 1;
      }
    });
  }
}
