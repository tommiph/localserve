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
