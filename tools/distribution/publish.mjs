/** Explicit publication from a fresh verified clean tree. Never run, stage or
 * push the configured installation. A resumable journal contains receipts only. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {assertPublicPath} from './boundary.mjs';
import {commitPreparedIndex} from './source-commit.mjs';
import {checkReady,checkWindowsRun,checkRemoteTree,checkAssets} from './publication-checks.mjs';

const root=path.resolve(import.meta.dirname,'../..'),execute=promisify(execFile),args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){
  const name=args[i];assert.ok(['--repository','--message-file','--notes-file','--gh','--gh-config','--resume','--prepare-only'].includes(name),'Unknown option: '+name);
  assert.equal(options[name],undefined,'Duplicate option: '+name);
  options[name]=['--resume','--prepare-only'].includes(name)?true:args[++i];assert.ok(options[name]&&!String(options[name]).startsWith('--'),'Missing option value.');
}
const repository=options['--repository'];assert.match(repository||'',/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const suppliedGh=options['--gh']||'gh',gh=/[\\/]/.test(suppliedGh)?path.resolve(root,suppliedGh):suppliedGh;assert.ok(!/["\r\n]/.test(gh),'Invalid GitHub CLI path.');
const env={...process.env,GH_HOST:'github.com',GH_PROMPT_DISABLED:'1',GH_NO_UPDATE_NOTIFIER:'1',GIT_TERMINAL_PROMPT:'0'};
if(options['--gh-config']){env.GH_CONFIG_DIR=path.resolve(root,options['--gh-config']);delete env.GH_TOKEN;delete env.GITHUB_TOKEN;}
const read=async file=>JSON.parse(await fs.readFile(path.resolve(root,file),'utf8'));
const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
async function textFile(input){const file=await fs.realpath(path.resolve(root,input||'')),stat=await fs.stat(file);assert.ok(stat.isFile()&&stat.size>0&&stat.size<=16000,'Provide a public text file.');return file;}
const messageFile=await textFile(options['--message-file']),notesFile=await textFile(options['--notes-file']);
const message=await fs.readFile(messageFile,'utf8');assert.ok(message.split(/\r?\n/)[0].trim().length<=100,'Use a short public commit title.');
assert.match(await fs.readFile(notesFile,'utf8'),/unsigned|preview/i,'Release notes must identify the unsigned preview.');
await fs.mkdir(path.join(root,'work'),{recursive:true});
const lockPath=path.join(root,'work/publication.lock'),journal='work/publication-session.json';
const lock=await fs.open(lockPath,'wx').catch(()=>{throw Error('Another publication owns work/publication.lock. If interrupted, verify its process has ended before removing that lock.');});
try {
  if(!options['--resume']){
    await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['tools/distribution/release.mjs','--installer'],{cwd:root,env,windowsHide:true,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('Clean preparation failed. Nothing published.')));});
  }
  const ready=await read('work/release-ready.json'),preparation=await read('work/github-source-preparation.json'),startup=await read('work/github-source-startup-verification.json'),version=(await read('package.json')).version;
  checkReady(ready,preparation,startup,version);
  if(options['--prepare-only']){console.log('Verified clean source and downloads prepared. No GitHub operations performed.');process.exitCode=0;}
  else {
    const contained=async input=>{const file=path.resolve(root,input);assert.ok(file.startsWith(path.join(root,'dist')+path.sep));const stat=await fs.lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(await fs.realpath(file),file);return file;};
    const setup=await contained(ready.installer),zip=await contained(ready.archive),files=[];
    for(const file of [setup,setup+'.sha256',setup+'.verification.json',zip,zip+'.sha256',zip+'.verification.json']){await contained(file);files.push({path:file,name:path.basename(file),bytes:(await fs.stat(file)).size,sha256:await hash(file)});}
    const setupHash=files[0].sha256,zipHash=files[3].sha256,build=await read(setup+'.build.json'),setupCheck=await read(setup+'.verification.json'),zipCheck=await read(zip+'.verification.json');
    assert.equal(build.version,version);assert.equal(build.sha256,setupHash);assert.equal(build.archiveSha256,zipHash);assert.equal(build.privateSeedsExcluded,true);assert.equal(build.testIdentity,false);assert.equal(build.signed,false);
    assert.equal(zipHash,ready.sha256);assert.equal(zipCheck.sha256,zipHash);assert.equal(zipCheck.archiveHashesVerified,true);assert.equal(zipCheck.privateStateExcluded,true);
    assert.equal(setupCheck.sha256,setupHash);assert.equal(setupCheck.providerOrDeviceActions,0);assert.equal(setupCheck.windowsStartupChanged,false);assert.equal(setupCheck.firewallChanged,false);
    for(const key of ['freshInstall','runningServerUpgrade','settingsPreserved','directoryLinksRejected','unownedFolderRejected','uninstallKeepsData','reinstallPreservesData','explicitPurge','registrationRemoved'])assert.equal(setupCheck[key],true,key);
    for(const file of [setup,zip])assert.equal((await fs.readFile(file+'.sha256','utf8')).trim(),await hash(file)+'  '+path.basename(file));
    const checkout=await fs.realpath(path.resolve(root,ready.checkout));assert.ok(checkout.startsWith(path.join(root,'work/clean-source-'))&&path.basename(checkout)==='Localserve');
    const call=async(command,values)=>(await execute(command,values,{cwd:checkout,env,windowsHide:true,maxBuffer:12*1024*1024})).stdout.trim();
    const git=(...values)=>call('git',['-c','credential.helper=','-c','credential.helper=!"'+gh.replaceAll('\\','/')+'" auth git-credential',...values]);
    const github=(...values)=>call(gh,values),api=async endpoint=>JSON.parse(await github('api',endpoint));
    const repo=await api('repos/'+repository),user=await api('user');assert.equal(repo.default_branch,'main');assert.equal(repo.permissions?.push,true,'Authenticated account needs push permission.');
    let session=options['--resume']?await read(journal):null;
    if(session){assert.equal(session.repositoryId,repo.id);assert.equal(session.repository,repository);assert.equal(session.version,version);assert.equal(session.indexTree,ready.indexTree);assert.equal(session.archiveSha256,ready.sha256);assert.equal(session.messageSha256,await hash(messageFile));assert.equal(session.notesSha256,await hash(notesFile));}
    const entries=(await git('ls-files','--stage','-z')).split('\0').filter(Boolean).map(line=>{const match=/^(\d+) ([a-f0-9]{40}) 0\t([\s\S]+)$/.exec(line);assert.ok(match);assertPublicPath(match[3]);return {mode:match[1],sha:match[2],path:match[3]};});
    assert.equal(entries.length,preparation.files);assert.equal(await git('write-tree'),ready.indexTree);assert.equal(await git('diff','--name-only'),'');
    // The prepared checkout starts with no authenticated remote operations. Its
    // destination is supplied explicitly, never inferred from installed data.
    const remote='https://github.com/'+repository+'.git';await git('remote','set-url','origin',remote);
    const head=async()=>{const raw=await git('ls-remote','origin','refs/heads/main');const sha=raw.split(/\s+/)[0];assert.match(sha,/^[a-f0-9]{40}$/,'An existing main branch is required.');return sha;};
    const parent=session?.parent||await head();
    if(!session){
      await git('fetch','--no-tags','origin','refs/heads/main');assert.equal(await git('rev-parse','FETCH_HEAD'),parent,'Remote changed; prepare again.');
      await git('config','user.name',user.login);await git('config','user.email',user.id+'+'+user.login+'@users.noreply.github.com');
      const {commit,changed}=await commitPreparedIndex(git,{indexTree:ready.indexTree,parent,messageFile});
      if(!changed)await git('update-ref','refs/heads/main',commit);
      session={repository,repositoryId:repo.id,version,indexTree:ready.indexTree,archiveSha256:ready.sha256,parent,commit,changed,branch:'verify/localserve-'+version+'-'+ready.indexTree.slice(0,12),messageSha256:await hash(messageFile),notesSha256:await hash(notesFile)};
    }
    const save=()=>fs.writeFile(path.join(root,journal),JSON.stringify(session,null,2)+'\n');await save();
    assert.equal(await git('rev-parse','HEAD'),session.commit);assert.equal(await git('rev-parse',session.commit+'^{tree}'),ready.indexTree);
    async function verifyTree(){checkRemoteTree(await api('repos/'+repository+'/git/trees/'+session.commit+'?recursive=1'),entries);}
    async function windows(branch){
      const deadline=Date.now()+45*60*1000;
      while(Date.now()<deadline){
        const list=JSON.parse(await github('run','list','--repo',repository,'--branch',branch,'--commit',session.commit,'--json','databaseId,headSha,event','--limit','20'));
        const candidates=list.filter(run=>run.headSha===session.commit&&run.event==='push');
        for(const candidate of candidates){const run=await api('repos/'+repository+'/actions/runs/'+candidate.databaseId);if(run.path!=='.github/workflows/windows.yml')continue;if(run.status==='completed'){checkWindowsRun(run,session.commit,branch);console.log('Windows verification passed: '+run.html_url);return run.id;}}
        console.log('Waiting for exact-commit Windows verification on '+branch+'…');await new Promise(resolve=>setTimeout(resolve,15000));
      }throw Error('Windows verification timed out. Resume after reviewing the candidate check.');
    }
    if(await head()===session.parent&&session.changed){
      await git('push','origin',session.commit+':refs/heads/'+session.branch);await verifyTree();
      session.candidateCI=await windows(session.branch);await save();
      assert.equal(await head(),session.parent,'Main changed; stop and review before preparing again.');
      assert.equal(await git('rev-parse',session.commit+'^'),session.parent);await git('push','origin',session.commit+':refs/heads/main');
    }
    assert.equal(await head(),session.commit,'Main differs from this publication.');await verifyTree();
    session.mainCI=await windows('main');await save();
    const tag='v'+version+'-preview',identity={tag,commit:session.commit};
    // A catalogue read after draft creation must not reuse an earlier cached response.
    let releaseRead=0;
    async function findRelease(){const refresh=Date.now()+'-'+(++releaseRead);for(let page=1;page<=10;page++){const releases=await api('repos/'+repository+'/releases?per_page=100&page='+page+'&refresh='+refresh),found=releases.find(item=>item.tag_name===tag);if(found)return found;if(releases.length<100)return null;}throw Error('Release lookup exceeds its bounded catalogue.');}
    let release=await findRelease();
    if(release?.draft)assert.equal(session.releaseId,release.id,'Existing draft is not owned by this publication.');
    if(!release){
      // Record an owned empty draft before uploading. Interrupted uploads may
      // resume without adopting another publisher's draft or replacing assets.
      await github('release','create',tag,'--repo',repository,'--target',session.commit,'--draft','--prerelease','--title','Sormus '+version+' Preview','--notes-file',notesFile);
      release=await findRelease();assert.ok(release);session.releaseId=release.id;await save();
    }
    if(release.draft){for(const file of files){const existing=release.assets.find(item=>item.name===file.name);if(existing){assert.equal(existing.digest,'sha256:'+file.sha256);assert.equal(existing.size,file.bytes);}else await github('release','upload',tag,file.path,'--repo',repository);}}
    release=await api('repos/'+repository+'/releases/'+release.id);checkAssets(release,files,identity);
    async function verifyTag(){const ref=await api('repos/'+repository+'/git/ref/tags/'+tag);assert.equal(ref.object.type,'commit');assert.equal(ref.object.sha,session.commit);}
    if(await git('ls-remote','origin','refs/tags/'+tag))await verifyTag();
    if(release.draft){assert.equal(await head(),session.commit);await github('release','edit',tag,'--repo',repository,'--draft=false');}
    release=await api('repos/'+repository+'/releases/'+release.id);assert.equal(release.draft,false);checkAssets(release,files,identity);await verifyTag();
    session.published=true;session.release=release.html_url;await save();console.log('Published verified source and matching preview downloads: '+release.html_url);
  }
}finally{await lock.close();await fs.rm(lockPath,{force:true});}
