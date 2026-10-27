/* Full-screen native input selection. A cancelled asynchronous show is hidden
 * when it completes; ambiguous source changes are never replayed. */
(function (root) {
  'use strict';
  function create(api,report) {
    var sources = [], readEpoch = 0, epoch = 0, busy = false, visible = false, hideRequested = false;
    function failed() { report({ok:false,message:'The TV could not open this input. Check its signal and try again.'}); }
    function drain() {
      if (busy || !visible || !hideRequested) return;
      busy = true;hideRequested = false;
      try { api.tvwindow.hide(function () { busy = false;visible = false;report({closed:true}); },function () { busy = false;failed(); },'MAIN'); }
      catch (ignore) { busy = false;failed(); }
    }
    return {
      read:function () {
        var request = ++readEpoch;
        if (!api || !api.systeminfo || !api.tvwindow) { report({sources:[],supported:false});return; }
        try { api.systeminfo.getPropertyValue('VIDEOSOURCE',function (value) {
          if (request !== readEpoch) return;
          var known = {};
          sources = (value.connected || []).concat(value.disconnected || []).filter(function (source) {
            if (!source || ['HDMI','TV'].indexOf(source.type) < 0 || typeof source.number !== 'number' || source.number % 1 || source.number < 0 || source.number > 32) return false;
            var key = source.type + source.number;if (known[key]) return false;known[key] = true;return true;
          }).slice(0,16);
          report({supported:true,sources:sources.map(function (source) {
            return {id:source.type + ':' + source.number,name:source.type === 'TV' ? 'Live TV' : 'HDMI ' + source.number,
              connected:(value.connected || []).some(function (item) { return item.type === source.type && item.number === source.number; })};
          })});
        },function () { if (request === readEpoch) report({sources:[],supported:false}); }); }
        catch (ignore) { report({sources:[],supported:false}); }
      },
      open:function (id) {
        var source = sources.filter(function (item) { return item.type + ':' + item.number === id; })[0];
        if (busy || visible || !/^(HDMI|TV):\d{1,2}$/.test(id) || !source) return false;
        var request = ++epoch;busy = true;hideRequested = false;
        function failure() { busy = false;if (request === epoch) failed();drain(); }
        try { api.tvwindow.setSource(source,function () {
          if (request !== epoch) { busy = false;drain();return; }
          visible = true;
          try { api.tvwindow.show(function () {
            busy = false;if (request !== epoch) { drain();return; }report({ok:true,visible:true});
          },function () { hideRequested = true;failure(); },['0%','0%','100%','100%'],'MAIN','FRONT'); }
          catch (ignore) { hideRequested = true;failure(); }
        },failure,'MAIN'); } catch (ignore) { failure(); }
        return true;
      },
      hide:function () { epoch++;readEpoch++;hideRequested = true;drain(); },
      active:function () { return visible || busy; }
    };
  }
  root.LauncherInputs = {create:create};
}(this));
