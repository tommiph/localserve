# Material Symbols

Localserve uses Google's Material Symbols Outlined for interface glyphs.
The static TrueType font uses optical size 24, weight 400, fill 0 and grade 0;
it needs no variable-font or text-ligature support on older displays. All files
are local. There are no Google Fonts requests when Localserve runs.

`catalog.json` contains 4,382 selectable identifiers, including compatibility
names for existing saved items. Google names use hyphens in Localserve; numeric
names have a `symbol-` prefix. Compatibility names render Material artwork and
do not require changing saved plugin, Card or Controls definitions.

To regenerate the catalogue and CSS after replacing the source assets, run:

```powershell
.\runtime\node.exe tools/icons/build.mjs
```

The builder checks the actual font character map and excludes absent glyphs.
Do not mix a new codepoint list with an unrelated font without regenerating.
`provenance.json` records source URLs, retrieval/version information and SHA-256
hashes. `upstream.codepoints` is the original Google catalogue. The font and
upstream catalogue are licensed under Apache-2.0; preserve `LICENSE.txt`.

Search the visual picker in Plugin settings → Plugin appearance. The picker
shows at most 96 matching choices at once; narrow a search to see more. Cards
and Controls use the same validated catalogue. Decorative icons remain hidden
from screen readers; text and accessible names describe each control.

Compatibility aliases include every previous public glyph ID, including
`arrow-up` and `arrow-down` in saved TV mappings. Removing an old alias can
prevent a saved Controls page from passing startup validation. The asset and
Controls restart tests guard these names without rewriting saved definitions.
