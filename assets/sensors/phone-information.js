/* ES5/XHR viewer. Navigation is read-only: no TV/device actions or storage.
 * Only the visible street map loads external OpenStreetMap tiles. Phone
 * callback values come from a bounded volatile projection. */
(function(){'use strict';
  var screen=document.getElementById('phone-screen'),content=document.getElementById('content');
  var data=null,device='',page=0,pages=[],request=null,timer=null,online=false,map=null,mapRequest=null,offset=0;
  function text(id,value){document.getElementById(id).textContent=value;}
  function esc(value){return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function shown(value){return value===null||value===undefined?'No data':typeof value==='boolean'?(value?'Yes':'No'):typeof value==='number'?String(Math.round(value*100)/100):String(value);}
  function raw(id){var datum=data&&data.values[id];return datum&&datum.available?datum.value:null;}
  function event(kind,field){var item=data&&data.phone&&data.phone[kind];return item&&item.fields[field]!==undefined?item.fields[field]:null;}
  function time(value){if(value===null)return 'No data';try{return new Date(value).toLocaleTimeString('en-GB',{hour12:data.options.timeFormat==='12',timeZone:data.options.timeZone});}catch(e){return new Date(value).toTimeString().slice(0,8);}}
  function ring(label,value,unit){return '<div class="instrument"><div class="ring"><strong>'+esc(shown(value))+'</strong><small>'+esc(unit||'')+'</small></div><span>'+esc(label)+'</span></div>';}
  function box(label,value){return '<div class="box"><label>'+esc(label)+'</label><strong>'+esc(shown(value))+'</strong></div>';}
  function dashboard(gauges,boxes,note){return '<div class="gauges">'+gauges.join('')+'</div><div class="boxes">'+boxes.join('')+'</div><p class="note">'+esc(note)+'</p>';}
  function build(){
    var previous=pages[page],keep=previous&&(previous.key||previous.kind);
    pages=[{name:'Motion & environment',kind:'motion'},{name:'Power & connections',kind:'power'},{name:'Phone activity',kind:'activity'},{name:'Location',kind:'map'},{name:'Location · Streets · 300 m',kind:'street-map'}];
    // Raw and phone-event details finish the sequence. Page heights are bounded,
    // including long names, complete sixteen-component vectors and text fields.
    var details=[];var kinds=Object.keys(data.phone||{}).sort();
    for(var k=0;k<kinds.length;k++){var item=data.phone[kinds[k]],names=Object.keys(item.fields);if(!names.length)names=['occurrence'];for(var n=0;n<names.length;n++)details.push({name:kinds[k]+' · '+names[n],values:names[n]==='occurrence'?'Observed':shown(item.fields[names[n]]),unit:'',accuracy:null,age:Math.max(0,data.options.now-item.receivedAt),status:'Observed '+time(item.receivedAt)});}
    var sensors=[];for(var g=1;g<=8;g++)sensors=sensors.concat(raw('sensors-'+g)||[]);
    function lists(rows,name){var part=[],height=0,index=0;for(var i=0;i<rows.length;i++){
      var size=Math.max(86,48+Math.ceil(String(rows[i].values||'').length/60)*26,48+Math.ceil(String(rows[i].name||'').length/25)*26);
      if(part.length&&(height+size>720||part.length===8)){pages.push({name:name,kind:'list',key:name+index++,rows:part});part=[];height=0;}
      part.push({row:rows[i],height:size});height+=size;
    }if(part.length)pages.push({name:name,kind:'list',key:name+index,rows:part});}
    lists(details,'Phone event details');lists(sensors,'Sensor readings');page=page%pages.length;
    if(keep)for(var p=0;p<pages.length;p++)if((pages[p].key||pages[p].kind)===keep){page=p;break;}
  }
  function render(){
    if(!data){PhoneStreetMap.stop();content.innerHTML='<p class="empty">Waiting for phone reports</p>';return;}
    var view=pages[page];if(!view)return;
    if(view.kind!=='street-map')PhoneStreetMap.stop();
    text('device-name',data.device?data.device.name:'Phone information');text('page-name',view.name);
    text('connection',(online?'':'Disconnected · ')+data.status+' · '+(raw('online')===true?'Receiving reports':'Retained / no recent reports'));
    var phoneIndex=0;for(var d=0;d<data.devices.length;d++)if(data.devices[d].id===device)phoneIndex=d;
    text('page-label','Page '+(page+1)+' / '+pages.length+' · Phone '+(data.device?phoneIndex+1:0)+' / '+data.devices.length);
    var html='',boxes=[],gauges=[];
    if(view.kind==='motion'){
      gauges=[ring('Acceleration X',raw('acceleration-x'),raw('acceleration-unit')),ring('Acceleration Y',raw('acceleration-y'),raw('acceleration-unit')),ring('Acceleration Z',raw('acceleration-z'),raw('acceleration-unit')),ring('Proximity',raw('proximity'),raw('proximity-unit'))];
      boxes=[box('Gyroscope X',raw('rotation-x')),box('Gyroscope Y',raw('rotation-y')),box('Gyroscope Z',raw('rotation-z')),box('Ambient light · '+shown(raw('ambient-light-unit')),raw('ambient-light')),
        box('Accelerometer',raw('acceleration-name')),box('Gyroscope · '+shown(raw('rotation-unit')),raw('rotation-name')),box('Sensors',raw('sensor-count')),box('Last report',time(raw('received-at')))];
      html=dashboard(gauges,boxes,shown(raw('reading-status')));
    }else if(view.kind==='power'){
      gauges=[ring('Battery',event('battery','percent'),'%'),ring('Battery temperature',event('battery','temperature'),'°C'),ring('Charging',event('battery','charging')),ring('Internet validated',event('network','internet'))];
      boxes=[box('Plugged · Android code',event('battery','plugged')),box('Screen interactive',event('screen','interactive')),box('Screen locked',event('screen','locked')),box('Network connected',event('network','connected')),
        box('Wi-Fi',event('network','wifi')),box('Metered network',event('network','metered')),box('Bluetooth connected',event('bluetooth','connected')),box('Audio connected',event('audio','connected'))];
      html=dashboard(gauges,boxes,'Latest reported states. Unselected or unavailable phone sources show No data.');
    }else if(view.kind==='activity'){
      gauges=[ring('Activity',event('activity','activity')),ring('Transition',event('activity','transition')),ring('Call state',event('call','state')),ring('Media state',event('media','state'))];
      boxes=[box('Media title',event('media','title')),box('Artist',event('media','artist')),box('Foreground app',event('app','package')),box('Notification app',event('notification','package')),
        box('Bluetooth device',event('bluetooth','name')),box('Audio device',event('audio','name')),box('Latest region',event('geofence','region-name')),box('Manual control',event('button','name'))];
      html=dashboard(gauges,boxes,'Transitions describe observations, not inferred current activity. Notification message content is not retained.');
    }else if(view.kind==='map'||view.kind==='street-map'){
      var location=data.phone&&data.phone.location,fix=location?location.fields:null;
      var age=location?fix['age-ms']+Math.max(0,data.options.now-location.receivedAt):null;
      var street=view.kind==='street-map';
      html='<div class="map-stage"><canvas class="map" id="map" width="1824" height="680" aria-label="'+(street?'Street map covering 300 metres':'Offline world map')+' with reported phone position"></canvas>';
      if(street){
        html+='<span class="map-attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a></span>';
        if(!fix||!PhoneStreetMap.layout(fix))html+='<p class="map-message">'+(fix?'Street map unavailable at this latitude':'No reported GPS fix')+'</p>';
      }
      html+='</div><div class="map-info"><span>Latitude / longitude<b>'+esc(fix?fix.latitude.toFixed(6)+' / '+fix.longitude.toFixed(6):'No reported GPS fix')+'</b></span><span>Accuracy<b>'+esc(fix?shown(fix['accuracy-m'])+' m':'No data')+'</b></span><span>Fix age<b>'+esc(age===null?'No data':Math.round(age/1000)+' s'+(age>120000?' · retained':''))+'</b></span><span>Provider / mock<b>'+esc(fix?fix.provider+' / '+shown(fix.mock):'No data')+'</b></span><span>Altitude / speed<b>'+esc(fix?shown(fix['altitude-m'])+' m / '+shown(fix['speed-mps'])+' m/s':'No data')+'</b></span></div><p class="map-note">'+(street?'300 metres across · Street tiles require an internet connection':'Made with Natural Earth · Offline country/coastline overview · No street detail')+' · '+esc(fix?'Reported fix '+time(fix['fix-at']):'Enable Location in the Android app and grant location access.')+'</p>';
      if(!street)loadMap();
    }else{
      html='<table><colgroup><col><col><col><col><col><col></colgroup><thead><tr><th>Sensor / field</th><th>Raw values</th><th>Units</th><th>Accuracy</th><th>Age</th><th>Status</th></tr></thead><tbody>';
      for(var r=0;r<view.rows.length;r++){var item=view.rows[r],row=item.row;html+='<tr><td>'+esc(shown(row.name))+(row.type===undefined?'':'<small>Android type '+esc(row.type)+'</small>')+'</td><td class="raw">'+esc(shown(row.values))+'</td><td>'+esc(shown(row.unit))+'</td><td>'+esc(shown(row.accuracy))+'</td><td>'+esc(row.age===null||row.age===undefined?'No data':(row.age/1000).toFixed(1)+'s')+'</td><td>'+esc(shown(row.status))+'</td></tr>';}
      html+='</tbody></table><p class="table-note">Accuracy: −1 unknown · 0 unreliable · 1 low · 2 medium · 3 high</p>';
    }
    content.innerHTML=html;
    if(view.kind==='map'&&map)PhoneMap.draw(document.getElementById('map'),map,data.phone.location?data.phone.location.fields:null,data.device?data.device.name:'Phone');
    if(view.kind==='street-map')PhoneStreetMap.draw(document.getElementById('map'),data.phone.location?data.phone.location.fields:null,online&&!document.hidden);
  }
  function loadMap(){if(map||mapRequest||document.hidden)return;var xhr=new XMLHttpRequest();mapRequest=xhr;xhr.open('GET','/assets/sensors/map/world.json',true);xhr.timeout=7000;xhr.onload=function(){if(mapRequest!==xhr)return;mapRequest=null;if(xhr.status===200){try{var value=JSON.parse(xhr.responseText);if(value.length<=300)map=value;}catch(e){}if(map)render();}};xhr.onerror=xhr.ontimeout=function(){mapRequest=null;};xhr.send();}
  function apply(next){var previous=device;data=next;device=next.device?next.device.id:'';if(previous!==device){page=0;pages=[];}offset=next.options.now-Date.now();build();render();}
  function schedule(){if(timer)window.clearTimeout(timer);if(!document.hidden)timer=window.setTimeout(refresh,2000);}
  function refresh(){if(document.hidden||request)return;var xhr=new XMLHttpRequest();request=xhr;xhr.open('GET','/api/phone-information'+(device?'?device='+encodeURIComponent(device):''),true);xhr.timeout=7000;
    function finish(ok){if(request!==xhr)return;request=null;online=ok;document.body.setAttribute('data-connected',String(ok));if(!ok){PhoneStreetMap.stop();if(data)render();}schedule();}
    xhr.onload=function(){if(request!==xhr)return;if(xhr.status===200){try{online=true;apply(JSON.parse(xhr.responseText));finish(true);}catch(e){finish(false);}}else{if(xhr.status===404){device='';data=null;page=0;pages=[];render();text('device-name','Phone unavailable');}finish(false);}};xhr.onerror=xhr.ontimeout=function(){finish(false);};xhr.send();}
  function changePhone(delta){if(!data||data.devices.length<2)return;var index=0;for(var i=0;i<data.devices.length;i++)if(data.devices[i].id===device)index=i;device=data.devices[(index+delta+data.devices.length)%data.devices.length].id;
    if(request){var old=request;request=null;old.abort();}data=null;page=0;pages=[];render();text('device-name','Loading phone…');refresh();}
  document.addEventListener('keydown',function(e){var code=e.keyCode||e.which;if(code!==37&&code!==38&&code!==39&&code!==40)return;e.preventDefault();if(e.repeat)return;
    if(code===38||code===40)changePhone(code===38?-1:1);else if(data&&pages.length){page=(page+(code===37?-1:1)+pages.length)%pages.length;render();}});
  function stop(){PhoneStreetMap.stop();if(timer)window.clearTimeout(timer);timer=null;if(request){var old=request;request=null;old.abort();}if(mapRequest){var oldMap=mapRequest;mapRequest=null;oldMap.abort();}}
  function resize(){var scale=Math.min(window.innerWidth/1920,window.innerHeight/1080),transform='translate('+((window.innerWidth-1920*scale)/2)+'px,'+((window.innerHeight-1080*scale)/2)+'px) scale('+scale+')';screen.style.webkitTransform=transform;screen.style.transform=transform;}
  document.addEventListener('visibilitychange',function(){if(document.hidden)stop();else{content.focus();refresh();}});window.addEventListener('pagehide',function(){stop();online=false;});window.addEventListener('pageshow',function(){content.focus();refresh();});window.addEventListener('resize',resize);
  window.setInterval(function(){if(!document.hidden&&online&&data)text('clock',time(Date.now()+offset));},1000);
  resize();content.focus();refresh();
}());
