# Installing Sormus on Windows

## Requirements

Sormus targets Windows 10/11 x64. The bundled runtime is Node 24.19.0 x64.
The tray and Windows credential/PC helpers use Windows' .NET Framework 4.x and
Windows Forms. Their readable source and build scripts are included. A modern
Edge, Chrome or Firefox browser is recommended for administration.

The core application needs no npm installation, global Node, Codex account,
Tizen SDK or internet download. Optional data-provider plugins need internet
access; device plugins need their configured local device. Setup and portable
packages are unsigned previews. Source downloads include the same server code;
no package guarantees compatibility with every device.

## First start

### Setup executable

When using a Sormus Setup executable, run it as your normal Windows user.
It installs into a writable per-user folder, adds Start menu/uninstall entries
and initializes missing private settings. **Open Sormus** starts the tray
and opens the administrator after the server is ready. **Start when I sign in**
is optional and starts unchecked. Existing installation settings survive upgrades.

Setup only updates folders it owns; choose an empty folder when starting from
a portable copy. Uninstall keeps private data by default and offers explicit
deletion. See [setup details](tools/installer/README.md). Preview executables may
be unsigned; check their signature/checksum. Device/plugin configuration and LAN
access remain separate from installing the application.

### Portable or source download

1. Clone the repository or extract its ZIP using **Extract all**. Keep the complete folder
   together in a writable location. Do not run directly inside the ZIP, overwrite
   an existing installation, or place it in a read-only system folder.
2. Double-click **Start Localserve.cmd**. A Sormus icon appears in the Windows
   notification area, possibly under the hidden-icons arrow. The server starts
   in the background. Normal use does not require administrator elevation.
3. Double-click the tray icon, or right-click it and choose **Open administrator**.
   It opens localhost at the actual selected port. A fixed port can be selected
   later in Settings; do not assume the port used on another installation.
4. In Settings, choose your server name, theme, font sizes, time format and
   Activity retention. Set Server location only if you want location-based
   functionality such as Sunrise/Sunset. Time follows Windows' system timezone.
5. Open a plugin, configure its Settings and enable it. Every plugin starts
   disabled; no provider polling or device commands are enabled by this ZIP.
   See [PLUGINS.md](PLUGINS.md) for setup requirements.

The app generates fresh configuration, private state and logs on first start.
There are no example Tasks, Vistas, saved Cards, remotes or lighting scenes.
Ready-made **designs** are installed, not preconfigured Card instances.

## Guided setup

In Overview, choose **Setup guide**. It explains service configuration, a safe
manual Task, ready-made Cards and Vistas, and Controller setup. You can follow one
path at a time and return later. The guide opens normal editors and never saves,
enables or runs anything on your behalf. Controller uses a six-character phone
approval code and retrieves connection details automatically; no configuration
file needs to be downloaded or pasted.

## Try the editor without a device

On an empty installation, Overview offers **Create demo**. This is optional and
does not run during installation or startup. It enables Simulator and creates
**Run the demo**, a ready-made **Signal lab** Card and the **Sormus demo**
Vista at `/vistas/localserve-demo`. Open that screen and press **Run demo Task**
in Overview. Its values update through the real Task engine.

The example has no schedules or event rules, never opens the TV and does not
change `/display`, other plugin settings or server preferences. Existing content,
prior plugin configuration and server pause prevent demo setup. Interrupted
setup can be explicitly resumed if its authored content remains unchanged.
All examples use the normal editors. Delete their Task, Vista and Simulator
Card individually when finished, then disable Simulator if no longer needed.
No reset of other content is required. Edited Tasks are run from Tasks after
review; the demo shortcut refuses to execute changed definitions.

To create your own examples instead:

Enable Simulator, leaving Configuration complete on. Create your own Task with
Log activity or a Simulator action, then run it manually. Add schedules or other
rules when ready. To create a display, make a Card in a plugin's Card designer
(ordinary or ready-made), choose a source and enable it. Create a Vista, add that
Card from the library, enable the Vista and open its displayed URL. Plugin data
appears only after successful readings or Simulator actions; unknowns stay No data.

