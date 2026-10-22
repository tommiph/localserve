/** Stylesheet assembly preserves exact order and keeps runtime output current. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {checkStyles,renderStyles} from '../tools/styles/build.mjs';

test('shared stylesheet is the exact ordered source bundle',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  assert.equal(await checkStyles(root),true);
  const order=JSON.parse(await fs.readFile(new URL('../web/styles/order.json',import.meta.url),'utf8'));
  const files=await fs.readdir(new URL('../web/styles/',import.meta.url));
  assert.deepEqual(files.filter(file=>file.endsWith('.css')).sort(),[...order].sort());
  const css=await renderStyles(root);
  assert.ok(css.indexOf('.app-shell')<css.indexOf('.definition-actions'));
  assert.ok(css.indexOf('.row-actions {')<css.indexOf('.definition-actions {'));
  assert.doesNotMatch(css,/@import\b/);
});
