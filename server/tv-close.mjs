/** A short-lived close request is visible only to the configured TV peer.
 * No request survives timeout, cancellation, restart or changed execution gates. */
import {randomBytes} from 'node:crypto';
export class TvCloseRequests {
  constructor({timeout=8000}={}){this.timeout=timeout;this.pending=null;}
  request(host,check,signal){
    check();signal.throwIfAborted();
    if(this.pending)throw Error('A Localserve TV close request is already pending.');
    return new Promise((resolve,reject)=>{
      const ticket={id:randomBytes(16).toString('hex'),token:randomBytes(24).toString('hex')};
      const finish=(value,error)=>{
        if(this.pending?.ticket!==ticket)return;
        clearTimeout(timer);signal.removeEventListener('abort',abort);this.pending=null;
        if(error)reject(error);else resolve(value);
      };
      const abort=()=>finish(false,signal.reason||Error('TV close cancelled.'));
      const timer=setTimeout(()=>{try{check();finish(false);}catch(error){finish(false,error);}},this.timeout);
      this.pending={host,check,ticket,finish};signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted)abort();
    });
  }
  current(peer){
    const pending=this.pending;
    if(!pending||pending.host!==String(peer).replace(/^::ffff:/,''))return null;
    try{pending.check();return pending;}catch(error){pending.finish(false,error);return null;}
  }
  poll(peer){return this.current(peer)?.ticket || null;}
  acknowledge(peer,values){
    const pending=this.current(peer);
    if(!pending||!values||Object.keys(values).some(key=>!['id','token'].includes(key))
      ||values.id!==pending.ticket.id||values.token!==pending.ticket.token)return false;
    pending.finish(true);return true;
  }
  close(){this.pending?.finish(false,Error('Localserve is stopping.'));}
}