Ready-made Card and Vista previews use the Vista font setting, independently
of the administrator font setting. Enabled Controls pages can issue actual
device actions; read-only Cards and Vistas cannot.

## Tasks, notices and lighting

Tasks own their rules and ordered steps. Plugin actions/events appear from
declarations and require configured, enabled plugins. Event text parameters can
use declared public `{{event.field-id}}` values. Manual Run can select a retained
matching Event; finished-run Rerun starts the current Task from step one with
that run's captured Event values. There is no automatic replay of missed runs.

Samsung TV's Show TV notice action offers Notice, Alarm, Alert and Warning,
optional sound/looping and Close automatically. Turn automatic close off for an
elapsed-time display until dismissed; dismiss with TV Back or the administrator's
active-notice control. This requires your own compatible Tizen launcher. No
volume/mute override is performed.

Settings → Do not disturb inhibits automatic TV effects. Enable now and the
weekly days/start/end schedule are separate switches; both default off. Overnight
windows belong to the selected starting day. Skipped effects are logged, never
replayed later. Manual remote actions and Task Run/Rerun remain available.

Create a lighting remote in **Controls → Remotes**. Devices/Groups use reported
readings. In **Controls → Lighting scenes**, Capture lighting saves recent readings
without issuing a device command. New/copy scenes start disabled. Enable a scene
before applying it or selecting Run lighting scene in a Task. Plugin Settings →
Fade duration (seconds) applies to supported brightness/white/colour transitions
and group brightness (0–60 seconds, default 0.4; 0 requests immediate). Simple
on/off does not fade. A command ACK does not confirm completed fading; add an
explicit Delay when later Task/scene steps should wait.

Webpage Open on TV opens a saved enabled public URL or your own contained local
display HTML fullscreen through the compatible Tizen launcher. Put your own
pages under assets/pages/; see its README. No supplied personal screensavers,
saved pages or Tasks are included.

## Remote web apps on Android

Create and enable a TV remote or Lighting remote Controls page, then open its
displayed LAN URL on your phone. From the browser menu choose Add to Home screen
or Install app; repeat for the other remote if wanted. Each opted-in remote has
its own manifest and white-on-black local launcher icons/favicon. Install app
appears within the remote only when the browser offers an install prompt.

The current server uses HTTP. Chrome's standard standalone PWA installation
requires trusted HTTPS; a LAN address does not satisfy that requirement. Your
browser may add only a shortcut opening a browser tab. For a native launcher,
install the Controller APK described below. Its four-tab screen
provides remotes, information Card favorites and published manual Tasks, with
optional Sensors reporting. No TLS bypass is provided.
The server must remain running/reachable; remotes
do not cache capabilities, queue commands or work offline. Physical Android
installation behavior depends on your Android/browser version.

## Controller for Android

1. Configure LAN access and connect the phone to the same home network.
2. Open the server **Downloads** page on Android and choose Controller.
3. Install `controller.apk` using Android’s installation prompt.
4. Open Controller → Settings, enter the server address and tap Save server.
5. For access away from home, configure Google Apps Script in administration.
   Choose **Controls → Controller setup → Connect a phone** and enter its code
   in Controller.
6. Use Lights, Tasks, full Remotes and Cards in the bottom tabs.

The app retrieves approved relay details automatically; no profile file is
handled on the phone. Administration stays on the server. For optional phone
sources, use Settings → Phone information → Choose what to share, select sources, grant their Android
permissions and tap Start. No reporting starts automatically. See
[Controller](CONTROLLER.md) and the [reporting guide](plugins/sensors/android/README.md).

## Server controls and Windows startup

Right-click the tray icon for Start server, Stop server, Restart server and
Enabled. Turning Enabled off pauses server work while keeping the administrator
available. Stop performs normal cancellation/draining and saves pending records.

