/** Public tests use disposable stores, loopback servers and synthetic adapters. */
export const publicTests = Object.freeze([
  'source','backbone','do-not-disturb','simulator','controls',
  'task-event-values','task-rerun','recipes',
  'universe','universe-viewer','universe-ui','vistas-legacy','games',
  'version','installer','repository-license','distribution-sanitization','demo',
].map(name => 'tests/' + name + '.test.mjs'));
