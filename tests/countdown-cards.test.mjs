import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {validateFields,validateValues} from '../server/plugin-schema.mjs';
import {validateDeclaration} from '../server/plugins.mjs';
import {validateCard} from '../server/cards.mjs';

const code=await fs.readFile(new URL('../web/card-renderer.js',import.meta.url),'utf8');
const renderer=vm.runInNewContext(code+'\nCardRenderer;',{Intl,URL,Date});
const now=Date.parse('2026-10-29T09:00:00Z');
const card={schemaVersion:1,name:'Deadline',enabled:true,size:'large',layout:'highlight',icon:'inherit',fields:[{id:'target',binding:'target',label:'Time remaining',enabled:true,icon:'none',format:'countdown',unit:'',decimals:0}]};
const plugin=validateDeclaration({id:'countdown-test',name:'Countdown test',cardFields:[{id:'target',label:'Target',type:'timestamp',source:{kind:'state',key:'target'}}]});

test('declared date/time controls accept canonical values and reject impossible dates or incompatible types',()=>{
  const fields=validateFields([{id:'date',type:'string',format:'date'},{id:'time',type:'string',format:'time'}]);
  assert.deepEqual(validateValues(fields,{date:'2028-02-29',time:'00:00'}),{date:'2028-02-29',time:'00:00'});
  assert.deepEqual(validateValues(fields,{date:'',time:''}),{date:'',time:''});
  for(const date of ['2027-02-29','2026-04-31','1969-01-01','99999-12-31','2026-01-01T00:00Z'])assert.throws(()=>validateValues(fields,{date,time:'00:00'}));
  for(const time of ['24:00','12:60','9:00','00:00:00'])assert.throws(()=>validateValues(fields,{date:'2026-01-01',time}));
  assert.throws(()=>validateFields([{id:'date',type:'number',format:'date'}]));
});

test('countdown formatting requires timestamp bindings and preserves unknown versus reached values',()=>{
  validateCard(card,plugin);
  const number=validateDeclaration({id:'numbers',name:'Numbers',cardFields:[{id:'target',label:'Target',type:'number',source:{kind:'state',key:'target'}}]});
  assert.throws(()=>validateCard(card,number),/formatting/);
  const data=value=>({pluginName:'Calendar',status:'Ready',values:{target:{type:'timestamp',available:value!==null,value}}});
  const catalog=[{id:'target',type:'timestamp',label:'Target'}];
  const html=renderer.render(card,data(now+90061001),catalog,{now});assert.match(html,/1d 01:01:02/);assert.match(html,/data-countdown-format="countdown"/);
  assert.match(renderer.render(card,data(now-1),catalog,{now}),/0d 00:00:00/);
  const missing=renderer.render(card,data(null),catalog,{now});assert.match(missing,/No data/);assert.doesNotMatch(missing,/data-countdown-at/);
});

test('text-only countdown ticks preserve existing minute formats and the typed source',()=>{
  const nodes=[{dataset:{countdownAt:String(now+90061001),countdownFormat:'countdown'},textContent:''},{dataset:{countdownAt:String(now+60001)},textContent:''}];
  const root={querySelectorAll:selector=>selector==='[data-countdown-at]'?nodes:[]};
  renderer.updateCountdowns(root,now);assert.equal(nodes[0].textContent,'1d 01:01:02');assert.equal(nodes[1].textContent,'2 min');
  renderer.updateCountdowns(root,now+1001);assert.equal(nodes[0].textContent,'1d 01:01:00');assert.equal(nodes[1].textContent,'1 min');
  assert.equal(nodes[0].dataset.countdownAt,String(now+90061001));
  renderer.updateCountdowns(root,now+999999999);assert.equal(nodes[0].textContent,'0d 00:00:00');
});

test('ready-made countdown hydration ticks only while its host connection is active',()=>{
  const label={dataset:{cardText:'remaining'},textContent:'',hasAttribute:()=>false};
  const doc={documentElement:{dataset:{},style:{setProperty(){}}},querySelector:()=>({}),querySelectorAll:selector=>selector==='[data-card-text]'?[label]:selector==='[data-countdown-at]'?[label]:[]};
  const payload={connected:true,status:'Ready',theme:'dark',fontScale:100,slots:{remaining:{value:'0d 00:00:05',raw:now+5000,deadline:now+5000,countdownFormat:'countdown',available:true}}};
  const frame={contentDocument:doc,dataset:{readyCard:JSON.stringify(payload)}};
  renderer.hydrateReadyMade(frame);assert.equal(label.dataset.countdownFormat,'countdown');
  const root={querySelectorAll:selector=>selector==='iframe[data-ready-card]'?[frame]:[]};renderer.updateCountdowns(root,now+1000);assert.equal(label.textContent,'0d 00:00:04');
  frame.dataset.readyCard=JSON.stringify({...payload,connected:false});renderer.updateCountdowns(root,now+3000);assert.equal(label.textContent,'0d 00:00:04');
});

