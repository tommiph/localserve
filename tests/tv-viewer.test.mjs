/** TV bridge accepts only its parent and carries no commands or private data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../assets/tv-viewer.js',import.meta.url),'utf8');
function fixture() {
 const events={},messages=[],moves=[],parent={postMessage(data,origin){messages.push({data,origin});}};
 const window={parent,addEventListener:(name,fn)=>events[name]=fn};
 const document={hidden:false,addEventListener:(name,fn)=>events[name]=fn};
 vm.runInNewContext(source,{window,document,location:{pathname:'/display',search:'',origin:'http://192.168.1.5:7041'}});
 window.LocalserveTvViewer.install(direction=>{moves.push(direction);return true;});
 const probe={type:'localserve-viewer-probe',id:'navigation-1',path:'/display'};
 const message=(data,origin='null',from=parent)=>events.message({data,origin,source:from});
 return {window,document,parent,events,messages,moves,probe,message};
}
test('bridge reports each accepted poll only to its parent session and rejects mismatched sources/origins/paths',()=>{
 const f=fixture();f.window.LocalserveTvViewer.state(true);assert.equal(f.messages.length,0);
 f.message(f.probe,'https://unrelated.example');f.message(f.probe,'null',{});f.message({...f.probe,path:'/other'});
 assert.equal(f.messages.length,0);f.message(f.probe);assert.equal(f.messages.length,1);
 f.window.LocalserveTvViewer.state(true);assert.equal(f.messages.length,2,'Same-state polls renew the heartbeat');
 assert.equal(f.messages[1].data.connected,true);assert.deepEqual(Object.keys(f.messages[1].data),['type','id','path','connected']);
 f.message({type:'localserve-viewer-key',id:'stale',keyCode:39});assert.equal(f.moves.length,0);
 f.message({type:'localserve-viewer-key',id:'navigation-1',keyCode:39});assert.deepEqual(f.moves,[1]);
});
test('direct keys handle repeats, focus, visibility and offline state without hijacking inputs',()=>{
 const f=fixture();f.message(f.probe);f.window.LocalserveTvViewer.state(true);
 let prevented=0;const key=(patch={})=>f.events.keydown({keyCode:37,target:{tagName:'BODY'},preventDefault(){prevented++;},...patch});
 key();assert.deepEqual(f.moves,[-1]);assert.equal(prevented,1);
 key({repeat:true});key({target:{tagName:'INPUT'}});key({target:{isContentEditable:true}});
 f.document.hidden=true;key();f.document.hidden=false;
 f.window.LocalserveTvViewer.state(false);key();assert.deepEqual(f.moves,[-1]);
 f.window.LocalserveTvViewer.state(true);key({keyCode:10009});
 assert.equal(f.messages.at(-1).data.type,'localserve-viewer-back');
});
test('packaged parents can use either opaque or file-origin serialization',()=>{
 for(const origin of ['null','file://']){
  const f=fixture();f.window.LocalserveTvViewer.state(true);f.message(f.probe,origin);
  assert.equal(f.messages.length,1);f.message({type:'localserve-viewer-key',id:f.probe.id,keyCode:37},origin);
  assert.deepEqual(f.moves,[-1]);
 }
});

test('physical settings and media keys stay scoped, consume Back before page handlers and preserve separate Play/Pause meanings',()=>{
 const f=fixture(),pauses=[];f.window.LocalserveTvViewer.install(null,{pause:mode=>pauses.push(mode)});
 const remoteKeys={settings:427,toggle:10252,play:415,pause:19};
 f.message({...f.probe,remoteKeys});
 let stopped=0;const key=code=>f.events.keydown({keyCode:code,target:{tagName:'BODY'},preventDefault(){},stopImmediatePropagation(){stopped++;}});
 key(427);assert.equal(f.messages.at(-1).data.type,'localserve-viewer-settings');
 key(10252);key(415);key(19);assert.deepEqual(pauses,['toggle','play','pause']);
 f.message({type:'localserve-viewer-key',id:'stale',keyCode:10252});assert.equal(pauses.length,3);
 key(10009);assert.equal(f.messages.at(-1).data.type,'localserve-viewer-back');assert.equal(stopped,5);
 f.document.hidden=true;key(427);key(10252);assert.equal(stopped,5);
});
test('modern collection stepping wraps, resets interval deadlines and leaves saved layouts untouched',async()=>{
 let now=0,tick;
 const element=()=>({style:{setProperty(){}},dataset:{},children:[],innerHTML:'',firstElementChild:null,append(v){this.children.push(v);},replaceChildren(v){this.children=[v];}});
 const context=vm.createContext({performance:{now:()=>now},Date,document:{createElement:element},window:{matchMedia:()=>({matches:true})},setInterval:fn=>{tick=fn;return 1;},clearInterval(){},CardRenderer:{render:card=>card.name,mount:(host,markup)=>{host.innerHTML=markup;}}});
 const renderer=vm.runInContext(await fs.readFile(new URL('../web/vista-renderer.js',import.meta.url),'utf8')+'\nVistaRenderer;',context);
 const cards=['A','B','C'].map(id=>({pluginId:'p',cardId:id,card:{id,name:id,fields:[]},data:{status:'Ready',values:{}}}));
 const collection=(id,refs)=>({id,type:'collection',enabled:true,width:'1fr',height:'1fr',rotation:'interval',intervalSeconds:10,animation:'none',cards:refs.map(cardId=>({pluginId:'p',cardId}))});
 const payload={vista:{id:'v',padding:0,gap:0,layout:{id:'root',type:'row',enabled:true,children:[collection('first',['A','B','C']),collection('single',['B'])]}},cards,options:{connected:true}};
 const before=JSON.stringify(payload),host=element(),controller=renderer.create(host);controller.update(payload);
 const panel=host.children[0].children[0];assert.equal(panel.innerHTML,'A');
 assert.equal(controller.step(-1),true);assert.equal(panel.innerHTML,'C');controller.step(1);assert.equal(panel.innerHTML,'A');
 now=9000;controller.step(1);assert.equal(panel.innerHTML,'B');now=10000;tick();assert.equal(panel.innerHTML,'B');now=19000;tick();assert.equal(panel.innerHTML,'C');
 controller.pause(true);now=40000;tick();assert.equal(panel.innerHTML,'C');controller.step(1);assert.equal(panel.innerHTML,'A');
 controller.pause(false);now=49000;tick();assert.equal(panel.innerHTML,'A');now=50000;tick();assert.equal(panel.innerHTML,'B');
 assert.equal(JSON.stringify(payload),before);controller.update({...payload,options:{connected:false}});assert.equal(controller.step(1),false);
 controller.destroy();assert.equal(controller.step(1),false);
});
