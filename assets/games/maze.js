/* First-person ES5/WebGL1 game. Only a local window of a random-access maze is
 * materialized; the logical maze can grow without a level-sized mesh or grid. */
(function(){
  'use strict';
  var canvas=document.getElementById('maze'),menu=document.getElementById('menu'),start=document.getElementById('start');
  var settings,game,renderer,scene,camera,floor,sun,world,wallMesh,trimMesh,gemMeshes=[],portal;
  var wallMaterial,trimMaterial,gemMaterial,portalMaterial,exitMaterial,floorMaterial,floorTexture;
  var paused=true,started=false,transition=false,closed=false,animation=null,frameId=0,last=0,renderAt=0;
  var held={},pressed={},score=0,best=0,seed=(Date.now()^Math.floor(Math.random()*0x7fffffff))>>>0,music=null,menuIndex=0;
  var CELL=4,HEIGHT=2.8,RADIUS=7,toastUntil=0,reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var buttons=[start,document.getElementById('music'),document.getElementById('fullscreen')];
  try{best=Math.max(0,Math.min(9000000000000,Number(localStorage.getItem('localserve.maze.best.v1'))||0));}catch(ignore){}
  function text(id,value){var node=document.getElementById(id),next=String(value);if(node.textContent!==next)node.textContent=next;}
  function clock(seconds){seconds=Math.floor(seconds);return Math.floor(seconds/60)+':'+('0'+seconds%60).slice(-2);}
  function hud(){text('level',game.level);text('score',score);text('gems',game.collected+' / '+game.gems.length);text('time',clock(game.seconds));text('bearing',['N','E','S','W'][game.facing]);text('best','Best score: '+best);}
  function record(){if(score>best){best=score;try{localStorage.setItem('localserve.maze.best.v1',String(best));}catch(ignore){}}}
  function flash(message){text('toast',message);toastUntil=performance.now()+1600;}
  function pause(message){paused=true;held={};if(music)music.pause();menu.hidden=false;start.textContent=transition?'Next maze':started?'Continue run':'Start run';text('menu-message',message||'Run paused. Your maze and score are kept.');menuIndex=0;start.focus();}
  function resume(){if(!game||!renderer)return;if(transition){nextLevel();transition=false;}started=true;paused=false;menu.hidden=true;held={};last=performance.now();canvas.focus();if(music)music.play();}
  function mergedBox(geometry,x,y,z,width,height,depth,color){
    var box=new THREE.BoxGeometry(width,height,depth),matrix=new THREE.Matrix4().makeTranslation(x,y,z);
    for(var i=0;i<box.faces.length;i++)box.faces[i].color.setHex(color);
    geometry.merge(box,matrix);box.dispose();
  }
  // Merge nearby walls into two shared batches; retiring a window releases its
  // geometry without disposing the materials reused by the following window.
  function disposeWorld(){if(!world)return;scene.remove(world);wallMesh.geometry.dispose();trimMesh.geometry.dispose();for(var i=0;i<gemMeshes.length;i++)gemMeshes[i].geometry.dispose();portal.geometry.dispose();portal.userData.label.geometry.dispose();gemMeshes=[];world=null;}
  function rebuild(){
    disposeWorld();world=new THREE.Group();var walls=new THREE.Geometry(),trims=new THREE.Geometry();
    var minimumX=Math.max(0,game.x-RADIUS),maximumX=Math.min(game.size-1,game.x+RADIUS),minimumY=Math.max(0,game.y-RADIUS),maximumY=Math.min(game.size-1,game.y+RADIUS);
    function wall(x,y,vertical){
      var tint=[0xbda7e9,0xe8b2d6,0xaed9e3,0xbcbfea][MazeCore.hash(game.seed+x*47+y*83)%4];
      mergedBox(walls,x,HEIGHT/2,y,vertical?.16:CELL,HEIGHT,vertical?CELL:.16,tint);
      mergedBox(trims,x,.12,y,vertical?.21:CELL,.13,vertical?CELL:.21,0x8cfff3);
      mergedBox(trims,x,HEIGHT-.12,y,vertical?.21:CELL,.10,vertical?CELL:.21,0xffa9dd);
    }
    for(var y=minimumY;y<=maximumY;y++)for(var x=minimumX;x<=maximumX;x++){
      var px=(x-game.x)*CELL,pz=(y-game.y)*CELL;
      if(MazeCore.wall(game.seed,game.size,x,y,0))wall(px,pz-CELL/2,false);
      if(MazeCore.wall(game.seed,game.size,x,y,3))wall(px-CELL/2,pz,true);
      if(x===maximumX&&MazeCore.wall(game.seed,game.size,x,y,1))wall(px+CELL/2,pz,true);
      if(y===maximumY&&MazeCore.wall(game.seed,game.size,x,y,2))wall(px,pz+CELL/2,false);
    }
    wallMesh=new THREE.Mesh(walls,wallMaterial);trimMesh=new THREE.Mesh(trims,trimMaterial);world.add(wallMesh);world.add(trimMesh);
    for(var g=0;g<game.gems.length;g++){
      var gem=game.gems[g];if(gem.collected||Math.abs(gem.x-game.x)>RADIUS||Math.abs(gem.y-game.y)>RADIUS)continue;
      var mesh=new THREE.Mesh(new THREE.OctahedronGeometry(.32,0),gemMaterial);mesh.position.set((gem.x-game.x)*CELL,1.05,(gem.y-game.y)*CELL);mesh.userData.phase=g;world.add(mesh);gemMeshes.push(mesh);
    }
    portal=new THREE.Mesh(new THREE.TorusGeometry(.95,.10,6,28),portalMaterial);portal.position.set((game.size-1-game.x)*CELL,1.2,-game.y*CELL);world.add(portal);
    var exitLabel=new THREE.Mesh(new THREE.PlaneGeometry(1.6,.5),exitMaterial);exitLabel.position.copy(portal.position);exitLabel.position.y=2.5;world.add(exitLabel);portal.userData.label=exitLabel;
    // A room spans one texture period, keeping the grid aligned on rebasing.
    scene.add(world);floorTexture.offset.set(game.x,-game.y);
  }
  function nextLevel(){
    var level=game?game.level+1:1;game=MazeCore.stage(settings,level,seed);game.gems=MazeCore.gems(game.seed,game.size,settings.gemCount);animation=null;rebuild();hud();text('stage-result','');
  }
  function finish(){var earned=MazeCore.bonus(game,settings);score+=earned;record();hud();transition=true;text('stage-result','Maze '+game.size+' × '+game.size+' · '+clock(game.seconds)+' · Speed bonus +'+earned);pause('Exit found. The next maze is larger.');}
  function input(code){
    if(animation||paused)return;
    if(code===37||code===39){animation={kind:'turn',from:game.facing,to:(game.facing+(code===37?3:1))%4,sign:code===37?1:-1,elapsed:0,duration:reduced?.01:.20};return;}
    var target=MazeCore.move(game,code===40);if(!target){held[code]=0;flash('Wall');return;}
    animation={kind:'walk',x:target.x,y:target.y,elapsed:0,duration:reduced?.01:settings.moveMs/1000};
  }
  function update(dt,now,activeSeconds){
    // Score time uses actual visible play time; movement alone clamps long
    // frames so a slow render cannot teleport the player through rooms.
    if(!paused){game.seconds+=activeSeconds;
      if(!animation){var order=[38,40,37,39];for(var i=0;i<order.length;i++)if(held[order[i]]>now){input(order[i]);break;}}
      if(animation){var action=animation;action.elapsed+=dt;var fraction=Math.min(1,action.elapsed/action.duration),ease=fraction*fraction*(3-2*fraction);
        if(action.kind==='walk'){camera.position.x=(action.x-game.x)*CELL*ease;camera.position.z=(action.y-game.y)*CELL*ease;camera.position.y=1.45+(reduced?0:Math.sin(fraction*Math.PI)*.045);}
        else camera.rotation.y=-action.from*Math.PI/2+action.sign*Math.PI/2*ease;
        if(fraction===1){animation=null;if(action.kind==='turn')game.facing=action.to;else{game.x=action.x;game.y=action.y;var earned=MazeCore.collect(game,settings.gemPoints);if(earned){score+=earned;record();flash('Gem +'+earned);}rebuild();if(game.x===game.size-1&&game.y===0)finish();}camera.position.set(0,1.45,0);camera.rotation.y=-game.facing*Math.PI/2;}
      }hud();
    }
    if(!paused&&!reduced){for(var g=0;g<gemMeshes.length;g++){gemMeshes[g].rotation.y=now*.001;gemMeshes[g].position.y=1.05+Math.sin(now*.002+gemMeshes[g].userData.phase)*.10;}portal.rotation.z=now*.0004;}
    if(toastUntil&&now>toastUntil){text('toast','');toastUntil=0;}
  }
  function resize(){if(!renderer)return;var width=window.innerWidth,height=window.innerHeight,limit={low:960,medium:1440,high:1920}[settings.detail],scale=Math.min(1,limit/Math.max(width,height));renderer.setSize(Math.round(width*scale),Math.round(height*scale),false);camera.aspect=width/height;camera.updateProjectionMatrix();}
  function loop(now){if(closed)return;frameId=requestAnimationFrame(loop);if(document.hidden){last=now;return;}if(now-renderAt<1000/30)return;var elapsed=Math.max(0,(now-last)/1000),dt=Math.min(.1,elapsed);last=now;renderAt=now;if(game){update(dt,now,elapsed);sun.position.set(camera.position.x+14,8,camera.position.z-30);renderer.render(scene,camera);}}
  function setup(){
    var gl=canvas.getContext('webgl',{alpha:false,antialias:false})||canvas.getContext('experimental-webgl',{alpha:false,antialias:false});if(!gl)throw Error('WebGL is unavailable in this browser.');
    renderer=new THREE.WebGLRenderer({canvas:canvas,context:gl,antialias:false});renderer.setPixelRatio(1);renderer.setClearColor(0x696389);scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0x696389,.075);camera=new THREE.PerspectiveCamera(72,1,.08,55);camera.position.set(0,1.45,0);
    scene.add(new THREE.AmbientLight(0xffffff,.9));var light=new THREE.DirectionalLight(0xffd9ec,.55);light.position.set(-2,5,3);scene.add(light);
    wallMaterial=new THREE.MeshLambertMaterial({vertexColors:THREE.FaceColors});trimMaterial=new THREE.MeshBasicMaterial({vertexColors:THREE.FaceColors});gemMaterial=new THREE.MeshBasicMaterial({color:0xffc7ee});portalMaterial=new THREE.MeshBasicMaterial({color:0x9ffff0,side:THREE.DoubleSide});
    var exitImage=document.createElement('canvas');exitImage.width=256;exitImage.height=80;var exitPaint=exitImage.getContext('2d');exitPaint.fillStyle='#17363f';exitPaint.fillRect(0,0,256,80);exitPaint.fillStyle='#b4fff1';exitPaint.font='bold 52px Arial';exitPaint.textAlign='center';exitPaint.fillText('EXIT',128,59);exitMaterial=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(exitImage),side:THREE.DoubleSide});
    var image=document.createElement('canvas');image.width=image.height=128;var context=image.getContext('2d');context.fillStyle='#332d58';context.fillRect(0,0,128,128);context.strokeStyle='#826a9a';context.lineWidth=2;context.strokeRect(1,1,126,126);context.fillStyle='#554475';context.fillRect(60,60,8,8);
    floorTexture=new THREE.CanvasTexture(image);floorTexture.wrapS=floorTexture.wrapT=THREE.RepeatWrapping;floorTexture.repeat.set(30,30);floorMaterial=new THREE.MeshBasicMaterial({map:floorTexture});floor=new THREE.Mesh(new THREE.PlaneGeometry(120,120),floorMaterial);floor.rotation.x=-Math.PI/2;scene.add(floor);
    var sunImage=document.createElement('canvas');sunImage.width=sunImage.height=128;var ctx=sunImage.getContext('2d'),gradient=ctx.createLinearGradient(0,0,0,128);gradient.addColorStop(0,'#ffdfa8');gradient.addColorStop(1,'#ff8dc8');ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(64,64,60,0,Math.PI*2);ctx.fill();ctx.globalCompositeOperation='destination-out';for(var i=72;i<128;i+=12)ctx.fillRect(0,i,128,5);
    sun=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(sunImage),transparent:true,fog:false,depthWrite:false}));sun.scale.set(12,12,1);scene.add(sun);
    game=MazeCore.create(settings,seed);rebuild();resize();hud();last=performance.now();frameId=requestAnimationFrame(loop);
    music=new MazeMusic(settings.musicUrl,settings.musicVolume,function(message){text('music-status',message);});buttons[1].disabled=!settings.musicUrl;text('music-status',settings.musicUrl?'Music off':'No music configured');start.disabled=false;start.focus();
  }
  function key(code,down,repeating){
    // Expiring held keys handles remotes that omit keyup. Discrete menu actions
    // ignore repeats, while directional repeats continue walking and turning.
    code={87:38,83:40,65:37,68:39}[code]||code;
    if(!down){delete held[code];delete pressed[code];return;}
    var now=performance.now(),repeated=repeating||pressed[code]>now;pressed[code]=now+500;held[code]=now+240;
    if(code===77&&!repeated){buttons[1].click();return;}
    if(paused){if(code===38||code===37||code===40||code===39){menuIndex=(menuIndex+((code===38||code===37)?buttons.length-1:1))%buttons.length;if(buttons[menuIndex].disabled)menuIndex=0;buttons[menuIndex].focus();}else if(code===13&&!repeated)buttons[menuIndex].click();else if((code===27||code===10009)&&!repeated&&started&&!transition)resume();return;}
    if((code===13||code===27||code===10009)&&!repeated){pause();return;}
    if(code>=37&&code<=40&&!animation)input(code);
  }
  document.addEventListener('keydown',function(event){var code=event.keyCode||event.which;if([13,27,37,38,39,40,65,68,77,83,87,10009].indexOf(code)<0)return;event.preventDefault();event.stopPropagation();key(code,true,event.repeat);});
  document.addEventListener('keyup',function(event){key(event.keyCode||event.which,false);});
  start.onclick=resume;buttons[1].onclick=function(){if(music&&settings.musicUrl){var wanted=music.toggle(!paused);buttons[1].textContent=wanted?'Music on':'Music off';}};
  if(window.LocalserveTvViewer)window.LocalserveTvViewer.install(null,{pause:function(mode){
    if(mode==='play'||mode==='toggle'&&paused)resume();else if(!paused)pause();
  }});
  buttons[2].onclick=function(){var element=document.documentElement,enter=element.requestFullscreen||element.webkitRequestFullscreen;if(enter){var request=enter.call(element);if(request&&request.catch)request.catch(function(){});}};
  buttons.forEach(function(button,index){button.addEventListener('focus',function(){menuIndex=index;});});
  window.addEventListener('blur',function(){if(started&&!paused)pause();held={};pressed={};});
  document.addEventListener('visibilitychange',function(){if(document.hidden&&started)pause();last=performance.now();});
  window.addEventListener('resize',resize);
  canvas.addEventListener('webglcontextlost',function(event){event.preventDefault();pause('Graphics context lost. Reload the page to continue.');start.disabled=true;renderer=null;cancelAnimationFrame(frameId);});
  window.addEventListener('pagehide',function(){closed=true;cancelAnimationFrame(frameId);xhr.abort();if(music)music.close();disposeWorld();if(floor){floor.geometry.dispose();floorMaterial.dispose();floorTexture.dispose();wallMaterial.dispose();trimMaterial.dispose();gemMaterial.dispose();portalMaterial.dispose();exitMaterial.map.dispose();exitMaterial.dispose();sun.material.map.dispose();sun.material.dispose();}if(renderer)renderer.dispose();});
  window.addEventListener('pageshow',function(event){if(event.persisted)location.reload();});
  start.disabled=true;
  var xhr=new XMLHttpRequest();xhr.open('GET','/api/games/maze',true);xhr.timeout=10000;xhr.onload=function(){if(closed)return;try{if(xhr.status!==200)throw Error('The game is disabled or unavailable.');settings=JSON.parse(xhr.responseText).settings;setup();}catch(error){text('menu-message',error.message);text('music-status','');}};xhr.onerror=xhr.ontimeout=function(){if(!closed)text('menu-message','Unable to load game settings. Reload to try again.');};xhr.send();
}());
