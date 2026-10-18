# Android runtime dependencies

`lock.json` pins Google Play services Location 21.4.0 and its 33 resolved runtime
artifacts. All are local; APK builds do not contact Maven or install Gradle.
`prepare-vendor.mjs` reads official Google Maven / Maven Central POMs, verifies
each upstream SHA-1 sidecar, and records SHA-256 pins, origin URLs and declared
licenses. POMs and original AAR/JARs remain unmodified. Only locked versions are
compiled/packaged; earlier downloaded resolution candidates are not used.

AndroidX, Kotlin, coroutines and supporting artifacts declare Apache 2.0 in their
POMs. Google Play services declares the Android SDK license. Official copies are
under `licenses/`. Google AARs additionally contain their third-party license
texts/metadata. The builder retains these in APK assets with an in-app viewer.
Build tools/signing material are outside this folder and never shipped in the APK.

The Google client SDK is bundled; the installed **Google Play services Android
component** is a platform requirement for the optional activity source. The app
does not install/update it, request an account, silently resolve failures, or
substitute guessed activities. Other sources work without it. Android and Google
provider implementations follow the phone's settings; Localserve adds no cloud
relay, analytics integration or radio/room analysis.
