/** First-party licensing must survive clean source and installer packaging. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('MIT licensing is consistent across source and clean distribution inputs',async()=>{
  const read=file=>fs.readFile(new URL('../'+file,import.meta.url),'utf8');
  const license=await read('LICENSE'),builder=await read('tools/distribution/build.mjs');
  assert.match(license,/MIT License/);
  assert.match(license,/Permission is hereby granted, free of charge/);
  assert.match(license,/THE SOFTWARE IS PROVIDED "AS IS"/);
  assert.equal(JSON.parse(await read('package.json')).license,'MIT');
  assert.match(builder,/\['LICENSE','server\.mjs'/);
  assert.match(builder,/version,license:'MIT'/);
  assert.doesNotMatch(builder,/does not include an open-source license grant/);
  assert.match(await read('tools/distribution/templates/README.md'),/\[MIT License\]\(LICENSE\)/);
});
