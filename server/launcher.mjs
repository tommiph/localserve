/** Public TV navigation uses display metadata and existing published shortcut
 * capabilities. It never exports plugin settings or administrator tokens. */
export function launcherView({phoneHome,controls,vistas,universe,games,version,now=Date.now()}) {
  const home=phoneHome.viewer(true);
  const displays=[{id:'display',name:'Vistas',path:'/display',icon:'dashboard',detail:'Your selected display'}];
  for(const vista of vistas.snapshot().filter(item=>item.enabled))displays.push({id:'vista:'+vista.id,name:vista.name,path:'/vistas/'+vista.slug,icon:'view-quilt',detail:'Vista'});
  if(universe.snapshot().enabled)displays.push({id:'universe',name:'Universes',path:'/universe',icon:'public',detail:'Immersive worlds'});
  if(games.snapshot().enabled)displays.push({id:'maze',name:'Neon maze',path:'/games/maze',icon:'sports-esports',detail:'An endless maze'});
  return {name:home.name,version,paused:home.paused,revision:home.revision,
    scenes:home.scenes,tasks:home.tasks,displays,
    options:{timeFormat:controls.options().timeFormat,timeZone:new Intl.DateTimeFormat().resolvedOptions().timeZone,now}};
}
