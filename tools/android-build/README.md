# Project-local Android build tools

`prepare.ps1` downloads these pinned upstream packages, checks their published
hashes, and extracts only into this folder:

| Package | Source | Published hash |
| --- | --- | --- |
| Eclipse Temurin JDK 17.0.20.1+1 Windows x64 | adoptium/temurin17-binaries official GitHub release | SHA-256 `e53a79c3c3d86865bd7e787903884331068e71321714ffd44f145785affc7cb0` |
| Android Build Tools 35.0.0 Windows | dl.google.com/android/repository/build-tools_r35_windows.zip | SHA-1 `af059bb67cf7786f45ee0db85e2d24985df1b4b6` |
| Android Platform API 35 revision 2 | dl.google.com/android/repository/platform-35_r02.zip | SHA-1 `0bb560a90a7a2cbd0dd8348224d518b638fe7949` |

Metadata was read from the official Adoptium API and Google's
`https://dl.google.com/android/repository/repository2-1.xml` on 2026-10-16.
Google's archived repository entries publish SHA-1, retained above; all downloads
also use HTTPS. Upstream LICENSE/NOTICE/legal/source-properties files stay intact.

No global install, SDK registration, PATH change, phone/ADB command, emulator,
Tizen SDK modification or existing service access occurs. The Android build uses
the fixed extracted JDK, aapt2, D8, zipalign, keytool and apksigner only.

`private/` holds this installation's APK signing identity/password. Never copy it,
download caches, extracted tools or build workspaces into clean releases. The
server/Android APK has no dependency on these tools after compilation. Clean
distributions include the verified APK, authored app source, and this optional
tool preparation script; each user can download their own local build tools.
