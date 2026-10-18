/* ES5 raster map: exactly 300 metres across at the reported latitude.
 * Load only visible tiles while this page is foregrounded. Browser HTTP caching
 * is preserved; no prefetch, retries, location history or provider API key. */
var PhoneStreetMap=(function(){'use strict';
  var width=1824,height=680,span=300,cache={},generation=0,current=null;
  function layout(fix){
    if(!fix||typeof fix.latitude!=='number'||typeof fix.longitude!=='number'||
      !isFinite(fix.latitude)||!isFinite(fix.longitude)||Math.abs(fix.latitude)>85.05112878||Math.abs(fix.longitude)>180)return null;
    var latitude=fix.latitude*Math.PI/180,circumference=40075016.68557849*Math.cos(latitude);
    // Floor keeps visible tiles at least 256 display pixels wide, bounding loads.
    var zoom=Math.max(0,Math.min(19,Math.floor(Math.log(circumference*width/span/256)/Math.LN2)));
    var count=Math.pow(2,zoom),size=circumference/count*width/span;
    var x=(fix.longitude+180)/360*count,y=(1-Math.log(Math.tan(latitude)+1/Math.cos(latitude))/Math.PI)/2*count;
    var left=x-width/size/2,top=y-height/size/2,tiles=[];
    for(var row=Math.floor(top);row<Math.ceil(top+height/size);row++){
      if(row<0||row>=count)continue;
      for(var col=Math.floor(left);col<Math.ceil(left+width/size);col++){
        var wrapped=((col%count)+count)%count,key=zoom+'/'+wrapped+'/'+row;
        tiles.push({key:key,x:(col-left)*size,y:(row-top)*size,size:size});
      }
    }
    return {tiles:tiles,metresPerPixel:span/width,zoom:zoom};
  }
  function paint(){
    if(!current)return;var ctx=current.canvas.getContext('2d');if(!ctx)return;
    ctx.fillStyle='#121e32';ctx.fillRect(0,0,width,height);
    var loaded=0,failed=0;
    for(var i=0;i<current.layout.tiles.length;i++){
      var tile=current.layout.tiles[i],item=cache[tile.key];
      if(item&&item.ready){ctx.drawImage(item.image,tile.x,tile.y,tile.size+0.5,tile.size+0.5);loaded++;}
      else if(item&&item.failed)failed++;
    }
    ctx.fillStyle='#172237';ctx.fillRect(24,height-62,350,38);ctx.fillStyle='#ffffff';ctx.font='20px Arial';
    ctx.fillText(failed?'Some map tiles unavailable':loaded===current.layout.tiles.length?'300 m across':'Loading street map…',38,height-36);
    // 50 m scale is derived from the same ground resolution as the viewport.
    ctx.strokeStyle='#172237';ctx.lineWidth=8;ctx.beginPath();ctx.moveTo(width-340,height-35);ctx.lineTo(width-340+50/current.layout.metresPerPixel,height-35);ctx.stroke();
    ctx.fillStyle='#172237';ctx.fillText('50 m',width-340,height-52);
    ctx.beginPath();ctx.arc(width/2,height/2,13,0,Math.PI*2);ctx.fillStyle='#7356d9';ctx.fill();ctx.strokeStyle='#ffffff';ctx.lineWidth=4;ctx.stroke();
  }
  function stop(){
    generation++;current=null;
    // Removing pending image sources cancels owned requests where supported.
    for(var key in cache)if(Object.prototype.hasOwnProperty.call(cache,key)&&!cache[key].ready&&!cache[key].failed){
      cache[key].image.onload=cache[key].image.onerror=null;cache[key].image.src='';delete cache[key];
    }
  }
  function draw(canvas,fix,allowLoads){
    var plan=layout(fix);if(!plan){stop();return false;}
    current={canvas:canvas,layout:plan};var wanted={},token=generation;
    for(var i=0;i<plan.tiles.length;i++)wanted[plan.tiles[i].key]=true;
    // Retain only this viewport. The browser owns the reusable disk HTTP cache.
    for(var old in cache)if(Object.prototype.hasOwnProperty.call(cache,old)&&!wanted[old]){
      cache[old].image.onload=cache[old].image.onerror=null;if(!cache[old].ready)cache[old].image.src='';delete cache[old];
    }
    for(var n=0;n<plan.tiles.length;n++){
      var key=plan.tiles[n].key;if(cache[key]||!allowLoads)continue;
      (function(id){var image=new Image(),item={image:image,ready:false,failed:false};cache[id]=item;
        image.crossOrigin='anonymous';
        image.onload=function(){if(token!==generation||cache[id]!==item)return;item.ready=true;paint();};
        image.onerror=function(){if(token!==generation||cache[id]!==item)return;item.failed=true;paint();};
        image.src='https://tile.openstreetmap.org/'+id+'.png';
      }(key));
    }
    paint();return true;
  }
  return {layout:layout,draw:draw,stop:stop};
}());
