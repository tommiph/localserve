# Sormus Launcher

Sormus Launcher is a separate Samsung TV application for installed apps, TV/HDMI
inputs, Vistas, Universes, games, lighting scenes and published Task shortcuts.
The interface is served by the PC at `/assets/launcher/index.html`. Keep Sormus
running and reachable on the TV's local network. A browser can preview the page;
installed-app and input controls require the TV application.

The app uses the white circle icon on black. It shows a black launch screen
while connecting. If the provider cannot establish readiness within 30 seconds,
the packaged connection settings open. While running, the current screen stays
visible for 30 seconds without a fresh server readiness report before connection
settings open. A recovered connection resets this wait. These settings work without the PC.
Enter its IP or hostname and port, then choose **Save and connect**. The page path
is fixed; there is no need to enter it. HTTP is suitable for a trusted home LAN;
HTTPS needs a certificate trusted by the TV. Press OK on an address or port
field to open the TV keyboard. Choose Done or Return to finish editing, then
select Save and connect. Arrow keys navigate the keyboard while it is open.

## Remote controls

| Button | Action |
| --- | --- |
| Arrows / OK | Navigate / open the selected tile |
| Return | Close personalization/editing, return Home, or leave the launcher |

Use the header's personalization button for favorites, appearance, refreshing
items and server settings. **Edit favorites** enters selection mode; choose tiles
to add/remove them and finish with the header checkmark or Return. Personalization
also lets you reorder/remove favorites and choose Aurora, Midnight or Ember backgrounds.
These preferences are saved on this TV; they do not change administrator or
Vista themes. Unavailable favorites are retained in preferences so they can
reappear when their source returns.

Only arrows, OK and Return are needed. Focus is indicated by lift, brighter
artwork and soft shadow, without an outline frame. The normal screen has no
footer or connection badges. Brief action feedback appears only when needed.

In app grids, Left/Right stays within the current row. Up/Down moves to the
nearest column in the adjacent row and scrolls it into view. Up from the first
row returns to the selected menu tab; Down from the menu reenters the remembered
tile, or the first tile when that page has not been used.
The last partial row remains reachable without wrapping into unrelated controls.

## App library

On **Apps**, the header magnifier opens search. Use arrows and OK on the letter
keyboard, then **Show results** or Return to view matches. Space, Delete and Clear
are available on the keyboard. Search ignores letter case and stays applied
until cleared. It does not open the TV's system keyboard.

Choose **Manage apps** in header personalization to show or hide entries. Hidden
apps appear dimmed in this mode; select one to show it again. Finish with the
header checkmark or Return. Hiding affects this launcher only: it does not
uninstall the app or erase its favorite identity. Hidden favorites reappear when
the app is shown again.

Apps remembers its selected item, search and scroll position when leaving the
page, opening another TV app, or reopening the launcher. The launcher still
starts at Home; choosing Apps returns to the remembered library position. If an
item is removed or hidden, an available result is selected instead. Restoration
only moves focus; it never launches an application.

Choose **App artwork: Icons / Glyphs** in personalization. Icon mode reads the
TV's own Smart Hub home-bar artwork from its installed-app cache. It does not
substitute recreated service logos. If the TV denies access or has no widescreen
artwork, the tile retains its glyph. **App tiles: Artwork only** fills each app
button with its artwork and hides its name, detail and favorite marker; **Labeled**
restores them. Glyph mode can also use the text-free layout. Editing favorites or
managing hidden apps temporarily restores labels so entries remain identifiable.
Both choices are saved on this TV. Enable and configure the Samsung TV plugin
for Smart Hub artwork. Sormus matches app names against the TV’s own installed
catalogue, reads only their home-bar images through the saved TV connection and
keeps a bounded memory cache. No artwork credentials or file paths reach the
launcher. A missing or disabled TV plugin leaves glyphs and local icon fallbacks
available. No internet image service is used. Icons are held in
memory and are not saved to disk or with preferences. The widget requests
read-only filesystem access for installed-app icons and their Smart Hub cache;
it accepts no file path from a web frame. Only bounded PNG/JPEG icons are read
and converted to small PNG images before reaching the interface. Native app
IDs can differ from Smart Hub store IDs, so the paired PC lookup supplies those
apps’ actual home-bar artwork. Artwork reads do not launch apps or send keys.

Inputs open the TV's native video plane full screen. Back returns to the
launcher. Opening settings, switching apps or losing the connection hides the
plane. Hiding it does not restore a previous input. Input support and signals
depend on the TV; failures are reported without automatic command retries.

