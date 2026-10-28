/** Bounded RSS 2.0 and Atom metadata. No external entities or article fetches. */
import sax from '../vendor/sax/lib/sax.js';
const local=name=>name.split(':').at(-1).toLowerCase();
function published(value){
  const offsets={EST:'-0500',EDT:'-0400',CST:'-0600',CDT:'-0500',MST:'-0700',MDT:'-0600',PST:'-0800',PDT:'-0700'};
  const raw=String(value||'').trim().replace(/\b(EST|EDT|CST|CDT|MST|MDT|PST|PDT)$/i,zone=>offsets[zone.toUpperCase()]);
  return /(?:GMT|UTC|[+-]\d{4}|T[\d:.]+(?:Z|[+-]\d{2}:\d{2}))$/i.test(raw)?Date.parse(raw):null;
}
export function parseSyndication(xml,source,makeItem){
  if(typeof xml!=='string'||Buffer.byteLength(xml)>1048576)throw Error('Feed exceeds its size limit.');
  const parser=sax.parser(true,{strictEntities:true}),stack=[],items=[];
  let format='',channel=false,row=null,count=0,capture=null;
  parser.onerror=()=>{throw Error('Feed is not valid XML.');};
  parser.ondoctype=()=>{throw Error('Feed DTDs are not supported.');};
  parser.onopentag=node=>{
    if(capture){if(!capture.xhtml)throw Error('Feed text contains nested markup.');capture.value+=' ';}
    const name=local(node.name);stack.push(name);
    if(stack.length>24)throw Error('Feed is nested too deeply.');
    if(stack.length===1)format=name==='rss'?'rss':name==='feed'?'atom':'';
    if(stack.join('/')==='rss/channel'||format==='atom'&&stack.length===1)channel=true;
    if(stack.join('/')==='rss/channel/item'||stack.join('/')==='feed/entry'){
      if(++count>2000)throw Error('Feed contains too many items.');row={};
    }
    if(!row)return;
    const direct=format==='rss'?stack.length===4:stack.length===3;
    if(!direct)return;
    if(format==='atom'&&name==='link'){
      const rel=node.attributes.rel||'alternate',type=node.attributes.type||'text/html';
      if(rel==='alternate'&&/^(text\/html|application\/xhtml\+xml)$/.test(type)&&!row.link)row.link=node.attributes.href;
      return;
    }
    const fields=format==='rss'?['title','link','description','pubdate','date','guid','approx_traffic']:['title','summary','content','published','updated','id'];
    if(fields.includes(name)){
      if(name==='guid')row.guidPermalink=String(node.attributes.isPermaLink||'true').toLowerCase()==='true';
      capture={name,depth:stack.length,value:'',xhtml:format==='atom'&&node.attributes.type==='xhtml'};
    }
  };
  const text=value=>{if(capture){capture.value+=value;if(capture.value.length>32000)throw Error('Feed field exceeds its limit.');}};
  parser.ontext=text;parser.oncdata=text;
  parser.onclosetag=()=>{
    if(capture&&stack.length===capture.depth){row[capture.name]=capture.value;capture=null;}
    if(stack.join('/')==='rss/channel/item'||stack.join('/')==='feed/entry'){
      const link=row.link||(format==='rss'&&row.guidPermalink?row.guid:format==='atom'?row.id:'');
      const value=makeItem({title:row.title,url:link,summary:row.description||row.summary||row.content||'',publishedAt:published(row.pubdate||row.published||row.date||row.updated),source,traffic:row.approx_traffic});
      if(value&&items.length<30)items.push(value);row=null;
    }
    stack.pop();
  };
  parser.write(xml).close();if(!channel)throw Error('Provider did not return RSS or Atom.');return items;
}
