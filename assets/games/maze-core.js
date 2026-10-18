/* Deterministic random-access perfect mazes. Recursive partitions join through
 * one door, so every room is reachable without storing the complete maze. */
(function(root){
  'use strict';
  var DX=[0,1,0,-1],DY=[-1,0,1,0];
  function hash(value){value|=0;value^=value>>>16;value=Math.imul(value,0x45d9f3b);value^=value>>>16;value=Math.imul(value,0x45d9f3b);return(value^(value>>>16))>>>0;}
  function wall(seed,size,x,y,direction){
    var nx=x+DX[direction],ny=y+DY[direction];
    if(nx<0||ny<0||nx>=size||ny>=size)return true;
    var left=0,top=0,width=size,height=size,s=seed>>>0;
    while(width>1||height>1){
      var h=hash(s),vertical=width>1&&(height===1||width>height||width===height&&(h&1));
      var length=vertical?width:height;
      var middle=Math.max(1,Math.floor(length/3));
      var cut=middle+(h%(Math.max(1,length-2*middle+1)));
      if(cut>=length)cut=length-1;
      var door=hash(h^0x73a1)% (vertical?height:width);
      var a=vertical?x-left<cut:y-top<cut,b=vertical?nx-left<cut:ny-top<cut;
      if(a!==b)return (vertical?y-top:x-left)!==door;
      s=hash(s^(a?0x1f123bb5:0x5f356495));
      if(vertical){if(a)width=cut;else{left+=cut;width-=cut;}}
      else if(a)height=cut;else{top+=cut;height-=cut;}
    }
    return false;
  }
  function gems(seed,size,count){
    var result=[],used={},limit=Math.min(count,size*size-2),attempt=0;
    while(result.length<limit&&attempt<4096){
      var x=hash(seed+attempt*17)%size,y=hash(seed+attempt*37+19)%size,key=x+','+y;attempt++;
      if(used[key]||x===0&&y===size-1||x===size-1&&y===0)continue;
      used[key]=true;result.push({x:x,y:y,collected:false});
    }
    return result;
  }
  function stage(settings,level,seed){var size=settings.startSize+(level-1)*settings.growth;return {level:level,size:size,seed:hash(seed+level*7919),x:0,y:size-1,facing:0,seconds:0,gems:[],collected:0};}
  function create(settings,seed){var value=stage(settings,1,seed);value.gems=gems(value.seed,value.size,settings.gemCount);return value;}
  function move(value,backwards){var d=(value.facing+(backwards?2:0))%4;if(wall(value.seed,value.size,value.x,value.y,d))return null;return{x:value.x+DX[d],y:value.y+DY[d]};}
  function collect(value,points){var total=0;for(var i=0;i<value.gems.length;i++){var gem=value.gems[i];if(!gem.collected&&gem.x===value.x&&gem.y===value.y){gem.collected=true;value.collected++;total+=points;}}return total;}
  function bonus(value,settings){return Math.max(1,Math.round(settings.speedPoints*value.level/(1+value.seconds/(value.size*value.size*settings.paceSeconds))));}
  root.MazeCore={hash:hash,wall:wall,gems:gems,stage:stage,create:create,move:move,collect:collect,bonus:bonus,dx:DX,dy:DY};
}(typeof window!=='undefined'?window:this));
