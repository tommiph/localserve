# Interface verification

Use explicit selections during development, combining the changed feature with
its affected callers and shared contracts:

```powershell
.\runtime\node.exe tools/testing/run.mjs --focused gateway-scenes tradfri
.\runtime\node.exe tools/testing/run.mjs --activate gateway-scenes tradfri
.\runtime\node.exe tools/testing/run.mjs --full
```

`--focused` runs only the named public test files. `--activate` adds the core
defaults, HTTP boundary, Controls admission/persistence, Task Event validation
and worker-recovery checks, without repeating files. `--core` runs those checks
alone. Short names, `tests/name.test.mjs` and Windows-relative paths are accepted.
Use `--list` with any profile to review its selection without executing it.
Empty focused selections, unknown names and arbitrary paths are rejected.
Register new isolated test files in `tools/testing/public-tests.mjs` before
selecting them through these commands.

Run focused checks while iterating and core plus focused checks before local
activation. After a pass, rerun only when code changes, failures or new concerns
justify it. Run the complete suite once for the final feature batch before
publication; CI and clean-source/installer verification retain their full gates.
The no-argument command and `npm test` also run the full suite for compatibility.
Broad changes to shared execution, security or persistence may justify a full
run earlier. A selection is a reviewed scope, not an automatic dependency proof.

Include display and legacy-viewer checks when changing Card projection/rendering,
Task consumers when changing Event contracts, and shared Controls/Task scene
checks when changing lighting behavior. Review overlap while maintaining an
area: merge redundant fixtures/assertions where they protect the same behavior,
but retain distinct failure, cancellation, privacy and no-replay cases. Do not
add tests that merely restate a low-impact implementation. Report the profile,
selected files and results; focused/core passes are not full-suite passes.

The tests cover retained administrator DOM, Event search, receipt labels,
template formatting, camera inspection and definition/revision boundaries.

For browser review, run:

```powershell
.\runtime\node.exe tools/testing/ui-preview.mjs
```

Open the printed origin. The preview copies source assets into a new folder
under `tests/.tmp`; it never loads installed configuration or real device/provider
modules. Simulator is the only executable sample action. Camera enumeration
returns synthetic names. Other adapters support only a synthetic refresh.
Stop with Ctrl+C or create the printed `.stop` file. Only its disposable folder
is removed. Keep preview files out of distributions and commits.

The preview includes every installed declaration with synthetic adapters and fresh
settings. Its `/assets/form-controls-dark.html` and `/assets/form-controls-light.html`
pages provide inert samples of every input family, including controls outside
field wrappers. Check normal, disabled, readonly, checked, focus and narrow layouts.
Embedded search fields deliberately use the styled search container's border.
Native checkboxes/radios, pickers and sliders retain their keyboard semantics.
The samples also include a heading/prose/help/action panel and a Controls hub
tile. Check their effective gaps: ordinary content uses 12px, while the hub's own
layout gap is applied once. Review both themes and enlarged text. Source links
remain links; an action styled as a button must not acquire an underline.

## Browser matrix

Check effective viewport dimensions, since browser zoom can change them.

| Surface | Sizes and state | Required observations |
| --- | --- | --- |
| Administrator | 320/390px, 1280×720, short landscape; 100/130% text; light/dark | No page overflow; Settings/Variables reachable; footer and Save/Cancel visible |
| Services | Expand Details, refresh and wait for polling | Disclosure, text selection and scrolling retained |
| Tasks | Search an Event while one is selected; numeric zero/false; missing source | Exact selection retained; OR/rearming labels; no false draft changes |
| Actions | Replace, cancel, reorder, copy disabled step | Stable IDs/order/enabled state; no execution during editing |
| Definition rows | Tasks, Vistas, Cards, Controls and plugin lists at 320px/130% | Named Edit/Copy/Delete controls wrap; one enablement label; source scope preserved |
| Phone handoff | Bound LAN address and localhost-only fixture | QR has black modules and white quiet zone in either theme; text/copy fallback remains |
| Versions | Settings disclosure; changed server version; missing package metadata | Original connection version retained; no installed-TV claim; reload waits for pending saves |
| Advanced fields | Blank a required field, collapse and save | Invalid section opens and receives focus; failed save retains draft |
| Camera setup | Plugin disabled; enumerate, choose, cancel/stale revision | No capture/enablement/state write during enumeration; explicit selection only |
| Vistas | Duplicate names; map selection; own URL vs shared display | Unique destinations; selection unsaved; preview never publishes |
| Cards | Narrow/tall/short regions, long/missing/retained readings | No overlapping gauges; essential source status visible; scrolling warning honest |
| Legacy viewer | `/vistas/status?legacy=1` | Literal fallback styles, stable Card frames, readable zero/missing states |
| Accessibility | Keyboard Tab/Shift+Tab/Escape, reduced motion | Focus retained/contained; controls named; no forced animation |

The Vista fit warning describes visible ready-made Cards in the current browser
preview. Collections may show different members over time. It is not a size
guarantee or a physical-TV qualification. Check each design at its intended size.

Screenshots and device results require separate evidence. A passed DOM/unit
check alone does not verify contrast, visual polish, Android behavior or Tizen
firmware. Never run browser review against installed device settings or enable
automatic Tasks to make a test convenient.

Run `runtime/node.exe tests/serve-admin-refresh.mjs` for the isolated DOM checks.
Wait for the settled-frame checks to finish: scrolling ancestors, inserted and
removed rows, post-update hydration and zero offsets are measured after browser
layout. Both vertical and horizontal positions must remain unchanged.
