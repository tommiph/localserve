# Windows setup executable

Localserve Setup installs for the current Windows user into a writable folder.
It includes the Windows runtime and application dependencies, creates Start menu
shortcuts and initializes only missing settings. No Node/npm installation or
administrator elevation is required for the core app. Microsoft .NET Framework
4.8 or later and x64 Windows 10/11 are required; Setup checks these prerequisites.

Choose **Open Localserve** at the end to start the tray/server and open the
administrator at its actual ready address. Windows sign-in startup is an
unchecked option. LAN/firewall access, plugin credentials and Android/TV apps
are separate choices; Setup never configures devices or enables plugins.

Run Setup again to update an installer-owned folder. It reserves that instance,
asks its own server to stop normally and closes its tray before replacing code.
No unrelated process is stopped and no command is force-replayed. Unknown
nonempty folders, directory links and ambiguous running instances are rejected.
Existing settings, saved content and credentials are preserved. An upgrade may
stop active Tasks through normal cancellation; run it when work is idle.

Uninstall through Windows Installed apps or the Start menu entry. Settings/data
are retained by default; interactive uninstall offers explicit private-data
removal. Silent uninstall retains data unless `/DELETEPRIVATE=1` is supplied.
Custom files outside the listed private stores are retained. Keep backups of
your own credentials and content before removing them.

Unsigned preview builds may produce Windows security prompts. No signing
identity is bundled. A compiler signature does not sign Localserve; inspect the
setup's signature and checksum yourself. A clean Windows VM/download-reputation
test remains a separate release qualification, not a property inferred from
successful local tests.

## Build from clean source

Prepare the official pinned compiler locally:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/installer/prepare-compiler.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tray/build.ps1 -OutputName LocalserveTray.next.exe
.\runtime\node.exe tools/distribution/build.mjs
.\runtime\node.exe tools/distribution/verify.mjs dist/<clean-release>.zip
.\runtime\node.exe tools/installer/build.mjs dist/<clean-release>.zip
```

The compiler is Inno Setup 7.1.0, installed in portable mode under this project.
Its download is checked against compiler-lock.json and its official publisher
signature. It is not required on end users' PCs and is excluded from releases.
See its retained license and [official licensing information](https://jrsoftware.org/isorder.php).

The setup builder accepts only a verified clean archive, checks payload hashes,
omits private settings seeds and compiles an explicit file list. It writes the
setup executable, checksum and build receipt under dist/. Compiler logs remain
under work/. Never build a setup payload by archiving a configured installation.

`verify.mjs <setup.exe> <clean-release.zip>` builds a separate test identity and
installs it into a disposable folder, tests upgrade/settings retention and both
uninstall choices, then removes the owned instance. It uses temporary current-user
uninstall/shortcut entries, never Windows startup/firewall rules or devices.

Update the public `project-info.json` field `demoVideoUrl` to change the README
demo link. The clean distribution builder regenerates README.md from that value.
