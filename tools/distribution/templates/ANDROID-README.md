# Localserve Sensors for Android

Requires Android 8.0/API 26 or later. The included sideload APK is version 1.2.0
(package local.localserve.sensors). Install from your server's `/sensors` page or
plugins/sensors/android/dist/localserve-sensors.apk using Android's own prompts.
A Google account is not required. Only optional activity recognition needs
installed Google Play services.

## Connect and select sources

Enable Sensors and configure Localserve's reachable private LAN address. Enter
that address in the app, select hardware sensors and tap Start. Stop from the app
or foreground notification. Devices register without pairing. Each app install
has a persistent device identity; clearing app data creates a new identity.
Multiple phones can stream to one server.

Reports contain selected latest readings, units and timestamps. There is no
history/offline queue, command channel, cloud relay or boot startup. Android's
permissions and power management still apply. Test with your own phone.

Stop streaming to select optional sources, grant their real Android access,
then Start from the visible app. New sources default off:

- Battery/charging, screen/lock, unlock and network transport/metering.
- Bluetooth ACL connections (not scans), audio-device changes and call state.
- Notifications from up to twenty allowed package names; blank sends none.
  Notification access is required. Text is bounded and Android may redact it;
  no initial dump, artwork or notification actions are sent.
- Media from up to eight published sessions using Notification access.
- Foreground app with Usage access, checked every five seconds; no Accessibility.
- NFC ID/technologies while the setup activity is visible; no writes/payment use.
- Manual app button, Quick Settings tile or home-screen widget. Select Manual
  button and keep streaming active; these controls never start the service.

Restart after access changes. Losing LAN access can prevent the network-loss
event itself from reaching Localserve. Initial/reconnected reports baseline;
missed Events are not replayed. Tasks can retain public Event values in run
history: consider notification/location sensitivity when creating rules.

## Location and named regions

Select Location and a requested interval of 5/15/30/60/120 seconds. Start from
the visible app and grant approximate or precise location. Enable Android
Location. Native GPS/network availability/cadence depend on the phone. No
last-known fix or background-location permission is used. The user-started
location foreground service can continue while the setup screen is hidden.

Add up to twenty uniquely named circular regions with coordinates, radius
(25–100000 metres) and Enabled. Edit/Copy/Delete are available; new/copied regions
start disabled. Select Named region transitions. Definitions remain in Android
preferences; no map service or default location is provided.

Inside means calculated great-circle distance + reported accuracy < radius;
outside means distance - accuracy > radius. Uncertain boundaries emit nothing.
First confident fixes and gaps over two minutes baseline. No path between fixes
is inferred. This is foreground monitoring, not Android background geofencing.

In Tasks choose the device's Location, Region entered or Region left. For example,
compare Region name Equals Home. Location offers actual coordinates, accuracy,
provider, fix time/age, mock flag and optional reported altitude/speed.

## Activity transitions

Select Activity transitions and grant Physical activity access. Google Play
services reports Walking, Running, Cycling, In vehicle or Still with Enter/Exit.
In vehicle does not identify a driver. Localserve does not infer classifications
from raw sensors. Missing/outdated services or denied access display unavailable;
the app does not install services or automatically retry registration.

Use Activity entered/left and compare Activity Equals Walking, for example.
Regions and activities each have one latest callback slot; rapid opposite changes
between reports may merge. Freshness/per-device timestamp claims reject stale
or duplicate callbacks before Task dispatch.

## Rebuild on Windows

From the Localserve root:

```powershell
& tools/android-build/prepare.ps1
.\runtime\node.exe plugins/sensors/android/build.mjs
```

Preparation downloads pinned official tools with hash checks into this project;
read tools/android-build/README.md. No global install, PATH change, ADB command
or device connection occurs. Normal builds verify the 33 local client libraries
in vendor/lock.json without Maven. Explicit prepare-vendor.mjs downloads that
graph. License notices are in the APK and its Third-party licenses viewer.

The builder runs host address/region/linkage tests, compiles, aligns, signs and
verifies the APK, then updates dist/ and its checksum/report. Build tests do not
verify physical sensor delivery, platform permissions or background behavior.

A clean build creates your own signing identity/password under
tools/android-build/private/. Keep it securely for updates and never commit it.
A differently signed APK cannot update an existing app in place. Removing the
installed app to change signing identity loses its app data/device ID.

## Source

MainActivity owns setup/permissions; SensorCatalog discovers sensors; SensorService
owns foreground streaming; PhoneEvents owns bounded callbacks. TravelSources
manages location/Google transitions; RegionRules and RegionSettings implement
geometry and private editing. AndroidManifest declares real platform permissions
and protected services. No address, account or API key is compiled into the app.
