# Scenes for Android

Scenes opens your Localserve lighting scenes and published Task shortcuts directly.
It is a separate app named **Scenes**, with a black Localserve launcher logo on white.
Its splash screen uses a white logo on black, including Android's launch window,
and stays covered until the selected interface theme has a rendered frame.
Installing it does not replace Localserve or change sensor reporting.

## Install and connect

1. Start Localserve and connect the phone to the same local network.
2. Open `/scenes` on the server and choose **Get Scenes for Android**, or download
   `/downloads/scenes.apk`. Allow installation from that browser when Android asks.
3. Open **Scenes** and choose **Server connection**. Enter the server's private
   LAN IP address and port, such as `http://192.168.1.10:7041`. Do not add `/scenes`.
4. Tap **Connect**. Later launches open Scenes directly using the saved address.

Use the gear beside the appearance button to change the connection. If the server
cannot be reached, the app offers **Try again** and **Server connection**. The
connection dialog also shows the installed app version. Back closes the app.
The server interface requires Localserve 0.35.0 or later. Android 8.0 or later and
an up-to-date Android System WebView are required.

Lighting scenes come from enabled lighting Controls pages. Task shortcuts are
published in **Administration → Phone home**. Tap an item once and wait for its
receipt. A completed receipt confirms execution, not a new physical light-state
reading. A lost reply never causes an automatic resend. See
[Scenes & Tasks](../../SCENE-SELECTOR.md) for behavior and configuration.

## Connection and privacy

The app stores its own server address and browser appearance preference. It
requests Internet access only: no sensors, location, notifications, background
service or automatic startup. The interface is served by Localserve; an active
LAN connection is required. There is no offline command queue or cloud account.
Only the configured private IPv4 HTTP origin and fixed Scenes routes are
admitted. Administrator pages, arbitrary URLs, file access, external navigation
and JavaScript-to-native bridges are blocked. Changing the address reloads the
interface; it never repeats a command or moves settings from another app.

## Build

From the Localserve project root in Windows PowerShell:

```powershell
& tools/android-build/prepare.ps1
& tools/build-scenes-icons.ps1
.\runtime\node.exe apps/scenes/build.mjs
```

Read the tool license/requirements in
[Android build tools](../../tools/android-build/README.md) before preparation.
The build uses project-local Android/Java tools, compiles Java policy tests,
verifies the DEX dependency graph and APK signature, and writes
`apps/scenes/dist/scenes.apk`, its SHA-256 file and `verification.json`.
There are no third-party runtime libraries in this client.

The first build creates a persistent signing key and password under
`tools/android-build/private/`. Keep them private and back them up securely to
sign compatible updates. Never distribute them. Build workspaces under
`apps/scenes/build/` are not release inputs. The app identity is
`local.localserve.scenes`; increment `AndroidManifest.xml` version name/code
when updating the native app. Server UI changes have their own server version.

The APK verification includes a digest of its first-party build inputs. Release preparation rejects an APK whose source or resources changed without rebuilding. Native updates retain the package and signing identity; install over the existing app to retain connection and appearance settings.
