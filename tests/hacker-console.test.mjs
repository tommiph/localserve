const nativeSource=await (await import('node:fs/promises')).readFile('web/vista-native.js','utf8');
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
const source=await fs.readFile(new URL('../web/hacker-console.js',import.meta.url),'utf8');
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.style={};this.attributes={};this.text='';}
 get firstChild(){return this.children[0]||null;}
 appendChild(child){if(child.parentNode)child.parentNode.removeChild(child);this.children.push(child);child.parentNode=this;return child;}
 removeChild(child){this.children.splice(this.children.indexOf(child),1);child.parentNode=null;return child;}
 setAttribute(key,value){this.attributes[key]=String(value);}
 set textContent(value){this.text=String(value);for(const child of this.children)child.parentNode=null;this.children=[];}
 get textContent(){return this.text+this.children.map(c=>c.textContent).join('');}
}
function fixture(withNative=false){let now=0,next=0;const timers=new Map();class Clock extends Date{static now(){return now;}}const context={Date:Clock,Intl,document:{createElement:tag=>new Element(tag)},setInterval:fn=>{timers.set(++next,fn);return next;},clearInterval:id=>timers.delete(id)};if(withNative)vm.runInNewContext(nativeSource,context);vm.runInNewContext(source,context);return {api:context.HackerConsole,timers,host:new Element('main'),advance(ms){for(let i=0;i<ms;i+=50){now+=50;for(const callback of [...timers.values()])callback();}}};}
function entry(value=9){return {pluginId:'weather',cardId:'card',card:{id:'card',sourceId:'area',fields:[{id:'hero',binding:'area:temperature',enabled:true}]},catalog:[{id:'area:temperature',label:'Temperature (°C)'}],data:{pluginName:'Weather',status:'Ready',values:{'area:temperature':{type:'number',available:true,value},secret:{type:'string',available:true,value:'PRIVATE'}},readyMade:{source:{id:'area',name:'Garden',enabled:true},bindings:{hero:'area:temperature'},template:{slots:[{id:'hero',decimals:1}]}}}};}
test('cinematic commands are ES5, text-only and derive answers only from selected public readings',()=>{
 const f=fixture(),info=f.api.describe(entry());assert.equal(info.value,'9');assert.equal(info.label,'Temperature (°C)');assert.ok(f.api.sequence(info).some(s=>s.text==='show --answer'));assert.doesNotMatch(JSON.stringify(f.api.sequence(info)),/PRIVATE/);
 const unavailable=entry();unavailable.data.readyMade.source.enabled=false;assert.equal(f.api.describe(unavailable).value,'No data');assert.equal(f.api.describe(unavailable).status,'Data source disabled');
 const syntax=source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'');
 assert.doesNotMatch(syntax,/\b(?:const|let|class)\s|=>|\?\.|\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|innerHTML|eval\s*\(/);
});
test('polls keep typing progress, pause freezes work, answers update without replay and disposal clears the only timer',()=>{
 const f=fixture(),console=f.api.create(f.host),options={motion:'full',connected:true};console.update(entry(),options);assert.equal(f.timers.size,1);f.advance(200);const partial=f.host.textContent;assert.match(partial,/who/);console.update(entry(12),options);assert.equal(f.host.textContent,partial);assert.equal(f.timers.size,1);
 console.configure({...options,paused:true});assert.equal(f.timers.size,0);const paused=f.host.textContent;f.advance(5000);assert.equal(f.host.textContent,paused);console.configure(options);f.advance(25000);assert.equal(f.timers.size,0);assert.match(f.host.textContent,/Temperature \(°C\) => 12/);assert.doesNotMatch(f.host.textContent,/PRIVATE/);
 console.update(entry(13),options);assert.match(f.host.textContent,/Temperature \(°C\) => 13/);assert.equal(f.timers.size,0);console.destroy();assert.equal(f.host.children.length,0);assert.equal(f.timers.size,0);
});
test('reduced motion and None show complete static results; offline/hidden hold typing and markup remains literal text',()=>{
 const f=fixture(),console=f.api.create(f.host),value=entry();value.data.pluginName='<img src=x onerror=boom>';console.update(value,{motion:'none',connected:true});assert.equal(f.timers.size,0);assert.equal(f.host.children[0].attributes['data-phase'],'answer');assert.match(f.host.textContent,/Temperature \(°C\) => 9/);
 const other=entry();other.card.id='other';console.update(other,{motion:'full',connected:false});assert.equal(f.timers.size,0);assert.match(f.host.textContent,/OFFLINE/);console.configure({motion:'full',connected:true,hidden:true});assert.equal(f.timers.size,0);console.configure({motion:'full',connected:true});assert.equal(f.timers.size,1);f.advance(150);console.configure({motion:'full',connected:true,reduced:true});assert.equal(f.timers.size,0);assert.equal(f.host.children[0].attributes['data-phase'],'answer');console.destroy();
});
test('a short spotlight reaches an answer before advancing, even with Gentle typing',()=>{
 const f=fixture(),console=f.api.create(f.host);console.update(entry(),{motion:'gentle',connected:true,durationSeconds:10});f.advance(9500);assert.equal(f.host.children[0].attributes['data-phase'],'answer');assert.equal(f.timers.size,0);console.destroy();
});
test('scoped activity is typed once after baseline; old history is not replayed and real service changes join the console',()=>{
 const f=fixture(),console=f.api.create(f.host),options={motion:'full',connected:true,now:1000};console.update(entry(),options);console.activity([{id:'old',name:'Old Task',status:'completed',startedAt:100,finishedAt:200}]);f.advance(25000);assert.doesNotMatch(f.host.textContent,/Old Task/);console.activity([{id:'new',name:'Evening scene',status:'completed',startedAt:2000,finishedAt:3000}]);f.advance(5000);assert.match(f.host.textContent,/\[TASK COMPLETED\] Evening scene/);assert.equal(f.timers.size,0);console.activity([{id:'new',name:'Evening scene',status:'completed',startedAt:2000,finishedAt:3000}]);assert.equal(f.timers.size,0);console.services([entry()]);const failed=entry();failed.data.status='Failed';console.services([failed]);f.advance(5000);assert.match(f.host.textContent,/\[SOURCE\] Weather \/ Failed/);console.destroy();assert.equal(f.timers.size,0);
});

test('Full HD keeps ten transcript rows and three live selected details without replaying a finished answer',()=>{
 const f=fixture(true),console=f.api.create(f.host),e=entry(),options={motion:'none',connected:true,fullHd:true};for(let n=1;n<=3;n++){const id='metric-'+n,binding='area:extra-'+n;e.card.fields.push({id,binding,enabled:true});e.catalog.push({id:binding,label:'Detail '+n,type:'number'});e.data.values[binding]={type:'number',available:true,value:n};e.data.readyMade.bindings[id]=binding;e.data.readyMade.template.slots.push({id,decimals:0});}console.update(e,options);assert.equal(f.host.children[0].children[1].children.length,10);for(let n=1;n<=3;n++)assert.match(f.host.textContent,new RegExp('Detail '+n+' => '+n));const row=f.host.children[0].children[1].children[0];e.data.values['area:extra-1'].value=42;console.update(e,options);assert.equal(f.host.children[0].children[1].children[0],row);assert.match(f.host.textContent,/Detail 1 => 42/);assert.equal(f.timers.size,0);console.update(e,{...options,fullHd:false});assert.equal(f.host.children[0].children[1].children.length,6);console.destroy();
});
