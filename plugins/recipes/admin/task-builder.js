/** Visual recipe composition uses declared capabilities and literal choices.
 * Wording is presentation only; exact source IDs and typed values form Tasks. */
export function actionFields(action) {
  if (action.parameters) return action.parameters;
  if (action.type === 'log') return [{id:'message',label:'Message',type:'string',required:true,maxLength:2000,format:'multiline'}];
  if (action.type === 'delay') return [{id:'seconds',label:'Seconds',type:'number',required:true,min:.01,max:86400,default:5}];
  return [];
}

export function makeDraft(actions, events, selection, uuid) {
  const action = actions.find(item => item.id === selection.actionId && item.available !== false);
  if (!action) throw Error('Choose an available action.');
  const step = {id:uuid(),enabled:true,type:action.type};
  if (action.type === 'plugin') Object.assign(step,{capabilityId:action.id,parameters:selection.parameters});
  else Object.assign(step,selection.parameters);
  const starts = [];
  if (selection.when !== 'manual') {
    const rule = {id:uuid(),enabled:true,type:selection.when,name:selection.when[0].toUpperCase()+selection.when.slice(1),nameEdited:false};
    if (rule.type === 'event') {
      const event = events.find(item => item.id === selection.eventId && item.available !== false);
      if (!event) throw Error('Choose an available signal.');
      rule.eventId = event.id;
      if (selection.condition) {
        if (!event.payload.some(field => field.id === selection.condition.field && field.format !== 'secret')) throw Error('Choose an available property.');
        rule.condition = selection.condition;
      }
    } else if (['schedule','sunrise','sunset'].includes(rule.type)) {
      if (!selection.days?.length) throw Error('Choose at least one day.');
      rule.days = selection.days;
      if (rule.type === 'schedule') rule.time = selection.time;
    } else if (['timer','interval'].includes(rule.type)) rule.seconds = selection.seconds;
    else throw Error('Choose when this should happen.');
    starts.push(rule);
  }
  return {name:selection.name.trim().slice(0,48)||action.name.slice(0,48),enabled:false,starts,steps:[step]};
}

const looks = {
  'run-scene':['Set the mood','auto-awesome','mint','set a lighting scene'],
  'show-notice':['Tell me something','notifications-active','peach','show a message on my TV'],
  'play-youtube':['Play a video','smart-display','lilac','play a video on my TV'],
  'open-on-tv':['Put it on the TV','live-tv','sky','open a page on my TV'],
  'light-power':['Switch a light','lightbulb','lemon','switch a light'],
  'group-power':['Light up a room','light-group','lemon','switch a group of lights'],
  'light-brightness':['Find the right glow','brightness-6','peach','change a light’s brightness'],
  'group-brightness':['Dim the room','wb-twilight','peach','change a group’s brightness'],
  'light-temperature':['Warm things up','wb-incandescent','lemon','change the white tone'],
  'light-color':['Add a little colour','palette','lilac','change a light’s colour'],
  'volume':['Set the volume','volume-up','sky','change the TV volume'],
  'mute':['Keep it quiet','volume-off','mint','change the TV sound'],
  'launch-app':['Open an app','apps','lilac','open an app on my TV'],
  'log':['Leave a note','edit-note','mint','leave a note in Activity'],
  'delay':['Take a little pause','hourglass-bottom','sky','wait a little while'],
  'show-vista':['Change the view','dashboard','sky','show a Vista on my display'],
};
const favouriteKeys = ['run-scene','show-notice','play-youtube','open-on-tv','light-power','light-brightness','log','delay'];

function keyOf(action) { return action.actionId || (action.type==='plugin'?action.id.split(':')[2]:action.id); }
export function describeAction(action) {
  const look = looks[keyOf(action)];
  return look ? {title:look[0],glyph:look[1],tone:look[2],phrase:look[3]} : {
    title:action.name,glyph:action.icon||'bolt',tone:'sky',phrase:action.name[0].toLowerCase()+action.name.slice(1),
  };
}

function labelFor(field, action) {
  if (field.id === 'scene-id') return 'Which mood?';
  if (field.id === 'id') return keyOf(action)==='launch-app'?'Which app?':keyOf(action).startsWith('group')?'Which group?':'Which light?';
  return ({title:'Give it a title',message:'What should it say?',template:'Choose a feeling',on:'Turn it',value:'Set it to',color:'Pick a colour','video-id':'Which video?',seconds:'For how long?',sound:'A little sound too?','auto-close':'Close by itself?','loop-sound':'Repeat the sound?',mode:'Launch style',arguments:'Extra app details'})[field.id] || field.label;
}

export function cleanChoice(value) { return String(value).replace(/\s*\([a-z0-9-]{16,}\)\s*$/i,'').trim(); }
function valueLabel(field, value) {
  const at = field.enum?.findIndex(choice => choice === value);
  return at >= 0 ? cleanChoice(field.enumLabels?.[at] ?? value) : String(value ?? '');
}

