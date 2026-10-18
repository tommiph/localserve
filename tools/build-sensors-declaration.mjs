/** Author the readable fixed schema from the protocol's Android type catalogue. */
import fs from 'node:fs/promises';
import { sensorTypes } from '../server/sensor-protocol.mjs';
import {phoneEvents,discretePhoneEvents,phoneEventVariants,requiredPhoneFields,phoneFieldHints} from '../server/phone-events.mjs';
const string=(id,label,maxLength=100,required=false)=>({id,label,type:'string',maxLength,required});
const number=(id,label,required=false)=>({id,label,type:'number',required});
const identity=[string('device-id','Device ID',64,true),string('device-name','Device name',32,true)];
const payload=[...identity,string('sensor-id','Sensor ID',18,true),string('sensor-name','Sensor name',80,true),
  number('sensor-type','Android sensor type',true),string('unit','Units',24),number('accuracy','Reported accuracy (-1 unknown, 0 unreliable, 1 low, 2 medium, 3 high)',true),
  string('timestamp-ns','Raw sensor timestamp (nanoseconds since boot)',20,true),number('sent-at','Device send time (epoch ms)',true),number('received-at','Server reception (epoch ms)',true),
  ...Array.from({length:16},(_,i)=>number('value-'+i,i===0?'Value 0 / scalar':'Raw value '+i)),
  number('x','X (vector sensors)'),number('y','Y (vector sensors)'),number('z','Z (vector sensors)'),
  number('value-count','Reported value count',true),number('sample-age-ms','Sample age on sender (ms)',true),string('string-type','Android sensor string type',100)];