Display tiles open the installed **Sormus Vistas** application with the selected
page. Apps are discovered from the TV, rather than a fixed catalogue. Only
discovered apps can be launched. Scene and Task tiles use the same published
shortcuts and execution guards as Controller. Publish Tasks in **Controller
setup** and enable lighting scenes for end-user access in their scene editor.
An uncertain result is not retried; inspect the shortcut's activity first.

This application does not replace Samsung Smart Hub or intercept Home while
another application is open. The TV's **Autorun Last App** setting may help with
startup, subject to model, firmware and application support.

## Build and installation

Use a project-local official Tizen SDK and authorized author/distributor
certificates. From the project root:

```powershell
.\runtime\node.exe tv-tizen/build.mjs launcher
.\runtime\node.exe tv-tizen/install.mjs launcher
```

The signed widget is `tv-tizen/launcher/dist/SormusLauncher.wgt`. The installer
targets only the private TV address configured in the Samsung TV plugin. It does
not scan, wake, uninstall or launch another application. Its identity is
`SormusL001.Launcher`; use the same author certificate for updates. Downloads
lists the signed widget when built, plus a source ZIP without signing keys.

Connection addresses and presentation preferences stay in TV browser storage.
No administrator token or TV pairing credential is embedded in the widget.
The packaged parent limits messages to its current provider frame, exact origin
and navigation challenge. It alone handles native application and input APIs.

References: [application management](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/application-api.html),
[remote keys](https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html),
[read-only filesystem API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/filesystem-api.html),
[TV video window](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/tvwindow-api.html).

## Smart Hub artwork protocol

This reference describes how to retrieve the TV's own home-bar images. It is
intended for developers extending the launcher or reusing its artwork reader.
EDEN is an undocumented Samsung protocol; response shapes, cache paths and image
sizes can vary with the TV firmware. Missing support must remain a glyph fallback.

### App identities and image sources

The native application API and Smart Hub can identify the same app differently.
For example, YouTube can have native ID `9Ur5IzDKqV.TizenYouTube` and Smart Hub
store ID `111299001912`. These are public application identifiers, not credentials.
Discover them from the TV; do not hard-code this example as an identity map.

| Source | Use |
| --- | --- |
| `tizen.application.getAppsInfo()` | Native app ID, name, version and launchable inventory |
| `ApplicationInformation.iconPath` | Package icon fallback; it can be square or generic |
| `ed.installedApp.get` | Smart Hub store IDs, names and reported icon paths |
| `ed.edenApp.get` | Home-bar metadata, useful for inspecting the actual wide-image path |
| `ed.apps.icon` | The requested cached image as base64 PNG data |

Stretching a package icon to 16:9 does not turn it into the Smart Hub image.
The image source, as well as its aspect ratio, must be correct.

### Read the installed Smart Hub catalogue

Use the existing authorized connection to the configured TV's remote WebSocket:

```text
wss://<TV_ADDRESS>:8002/api/v2/channels/samsung.remote.control
```

The connection uses the existing base64 client-name and saved pairing-token query
parameters. Reuse `connectRemote()` rather than constructing or logging a token-
bearing URL. Port 8002 requires the configured certificate pin. Port 8001 is used
only when explicitly configured; it is not an automatic fallback. Artwork reads
do not create pairing tokens or write credentials.

Send this message after the authorized `ms.channel.connect` response:

```json
{"method":"ms.channel.emit","params":{"event":"ed.installedApp.get","to":"host"}}
```

An installed app record can look like this:

```json
{
  "appId": "111299001912",
  "name": "YouTube",
  "app_type": 2,
  "icon": "/opt/share/webappservice/apps_icon/FirstScreen/111299001912/250x250.png"
}
```

Match the requested native app name to a **single** installed Smart Hub record,
using trimmed, case-insensitive names. Skip missing or ambiguous matches. Retain
the native ID for launching the app; the store ID is used for its artwork.

### Identify the wide home-bar image

For read-only inspection of the home bar, send:

```json
{"method":"ms.channel.emit","params":{"event":"ed.edenApp.get","to":"host"}}
```

The response can contain top-level app tiles with `appId`, `name` and `icon`.
A wide icon path can be:

```text
/opt/share/webappservice/apps_icon/FirstScreen/111299001912/167x94.png
```

The `167x94.png` image is approximately 16:9; the `250x250.png` image is square.
These are paths inside the **TV operating system**, not files in the PC project.
Do not interpret them as local PC paths or expose a general file-reading endpoint.
Only the app tile's identity and icon path are relevant to this inspection;
content previews or viewing-history fields are unnecessary.