export function actionSentence(action, parameters) {
  if (!action) return 'choose something to happen';
  const key = keyOf(action), field = id => actionFields(action).find(field => field.id===id);
  const target = field('id') ? valueLabel(field('id'),parameters.id) : '';
  if (key==='run-scene') return parameters['scene-id'] ? 'set the mood to '+valueLabel(field('scene-id'),parameters['scene-id']) : 'set a lighting scene';
  if (['light-power','group-power'].includes(key)) return 'turn '+(target||'the lights')+(parameters.on===false?' off':' on');
  if (['light-brightness','group-brightness'].includes(key)) return 'set '+(target||'the lights')+' to '+(parameters.value??50)+'%';
  if (key==='show-notice') return parameters.title?'show “'+parameters.title+'” on my TV':'show a message on my TV';
  if (key==='delay') return 'wait '+durationWords(parameters.seconds??5);
  if (key==='launch-app') return parameters.id?'open '+target+' on my TV':'open an app on my TV';
  return describeAction(action).phrase;
}

function durationWords(seconds) {
  if (seconds>=3600&&seconds%3600===0) return seconds/3600+(seconds===3600?' hour':' hours');
  if (seconds>=60&&seconds%60===0) return seconds/60+(seconds===60?' minute':' minutes');
  return seconds+(seconds===1?' second':' seconds');
}
function daysWords(days) {
  const values=[...days].sort().join(',');
  if (values==='0,1,2,3,4,5,6') return 'every day';
  if (values==='1,2,3,4,5') return 'on weekdays';
  if (values==='0,6') return 'at weekends';
  return 'on '+[1,2,3,4,5,6,0].filter(day=>days.includes(day)).map(day=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day]).join(', ');
}
function signalName(event) { return event?.name || 'something happens'; }
const numericOperators={lt:'is below',gt:'is above',eq:'is',ne:'is not',lte:'is at most',gte:'is at least'};
const textOperators={contains:'includes',eq:'is',ne:'is not'};
function operatorsFor(field) { return field.type==='number'?numericOperators:field.type==='string'?textOperators:{eq:'is',ne:'is not'}; }

export function whenSentence(model, events, formatTime=value=>value) {
  if (model.when==='manual') return 'I choose to run it';
  if (model.when==='schedule') return 'it’s '+formatTime(model.time)+' '+daysWords(model.days);
  if (model.when==='sunrise'||model.when==='sunset') return 'it’s '+model.when+' '+daysWords(model.days);
  if (model.when==='timer') return durationWords(model.seconds)+' have passed after enabling the rule';
  if (model.when==='interval') return 'every '+durationWords(model.seconds);
  const event=events.find(event=>event.id===model.eventId);
  if (!event) return 'something happens';
  const condition=model.condition,field=event.payload.find(field=>field.id===condition?.field);
  if (!field) return signalName(event);
  const label=field.label||field.id,unit=/\s*\(([^()]+)\)$/.exec(label);
  const propertyName=label.replace(/\s*\([^()]+\)$/,'').trim();
  const redundant=/^(value|reading|current value)$/i.test(propertyName)||signalName(event).toLowerCase().endsWith(propertyName.toLowerCase());
  const property=redundant?'':' · '+propertyName;
  const value=field.type==='boolean'?(condition.value?'yes':'no'):valueLabel(condition.operator==='contains'?{...field,enum:undefined}:field,condition.value);
  return signalName(event)+property+' '+(operatorsFor(field)[condition.operator]||'is')+' '+value+(field.type==='number'&&unit?' '+unit[1]:'');
}

function initialParameters(action) {
  const values={...action.defaults};
  for (const field of actionFields(action)) {
    if (values[field.id]===undefined && field.default!==undefined) values[field.id]=field.default;
    // A first choice is a real declared choice, never an invented device ID.
    if (field.enum?.length && !field.enum.includes(values[field.id])) values[field.id]=field.enum[0];
  }
  return values;
}
export function normalizeParameters(action, parameters) {
  const next={...parameters};
  if(keyOf(action)==='play-youtube'&&typeof next['video-id']==='string'){
    let value=next['video-id'].trim();
    if(!/^[a-zA-Z0-9_-]{11}$/.test(value)){
      try{
        const url=new URL(value);
        if(url.protocol==='https:'&&!url.username&&!url.password){
          if(url.hostname==='youtu.be')value=url.pathname.slice(1);
          else if(['youtube.com','www.youtube.com','m.youtube.com'].includes(url.hostname))value=url.pathname==='/watch'?url.searchParams.get('v')||'':/^\/(shorts|live)\//.test(url.pathname)?url.pathname.split('/')[2]:value;
        }
      }catch{}
    }
    if(!/^[a-zA-Z0-9_-]{11}$/.test(value))throw Error('Add a video ID or a YouTube watch link.');
    next['video-id']=value;
  }
  return next;
}
export function createModel(actions, intent) {
  const action=actions.find(action=>action.id===intent&&action.available!==false);
  return {actionId:action?.id||'',parameters:action?initialParameters(action):{},when:'',eventId:'',condition:null,time:'19:00',days:[1,2,3,4,5,6,0],seconds:300,name:'',nameEdited:false,screen:action?(actionFields(action).length?'details':'when'):'idea'};
}
export function canonicalDraft(model) {
  return JSON.stringify({actionId:model.actionId,parameters:model.parameters,when:model.when,eventId:model.eventId,condition:model.condition,time:model.time,days:model.days,seconds:model.seconds,name:model.name});
}
export function screensFor(model, actions, events) {
  const action=actions.find(action=>action.id===model.actionId);
  return ['idea',...(action&&actionFields(action).length?['details']:[]),'when',
    ...(model.when==='event'?['signal',...(events.find(event=>event.id===model.eventId)?.payload.length?['condition']:[])]:[]),
    ...(['schedule','timer','interval','sunrise','sunset'].includes(model.when)?['timing']:[]),'finish'];
}

