# Controller for Android

Controller uses the shared circle launcher icon on black. Install APK updates
over the existing app to retain connection and reporting preferences.

Controller is the phone interface for Sormus. Four bottom tabs provide
**Lights**, **Tasks**, **Remotes** and **Cards**. Administration stays on the
server. The app does not create Tasks, publish shortcuts or edit plugin settings.

## Install and connect

1. Start Sormus on the PC. Enable LAN access in **Settings → Network** if
   the phone cannot reach the server. Connect the phone to the same network.
2. On the phone, open the server address shown in administration, for example
   `http://192.168.1.10:7041/downloads`.
3. Choose **Controller → Download**. Open the downloaded `controller.apk` and
   allow installation from your browser when Android asks. The download is also
   available at `/downloads/controller.apk`.
4. Open **Controller**. Tap **Settings**, enter the server's address including
   its port, and tap **Save server**. Use the address without a page path.
5. For a new phone, open **Controls → Controller setup → Connect a phone**
   in administration. Enter the displayed six-character code in Controller.
   It works once and expires after five minutes. Existing configured relay
   phones retain their access when upgrading.
6. Controller retrieves its connection details directly. No configuration file,
   private key or Google URL needs to be copied into the app. The local page
   opens independently of this setup; the first approval must be made at home.

Installing over the Sormus phone-reporting package retains its phone ID,
Android grants and reporting preferences. The package is
`local.localserve.sensors`; keep its signing identity when building updates.
Use Controller for all phone functions.

## Use the four tabs

In administration, open **Controls → Controller setup → Choose Tasks** to select
phone shortcuts. Lighting scenes have their own gallery under **Controls →
Lighting scenes**; saved scenes can be renamed, copied, assigned a symbol and
enabled there. Capturing uses current reported lighting and does not send a
command. **New scene** opens an editor for each selected light’s power,
brightness and supported colour or warmth. In Edit, choose **Edit stored light
settings** to adjust a designed/captured scene. Saving changes no lights.
New scenes start disabled. **Apply** explicitly runs an enabled scene.
The full Lights remote also offers **Save as scene** to capture current lighting.

Use **Controls → Remotes** for remote layouts and their enablement. Lighting
animations and the VR library are separate tools within the Controls hub.

- **Lights:** tap a circular scene button once. Wait for Completed before
  submitting another command. These are enabled scenes on lighting Controls pages.
- **Tasks:** tap a published shortcut. Only Tasks selected by the administrator
  in **Controls → Controller setup** appear. Tasks requiring captured Event values
  may be unavailable for a new manual run.
- **Remotes:** tap a remote to open its complete TV or lighting interface.
  Close the sheet to return to the launcher. There is no second simplified remote.
- **Cards:** tap a ready-made Card to view live information. Cards are read-only;
  plugin/source enablement and configuration belong to administration.

The circle at the top is the app mark. The status identifies the active local
or remote connection. **Settings → Dark appearance** controls the app’s local
and remote views together without changing server settings. The browser page
also has its own appearance button.

## Away from home

The administrator must first configure and enable the
[Google Apps Script relay](GOOGLE-APPS-SCRIPT.md). Phone approval creates an
individual client for Lights, published Tasks and optional sensor reporting.
The home server synchronizes that client to Google during its next successful
poll. The Google project is deployed once; new phones require no Google editing.
Existing administrator-disabled clients stay disabled. Generic Task Events are
not granted by phone approval. Android permissions and reporting remain opt-in.

When updating an existing Google project, download the current Code.gs and
deploy it as a new version of the existing web-app deployment. The Settings
page warns if the deployed script lacks automatic client synchronization.

Controller prefers the local server. If it cannot reach that server, saved
relay grants provide remote Lights and Tasks. Remotes and Cards remain visibly
LAN-only. Returning home is checked periodically while the app is visible.
The app waits for outstanding shortcut results before returning from relay to
LAN; it never resubmits a command through another connection.

While Controller is open, Android network-change callbacks and a ten-second
foreground reachability check detect leaving or returning home. Server health
is checked separately from phone approval: a problem retrieving remote grants
does not prevent an otherwise working local interface. Close an open full remote
or resolve/dismiss an outstanding command before the launcher changes transport.
Connection checks stop when the activity is not visible.

Local and remote launchers use the same bundled markup, stylesheet, Material
glyphs, circle colors and bottom navigation. Remote mode shows **Remote via
Google**; a failed relay read shows **Offline** and disables retained shortcuts.
Remotes and Cards explain their home-network requirement.

Settings shows **At home**, **Away from home**, **Connecting** or **Not connected**.
This status updates while Settings stays open. Scenes and Tasks are available
away from home after approval; full remotes and Cards require the home network.

## Scene glyphs and updates

In administration, open **Controls → Lighting scenes → Edit → Scene glyph**. Search
the local Material Symbols catalogue and choose a glyph. Saving changes artwork
without changing the lights. New/copied scenes start disabled. The same glyph
appears in Controller after its next local refresh or relay synchronization.
Mapped Controls pages also expose each item’s glyph in administration.

**Settings → App updates** shows the installed Controller version and the version
available from the server. **Get app update** opens its download while at home;
Android controls installation. Install over the same package/signature to retain
phone identity, permissions and sharing preferences. Nothing installs silently.

Cloud shortcuts wait for the server's next relay poll. A second poll may be
needed for completion confirmation. Keep the PC and Sormus running. If a
result is uncertain, check the server Activity or Task/Controls history before
running it again. There is no offline command queue or automatic command retry.

## Optional phone reporting

1. Open **Settings → Phone information → Choose what to share**.
2. Expand **Sensors on this phone**, **Phone events** or **Location and regions**
   and choose the sources to share. **Update frequency** holds sampling and
   report intervals. These sections use the same appearance as Controller.
3. For notification sharing, choose up to 20 apps by name. Grant the relevant
   access using Android's prompts/settings. Nothing is shared until you start.
4. Tap **Start**. Stop in the same screen or from the foreground notification.

Reporting uses the same server connection. With an approved matching relay
grant it can switch to low-rate remote reports when LAN delivery fails. A failed
packet is discarded; only a fresh subsequent report may use the other transport.
Cloud presence is separate from LAN presence and must not be treated as proof
that the phone arrived home. Reporting never starts merely by connecting.

See the [phone reporting guide](plugins/sensors/android/README.md) for supported
sources, Android permissions, intervals and location limitations.

## Troubleshooting

- **Nothing under Lights:** enable the lighting Controls page and its scenes.
- **Nothing under Tasks:** publish the desired shortcuts in administration.
- **Nothing under Remotes:** create and enable a Controls page.
- **Nothing under Cards:** enable a plugin with a ready-made design and a source.
- **Remote connection not configured:** configure and enable the relay, approve
  this phone and allow one successful server sync. Reopen Controller at home.
- **Phone reporting unavailable remotely:** check its client is enabled in relay
  Settings and the deployed script supports automatic registration. Do not use
  another phone's identity. A running reporter receives new grants automatically.
- **Code expired or rejected:** choose Approve a phone again. Generating a new
  code cancels the previous one. Eight failed attempts invalidate a code.
- **Local page unavailable:** check the address and LAN access. Sensor reporting
  and remote configuration do not block the local launcher.
- **Changed server address:** stop reporting, open Settings, enter the new LAN
  address and Connect. Grants for a different server are discarded.

Connection credentials stay in private Android preferences and are excluded
from Android backup. They are never passed to the WebView, copied to clipboard,
placed in URLs or included in distributable source. LAN access is trusted;
keep the administrator and provisioning endpoint on your private network.
