/* One optional local track, decoded once and looped by the audio engine. */
(function(root){
  'use strict';
  function Music(url,volume,report){this.url=url;this.volume=volume/100;this.report=report;this.context=null;this.buffer=null;this.source=null;this.request=null;this.wanted=false;this.running=false;this.closed=false;this.failed=false;}
  Music.prototype.play=function(){
    var self=this;self.running=true;
    if(!self.wanted||!self.url||self.closed||self.failed)return;
    try{
      var Constructor=root.AudioContext||root.webkitAudioContext;
      if(!Constructor)throw Error('Web Audio unavailable');
      if(!self.context)self.context=new Constructor();
      if(self.context.resume){var resumed=self.context.resume();if(resumed&&resumed.catch)resumed.catch(function(){self.report('Music blocked. Toggle Music to retry.');});}
      if(self.buffer){self.start();return;}
      if(self.request)return;
      var xhr=new XMLHttpRequest();self.request=xhr;xhr.open('GET',self.url,true);xhr.responseType='arraybuffer';xhr.timeout=15000;
      xhr.onprogress=function(event){if(event.loaded>12582912||event.lengthComputable&&event.total>12582912)xhr.abort();};
      var failure=function(){self.request=null;if(!self.closed){self.failed=true;self.report('Music unavailable. Check the configured track.');}};
      xhr.onerror=xhr.ontimeout=xhr.onabort=failure;
      xhr.onload=function(){
        self.request=null;if(self.closed)return;
        if(xhr.status!==200||!xhr.response||xhr.response.byteLength>12582912){failure();return;}
        self.context.decodeAudioData(xhr.response,function(buffer){if(self.closed)return;self.buffer=buffer;if(self.wanted&&self.running)self.start();},failure);
      };
      xhr.send();self.report('Loading music');
    }catch(ignore){self.failed=true;self.report('Music is not supported in this browser.');}
  };
  Music.prototype.start=function(){
    if(this.source||!this.wanted||!this.running||this.closed)return;
    var gain,source;
    try{gain=this.context.createGain();source=this.context.createBufferSource();gain.gain.value=this.volume;source.buffer=this.buffer;source.loop=true;source.connect(gain);gain.connect(this.context.destination);source.start(0);this.source=source;this.gain=gain;this.report('Music on');}
    catch(ignore){if(source)source.disconnect();if(gain)gain.disconnect();this.failed=true;this.report('Music could not start. Toggle Music to retry.');}
  };
  Music.prototype.pause=function(){this.running=false;if(this.source){try{this.source.stop(0);this.source.disconnect();this.gain.disconnect();}catch(ignore){}this.source=null;}};
  Music.prototype.toggle=function(running){this.wanted=!this.wanted;this.failed=false;if(this.wanted&&running)this.play();else this.pause();this.report(this.wanted?'Music on':'Music off');return this.wanted;};
  Music.prototype.close=function(){this.closed=true;this.pause();if(this.request)this.request.abort();this.request=null;this.buffer=null;if(this.context&&this.context.close){try{var closing=this.context.close();if(closing&&closing.catch)closing.catch(function(){});}catch(ignore){}}};
  root.MazeMusic=Music;
}(window));
