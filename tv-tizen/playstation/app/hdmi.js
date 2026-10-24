/* One native HDMI 1 plane. Cancellation serializes behind pending source/show
 * callbacks. There is no automatic retry, console wake or source restoration. */
(function (root) {
  'use strict';
  function create(api, report) {
    var generation = 0, busy = false, visible = false, hideRequested = false;
    function validLayout(layout) { return layout === 'split' || layout === 'hud'; }
    function failure(error) {
      return error && error.name === 'SecurityError' ? 'HDMI permission was denied by the TV.'
        : 'HDMI 1 could not open. Check the cable and input, then choose Return to game to try again.';
    }
    function drain() {
      if (busy || !visible || !hideRequested) return;
      busy = true;hideRequested = false;
      function failed(error) { busy = false;report(failure(error),true); }
      try { api.tvwindow.hide(function () { busy = false;visible = false; },failed,'MAIN'); }
      catch (error) { failed(error); }
    }
    function show(request,layout) {
      function failed(error) {
        busy = false;hideRequested = true;
        if(request === generation)report(failure(error),true);
        drain();
      }
      try {
        api.tvwindow.show(function () {
          busy = false;
          if(request !== generation) { drain();return; }
          report(layout === 'hud' ? 'HDMI 1 full-screen HUD open.' : 'HDMI 1 split view open.',false,layout);
        },failed,layout === 'hud' ? ['0%','0%','100%','100%'] : ['2%','2%','50%','50%'],'MAIN',layout === 'hud' ? 'BEHIND' : 'FRONT');
      } catch(error) { failed(error); }
    }
    return {
      open:function (layout) {
        layout = layout || 'split';
        if(!validLayout(layout))return false;
        if (busy || visible) return false;
        if (!api || !api.tvwindow || !api.systeminfo) { report('HDMI video is available only in the installed Samsung TV app.',true);return false; }
        var request = ++generation;busy = true;hideRequested = false;
        function failed(error) { busy = false;if (request === generation) report(failure(error),true);drain(); }
        try {
          api.systeminfo.getPropertyValue('VIDEOSOURCE',function (sources) {
            if (request !== generation) { busy = false;drain();return; }
            // A console without a current signal may be in disconnected. The
            // explicit app launch selects that existing port without waking it.
            var source = (sources.connected || []).concat(sources.disconnected || []).filter(function (item) { return item && item.type === 'HDMI' && item.number === 1; })[0];
            if (!source) { busy = false;report('HDMI 1 was not reported by this TV.',true);return; }
            try {
              api.tvwindow.setSource(source,function () {
                if (request !== generation) { busy = false;drain();return; }
                visible = true;
                show(request,layout);
              },failed,'MAIN');
            } catch (error) { failed(error); }
          },failed);
        } catch (error) { failed(error); }
        return true;
      },
      layout:function (layout) {
        if(!validLayout(layout) || busy || !visible)return false;
        busy = true;show(++generation,layout);return true;
      },
      hide:function () { generation++;hideRequested = true;drain(); }
    };
  }
  root.PlaystationHdmi = {create:create};
}(this));
