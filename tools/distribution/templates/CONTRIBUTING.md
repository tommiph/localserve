# Developing Localserve

Write documentation, source comments and change descriptions for users and
contributors. Describe current behavior, requirements and technical contracts.
Keep private conversations, planning notes, approval records and session
summaries out of repository content and publication messages.

## Start a project

Clone the complete repository into a writable folder. Read AGENTS.md before
asking an AI tool to modify it. No cloud account or AI product is needed to run
Localserve. The bundled runtime runs source directly; normal server development
requires no frontend build step or npm dependency install.

```powershell
.\runtime\node.exe tools/initialize-settings.mjs
.\runtime\node.exe tools/testing/run.mjs
.\runtime\node.exe server.mjs
```

Use Ctrl+C to stop a console instance. Do not also start its tray server. Tests
use temporary roots under tests/.tmp and need no real credentials/devices. These
tests cover Tasks, Event values, reruns, quiet hours, Controls, Simulator, Recipes,
displays and packaging contracts, not every provider/device behavior. The list
in tools/testing/public-tests.mjs also drives clean-release verification.
Add focused isolated tests alongside new capabilities.
Running a checkout creates private files; keep them out of commits.

For verified source and matching preview downloads, use the root `Publish.ps1`
command described in [Publishing](tools/distribution/PUBLISHING.md).

## Code map

The Windows checks workflow runs on pushes and pull requests using a pinned
checkout action and read-only repository permissions. It runs the public tests,
builds clean packages and exercises installation in its own disposable instance.
It does not publish releases or configure devices. The hosted Windows runner
provides independent environment evidence; it does not replace testing on a
consumer PC, physical Android phone or compatible TV.

For each completed code change, advance the affected server/plugin version with
`tools/version.mjs`, then run its `--check`. See [VERSIONING.md](VERSIONING.md).
Keep the metadata, public version entry and updated guide in the same commit.

| Path | Responsibility |
| --- | --- |
| `server.mjs` | Startup, HTTP routing, boundaries and shutdown |
| `server/plugins.mjs`, `plugin-schema.mjs` | Discovery, declarations, schemas and plugin lifecycle |
| `server/plugin-runtime.mjs`, `plugin-worker.mjs` | Supervised trusted adapter execution and context |
| `server/storage.mjs` | Atomic JSON persistence and Activity |
| `server/tasks.mjs`, `rules.mjs`, `task-rule-groups.mjs` | Task validation, execution, scheduling, AND/OR grouping and Event comparisons |
| `server/controls.mjs` | Controls/scenes, capability/revision checks and command admission |
| `server/cards.mjs`, `card-templates.mjs` | Public fields and sandboxed design assets |
| `server/vistas.mjs`, `universe.mjs` | Revisioned displays and scoped public data |
| `server/network.mjs`, `sensor-ingress.mjs` | LAN and native sensor-report boundaries |
| `server/phone-events.mjs` | Phone Event fields, validation and per-source keys |
| `web/` | Shared browser administrator, editors and modern renderers |
| `assets/vista-legacy*`, `assets/universe/` | Older-TV rendering, local scenes and flight timing |
| `plugins/<id>/declaration.json` | Plugin settings/actions/events/Card contracts |
| `plugins/<id>/server/` | Adapter and protocol logic |
| `plugins/<id>/cards/`, `vendor/` | Designs, local dependencies and licenses |
| `plugins/sensors/android/` | Java sender, tests, client libraries and APK builder |
| `tray/` | Windows notification-area application and detached host |
| `tv-tizen/app/` | Optional unsigned TV web launcher |

## Add a plugin

Use plugins/simulator/declaration.json and server/index.mjs as the minimal working
example. Make a folder with a unique ID matching its declaration. Never copy data/.
Adapt settings, validation, actions, Events and typed public Card fields together.
Validate with validateDeclaration from server/plugins.mjs; inspect existing
schemas and named-source implementations before adding advanced features.

Runtime API v1 adapters export methods such as validateConfiguration, start, stop
and execute. Simulator demonstrates context.signal, readState/saveState, log,
wait and emit. Supervision is not a security sandbox. Keep adapter paths within
the package, bound reads/deadlines/state/tables and reuse the administrator,
Task editor and Card renderer. Do not build parallel per-plugin editors.

Use declared Controls for interactive widgets; keep device actions out of Card
HTML. Baseline startup/reconnect/source changes and commit Event deduplication
before dispatch. New settings need clean defaults and accurate help. New plugins
start disabled with no imported targets, saved sources or credentials.

## Displays

Ready-made designs declare local assets/typed slots in cardTemplates. Reuse public
field selection and sandboxed frames. Add a literal older-Tizen fallback in
assets/vista-legacy-ready.css for both themes and Vista font scaling. Unknowns
stay No data. A DOM fixture is not a physical compatibility test.

Universe scenery is in assets/universe/worlds.js, coordinated by universe.js and
flight.js. Preserve its clear corridor, batched/recycled geometry, resource bounds
and disposal. Fixed world links share saved Cards/journey/revision checks.

## Native builds

For an isolated administrator preview and the responsive interaction checklist,
see [UI testing](UI-UX-TESTING.md). The preview uses synthetic adapters and fresh
disposable content rather than the configured installation.

Shared stylesheet sources are under web/styles in explicit cascade order.
Run runtime/node.exe tools/styles/build.mjs after editing, then use --check.
Commit the matching generated styles.css. The browser still loads a single file;
literal legacy TV styles and plugin-owned Card styles remain separate.

Keep .gitattributes when cloning or redistributing source. It disables Git's
line-ending conversion so bundled dependency hashes and generated stylesheet
bytes remain identical on Windows and other checkout platforms.

tray/build.ps1 uses Windows .NET Framework and local icons. Native plugin folders
retain their C# source/build scripts. Review scripts before running them.

For Android, read plugins/sensors/android/README.md and tools/android-build/README.md.
Prepare pinned local tools, then run the builder. A clean build makes your own
private signing identity; store it securely for future updates, never in Git.
An APK signed by another key cannot update an installed app in place. Activity
transitions need installed Google Play services.

The Tizen README explains your own SDK, author/distributor certificates, target
and display URL. SDK workspaces and signing keys are not server dependencies.

## Share changes

Review git diff --cached and git ls-files. Ignore rules do not protect tracked or
force-added files. Exclude all private data/config/log/backup/signing/tool-cache
directories and personal display pages. Never archive a configured folder.
Retain dependency licenses/provenance, update user guides/comments and report
only checks actually run. Provider/device tests are separate explicit actions.

## Client and regression verification

The shared tools/testing/public-tests.mjs catalogue includes all isolated test files and runs serially in local, clean-source and hosted checks. Git is required for the temporary-repository release tests. Never copy installed settings into fixtures. Android build receipts bind prebuilt APK bytes to their first-party inputs; rebuild affected clients before release preparation. These checks do not require a physical phone, headset or TV and do not prove physical-device compatibility.
