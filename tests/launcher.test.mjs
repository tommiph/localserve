/** Isolated TV shell, native-plane and public navigation behavior. No device
 * connection, application launch, installed settings or provider is used. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {launcherView} from '../server/launcher.mjs';
import {createLocalserve} from '../server.mjs';
import {productDownload,sourceZip} from '../server/downloads.mjs';
import {LauncherArtwork} from '../server/launcher-artwork.mjs';
import {hubImage,hubPath,readLauncherArtwork} from '../plugins/samsung-tv/server/launcher-artwork.mjs';
import {EventEmitter} from 'node:events';

const folder='tv-tizen/launcher/app/',provider='http://192.168.50.10:7041/assets/launcher/index.html';
const acorn={exports:{}};
vm.runInNewContext(process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'],{module:acorn,exports:acorn.exports});

function fixture(saved=null,control=null,priorRequest=null) {
  const listeners={},timers=new Map(),nodes={},frames=[],launched=[],registered=[];
  let clock=0,next=0,exits=0;
  const context={document:{hidden:false,activeElement:null,getElementById:id=>nodes[id],addEventListener:(name,fn)=>listeners[name]=fn},
    window:{addEventListener:(name,fn)=>listeners[name]=fn},
    localStorage:{getItem:key=>key==='sormus.launcher.last-request.v1'?priorRequest:saved,setItem:(key,value)=>{if(key==='sormus.launcher.last-request.v1')priorRequest=value;else saved=value;}},
    setTimeout:(fn,delay)=>{const id=++next;timers.set(id,{fn,at:clock+delay});return id;},clearTimeout:id=>timers.delete(id),
    tizen:{tvinputdevice:{getSupportedKeys:()=>[{name:'ChannelUp',code:427},{name:'ChannelDown',code:428},{name:'ColorF0Red',code:403}],registerKey:name=>registered.push(name)},
      application:{getCurrentApplication:()=>({getRequestedAppControl:()=>control?{appControl:control}:null,exit:()=>exits++}),
        getAppsInfo:callback=>callback([{id:'known.App',name:'Example'},{id:'SormusL001.Launcher',name:'Self'},{id:'secret.Tool',name:'Hidden',show:false},{id:'HwGlance01.HomeGlance',name:'Sormus Vistas'}]),
        launch:(id,ok,error)=>launched.push({id,ok,error}),launchAppControl:(value,id,ok)=>launched.push({value,id,ok})},
      ApplicationControl:function(operation,uri){this.operation=operation;this.uri=uri;}}};
  for(const id of ['cover','splash','settings','status','host','port','protocol','return','save','retry'])nodes[id]={id,hidden:id==='settings',value:'',readOnly:true,tagName:id==='host'||id==='port'?'INPUT':'BUTTON',blur(){context.document.activeElement=null;this.blurs=(this.blurs||0)+1;},focus(){context.document.activeElement=this;this.focuses=(this.focuses||0)+1;},click(){this.onclick?.();}};
  nodes.settings.querySelectorAll=()=>['protocol','host','port','save','retry','return'].map(id=>nodes[id]);
  context.document.body={insertBefore(frame){frame.parentNode=this;frames.push(frame);},removeChild(frame){frames.splice(frames.indexOf(frame),1);}};
  context.document.createElement=name=>name==='iframe'?{messages:[],setAttribute(name,value){this[name]=value;},focus(){},contentWindow:{postMessage(data,origin){this.owner.messages.push({data,origin});}}}:{
    set href(value){try{this.url=new URL(value);}catch{}},get href(){return this.url?.href||'';},get hostname(){return this.url?.hostname||'';},get protocol(){return this.url?.protocol||'';},get host(){return this.url?.host||'';},get port(){return this.url?.port||'';},get pathname(){return this.url?.pathname||'';},get search(){return this.url?.search||'';},get hash(){return this.url?.hash||'';}};
  const make=context.document.createElement;
  context.document.createElement=name=>{const value=make(name);if(name==='iframe')value.contentWindow.owner=value;return value;};
  vm.createContext(context);
  for(const file of ['url-target.js','inputs.js','icons.js','launch.js'])vm.runInContext(fs.readFileSync(folder+file,'utf8'),context);
  const current=()=>frames.at(-1);
  return {nodes,context,launched,registered,get frame(){return current();},get saved(){return saved;},get exits(){return exits;},
    advance(ms){const end=clock+ms;for(;;){const due=[...timers].filter(([,value])=>value.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;clock=due[1].at;timers.delete(due[0]);due[1].fn();}clock=end;},
    key(code){let prevented=false;listeners.keydown({keyCode:code,preventDefault(){prevented=true;},stopPropagation(){}});return prevented;},
    message(type,extra={},origin=new URL(provider).origin,frame=current()){
      if(!frame.messages.length)frame.onload();const challenge=frame.messages.find(item=>item.data.type==='sormus-launcher-probe').data.challenge;
      listeners.message({source:frame.contentWindow,origin,data:{type,challenge,...extra}});
    },
    launch(value){control=value;listeners.appcontrol();},
    hide(){context.document.hidden=true;listeners.visibilitychange();},show(){context.document.hidden=false;listeners.visibilitychange();}};
}

test('launcher scripts parse as ES5 and unconfigured startup keeps its splash for exactly thirty seconds',()=>{
  for(const file of ['launch.js','inputs.js','url-target.js','icons.js'])acorn.exports.parse(fs.readFileSync(folder+file,'utf8'),{ecmaVersion:5});
  for(const file of ['launcher.js','model.js','navigation.js'])acorn.exports.parse(fs.readFileSync('assets/launcher/'+file,'utf8'),{ecmaVersion:5});
  const f=fixture();f.advance(29999);assert.equal(f.nodes.settings.hidden,true);f.advance(1);assert.equal(f.nodes.settings.hidden,false);assert.equal(f.nodes.host.readOnly,true);
  assert.deepEqual(f.registered,[],'Only mandatory arrows, OK and Return are used');
});

test('real app-control wrapper supplies the durable provider, while arbitrary pages are rejected',()=>{
  const f=fixture(null,{uri:provider});assert.equal(f.frame.src,provider);assert.equal(f.saved,provider);
  assert.equal(f.frame.sandbox,'allow-scripts allow-same-origin');
  f.launch({uri:'http://192.168.50.10:7041/'});assert.equal(f.frame.src,provider);
  const g=fixture('javascript:alert(1)');assert.equal(g.frame,undefined);
  g.advance(30000);assert.equal(g.nodes.settings.hidden,false);
});

test('only current-origin current-frame readiness dismisses the splash; settings drafts and hidden time survive',()=>{
  const f=fixture(provider),old=f.frame;
  f.message('sormus-launcher-ready',{},'https://foreign.example');f.advance(30000);assert.equal(f.nodes.settings.hidden,false);
  f.nodes.host.value='draft.local';f.message('sormus-launcher-ready');assert.equal(f.nodes.host.value,'draft.local');assert.equal(f.nodes.cover.hidden,false);
  f.nodes.return.onclick();assert.equal(f.nodes.cover.hidden,true);
  f.hide();f.advance(30000);assert.equal(f.nodes.cover.hidden,true);f.show();f.message('sormus-launcher-ready');
  f.message('sormus-launcher-refresh');assert.notEqual(f.frame,old);f.message('sormus-launcher-ready',{},new URL(provider).origin,old);f.advance(30000);assert.equal(f.nodes.cover.hidden,false);
});

test('connection loss retains the current frame for thirty seconds; recovery resets the wait without replaying actions',()=>{
  const f=fixture(provider),frame=f.frame;
  f.message('sormus-launcher-ready');f.advance(29999);
  assert.equal(f.nodes.cover.hidden,true);assert.equal(f.nodes.settings.hidden,true);assert.equal(f.frame,frame);
  f.message('sormus-launcher-ready');f.advance(29999);assert.equal(f.nodes.cover.hidden,true);
  f.advance(1);assert.equal(f.nodes.settings.hidden,false);assert.equal(f.nodes.cover.hidden,false);assert.equal(f.frame,frame);
  assert.equal(f.launched.length,0);
  f.nodes.host.value='keep-draft.local';f.message('sormus-launcher-ready');
  assert.equal(f.nodes.host.value,'keep-draft.local');assert.equal(f.nodes.settings.hidden,false);
  f.nodes.return.onclick();assert.equal(f.nodes.cover.hidden,true);
  f.message('sormus-launcher-settings');assert.equal(f.nodes.settings.hidden,false,'Explicit settings opens immediately');
});

test('native launches require a current healthy provider and a discovered visible app; ambiguous launches never replay',()=>{
  const f=fixture(provider);f.message('sormus-launcher-inventory');f.message('sormus-launcher-launch',{id:'known.App'});assert.equal(f.launched.length,0);
  f.message('sormus-launcher-ready');f.message('sormus-launcher-launch',{id:'secret.Tool'});f.message('sormus-launcher-launch',{id:'arbitrary.App'});assert.equal(f.launched.length,0);
  f.message('sormus-launcher-launch',{id:'known.App'});f.message('sormus-launcher-launch',{id:'known.App'});assert.equal(f.launched.length,1);
  f.advance(8000);assert.equal(f.launched.length,1);f.advance(30000);assert.equal(f.launched.length,1);
});

test('display opens are restricted to the current provider and installed Vistas; remote fields need OK',()=>{
  const f=fixture(provider);f.message('sormus-launcher-ready');f.message('sormus-launcher-inventory');
  f.message('sormus-launcher-display',{path:'https://foreign.example/'});f.message('sormus-launcher-display',{path:'/api/state'});assert.equal(f.launched.length,0);
  f.message('sormus-launcher-display',{path:'/vistas/example'});assert.equal(f.launched[0].id,'HwGlance01.HomeGlance');assert.equal(f.launched[0].value.uri,'http://192.168.50.10:7041/vistas/example');
  f.message('sormus-launcher-settings');assert.equal(f.nodes.host.readOnly,true);f.key(13);assert.equal(f.nodes.host.readOnly,false);f.key(40);assert.equal(f.nodes.host.readOnly,false);f.key(65376);assert.equal(f.nodes.host.readOnly,true);
});

test('full-screen input cancellation drains a late native show once and never repeats source selection',()=>{
  const calls=[],callbacks={};
  const api={systeminfo:{getPropertyValue(name,ok){ok({connected:[{type:'HDMI',number:1}],disconnected:[{type:'HDMI',number:1},{type:'HDMI',number:2}]});}},tvwindow:{
    setSource(source,ok){calls.push(['source',source.number]);callbacks.source=ok;},show(ok,error,rect){calls.push(['show',...rect]);callbacks.show=ok;},hide(ok){calls.push(['hide']);ok();}}};
  const context=vm.createContext({});vm.runInContext(fs.readFileSync(folder+'inputs.js','utf8'),context);
  const reports=[],input=context.LauncherInputs.create(api,value=>reports.push(value));input.read();assert.equal(reports[0].sources.length,2);
  assert.equal(reports[0].sources[0].id,'HDMI:1');
  assert.equal(input.open('HDMI:1'),true);callbacks.source();input.hide();callbacks.show();assert.equal(input.active(),false);
  assert.deepEqual(calls,[['source',1],['show','0%','0%','100%','100%'],['hide']]);
});

test('favorites retain absent identities without storing capabilities and preferences are bounded',()=>{
  const context=vm.createContext({});vm.runInContext(fs.readFileSync('assets/launcher/model.js','utf8'),context);const model=context.SormusLauncherModel;
  const prefs=model.preferences({theme:'bad',favorites:['app:one','app:one','app:missing','https://example.com'],customized:true,token:'private'});
  assert.equal(prefs.theme,'aurora');assert.deepEqual([...prefs.favorites],['app:one','app:missing']);assert.equal(prefs.token,undefined);
  assert.equal(model.favorites([{key:'app:one'}],prefs).length,1);assert.equal(prefs.favorites.length,2);
  assert.equal(model.favorites([{key:'app:missing'}],prefs)[0].key,'app:missing');
  assert.equal(model.preferences({favorites:Array.from({length:200},(_,i)=>'app:'+i)}).favorites.length,64);
});

test('public launcher projects enabled displays and published shortcuts without configuration or layout contents',()=>{
  const result=launcherView({phoneHome:{viewer:()=>({name:'Example',paused:false,revision:1,scenes:[],tasks:[],private:'secret'})},controls:{options:()=>({timeFormat:'24',adminToken:'secret'})},
    vistas:{snapshot:()=>[{id:'1',name:'Visible',slug:'visible',enabled:true,layout:{secret:'private'}},{id:'2',name:'Hidden',slug:'hidden',enabled:false}]},
    universe:{snapshot:()=>({enabled:false,private:'secret'})},games:{snapshot:()=>({enabled:false})},version:'1.0.0',now:1000});
  assert.equal(result.displays.length,2);assert.equal(result.options.now,1000);assert.doesNotMatch(JSON.stringify(result),/secret|private|Hidden|layout|adminToken/);
});

test('HTTP provider admits packaged embedding while administration stays unframeable; source download has no connection preset',async t=>{
  const base=path.resolve('tests/.tmp');await fsp.mkdir(base,{recursive:true});const root=await fsp.mkdtemp(path.join(base,'launcher-'));
  await fsp.mkdir(path.join(root,'assets/launcher'),{recursive:true});await fsp.copyFile('assets/launcher/index.html',path.join(root,'assets/launcher/index.html'));
  await fsp.mkdir(path.join(root,'web'));await fsp.writeFile(path.join(root,'web/index.html'),'<title>Admin</title>');
  const app=await createLocalserve(root,{timers:false});t.after(async()=>{await app.close();assert.equal(path.dirname(root),base);await fsp.rm(root,{recursive:true,force:true});});
  const response=await fetch(app.origin+'/assets/launcher/index.html');assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'self' file:/);
  assert.match((await fetch(app.origin+'/')).headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal((await fetch(app.origin+'/api/launcher')).status,200);assert.equal((await fetch(app.origin+'/api/launcher?extra=1')).status,405);
  await fsp.mkdir(path.join(root,'tv-tizen/launcher'),{recursive:true});await fsp.cp('tv-tizen/launcher/app',path.join(root,'tv-tizen/launcher/app'),{recursive:true});
  await fsp.copyFile('tv-tizen/launcher/README.md',path.join(root,'tv-tizen/launcher/README.md'));
  const download=await productDownload(root,'launcher-source');assert.equal(download.available,true);assert.doesNotMatch(download.content.toString(),/192\.168\.0\.3|\.p12|\.pwd/);
  const config=await fsp.readFile(folder+'config.xml');await fsp.mkdir(path.join(root,'tv-tizen/launcher/dist'));
  await fsp.writeFile(path.join(root,'tv-tizen/launcher/dist/SormusLauncher.wgt'),sourceZip([['config.xml',config],['author-signature.xml',Buffer.from('Synthetic')],['signature1.xml',Buffer.from('Synthetic')]]));
  assert.equal((await productDownload(root,'launcher-tv')).version,'1.2.3');
});

test('ordinary menu reopen ignores a retained URI after settings changed; explicit app-control still wins',()=>{
  const newer=provider.replace('192.168.50.10','192.168.50.20');
  const f=fixture(newer,{uri:provider},provider);assert.equal(f.frame.src,newer);assert.equal(f.saved,newer);
  f.launch({uri:provider});assert.equal(f.frame.src,provider);assert.equal(f.saved,provider);
});

function navigationFixture(columns=6,count=94) {
  const context=vm.createContext({});vm.runInContext(fs.readFileSync('assets/launcher/navigation.js','utf8'),context);
  const rect=(left,top,width=270,height=174)=>({left,top,width,height,right:left+width,bottom:top+height});
  const header={name:'Apps tab',group:'header',rect:rect(300,30,100,56)};
  const items=Array.from({length:count},(_,i)=>({name:'App '+(i+1),group:'primary',rect:rect(i%columns*294,400+Math.floor(i/columns)*190)}));
  return {api:context.LauncherNavigation,header,items,all:[header,...items]};
}

test('94-app grids move between actual rows and columns, with stable horizontal edges',()=>{
  const f=navigationFixture();
  assert.equal(f.api.next(f.all,f.header,40,f.header),f.items[0]);
  assert.equal(f.api.next(f.all,f.items[0],40,f.header),f.items[6]);
  assert.equal(f.api.next(f.all,f.items[6],38,f.header),f.items[0]);
  assert.equal(f.api.next(f.all,f.items[0],37,f.header),f.items[0]);
  assert.equal(f.api.next(f.all,f.items[5],39,f.header),f.items[5]);
  assert.equal(f.api.next(f.all,f.items[7],39,f.header),f.items[8]);
  assert.equal(f.api.next(f.all,f.items[0],38,f.header),f.header);
});

test('grid traversal reaches the final partial row and returns through each column without skipping rows',()=>{
  for(const columns of [4,5,6,7]) {
    const f=navigationFixture(columns);let current=f.items[columns-1],steps=0;
    for(;;){const next=f.api.next(f.all,current,40,f.header);if(next===current)break;
      assert.equal(Math.floor(f.items.indexOf(next)/columns),Math.floor(f.items.indexOf(current)/columns)+1);current=next;assert.ok(++steps<94);
    }
    assert.equal(Math.floor(f.items.indexOf(current)/columns),Math.floor(93/columns));
    while(current.group!=='header')current=f.api.next(f.all,current,38,f.header);
    assert.equal(current,f.header);
  }
});

test('layout measurement ignores animated focus bounds and accounts for ancestor scrolling',()=>{
  const f=navigationFixture(),scroller={scrollTop:380,scrollLeft:0,parentNode:null};
  const parent={offsetLeft:64,offsetTop:116,clientLeft:0,clientTop:0,offsetParent:null};
  const node={offsetLeft:12,offsetTop:400,offsetWidth:270,offsetHeight:174,offsetParent:parent,parentNode:scroller,
    getBoundingClientRect(){throw Error('Animated bounds must not control grid movement');}};
  const measured=f.api.measure(node);assert.equal(measured.left,76);assert.equal(measured.top,136);assert.equal(measured.bottom,310);
});

test('Home rows move vertically between sections while settings retain overlapping-row navigation',()=>{
  const f=navigationFixture(5,5),lower=f.items.map((item,i)=>({...item,name:'Category '+i,group:'secondary',rect:{...item.rect,top:700,bottom:874}}));
  const items=[...f.all,...lower];
  assert.equal(f.api.next(items,f.items[3],40,f.header),lower[3]);
  assert.equal(f.api.next(items,lower[3],38,f.header),f.items[3]);
  const narrow={name:'Theme',group:'drawer',rect:{left:1500,right:1670,top:200,bottom:290,width:170,height:90}};
  const wide={name:'Motion',group:'drawer',rect:{left:1200,right:1670,top:320,bottom:390,width:470,height:70}};
  const below={name:'Remove',group:'drawer',rect:{left:1590,right:1670,top:500,bottom:570,width:80,height:70}};
  assert.equal(f.api.next([narrow,wide,below],narrow,40,null),wide);
});

test('library preference upgrades retain favorites and bound hidden IDs, search and remembered position',()=>{
  const context=vm.createContext({});vm.runInContext(fs.readFileSync('assets/launcher/model.js','utf8'),context);const model=context.SormusLauncherModel;
  const previous={theme:'ember',favorites:['app:one'],customized:true};
  const upgraded=model.preferences(previous);assert.deepEqual([...upgraded.favorites],['app:one']);assert.equal(upgraded.theme,'ember');assert.equal(upgraded.library.key,null);
  const prefs=model.preferences({...previous,hiddenApps:['one','one','https://outside','two'],library:{key:'app:two',query:' EMBY\n',top:500.4,token:'private'}});
  assert.deepEqual([...prefs.hiddenApps],['one','two']);assert.equal(prefs.library.query,' EMBY');assert.equal(prefs.library.top,500);assert.equal(prefs.library.token,undefined);
  assert.equal(model.library({key:'scene:one',top:Infinity}).key,null);assert.equal(model.library({top:1e12}).top,100000);
});

test('case-insensitive search and hiding preserve favorite identities and allow hidden apps to be restored',()=>{
  const context=vm.createContext({});vm.runInContext(fs.readFileSync('assets/launcher/model.js','utf8'),context);const model=context.SormusLauncherModel;
  const prefs=model.preferences({favorites:['app:one','app:two'],customized:true,hiddenApps:['one'],library:{query:'emby',key:'app:two',top:750}});
  const items=[{kind:'app',id:'one',key:'app:one',name:'Emby'},{kind:'app',id:'two',key:'app:two',name:'EMBY test'},{kind:'display',key:'display:display',name:'Display'}];
  assert.equal(model.apps(items,prefs,false).length,1);assert.equal(model.apps(items,prefs,true).length,2);assert.equal(model.favorites(items,prefs).length,1);
  assert.deepEqual([...prefs.favorites],['app:one','app:two']);assert.equal(model.restore(model.apps(items,prefs,false),prefs.library).id,'two');
  prefs.hiddenApps=[];assert.equal(model.favorites(items,prefs).length,2);
  prefs.library.query='no match';assert.equal(model.restore(model.apps(items,prefs,false),prefs.library),null);
});

test('header Down can reenter the remembered app instead of resetting the grid to its first item',()=>{
  const f=navigationFixture();assert.equal(f.api.next(f.all,f.header,40,f.header,f.items[76]),f.items[76]);
  assert.equal(f.api.next(f.all,f.header,40,f.header,{group:'primary'}),f.items[0]);
});

test('search keyboard keeps letters in their own rows before entering its action buttons',()=>{
  const f=navigationFixture(),letters=Array.from({length:36},(_,i)=>({name:String(i),group:'keyboard',rect:{left:i%10*80,top:Math.floor(i/10)*72,width:68,height:60,right:i%10*80+68,bottom:Math.floor(i/10)*72+60}}));
  const action={name:'Space',group:'search-actions',rect:{left:0,top:300,width:120,height:60,right:120,bottom:360}};
  const all=[...letters,action];let current=letters[0];for(let i=0;i<3;i++)current=f.api.next(all,current,40);
  assert.equal(current,letters[30]);for(let i=0;i<3;i++)current=f.api.next(all,current,39);assert.equal(current,letters[33]);
  assert.equal(f.api.next(all,letters[35],39),letters[35]);assert.equal(f.api.next(all,letters[30],40),action);
  assert.equal(f.api.next(all,action,38),letters[30]);
});

function iconFixture({size=20,content='iVBORw0KGgoAAAAA',decode}={}) {
  const calls=[],timers=new Map();let next=0;
  const context=vm.createContext({setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(fs.readFileSync(folder+'icons.js','utf8'),context);
  const filesystem={resolve(uri,ok,error,mode){calls.push(['resolve',uri,mode]);ok({isFile:true,fileSize:size,openStream(mode,ok){calls.push(['open',mode]);ok({readBase64(bytes){calls.push(['read',bytes]);return content;},close(){calls.push(['close']);}});}});}};
  const image='data:image/png;base64,iVBORw0KGgoAAAAA';
  return {calls,timers,context,image,reader:context.LauncherIcons.create(filesystem,decode || ((value,ok)=>{calls.push(['decode']);ok(image);}))};
}

test('installed icons are read once in read-only mode, normalized and cached by app version',()=>{
  const f=iconFixture(),app={id:'test.App',version:'1',iconPath:'/icons/test.png'},values=[];
  f.reader.read(app,value=>values.push(value));f.reader.read(app,value=>values.push(value));assert.equal(values.length,2);assert.ok(values.every(value=>value===f.image));
  assert.deepEqual(f.calls,[['resolve','file:///opt/share/webappservice/apps_icon/FirstScreen/test.App/167x94.png','r'],['open','r'],['read',20],['close'],['decode']]);
  f.reader.read({...app,version:'2'},()=>{});assert.equal(f.calls.filter(call=>call[0]==='read').length,2);
});

test('icon reads reject nonlocal paths, oversized files and non-raster contents without returning raw bytes',()=>{
  for(const path of ['https://outside/icon.png','file://other/icon.png','/icons/../secret','javascript:alert(1)']) {
    const f=iconFixture();f.reader.read({id:'../invalid',iconPath:path},value=>assert.equal(value,null));assert.equal(f.calls.length,0);
  }
  const large=iconFixture({size:262145});large.reader.read({id:'large',iconPath:'/icons/large.png'},value=>assert.equal(value,null));assert.equal(large.calls.length,2);
  const text=iconFixture({content:'cHJpdmF0ZSBkYXRh'});text.reader.read({id:'text',iconPath:'/icons/test.png'},value=>assert.equal(value,null));assert.equal(text.calls.filter(call=>call[0]==='decode').length,0);
});

test('icon decoding timeout finishes once and ignores a late result',()=>{
  let finish;const f=iconFixture({decode:(value,callback)=>{finish=callback;}}),values=[];
  f.reader.read({id:'test',version:'1',iconPath:'/icons/test.png'},value=>values.push(value));
  for(const callback of [...f.timers.values()])callback();finish(f.image);
  assert.deepEqual(values,[null]);assert.equal(f.calls.filter(call=>call[0]==='close').length,1);
});


test('connection field refocus opens editing; keyboard owns arrows and OK until Done or Cancel',()=>{
  const f=fixture(provider);f.message('sormus-launcher-ready');f.message('sormus-launcher-settings');
  const host=f.nodes.host,initial=host.focuses;
  f.key(13);assert.equal(host.readOnly,false);assert.equal(host.blurs,1);assert.equal(host.focuses,initial+1);
  for(const key of [37,38,39,40,13,229,8])assert.equal(f.key(key),false,'native IME input is not intercepted');
  assert.equal(f.context.document.activeElement,host);assert.equal(host.readOnly,false);
  f.key(65376);assert.equal(host.readOnly,true);assert.equal(f.nodes.cover.hidden,false);
  f.key(13);f.key(65385);assert.equal(host.readOnly,true);assert.equal(f.nodes.cover.hidden,false);
  f.key(40);assert.equal(f.context.document.activeElement,f.nodes.port);assert.equal(f.nodes.port.readOnly,true);
});

test('glyph preference is bounded, survives upgrades and artwork uses local widescreen TV cache assets',()=>{
  const context=vm.createContext({});vm.runInContext(fs.readFileSync('assets/launcher/model.js','utf8'),context);
  const model=context.SormusLauncherModel;
  assert.equal(model.preferences(null).artwork,'icons');assert.equal(model.preferences({artwork:'glyphs'}).artwork,'glyphs');
  assert.equal(model.preferences({artwork:'remote-url'}).artwork,'icons');
  const native=vm.createContext({});vm.runInContext(fs.readFileSync(folder+'icons.js','utf8'),native);
  const uri=native.LauncherIcons.smartHubUri({id:'111299001912'});
  assert.equal(uri,'file:///opt/share/webappservice/apps_icon/FirstScreen/111299001912/167x94.png');
  assert.doesNotMatch(uri,/^https?:|javascript:|data:/);
  const providerSource=fs.readFileSync('assets/launcher/launcher.js','utf8');
  assert.match(providerSource,/prefs.artwork !== 'icons'/);assert.match(providerSource,/\? iconCache\[key\] : null/);
  assert.doesNotMatch(providerSource,/launcher\/artwork\//,'Recreated banners cannot replace Smart Hub images');
});

test('native square package placeholders are rejected and wide art retains its proportions',()=>{
  for(const [width,height,accepted] of [[117,117,false],[512,423,false],[320,180,true],[1920,1080,true]]){
    const f=iconFixture();f.context.Image=function(){this.naturalWidth=width;this.naturalHeight=height;Object.defineProperty(this,'src',{set:()=>this.onload()});};
    let drawing;f.context.document={createElement:()=>({getContext:()=>({drawImage(...args){drawing=args;}}),toDataURL:()=>f.image})};
    const reader=f.context.LauncherIcons.create({resolve(uri,ok){ok({isFile:true,fileSize:20,openStream(mode,ok){ok({readBase64:()=> 'iVBORw0KGgoAAAAA',close(){}});}});}});
    reader.read({id:'app',version:'1',iconPath:'/icons/icon.png'},value=>assert.equal(value,accepted?f.image:null));
    assert.equal(!!drawing,accepted);if(accepted){assert.equal(drawing[3],160);assert.equal(drawing[4],90);}
  }
});

test('Smart Hub reads stay inside the installed app cache and fall back read-only when missing',()=>{
  const f=iconFixture(),api=f.context.LauncherIcons;
  for(const id of ['..','.','../secret','id/path','https://external',''])assert.equal(api.smartHubUri({id}),null);
  const calls=[],reader=api.create({resolve(uri,ok,error,mode){
    calls.push([uri,mode]);if(uri.includes('/FirstScreen/'))return error();
    ok({isFile:true,fileSize:20,openStream(mode,ok){ok({readBase64:()=> 'iVBORw0KGgoAAAAA',close(){}});}});
  }},(value,ok)=>ok(f.image));
  reader.read({id:'example',version:'1',iconPath:'/icons/package.png'},value=>assert.equal(value,f.image));
  assert.deepEqual(calls,[['file:///opt/share/webappservice/apps_icon/FirstScreen/example/167x94.png','r'],['file:///icons/package.png','r']]);
  const invalid=api.create({resolve(uri,ok,error){assert.match(uri,/^file:\/\/\/opt\/share\/webappservice\/apps_icon\/FirstScreen\/valid\/167x94\.png$/);error();}});
  invalid.read({id:'valid',iconPath:'https://external/icon.png'},value=>assert.equal(value,null));
});

test('full-art tile style is independent of glyph mode, retains names for accessibility and labels for editing',()=>{
  const context=vm.createContext({});vm.runInContext(fs.readFileSync('assets/launcher/model.js','utf8'),context);
  const model=context.SormusLauncherModel,prefs=model.preferences({artwork:'glyphs',tileStyle:'artwork',favorites:['app:known'],customized:true});
  assert.equal(prefs.artwork,'glyphs');assert.equal(prefs.tileStyle,'artwork');assert.equal(prefs.favorites[0],'app:known');
  assert.equal(model.preferences({tileStyle:'external'}).tileStyle,'labeled');
  const source=fs.readFileSync('assets/launcher/launcher.js','utf8'),css=fs.readFileSync('assets/launcher/launcher.css','utf8');
  assert.match(source,/prefs.tileStyle === 'artwork' && !editing && !managing/);
  assert.match(source,/setAttribute\('aria-label',item.name\)/);
  assert.match(css,/padding-top:56\.25%/);assert.match(css,/\.tile\.app\.full-art>strong,\.tile\.app\.full-art>small,\.tile\.app\.full-art>\.pin\{display:none\}/);
});

function widePng(width=167,height=94){const bytes=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);bytes.write('IHDR',12);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);return bytes.toString('base64');}
test('Smart Hub protocol reads only a unique installed app artwork path, never launches or writes credentials',async()=>{
  const sent=[],socket=new EventEmitter();let loads=0;
  const rows=await readLauncherArtwork({host:'192.168.50.10'},['YouTube','Unknown'],new AbortController().signal,()=>{}, {
    vault:{async load(){loads++;return {token:'private'};},save(){assert.fail('Read cannot write credentials');}},socketFactory:()=>socket,
    connect:async(settings,auth,signal,options)=>{options.socketFactory('ws://test',{});return {apps:async()=>[{name:'YouTube',appId:'111299001912',icon:'/opt/share/webappservice/apps_icon/FirstScreen/111299001912/250x250.png'}],
      async send(message){sent.push(message);socket.emit('message',Buffer.from(JSON.stringify({event:'ed.apps.icon',data:{iconPath:'/wrong/path',imageBase64:widePng()}})));socket.emit('message',Buffer.from(JSON.stringify({event:'ed.apps.icon',data:{iconPath:message.params.data.iconPath,imageBase64:widePng()}})));},close(){sent.push('close');}};}
  });
  assert.equal(loads,1);assert.equal(rows[0].name,'YouTube');assert.equal(rows.length,1);assert.equal(sent[0].params.event,'ed.apps.icon');assert.equal(sent[0].params.data.iconPath,'/opt/share/webappservice/apps_icon/FirstScreen/111299001912/167x94.png');assert.equal(sent[1],'close');
  assert.doesNotMatch(JSON.stringify(rows),/token|private|iconPath|opt\/share/);
});
test('Smart Hub image/path validation excludes squares, foreign directories and malformed responses',()=>{
  assert.ok(hubImage(widePng()));for(const value of [widePng(250,250),'a'.repeat(65537),'data:image/svg+xml;base64,x',''])assert.equal(hubImage(value),null);
  for(const icon of ['/other/167x94.png','/opt/share/webappservice/apps_icon/FirstScreen/other/250x250.png','/opt/share/webappservice/apps_icon/FirstScreen/app/../secret.png'])assert.equal(hubPath({appId:'app',icon}),null);
  assert.equal(hubPath({appId:'..',icon:'/opt/share/webappservice/apps_icon/FirstScreen/../250x250.png'}),null);
});
test('artwork cache honors pause, disablement, revision changes, missing plugin and shutdown without stale results',async()=>{
  let revision=1,enabled=true,calls=0,onRead=null;const gate={paused:false};
  const record={plugin:{version:'1.0.0'},runtime:{},configured:true,health:'ready',pending:false,config:{snapshot:()=>({revision,enabled,settings:{host:'192.168.50.10'}})}};
  const registry={get:()=>record},reader=async(settings,names,signal,check)=>{calls++;onRead?.();check();return names.map(name=>({name,image:'data:image/png;base64,'+widePng()}));};
  const cache=new LauncherArtwork('.',registry,gate,{reader});assert.equal((await cache.read(['YouTube'])).icons.length,1);await cache.read(['YouTube']);assert.equal(calls,1);
  gate.paused=true;assert.equal((await cache.read(['YouTube'])).icons.length,0);gate.paused=false;
  enabled=false;assert.equal((await cache.read(['YouTube'])).icons.length,0);enabled=true;revision++;await cache.read(['YouTube']);assert.equal(calls,2);
  revision++;onRead=()=>revision++;assert.equal((await cache.read(['YouTube'])).icons.length,0);assert.equal(calls,3);
  await assert.rejects(()=>cache.read(['x'.repeat(101)]));await assert.rejects(()=>cache.read(Array(13).fill('x')));
  cache.close();assert.equal((await cache.read(['YouTube'])).icons.length,0);
  const missing=new LauncherArtwork('.',{get(){throw Error('Not installed');}},gate,{reader});assert.equal((await missing.read(['YouTube'])).icons.length,0);assert.equal(calls,3);missing.close();
});

test('closing an artwork request cancels its owned read without poisoning the cache',async()=>{
  const record={plugin:{version:'1'},runtime:{},configured:true,health:'ready',config:{snapshot:()=>({revision:1,enabled:true,settings:{host:'192.168.50.10'}})}};
  const controller=new AbortController();let started;
  const ready=new Promise(resolve=>started=resolve),cache=new LauncherArtwork('.',{get:()=>record},{paused:false},{reader:async(settings,names,signal)=>{started();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
  const read=cache.read(['YouTube'],controller.signal);await ready;controller.abort();assert.deepEqual(await read,{icons:[]});assert.equal(cache.cache.size,0);cache.close();
});
