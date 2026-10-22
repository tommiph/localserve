# Phone Home

Open `/home` on your Localserve server for a personal phone remote. Home uses
its own dark appearance and text scale, independent of administrator settings.
The server must remain running and reachable on your trusted LAN.
The header and bottom navigation stay visible while the workspace scrolls.
Phone and Android toolbar gutters follow the same width limits; system bars
and display cutouts are inset once by the native app.
When port 0 is selected, automatic startup skips browser-blocked ports. A saved
explicit port remains unchanged and an occupied explicit port fails normally.

## Remotes and favorites

Create and enable pages in **Administration → Controls**. These pages appear
automatically under **Remotes**. Tap a tile for quick controls or **Full remote**
for the complete lighting or television remote. Lighting supports declared
targets, brightness and saved scenes; available controls depend on your page.
Reported values come from the plugin. Submitting a command does not confirm
that the device changed state.
While a command runs, Home follows its receipt promptly and re-enables controls
after completion instead of waiting for ordinary telemetry polling. It never
queues or repeats button presses. Samsung TV Settings provides **Remote command
interval (ms)** for minimum command spacing; 0 disables extra spacing.

On **Home → Edit**, choose your favorites and arrange them with the arrows.
Choose **Done** to save. Favorites are stored in that browser on that phone,
separately for each server address. Clearing browser/app data removes them.
Unavailable favorites remain visible. Removing or disabling a published page
removes access to it.

## Information Cards

Open **Cards** to browse the ready-made designs supplied by enabled plugins.
Each enabled data source, such as a phone or calendar, has its own Card. A plugin
does not need a remote or a saved Card definition to appear here.

Choose **Home → Edit**, select the Cards you want and choose **Done**. Home
displays their live designs under **Information**. Use the expand button for a
larger view. Cards display information only; opening one never runs a Task or
sends a device command. Your existing favorites are retained until you edit them.
New browser profiles start with up to three information Cards.

Only visible Cards are refreshed. Disconnected views identify retained readings;
disabled plugins, disabled sources and removed designs are no longer accessible.
There is no new Card definition or server preference written when you add a favorite.
Install Android app 1.4.0 or later to display Cards in the native app.

## Manual Task shortcuts

In **Administration → Phone home → Edit**, select the Tasks to publish, choose
their glyphs and enable their shortcuts. Publishing does not enable or change
the original Task. Unpublish a Task to remove its shortcut, or disable the
shortcut while retaining its selection. Up to 32 Tasks may be published.

Tap a Task, review its name, then choose **Run Task**. It starts the current
Task from the beginning. The server's normal pause, concurrency, availability
and revision checks apply. These are explicit manual runs, including manual TV
actions; automatic-action Do not disturb restrictions do not apply. Tasks that
need Event values cannot run here because Home does not supply captured Events.
Use the administrator's Task history for detailed outcomes.

A repeated submission with the same request ID cannot run the Task again.
After an uncertain response, check Task history before deliberately starting
another run. There is no offline command queue, automatic retry or replay.
Disabling a shortcut does not cancel an already accepted run.

## Android app

Open `/sensors` on your phone and download **Localserve**. Android 8.0 or later
and an up-to-date Android System WebView are required. Install the APK through
Android's own installation prompt. The sideload build is locally signed.

Install over **Localserve Sensors** to preserve its saved device identity,
server address and reporting preferences. The package remains
`local.localserve.sensors`. The app launches as **Localserve** with its own
logo splash screen. **Connection** saves your numeric private LAN HTTP address.
Use **Home** to return from a full remote. No administrator credentials are
embedded in the APK.

**Sensors** opens native reporting setup. Reporting starts only when you choose
**Start**, and stops from that screen or its notification. Remote use requires
no sensor permissions and does not start reporting. Stop reporting before
changing the shared server address. See the
[Android guide](plugins/sensors/android/README.md) for optional sources.

Phone preferences offer optional quiet interface sounds. Sounds play only after
touch input; motion follows the device/browser's reduced-motion preference.
The app has no internet relay, automatic server discovery or boot startup.
Only fixed Home/remote routes and inert installed Card frames on the saved origin load inside its WebView;
native sensor setup is separate from web content.

## Developer contract

`server/phone-home.mjs` owns revisioned publishing in private
`data/phone-home.json` and bounded expiring execution claims in
`data/phone-home-runs.json`. Neither store belongs in distributions. Public
`GET /api/phone-home` exposes enabled shortcut metadata and Controls index
entries and ready-made Card metadata, not settings, Task bodies, history or administrator tokens.
`GET /api/phone-home/cards/:plugin/:design/:source` rechecks enablement and
returns only the design's declared public bindings, bounded rows and columns.
Installed HTML/CSS assets use the shared script-free Card sandbox. The phone
keeps connected frames through reading updates and bounds visible Card reads.
`POST /api/phone-home/run` requires exact Origin, a current per-Task capability,
the matching publishing/Task revisions and a unique request ID. Claims are
durable before engine admission. Recovery never repeats an effect. Receipt
access is limited to its own capability and reports status without arguments.
Publishing changes use the normal administrator mutation API and token.

Keep `HomePolicy.java` in sync with fixed public assets when changing the
server-served phone or full remote. Do not add a JavaScript/native bridge,
administrator endpoints, arbitrary pages or external navigation. Run
`tests/phone-home.test.mjs`, the Android host tests through its build script,
and disposable browser checks before deploying changes.
