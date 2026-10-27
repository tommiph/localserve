/** Editor hints are derived from declared schemas and explicitly selected
 * history. No fixture manufactures a live Event or executes a device action. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {validateFields} from '../server/plugin-schema.mjs';
const state = {paused: false, services: [], taskEvents: [{id: 'event', pluginId: 'phone', eventId: 'changed', pluginName: 'Phone', name: 'Reading', payload: [
  {id: 'value', label: 'Light level', type: 'number', required: true},
  {id: 'flag', label: 'Connected', type: 'boolean'},
  {id: 'optional', label: 'Optional field', type: 'string', default: 'NOT_CAPTURED'},
  {id: 'secret', label: 'Private', type: 'string', format: 'secret'},
]}]};
const actions = [{id: 'plugin:lights:on', category: 'lights', type: 'plugin', pluginName: 'TRÅDFRI', name: 'Power on', description: 'Set power', available: false, unavailableReason: 'Gateway not configured'}];
let serial = 0;
const context = vm.createContext({state, URL, actionCatalog: actions, structuredClone, document: {addEventListener() {}}, dialog: {querySelector: () => null},
  crypto: {randomUUID: () => `id-${++serial}`}, escapeHtml: value => String(value ?? '').replaceAll('<', '&lt;'), icon: () => '', formatServerTimestamp: value => `At ${value}`});
vm.runInContext(await fs.readFile(new URL('../web/admin-ux.js', import.meta.url), 'utf8')+'\nglobalThis.setup=SetupUI;',context);
vm.runInContext(await fs.readFile(new URL('../web/tasks-ui.js', import.meta.url), 'utf8') + '\nglobalThis.tasks = TaskUI;', context);
vm.runInContext(await fs.readFile(new URL('../web/vistas-ui.js', import.meta.url), 'utf8') + '\nglobalThis.vista = VistaUI;', context);
vm.runInContext(await fs.readFile(new URL('../web/card-designer.js', import.meta.url), 'utf8') + '\nglobalThis.cards = CardDesigner;', context);
vm.runInContext(await fs.readFile(new URL('../web/plugin-ui.js', import.meta.url), 'utf8') + '\nglobalThis.plugin = PluginUI;', context);
vm.runInContext(await fs.readFile(new URL('../web/phone-home-ui.js', import.meta.url), 'utf8') + '\nglobalThis.phone = PhoneHomeUI;', context);

async function vistaLaunchFixture() {
  const state = { paused: false, server: { lanAddress: 'http://192.0.2.10:8123' },
    vistaDisplay: { revision: 4, vistaId: 'shared' },
    vistas: [{ id: 'own', name: 'Wall', slug: 'wall', enabled: true }],
    services: [{ id: 'samsung-tv', enabled: true, config: { revision: 7 },
      actions: [{ id: 'launch-app', available: true }] }] };
  const calls = [], messages = [];
  let finish, failure;
  const pending = new Promise((resolve, reject) => { finish = resolve; failure = reject; });
  const scope = { state, document: { addEventListener() {} },
    escapeHtml: String, icon: () => '', pageHeading: () => '', itemActions: () => '', renderView() {},
    notify: message => messages.push(message),
    mutate: (endpoint, values) => { calls.push({ endpoint, values }); return pending; } };
  const ui = vm.runInNewContext(await fs.readFile(new URL('../web/vistas-ui.js', import.meta.url), 'utf8') + '\nVistaUI;', scope);
  return { ui, state, calls, messages, finish, failure };
}

test('Vista TV launch sends one own-URL command with the current TV revision and preserves shared selection', async () => {
  const f = await vistaLaunchFixture(), before = JSON.stringify(f.state);
  assert.match(f.ui.render(), /data-action="vista-tv"/);
  const launch = f.ui.handleAction('vista-tv', 'own', {});
  await f.ui.handleAction('vista-tv', 'own', {});
  assert.equal(f.calls.length, 1, 'Repeat clicks cannot queue another launch');
  assert.equal(f.calls[0].endpoint, 'api/plugins/samsung-tv/actions/launch-app');
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].values)), { revision: 7,
    parameters: { id: 'HwGlance01.HomeGlance', mode: 'DEEP_LINK', arguments: 'http://192.0.2.10:8123/vistas/wall' } });
  assert.equal(f.ui.tvPending, true);
  f.finish({}); await launch;
  assert.equal(f.ui.tvPending, false);
  assert.equal(JSON.stringify(f.state), before);
  assert.match(f.messages.at(-1), /sent to the TV/);
});

test('Vista TV controls reject paused, disabled, missing and unavailable targets before sending', async () => {
  for (const alter of [f => { f.state.paused = true; }, f => { f.state.vistas[0].enabled = false; },
    f => { f.state.vistas = []; }, f => { f.state.services = []; },
    f => { f.state.services[0].enabled = false; }, f => { f.state.services[0].actions[0].available = false; },
    f => { f.state.server.lanAddress = null; }]) {
    const f = await vistaLaunchFixture(); alter(f);
    await f.ui.handleAction('vista-tv', 'own', {});
    assert.equal(f.calls.length, 0); assert.ok(f.messages.length);
    if(f.state.vistas.length)assert.match(f.ui.render(), /data-action="vista-tv"[^>]*disabled/);
  }
});

test('Vista TV failures restore controls and explain uncertainty without an automatic retry', async () => {
  const f = await vistaLaunchFixture();
  const launch = f.ui.handleAction('vista-tv', 'own', {});
  f.failure(new Error('TV connection closed; delivery unknown.')); await launch;
  assert.equal(f.calls.length, 1); assert.equal(f.ui.tvPending, false);
  assert.match(f.messages.at(-1), /delivery unknown.*No launch was retried/);
  assert.equal(f.ui.tvLaunchAvailability().reason, '');
});

test('declaration presentation metadata round-trips numeric storage units and preserves constraints', () => {
  const fields=validateFields([{id:'interval',label:'Seconds',type:'number',min:0.05,max:0.1,displayScale:60,section:'Readings',advanced:true}]);
  const html=context.plugin.field(fields[0],0.05,'test');
  assert.match(html,/min="3"/); assert.match(html,/max="6"/); assert.match(html,/value="3"/);
  assert.equal(context.plugin.readFields(fields,{querySelector:()=>({value:'4.5'})}).interval,0.075);
  assert.equal(fields[0].min,0.05);
  assert.match(context.plugin.groupFields(fields,field=>context.plugin.field(field,0.05,'test')),/Advanced · Readings/);
  for(const patch of [{displayScale:0},{displayScale:Infinity},{advanced:'yes'},{section:''}])assert.throws(()=>validateFields([{...fields[0],...patch}]));
  assert.throws(()=>validateFields([{id:'bad',type:'string',displayScale:60}]));
});

test('phone handoff uses the bound LAN origin and otherwise explains localhost', () => {
  state.server={lanAddress:null}; assert.match(context.phone.connection(),/localhost address reaches this PC only/);
  state.server.lanAddress='http://192.168.1.2:7041';
  assert.equal(context.phone.homeAddress(),'http://192.168.1.2:7041/scenes');
  assert.match(context.phone.connection(),/value="http:\/\/192\.168\.1\.2:7041"/);
  assert.match(context.phone.connection(),/Sensors can stay disabled/);
});

test('definition row tools keep names, action identities and source scope without repeating badges',()=>{
  const item={id:'source-1',name:'Hall light',enabled:false},before=JSON.stringify(item);
  const html=vm.runInContext('AdminUX',context).definitionActions(item,{edit:'plugin-list-edit',copy:'plugin-list-copy',delete:'plugin-list-delete',toggle:'plugin-list-toggle'},{attributes:{setting:'rooms'}});
  assert.match(html,/role="group" aria-label="Actions for Hall light"/);
  for(const action of ['edit','copy','delete','toggle'])assert.match(html,new RegExp('data-action="plugin-list-'+action+'" data-id="source-1" data-setting="rooms"'));
  for(const label of ['Edit','Copy','Delete'])assert.ok(html.includes('<span>'+label+'</span>'));
  assert.match(html,/aria-checked="false"/);assert.match(html,/aria-label="Hall light enabled"/);
  assert.equal((html.match(/aria-hidden="true">Disabled/g)||[]).length,1);
  assert.equal(JSON.stringify(item),before);
});

test('setup guide derives outcomes from installed capabilities without changing saved state', () => {
  const services=state.services;state.services=[{id:'camera',name:'Camera',icon:'videocam',enabled:false,configurationReady:false,runtime:{preview:'jpeg-v1'},cards:[]}];
  const before=JSON.stringify(state);let html='';
  context.statusPill=label=>label;
  context.showDialog=body=>{html=body;};context.dialogHeader=label=>label;
  context.setup.open();assert.match(html,/Connect a service/);assert.match(html,/Create a first Task/);assert.match(html,/Create a display/);assert.match(html,/Use Controller/);
  context.setup.open('device','camera');assert.match(html,/Configure/);assert.match(html,/guide does not test the connection/);
  context.setup.handle('setup-back');assert.match(html,/Choose a service/);
  context.setup.open('display');assert.match(html,/does not open the TV or change \/display/);
  assert.equal(JSON.stringify(state),before);state.services=services;
});

test('Vista map/path identities disambiguate duplicate names without renaming saved nodes', () => {
  context.vista.draft={layout:{id:'root',type:'row',name:'Canvas',enabled:true,children:[
    {id:'a',type:'column',name:'Column',children:[]},{id:'b',type:'column',name:'Column',children:[]}]}};
  const before=JSON.stringify(context.vista.readDraft());
  assert.equal(context.vista.nodePath('a'),'1.1'); assert.equal(context.vista.nodePath('b'),'1.2');
  const paths=context.vista.targets().map(item=>item.name);
  assert.notEqual(paths[1],paths[2]);
  assert.match(context.vista.layoutMap(),/data-id="b"/);
  assert.equal(JSON.stringify(context.vista.readDraft()),before);
  const next=context.vista.newNode('column'); context.vista.draft.layout.children.push(next);
  assert.notEqual(context.vista.newNode('column').name,next.name);
});

test('Card deletion lists nested references without changing saved selections', () => {
  state.vistas=[{id:'vista',name:'Wall display',layout:{children:[{cards:[{pluginId:'one',cardId:'card'}]}]}}];
  state.universe={cards:[{pluginId:'one',cardId:'card'}]};
  const before=JSON.stringify([state.vistas,state.universe]);
  const html=context.cards.dependencySummary('one','card');
  assert.match(html,/Wall display/); assert.match(html,/Open Vista editor/); assert.match(html,/Open Universe editor/);
  assert.match(html,/Phone favorites are stored separately/);
  assert.equal(JSON.stringify([state.vistas,state.universe]),before);
  assert.match(context.cards.dependencySummary('other','card'),/No saved Vista or Universe references/);
});

test('Vista fit warnings inspect only visible loaded frames and never alter a layout', () => {
  const notice={textContent:'',hidden:true,ownerDocument:{getSelection:()=>null,activeElement:null}},original=context.dialog;
  const frame=(title,visible,height,scroll)=>({title,clientWidth:visible?300:0,clientHeight:height,contentDocument:{querySelector:()=>({clientHeight:height,scrollHeight:scroll,clientWidth:300,scrollWidth:300})}});
  context.dialog={querySelectorAll:()=>[frame('Tall card',true,200,400),frame('Fits',true,400,400),frame('Hidden',false,200,500)],querySelector:()=>notice};
  const before=JSON.stringify(context.vista.draft);
  context.vista.reportFit();assert.equal(notice.hidden,false);assert.match(notice.textContent,/Tall card/);assert.doesNotMatch(notice.textContent,/Fits|Hidden/);
  assert.equal(JSON.stringify(context.vista.draft),before);context.dialog=original;
});

test('Tasks offers optional guided creation without enabling or changing builders', () => {
  state.services = [];
  assert.equal(context.tasks.recipeEntry(), '');
  state.services = [{id: 'recipes', taskBuilder: true, enabled: false}];
  assert.match(context.tasks.recipeEntry(), /data-view="recipes"/);
  assert.doesNotMatch(context.tasks.recipeEntry(), /data-action=/);
  assert.equal(state.services[0].enabled, false);
  state.services[0].enabled = true;
  assert.match(context.tasks.recipeEntry(), /data-action="task-recipe" data-id="recipes"/);
  assert.match(context.tasks.recipeEntry(), /Build a task/);
  state.services = [];
});

test('latest Task receipt uses stable identity and preserves retained order', () => {
  state.runs = [{taskId:'other',startedAt:999,status:'failed'},
    {taskId:'chosen',startedAt:10,status:'failed'}, {taskId:'chosen',startedAt:20,status:'completed'}];
  const before = JSON.stringify(state.runs);
  const html = context.tasks.runSummary({id:'chosen',name:'Renamed task',enabled:false});
  assert.match(html, /Completed · At 20/);
  assert.match(html, /View runs for Renamed task/);
  assert.match(html, /data-id="chosen"/);
  assert.doesNotMatch(html, /disabled|task-run"/);
  assert.equal(JSON.stringify(state.runs), before);
  assert.match(context.tasks.runSummary({id:'missing'}), /No retained runs/);
  state.runs = [{taskId:'chosen',startedAt:0,status:'running'}];
  assert.match(context.tasks.runSummary({id:'chosen',name:'Task'}), /Running · At 0/);
  state.runs = [];
});

test('View runs clears unrelated filters and focuses history without a mutation', async () => {
  const source = await fs.readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const start = source.indexOf("if(action==='task-view-runs')");
  const branch = source.slice(start, source.indexOf("if (action === 'navigation-toggle'", start));
  const calls = [];
  const ctx = vm.createContext({action:'task-view-runs', id:'chosen', state:{tasks:[{id:'chosen'}]},
    RunUI:{task:'other',status:'failed',period:'day',limit:99}, currentView:'tasks',
    renderView:()=>calls.push('render'), workspace:{querySelector:()=>({focus:()=>calls.push('focus'),scrollIntoView:()=>calls.push('scroll')})}});
  vm.runInContext(`(()=>{${branch}})()`,ctx);
  assert.equal(ctx.RunUI.task,'chosen'); assert.equal(ctx.RunUI.status,'');
  assert.equal(ctx.RunUI.period,''); assert.equal(ctx.RunUI.limit,20);
  assert.deepEqual(calls,['render','focus','scroll']);
  calls.length=0; ctx.id='deleted'; vm.runInContext(`(()=>{${branch}})()`,ctx);
  assert.deepEqual(calls,[]);
});

test('action search includes owner names and explains unavailable choices', () => {
  context.tasks.librarySearch = 'trådfri';
  assert.match(context.tasks.libraryRows(), /Power on/);
  assert.match(context.tasks.libraryRows(), /Gateway not configured/);
  assert.match(context.tasks.libraryRows(), /TRÅDFRI/);
  context.tasks.libraryCategory = 'server'; assert.match(context.tasks.libraryRows(), /No actions match/);
});

test('Event search keeps exact selected identity, groups matches and retains unavailable choices', () => {
  const events=state.taskEvents;
  state.taskEvents=[{id:'phone:one:lux',pluginId:'sensors',pluginName:'Sensors',name:'Phone one · Ambient light'},
    {id:'phone:two:lux',pluginId:'sensors',pluginName:'Sensors',name:'Phone two · Ambient light'},
    {id:'tv:power',pluginId:'tv',pluginName:'TV',name:'Power',available:false}];
  const selected='phone:one:lux';
  let html=context.tasks.eventOptions(selected,'two');
  assert.match(html,/optgroup label="Sensors"/); assert.match(html,/phone:two:lux/);
  assert.match(html,/optgroup label="Current selection"/); assert.match(html,/value="phone:one:lux" selected/);
  html=context.tasks.eventOptions('missing','nothing');
  assert.match(html,/No matching Events/); assert.match(html,/value="missing" selected/);
  assert.match(context.tasks.eventOptions('','power'),/Power · Unavailable/);
  state.taskEvents=events;
});

test('action summaries use public binding/choice labels while retaining zero and false', () => {
  const original=context.tasks.draftRules;
  context.tasks.draftRules=()=>[{type:'event',eventId:'event'}];
  const step={parameters:{message:'At {{event.value}}',zero:0,flag:false,choice:'app-id',secret:'PRIVATE'}}, before=JSON.stringify(step);
  const html=context.tasks.parameterSummary(step,{parameters:[
    {id:'message',label:'Message',type:'string'}, {id:'zero',type:'number'}, {id:'flag',type:'boolean'},
    {id:'choice',type:'string',enum:['app-id'],enumLabels:['Video player']}, {id:'secret',type:'string',format:'secret'}]});
  assert.match(html,/\[Light level\]/); assert.match(html,/zero: 0/); assert.match(html,/flag: No/);
  assert.match(html,/Video player/); assert.doesNotMatch(html,/app-id|PRIVATE/);
  assert.equal(JSON.stringify(step),before); context.tasks.draftRules=original;
});

test('binding chips label public fields and flag missing/secret/mixed-rule bindings without changing tokens', () => {
  const text = '{{event.value}} / {{event.flag}} / {{event.secret}} / {{event.missing}}';
  const rules = [{type: 'event', eventId: 'event', enabled: false}];
  const html = context.tasks.bindingHints(text, rules);
  assert.match(html, /Light level/); assert.match(html, /Connected · optional/);
  assert.match(html, /secret · missing binding/); assert.match(html, /missing · missing binding/);
  assert.equal(text, '{{event.value}} / {{event.flag}} / {{event.secret}} / {{event.missing}}');
  assert.match(context.tasks.bindingHints('{{event.value}}', [...rules, {type: 'schedule'}]), /do not supply Event values/);
  assert.match(context.tasks.bindingHints('{{oops}}', rules), /Use \{\{event.field-id\}\}/);
});

test('explicit captured preview preserves zero/false and never substitutes defaults or current readings', () => {
  const run = {startedAt: 99, event: {pluginId: 'phone', eventId: 'changed', occurredAt: 0, payload: {value: 0, flag: false, secret: 'DO_NOT_SHOW'}}};
  const html = context.tasks.previewEvent(run);
  assert.match(html, /At 0/); assert.match(html, />0</); assert.match(html, />No</);
  assert.match(html, /Not captured/); assert.doesNotMatch(html, /DO_NOT_SHOW|NOT_CAPTURED/);
  assert.match(context.tasks.previewEvent(null), /Select a saved Event/);
});

test('Vista selection, filters and simultaneous preview remain outside the saved draft; presets use supported CSS sizes', () => {
  const draft = {name: 'Vista', layout: context.vista.newNode('column')};
  context.vista.draft = draft;
  const before = JSON.stringify(context.vista.readDraft());
  Object.assign(context.vista, {splitPreview: true, selectedNodeId: 'elsewhere', libraryCategory: 'layout', librarySearch: 'card'});
  assert.equal(JSON.stringify(context.vista.readDraft()), before);
  const html = context.vista.sizePresets({...draft.layout, width: '50%'}, 'width');
  assert.match(html, /value="50%" selected/); assert.match(html, /Fill available space/);
});


// A polling redraw must not steal keyboard focus from the mobile plugin menu
// or jump to a different Activity disclosure with the same visible label.
test('polling restores the same navigation control and Activity disclosure', async () => {
  const source = await fs.readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const render = source.slice(source.indexOf('function renderView()'), source.indexOf('function openNameEditor()'));
  const document = {activeElement: null, querySelector: selector => selector === '#admin-navigation' ? navigation : {}, getElementById: () => null};
  const navigation = {nodes: [], querySelectorAll() { return this.nodes; }};
  const workspace = {nodes: [], querySelectorAll() { return this.nodes; }};
  const control = (kind, key) => ({
    id: '', tagName: kind === 'nav' ? 'BUTTON' : 'SUMMARY', dataset: kind === 'nav' ? {view: key} : {}, isConnected: true,
    matches: () => true, getAttribute: () => null,
    closest: selector => selector === '#admin-navigation' ? kind === 'nav' ? navigation : null
      : kind === 'activity' ? {dataset: {activityDetails: key}} : null,
    focus() { document.activeElement = this; },
  });
  const ctx = vm.createContext({document, workspace, AdminDOM: {text() {}}, ControlsUI: {ownsView: () => false}, state: {services: []}, currentView: 'overview',
    renderSaveFeedback() {}, renderNavigation() {}, renderOverview() {}});
  vm.runInContext(render, ctx);
  for (const kind of ['nav', 'activity']) {
    const old = control(kind, 'second'); document.activeElement = old;
    const replacement = control(kind, 'second');
    const redraw = () => {old.isConnected = false; (kind === 'nav' ? navigation : workspace).nodes = [control(kind, 'first'), replacement];};
    ctx.renderNavigation = kind === 'nav' ? redraw : () => {};
    ctx.renderOverview = kind === 'activity' ? redraw : () => {};
    vm.runInContext('renderView()', ctx);
    assert.equal(document.activeElement, replacement, kind + ' focus survives polling');
  }
});