test('legacy countdown arithmetic matches modern results without JavaScript added to Card documents',async()=>{
  const source=await fs.readFile(new URL('../assets/vista-legacy.js',import.meta.url),'utf8');
  const format=vm.runInNewContext(source.slice(source.indexOf('  function countdown('),source.indexOf('  function formatted('))+'\ncountdown;');
  assert.equal(format(now+90061001,now),'1d 01:01:02');assert.equal(format(now-1,now),'0d 00:00:00');
  const html=await fs.readFile(new URL('../plugins/calendar/cards/countdown/card.html',import.meta.url),'utf8');assert.doesNotMatch(html,/<script|onload=|onclick=/i);
});

test('the shared editable time control supports a named canonical value without changing Task defaults',async()=>{
  const source=await fs.readFile(new URL('../web/time-ui.js',import.meta.url),'utf8');
  const time=vm.runInNewContext(source+'\nTimeUI;',{config:{timeFormat:'12'},escapeHtml:s=>String(s),crypto:{randomUUID},icon:()=>''});
  const html=time.render('19:07','target-time',true,'target-input');assert.match(html,/name="target-time"/);assert.match(html,/value="19:07" data-time-value/);assert.match(html,/value="7:07 PM"/);assert.match(html,/id="target-input"/);
  assert.match(time.render('00:00'),/name="time"/);
  const value={value:''},input={value:'7:23 pm',required:true,closest:()=>({querySelector:()=>value}),setCustomValidity(message){this.error=message;}};
  time.normalize(input,true);assert.equal(value.value,'19:23');assert.equal(input.value,'7:23 PM');assert.equal(input.error,'');
});

test('Calendar draft comparison ignores disabled conditional fields and time presentation while preserving real edits',async()=>{
  const raw=JSON.parse(await fs.readFile(new URL('../plugins/calendar/declaration.json',import.meta.url),'utf8'));
  const field=raw.settings.find(f=>f.id==='calendars');
  const values={name:'Date','source-type':'date',url:'','target-date':'2027-01-15','target-time':'19:23','reminder-minutes':'0',enabled:'true'};
  const controls=Object.fromEntries(Object.entries(values).map(([id,value])=>[id,{value,type:'hidden',disabled:false}]));
  const form={elements:{namedItem:id=>controls[id]}};
  const context=vm.createContext({document:{addEventListener(){}},dialogContext:{pluginId:'calendar',setting:'calendars',operation:'edit'},state:{services:[{id:'calendar',settings:[field]}]},formIdentifier:()=> 'plugin-item-form'});
  context.PluginUI=vm.runInContext(await fs.readFile(new URL('../web/plugin-ui.js',import.meta.url),'utf8')+'\nPluginUI;',context);
  const source=await fs.readFile(new URL('../web/app.js',import.meta.url),'utf8');vm.runInContext(source.slice(source.indexOf('function serializeForm('),source.indexOf('function requestDialogClose(')),context);
  const initial=context.serializeForm(form);controls.url.disabled=true;controls['reminder-minutes'].disabled=true;controls['target-timeText']={value:'7:23 PM'};
  assert.equal(context.serializeForm(form),initial);controls['target-time'].value='19:24';assert.notEqual(context.serializeForm(form),initial);
});

test('closing a date editor during its time validation cannot write or report an error into another editor',async()=>{
  const raw=JSON.parse(await fs.readFile(new URL('../plugins/calendar/declaration.json',import.meta.url),'utf8')),field=raw.settings.find(f=>f.id==='calendars');
  const item={id:'date',name:'Date','source-type':'date',url:'','target-date':'2027-01-15','target-time':'19:23','reminder-minutes':0,enabled:true};
  const controls=Object.fromEntries(Object.entries(item).map(([id,value])=>[id,{value:String(value),type:'hidden'}]));
  const button={disabled:false,isConnected:true},form={isConnected:true,elements:{namedItem:id=>controls[id]},querySelector:()=>button};
  const context={kind:'plugin-item',pluginId:'calendar',setting:'calendars',operation:'edit',item,items:[item],settings:{calendars:[item]},revision:1};
  let resolve,writes=0;const errors=[];
  const scope=vm.createContext({structuredClone,document:{addEventListener(){}},dialogContext:context,state:{services:[{id:'calendar',settings:[field]}]},fetch:()=>new Promise(r=>resolve=r),mutate:async()=>{writes++;},showFormError:e=>errors.push(e)});
  const ui=vm.runInContext(await fs.readFile(new URL('../web/plugin-ui.js',import.meta.url),'utf8')+'\nPluginUI;',scope);
  const pending=ui.submitItem(form);assert.equal(typeof resolve,'function');scope.dialogContext={kind:'task'};form.isConnected=false;button.isConnected=false;
  resolve({ok:false,json:async()=>({error:'Late invalid time'})});await pending;assert.equal(writes,0);assert.deepEqual(errors,[]);assert.equal(ui.pending,false);
});