The production reader does not fetch the home-bar metadata on every request.
It validates that the installed record's icon is a PNG inside
`FirstScreen/<its-own-store-ID>/`, then selects the `167x94.png` sibling in that
same directory. This filename is a firmware-specific compatibility assumption.
If a model reports a different home-bar layout, inspect its metadata and add a
bounded, tested implementation instead of guessing arbitrary filesystem paths.

### Retrieve the actual pixels

Send the validated wide-image path through `ed.apps.icon`:

```json
{
  "method": "ms.channel.emit",
  "params": {
    "event": "ed.apps.icon",
    "to": "host",
    "data": {
      "iconPath": "/opt/share/webappservice/apps_icon/FirstScreen/111299001912/167x94.png"
    }
  }
}
```

The reply has this shape; the placeholder represents the PNG's base64 bytes:

```json
{
  "event": "ed.apps.icon",
  "data": {
    "iconPath": "/opt/share/webappservice/apps_icon/FirstScreen/111299001912/167x94.png",
    "imageBase64": "<PNG_BASE64>"
  }
}
```

The receiver accepts the image only when the returned `iconPath` exactly matches
the pending request. It checks base64 syntax, PNG signature and IHDR dimensions:
neither dimension may exceed 4096 pixels, and the aspect ratio must be within
0.12 of 16:9. The base64 payload is limited to 65,536 characters. Accepted bytes
become `data:image/png;base64,...`; the PC reader does not redraw a replacement
logo or resize the returned Smart Hub image. The provider independently limits
the complete data URL to 65,536 characters and falls back if it exceeds that bound.

### Sormus delivery, caching and fallbacks

The provider requests visible app names through a relative, read-only endpoint:

```text
/api/launcher/artwork?names=%5B%22YouTube%22%5D
```

The `names` parameter is a JSON array of 1–12 app names. The response contains
only matching names and image data URLs:

```json
{"icons":[{"name":"YouTube","image":"data:image/png;base64,<PNG_BASE64>"}]}
```

No client supplies a TV address, filesystem path, remote command or credential.
The server uses the configured Samsung TV plugin and requires it to be enabled,
configured and ready. Pause, configuration/runtime changes, request cancellation
and shutdown prevent stale reads from being published.

The server admits at most three batches and processes them serially. A TV read
has a five-second overall bound and each icon reply a 1.2-second bound. Its
memory cache retains up to 256 entries: successful images for ten minutes and
missing images for one minute. Settings revision, target host and plugin version
separate cache identities. Images and pairing data are not written to an artwork
cache on disk. Owned remote connections close when their read completes or fails.

If the paired lookup cannot supply an image, the packaged launcher tries its
app-scoped Smart Hub cache candidates and then the reported package icon path,
using read-only filesystem access. That fallback accepts bounded PNG/JPEG files,
rejects square images and rasterizes accepted wide images to a 160×90 PNG. Its
native-ID lookup cannot reliably resolve every store ID, so it does not replace
the paired catalogue lookup. Missing, denied or unsupported images retain the
Material Symbol glyph. There are no automatic control-command retries.

**App artwork: Glyphs** skips image requests. **App tiles: Artwork only** changes
presentation independently: it fills the app button, hides visible labels and
retains its accessible name. Favorite/visibility editing restores labels.

### Implementation map and verification

All paths below are relative to the Sormus project root:

| File | Responsibility |
| --- | --- |
| `plugins/samsung-tv/server/launcher-artwork.mjs` | Unique-name matching, app-scoped path validation, `ed.apps.icon` request/reply and PNG validation |
| `plugins/samsung-tv/server/client.mjs` | Existing authorized, pinned remote transport and installed-app catalogue read |
| `server/launcher-artwork.mjs` | Readiness/revision/pause guards, bounded memory cache, batching and cancellation |
| `server.mjs` | Fixed `/api/launcher/artwork` HTTP route |
| `assets/launcher/launcher.js` | Visible-tile requests, native-ID/version image association and fallbacks |
| `assets/launcher/launcher.css` | Labeled and full-button artwork layouts |
| `tv-tizen/launcher/app/icons.js` | Packaged read-only filesystem fallback and rasterization |
| `tests/launcher.test.mjs` | Isolated protocol, image/path validation, cache and cancellation coverage |

For isolated regression checks, run from the project root:

```powershell
.\runtime\node.exe tools/testing/run.mjs --focused launcher downloads samsung-tv
```

For hardware qualification, compare the returned image with that app's actual
Smart Hub tile. A successful WebSocket send alone does not confirm an image.
An inaccessible cache file, ambiguous app name or unsupported EDEN response must
produce a fallback, not a claim that the genuine icon was obtained.
