/* Cinematic console: text-only theatre around already published Card readings.
   ES5, one bounded timer, no commands, requests, credentials or storage. */
var HackerConsole=(function(){
 'use strict';
 function clean(value,limit){return String(value===null||value===undefined?'':value).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,limit||120);}
 function find(items,id){for(var i=0;i<(items||[]).length;i++)if(items[i].id===id)return items[i];return null;}
 function describe(entry,options){
  entry=entry||{};var card=entry.card||{},data=entry.data||{},ready=data.readyMade||{},template=ready.template||find(ready.templates,card.templateId),source=ready.source||find(ready.sources,card.sourceId),binding=ready.bindings&&ready.bindings.hero,slot=null,field=null;
  if(template)for(var i=0;i<template.slots.length;i++)if(template.slots[i].id==='hero'){slot=template.slots[i];break;}
  if(!binding&&slot)for(var f=0;f<(card.fields||[]).length;f++)if(card.fields[f].id===slot.id)binding=card.fields[f].binding;
  if(!binding)for(var j=0;j<(card.fields||[]).length;j++){var candidate=card.fields[j],datum=data.values&&data.values[candidate.binding];if(candidate.enabled&&datum&&['string','number','boolean','timestamp'].indexOf(datum.type)!==-1){binding=candidate.binding;break;}}
  field=find(entry.catalog,binding);var reading=data.values&&data.values[binding],known=Boolean(reading&&reading.available&&(!source||source.enabled!==false)),value='No data';
  if(known){if(reading.type==='number'){try{value=new Intl.NumberFormat(undefined,{maximumFractionDigits:slot?slot.decimals:1}).format(reading.value);}catch(ignore){value=String(reading.value);}}else if(reading.type==='boolean')value=reading.value?'Yes':'No';else if(reading.type==='timestamp'){var date=new Date(reading.value);value=isNaN(date.getTime())?'Unavailable':date.toISOString();}else if(reading.type==='string')value=clean(reading.value,180);else value='See published Card';}
  var native=typeof VistaNative!=='undefined'?VistaNative.project(entry,options||{}):null;if(native){value=native.primary.value+(native.primary.available&&native.primary.unit?' '+native.primary.unit:'');}
  return {key:clean(entry.pluginId,64)+'/'+clean(card.id||entry.cardId,64)+'/'+clean(card.sourceId,64),channel:clean(entry.pluginId||'local',64),topic:clean(data.pluginName||card.name||'Information',64),source:clean(source&&source.name||'Local snapshot',64),label:clean(native?native.primary.label:field&&field.label||'Published reading',100),value:clean(value,options&&options.fullHd?240:180),details:native&&options&&options.fullHd?native.metrics.slice(0,3):[],status:clean(source&&source.enabled===false?'Data source disabled':data.status||'Unavailable',80)};
 }
 function sequence(info){var result=[
  {kind:'command',text:'whoami'},
  {kind:'output',text:'root@sormus // cinematic session'},
  {kind:'command',text:'trace --channel '+info.channel},
  {kind:'output',text:'Following the signal ... local index selected.'},
  {kind:'command',text:'search --topic "'+info.topic+'"'},
  {kind:'output',text:'Match located: '+info.source},
  {kind:'command',text:'decode --latest'},
  {kind:'output',text:'Resolving '+info.label+' ...'},
  {kind:'command',text:'show --answer'},
  {kind:'answer',text:info.label+' => '+info.value},
  {kind:'status',text:'['+info.status+'] Published reading / awaiting next inquiry'}
 ];for(var di=0;di<(info.details||[]).length;di++){var detail=info.details[di];result.splice(result.length-1,0,{kind:'reading',metricIndex:di,text:detail.label+' => '+detail.value+(detail.available&&detail.unit?' '+detail.unit:'')});}return result;}
 function el(tag,name,text){var n=document.createElement(tag);n.className=name;if(text!==undefined)n.textContent=text;return n;}
 function create(host){
  var root=el('section','hacker-console'),bar=el('div','hacker-console-bar'),identity=el('span','hacker-console-identity','root@sormus:~'),badge=el('span','hacker-console-badge','CINEMATIC TERMINAL'),log=el('div','hacker-console-log'),cursor=el('span','hacker-console-cursor','▌'),hint=el('div','hacker-console-hint','LOCAL INFORMATION / CINEMATIC TERMINAL');
  root.setAttribute('aria-label','Cinematic hacker terminal');log.setAttribute('aria-live','off');bar.appendChild(identity);bar.appendChild(badge);root.appendChild(bar);root.appendChild(log);root.appendChild(hint);host.appendChild(root);
  var info=null,steps=[],position=0,characters=0,wait=0,budget=0,line=null,answerNode=null,statusNode=null,metricNodes=[],timer=null,last=0,done=false,stopped=false,options={},blink=0,speed=1,activityQueue=[],seen={},seenOrder=[],baseline=false,serviceStates={},startedAt=0;
  function stop(){if(timer!==null){clearInterval(timer);timer=null;}}
  function held(){return options.paused||options.hidden||options.connected===false;}
  function append(step){var row=el('div','hacker-console-line hacker-console-'+step.kind);if(step.kind==='command')row.appendChild(el('span','hacker-console-prompt','root@sormus:~$ '));var text=el('span','hacker-console-text','');row.appendChild(text);log.appendChild(row);while(log.children.length>(options.fullHd?10:6))log.removeChild(log.firstChild);row.appendChild(cursor);log.scrollTop=log.scrollHeight;if(step.kind==='answer')answerNode=text;if(step.kind==='status')statusNode=text;if(step.kind==='reading')metricNodes.push({node:text,index:step.metricIndex});return text;}
  function latest(){if(answerNode)answerNode.textContent=info.label+' => '+info.value;if(statusNode)statusNode.textContent='['+info.status+'] Published reading / awaiting next inquiry';for(var mi=0;mi<metricNodes.length;mi++){var detail=info.details[metricNodes[mi].index];if(detail)metricNodes[mi].node.textContent=detail.label+' => '+detail.value+(detail.available&&detail.unit?' '+detail.unit:'');}}
  function staticView(){stop();while(log.firstChild)log.removeChild(log.firstChild);answerNode=statusNode=null;metricNodes=[];for(var i=Math.max(0,steps.length-(options.fullHd?10:6));i<steps.length;i++){var text=append(steps[i]);text.textContent=steps[i].text;}position=steps.length;done=true;line=null;root.setAttribute('data-phase','answer');latest();}
  function tick(){
   if(stopped||held())return;var now=Date.now(),elapsed=Math.min(100,Math.max(0,now-last));last=now;blink+=elapsed;cursor.style.visibility=Math.floor(blink/500)%2?'hidden':'visible';
   if(done)return;if(wait>0){wait-=elapsed;return;}if(position>=steps.length&&activityQueue.length){steps=activityQueue.splice(0,6);position=0;root.setAttribute('data-phase','activity');}var step=steps[position];if(!step){done=true;root.setAttribute('data-phase','answer');latest();stop();cursor.style.visibility='visible';return;}
   if(!line){if(step.kind==='answer')step.text=info.label+' => '+info.value;if(step.kind==='status')step.text='['+info.status+'] Published reading / awaiting next inquiry';if(step.kind==='reading'&&info.details[step.metricIndex]){var detail=info.details[step.metricIndex];step.text=detail.label+' => '+detail.value+(detail.available&&detail.unit?' '+detail.unit:'');}line=append(step);characters=0;budget=0;}budget+=elapsed;var pace=(step.kind==='command'?(options.motion==='gentle'?55:32):12)*speed,limit=8,previous=characters;
   while(budget>=pace&&characters<step.text.length&&limit-->0){characters++;budget-=pace+(step.kind==='command'&&characters%9===0?35*speed:0);}if(characters!==previous)line.textContent=step.text.slice(0,characters);
   log.scrollTop=log.scrollHeight;if(characters>=step.text.length){if(cursor.parentNode)cursor.parentNode.removeChild(cursor);line=null;position++;wait=(step.kind==='command'?260:380)*speed;}
  }
  function configure(next){options=next||{};var base=root.clientHeight<320?16:20;if(root.clientWidth<600)base=14;var size=base*Math.max(80,Math.min(130,Number(options.fontScale)||100))/100+'px';if(root.style.fontSize!==size)root.style.fontSize=size;var estimated=0;for(var i=0;i<steps.length;i++)estimated+=steps[i].text.length*(steps[i].kind==='command'?(options.motion==='gentle'?59:36):12)+400;speed=Math.max(.25,Math.min(1,((Number(options.durationSeconds)||18)*1000-1500)/Math.max(1,estimated)));root.setAttribute('data-held',String(Boolean(held())));badge.textContent=options.connected===false?'OFFLINE / RETAINED':options.paused?'PAUSED / CINEMATIC TERMINAL':'CINEMATIC TERMINAL';if(!info)return;if(options.reduced||options.motion==='none'){if(!done)staticView();return;}if(held()||done){stop();cursor.style.visibility='visible';return;}if(timer===null){last=Date.now();timer=setInterval(tick,50);}}
  function update(entry,next){
   if(stopped)return;var current=describe(entry,next);if(!startedAt)startedAt=next&&next.now||Date.now();if(!info||info.key!==current.key||Boolean(options.fullHd)!==Boolean(next&&next.fullHd)){stop();info=current;steps=sequence(info);position=characters=wait=budget=blink=0;line=answerNode=statusNode=null;metricNodes=[];done=false;while(log.firstChild)log.removeChild(log.firstChild);root.setAttribute('data-phase','typing');}else {info=current;if(done)latest();}
   configure(next);
  }
  function enqueue(message){activityQueue.push({kind:'activity',text:clean(message,180)});if(activityQueue.length>6)activityQueue.shift();if(options.reduced||options.motion==='none'){var row=append(activityQueue.shift());row.textContent=message;return;}if(done){done=false;root.setAttribute('data-phase','activity');}configure(options);}
  function activity(events){for(var i=0;i<(events||[]).length;i++){var event=events[i],id=event.id+'|'+event.status;if(seen[id])continue;seen[id]=true;seenOrder.push(id);while(seenOrder.length>128)delete seen[seenOrder.shift()];if(baseline&&(event.finishedAt||event.startedAt)>=startedAt)enqueue('[TASK '+clean(event.status,20).toUpperCase()+'] '+clean(event.name,64));}baseline=true;}
  function services(entries){for(var i=0;i<(entries||[]).length;i++){var entry=entries[i],next=describe(entry,options),old=serviceStates[next.key];serviceStates[next.key]=next.status;if(old!==undefined&&old!==next.status)enqueue('[SOURCE] '+next.topic+' / '+next.status);}var keys=Object.keys(serviceStates);for(var k=0;k<keys.length-64;k++)delete serviceStates[keys[k]];}
  return {update:update,configure:configure,activity:activity,services:services,destroy:function(){stopped=true;stop();if(root.parentNode)root.parentNode.removeChild(root);}};
 }
 return {create:create,describe:describe,sequence:sequence};
}());
