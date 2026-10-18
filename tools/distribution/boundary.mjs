/** The release boundary applies independently of Git ignore rules. Authored
 * empty settings are allowed in a ZIP, but never in a source commit. */
export function assertPublicPath(file,{seeds=false}={}) {
  if(typeof file!=='string'||!file||file.includes('\\')||file.startsWith('/')||file.includes(':')||file.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Invalid release path.');
  if(['config.json','tray/settings.json'].includes(file)){
    if(seeds)return;
    throw Error('Installation settings cannot be committed: '+file);
  }
  if(/^(?:data|work|dist|backups|reference|\.git|\.codex|\.agents)\//.test(file)
    ||/(?:^|\/)(?:data|private|\.git|\.tmp|\.cache)\//.test(file)
    ||/(?:^|\/)\.env(?:\.[^/]*)?$/.test(file)
    ||/(?:^|\/)(?:credentials|secrets|tokens)\.json$/i.test(file)
    ||/^tools\/(?:github-cli|sunshine|tizen)\//.test(file)
    ||/^tools\/installer\/(?:compiler|downloads)\//.test(file)
    ||/^tray\/(?:LocalserveTray\.next\.exe|build-result\.json)$/.test(file)
    ||/^tray\/\.build\//.test(file)
    ||file.startsWith('tools/android-build/')&&!['tools/android-build/prepare.ps1','tools/android-build/README.md'].includes(file)
    ||/^plugins\/sensors\/android\/build\//.test(file)
    ||/^tv-tizen\/dist\//.test(file)
    ||/\.(?:dpapi|p12|pfx|pwd|wgt|log|jsonl|tmp)$/i.test(file)
    ||/(?:author-signature|signature1)\.xml$/.test(file))throw Error('Private/generated release path: '+file);
  if(file.startsWith('assets/games/music/')&&file!=='assets/games/music/README.md')throw Error('User music is not a release input: '+file);
}
