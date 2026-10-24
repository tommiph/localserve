/** Synthetic light effects and disposable stores only; no physical gateway. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {LightingAnimations,animationPresets,validateAnimation,lightCommand,sampleHoldSeconds} from '../server/lighting-animations.mjs';
import {ExecutionGate} from '../server/tasks.mjs';
import {createLocalserve} from '../server.mjs';

const base=path.resolve('tests/.tmp');
async function until(check) {
  const end=Date.now()+3000;
  while(!check()){if(Date.now()>end)throw Error('Timed out');await new Promise(resolve=>setTimeout(resolve,5));}
}
async function fixture(t) {
  await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'lighting-'));
  const gate=new ExecutionGate(),calls=[],logs=[];
  let revision=1,ready=true,fail=false,identity='test-gateway';
  const lights=[{id:'100',name:'Colour',spectrum:'rgb',reachable:true},{id:'101',name:'White',spectrum:'white',reachable:true}];
  const record={config:{snapshot:()=>({revision})}};
  const registry={engine:{gate},controls:{active:new Map()},get:()=>record,
    assertReady(){if(!ready)throw Error('Unavailable');},
    actionAvailability(){return {available:ready,unavailableReason:'Lighting unavailable'};},
    services:()=>[{id:'tradfri',config:{settings:{host:'test-gateway'}},pluginState:{'gateway-host':identity},
      controls:{lighting:{lights:['lights'],details:[],identitySetting:'host',identityState:'gateway-host'}},
      cardData:{values:{lights:{available:true,value:lights}}}}],
    async execute(id,action,values,context){
      context.signal.throwIfAborted();
      const history=manager.runs.snapshot();
      assert.ok(history.runs.some(run=>run.id===context.lightingAnimation&&run.status==='running'),'Claim must precede every effect');
      calls.push({id,action,values,revision:context.configRevision,fadeSeconds:context.lightingFadeSeconds});
      if(fail)throw Error('Private gateway diagnostic must not escape');
    }};
  const activity={async add(...values){logs.push(values);}};
  const manager=await new LightingAnimations(root,registry,activity).load();registry.lightingAnimations=manager;
  t.after(async()=>{await manager.close();assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});
  return {root,gate,calls,logs,manager,registry,lights,setReady:value=>{ready=value;},setRevision:value=>{revision=value;},setIdentity:value=>{identity=value;},setFailure:()=>{fail=true;}};
}
const request=(animation,extra={})=>({revision:animation.revision,requestId:randomUUID(),targets:['100'],durationMinutes:0,...extra});

test('eleven clean presets validate, select no lights and do not start on load',async t=>{
  const presets=animationPresets();assert.equal(presets.length,11);assert.equal(new Set(presets.map(item=>item.id)).size,11);
  for(const item of presets){assert.deepEqual(item.targets,[]);validateAnimation(item,item);}
  const f=await fixture(t);assert.equal(f.manager.admin().animations.length,11);assert.equal(f.manager.active,null);assert.equal(f.calls.length,0);
  for(const change of [item=>{item.steps[0].color='red;url(x)';},item=>{item.steps[0].fadeSeconds=61;},
    item=>{item.steps[0].seconds=0;},item=>{item.targets=Array(11).fill('100');},item=>{item.steps.forEach(step=>{step.enabled=false;});},
    item=>{item.durationMinutes=-1;},item=>{item.expression='code';}]){
    const value=structuredClone(presets[0]);change(value);assert.throws(()=>validateAnimation(value,value));
  }
});

test('random hold ranges remain bounded, preserve fixed timing and validate dark white flashes',()=>{
  const lightning=animationPresets().find(item=>item.id==='preset-lightning');
  for(const step of lightning.steps){
    assert.equal(step.color,'#FFFFFF');assert.equal(step.fadeSeconds,0);
    assert.equal(sampleHoldSeconds(step,()=>0),step.seconds);
    assert.equal(sampleHoldSeconds(step,()=>1),step.secondsMax);
    assert.ok(sampleHoldSeconds(step,()=>0.6)>=step.seconds);
  }
  assert.equal(sampleHoldSeconds({seconds:30},()=>0.9),30);
  const dark=lightCommand({id:'100',spectrum:'rgb'},lightning.steps[1]);
  assert.equal(dark.on,false);assert.equal(dark.brightness,0);assert.equal(dark.saturation,0);
  const bright=lightCommand({id:'100',spectrum:'rgb'},lightning.steps[0]);
  assert.equal(bright.on,true);assert.equal(bright.brightness,100);assert.equal(bright.saturation,0);
  for(const maximum of [0.05,3601,NaN,'1']){
    const invalid=structuredClone(lightning);invalid.steps[0].secondsMax=maximum;
    assert.throws(()=>validateAnimation(invalid,invalid));
  }
});

test('Lightning sends max-white then explicit Off, and Stop prevents further random pulses',async t=>{
  const f=await fixture(t),item=f.manager.admin().animations.find(item=>item.id==='preset-lightning');
  const run=request(item);await f.manager.start(item.id,run);await until(()=>f.calls.length>=2);
  assert.equal(f.calls[0].values.brightness,100);assert.equal(f.calls[0].values.on,true);
  assert.equal(f.calls[0].values.saturation,0);assert.equal(f.calls[0].fadeSeconds,0);
  assert.equal(f.calls[1].values.brightness,0);assert.equal(f.calls[1].values.on,false);
  await f.manager.stop({runId:run.requestId});assert.equal(f.manager.active,null);
  assert.equal(f.calls.length,2);
});

test('light commands adapt RGB, white and dimmer capabilities without changing steps',()=>{
  const step={...animationPresets()[0].steps[0],color:'#00FF00',warmth:85,fadeSeconds:1};const before=JSON.stringify(step);
  assert.equal(lightCommand({id:'100',spectrum:'rgb'},step).hue,120);
  assert.equal(lightCommand({id:'101',spectrum:'white'},step).temperature,85);
  assert.equal(lightCommand({id:'102',spectrum:'none'},step).hue,undefined);
  assert.equal(lightCommand({id:'100',spectrum:'rgb'},step)['fade-seconds'],undefined);assert.equal(JSON.stringify(step),before);
});

test('an unavailable plugin configuration cannot break the administrator light catalogue',async t=>{
  const f=await fixture(t);f.registry.services=()=>[{id:'tradfri',controls:{lighting:{identitySetting:'host',identityState:'gateway-host'}}}];
  assert.deepEqual(f.manager.admin().lights,[]);
});

test('Start is durable, single-admission and idempotent; Stop while paused cancels without another command',async t=>{
  const f=await fixture(t),animation=f.manager.admin().animations[0],values=request(animation);
  await Promise.all([f.manager.start(animation.id,values),f.manager.start(animation.id,values)]);
  await until(()=>f.calls.length===1);assert.equal(f.manager.runs.snapshot().runs.length,1);
  await assert.rejects(f.manager.start(animation.id,request(animation)),/Stop the current/);
  f.gate.setPaused(true);const count=f.calls.length;await f.manager.stop({runId:values.requestId});
  assert.equal(f.calls.length,count);assert.equal(f.manager.active,null);assert.equal(f.manager.runs.snapshot().runs[0].status,'stopped');
  await f.manager.start(animation.id,values);assert.equal(f.calls.length,count,'A retained request cannot replay a completed run');
});

test('edits, configuration changes and manual takeover cancel future animation effects',async t=>{
  for(const change of ['edit','disable','config','manual']){
    const f=await fixture(t),item=f.manager.admin().animations[0];await f.manager.start(item.id,request(item));await until(()=>f.calls.length===1);
    if(change==='edit')await f.manager.save({...item,name:'Edited'},item.id);
    if(change==='disable')await f.manager.save({revision:item.revision,enabled:false},item.id,'enabled');
    if(change==='config'){f.setRevision(2);f.manager.reconcile();}
    if(change==='manual')f.manager.interrupt('Another lighting control took over.');
    await until(()=>!f.manager.active);assert.equal(f.calls.length,1);assert.equal(f.manager.runs.snapshot().runs[0].status,'stopped');
  }
});

test('duration completes, command errors never retry, and unready or stale targets cannot start',async t=>{
  const f=await fixture(t),item=f.manager.admin().animations[0];
  f.gate.setPaused(true);await assert.rejects(f.manager.start(item.id,request(item)),/Enable server/);f.gate.setPaused(false);
  f.setIdentity('changed-gateway');await assert.rejects(f.manager.start(item.id,request(item)),/selected light/);f.setIdentity('test-gateway');
  await assert.rejects(f.manager.start(item.id,request(item,{targets:['999']})),/selected light/);
  await f.manager.start(item.id,request(item,{durationMinutes:0.001}));await until(()=>!f.manager.active);
  assert.equal(f.manager.runs.snapshot().runs[0].status,'completed');
  f.setFailure();const count=f.calls.length;await f.manager.start(item.id,request(item));await until(()=>!f.manager.active);
  assert.equal(f.calls.length,count+1);const run=f.manager.runs.snapshot().runs.at(-1);
  assert.equal(run.status,'failed');assert.doesNotMatch(run.message,/Private/);
});

test('copy starts disabled, stale edits reject, and restart marks unfinished claims interrupted without replay',async t=>{
  const f=await fixture(t),item=f.manager.admin().animations[0];await f.manager.save({revision:item.revision},item.id,'copy');
  const copy=f.manager.admin().animations.at(-1);assert.equal(copy.enabled,false);assert.notEqual(copy.id,item.id);
  await assert.rejects(f.manager.save({...item,revision:0},item.id),/changed/);
  await f.manager.runs.update(value=>{value.runs.push({id:randomUUID(),animationId:item.id,status:'running'});});
  const reopened=await new LightingAnimations(f.root,f.registry,{add:async()=>{}}).load();
  assert.equal(reopened.runs.snapshot().runs.at(-1).status,'interrupted');assert.equal(f.calls.length,0);await reopened.close();
});

test('shutdown drains admission and malformed storage disables only lighting animations',async t=>{
  const f=await fixture(t),item=f.manager.admin().animations[0];
  const write=f.manager.runs.write.bind(f.manager.runs);let release,writing=false;
  const blocked=new Promise(resolve=>{release=resolve;});
  f.manager.runs.write=async value=>{if(!writing){writing=true;await blocked;}return write(value);};
  const start=f.manager.start(item.id,request(item));await until(()=>writing);const closing=f.manager.close();release();await start;await closing;
  assert.equal(f.calls.length,0);assert.equal(f.manager.active,null);
  await fs.writeFile(path.join(f.root,'data/lighting-animations.json'),'{invalid');
  const broken=await new LightingAnimations(f.root,f.registry,{add:async()=>{}}).load();
  assert.match(broken.admin().reason,/Original files/);assert.equal(await fs.readFile(path.join(f.root,'data/lighting-animations.json'),'utf8'),'{invalid');await broken.close();
});

test('administrator routes require normal Origin/token and serve a separate page without light effects',async t=>{
  await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'lighting-http-'));
  await fs.mkdir(path.join(root,'web'));await fs.copyFile('web/index.html',path.join(root,'web/index.html'));
  const app=await createLocalserve(root,{automatic:false});
  t.after(async()=>{await app.close();assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});
  const call=(endpoint,body,headers={})=>fetch(app.origin+endpoint,{method:'POST',headers:{'Content-Type':'application/json',Origin:app.origin,
    'X-Localserve-Token':app.snapshot().token,...headers},body:JSON.stringify(body)});
  assert.equal((await fetch(app.origin+'/lighting-animations')).status,200);
  const item=app.lightingAnimations.admin().animations[0];
  assert.equal((await call('/api/lighting-animations/'+item.id+'/enabled',{revision:1,enabled:false},{Origin:'https://foreign.invalid'})).status,403);
  assert.equal((await call('/api/lighting-animations/'+item.id+'/enabled',{revision:1,enabled:false})).status,200);
  assert.equal(app.lightingAnimations.admin().animations[0].enabled,false);
  assert.equal((await call('/api/lighting-animations/'+item.id+'/start',request(item))).status,409);
  assert.equal(app.lightingAnimations.admin().active,null);
});

test('supervised worker receives only animation-owned fades and a real registry manual action takes over',async t=>{
  await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'lighting-ipc-'));
  await fs.mkdir(path.join(root,'plugins/tradfri/server'),{recursive:true});
  await fs.copyFile('plugins/tradfri/declaration.json',path.join(root,'plugins/tradfri/declaration.json'));
  await fs.writeFile(path.join(root,'plugins/tradfri/server/index.mjs'),`export default {
    validateConfiguration(){return true},async start(){},async stop(){},
    async execute(id,values,context){await context.wait(0.001);await context.saveState({fade:context.lightingFadeSeconds??null});await context.log('Synthetic ACK');return {ok:true};}
  };`);
  const app=await createLocalserve(root,{automatic:false});
  t.after(async()=>{await app.close();assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});});
  const service=app.registry.services()[0];await app.registry.saveConfiguration('tradfri',{revision:service.config.revision,enabled:true});
  app.lightingAnimations.lights=()=>[{id:'100',spectrum:'rgb',reachable:true}];
  const item=app.lightingAnimations.admin().animations[0];await app.lightingAnimations.start(item.id,request(item));
  await until(()=>app.registry.get('tradfri').state.snapshot().fade===item.steps[0].fadeSeconds);
  await app.registry.execute('tradfri','light-power',{id:'100',on:false});
  await until(()=>!app.lightingAnimations.active);
  assert.equal(app.lightingAnimations.runs.snapshot().runs.at(-1).status,'stopped');
  assert.equal(app.registry.get('tradfri').state.snapshot().fade,null,'Manual actions receive no animation override');
});