let motion=true,motionInstalled=false;
function installMotion() {
  if (motionInstalled) return;
  motionInstalled=true;
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-recipe-motion]');
    if (!button) return;
    motion=!motion;
    document.querySelectorAll('.recipe-studio,.recipe-wizard').forEach(node=>node.classList.toggle('recipe-still',!motion));
    document.querySelectorAll('[data-recipe-motion]').forEach(node=>{node.setAttribute('aria-pressed',String(!motion));node.setAttribute('aria-label',motion?'Pause gentle motion':'Resume gentle motion');});
  });
}
function motionButton(icon) { return `<button type="button" class="recipe-icon-button recipe-motion" data-recipe-motion aria-label="${motion?'Pause gentle motion':'Resume gentle motion'}" aria-pressed="${!motion}">${icon('motion-photos-pause')}</button>`; }

export function landing(api) {
  installMotion();
  const esc=api.escape;
  const actions=api.actions.filter(action=>['plugin','log','delay','show-vista'].includes(action.type));
  const favourites=favouriteKeys.map(key=>actions.find(action=>keyOf(action)===key&&action.available!==false)).filter(Boolean);
  const seen=new Set(favourites.map(action=>action.id));
  const choices=[...favourites,...actions.filter(action=>action.available!==false&&!seen.has(action.id))].slice(0,8);
  return `<section class="recipe-studio ${motion?'':'recipe-still'}" aria-label="Create a recipe">
    <div class="recipe-aurora" aria-hidden="true"></div>${motionButton(api.icon)}
    <div class="recipe-welcome"><span class="recipe-eyebrow">A LITTLE EVERYDAY MAGIC</span><h2>I want to<span class="recipe-blinking-dot">…</span></h2><p>Pick an idea. Let’s make it happen.</p></div>
    <ul class="recipe-cloud" aria-label="Ideas">${choices.map((action,index)=>{
      const look=describeAction(action);
      return `<li class="recipe-orbiter" data-live-key="idea:${esc(action.id)}"><button class="recipe-bubble recipe-tone-${look.tone}" type="button" data-action="plugin-task-builder" data-intent="${esc(action.id)}"><span class="recipe-bubble-icon">${api.icon(look.glyph)}</span><span>${esc(look.title)}</span><span class="recipe-bubble-plus">${api.icon('add')}</span></button></li>`;
    }).join('')}</ul>
    <div class="recipe-more"><button class="recipe-text-button" type="button" data-action="plugin-task-builder">Explore all ideas ${api.icon('arrow-forward')}</button><p>One small task. Your own way.</p></div>
  </section>`;
}

/** The wizard owns one in-memory model. Page/search/motion state is deliberately
 * absent from its canonical draft, keeping shared discard protection accurate. */
