/** Published views keep their existing capabilities; all other API routes require administration. */
export const administratorPages=new Set(['/','/index.html','/map-editor','/devices','/vr-library','/lighting-animations','/controller-setup','/lighting-scenes','/remotes','/downloads']);
export function publicAccessRoute(name,method){
  const read=['GET','HEAD'].includes(method);
  if(read&&new Set(['/api/control-view','/api/watch-guide','/api/portal','/api/control-room','/api/home-map','/api/launcher','/api/launcher/artwork','/api/phone-home','/api/scene-selector','/api/controller/status','/api/display','/api/universe','/api/games/maze','/api/phone-information','/api/playstation-mode','/api/vr-library/client-apk']).has(name))return true;
  if(read&&(/^\/api\/watch-art\/(movies|emby)\/[a-f0-9]{40}\/(poster|backdrop)\.jpg$/.test(name)||/^\/api\/home-map\/image\/[a-f0-9]{64}\.png$/.test(name)||/^\/api\/vistas\/[a-z0-9-]+$/.test(name)||/^\/api\/phone-home\/cards\/[a-z0-9-]{1,80}\/[a-z0-9-]{1,80}\/[a-z0-9-]{1,80}$/.test(name)||/^\/api\/phone-home\/receipts\/[a-f0-9-]{36}$/.test(name)))return true;
  if(/^\/api\/tv-notices\/[a-f0-9]{48}$/.test(name))return read||method==='POST';
  if(/^\/api\/control-view\/[a-z0-9-]+\/[a-z0-9-]+$/.test(name))return read;
  if(method==='POST'&&(/^\/api\/control-view\/[a-z0-9-]+\/[a-z0-9-]+\/(run|cancel|scene)$/.test(name)||['/api/phone-home/run','/api/sensors/report','/api/controller/connection','/api/vr-client/enroll','/api/playstation-mode/close'].includes(name)))return true;
  return false;
}
export const loginReturn=value=>administratorPages.has(value)?value:'/';
