/** Public tests use disposable stores, loopback servers and synthetic adapters. */
export const publicTests = Object.freeze([
  'source','styles','client-packages','backbone','do-not-disturb','simulator','controls','phone-home','phone-handoff','control-response',
  'task-event-values','task-rerun','task-recovery-ui','run-details','recipes','connection-recovery','oculus-library','oculus-go-app',
  'universe','universe-viewer','universe-ui','vistas-legacy','vista-recovery','games','webcam',
  'version','installer','repository-license','distribution-sanitization','demo',
  'material-symbols','activity-ui','card-templates','admin-editor-ux','admin-ux',
].map(name => 'tests/' + name + '.test.mjs'));
