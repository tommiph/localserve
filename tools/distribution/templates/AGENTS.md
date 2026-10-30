# Instructions for AI coding tools

Read README.md, INSTALL.md and CONTRIBUTING.md before editing. These instructions
apply to this repository, including plugins, Android and optional TV source.

- Testing workflow: use tools/testing/run.mjs --focused <tests...> while
  developing, including affected callers/shared contracts. Before local
  activation use --activate <tests...> to add core safety checks once. Review
  the files with --list. Run --full once for the final batch before publication;
  CI and clean-source/installer gates remain full. Broader shared execution,
  security or persistence changes may justify full testing earlier. Rerun passed
  checks only after relevant changes, failures or new concerns. Review duplicate
  coverage when maintaining an area; retain distinct failure/privacy/data-loss/
  cancellation/no-replay cases. Report actual scope; focused/core is not full.

- Keep deployed interface files compatible with the running backend. New script
  routes may need a cooperative server restart before updated HTML uses them.
  Optional interface features must tolerate missing scripts/capabilities without
  breaking administration. Check actual served assets and browser startup as
  well as fresh disposable installations; never treat retained data alone as
  proof that a running interface remains usable.

- Demo setup is explicit, authenticated and empty-install-only. Preserve the
  Simulator-only action allowlist, authored Task/Card/Vista identities, no start
  rules, no shared-display change and no automatic execution. Journal before
  writes, serialize setup against administrator mutations, retain edited data and
  drain setup before shutdown releases the folder lock. Invalid metadata disables
  only demo setup. Test using disposable roots, never a configured installation.

- Windows Setup is per-user and accepts only a verified clean payload. Preserve
  settings, maintenance/instance guards, cooperative shutdown and default data
  retention; never force processes or configure devices/firewall during setup.
  Run installer checks with its separate test identity. Keep compiler caches,
  build receipts and signing keys out of source. README demo links derive from
  project-info.json. Native binary versions follow package.json.

- Advance server/plugin software versions for every completed source change.
  Use tools/version.mjs and VERSIONING.md: patch for fixes/UI, minor for compatible
  features, major for breaking changes. Advance only affected components, append
  a public summary and run --check. Keep software versions separate from stored
  revisions, schema/API numbers, cache versions and APK/widget identities.

- Implement changes in the real application. Use readable names and comments
  explaining contracts, state transitions and non-obvious limits. Update the
  relevant user guide in the same change; do not add conversation history.
- Use project-relative paths and bundled dependencies/assets. Do not introduce
  a CDN, global installation or another service dependency silently. Retain all
  upstream licenses and update provenance when changing a library.
- Keep live config/data, secrets, saved Tasks/Vistas/Cards/Controls/scenes,
  logs, captures and signing keys out of Git. Never force-add ignored files,
  print credentials or publish a configured installation.
- Preserve user data, stable IDs and revisions. Default missing fields without
  erasing old values. Copies get fresh IDs and start disabled where required.
  Do not reset settings or saved content to simplify an upgrade.
- Plugins are discovered from local declarations. Use Simulator as the adapter
  model and the existing shared Settings/Events/Cards/Controls/Task UI. Consult
  server/plugins.mjs, plugin-schema.mjs, plugin-worker.mjs and validators before
  adding capabilities; do not invent an undocumented API.
- Keep actual readings distinct from targets, missing data and retained offline
  values. Bound requests/state, respect cancellation and serialize effects.
  Commit Event/occurrence claims before dispatch. No automatic device retries,
  catch-up or replay of uncertain effects. Preserve provider rate limits.
- Preserve exact Host/Origin, administrator token, scoped Controls claims, private
  file restrictions and public-display projection. Workers execute trusted code,
  not sandboxed plugins. Preserve optional administrator sign-in/session checks;
  leave sign-in off until configured. LAN write tokens alone are not login. Do not
  expose Sormus to the internet as an implementation shortcut.
- Cards/Vistas/Universe remain read-only. Never expose settings, secrets, arbitrary
  URLs/RPC or private data in display APIs. Keep iframe/CSP isolation.
- Older-TV paths use local Three.js r97, ES5/XHR/WebGL1 and literal/prefixed CSS.
  Keep Low detail bounded, resource disposal and hidden/disconnected/reduced-motion
  behavior. Reuse shared renderers. Test both display paths when changing Cards.
- Games preferences are revisioned in data/games.json. Keep procedural maze
  queries and nearby geometry bounded as levels grow; preserve collision,
  active-time scoring, remote repeat handling, pause and disposal. Public game
  pages grant no device actions. TV launch accepts only the fixed bound-LAN game
  URL through Samsung's existing queue. Ship game code and music/README.md only;
  never bundle installed game preferences, user tracks or browser scores.
- Android sources default off and need real platform access. Preserve explicit
  Start/Stop, install identity, latest-only reports and per-device timestamp claims.
  Do not add boot startup, Accessibility, permission bypass, history or commands.
- Run focused tests with disposable roots, disabled plugins and mocks. Never test
  against configured user data. Live devices, ADB, TV installs/launches, startup/
  firewall changes and provider requests require explicit task authorization.
  Editing code alone does not authorize those effects. Do not stop other services.
- Report tests actually performed and meaningful limitations. Geometry/signature
  checks do not prove a browser, TV or phone works.

Use a separate checkout for experiments. Ask about missing behavior requirements;
proceed with ordinary reversible implementation choices.
