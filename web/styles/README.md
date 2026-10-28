# Shared stylesheet sources

The administrator and modern shared viewers load `styles.css` at the project
root. Its readable sources are assembled in the exact order in `order.json`.
Responsive and later overrides deliberately follow their base components.

After editing a source file, run:

```powershell
.\runtime\node.exe tools/styles/build.mjs
.\runtime\node.exe tools/styles/build.mjs --check
```

Keep the generated root file with source changes. The build only concatenates;
it does not minify, reorder, prefix or remove rules. Browsers still fetch one
stylesheet. An ordered filename describes a section's dominant responsibility,
not a separate cascade scope. Moving rules between files can change precedence.

Literal legacy TV styles under `assets/vista-legacy*.css`, plugin ready-made
Card designs and the standalone Controller stylesheet have their own owners.
They are not inputs to this bundle.

`05-form-controls.css` supplies low-specificity themed defaults for administrator
and Controls inputs outside field wrappers. Native checkboxes, radios and sliders
retain their behavior; checkbox-backed switches opt out of native appearance.
Search containers own their borders and focus rings, so their inner inputs stay
transparent. Keep these deliberate variants when adding or restyling a form.

Use the shared rhythm tokens for administrator surfaces: 20px between panels
and around panel content, 12px between related content blocks, and 10px between
actions. Form controls share a 6px radius and 40px minimum height; compact
layouts enlarge action targets to 44px. Keep headings and action groups flexible
so long labels and larger text can wrap without overflowing a panel.

Ordinary panel prose, headings, tables and actions use the shared block-flow
spacing rule. A layout that owns a flex/grid gap, such as a Controls hub tile or
lighting diagnostics, is excluded from that rule to avoid doubled spacing.
Field-level help retains its smaller gap. An enabled plugin's separator is part
of the shared Settings layout. Do not add arbitrary margins to individual plugin
declarations to reproduce these styles.

Links styled as buttons use the same geometry as button elements and have no
underline in any state. Ordinary content/source links retain their link styling.
An empty state's large decorative glyph does not change an inline action glyph.
