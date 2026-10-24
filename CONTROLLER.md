# Controller for Android

Controller uses the shared circle launcher icon on black. Install APK updates
over the existing app to retain connection and reporting preferences.

Controller is the phone interface for Localserve. Four bottom tabs provide
**Lights**, **Tasks**, **Remotes** and **Cards**. Administration stays on the
server. The app does not create Tasks, publish shortcuts or edit plugin settings.

## Install and connect

1. Start Localserve on the PC. Enable LAN access in **Settings → Network** if
   the phone cannot reach the server. Connect the phone to the same network.
2. On the phone, open the server address shown in administration, for example
   `http://192.168.1.10:7041/scenes`.
3. Tap **Get Controller for Android**. Open the downloaded `controller.apk` and
   allow installation from your browser when Android asks. The download is also
   available at `/downloads/controller.apk`.
4. Open **Controller**. Tap **Settings**, enter the server's address including
   its port, and tap **Connect**. Use the address without a page path.
5. For a new phone, open **Google Apps Script → Settings → Approve a phone**
   in administration. Enter the displayed six-character code in Controller.
   It works once and expires after five minutes. Existing configured relay
   phones retain their access when upgrading.
6. Controller retrieves its connection details directly. No configuration file,
   private key or Google URL needs to be copied into the app. The local page
   opens independently of this setup; the first approval must be made at home.

Installing over the Localserve phone-reporting package retains its phone ID,
Android grants and reporting preferences. The package is
`local.localserve.sensors`; keep its signing identity when building updates.
The separate Scenes app is not required. Use Controller for all phone functions.

## Use the four tabs

- **Lights:** tap a circular scene button once. Wait for Completed before
  submitting another command. These are enabled scenes on lighting Controls pages.
- **Tasks:** tap a published shortcut. Only Tasks selected by the administrator
  in **Controls → Phone home** appear. Tasks requiring captured Event values
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

In Settings, the connection status updates while the screen is open. Separate
timestamps identify the last home-network contact, Google contact, report
accepted locally and report queued remotely. Queuing to Google does not prove
the home server received a report. Report timestamps cover the current app
process; no reports are stored as a phone history.

## Scene glyphs and updates

In the server’s lighting remote, open **Scenes → Edit → Scene glyph**. Search
the local Material Symbols catalogue and choose a glyph. Saving changes artwork
without changing the lights. New/copied scenes start disabled. The same glyph
appears in Controller after its next local refresh or relay synchronization.
Mapped Controls pages also expose each item’s glyph in administration.

Controller Settings separates **Installed Controller**, **Running server** and
**Available Controller**. The available version is learned at home from the
server’s verified APK metadata. **Download Controller update** opens the local
download in your browser; Android controls installation. Install over the same
package/signature to retain phone identity, permissions and reporting preferences.
The server never silently installs an APK or grants Android permissions.

Cloud shortcuts wait for the server's next relay poll. A second poll may be
needed for completion confirmation. Keep the PC and Localserve running. If a
result is uncertain, check the server Activity or Task/Controls history before
running it again. There is no offline command queue or automatic command retry.

## Optional phone reporting

1. Open **Settings → Phone reporting**.
2. Expand **Hardware sensors**, **Phone events** or **Location and regions**
   and choose the sources to share. **Reporting frequency** holds sampling and
   report intervals. These sections use the same appearance as Controller.
3. Grant the relevant access using Android's prompts/settings.
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
