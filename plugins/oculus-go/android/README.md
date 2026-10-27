# Sormus Go

Sormus Go lists installed headset applications independently of the PC. Install
an update over the existing package to retain its connection and favorites.

Native Oculus Go app, listed as **# Sormus #**. Package identity: org.localserve.go. It can coexist with Home VR.

## Connect

Install dist/localserve-go.apk using your own authorized headset setup tools. In Sormus's VR library select Connect headset. On the Go open Sormus → Settings, enter the server's LAN IP:port and the six-digit code, then select Connect headset. Codes expire after five minutes, work once and are revoked after five incorrect attempts. The APK contains no configured address or token. Authorization is encrypted with an Android Keystore key; backups are disabled.

## Use

Library provides All, Installed and Updates filters, search, genres and version sorting. Favorites keeps your chosen titles on this headset. Select artwork for details and version selection; Play launches locally installed apps even while the server is offline. The headset inventory is available without a saved PC catalogue or a paired server. Cached PC descriptions and version information enrich matching titles; headset-only apps show their local names and installed builds. Refresh also rescans local apps while disconnected. System utilities and this launcher are not added to the local list. Install, update and uninstall require a connected PC; unavailable actions are disabled. Install opens a review before sending one request. Uninstall requires confirmation and deletes app saves; the PC APK remains. Activity shows the latest server package job and can request cancellation. No package request is retried automatically. Settings also offers recentering.

Point the Go controller and press its trigger. Swipe to change library pages; Back closes menus and reviews. Head movement controls the stationary stereo cockpit; there is no automatic camera movement. The app uses a dark cyan/violet palette, local Material Symbols and Sormus artwork.

The headset must already have wireless ADB enabled and its authorized key configured in the server's Oculus Go plugin for package operations. APKs must be standalone Android 7 / ARM32 compatible. ZIP bundles, split APK sets, OBB deployment and system-package changes are unsupported. The application does not modify the headset launcher, toolbar, firmware or system buttons. Its label is the launch-list convenience; launcher-specific sorting may vary.

## Build

Use the bundled Node runtime to run plugins/oculus-go/android/build.mjs from the project root. Prepare tools/android-build and tools/oculus-build first. Builds use only project-local JDK/Android tools and NDK r25c, hash-locked VrApi headers/runtime, font and licenses. No device, network service, SDK download or global PATH change is performed by a normal build. Preserve the private update-signing identity under the plugin's data/android-signing directory; it is excluded from distributions.

The APK version is declared in app.json and AndroidManifest.xml. It is independent of server/plugin versions. Dist contains the generic APK, checksum and verification receipt. No server address or credential asset may be added to a release APK. VrApi is governed by vendor/licenses/Oculus-Mobile-SDK.txt; Material Symbols retains its Apache license. Build-tool licenses remain with their tool packages.

## Optional device checks

After building the main app, run `plugins/oculus-go/android/test/build.mjs` with the bundled Node runtime. It creates a separately signed instrumentation package in the private build folder; it does not install or run it. Use your own authorized device tools to install the main APK and this test APK. The test targets only `org.localserve.go`, enrolls using an explicitly supplied `server` LAN address and fresh `code`, checks encrypted credential restoration, catalog, favorites, menus and stereo frame submission, and saves screenshots in the app's external files folder. It does not install, remove or launch library titles. Remove `org.localserve.go.tests` afterwards. Keep connection codes and generated screenshots out of public logs and source commits.

## Source verification

The distributable APK records a digest of its manifest, build recipe, first-party Java/native sources, resources/assets and dependency lock. Release preparation rejects changed inputs until the APK is rebuilt with the retained signing identity. This verification does not require connecting a headset.

## Offline library checks

Run `runtime/node.exe plugins/oculus-go/android/test/offline.mjs` from the project
root after preparing the project-local JDK. It checks catalogue merging, empty-PC
and no-cache browsing, favorites, search, filters, version handling and removal
from the local list. These host checks use no network or headset. The optional
instrumentation check also renders the local library with its PC catalogue
removed, without launching or removing any installed application.
