# Oculus Go

Localserve provides Wi-Fi headset diagnostics and a manual APK library. Wireless ADB must already be enabled and this computer's key authorized on the headset.

## Connect the headset

1. Open Oculus Go → Settings. Enter the headset's private IPv4 address and ADB port, normally :5555, and its exact serial.
2. If no protected key is saved, enter Base64 of an already authorized 2048-bit RSA PEM private key in Authorized ADB key. Enable the plugin and select Test connection.
3. After successful verification, clear the replacement key field. Its Windows CurrentUser DPAPI copy remains in this plugin's private data folder.

Test connection reads only the serial. Localserve connects directly to the configured headset; it does not start or restart a shared ADB server, scan the network, use USB, enable debugging or request a new authorization. If the IP changes, edit Wi-Fi address and test again. A timeout does not prove that the headset is asleep or off.

## VR library

1. Enable APK library in plugin Settings.
2. Set APK library folder. The default is library/oculus-go relative to the Localserve folder. Create this folder and add your own standalone APK files. A user-selected absolute folder can point to an external drive. No APKs are supplied, uploaded or fetched from the internet.
3. Open SERVER → VR library, or /vr-library. Select Scan library after adding or changing files. Subfolders are scanned; directory links and ZIP64/split APK sets are unsupported.
4. Use search, genre and sorting controls to browse titles and versions. Details & versions shows available APKs. Install selected version sends only the chosen file to the configured headset.
5. Select Read installed apps for a current snapshot of user applications. Uninstall requires a separate confirmation and deletes the application's saved data. APK files on the PC are retained.

Installations require Android 7-compatible ARM32 or architecture-independent APKs. Android enforces signatures, and Localserve never requests a downgrade. An install succeeds only after Android returns success and the expected version is reported. Removal is checked against a fresh user-app inventory and verified afterwards. System components, protected vendor packages and Home VR cannot be changed through this page.

One package operation runs at a time. Jobs are recorded before effects. Stop remaining work cancels the owned connection; Android may already have applied a change. Check the headset before retrying. Restart, connection loss and uncertain outcomes never replay an operation. Settings changes or plugin disablement cancel work. Server pause holds further transfer chunks; explicit cancellation remains available. Install and uninstall are manual library operations, unavailable to Tasks, Controls, polling and Event testing.

## Use an existing Home VR app

The native Home VR app can use Localserve without being rebuilt when its embedded bearer token matches this installation.

1. In Oculus Go Settings enable Home VR headset access. Enter your own app's matching token in the replacement field.
2. In VR library select Save Home VR token. Then clear the replacement setting. The protected token remains in data/home-vr.dpapi under this plugin.
3. On the headset open Home VR → Settings → Change address and enter this server's LAN IP:port. Localserve must be listening on that LAN address. No URL path is required.
4. Refresh Apps. If the first request reports a scan in progress, refresh once the scan finishes. Installed apps can still launch locally when the PC is unavailable.

Find PC is not served by Localserve and may discover another running Home VR server. Use Change address to select Localserve explicitly. The Home tab has no scenes supplied by this package-management API. Existing unrelated services and their scenes are not controlled.

Native access requires the matching token, a local/private network peer and no browser Origin. It grants only catalog, artwork, file/download, scan and explicit package-management routes. It does not authorize administrator writes, arbitrary commands, Tasks or server shutdown. HTTP and legacy ADB are intended for a trusted LAN; keep the server and headset off untrusted networks.

## Storage and metadata

The APK folder is private user content. Optional plugin-owned data/library-metadata.json maps package names to title, description and tags. Optional PNG, JPEG or WebP artwork is stored as data/library-art/package.name.png (or .jpg/.webp). Artwork is bounded to 2 MiB and must be a regular image file. Catalog responses contain public metadata and file IDs, never source filesystem paths or credentials.

The current package job is stored privately at the server's data/vr-library-job.json. Library metadata, artwork, APKs, credentials and jobs are excluded from distributions. A fresh installation has an empty, disabled library and no Home VR token.

## Readings, Events and Cards

Diagnostics report battery level and temperature, charging status, recognized Awake/Standby state, foreground package, /data capacity and available thermal sensors. Unknown properties remain unavailable. Successful partial polls retain same-headset readings for unavailable sections; a failed poll does not invent a state change. Polling supports 15 seconds, 30 seconds and one minute.

Status updated and Headset changed expose declared diagnostic fields to Tasks. Observed transitions are committed before dispatch; reconnect does not replay old changes. These Events do not install or remove applications. The Orbital ready-made Card and shared Card designer consume declared public readings only; credentials, serial and library paths are not Card fields.

## Protocol references

- [AOSP ADB protocol](https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/docs/dev/protocol.md)
- [AOSP streamed APK installation](https://android.googlesource.com/platform/packages/modules/adb/+/ef5ecc5ae3b084748ee82fa322a23239e864cba8/client/adb_install.cpp)


## Localserve headset app

The separate native Localserve Go app is listed as **# Localserve #**. VR library offers its generic APK download and a one-use five-minute connection code. The app provides collection browsing, favorites, launch, reviewed installation, confirmed uninstall and package activity in a stationary neon VR cockpit. See [headset app instructions](android/README.md). No launcher or toolbar modification is performed.

The ready-made design uses two gauge columns in regions up to 540 pixels wide.
Use Vista Preview to check its complete content at the intended size; smaller
heights may still require scrolling.
