# Controller phone reporting

Use [Controller](../../../CONTROLLER.md) for Lights, Tasks, full Remotes and Cards.
Open **Settings → Phone information → Choose what to share** for the native sources below. The server address
and approved relay details come from Controller’s single connection screen; no
profile import or separate transport selector is required. Reporting remains
explicitly started and stopped, with Android permissions for each selected source.

## Phone events

Phone events default off. Stop streaming, select the sources, grant Android
access, then Start.

Available sources: battery/charging (percentage, plugged code and reported °C),
screen/lock state, unlock, network transport/validated internet/metering,
Bluetooth ACL connections (not scans), audio-device connections, mobile call
state, notifications, media metadata/playback, foreground app, NFC tag and manual
button. Bluetooth and call state request runtime permissions only when selected.
Notification/media require Android Notification access; foreground app requires
Usage access and checks every five seconds. Missing access prevents that source
from reporting; it does not grant itself access. Restart after access changes.

Notifications forward only the apps selected with **Choose notification apps**
(up to twenty). No selected apps means no notifications are shared. Titles/text are bounded to 500 characters, with no artwork,
actions or initial notification dump. Android may redact protected content.
Media is limited to eight published sessions; each report holds only the latest
callback per kind. Foreground app uses usage events, not Accessibility.

Manual events can come from the app button, a user-added Sormus Quick Settings
tile, or the Sormus home-screen widget. Select Manual button and keep streaming
running first; these controls never start the streamer or queue a later command.
The name field distinguishes Manual button / Quick Settings / Home screen.
NFC reads tag IDs/technology only while the setup activity is visible and NFC
is enabled. No tag writes, payment access or background tag scanning is added.

At most forty latest callbacks are consumed once per report; failed/offline
reports are not retried or saved. State callbacks deduplicate unchanged values;
discrete unlock/notification/NFC/button callbacks remain distinct occurrences.
The server baselines initial/reconnected snapshots, commits timestamp claims
before dispatch and stores no callback content in plugin state/activity. A
configured Task can capture its public payload normally. Leaving LAN can prevent
delivery of the network-loss event itself in LAN mode. Optional relay mode uses
separate relay-presence Events and never creates a LAN/home-arrival fallback.

## Location, named regions and activities

These sources are opt-in under Phone events. Stop streaming before editing them.

- **Location:** select Location, choose the 5/15/30/60/120-second requested
  interval, then Start from the visible app. Android requests location access;
  approximate access is respected and is not repeatedly escalated. Enable the
  phone's Location setting. The app uses enabled Android GPS/network providers;
  provider availability and update cadence depend on the phone. No last-known
  location is read, and no background-location permission is requested. The
  user-started location foreground service can continue while the app is hidden.
  Permission revocation, source unavailability or Android stopping the service
  leave readings unavailable; they do not invent a position. Restart streaming
  after changing provider settings or permissions. The status area reports which
  source is waiting, unavailable or active.
- **Named regions:** add up to twenty unique named circular regions with latitude,
  longitude and radius (25–100000 metres). New/copy regions start disabled; enable
  the desired entries and select Named region transitions. Each entry supports
  Edit, Copy, Delete and Enabled. Definitions remain private in Android settings;
  only actual transition payloads are sent. No default coordinates, map lookup,
  external map assets or region imports are used.
- A region uses calculated great-circle distance and the fix's reported accuracy.
  Inside requires `distance + accuracy < radius`; outside requires
  `distance - accuracy > radius`. Boundary overlap is uncertain and produces no
  transition. The first confident observation, service restart and observation
  gaps over two minutes establish a baseline. No path between fixes is inferred.
  Disabled regions are not evaluated. This is foreground coordinate-based region
  monitoring, not an Android background geofence registration.
- **Activity transitions:** select the activity source and grant Physical activity
  permission. Google Play services reports Walking, Running, Cycling, In vehicle
  or Still with Enter/Exit. In vehicle does not identify a driver, and these are
  provider classifications, not facts inferred by Sormus from raw sensors.
  Unsupported/missing/outdated services or denied access show an unavailable
  status. The app does not install/update services, resolve failures, request an
  account, infer a replacement classification or retry registration automatically.

Task choices are **Location**, **Region entered**, **Region left**, **Activity
entered**, and **Activity left**, under each device. For a named arrival use Region
entered with Region-name Equals Home; for walking use Activity entered with
Activity Equals Walking. These examples are instructions only; no Tasks are
created. Location payloads contain reported coordinates, accuracy, provider, fix
time/age and mock flag, plus optional reported altitude/speed. Region payloads
contain ID/name, inside/outside and explicitly calculated distance/accuracy.
Activity payloads contain the reported activity and transition. No location track
or callback content is written to plugin state/activity; a user-configured Task
can capture its public payload in normal run history.

