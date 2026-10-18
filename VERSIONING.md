# Software versions

Localserve shows the server version in the administrator sidebar and Overview.
Each plugin shows its independent version beside its name and in Settings.
The server reads its version from `package.json`; plugins read theirs from their
own `declaration.json`. An old version in saved preferences cannot override the
installed server version. Restart Localserve after installing changed source,
then reload the administrator.

Versions use **major.minor.patch**:

- **Patch**: a fix, styling adjustment or other compatible maintenance change.
- **Minor**: a new feature that preserves existing settings and contracts.
- **Major**: an incompatible change requiring migration or changed integration.

Before version 1.0, breaking changes still use the major increment; do not hide
an incompatible change in a patch or minor release. Start a new plugin at 1.0.0.
Server and plugin versions are independent of saved-definition revisions,
declaration schema/API versions, asset cache versions, APK/widget versions and
GitHub release tags. Change those identifiers only when their own contracts
require it.

## Record a source change

Advance each affected component once per completed, coherent change. A change
to shared server/administrator code advances the server. A change to a plugin's
own behavior, UI or bundled design advances that plugin. If both change, advance
both. Routine user settings, readings, Tasks and logs do not advance software
versions. Documentation alone needs no increment unless its software changes.

Use the bundled runtime from the project root:

```powershell
.\runtime\node.exe tools/version.mjs server patch "Describe the visible fix"
.\runtime\node.exe tools/version.mjs recipes minor "Describe the new capability"
.\runtime\node.exe tools/version.mjs --check
```

Replace `recipes` with the installed plugin's declaration ID. The command changes
the component metadata and appends a public, dated entry to
`VERSION-HISTORY.json`. Keep summaries short and free of private settings, names,
addresses, keys and device identifiers. The baseline records the versions where
tracking starts; it does not guess earlier changes.

For a new plugin with its declaration version already set:

```powershell
.\runtime\node.exe tools/version.mjs my-plugin register "Add the new plugin"
```

Keep metadata and history in the same source update. `--check` detects missing
registrations and mismatches; it does not infer whether changed code deserves a
version increment. Contributors and AI coding tools must make that decision for
every source change. Never edit upstream dependency versions to version Localserve.
