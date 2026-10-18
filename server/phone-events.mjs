/** Fixed native phone-event contracts. No caller-defined fields or operations. */
export const phoneEvents = [
  ['battery','Battery',{percent:'number',charging:'boolean',plugged:'number',temperature:'number'}],
  ['screen','Screen',{interactive:'boolean',locked:'boolean'}],
  ['unlock','Unlocked',{}],
  ['network','Network',{connected:'boolean',wifi:'boolean',internet:'boolean',metered:'boolean'}],
  ['bluetooth','Bluetooth',{connected:'boolean',name:'string'}],
  ['audio','Audio device',{connected:'boolean',name:'string',type:'number'}],
  ['call','Phone call',{state:'string'}],
  ['notification','Notification',{package:'string',title:'string',text:'string',removed:'boolean'}],
  ['media','Media playback',{package:'string',title:'string',artist:'string',state:'number'}],
  ['app','Foreground app',{package:'string'}],
  ['nfc','NFC tag',{tag:'string',technology:'string'}],
  ['button','Manual button',{name:'string'}],
  ['location','Location',{latitude:'number',longitude:'number','accuracy-m':'number',provider:'string','fix-at':'number','age-ms':'number',mock:'boolean','altitude-m':'number','speed-mps':'number'}],
  ['geofence','Region',{ 'region-id':'string','region-name':'string',inside:'boolean','distance-m':'number','accuracy-m':'number'}],
  ['activity','Activity',{activity:'string',transition:'string'}]
];
export const discretePhoneEvents=new Set(['unlock','notification','nfc','button','geofence','activity']);
export const requiredPhoneFields={location:['latitude','longitude','accuracy-m','provider','fix-at','age-ms','mock'],geofence:['region-id','region-name','inside','distance-m','accuracy-m'],activity:['activity','transition']};
// Public Task pickers advertise the same units and bounded choices accepted by
// the receiver; these are schema hints, never inferred readings.
export const phoneFieldHints={
  location:{latitude:{label:'Latitude (°)',min:-90,max:90},longitude:{label:'Longitude (°)',min:-180,max:180},'accuracy-m':{label:'Reported accuracy (m)',min:0,max:1000000},
    provider:{enum:['gps','network']},'fix-at':{label:'Reported fix time (epoch ms)',min:0},'age-ms':{label:'Fix age (ms)',min:0,max:120000},mock:{label:'Reported mock location'},'altitude-m':{label:'Reported altitude (m)'},'speed-mps':{label:'Reported speed (m/s)',min:0,max:10000}},
  geofence:{'region-id':{label:'Region ID',maxLength:36},'region-name':{label:'Region name',maxLength:32},inside:{label:'Inside'},'distance-m':{label:'Calculated distance (m)',min:0,max:20100000},'accuracy-m':{label:'Reported accuracy (m)',min:0,max:1000000}},
  activity:{activity:{enum:['Walking','Running','Cycling','In vehicle','Still']},transition:{enum:['Enter','Exit']}}
};
export const phoneEventVariants=(kind,name)=>kind==='geofence'?[['geofence-enter','Region entered'],['geofence-exit','Region left']]:kind==='activity'?[['activity-enter','Activity entered'],['activity-exit','Activity left']]:[[kind,name]];
export const phoneEventKey=event=>event.kind==='geofence'?'geofence:'+event.fields['region-id']:event.kind==='activity'?'activity:'+event.fields.activity:event.kind;
export const phoneEventId=event=>event.kind==='geofence'?'geofence-'+(event.fields.inside?'enter':'exit'):event.kind==='activity'?'activity-'+(event.fields.transition==='Enter'?'enter':'exit'):event.kind;
export function validatePhoneEvents(values) {
  if(values===undefined)return [];
  if(!Array.isArray(values)||values.length>40)throw new Error('At most forty phone events per report.');
  const kinds=new Set();
  return values.map(event=>{
    const contract=phoneEvents.find(([kind])=>kind===event?.kind);
    if(!contract || Object.keys(event).some(key=>!['kind','timestampNanos','fields'].includes(key))
      || !/^[0-9]{1,20}$/.test(event.timestampNanos) || !event.fields || Array.isArray(event.fields) || typeof event.fields!=='object')throw new Error('Invalid phone event.');
    if((requiredPhoneFields[event.kind] || []).some(key=>event.fields[key]===undefined))throw new Error('Missing phone event fields.');
    const key=phoneEventKey(event);if(kinds.has(key))throw new Error('Duplicate phone event source.');kinds.add(key);
    for(const [key,value] of Object.entries(event.fields)) {
      const type=contract[2][key];
      if(!type || typeof value!==type || type==='number' && (!Number.isFinite(value)||Math.abs(value)>1e20)
        || type==='string' && (value.length>500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)))throw new Error('Invalid phone event value.');
    }
    if(event.kind==='location') {
      const f=event.fields;
      if(Math.abs(f.latitude)>90||Math.abs(f.longitude)>180||f['accuracy-m']<0||f['accuracy-m']>1000000
        || !['gps','network'].includes(f.provider)||f['fix-at']<0||f['age-ms']<0||f['age-ms']>120000
        || f['speed-mps']!==undefined && (f['speed-mps']<0||f['speed-mps']>10000))throw new Error('Invalid reported location.');
    }
    if(event.kind==='geofence') {
      const f=event.fields;
      if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(f['region-id']) || !f['region-name'].trim() || f['region-name'].length>32
        || f['distance-m']<0 || f['distance-m']>20100000 || f['accuracy-m']<0 || f['accuracy-m']>1000000)throw new Error('Invalid region event.');
    }
    if(event.kind==='activity' && (!['Walking','Running','Cycling','In vehicle','Still'].includes(event.fields.activity)||!['Enter','Exit'].includes(event.fields.transition)))throw new Error('Invalid activity transition.');
    if([...kinds].filter(key=>key.startsWith('geofence:')).length>20)throw new Error('At most twenty region sources.');
    return structuredClone(event);
  });
}
