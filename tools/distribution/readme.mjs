/** README video links come from one public project metadata field. */
export function renderDemoReadme(source,metadata) {
  const url=new URL(metadata.demoVideoUrl);
  if(url.protocol!=='https:'||url.hostname!=='youtu.be'||!/^\/[A-Za-z0-9_-]{11}$/.test(url.pathname)||url.search||url.hash||url.username||url.password)throw Error('Use a plain HTTPS youtu.be demo video link.');
  const block='<!-- demo:start -->\n[Watch the Localserve demo on YouTube]('+url.href+')\n<!-- demo:end -->';
  return source.includes('<!-- demo:start -->')?source.replace(/<!-- demo:start -->[\s\S]*?<!-- demo:end -->/,block):source.replace(/^# Localserve\s*/,'# Localserve\n\n'+block+'\n\n');
}
