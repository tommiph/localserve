/** Generic Controls recipes contain no installation-owned device references. */
export function controlExamples(){
  const item=(id,label,icon,actionId,parameters={},kind='button',parameter=null,binding=null)=>({id,label,icon,kind,enabled:true,parameter,binding,steps:[{id:'command',actionId,parameters}]});
  const keys=[['power','Power','power-off','POWER'],['source','Source','display','SOURCE'],['home','Home','home','HOME'],['up','Up','arrow-up','UP'],['menu','Menu','bars','MENU'],['left','Left','arrow-left','LEFT'],['enter','Enter','check','ENTER'],['right','Right','arrow-right','RIGHT'],['back','Back','arrow-left','RETURN'],['down','Down','arrow-down','DOWN'],['exit','Exit','xmark','EXIT'],['volume-up','Volume +','volume-high','VOLUP'],['volume-down','Volume −','volume-low','VOLDOWN'],['mute','Mute','volume-xmark','MUTE'],['channel-up','Channel +','plus','CHUP'],['channel-down','Channel −','minus','CHDOWN'],['info','Info','circle-info','INFO'],['guide','Guide','list','GUIDE'],['rewind','Rewind','fast-rewind','REWIND'],['forward','Fast forward','forward','FF']];
  const tv=keys.map(([id,label,icon,key])=>item(id,label,icon,'key',{key:'KEY_'+key}));
  for(const id of ['play','pause','stop'])tv.push(item(id,id[0].toUpperCase()+id.slice(1),id,id));
  tv.push(item('volume','Volume','volume-high','volume',{value:20},'range','value',{field:'volume'}));
  tv.push(item('muted','Muted','volume-xmark','mute',{muted:false},'toggle','muted',{field:'muted'}));
  tv.push(item('input','Input','display','input',{input:'TV'},'select','input'));
  tv.push(item('refresh','Refresh','rotate','refresh'));
  const page=(id,name,slug,icon,presentation,items)=>({schemaVersion:1,id,revision:1,name,slug,enabled:false,icon,columns:3,presentation,items});
  return {'samsung-tv':page('example-tv-remote','TV remote example','remote','display','television',tv),tradfri:page('example-lighting-remote','Lights example','lights','lightbulb','lighting',[])};
}