Regions retain one latest transition per region, activities one latest transition
per activity, and other sources one latest callback per kind. Thus simultaneous
regions or Still-exit/Walking-enter reports do not overwrite each other. Very
rapid opposite transitions before a report can still merge. Old/duplicate
timestamps, expired fixes, callbacks from a stopped stream and old registration
generations are rejected. Stop removes owned listeners/registrations and revokes
the callback PendingIntent; nothing starts from boot, a callback, tile or widget.
Losing LAN access can prevent an arrival/departure report from reaching Sormus;
there is no offline replay. Optional relay reporting requires its own configured
internet connection. Android/Google providers follow device
settings and may have their own network behavior. No radio/room analysis exists.

Physical permission/UI/provider/background tests require installing and trying the
APK on the phone; these are not confirmed by host tests. Official references:
[foreground location permissions](https://developer.android.com/develop/sensors-and-location/location/permissions),
[activity transitions](https://developer.android.com/develop/sensors-and-location/location/transitions).

## Rebuild on Windows

From the Sormus root:

```powershell
& tools/android-build/prepare.ps1
.\runtime\node.exe plugins/sensors/android/build.mjs
```

Preparation downloads pinned official Google Android platform/build tools and
Eclipse Temurin JDK into `tools/android-build/`, verifies their upstream hashes,
and extracts locally. It does not install globally, change PATH, invoke ADB,
contact a device or change any existing Android/Tizen SDK. Upstream licenses and
notices remain with the extracted tools. Network access is needed only for the
initial missing build-tool downloads.

The builder compiles resources/Java in a fresh project-local workspace, runs the
pure Java server-address and region geometry/transition tests, emits DEX, aligns, signs, verifies, and atomically
publishes `dist/localserve-sensors.apk`. Its hash and certificate verification
are in `dist/verification.json` and `dist/localserve-sensors.apk.sha256`.

`vendor/lock.json` pins all 33 SDK artifacts and origin/hash/license metadata.
Normal builds verify SHA-256 and remain offline. Only an explicit
`.\runtime\node.exe plugins/sensors/android/prepare-vendor.mjs` downloads the
official Maven graph and license snapshots. See [vendor provenance](vendor/README.md).
APK assets and the in-app Third-party licenses viewer retain license notices.
SDK/JDK/signing workspaces remain excluded from distributions; clean source
packages include only the locked Android runtime artifacts, source and licenses.

The generated signing key/password are private under `tools/android-build/private/`.
Keep that identity to sign later updates. They are not pairing credentials and
are never embedded into APKs/downloads/releases. A build on a clean installation
creates its own signing identity; Android will not treat another identity's APK
as an update of an already-installed app. Removing app data changes its device ID.

## Source

- `MainActivity.java`: editable setup, selection and permission requests.
- `SensorCatalog.java`: runtime discovery, stable app-local IDs and unit labels.
- `SensorService.java`: bounded latest-value sampling, foreground notification,
  one serial LAN request, normal fresh-report backoff and explicit cleanup.
- `TravelSources.java`: fresh foreground fixes, accuracy-aware named regions and
  private-generation Google activity callbacks with owned cleanup.
- `RegionRules.java` / `RegionSettings.java`: tested geometry/state rules and
  private editable region definitions.
- `AndroidManifest.xml`: native lifecycle/permissions; exported notification/tile
  services retain Android binding permissions, callback receivers stay private.
- `res/drawable/app_icon.png`: project's white-on-black application logo.
- `test/`: host URI/region and SDK linkage checks; not packaged into the APK.

All app and build paths derive from this project; no configured IP, account,
token, Task, log or other installation data is built into the APK. Raw values
remain in memory on Android; preferences contain only user choices/identity.

Sensors depend on device hardware and Android permissions. The foreground service
declares specialUse for user-started sources and adds location only when selected,
permitted and enabled.
This is not a Google Play policy approval. Target-API/permission changes should
be reviewed before any store publication. Build and signature checks are not a
physical-phone test; verify sensor delivery/permissions/power behavior on a phone.

Controller displays ready-made Cards and full remotes only on the configured LAN.
Its private connection provisioning is native-only and never exposed to the WebView.
APK verification binds the binary to current first-party sources, resources and
bundled Material assets. Rebuild after changing native inputs.
