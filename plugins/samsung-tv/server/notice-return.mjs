/** Bounded foreground observations for one notice; never infer visibility from
 * a running process, retry a launch, or select an arbitrary return argument. */
export const vistaAppId = 'HwGlance01.HomeGlance';
const validId = id => typeof id === 'string' && /^[\w.-]{1,128}$/.test(id);
export async function captureNoticeApp(connection, http, host, signal) {
  try {
    // The installed-app request shares the action's socket/deadline. Status
    // observations get a shorter budget after that request has completed.
    const raw = await connection.apps();signal.throwIfAborted();
    const deadline = AbortSignal.any([signal,AbortSignal.timeout(3500)]);
    if (!Array.isArray(raw) || raw.length > 64) return null;
    const ids = [...new Set(raw.map(app=>String(app?.appId ?? '')).filter(validId))];
    if (!ids.length) return null;
    const visible = [];
    for (let index=0;index<ids.length;index+=4) {
      await Promise.allSettled(ids.slice(index,index+4).map(async id=>{
        const state=await http.app(host,id,'GET',AbortSignal.any([deadline,AbortSignal.timeout(700)]));
        if(state.running===true && state.visible===true)visible.push(id);
      }));
      // Unsupported app endpoints are unknown; only positive visible readings
      // identify a target. A truncated scan or two visible results is ambiguous.
      deadline.throwIfAborted();
    }
    if(visible.length!==1 || visible[0]===vistaAppId)return null;
    const current=await http.app(host,visible[0],'GET',deadline);deadline.throwIfAborted();
    return current.running===true && current.visible===true ? visible[0] : null;
  } catch { signal.throwIfAborted();return null; }
}
export async function returnNoticeApp({appId,http,host,signal,connect,gate}) {
  if(!validId(appId) || appId===vistaAppId)return {restored:false};
  const [vista,target]=await Promise.all([http.app(host,vistaAppId,'GET',signal),http.app(host,appId,'GET',signal)]);
  signal.throwIfAborted();
  if(target.running===true && target.visible===true)return {restored:false,alreadyVisible:true};
  if(vista.running!==true || vista.visible!==true || target.visible!==false)return {restored:false};
  let connection;
  try {
    connection=await connect();await gate();signal.throwIfAborted();
    const current=await http.app(host,vistaAppId,'GET',signal);signal.throwIfAborted();
    if(current.running!==true || current.visible!==true)return {restored:false};
    await connection.send({method:'ms.channel.emit',params:{event:'ed.apps.launch',to:'host',data:{action_type:'NATIVE_LAUNCH',appId,metaTag:''}}});
    return {commandSent:true};
  } finally {connection?.close();}
}