**Start with Windows** registers this installation for the current Windows user
after sign-in. It is off until you explicitly enable it. **Start server when tray
opens** is a separate preference and defaults on. **Exit tray (keep server
running)** leaves the detached server running; **Stop server and exit** stops both.

Disable Start with Windows before moving the folder, then enable it again from
the new location. The startup entry necessarily stores the installed executable's
resolved path; application assets otherwise follow the folder.

For a visible console instead of the tray, open PowerShell in the extracted
folder and run:

```powershell
.\runtime\node.exe server.mjs
```

Use Ctrl+C for normal console shutdown. Do not start the console and tray server
against the same folder simultaneously. The exclusive server lock prevents this.

## Local network access (optional)

The default is localhost only. In Settings, choose this PC's explicit private
IPv4 address and a fixed unused port, then restart Sormus. Use the new LAN URL
shown by the administrator. Do not use a wildcard or public bind address.

LAN mode exposes published Controls and, while sign-in is off, administration to trusted network users. Enable optional administrator sign-in in Settings to protect private pages and APIs; published controls retain their own access rules. Do not forward the port to the internet or expose it to untrusted networks. HTTP traffic is not encrypted. Keep API keys restricted where supported. See [Administrator access](ADMIN-ACCESS.md).

If Windows Firewall requires an exception, the included `tray/enable-lan.ps1`
accepts your own matching local address, exact interface subnet and port. From
an elevated PowerShell in the installation folder, substitute your actual values:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tray\enable-lan.ps1 -LocalAddress <your-private-IPv4> -RemoteSubnet <your-interface-subnet/CIDR> -Port <your-fixed-port>
```

The angle-bracket placeholders are not literal command arguments. The script
uses a script policy for that child PowerShell only; it does not change your
machine's execution policy. It limits the rule to Private network profiles,
this folder's bundled Node, that address/port and subnet. It
does not disable the firewall or change the network category. It is never run
automatically. Revisit the rule when moving the folder or changing the address.

## Credentials and private files

Enter your own keys and device details in the administrator. Masked settings
are not necessarily encrypted on disk. Secret config values are private plaintext;
selected device credentials additionally use Windows CurrentUser DPAPI. Clear
temporary setup secrets after successful exchange when the plugin guide says so.
DPAPI files belong to the Windows account that created them and are not portable
credentials for another PC/user. This release contains no vault files or keys.

Do not commit or share `config.json`, `data/`, `plugins/*/data/`,
`tray/settings.json`, TV signing files, backup copies or logs. Use the supplied
clean ZIP for sharing, not a ZIP of your subsequently configured installation.
Back up your own private data securely before upgrades. Unpack future clean
releases separately; do not erase your private data to update the application.

## Troubleshooting

- **No browser opened:** use Open administrator from the tray. The port is
  selected automatically until you configure a fixed one.
- **No tray icon or server failed:** inspect `data/tray/desktop.log` and
  `data/tray/server.log`. Do not post logs publicly without reviewing them.
- **Configure under a plugin:** required settings are missing or invalid.
  Ready means configuration/runtime readiness, not proof of a fresh device read.
  Check the plugin's Log and Current values for request failures.
- **Emby is Ready but title/progress say No data:** check the session table and
  successful reception. A connected session need not be playing media. Paste
  only the API key value, not its application label or spaces.
- **No Cards in a Vista:** create and enable Cards, then add them to an enabled
  Vista. There are no preinstalled saved Cards or Vistas in a clean release.
- **Port already in use:** choose another unused port or automatic port 0;
  Sormus does not stop another application's listener.
- **Lock after a crash:** the tray may recover only a lock whose recorded PID
  no longer exists. A live or ambiguous lock is retained. Never delete the lock
  or kill unrelated processes while another Sormus instance may be active.

## Removal

Disable **Start with Windows**, then choose **Stop server and exit**. Remove any
installation-specific firewall rule you explicitly created, then remove the
extracted folder when you no longer need its private data. This portable build
does not install a Windows service or register global Node/npm packages.
