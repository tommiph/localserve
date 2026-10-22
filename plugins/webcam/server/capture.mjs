/** A single owned Windows helper; EOF/heartbeat cleanup never targets another camera process. */
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {FrameAnalyzer} from './analyzer.mjs';
const executable = fileURLToPath(new URL('../native/Capture.exe', import.meta.url));
export class CameraCapture {
  constructor(settings, {launch = spawn, now = Date.now} = {}) {
    this.settings = settings; this.launch = launch; this.now = now;
    this.analyzer = new FrameAnalyzer(settings); this.latest = null; this.error = null; this.closed = false;
    this.child = launch(executable, [settings['device-index'], settings.width, settings.height, settings.fps, settings.quality].map(String),
      {windowsHide: true, stdio: ['pipe','pipe','pipe'], shell: false});
    this.exited = new Promise(resolve => this.child.once('close', resolve));
    this.child.stdin.on('error', () => {}); this.child.stderr.resume();
    let buffer = '', sequence = 0;
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      if (this.closed) return;
      buffer += chunk;
      if (buffer.length > 900000) { this.error = Error('Camera frame exceeded its limit.'); void this.close(); return; }
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0,end); buffer = buffer.slice(end+1);
        try {
          const frame = JSON.parse(line);
          if (!Number.isSafeInteger(frame.sequence) || frame.sequence <= sequence || !Number.isInteger(frame.width)
            || !Number.isInteger(frame.height) || frame.width < 1 || frame.height < 1 || frame.width > 1280 || frame.height > 720
            || typeof frame.jpeg !== 'string' || frame.jpeg.length > 700000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(frame.jpeg)
            || typeof frame.grey !== 'string' || frame.grey.length !== 1024 || !/^[A-Za-z0-9+/]+$/.test(frame.grey)) throw Error('Invalid frame.');
          const grey = Buffer.from(frame.grey,'base64'), jpeg = Buffer.from(frame.jpeg,'base64');
          if (grey.length !== 768 || jpeg.length < 4 || jpeg.length > 512*1024 || jpeg[0]!==255 || jpeg[1]!==216 || jpeg.at(-2)!==255 || jpeg.at(-1)!==217) throw Error('Invalid pixels.');
          const at = now(); this.analyzer.accept(grey, at); sequence = frame.sequence;
          this.latest = {jpeg:frame.jpeg, at, width:frame.width, height:frame.height};
        } catch { this.error = Error('Camera returned an invalid frame.'); void this.close(); return; }
      }
    });
    this.child.once('error', () => { this.error = Error('Bundled webcam helper could not start.'); });
    this.child.once('close', () => { this.closed = true; this.latest = null; this.error ||= Error('Webcam disconnected or capture stopped.'); });
    this.ping();
  }
  ping() { if (!this.closed && this.child.stdin.writable) this.child.stdin.write('ping\n'); }
  preview() { return !this.closed && this.latest && this.now()-this.latest.at <= 2500 ? this.latest : null; }
  async frame(signal) {
    this.ping(); const deadline = this.now()+6000;
    while (!this.preview()) {
      signal.throwIfAborted();
      if (this.error || this.closed || this.now()>deadline) throw this.error || Error('No camera frames. Check Windows camera privacy and other camera apps.');
      await new Promise(resolve => setTimeout(resolve,40));
    }
    signal.throwIfAborted(); return {...this.analyzer.current, width:this.latest.width, height:this.latest.height};
  }
  async close() {
    if (this.closing) return this.closing;
    this.closed = true; this.latest = null;
    this.closing = (async () => {
      if (!this.child.stdin.destroyed) this.child.stdin.end('stop\n');
      let timer;
      try { await Promise.race([this.exited, new Promise(resolve => {timer=setTimeout(() => {this.child.kill();resolve();},1200);})]); }
      finally {clearTimeout(timer);}
    })(); return this.closing;
  }
}

export async function listCameras(signal) {
  return new Promise((resolve,reject) => {
    const child=spawn(executable,['--list'],{windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false});
    let output='',failed;
    const stop=()=>child.kill(); const timer=setTimeout(()=>{failed=Error('Camera enumeration timed out.');stop();},4000);
    child.stdout.setEncoding('utf8');child.stderr.resume();
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>16384){failed=Error('Camera list exceeded its limit.');stop();}});
    child.once('error',()=>{failed=Error('Webcam helper unavailable.');});
    signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();
    child.once('close',code=>{clearTimeout(timer);signal.removeEventListener('abort',stop);
      if(signal.aborted)return reject(signal.reason);if(failed||code!==0)return reject(failed||Error('Camera enumeration failed.'));
      try {const values=JSON.parse(output).devices;if(!Array.isArray(values)||values.length>32||values.some(row=>!Number.isInteger(row.index)||row.index<0||row.index>31||typeof row.name!=='string'||row.name.length>128))throw Error();resolve(values);}
      catch {reject(Error('Camera list was invalid.'));}
    });
  });
}
