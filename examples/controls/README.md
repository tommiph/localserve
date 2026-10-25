# TV and lighting remote examples

These examples are generic recipes, not another installation's saved remotes.
They contain no credentials, device IDs, installed-app selections or lighting
scenes. Plugins and example pages remain disabled until you enable them.

1. Stop Sormus using its tray menu.
2. From the installation root, run:
   `.\runtime\node.exe tools/install-control-examples.mjs`
3. Start Sormus and configure Samsung TV or TRÅDFRI in plugin Settings.
4. Open SERVER → Controls. Edit the example, then enable the plugin and page
   when ready. Open its displayed URL on your phone or computer.

The installer only fills empty Controls stores. Running it again preserves
existing pages and revisions; it never resets your remotes. If you already have
pages, create another in the administrator and use the JSON files as references.
Do not copy an entire Controls file over existing saved pages.

**TV remote** has directional navigation, power toggle, source, home, playback,
volume, mute and channel controls. App buttons must use IDs reported by your own
TV. The example adds no app launch, Wake command or automatic action. Configure
your TV's authorized connection first; sent commands do not prove device state.

**Lights** uses the lighting presentation, which discovers devices and groups
from your own configured legacy TRÅDFRI gateway. No lamp IDs are preassigned.
Available power, brightness, white-temperature and colour controls depend on
reported capabilities. Devices/Groups appear after successful readings. In administration, use **Controls → Lighting scenes → Capture lighting**, then
enable the saved scene to run it.
DIRIGERA is not supported by this plugin.

The public mobile pages support their own web-app installation metadata. Trusted
HTTPS is needed for Chrome's full install promotion; LAN HTTP may offer only a
shortcut. See the main user guide for LAN security and setup.
