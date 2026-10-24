/* Localserve's bounded cloud inbox. Configure the private Script Property
   LOCAL_SERVE_RELAY with the JSON exported by the administrator. Deploy as
   yourself with anonymous web-app access; every data operation authenticates
   its signed body. No Localserve address, account token or executable command
   belongs in this project. */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({service:'Localserve relay',protocol:1})).setMimeType(ContentService.MimeType.JSON);
}
function doPost(e) {
  var request, credential, lock, result;
  try {
    if(!e || !e.postData || e.postData.contents.length>125000)throw Error('Request rejected.');
    request=JSON.parse(e.postData.contents);credential=authenticate_(request);
    lock=LockService.getScriptLock();if(!lock.tryLock(5000))throw Error('Relay busy.');
    credential=authenticate_(request);
    var properties=PropertiesService.getScriptProperties(),now=Date.now();
    prune_(properties,now);
    var nonceKey='n_'+request.clientId,nonces=JSON.parse(properties.getProperty(nonceKey)||'[]').filter(function(item){return now-item.at<120000;});
    if(nonces.some(function(item){return item.nonce===request.nonce;})||nonces.length>=96)throw Error('Request already used or rate exceeded.');
    nonces.push({nonce:request.nonce,at:now});properties.setProperty(nonceKey,JSON.stringify(nonces));
    var payload=JSON.parse(Utilities.newBlob(Utilities.base64Decode(request.payload)).getDataAsString('UTF-8'));
    result=operate_(properties,request,credential,payload,now);
  } catch(ignore) {
    result={ok:false,error:'Request rejected. Check credentials, freshness, permission, storage and quota.'};
  } finally {if(lock && lock.hasLock())lock.releaseLock();}
  var output=credential?sign_(request,credential.key,result):{ok:false,error:'Access denied.'};
  return ContentService.createTextOutput(JSON.stringify(output)).setMimeType(ContentService.MimeType.JSON);
}
function config_() {
  var value=JSON.parse(PropertiesService.getScriptProperties().getProperty('LOCAL_SERVE_RELAY')||'null');
  if(!value||!/^[a-f0-9]{64}$/.test(value.collectorKey)||!Array.isArray(value.clients)||value.clients.length>20)throw Error('Configure relay.');
  return value;
}
function signature_(value,key) {
  return Utilities.computeHmacSha256Signature([value.v,value.clientId,value.op,value.at,value.nonce,value.payload].join('\n'),key,Utilities.Charset.UTF_8)
    .map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
}
function same_(left,right) {var diff=left.length^right.length;for(var i=0;i<64;i++)diff|=(left.charCodeAt(i)||0)^(right.charCodeAt(i)||0);return diff===0;}
function authenticate_(request) {
  if(!request||request.v!==1||!/^[a-z][a-z0-9-]{0,31}$/.test(request.clientId)||!/^[a-z-]{1,24}$/.test(request.op)
    ||typeof request.at!=='number'||Math.floor(request.at)!==request.at||Math.abs(Date.now()-request.at)>120000
    ||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(request.nonce)
    ||typeof request.payload!=='string'||request.payload.length>110000||!/^[A-Za-z0-9+/]*={0,2}$/.test(request.payload)
    ||!/^[a-f0-9]{64}$/.test(request.signature))throw Error('Invalid envelope.');
  var config=config_(),client=request.clientId==='collector'?{key:config.collectorKey,collector:true}:config.clients.filter(function(item){return item.id===request.clientId&&item.enabled===true;})[0];
  if(!client||!/^[a-f0-9]{64}$/.test(client.key)||!same_(signature_(request,client.key),request.signature))throw Error('Access denied.');
  return client;
}
function sign_(request,key,payload) {
  var result={v:1,clientId:request.clientId,op:request.op,at:Date.now(),nonce:request.nonce,payload:Utilities.base64Encode(Utilities.newBlob(JSON.stringify(payload)).getBytes())};
  result.signature=signature_(result,key);return result;
}
function read_(properties,slot) {
  var text=properties.getProperty('m_'+slot);if(!text)return null;
  var meta=JSON.parse(text),data='';if(!meta||meta.parts<1||meta.parts>40)throw Error('Invalid inbox.');
  for(var index=0;index<meta.parts;index++){var chunk=properties.getProperty(meta.prefix+index);if(chunk===null)throw Error('Incomplete inbox.');data+=chunk;}
  return JSON.parse(Utilities.newBlob(Utilities.base64Decode(data)).getDataAsString('UTF-8'));
}
function erase_(properties,slot) {
  var text=properties.getProperty('m_'+slot);if(!text)return;
  var meta=JSON.parse(text);properties.deleteProperty('m_'+slot);
  for(var index=0;index<Math.min(meta.parts,40);index++)properties.deleteProperty(meta.prefix+index);
}
function write_(properties,slot,value) {
  var data=Utilities.base64Encode(Utilities.newBlob(JSON.stringify(value)).getBytes());
  if(data.length>128000)throw Error('Message too large.');
  var all=properties.getProperties(),size=0;Object.keys(all).forEach(function(key){size+=key.length+all[key].length;});
  if(size+data.length+2000>350000)throw Error('Inbox full.');
  var prefix='d_'+Utilities.getUuid().replace(/-/g,'')+'_',parts=Math.ceil(data.length/6000),writes={};
  for(var i=0;i<parts;i++)writes[prefix+i]=data.slice(i*6000,(i+1)*6000);
  properties.setProperties(writes);
  // Publish the new chunk pointer only after all chunks were written. The old
  // record remains readable if storage fails before this commit.
  var old=properties.getProperty('m_'+slot);
  properties.setProperty('m_'+slot,JSON.stringify({prefix:prefix,parts:parts,expiresAt:value.expiresAt}));
  if(old){var meta=JSON.parse(old);for(var j=0;j<Math.min(meta.parts,40);j++)properties.deleteProperty(meta.prefix+j);}
}
function slots_(properties) {return Object.keys(properties.getProperties()).filter(function(key){return key.indexOf('m_')===0;}).map(function(key){return key.slice(2);});}
function prune_(properties,now) {
  var all=properties.getProperties(),reachable={};
  Object.keys(all).filter(function(key){return key.indexOf('n_')===0;}).forEach(function(key){if(JSON.parse(all[key]).every(function(item){return now-item.at>=120000;}))properties.deleteProperty(key);});
  Object.keys(all).filter(function(key){return key.indexOf('m_')===0;}).forEach(function(key){
    var meta=JSON.parse(all[key]);if(!meta||!isFinite(meta.expiresAt)||meta.expiresAt<=now){var expired=read_(properties,key.slice(2));erase_(properties,key.slice(2));if(expired&&expired.kind==='shortcut'){var receipt=cleanReceipt_({id:expired.id,clientId:expired.clientId,status:'expired',reason:'message-expired'},now);write_(properties,'receipt_'+receipt.clientId+'_'+receipt.id,receipt);}return;}
    for(var i=0;i<Math.min(meta.parts,40);i++)reachable[meta.prefix+i]=true;
  });
  Object.keys(all).filter(function(key){return key.indexOf('d_')===0&&!reachable[key];}).forEach(function(key){properties.deleteProperty(key);});
}
function cleanReceipt_(value,now) {
  if(!value||!/^[a-f0-9-]{36}$/.test(value.id)||!/^[a-z][a-z0-9-]{0,31}$/.test(value.clientId)
    ||['received','accepted','queued','running','completed','failed','cancelled','interrupted','expired','rejected'].indexOf(value.status)<0)throw Error('Invalid receipt.');
  return {id:value.id,clientId:value.clientId,status:value.status,reason:typeof value.reason==='string'&&/^[a-z-]{1,48}$/.test(value.reason)?value.reason:'',at:now,expiresAt:now+1200000};
}
function operate_(properties,request,credential,payload,now) {
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('Object required.');
  if(credential.collector) {
    if(request.op==='ping')return {ok:true,protocol:1};
    if(request.op==='sync') {
      if(!payload.catalog||!Array.isArray(payload.catalog.scenes)||!Array.isArray(payload.catalog.tasks)||payload.catalog.scenes.length+payload.catalog.tasks.length>100)throw Error('Invalid catalogue.');
      if(Array.isArray(payload.clients)){
        var config=config_(),before=JSON.stringify(config);
        if(payload.clients.length>20)throw Error('Too many clients.');
        // Only the authenticated collector can install or rotate client keys.
        // Validate the entire replacement before changing private properties.
        if(payload.clients.some(function(item){return item&&item.key!==undefined;})||payload.clients.length===0){
          var ids={};
          var replacement=payload.clients.map(function(item){
            if(!/^[a-z][a-z0-9-]{0,31}$/.test(item.id)||item.id==='collector'||ids[item.id]||!/^[a-f0-9]{64}$/.test(item.key)||typeof item.enabled!=='boolean'||typeof item.scenes!=='boolean'||typeof item.sensors!=='boolean'||typeof item.events!=='boolean'||typeof item.deviceId!=='string'||item.deviceId.length>64||item.sensors&&!/^android-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(item.deviceId))throw Error('Invalid client.');
            ids[item.id]=true;return {id:item.id,key:item.key,enabled:item.enabled,scenes:item.scenes,sensors:item.sensors,events:item.events,deviceId:item.deviceId};
          });
          config.clients=replacement;
        }else config.clients=config.clients.map(function(client){var allowed=payload.clients.filter(function(item){return item.id===client.id;})[0];return {id:client.id,key:client.key,enabled:!!allowed&&allowed.enabled===true,scenes:!!allowed&&allowed.scenes===true,sensors:!!allowed&&allowed.sensors===true,events:!!allowed&&allowed.events===true,deviceId:allowed?allowed.deviceId:''};});
        config.reportIntervalMs=Math.max(60000,Math.min(600000,Number(payload.reportIntervalMs)||60000));
        if(before!==JSON.stringify(config))properties.setProperty('LOCAL_SERVE_RELAY',JSON.stringify(config));
      }
      write_(properties,'catalog',{catalog:payload.catalog,at:now,expiresAt:now+120000});
      var inbox=slots_(properties).filter(function(slot){return slot.indexOf('in_')===0;});
      (payload.receipts||[]).slice(0,64).forEach(function(value){var receipt=cleanReceipt_(value,now);write_(properties,'receipt_'+receipt.clientId+'_'+receipt.id,receipt);inbox.filter(function(slot){return slot.indexOf('in_'+receipt.clientId+'_')===0;}).forEach(function(slot){var item=read_(properties,slot);if(item&&item.id===receipt.id)erase_(properties,slot);});});
      var messages=[],bytes=0;
      slots_(properties).filter(function(slot){return slot.indexOf('in_')===0;}).map(function(slot){return read_(properties,slot);}).filter(Boolean).sort(function(a,b){return a.createdAt-b.createdAt;}).some(function(item){
        var length=JSON.stringify(item).length;
        if(messages.length>=20||bytes+length>160000)return true;bytes+=length;messages.push(item);return false;
      });
      return {ok:true,messages:messages,clientSync:1};
    }
    if(request.op==='ack') {
      if(!Array.isArray(payload.results)||payload.results.length>20)throw Error('Invalid acknowledgement.');
      payload.results.forEach(function(value){
        var receipt=cleanReceipt_(value,now);write_(properties,'receipt_'+receipt.clientId+'_'+receipt.id,receipt);
        slots_(properties).filter(function(slot){return slot.indexOf('in_'+receipt.clientId+'_')===0;}).forEach(function(slot){var item=read_(properties,slot);if(item&&item.id===receipt.id)erase_(properties,slot);});
      });return {ok:true};
    }
    throw Error('Unknown collector operation.');
  }
  if(request.op==='catalog') {
    if(!credential.scenes)throw Error('Shortcuts not permitted.');var current=read_(properties,'catalog');
    return {ok:true,catalog:current?current.catalog:null,syncedAt:current?current.at:0};
  }
  if(request.op==='receipt') {
    if(!(credential.scenes||credential.events||credential.sensors)||!/^[a-f0-9-]{36}$/.test(payload.id))throw Error('Receipt not permitted.');
    var receipt=read_(properties,'receipt_'+request.clientId+'_'+payload.id);
    return {ok:true,receipt:receipt?{id:receipt.id,status:receipt.status,reason:receipt.reason||'',at:receipt.at}:null};
  }
  var kind=request.op==='sensor'?'sensors':request.op==='run'?'shortcut':request.op==='event'?'event':null;
  if(!kind||kind==='sensors'&&!credential.sensors||kind==='shortcut'&&!credential.scenes||kind==='event'&&!credential.events)throw Error('Operation not permitted.');
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(payload.id))throw Error('Request identity required.');
  if(kind==='sensors'&&(payload.deviceId!==credential.deviceId||typeof payload.packet!=='string'||payload.packet.length>90000||!/^[A-Za-z0-9+/]*={0,2}$/.test(payload.packet)))throw Error('Sensor device not permitted.');
  if(kind==='shortcut') {
    var catalogue=read_(properties,'catalog');if(!catalogue||catalogue.catalog.paused)throw Error('Server not available.');
    var entry=(payload.type==='scene'?catalogue.catalog.scenes:payload.type==='task'?catalogue.catalog.tasks:[]).filter(function(item){return item.key===payload.key&&item.revision===payload.revision&&item.available;})[0];
    if(!entry)throw Error('Refresh shortcuts.');
  }
  var slot='in_'+request.clientId+'_'+(kind==='sensors'?'sensors':payload.id),previous=read_(properties,slot);
  if(previous&&previous.id===payload.id){if(JSON.stringify(previous.payload)!==JSON.stringify(payload))throw Error('Request identity already used.');return {ok:true,id:payload.id,status:'queued'};}
  if(read_(properties,'receipt_'+request.clientId+'_'+payload.id))return {ok:true,id:payload.id,status:'received'};
  var pending=slots_(properties).filter(function(value){return value.indexOf('in_')===0;});if(!previous&&pending.length>=40)throw Error('Inbox full.');
  write_(properties,slot,{id:payload.id,clientId:request.clientId,kind:kind,keyTag:signature_({v:1,clientId:request.clientId,op:'identity',at:0,nonce:'identity',payload:''},credential.key),createdAt:now,expiresAt:now+(kind==='sensors'?90000:kind==='shortcut'?90000:300000),payload:payload});
  return {ok:true,id:payload.id,status:'queued',reportIntervalMs:Math.max(60000,Math.min(600000,Number(config_().reportIntervalMs)||60000))};
}