export function open(api) {
  installMotion();
  const esc=api.escape,icon=api.icon;
  const actions=api.actions.filter(action=>['plugin','log','delay'].includes(action.type));
  const events=api.events.filter(event=>event.available!==false);
  const model=createModel(actions,api.intent),parameterCache=new Map();
  let search='',signalSearch='',signalLimit=12,saving=false,saved=false,detailsOpen=false;
  let expandedFields=new Set(),optionSearch={};
  const action=()=>actions.find(action=>action.id===model.actionId);
  const event=()=>events.find(event=>event.id===model.eventId);
  const button=(text,attributes='',className='recipe-choice')=>`<button type="button" class="${className}" ${attributes}>${text}</button>`;

  api.show(`<div class="recipe-wizard ${motion?'':'recipe-still'}">
    <input type="hidden" name="builderDraft" data-task-builder-draft value="${esc(canonicalDraft(model))}">
    <header class="recipe-wizard-header"><span id="dialog-title" class="recipe-wordmark">${icon('auto-awesome')} New task</span><div>${motionButton(icon)}<button class="recipe-icon-button" type="button" data-action="close-dialog" aria-label="Close recipe">${icon('close')}</button></div></header>
    <div class="recipe-progress"><div id="recipe-progress-fill"></div></div>
    <div id="form-error" class="recipe-error" role="alert" hidden></div>
    <main class="recipe-stage" id="recipe-stage"></main>
    <footer class="recipe-wizard-footer"><button type="button" class="recipe-back" data-recipe-back>${icon('arrow-back')} Back</button><span id="recipe-step-count"></span><button class="recipe-continue" type="submit" id="recipe-continue">Continue ${icon('arrow-forward')}</button></footer>
  </div>`);
  const form=document.getElementById('recipe-builder-form'),stage=form.querySelector('#recipe-stage');
  const heading=(title,subtitle)=>`<div class="recipe-question"><h2 tabindex="-1" id="recipe-question">${title}</h2>${subtitle?`<p>${subtitle}</p>`:''}</div>`;
  const selectedMark=selected=>selected?`<span class="recipe-selected-mark">${icon('check')}</span>`:'';

  function sync() {
    form.querySelector('[data-task-builder-draft]').value=canonicalDraft(model);
    const sentence=form.querySelector('[data-live-sentence]');
    if (sentence) sentence.textContent=actionSentence(action(),model.parameters);
  }

  function ideaPage() {
    const matches=actions.filter(item=>(item.name+' '+describeAction(item).title+' '+item.description).toLowerCase().includes(search.toLowerCase()));
    return heading('I want to…','Start with something you’d like to happen.')+
      `<label class="recipe-search">${icon('search')}<input id="recipe-idea-search" type="search" aria-label="Find an idea" placeholder="Find an idea" value="${esc(search)}" maxlength="100"></label><div class="recipe-idea-grid">`+
      (matches.length?matches.map(item=>{const look=describeAction(item),selected=item.id===model.actionId;return button(`<span class="recipe-choice-art recipe-tone-${look.tone}">${icon(look.glyph)}</span><strong>${esc(look.title)}</strong><small>${esc(item.available===false?'Needs a little setup':item.name===look.title?'':item.name)}</small>${selectedMark(selected)}`,`data-recipe-action="${esc(item.id)}" aria-pressed="${selected}" ${item.available===false?`disabled title="${esc(item.unavailableReason||'Configure its connection first.')}"`:''}`,'recipe-idea'+(selected?' is-selected':''));}).join(''):'<p class="recipe-empty">No ideas found. Try another word.</p>')+'</div>';
  }

  function enumChoices(field,value,scope='parameter') {
    const filtered=field.enum.map((value,index)=>({value,index,label:cleanChoice(field.enumLabels?.[index]??value)})).filter(choice=>!optionSearch[field.id]||choice.label.toLowerCase().includes(optionSearch[field.id].toLowerCase()));
    const visible=expandedFields.has(field.id)?filtered:filtered.filter((choice,index)=>index<18||choice.value===value);
    return (field.enum.length>18?`<label class="recipe-search recipe-small-search">${icon('search')}<input id="recipe-option-search-${esc(field.id)}" type="search" data-recipe-option-search="${esc(field.id)}" aria-label="Find ${esc(field.label)}" placeholder="Find your choice" value="${esc(optionSearch[field.id]||'')}" maxlength="100"></label>`:'')+
      `<div class="recipe-option-grid">${visible.map(choice=>button(`${scope==='parameter'&&field.id==='scene-id'?icon('auto-awesome'):field.id==='template'?icon(({Notice:'info',Alarm:'alarm',Alert:'notifications-active',Warning:'warning'})[choice.value]||'info'):''}<span>${esc(choice.label)}</span>${selectedMark(choice.value===value)}`,`data-recipe-${scope}-choice="${esc(field.id)}" data-index="${choice.index}" id="recipe-choice-${esc(field.id)}-${choice.index}" aria-pressed="${choice.value===value}"`,'recipe-option'+(choice.value===value?' is-selected':''))).join('')}</div>`+
      (!visible.length?'<p class="recipe-empty">No choices reported yet. Check the connection and come back.</p>':'')+
      (!expandedFields.has(field.id)&&filtered.length>visible.length?button('Show more',`data-recipe-expand="${esc(field.id)}"`,'recipe-text-button'):'');
  }

  function parameterField(field) {
    const value=model.parameters[field.id],label=labelFor(field,action());
    let input;
    if (field.enum) input=enumChoices(field,value);
    else if (field.type==='boolean') input=`<div class="recipe-segments">${[true,false].map(on=>button(field.id==='on'?(on?'On':'Off'):(on?'Yes':'No'),`data-recipe-boolean="${esc(field.id)}" data-value="${on}" id="recipe-boolean-${esc(field.id)}-${on}" aria-pressed="${value===on}"`,value===on?'is-selected':'')).join('')}</div>`;
    else if (field.type==='number') {
      const slider=Number.isFinite(field.min)&&Number.isFinite(field.max)&&field.max-field.min<=1000;
      input=`<div class="recipe-number"><input id="recipe-input-${esc(field.id)}" type="number" data-recipe-parameter="${esc(field.id)}" aria-label="${esc(label)}" step="any" ${field.min!==undefined?`min="${field.min}"`:''} ${field.max!==undefined?`max="${field.max}"`:''} value="${esc(value??'')}">${/%/.test(field.label)?'<span>%</span>':/seconds/i.test(field.label)?'<span>seconds</span>':''}</div>`+
        (slider?`<input class="recipe-range" type="range" min="${field.min}" max="${field.max}" step="${field.max-field.min<=1?.01:1}" value="${esc(value??field.min)}" data-recipe-slider="${esc(field.id)}" aria-label="${esc(label)} slider">`:'');
    } else {
      const placeholder=field.id==='title'?'Dinner’s ready':field.id==='message'?'Something worth sharing…':field.id==='video-id'?'Video ID or YouTube link':field.label;
      input=field.format==='multiline'?`<textarea id="recipe-input-${esc(field.id)}" data-recipe-parameter="${esc(field.id)}" aria-label="${esc(label)}" maxlength="${field.maxLength||4000}" rows="3" placeholder="${esc(placeholder)}">${esc(value??'')}</textarea>`:
        `<input id="recipe-input-${esc(field.id)}" data-recipe-parameter="${esc(field.id)}" aria-label="${esc(label)}" type="text" maxlength="${field.id==='video-id'?2048:field.maxLength||4000}" value="${esc(value??'')}" placeholder="${esc(placeholder)}" autocomplete="off">`;
      if(field.id==='color')input+=`<input type="color" class="recipe-colour" data-recipe-parameter="color" aria-label="Pick a colour" value="${/^#[a-f0-9]{6}$/i.test(value)?value:'#ffffff'}">`;
    }
    return `<section class="recipe-field" role="group" aria-labelledby="recipe-label-${esc(field.id)}"><label id="recipe-label-${esc(field.id)}" ${field.enum||field.type==='boolean'?'':`for="recipe-input-${esc(field.id)}"`}>${esc(label)}</label>${input}${field.enum?.length===0&&field.help?`<p class="recipe-empty">${esc(field.help)}</p>`:''}</section>`;
  }

  function detailsPage() {
    const selected=action(),key=keyOf(selected),fields=actionFields(selected);
    const secondary=new Set(['mode','arguments','auto-close','loop-sound']);
    const main=fields.filter(field=>!secondary.has(field.id)||field.required&&model.parameters[field.id]===undefined);
    const extra=fields.filter(field=>!main.includes(field));
    let title=key==='run-scene'?'Set the mood.':key==='show-notice'?'What should it say?':key==='delay'?'Take your time.':'Make it yours.';
    return heading(title,key==='run-scene'?'Choose the lighting you have saved.':describeAction(selected).title)+`<div class="recipe-detail-layout ${key==='show-notice'?'has-preview':''}"><div>${main.map(parameterField).join('')}${extra.length?`<details class="recipe-extra" ${detailsOpen?'open':''}><summary>More options ${icon('expand-more')}</summary>${extra.map(parameterField).join('')}</details>`:''}</div>`+
      (key==='show-notice'?`<aside class="recipe-notice-preview recipe-notice-${esc(String(model.parameters.template||'Notice').toLowerCase())}" aria-label="Message preview"><span class="recipe-preview-orbit">${icon(({Notice:'info',Alarm:'alarm',Alert:'notifications-active',Warning:'warning'})[model.parameters.template]||'info')}</span><small>${esc(model.parameters.template||'Notice')}</small><h3 data-preview-title>${esc(model.parameters.title||'Your title')}</h3><p data-preview-message>${esc(model.parameters.message||'Your message will appear here.')}</p><span class="recipe-preview-label">On your TV</span></aside>`:'')+'</div>';
  }

  const whens=[
    {id:'manual',title:'When I choose',hint:'A tap, whenever you like',glyph:'touch-app',tone:'lilac'},
    {id:'schedule',title:'At a certain time',hint:'Make it part of your day',glyph:'schedule',tone:'lemon'},
    {id:'event',title:'When something happens',hint:'Let your devices tell you',glyph:'sensors',tone:'mint'},
    {id:'timer',title:'After a little while',hint:'A one-time countdown',glyph:'hourglass-bottom',tone:'peach'},
    {id:'interval',title:'Every so often',hint:'Keep a little rhythm',glyph:'autorenew',tone:'sky'},
    {id:'sunrise',title:'At sunrise',hint:api.hasLocation?'With the morning light':'Add your server location first',glyph:'wb-sunny',tone:'lemon',disabled:!api.hasLocation},
    {id:'sunset',title:'At sunset',hint:api.hasLocation?'As the day winds down':'Add your server location first',glyph:'wb-twilight',tone:'peach',disabled:!api.hasLocation},
  ];
  function whenPage() {
    return heading('And when?','A moment, a time, or a little nudge from your devices.')+`<div class="recipe-when-grid">${whens.map(item=>button(`<span class="recipe-choice-art recipe-tone-${item.tone}">${icon(item.glyph)}</span><strong>${item.title}</strong><small>${item.hint}</small>${selectedMark(model.when===item.id)}`,`data-recipe-when="${item.id}" aria-pressed="${model.when===item.id}" ${item.disabled?'disabled':''}`,'recipe-idea'+(model.when===item.id?' is-selected':''))).join('')}</div>`;
  }

  function signalPage() {
    const matches=events.filter(item=>(item.name+' '+item.payload.map(field=>field.label||field.id).join(' ')).toLowerCase().includes(signalSearch.toLowerCase()));
    return heading('What should I listen for?','Find the change that matters to you.')+`<label class="recipe-search">${icon('search')}<input id="recipe-signal-search" type="search" aria-label="Find a signal" placeholder="Try light, battery, Wi-Fi or video" value="${esc(signalSearch)}" maxlength="100"></label><div class="recipe-signal-grid">`+
      matches.slice(0,signalLimit).map(item=>button(`<span class="recipe-signal-icon">${icon(item.icon||'sensors')}</span><span>${esc(signalName(item))}</span>${selectedMark(model.eventId===item.id)}`,`data-recipe-event="${esc(item.id)}" aria-pressed="${model.eventId===item.id}"`,'recipe-signal'+(model.eventId===item.id?' is-selected':''))).join('')+
      (!matches.length?'<p class="recipe-empty">No signals found. Try another word, or check that your devices are set up.</p>':'')+'</div>'+
      (matches.length>signalLimit?button(`Show more · ${matches.length} signals`,'data-recipe-more-signals','recipe-text-button'):'');
  }

  function conditionPage() {
    const source=event(),field=source.payload.find(field=>field.id===model.condition?.field);
    const usable=source.payload.filter(field=>!/(?:^|[-_])(?:id|timestamp|received|occurrence)(?:$|[-_])/i.test(field.id));
    const other=source.payload.filter(field=>!usable.includes(field));
    const fieldButtons=fields=>fields.map(item=>button(esc(item.label||item.id),`data-recipe-condition="${esc(item.id)}" aria-pressed="${field?.id===item.id}"`,'recipe-option'+(field?.id===item.id?' is-selected':''))).join('');
    let html=heading('Anything in particular?',esc(signalName(source)))+
      `<div class="recipe-option-grid">${button(`${icon('all-inclusive')} Whenever it happens`,'data-recipe-condition="" aria-pressed="'+!field+'"','recipe-option'+(!field?' is-selected':''))}${fieldButtons(usable)}</div>`+
      (other.length?`<details class="recipe-extra"><summary>More things to check ${icon('expand-more')}</summary><div class="recipe-option-grid">${fieldButtons(other)}</div></details>`:'');
    if(field){
      html+=`<div class="recipe-condition-sentence"><span>${esc(field.label||field.id)}</span><div class="recipe-segments">${Object.entries(operatorsFor(field)).map(([id,label])=>button(label,`data-recipe-operator="${id}" aria-pressed="${model.condition.operator===id}"`,model.condition.operator===id?'is-selected':'')).join('')}</div>`;
      if(field.type==='boolean')html+=`<div class="recipe-segments">${[true,false].map(value=>button(value?'Yes':'No',`data-recipe-condition-bool="${value}" aria-pressed="${model.condition.value===value}"`,model.condition.value===value?'is-selected':'')).join('')}</div>`;
      else if(field.enum&&model.condition.operator!=='contains')html+=enumChoices(field,model.condition.value,'condition');
      else html+=`<label class="recipe-threshold"><span class="sr-only">Comparison value</span><input id="recipe-comparison-value" type="${field.type==='number'?'number':'text'}" step="any" maxlength="${field.maxLength||1000}" value="${esc(model.condition.value??'')}" placeholder="${field.type==='number'?'20':'Type a few words'}" aria-label="Comparison value"></label>`;
      html+='</div><details class="recipe-extra"><summary>How often will it happen?</summary><p>'+(source.occurrenceKey?'Each new signal is checked against this choice.':'A matching reading starts the Task. It rearms after a nonmatching reading; it does not keep repeating while the value stays on the same side of your limit.')+'</p></details>';
    }
    return html;
  }

  function timingPage() {
    if(['timer','interval'].includes(model.when))return heading(model.when==='timer'?'How long shall I wait?':'Find your rhythm.',model.when==='timer'?'The countdown starts when you enable its rule.':'Choose the space between runs.')+
      `<div class="recipe-duration-number"><input id="recipe-duration" type="number" min="1" max="31536000" step="any" value="${model.seconds}" aria-label="Duration in seconds"><span>seconds</span></div><div class="recipe-option-grid">${[30,60,300,900,3600].map(seconds=>button(durationWords(seconds),`data-recipe-duration="${seconds}" aria-pressed="${model.seconds===seconds}"`,'recipe-option'+(model.seconds===seconds?' is-selected':''))).join('')}</div><p class="recipe-gentle-note">${model.when==='interval'?'The first interval begins when you enable its rule.':'It runs once. Re-enable its rule to start a new countdown.'}</p>`;
    return heading(model.when==='schedule'?'Make a little time.':'Which days?',model.when==='schedule'?'When should this be part of your day?':'Let the sun keep time.')+
      (model.when==='schedule'?`<div class="recipe-time-field"><label for="recipe-time-input">At</label><div>${api.time(model.time).replace('<input name="timeText"','<input id="recipe-time-input" name="timeText"')}</div></div>`:'')+
      `<div class="recipe-days" aria-label="Days">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((name,index)=>{const day=(index+1)%7;return button(`<span>${name}</span>${selectedMark(model.days.includes(day))}`,`data-recipe-day="${day}" aria-pressed="${model.days.includes(day)}"`,model.days.includes(day)?'is-selected':'');}).join('')}</div>`+
      `<div class="recipe-day-presets">${button('Every day','data-recipe-days="all"','recipe-text-button')}${button('Weekdays','data-recipe-days="week"','recipe-text-button')}${button('Weekends','data-recipe-days="weekend"','recipe-text-button')}</div>`;
  }

  function finishPage() {
    if(!model.nameEdited)model.name=(describeAction(action()).title+(model.when==='schedule'?' at '+api.formatTime(model.time):'')).slice(0,48);
    return heading('A little idea, all together.','Give it a name. Make it yours.')+
      `<div class="recipe-story"><span>I want to</span>${button(`${esc(actionSentence(action(),model.parameters))} ${icon('edit')}`,'data-recipe-jump="details"','recipe-story-piece recipe-tone-'+describeAction(action()).tone)}<span>when</span>${button(`${esc(whenSentence(model,events,api.formatTime))} ${icon('edit')}`,'data-recipe-jump="when"','recipe-story-piece recipe-tone-lilac')}</div>`+
      `<label class="recipe-name">Call it<input id="recipe-task-name" type="text" maxlength="48" value="${esc(model.name)}" autocomplete="off" placeholder="Your little idea"></label>`+
      `<p class="recipe-gentle-note">${icon('power-settings-new')} We’ll save it turned off, ready when you are.</p>`+
      `<details class="recipe-extra"><summary>Want to go further?</summary><p>Add more actions, rules or event values in the detailed Task editor.</p>${button('Open detailed editor','data-recipe-advanced','recipe-text-button')}</details>`;
  }

  function savedPage() {
    return `<div class="recipe-made"><span class="recipe-done-orbit">${icon('check')}</span><h2 id="recipe-question" tabindex="-1">Made it.</h2><p><strong>${esc(model.name)}</strong> is saved.</p><p class="recipe-gentle-note">It’s off for now. Switch it on in Tasks when you’re ready.</p>${button('View task','data-recipe-edit-saved','recipe-text-button')}</div>`;
  }

  function render(focus=true) {
    if(!form.isConnected)return;
    const active=document.activeElement,activeId=active?.id;
    const buttonData=active?.tagName==='BUTTON'?Object.entries(active.dataset):null;
    let selection;
    try{if(typeof active?.selectionStart==='number')selection=[active.selectionStart,active.selectionEnd];}catch{}
    form.querySelector('#form-error').hidden=true;
    const screens=screensFor(model,actions,events);
    if(!screens.includes(model.screen))model.screen='when';
    const index=screens.indexOf(model.screen);
    const pages={idea:ideaPage,details:detailsPage,when:whenPage,signal:signalPage,condition:conditionPage,timing:timingPage,finish:finishPage};
    stage.innerHTML=saved?savedPage():pages[model.screen]();
    form.querySelector('#recipe-progress-fill').style.width=(saved?100:Math.max(8,(index+1)/screens.length*100))+'%';
    form.querySelector('#recipe-step-count').textContent=saved?'Saved':`${index+1} / ${screens.length}`;
    const next=form.querySelector('#recipe-continue');next.innerHTML=saving?'Saving…':saved?'Done '+icon('check'):model.screen==='finish'?'Create task '+icon('auto-awesome'):'Continue '+icon('arrow-forward');next.disabled=saving;
    form.querySelector('[data-recipe-back]').hidden=saved;
    form.querySelector('[data-recipe-back]').disabled=saving;
    sync();
    if(focus)stage.querySelector('#recipe-question')?.focus({preventScroll:true});
    else {
      const replacement=activeId?form.querySelector('#'+CSS.escape(activeId)):buttonData?.length?[...stage.querySelectorAll('button')].find(button=>buttonData.every(([key,value])=>button.dataset[key]===value)):null;
      replacement?.focus({preventScroll:true});
      if(replacement&&selection)try{replacement.setSelectionRange(...selection);}catch{}
    }
  }

  function validateDetails() {
    model.parameters=normalizeParameters(action(),model.parameters);
    for(const field of actionFields(action())){
      const value=model.parameters[field.id];
      if(field.required&&(value===undefined||value===null||typeof value==='string'&&!value.trim()))throw Error(labelFor(field,action()).replace(/\?$/,'')+' needs a choice.');
      if(value===undefined||value==='')continue;
      if(field.enum&&!field.enum.includes(value))throw Error('Choose '+labelFor(field,action()).toLowerCase().replace(/\?$/,'')+'.');
      if(field.type==='number'&&(!Number.isFinite(value)||field.min!==undefined&&value<field.min||field.max!==undefined&&value>field.max))throw Error('Choose a value from '+(field.min??'the minimum')+' to '+(field.max??'the maximum')+'.');
    }
  }
  function validatePage() {
    if(!action()||action().available===false)throw Error('Pick an idea to begin.');
    if(model.screen==='details')validateDetails();
    if(model.screen==='when'&&!model.when)throw Error('Choose a moment for your task.');
    if(model.screen==='signal'&&!event())throw Error('Choose a signal to listen for.');
    if(model.screen==='condition'&&model.condition){const field=event().payload.find(field=>field.id===model.condition.field);if(!field)throw Error('Choose what to check.');if(field.type==='number'&&!Number.isFinite(model.condition.value)||field.type==='string'&&!String(model.condition.value).trim())throw Error('Add a value to compare.');}
    if(model.screen==='timing'){
      if(['timer','interval'].includes(model.when)&&(!Number.isFinite(model.seconds)||model.seconds<1||model.seconds>31536000))throw Error('Choose between 1 and 31536000 seconds.');
      if(['schedule','sunrise','sunset'].includes(model.when)&&!model.days.length)throw Error('Choose at least one day.');
      if(model.when==='schedule'&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(model.time))throw Error('Choose a time, such as 19:00.');
    }
  }
  const draft=()=>makeDraft(actions,events,{...model,name:model.name.trim()},()=>crypto.randomUUID());

  form.addEventListener('input',e=>{
    const target=e.target;
    if(target.id==='recipe-idea-search'){search=target.value;render(false);return;}
    if(target.id==='recipe-signal-search'){signalSearch=target.value;signalLimit=12;render(false);return;}
    if(target.dataset.recipeOptionSearch){optionSearch[target.dataset.recipeOptionSearch]=target.value;render(false);return;}
    const parameter=target.dataset.recipeParameter||target.dataset.recipeSlider;
    if(parameter){
      const field=actionFields(action()).find(field=>field.id===parameter);
      model.parameters[parameter]=field.type==='number'?(target.value===''?undefined:Number(target.value)):target.value;
      form.querySelectorAll('[data-recipe-parameter="'+parameter+'"],[data-recipe-slider="'+parameter+'"]').forEach(input=>{if(input!==target)input.value=target.value;});
      const title=form.querySelector('[data-preview-title]'),message=form.querySelector('[data-preview-message]');
      if(title)title.textContent=model.parameters.title||'Your title';if(message)message.textContent=model.parameters.message||'Your message will appear here.';
    }
    if(target.id==='recipe-comparison-value'){const field=event().payload.find(field=>field.id===model.condition.field);model.condition.value=field.type==='number'?(target.value===''?undefined:Number(target.value)):target.value;}
    if(target.id==='recipe-duration')model.seconds=target.value===''?undefined:Number(target.value);
    if(target.matches('[data-time-input]'))queueMicrotask(()=>{model.time=form.elements.namedItem('time').value;sync();});
    if(target.id==='recipe-task-name'){model.name=target.value;model.nameEdited=true;}
    sync();
  });
  form.addEventListener('change',e=>{if(e.target.matches('[data-time-input]')){model.time=form.elements.namedItem('time').value;sync();}});
  form.addEventListener('toggle',e=>{if(e.target.matches('.recipe-extra')&&model.screen==='details')detailsOpen=e.target.open;},true);

  form.addEventListener('click',e=>{
    const control=e.target.closest('button');if(!control||saving)return;
    const data=control.dataset;
    try{
      if(data.recipeAction!==undefined){
        const selected=actions.find(item=>item.id===data.recipeAction&&item.available!==false);if(!selected)return;
        if(model.actionId)parameterCache.set(model.actionId,{...model.parameters});
        model.actionId=selected.id;model.parameters=parameterCache.get(selected.id)||initialParameters(selected);detailsOpen=false;expandedFields=new Set();optionSearch={};render(false);return;
      }
      if(data.recipeWhen!==undefined){model.when=data.recipeWhen;render(false);return;}
      if(data.recipeEvent!==undefined){model.eventId=data.recipeEvent;model.condition=null;render(false);return;}
      if(data.recipeCondition!==undefined){const field=event().payload.find(field=>field.id===data.recipeCondition);model.condition=field?{field:field.id,operator:'eq',value:field.enum?.[0]??(field.type==='boolean'?true:field.type==='number'?0:'')}:null;render(false);return;}
      if(data.recipeOperator!==undefined){model.condition.operator=data.recipeOperator;render(false);return;}
      if(data.recipeConditionBool!==undefined){model.condition.value=data.recipeConditionBool==='true';render(false);return;}
      if(data.recipeParameterChoice!==undefined){const field=actionFields(action()).find(field=>field.id===data.recipeParameterChoice);model.parameters[field.id]=field.enum[Number(data.index)];render(false);return;}
      if(data.recipeConditionChoice!==undefined){const field=event().payload.find(field=>field.id===data.recipeConditionChoice);model.condition.value=field.enum[Number(data.index)];render(false);return;}
      if(data.recipeBoolean!==undefined){model.parameters[data.recipeBoolean]=data.value==='true';render(false);return;}
      if(data.recipeExpand!==undefined){expandedFields.add(data.recipeExpand);render(false);return;}
      if(data.recipeMoreSignals!==undefined){signalLimit+=24;render(false);return;}
      if(data.recipeDay!==undefined){const day=Number(data.recipeDay);model.days=model.days.includes(day)?model.days.filter(value=>value!==day):[...model.days,day];render(false);return;}
      if(data.recipeDays!==undefined){model.days=data.recipeDays==='week'?[1,2,3,4,5]:data.recipeDays==='weekend'?[6,0]:[1,2,3,4,5,6,0];render(false);return;}
      if(data.recipeDuration!==undefined){model.seconds=Number(data.recipeDuration);render(false);return;}
      if(data.recipeBack!==undefined){const screens=screensFor(model,actions,events),index=screens.indexOf(model.screen);if(index>0){model.screen=screens[index-1];render();}else form.querySelector('[data-action="close-dialog"]').click();return;}
      if(data.recipeJump!==undefined){model.screen=data.recipeJump==='details'&&!actionFields(action()).length?'idea':data.recipeJump;render();return;}
      if(data.recipeAdvanced!==undefined){validateDetails();api.review(draft());return;}
      if(data.recipeEditSaved!==undefined)api.editSaved();
    }catch(error){api.error(error.message);}
  });
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(saving)return;
    try{
      if(saved){form.querySelector('[data-action="close-dialog"]').click();return;}
      validatePage();
      if(model.screen!=='finish'){
        const screens=screensFor(model,actions,events);model.screen=screens[screens.indexOf(model.screen)+1];render();return;
      }
      validateDetails();if(!model.name.trim())throw Error('Give your task a name.');
      saving=true;render(false);
      try{await api.create(draft());saved=true;}finally{saving=false;}
      render();
    }catch(error){saving=false;if(form.isConnected){const next=form.querySelector('#recipe-continue');next.disabled=false;if(model.screen==='finish')next.innerHTML='Create task '+icon('auto-awesome');api.error(error.message);}}
  });
  render();
}
