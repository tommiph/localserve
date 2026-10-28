/* Choose scripts while the document is parsing, before a legacy TV browser
 * encounters syntax it cannot read. This external loader works with the
 * viewer's self-only Content Security Policy. */
(function () {
  'use strict';
  var forceLegacy = /(?:^|[?&])legacy=1(?:&|$)/.test(location.search);
  var modern = !forceLegacy && window.CSS && CSS.supports && CSS.supports('display', 'grid')
    && Object.fromEntries && Array.prototype.at && Element.prototype.replaceChildren
    && window.fetch && window.Promise;
  document.write('<script src="../today-renderer.js?v=3" defer><\/script>');
  var scripts = modern
    ? ['../card-renderer.js?v=11', '../vista-renderer.js?v=5', '../vista-viewer.js?v=3']
    : ['../assets/vista-legacy.js?v=33'];
  if (!modern) document.write('<link rel="stylesheet" href="../assets/vista-legacy.css?v=6">');
  for (var i = 0; i < scripts.length; i += 1) {
    document.write('<script src="' + scripts[i] + '" defer><\/script>');
  }
}());
