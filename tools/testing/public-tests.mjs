/** Public tests use disposable stores, loopback servers and synthetic adapters. */
export const publicTests = Object.freeze([
  'source','backbone','do-not-disturb','simulator','controls','phone-home','control-response',
  'task-event-values','task-rerun','task-recovery-ui','run-details','recipes','connection-recovery','oculus-library','oculus-go-app',
  'universe','universe-viewer','universe-ui','vistas-legacy','games','webcam',
  'version','installer','repository-license','distribution-sanitization','demo',
].map(name => 'tests/' + name + '.test.mjs'));
