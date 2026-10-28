/** Browsing and visit state stay in this browser; no reading history is sent. */
(function(global){
  'use strict';
  function route(search){
    const values=new URLSearchParams(search);
    return {topic:(values.get('topic')||'').slice(0,60),fresh:values.get('new')==='1',query:(values.get('q')||'').slice(0,200),source:(values.get('source')||'').slice(0,100)};
  }
  function queryString(value){
    const params=new URLSearchParams();if(value.topic)params.set('topic',value.topic);if(value.fresh)params.set('new','1');if(value.query)params.set('q',value.query);if(value.source)params.set('source',value.source);return params.size?'?'+params.toString():'';
  }
  function newest(articles){return [...articles].sort((a,b)=>(b.publishedAt||0)-(a.publishedAt||0));}
  function frontPage(articles){
    const groups=new Map();for(const article of newest(articles)){if(!groups.has(article.topic))groups.set(article.topic,[]);groups.get(article.topic).push(article);}
    const result=[];while(result.length<articles.length)for(const rows of groups.values())if(rows.length)result.push(rows.shift());return result;
  }
  function selection(articles,value,newIds){return articles.filter(article=>(!value.topic||article.topic===value.topic)&&(!value.fresh||newIds.has(article.id))&&(!value.source||article.source===value.source)&&(!value.query||[article.title,article.summary,article.source].join(' ').toLocaleLowerCase().includes(value.query.toLocaleLowerCase())));}
  function countdown(value,now){
    if(!Number.isFinite(value?.at))return '';
    const minutes=Math.ceil((value.at-now)/60000),remaining=minutes<0?value.expired:minutes===0?'now':minutes<60?`in ${minutes} min`:`in ${Math.floor(minutes/60)}h ${minutes%60}m`;
    return [value.prefix,remaining].filter(Boolean).join(' · ');
  }
  function visits(storage){
    const key='sormus.daily.visits.v1';let saved=null,available=true;
    let raw=null;try{raw=storage.getItem(key);}catch{available=false;}
    try{if(raw){const parsed=JSON.parse(raw);if(parsed?.schemaVersion===1&&Array.isArray(parsed.ids)&&parsed.ids.length<=500&&parsed.ids.every(id=>/^[a-f0-9]{32}$/.test(id))&&Number.isFinite(parsed.at))saved=parsed;}}catch{/* Invalid local history starts a new edition without blocking stories. */}
    let baseline=new Set(saved?.ids||[]),retained=new Set(baseline);const previousAt=saved?.at??null;
    function record(articles,at){
      for(const article of articles)if(/^[a-f0-9]{32}$/.test(article.id)){retained.delete(article.id);retained.add(article.id);}
      retained=new Set([...retained].slice(-500));
      try{storage.setItem(key,JSON.stringify({schemaVersion:1,ids:[...retained],at}));}catch{available=false;}
    }
    return {previousAt,get available(){return available;},fresh:articles=>new Set(available&&previousAt!==null?articles.filter(article=>!baseline.has(article.id)).map(article=>article.id):[]),record,markSeen(articles,at){for(const article of articles)baseline.add(article.id);record(articles,at);}};
  }
  global.PortalModel={route,queryString,newest,frontPage,selection,visits,countdown};
}(globalThis));
