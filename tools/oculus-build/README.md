# Oculus Go native build tools

Run prepare.ps1 to download and verify Google's Windows Android NDK r25c.
Everything stays in this folder. No global installation, PATH change or device
connection is performed. Review the Android NDK terms and retain its notices.

The official archive is android-ndk-r25c-windows.zip, SHA-1
18c4a3cd108916f553b1bedad2672f2c6cd85a10, as listed in
[Android's archived downloads](https://github.com/android/ndk/wiki/Unsupported-Downloads).

The app build also uses tools/android-build for its project-local JDK, Android
Build Tools and platform. Tool caches, extracted compilers and private signing
identities are not distribution inputs. VrApi headers/runtime and their license
are locked under plugins/oculus-go/android/vendor. The normal APK build performs
no downloads and includes no configured server address or credentials.
