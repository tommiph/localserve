/* Offline equirectangular overview. Static public-domain geometry stays local;
 * no tiles, geocoder, network coordinates, navigation or location history. */
(function(root){'use strict';
  root.PhoneMap={draw:function(canvas,countries,location,name){
    var ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;if(!ctx)return;
    ctx.fillStyle='#121e32';ctx.fillRect(0,0,w,h);ctx.strokeStyle='#283750';ctx.lineWidth=1;
    for(var lon=-180;lon<=180;lon+=30){var x=(lon+180)/360*w;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
    for(var lat=-60;lat<=60;lat+=30){var y=(90-lat)/180*h;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
    ctx.fillStyle='#414c65';ctx.strokeStyle='#7a7696';
    for(var c=0;c<countries.length;c++){
      var geometry=countries[c].geometry,polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
      ctx.beginPath();for(var p=0;p<polygons.length;p++)for(var r=0;r<polygons[p].length;r++){
        var ring=polygons[p][r];for(var v=0;v<ring.length;v++){
          var point=ring[v],px=(point[0]+180)/360*w,py=(90-point[1])/180*h;
          if(!v||Math.abs(point[0]-ring[v-1][0])>180)ctx.moveTo(px,py);else ctx.lineTo(px,py);
        }ctx.closePath();
      }ctx.fill();ctx.stroke();
    }
    if(location&&typeof location.latitude==='number'&&typeof location.longitude==='number'){
      var mx=(location.longitude+180)/360*w,my=(90-location.latitude)/180*h;
      ctx.strokeStyle='#eee6ff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(mx,my,17,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle='#b5a6ff';ctx.beginPath();ctx.arc(mx,my,7,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#ffffff';ctx.font='20px Arial';ctx.fillText(name,Math.max(12,Math.min(w-300,mx+24)),Math.max(28,my-20));
    }
  }};
}(this));
