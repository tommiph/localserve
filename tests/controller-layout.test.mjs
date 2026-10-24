/** Offline rendering gets a public catalogue only and sends fixed intents to
 * its native owner. No device, relay endpoint or credentials are used here. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../plugins/sensors/android/assets/controller-relay.js',import.meta.url),'utf8');
function fixture(){
  const nodes=new Map();
  class Element{
    constructor(){this.children=[];this.parts={};this.dataset={};this.style={values:{},setProperty(name,value){this.values[name]=value;}};}
    set innerHTML(value){this.parts={};this.children=[];}setAttribute(key,value){this[key]=value;}removeAttribute(key){delete this[key];}
    querySelector(name){if(name==='.empty')return this.children.find(child=>child.className==='empty');return this.parts[name]||=new Element();}
    append(node){node.parent=this;this.children.push(node);}replaceChildren(...children){this.children=children;}
    remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}
    insertBefore(node,before){node.remove();node.parent=this;const i=this.children.indexOf(before);this.children.splice(i<0?this.children.length:i,0,node);}
  }
  const node=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},nav=['scenes','tasks','remotes','cards'].map(group=>{const element=new Element();element.dataset.group=group;return element;});
  const context={document:{documentElement:{dataset:{}},getElementById:node,querySelector:node,querySelectorAll:()=>nav,createElement:()=>new Element()},location:{href:''},window:{}};
  vm.runInNewContext(source,context);
  return {node,nav,context,render:model=>context.window.ControllerRelay.render(JSON.stringify(model))};
}
test('relay circles retain nodes and safely render glyphs, text, themes and canonical LAN colors',()=>{
  const f=fixture(),item={key:'lights/remote/evening',type:'scene',icon:'moon',name:'<Evening>',available:true},model={dark:true,online:true,catalog:{scenes:[item],tasks:[],paused:false}};
  f.render(model);const button=f.node('choices').children[0];assert.equal(button.querySelector('strong').textContent,'<Evening>');assert.equal(button.querySelector('.orb').children[0].className,'material-symbol ms-moon');
  let hash=0;for(const letter of 'scene:lights:remote:evening')hash=(hash*31+letter.charCodeAt(0))>>>0;
  assert.equal(button.style.values['--orb'],['#ead493','#d7dfcb','#d4dfe4','#e8cfbf','#dcd3e6','#cbded7'][hash%6]);
  f.render({...model,dark:false});assert.equal(f.node('choices').children[0],button);assert.equal(f.context.document.documentElement.dataset.theme,'light');assert.equal(f.context.location.href,'');
  f.render({...model,online:false});assert.equal(button.disabled,true);assert.equal(f.node('connection').textContent,'Offline');
  f.render({...model,pending:true});assert.equal(button.disabled,true);
  f.render(model);button.onclick();assert.equal(f.context.location.href,'https://controller.local/command/run?key=lights%2Fremote%2Fevening');
});
test('relay full remotes and Cards remain clearly LAN-only without publishing remote controls',()=>{
  const f=fixture();f.render({online:true,dark:true,catalog:{scenes:[],tasks:[]}});f.nav[2].onclick();assert.match(f.node('choices').children[0].textContent,/home network.*full remotes/);
  f.nav[3].onclick();assert.match(f.node('choices').children[0].textContent,/home network.*Cards/);assert.equal(f.context.location.href,'');
});
