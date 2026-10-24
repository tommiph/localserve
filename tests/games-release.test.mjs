/** Offline distribution allowlist checks. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('clean-release copying includes game code and excludes user music and preferences',async()=>{
  const builder=await fs.readFile(new URL('../tools/distribution/build.mjs',import.meta.url),'utf8');
  assert.match(builder,/\['maze-core\.js','maze\.js','maze\.css','music\.js','music\/README\.md'\]/);
  assert.doesNotMatch(builder,/copyTree\(['"]assets\/games/);
  assert.match(builder,/data\/games\.json/);
  const files=['web/maze.html','web/games-ui.js','assets/games/maze.js','assets/games/maze-core.js','assets/games/music.js','assets/games/maze.css','GAMES.md'];
  for(const file of files)assert.ok((await fs.stat(new URL('../'+file,import.meta.url))).isFile());
});
