/** Plain-language daily panels derived only from an existing public Vista DTO. */
const text=value=>typeof value==='string'?value.trim().slice(0,180):'';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const joined=values=>values.filter(value=>value!==null&&value!==undefined&&value!=='').join(' · ');
const number=value=>Math.round(value*10)/10;

export function portalBriefing(briefing,now=Date.now()){
  if(!briefing)return [];
  const options=briefing.options||{};
  const time=at=>new Intl.DateTimeFormat(undefined,{timeZone:options.timeZone,hour:'2-digit',minute:'2-digit',hourCycle:options.timeFormat==='12'?'h12':'h23'}).format(at);
  const until=at=>{const minutes=Math.max(0,Math.ceil((at-now)/60000));return minutes===0?'now':minutes<60?`in ${minutes} min`:`in ${Math.floor(minutes/60)}h ${minutes%60}m`;};
  const panels=[];
  for(const entry of (briefing.cards||[]).filter(entry=>entry.card&&!['interests','news'].includes(entry.pluginId)).slice(0,8)){
    const values=entry.data?.values||{},bindings=entry.data?.readyMade?.bindings||{},catalog=entry.catalog||[];
    function read(slot,field){
      const id=bindings[slot]||catalog.find(item=>item.id===field||item.id.endsWith(':'+field))?.id;
      const datum=values[id];return datum?.available&&datum.value!==null?datum.value:undefined;
    }
    const received=read('received','received-at')??read('received','updated-at'),report=read('status','poll-status');
    const maxAge=entry.pluginId==='hsl-trains'?300000:entry.pluginId==='tradfri'?120000:entry.pluginId==='weather'?10800000:86400000;
    const status=entry.data?.status||entry.unavailable||'Unavailable';
    const panel={id:entry.pluginId+'/'+entry.cardId,kind:entry.pluginId,title:entry.card.name,primary:'No current reading',secondary:'',details:[],receivedAt:finite(received)?received:null,status,cached:status!=='Ready'||Boolean(report&&report!=='Ready')||finite(received)&&now-received>maxAge};
    const detail=(label,value)=>{if(value!==undefined&&value!==null&&value!=='')panel.details.push({label,value:String(value).slice(0,200)});};
    // Purpose-built layouts use named template bindings. Custom Cards retain
    // their explicitly selected field labels and never mix inferred sources.
    if(entry.card.layout==='readymade'&&entry.pluginId==='weather'){
      panel.title='Weather';const temperature=read('temperature','temperature-c'),feels=read('feels','feels-like-c'),wind=read('wind','wind-speed-kmph'),rain=read('precipitation','precipitation-mm');
      panel.primary=finite(temperature)?number(temperature)+'°C':'Weather unavailable';
      panel.secondary=joined([text(read('condition','conditions')),text(read('area','resolved-area'))]);
      detail('Feels like',finite(feels)?number(feels)+'°C':null);detail('Wind',finite(wind)?joined([number(wind)+' km/h',text(read('direction','wind-direction'))]):null);detail('Rain',finite(rain)?number(rain)+' mm':null);
    }else if(entry.card.layout==='readymade'&&entry.pluginId==='hsl-trains'){
      panel.title='Next train';const table=read('trains','trains');
      const departures=Array.isArray(table)?table:[{train:read('next-train','train-1-train'),route:read('next-route','train-1-route'),track:read('next-track','train-1-track'),status:read('next-status','train-1-status'),time:read('next-time','train-1-time')}];
      const row=departures.filter(row=>finite(row.time)&&row.time>=now-30000&&!/cancel/i.test(row.status||'')).sort((a,b)=>a.time-b.time)[0];
      panel.primary=row?joined([text(row.train),text(row.route)]):'No upcoming departures';
      panel.secondary=row?joined([time(row.time),until(row.time)]):text(read('station','station-name'));
      if(row){panel.countdown={at:row.time,prefix:time(row.time),expired:'Departure time passed — refresh edition'};detail('Platform',text(row.track));detail('Departure',text(row.status));detail('From',text(read('station','station-name')));}
    }else if(entry.card.layout==='readymade'&&((['tv-calendar','movies'].includes(entry.pluginId)&&/^daily-(tv|movies)(-fullscreen)?$/.test(entry.card.templateId||''))||entry.pluginId==='emby'&&/^library-movies(-fullscreen)?$/.test(entry.card.templateId||''))){
      panel.title=entry.pluginId==='emby'?'Your Emby library':entry.pluginId==='movies'?'Movie suggestions':'TV suggestions';
      panel.primary=text(read('title','pick-1-title'))||'No suggestions in this selection';
      panel.secondary=joined([text(read('year','pick-1-year')),text(read('genre','pick-1-genres')),text(read('source',entry.pluginId==='tv-calendar'?'pick-1-network':'pick-1-source'))]);
      for(let i=2;i<=4;i++)detail('Also suggested',text(read(`pick-${i}-title`,`pick-${i}-title`)));
    }else if(entry.card.layout==='readymade'&&entry.pluginId==='tv-calendar'){
      const tonight=/tonight/.test(entry.card.templateId||'');panel.title=tonight?'Tonight on TV':'Next on TV';
      const list=read('list',tonight?'tonight':'upcoming');
      const rows=(Array.isArray(list)?list:[]).filter(row=>!finite(row.at)||row.at>=now).slice(0,4);
      panel.primary=rows[0]?text(rows[0].show):Array.isArray(list)?tonight?'No episodes listed tonight':'No upcoming episodes':'TV listings unavailable';
      panel.secondary=rows[0]?joined([text(rows[0].title),finite(rows[0].at)?time(rows[0].at):'Time not announced']):'Your followed shows';
      for(const row of rows.slice(1))detail(finite(row.at)?time(row.at):'Time not announced',joined([text(row.show),text(row.title)]));
    }else if(entry.card.layout==='readymade'&&entry.pluginId==='tradfri'){
      panel.title='Lighting';const on=read('on','lights-on'),total=read('light-count','light-count');
      panel.primary=finite(on)?`${on}${finite(total)?' of '+total:''} ${on===1?'light':'lights'} on`:'Lighting unavailable';
      panel.secondary=finite(on)?on===0?'The lights are off':'The lights are on':'';
      const summary=text(read('lights-summary','lights-summary'));if(summary)detail('Rooms & lights',summary);
    }else{
      const fields=catalog.filter(field=>!/(?:received|updated|checked|version|status|current-time)$/.test(field.id.split(':').at(-1)));
      const readable=fields.flatMap(field=>{const datum=values[field.id];return datum?.available&&['number','string','boolean'].includes(datum.type)&&datum.value!==null&&datum.value!==''?[{label:field.label.split(' · ').at(-1),value:String(datum.value).slice(0,180)}]:[];}).slice(0,4);
      panel.primary=readable[0]?.value||'No current reading';panel.secondary=readable[0]?.label||'';panel.details=readable.slice(1);
    }
    panels.push(panel);
  }
  const sunrise=options.daylight?.sunrise,sunset=options.daylight?.sunset;
  if(finite(sunrise)||finite(sunset)){
    const future=finite(sunrise)&&sunrise>now?{name:'Sunrise',at:sunrise}:finite(sunset)&&sunset>now?{name:'Sunset',at:sunset}:null;
    const minutes=finite(sunrise)&&finite(sunset)?Math.round((sunset-sunrise)/60000):null;
    panels.splice(Math.min(2,panels.length),0,{id:'daylight',kind:'daylight',title:'Daylight',primary:future?`${future.name} ${time(future.at)}`:finite(sunset)&&now>=sunset?'After sunset':'Daylight',secondary:future?until(future.at):'',...(future?{countdown:{at:future.at,prefix:'',expired:future.name+' has passed'}}:{}),details:[...(finite(sunrise)?[{label:'Sunrise',value:time(sunrise)}]:[]),...(finite(sunset)?[{label:'Sunset',value:time(sunset)}]:[]),...(minutes>0?[{label:'Daylight',value:`${Math.floor(minutes/60)}h ${minutes%60}m`}]:[])],receivedAt:null,status:'Calculated',cached:false});
  }
  return panels;
}
