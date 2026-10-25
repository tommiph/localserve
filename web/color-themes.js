/* Apply validated color tokens without HTML/CSS interpolation. This helper is
 * ES5 so the same palette works in the older TV viewer. */
(function(root){
  'use strict';
  var keys=['canvas','surface','surfaceMuted','text','muted','border','accent'];
  var properties=['--canvas','--surface','--surface-muted','--text','--muted','--border','--accent','--sidebar','--surface-hover','--faint','--accent-soft','--accent-ink','--accent-contrast','--page','--panel','--line'];
  function rgb(hex){return [1,3,5].map(function(i){return parseInt(hex.substr(i,2),16);});}
  function blend(a,b,weight){var x=rgb(a),y=rgb(b);return '#'+x.map(function(v,i){return ('0'+Math.round(v*(1-weight)+y[i]*weight).toString(16)).slice(-2);}).join('');}
  function luminance(hex){var c=rgb(hex).map(function(v){v/=255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);});return c[0]*.2126+c[1]*.7152+c[2]*.0722;}
  function contrast(a,b){var x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
  function apply(doc,palette){
    var signature=JSON.stringify(palette||null);
    if(doc._sormusPalette===signature)return;
    doc._sormusPalette=signature;
    var style=doc.documentElement.style,i,c=palette&&palette.colors;
    for(i=0;i<properties.length;i+=1)style.removeProperty(properties[i]);
    var legacy=doc.getElementById('palette-legacy');if(legacy)legacy.parentNode.removeChild(legacy);
    doc.documentElement.removeAttribute('data-color-theme');
    if(!c||keys.some(function(key){return !/^#[0-9a-f]{6}$/i.test(c[key]);}))return;
    doc.documentElement.setAttribute('data-theme',palette.mode==='light'?'light':'dark');
    doc.documentElement.setAttribute('data-color-theme','custom');
    var values=[c.canvas,c.surface,c.surfaceMuted,c.text,c.muted,c.border,c.accent,c.canvas,blend(c.surface,c.text,.05),c.muted,blend(c.surface,c.accent,.14),c.text,contrast(c.accent,'#ffffff')>=contrast(c.accent,'#000000')?'#ffffff':'#000000',c.canvas,c.surfaceMuted,c.border];
    for(i=0;i<properties.length;i+=1)style.setProperty(properties[i],values[i]);
    // The legacy Vista stage uses literal colours because its TV engine cannot
    // resolve CSS variables. Card motifs remain independent of the canvas.
    legacy=doc.createElement('style');legacy.id='palette-legacy';legacy.textContent='html[data-color-theme="custom"] body.vista-viewer,html[data-color-theme="custom"] body.legacy-vista{background:'+c.canvas+';color:'+c.text+'}';doc.head.appendChild(legacy);
  }
  root.ColorThemes={apply:apply,contrast:contrast};
}(window));
