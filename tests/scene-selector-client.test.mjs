/** Minimal DOM/network fixtures verify command intent, not visual styling. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomFillSync} from 'node:crypto';
const script=await fs.readFile(new URL('../web/scene-selector.js',import.meta.url),'utf8');
async function client(uncertain=false,native=false) {
  const nodes=new Map(),timers=new Map(),listeners={},posts=[];let timerId=0;
  class Element {
    constructor(){this.dataset={};this.style={setProperty(){}};this.children=[];this.parts={};this.hidden=false;this.disabled=false;}
    set innerHTML(value){this.markup=value;this.children=[];this.parts={};}
    get innerHTML(){return this.markup;}
    querySelector(name){if(name==='.empty')return this.children.find(e=>e.className==='empty');return this.parts[name] ||= new Element();}
    append(node){node.parent=this;this.children.push(node);}
    insertBefore(node,before){node.remove();node.parent=this;const i=this.children.indexOf(before);this.children.splice(i<0?this.children.length:i,0,node);}
    remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}
    setAttribute(key,value){this[key]=value;}removeAttribute(key){delete this[key];}
  }
  const node=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  const nav=[new Element(),new Element()];nav[0].dataset.group='scenes';nav[1].dataset.group='tasks';
  const scene={id:'one',name:'Evening',icon:'moon',available:true,pluginId:'lights',slug:'remote',revision:1,token:'scene-token'};
  const model={name:'Localserve',paused:false,revision:1,scenes:[scene],tasks:[]};
  const context={document:{hidden:false,documentElement:{dataset:{}},getElementById:node,createElement:()=>new Element(),createTextNode:text=>({textContent:text}),querySelector:node,querySelectorAll:()=>nav,addEventListener(name,fn){listeners[name]=fn;}},
    window:{navigator:{userAgent:native?'Android LocalserveScenes/1.0':'Browser'},matchMedia:()=>({matches:false}),addEventListener(){}},localStorage:{getItem(){return null;},setItem(){}},crypto:{getRandomValues:b=>randomFillSync(b)},
    AbortController,Uint8Array,Date,console,setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},
    async fetch(url,options){let data=model;
      if(options.method==='POST'){posts.push({url,body:JSON.parse(options.body)});if(uncertain)throw Error('Lost reply');data={id:posts.at(-1).body.requestId,status:'queued'};}
      else if(url.includes('/api/control-view/'))data={runs:posts.map(p=>({id:p.body.requestId,status:'completed'}))};
      return {ok:true,async text(){return JSON.stringify(data);}};
    }};
  vm.runInNewContext(script,context);
  const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};await settle();
  const button=()=>node('choices').children.find(e=>e.className==='scene-button');
  return {node,posts,button,async click(){node('choices').onclick({target:{closest:button}});await settle();},
    async poll(){const entry=[...timers].find(([,t])=>t.delay===3000);assert.ok(entry);timers.delete(entry[0]);await entry[1].fn();await settle();},
    dismiss(){node('dismiss').onclick();},model};
}
test('selector never commands on load or refresh, keeps buttons stable and completes one explicit run',async()=>{
  const f=await client(),b=f.button();assert.equal(f.posts.length,0);await f.poll();assert.equal(f.button(),b);
  await f.click();assert.equal(f.posts.length,1);assert.equal(f.node('receipt-status').textContent,'Completed');
  assert.equal(f.posts[0].body.itemId,'one');assert.equal(f.posts[0].body.value,undefined);
  await f.poll();assert.equal(f.posts.length,1);
});
test('standalone shell exposes connection settings without an APK download or executing actions',async()=>{
  const f=await client(false,true);
  assert.equal(f.node('app-connection').hidden,false);
  assert.doesNotMatch(await fs.readFile(new URL('../web/scene-selector.html',import.meta.url),'utf8'),/android-download|href="[^"]*\.apk/);
  assert.equal(f.node('.brand').href,'scenes');assert.equal(f.node('server-name').textContent,'Controller');
  assert.equal(f.posts.length,0);await f.poll();assert.equal(f.posts.length,0);
});
test('unavailable shortcuts show the public reason without executing or replacing their buttons',async()=>{
  const f=await client(),b=f.button();f.model.scenes[0].available=false;
  f.model.scenes[0].unavailableReason='Enable the lighting scene and its Controls page.';
  await f.poll();assert.equal(f.button(),b);assert.equal(b.disabled,true);
  assert.equal(b.querySelector('.button-state').textContent,f.model.scenes[0].unavailableReason);
  assert.equal(f.posts.length,0);
});
test('a lost reply locks explicit retry, reports uncertainty and never labels the scene Running or resends on polls',async()=>{
  const f=await client(true);await f.click();assert.equal(f.posts.length,1);
  assert.match(f.node('receipt-status').textContent,/not confirmed/);assert.equal(f.node('dismiss').hidden,false);
  assert.equal(f.button().querySelector('.button-state').textContent,'Check result');assert.equal(f.button().dataset.pending,'false');
  assert.equal(f.button().disabled,true);await f.poll();await f.click();assert.equal(f.posts.length,1);
  f.dismiss();assert.equal(f.button().disabled,false);assert.equal(f.posts.length,1);
});