const stateField=(id,label,type)=>({id,label,type,icon:type==='timestamp'?'clock':'gauge',source:{kind:'state',key:id}});
const columns=[['name','Sensor','string'],['type','Type','number'],['values','Raw values','string'],['unit','Units','string'],['accuracy','Accuracy','number'],['age','Sample age (ms)','number'],['status','Status','string']].map(([id,label,type])=>({id,label,type}));
const declaration={schemaVersion:1,apiVersion:1,id:'sensors',name:'Sensors',version:'1.2.0',description:'Selected sensor and phone reports from trusted Android devices on the local network',icon:'gauge',defaultCardLayout:'table',
  runtime:{entry:'server/index.mjs',stateMaxBytes:1048576,ingest:'sensors-v1'},
  instances:{setting:'devices',stateKey:'devices',eventKey:'device-id'},
  polling:{actionId:'refresh',intervalSetting:'maintenance-minutes'},
  settingsGuide:{title:'Connect Android devices',sections:[{title:'Android app',steps:[
    'Open /sensors on this server in the Android browser to download the APK. Install it, then enter this server’s private LAN address and port in the app.',
    'Select sensors or phone sources and reporting intervals, then tap Start. The visible notification has a Stop control. Localserve uses no pairing key, account or cloud relay. Optional activity detection uses the phone’s Google Play services.',
    'Devices appear automatically after their first accepted report. Edit their names or disable them below. Stop the sender before deleting a device; a still-streaming trusted device will appear again.'
  ]},{title:'Location, regions and activities',steps:[
    'In APK 1.2.0, Location and Named region transitions are optional foreground sources. Add/enable named circles in the Android app, select sources and Start from the visible app. Grant Android location access and enable its Location setting. Regions whose boundaries overlap reported accuracy stay uncertain.',
    'Select Activity transitions and grant Physical activity permission to use Google Play services’ Walking, Running, Cycling, In vehicle and Still reports. Missing services or access are shown as unavailable. In vehicle does not identify a driver.',
    'In Tasks, select Region entered or Region left and compare Region-name. Select Activity entered or Activity left and compare Activity. Location exposes reported coordinates, accuracy, provider, fix age and mock flag. No Tasks are created automatically; no room/radio analysis is included.'
  ]},{title:'Task events',steps:[
    'Create an Event rule and select the phone and physical sensor name. Known and vendor sensor choices use the same device/sensor naming.',
    'Value 0 is the scalar or first raw value. X/Y/Z are present only for documented vector types; all available indices 0–15 remain raw. Missing values are omitted.',
    'Starts, reconnects and configuration changes baseline cached samples. Once connected, the first new gesture can trigger immediately; successive one-shot/special-trigger timestamps are separate occurrences even when Value 0 stays 1. Continuous/on-change conditions still need a false-to-true threshold crossing.',
    'For phone pickup select Pick-up gesture, not Significant motion. Gesture events receive priority within the per-report limit. Reports carry only each sensor’s latest sample, so very rapid gestures between reports can still merge.'
  ]}]},
  settings:[
    {id:'report-ms',label:'Minimum report interval (ms)',type:'number',required:true,default:1000,min:250,max:60000,enum:[250,500,1000,2000,5000,10000,30000,60000],help:'Android honors this server minimum. Latest raw values are sent; intermediate samples are not archived.'},
    {id:'event-seconds',label:'Minimum interval per sensor Event (seconds)',type:'number',required:true,default:1,min:1,max:3600},
    {id:'events-per-report',label:'Maximum sensor Events per report',type:'number',required:true,default:4,min:1,max:16,help:'One-shot and special-trigger sensors have priority; each group rotates fairly. Current readings are stored even when Event delivery is limited.'},
    {id:'offline-seconds',label:'No-recent-reports timeout (seconds)',type:'number',required:true,default:30,min:5,max:600,help:'Uses server reception time, not the phone clock. Set longer than the report interval.'},
    {id:'maintenance-minutes',label:'Connection check interval',type:'number',required:true,default:1/12,min:1/12,max:0.5,enum:[1/12,1/6,0.25,0.5],enumLabels:['5 seconds','10 seconds','15 seconds','30 seconds']},
    {id:'devices',label:'Devices',type:'list',itemLabel:'device',maxItems:20,default:[],uniqueBy:['id','name'],help:'Trusted LAN devices register automatically. Disable a device to reject its reports. Names are editable; IDs identify app installations.',fields:[
      {id:'id',label:'Device ID',type:'string',required:true,format:'identifier',maxLength:64},
      {id:'name',label:'Name',type:'string',required:true,maxLength:32},
      {id:'enabled',label:'Enabled',type:'boolean',required:true}
    ]}
  ],
  cardFields:[stateField('online','Recent reports','boolean'),stateField('received-at','Last server reception','timestamp'),stateField('sensor-count','Available sensors','number'),stateField('reported-name','Device-reported name','string'),
    // Fixed overview slots select ordinary Android types from this device only.
    ...['acceleration-x','acceleration-y','acceleration-z','rotation-x','rotation-y','rotation-z','proximity','ambient-light'].map(id=>stateField(id,id.replaceAll('-',' '),'number')),
    ...['acceleration-name','rotation-name','acceleration-unit','rotation-unit','proximity-unit','ambient-light-unit','reading-status'].map(id=>stateField(id,id.replaceAll('-',' '),'string')),
    ...Array.from({length:8},(_,group)=>stateField('rows-'+group,'Sensor rows '+(group+1),'number')),
    ...Array.from({length:8},(_,group)=>({id:'sensors-'+(group+1),label:'Sensors '+(group*8+1)+'–'+(group*8+8),type:'table',icon:'gauge',columns,
      source:{kind:'rows',countKey:'rows-'+group,
        cellFields:Array.from({length:8},(_,row)=>columns.map(column=>({key:'s'+(group*8+row)+'-'+column.id,type:column.type}))).flat(),
        rows:Array.from({length:8},(_,row)=>Object.fromEntries(columns.map(column=>[column.id,'s'+(group*8+row)+'-'+column.id])))}}))],
  cardTemplates:[{id:'sensorium',name:'Sensorium',sourceLabel:'Android device',directory:'cards/sensorium',entry:'card.html',assets:['card.html','card.css','assets/motif.svg'],slots:[
    ...['acceleration-x','acceleration-y','acceleration-z','rotation-x','rotation-y','rotation-z','proximity','ambient-light'].map(id=>({id,field:id,format:'number',decimals:2,grouping:false})),
    ...['acceleration-name','rotation-name','acceleration-unit','rotation-unit','proximity-unit','ambient-light-unit','reading-status'].map(id=>({id,field:id,format:'text'})),
    {id:'received',field:'received-at',format:'datetime'}
  ]}],
  actions:[{id:'refresh',name:'Check sensor connections',description:'Refresh local connection ages only. Does not contact, start or stop Android devices.',parameters:[]}],
  events:[...phoneEvents.flatMap(([kind,name,fields])=>phoneEventVariants(kind,name).map(([id,label])=>({id:'phone-'+id,name:label,description:'Selected Android phone event; availability depends on permissions and platform support.',
    ...(discretePhoneEvents.has(kind)?{occurrenceKey:'timestamp-ns'}:{}),payload:[...identity,string('timestamp-ns','Phone event timestamp (ns since boot)',20,true),
      ...Object.entries(fields).map(([id,type])=>({id,label:id[0].toUpperCase()+id.slice(1),type,...((requiredPhoneFields[kind]||[]).includes(id)?{required:true}:{}),...(type==='string'?{maxLength:500}:{}),...phoneFieldHints[kind]?.[id]}))]}))),
    ...sensorTypes.map(([type,name])=>({id:'sensor-'+type,name,description:'Latest fresh raw sample. Continuous/on-change conditions use threshold edges; reported one-shot/special-trigger modes use distinct timestamp occurrences. Values are not smoothed or converted.',payload})),
    {id:'other-reading',name:'Other sensor',description:'A reported vendor or unknown Android sensor type. Choices use the device and physical sensor name.',payload},
    ...[['device-online','Reports resumed'],['device-offline','No recent reports']].map(([id,name])=>({id,name,occurrenceKey:'transition-id',payload:[...identity,number('received-at','Last server reception (epoch ms)',true),string('transition-id','Reception transition ID',36,true)]}))]
};
await fs.mkdir(new URL('../plugins/sensors/server/',import.meta.url),{recursive:true});
await fs.writeFile(new URL('../plugins/sensors/declaration.json',import.meta.url),JSON.stringify(declaration,null,2)+'\n');
console.log('Sensors declaration written.');
