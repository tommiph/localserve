/** Serialized atomic JSON persistence, and durable activity records. */
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export class JsonStore {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.queue = Promise.resolve();
  }
  async load() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try { this.value = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) {
      // Seed only missing files. Invalid JSON or unreadable files require repair;
      // replacing them with defaults would destroy the user's saved data.
      if (error.code !== 'ENOENT') throw new Error(`Cannot read ${path.basename(this.file)}; original data was retained.`, { cause: error });
      this.value = structuredClone(this.defaults);
      await this.write(this.value);
    }
    return this;
  }
  // Callers can inspect or edit a copy without mutating the committed store.
  snapshot() { return structuredClone(this.value); }
  async write(value) {
    // The temporary file shares the destination directory so rename stays on
    // the same filesystem. Sync and close its contents before replacing JSON.
    // This is file replacement, not a transaction across all project stores.
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temporary, 'wx');
      try {
        await handle.writeFile(JSON.stringify(value, null, 2) + '\n');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, this.file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  update(change) {
    // Take the snapshot when the queued operation begins, not when requested.
    // Each writer therefore sees the result of the previous successful write.
    const operation = this.queue.then(async () => {
      const next = this.snapshot();
      const result = await change(next);
      await this.write(next);
      // Publish in memory only after disk replacement succeeds.
      this.value = next;
      return result;
    });
    // The caller receives failures through operation; the queue must recover
    // so one failed save does not prevent every subsequent save.
    this.queue = operation.catch(() => {});
    return operation;
  }
}

export class ActivityLog {
  constructor(file, limit = 2000, options = {}) {
    this.file = file;
    this.limit = limit;
    this.entries = [];
    this.queue = Promise.resolve();
    this.retentionDays = options.retentionDays || (() => 30);
    this.now = options.now || Date.now;
    this.nextExpiry = 0;
  }
  async load() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await this.prune(true);
    return this;
  }
  prune(force = false) {
    // Compaction shares the append queue. A concurrent append cannot land in
    // the replaced file or disappear between the read and atomic rename.
    const operation = this.queue.then(() => this.compact(force)).catch(error => {
      this.nextExpiry = 0; // Retry failed cleanup on the next maintenance pass.
      throw error;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async compact(force) {
    const now = this.now();
    if (!force && now < this.nextExpiry) return;
    const duration = this.retentionDays() * 86400000;
    const cutoff = now - duration;
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    let output, input, lines, buffer = '', removed = false, nextExpiry = Infinity;
    let entries = [];
    try {
      // Stream the whole retained history, not just the UI's recent-entry cache.
      // The private file is checked by its owner before load; no paths come from
      // the retention setting. Unknown/malformed dates are never guessed/deleted.
      try { await fs.access(this.file); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        this.entries = []; this.nextExpiry = Infinity; return;
      }
      output = await fs.open(temporary, 'wx');
      input = createReadStream(this.file, { encoding: 'utf8' });
      lines = createInterface({ input, crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line.trim()) continue; // Append separators carry no history.
        let entry;
        try { entry = JSON.parse(line); } catch { /* Preserve interrupted/unknown records on disk. */ }
        const dated = Number.isFinite(entry?.at);
        if (dated && entry.at < cutoff) { removed = true; continue; }
        if (dated) nextExpiry = Math.min(nextExpiry, entry.at + duration + 1);
        if (entry && typeof entry === 'object') entries.push(entry);
        if (entries.length > this.limit * 2) entries = entries.slice(-this.limit);
        buffer += line + '\n';
        if (buffer.length >= 65536) { await output.writeFile(buffer); buffer = ''; }
      }
      if (buffer) await output.writeFile(buffer);
      if (removed) await output.sync();
      await output.close(); output = null;
      // Publish the filtered cache only after successful file replacement.
      // Failure leaves the original history and cache intact, with a retry due.
      if (removed) await fs.rename(temporary, this.file);
      this.entries = entries.slice(-this.limit);
      this.nextExpiry = nextExpiry;
    } finally {
      lines?.close(); input?.destroy();
      await output?.close();
      await fs.rm(temporary, { force: true });
    }
  }
  add(message, fields = {}) {
    // Serialize appends and publish only after appendFile succeeds. Appends are
    // not explicitly fsynced, so sudden power loss can still lose recent lines.
    const entry = { id: randomUUID(), at: this.now(), level: 'info', source: 'Server', ...fields, message: String(message).slice(0, 4000) };
    const operation = this.queue.then(async () => {
      // Leading newline isolates any partial record left by an interrupted append.
      await fs.appendFile(this.file, '\n' + JSON.stringify(entry) + '\n');
      this.entries.push(entry);
      this.entries = this.entries.slice(-this.limit);
      if (Number.isFinite(entry.at)) this.nextExpiry = Math.min(this.nextExpiry, entry.at + this.retentionDays() * 86400000 + 1);
      return entry;
    });
    // Preserve per-call errors while allowing later Activity writes to proceed.
    this.queue = operation.catch(() => {});
    return operation;
  }
  // Hide expired rows immediately; the periodic pass removes them from disk.
  latest() {
    const cutoff = this.now() - this.retentionDays() * 86400000;
    return this.entries.filter(entry => !Number.isFinite(entry.at) || entry.at >= cutoff).reverse();
  }
}
