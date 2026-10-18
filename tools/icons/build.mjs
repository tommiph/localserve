/** Build the local Material Symbols catalogue/CSS without a network request.
 * Only codepoints actually present in the bundled static TTF are offered.
 * Compatibility names preserve saved definitions; they render Material artwork.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const folder = path.join(root, 'assets/material-symbols');
const font = await fs.readFile(path.join(folder, 'material-symbols-outlined.ttf'));
const tables = {};
for (let i = 0; i < font.readUInt16BE(4); i++) {
  const at = 12 + i * 16;
  tables[font.toString('ascii', at, at + 4)] = font.readUInt32BE(at + 8);
}
if (tables.fvar !== undefined) throw Error('Use a static font for older Tizen.');
const cmap = tables.cmap, supported = new Set();
if (cmap === undefined) throw Error('Font has no character map.');
for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
  const offset = cmap + font.readUInt32BE(cmap + 8 + i * 8);
  const format = font.readUInt16BE(offset);
  if (format === 12) {
    for (let g = 0; g < font.readUInt32BE(offset + 12); g++) {
      const at = offset + 16 + g * 12, start = font.readUInt32BE(at), end = font.readUInt32BE(at + 4), glyph = font.readUInt32BE(at + 8);
      for (let code = start; code <= end; code++) if (glyph + code - start) supported.add(code);
    }
  } else if (format === 4) {
    const count = font.readUInt16BE(offset + 6) / 2;
    const ends = offset + 14, starts = ends + count * 2 + 2, deltas = starts + count * 2, ranges = deltas + count * 2;
    for (let s = 0; s < count; s++) {
      const start = font.readUInt16BE(starts + s * 2), end = font.readUInt16BE(ends + s * 2);
      const delta = font.readInt16BE(deltas + s * 2), range = font.readUInt16BE(ranges + s * 2);
      for (let code = start; code <= end && code < 65535; code++) {
        const raw = range ? font.readUInt16BE(ranges + s * 2 + range + (code - start) * 2) : code;
        if (range ? raw && ((raw + delta) & 65535) : ((raw + delta) & 65535)) supported.add(code);
      }
    }
  }
}
const glyphs = {};
const upstream = await fs.readFile(path.join(folder, 'upstream.codepoints'), 'utf8');
for (const line of upstream.trim().split(/\r?\n/)) {
  const [name, hex] = line.split(/\s+/), code = parseInt(hex, 16);
  if (!supported.has(code)) continue;
  let id = name.replaceAll('_', '-');
  if (!/^[a-z]/.test(id)) id = 'symbol-' + id;
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw Error('Invalid glyph identifier.');
  glyphs[id] = {name, codepoint: hex.toLowerCase()};
}
// Compatibility IDs and interface symbols resolve to local Material artwork.
// Saved settings and definitions retain their glyph identities.
const aliases = {
  plug:'power', 'puzzle-piece':'extension', flask:'science', robot:'smart-toy', microchip:'memory', gear:'settings', gears:'manufacturing',
  cubes:'deployed-code', cube:'deployed-code', lightbulb:'lightbulb', sun:'light-mode', moon:'dark-mode', house:'home', server:'dns',
  'network-wired':'lan', 'satellite-dish':'satellite-alt', 'tower-broadcast':'cell-tower', sliders:'tune', 'toggle-on':'toggle-on',
  clock:'schedule', 'hourglass-half':'hourglass', calendar:'calendar-month', bell:'notifications', comment:'chat-bubble',
  'clipboard-list':'assignment', 'list-check':'checklist', 'chart-line':'monitoring', gauge:'speed', heart:'favorite', 'shield-halved':'shield', eye:'visibility',
  'circle-check':'check-circle', plane:'flight', 'triangle-exclamation':'warning', 'wand-magic-sparkles':'auto-awesome', gamepad:'sports-esports',
  display:'tv', 'vr-cardboard':'head-mounted-device', 'power-off':'power-settings-new', 'right-left':'swap-horiz',
  // Saved remote mappings use these names; rejecting their icons quarantines
  // the whole Controls store during startup, even though its actions are valid.
  'arrow-up':'arrow-upward', 'arrow-down':'arrow-downward',
  'arrow-rotate-left':'undo', bars:'menu', xmark:'close', 'volume-high':'volume-up', 'volume-low':'volume-down', 'volume-xmark':'volume-off',
  plus:'add', minus:'remove', 'circle-info':'info', play:'play-arrow', 'temperature-half':'device-thermostat',
  'table-cells-large':'dashboard', 'table-cells':'grid-view', meteor:'rocket-launch', 'clock-rotate-left':'history',
  'magnifying-glass':'search', 'arrow-up-right-from-square':'open-in-new', 'arrows-left-right':'swap-horiz', 'arrows-rotate':'sync',
  'arrows-up-down':'swap-vert', battery:'battery-full', 'circle-half-stroke':'contrast', columns:'view-column', copy:'content-copy',
  expand:'fullscreen', 'grip-lines':'drag-handle', 'grip-lines-vertical':'drag-indicator', hashtag:'tag', header:'title',
  'hourglass-start':'hourglass-top', 'id-card':'badge', 'layer-group':'layers', 'list-ol':'format-list-numbered',
  'location-dot':'location-on', 'location':'location-on', 'paper-plane':'send', pen:'edit', random:'shuffle', rotate:'refresh',
  'rotate-left':'rotate-left', running:'directions-run', scroll:'description', section:'view-agenda', 'table-columns':'view-column',
  'tasks':'checklist', television:'tv', 'text-height':'format-size', th:'grid-view', 'trash-can':'delete', unlock:'lock-open',
};
for (const [id, target] of Object.entries(aliases)) {
  if (!glyphs[target]) throw Error('Missing Material mapping: ' + id + ' → ' + target);
  if (id !== target) glyphs[id] = {...glyphs[target], aliasOf: target};
}
const ordered = Object.fromEntries(Object.entries(glyphs).sort(([a], [b]) => a.localeCompare(b)));
await fs.writeFile(path.join(folder, 'catalog.json'), JSON.stringify(ordered, null, 2) + '\n');
const css = `/* Generated by tools/icons/build.mjs. Local static Google Material Symbols, Apache-2.0. */
@font-face {
  font-family: 'Localserve Material Symbols';
  src: url('material-symbols-outlined.ttf') format('truetype');
  font-style: normal;
  font-weight: 400;
  font-display: block;
}
.material-symbol {
  font-family: 'Localserve Material Symbols';
  font-weight: 400;
  font-style: normal;
  font-size: 1.2em;
  line-height: 1;
  display: inline-block;
  width: 1em;
  text-align: center;
  vertical-align: -.12em;
  text-transform: none;
  -webkit-font-smoothing: antialiased;
}
` + Object.entries(ordered).map(([id, item]) => `.ms-${id}::before { content: "\\${item.codepoint}"; }`).join('\n') + '\n';
await fs.writeFile(path.join(folder, 'material-symbols.css'), css);
console.log(JSON.stringify({glyphs:Object.keys(ordered).length, staticFont:true, bytes:font.length}));

