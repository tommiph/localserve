# Using Sormus

## Away from home

The optional Google Apps Script plugin accepts selected phone reports, lighting
scenes, published Task shortcuts and external Events through your own Google
project. Sormus polls outbound HTTPS; no server port needs to be exposed.
Controller retrieves approved connection details automatically when connected at home.
Use [Controller](CONTROLLER.md) for setup, the four tabs and phone reporting.
Remote use is polled, with bounded expiry and queue/completion receipts; LAN
remains the default. Follow [setup and privacy details](GOOGLE-APPS-SCRIPT.md).

## Administrator and services

**SERVER → Devices** provides manual discovery on an attached private network.
Choose **Discover devices** to list addresses, reported names and advertised
services. Unknowns remain explicit and inferred device types are labelled.
Edit local names/types, copy addresses or select **Use address** to review an
address change for a compatible plugin. Scans never pair or control a device.
Sleeping or isolated devices can be missed; neighbor-cache information does not
prove current availability. **Look up manufacturers** optionally checks public
MAC prefixes with maclookup.app and caches the registered companies and country.
Private/randomized MACs are skipped; names, IPs and full MACs are not sent.
See [Devices](DEVICES.md) for details.

Open the administrator from the tray. Overview shows plugin readiness, polling
and server status. Enabled pauses or resumes server functions without closing
the administrator. Configure means a plugin needs settings before operating;
Ready does not guarantee its most recent device/provider read succeeded. Inspect
the plugin's Log and current values when troubleshooting.

Read activity separates the latest check from the latest declared reception.
A completed check can use cached data. Not reported means the plugin has no
available declared reception timestamp. Switches, sliders and inline plugin
fields save automatically; popup editors use Save. Save feedback is separate
from connection status. On a small screen, Menu opens labelled navigation.
The current server version appears in the mobile header and at the bottom of
the menu. The menu scrolls independently while its server status stays visible.
Disabled plugins waiting for configuration do not count as Overview warnings;
runtime errors and enabled services needing attention still do.

Overview's failed-run shortcut opens retained failures from the last 24 hours.
Task history offers a Period filter and contains up to 200 recent runs. Activity
search covers its recent window: up to 2000 server entries or 500 plugin entries.
Pause display freezes at most 500 entries while logging continues; older logs
within the retention period remain on disk.

Each Task shows its latest retained run result and start time. **View runs**
opens history filtered to that Task and clears other history filters; it does
not run the Task. No retained runs means none remain in this recent history,
not that the Task has never run. Completed describes execution, not confirmed
device state.

In the Task editor, search Events by phone, sensor or Event name. The selector
groups results by plugin and retains the chosen Event while you search. Enabled rules use the Task’s **Combine rules** choice: OR accepts any matching
rule; AND combines current matching comparisons. See AND / OR rules below. A reading comparison
runs when it becomes true; a nonmatching reading rearms it. Occurrence Events
can run for each distinct matching occurrence instead.

To change a step's action, choose **Replace**, then select its replacement from
the action library. The highlighted step keeps its place and enabled state; its
parameters are replaced with the new action's defaults. **Cancel replacement**
leaves the step unchanged. Binding labels in summaries are for reading; edit the
original `{{event.field-id}}` tokens in the parameter fields.

New Event runs retain source/Event names as they were at admission. Older runs
without these names say so; changing a Task or plugin does not rewrite history.

Administration links appear before the plugin catalogue. Use Find a plugin to
filter that catalogue without changing plugin enablement. Settings groups General,
Appearance, Automation, History and Network; its theme row names the current
theme. On phones, Services has expandable Details and Controls uses stacked rows.
Task activation help and Vista URL/spacing remain available in disclosures so the
working editor is visible sooner. Invalid fields reveal their containing section.

Settings controls your server name, separate administrator/display themes and font
sizes, time format, server location, LAN address, Activity retention and Do not
disturb. Schedules use the server PC's system timezone. Activity retention applies
to server/plugin activity logs, not all runtime records.

Plugin entries come from folders under plugins/. Enable only trusted plugins
you want to run. Configure named sources in Settings before selecting them in
Events, Cards or Tasks. See [PLUGINS.md](PLUGINS.md).
Plugin appearance offers a searchable local Material Symbols glyph catalogue.
Existing glyph choices remain supported. All icons/fonts are bundled locally;
no Google Fonts connection is needed while using Sormus.

## Build a Task

An empty installation offers **Create demo** on Overview. The optional example
connects a Simulator Task, Signal lab Card and Vista. Open its screen, then run
the Task to see real changes. It requires no device or account and never starts
automatically. Edit the Task in its normal editor and explore its Card/Vista
through the plugin and Vistas pages. The demo shortcut only runs its original
definition; after editing, review and run it in Tasks.

For guided setup, choose **Set up Recipes** in Tasks and enable the optional
Recipes plugin. Tasks then offers **Build a task** directly. Its wizard offers a cloud of
ideas. Choose one, personalize it, then choose when it should happen. Tap either
part of the finished sentence to change it. Create task saves it turned off;
enable it in Tasks when ready. More options and the detailed editor are available
when needed. See [Recipes](plugins/recipes/README.md).

Administration → Variables lists supported Event tags, Card bindings, List
columns, ready-made slots, action parameters and start rules. Filter by owner or
context, search and copy code. File references are relative to the installation
root; examples are fragments. Stop Sormus before editing saved JSON directly.
The catalogue updates from declarations and configured sources without listing
live values or credentials. `{{event.field-id}}` uses a captured Event, not a
global/latest-state lookup or general expression language.

Open Tasks and create a Task. Set its name, Enabled state and when it should run.
Use **Add rule** for schedules, timers, intervals, solar events or an available
plugin Event. Timers count once from rule enablement; intervals repeat from
enablement. Sunrise/Sunset use Server location. Weekly days start on Monday.
Multiple rules can start the same ordered Task.

Use the action library to add steps in order. Log activity and Delay are built
in; additional choices come from enabled ready plugins. Insertion controls choose
where a step goes. Edit its declared fields before saving.
Search by action or plugin name, or use the Plugin filter. Each library choice
names its owner; unavailable choices explain what needs attention.

Event comparisons use an actual declared payload property. Contains text is a
case-insensitive literal substring without regular expressions. Use the value
picker to insert `{{event.field-id}}` in supported text parameters. Missing or
incompatible bindings must be fixed before effects can run.
Labels beneath text inputs identify inserted Event fields. A manual Event run
shows captured values only after you select a saved Event; it does not substitute
current readings or emit a new Event.

Run starts an enabled ready Task manually. An Event-based manual run can select
retained matching Event history. A finished run's Rerun opens a preview of the
current Task, captured Event values and resolved public values for its steps.
Opening the preview does not run anything. Select Rerun from step one to start
with that run's captured Event values, including steps that previously succeeded.
It does not resume an old step or rewind triggers. Pause, readiness, revision
and overlap checks still apply. Manual TV actions can run during Do not disturb.

Failed runs show their recorded failed step and following steps not run in the
list. Recognized connection errors offer a shortcut to the plugin's Connection
panel. This shortcut does not test a connection or rerun a Task automatically.

Task runs can be filtered by Task or result. Details shows the trigger, captured
Event values, step results and durations where recorded. Completed means the
step returned, not that a device confirmed the intended state. Older history
can lack step timing. At most the first 256 step receipts are shown for one run;
longer Tasks still execute all their steps.

Activity and each plugin Log support message search, plugin/Task/severity/type
filters, grouping of identical entries and Pause display. Pausing freezes this
view only; server logging continues. Filters and grouping never delete records.

Do not disturb inhibits automatic TV effects during manual or weekly quiet
hours. Manual Controls and Run/Rerun remain available. An overnight period
belongs to its selected starting day. Skipped effects are not replayed later.

## Cards and Vistas

In a plugin's Cards tab, create a Card and choose an ordinary presentation or
ready-made design, then select its source and available properties. Unknown
readings show No data. Save and enable the Card.

Create a Vista under SERVER. The Layout editor starts with Canvas. Add rows or
columns, set their supported CSS widths/heights, then use the Card library to
insert Cards. Add here chooses the destination container. A Collection switches
between its Cards by interval or a new bound reading, with a chosen transition.
Edit, copy, reorder and enable blocks in the same popup.
Use the Source filter and search in the Card library. The Adding to label names
the current insertion destination. Size presets write the same width/height
fields as manual CSS values. Show preview alongside layout keeps preview visible
while editing; the selected block is outlined without altering the public page.

Preview, save and enable the Vista, then open its displayed URL. Each Vista has
a separate browser URL. Collections keep their rotation across ordinary data
refreshes. Cards/Vistas are read-only; they do not send plugin commands.
Open this Vista uses its own URL. Use on shared display changes the Vista shown
at `/display`; Selected for /display identifies that selection separately from
whether a Vista is enabled.

## Universe

Open SERVER → Universe → Edit. Add enabled ready-made Cards from the searchable
library, choose order/shuffle, stop duration and minimum/maximum flight time.
Zero stop seconds keeps moving through successive Cards. No selected Cards
leaves a scenery-only display. Disabled/missing selections are skipped.

Choose a default world, population density, detail/LOD, view distance and flight
motion. Space object switches apply only to Space. Start with Low detail on
older displays. Reduced motion and missing WebGL use stationary Card fades.
Pause flight, Next Card and Fullscreen affect only that browser.

| World | Browser URL |
| --- | --- |
| Saved default | `/universe` |
| Space | `/universe?world=space` |
| Ocean depths | `/universe?world=ocean` |
| Alpine mountains | `/universe?world=mountains` |
| Calm forest | `/universe?world=forest` |
| Sunset dunes | `/universe?world=dunes` |

World links override scenery and share selected Cards and journey settings.
They do not create separate saved Universes. A saved Webpage `/universe` in
Open on TV shows the saved default; themed query links are direct-browser links.
Editing Universe does not launch a TV. The older-Tizen path targets ES5/WebGL1;
verify appearance and performance on your own hardware.

## Remotes, scenes and TV notices

For a fullscreen sensor overview, save an enabled Webpage with exact URL
`/phone-information`, then select it in a manual Open on TV Task. The 1920×1080
Sensorium-style screen shows one enabled phone's public readings and pages
through its complete sensor catalogue. Units, accuracy, sample age and offline
status remain explicit. It does not retain phone callback history. Sensors and
a phone must be enabled; no automatic Task or saved Page is supplied.

Use Left/Right for full-screen gauge, phone-event, map and List pages, and Up/Down
to change phones. There are no visible buttons or automatic page changes. Phone
states such as battery are latest observations held only in RAM; after a server
restart, Stop/Start Android streaming if an unchanged state remains No data.
Notification message content is excluded. GPS needs the optional Location source
and Android access. The local Natural Earth country/coastline map sends no
coordinates to a provider and offers no street-level detail or recorded track.
The next map page shows OpenStreetMap streets across a 300-metre-wide area,
with a 50-metre scale and the same fix details. It requires internet and sends
the viewed map area and your network IP address to `tile.openstreetmap.org`.
Only visible tiles load; no prefetch or location history is kept. Map data:
[© OpenStreetMap contributors](https://www.openstreetmap.org/copyright).

Create an enabled Controls page in a supported plugin and map its declared
actions. TV Remote uses Remote/Apps/More. Lighting uses Devices/Groups/Scenes.
Choose **Controls → Lighting animations** to manage lighting sequences.
For a starting point, see [TV and lighting examples](examples/controls/README.md).
The optional installer adds disabled examples only to empty Controls stores;
it never imports another user's devices or overwrites existing remotes.
A sent command is not proof of the final physical state. Never assume an
unavailable reading means Off.

Controls → Lighting scenes → Save current lighting saves selected recent readings. Enable the
scene before using it or selecting Run lighting scene in a Task. Fade duration
controls supported brightness/white/colour transitions, not simple on/off. Add
an explicit Delay if a later step must wait for a gateway-controlled fade.

Samsung TV Show TV notice offers Notice, Alarm, Alert and Warning, optional
sound/looping and timed or manual dismissal. Untimed notices show elapsed time.
TV Back or the administrator can dismiss an active notice. The Tizen launcher
keeps an underlying page when possible; it cannot reliably relaunch an arbitrary
previous third-party app. See [TV setup](tv-tizen/README.md).

Webpage Open on TV selects an enabled saved public page, contained custom local
HTML or exact `/universe`. Put your display files under assets/pages/; its README
explains resource and isolation requirements.
The bundled sci-fi and solar-system pages can be selected by their local paths.
They have no saved sources or automatic Tasks until you create your own.

## Games

Open Server → Games for Neon Labyrinth. Play locally opens `/games/maze`; Start
on TV uses your configured Samsung TV and installed Vista Tizen app. Up/Down
walk, Left/Right turn, Enter starts/pauses and Back pauses. Find EXIT, collect
gems and finish quickly for points. Every exit opens a larger maze.
Edit size/growth, scoring, movement, detail and optional looping local music.
User music is not bundled. Runs stay in browser memory; only each browser's
best score is stored locally. See [Games](GAMES.md) for setup and controls.

## Updates and backups

Stop this installation before replacing application files. Keep a secure backup
of your own private settings/data; Windows DPAPI stores are account-bound.
Extract updates separately and review compatibility before transferring private
data. Never upload a backup or configured folder to GitHub. Ignore rules are
a safeguard, not a substitute for reviewing commits.

## Reconnect a TV or Oculus Go

Open the plugin’s Settings and use its Connection panel. Test connection checks
remote authorization separately from status polling and reports the result and
test time. It does not launch apps or trigger Tasks.

For a Samsung TV IP change, update TV address, retain the verified certificate
and select Update pairing address. This requires a protected TLS pairing with a
previously verified certificate. An older pairing must first pass Test connection
at its old address, or use an authorized replacement token at the new address.
Port 8001 requires an authorized replacement token after address changes.

For Oculus Go, update Wi-Fi address and select Test connection. The saved key is
reused and the configured headset serial must match. Wireless ADB must already
be enabled and the key authorized on the headset. Sormus does not enable
wireless ADB or restart the PC’s shared ADB service. Expand Connection setup and
recovery for detailed steps. Clear replacement credential fields after a
successful test; protected credentials remain available on this Windows account.

## Oculus Go application library

Enable Oculus Go and its APK library, select your own APK folder, then open Controls → VR library. Scan lists standalone APK versions. Read installed apps captures user applications from the configured headset. Install is an explicit replacement action; Uninstall requires confirmation and deletes saved app data. Operations are cancellable and never replayed automatically. No VR application collection or personal library content is included.

For the native VR interface, download the Oculus Go app from Downloads and install it with your authorized headset tools. It appears as **# Sormus #**. Select Connect headset in the administrator, then enter the LAN address and one-use code in the app's Settings. Browse Library, filter Installed or Updates, search, favorite titles and play locally installed apps. Codes expire after five minutes. See [Sormus Go](plugins/oculus-go/android/README.md) for controls, compatibility and build instructions. 

## Controls and Controller setup

Open **Controls** for Lighting scenes, Lighting animations, Remotes, Controller
setup and VR library. Each tool has one destination. Use Lighting scenes to
design, capture, name, copy, enable and apply saved lighting. New scene opens
a per-light editor for power, brightness and supported colour or warmth. The
Lights remote also offers Save as scene to capture current reported settings.

In **Controls → Controller setup → Choose Tasks**, select which saved Tasks
appear on Controller. Select **Show in Controller**, optionally change the label
or glyph, and Save. This adds a shortcut; it does not enable a Task or change its
rules. Tasks requiring captured Event values can be unavailable for manual use.
The page lists exactly which shortcuts are visible or hidden.

Install Controller from **Downloads**. Connect at home using the server address
shown in Controller setup. For remote access, configure Google Apps Script once,
then select **Connect a phone** and enter its six-character code in Controller.
Connection details arrive automatically. See [the complete steps](CONTROLLER.md).

Controller has Lights, Tasks, Remotes and Cards. Settings shows the connection,
server address, appearance, optional phone sharing and app updates. Full remotes
and Cards work at home; approved scenes and Tasks can work away from home.

## Appearance

**Settings → Appearance** separates Administrator theme/font size from Display
theme/font size. Display settings apply to Vistas, Cards, previews and browser
controls. Controller has its own Dark appearance preference. Themes never
change saved lighting or device state.

## Downloads and updates

**Administration → Downloads** lists the available Controller phone APK,
Sormus Vistas and PlayStation TV apps/source, Oculus Go app and relay script.
Each entry shows its version, type, size and readiness. Only Controller is a phone
APK. Not built or unavailable means the server cannot supply a verified file.
See [Downloads](DOWNLOADS.md) for installation and private configuration exports.

The available package version does not prove it is installed on a device.
Controller → Settings → App updates shows installed and server-available versions.
Install over the same signed package to retain preferences. Server updates do
not silently replace native apps. Close and reopen TV content after updating
viewer scripts; an active notice or game is not interrupted automatically.

## Setup guide and display fit

Overview → Setup guide offers Connect a device, Create a display and Use my phone.
It reports current configuration/enablement and opens the ordinary editors;
choosing a path never enables a plugin, tests a device or creates saved content.

Webcam → List cameras works before enablement. Choose an explicit name/index and
save the selection before starting capture. The scan does not open a camera.

Vista Preview warns when a visible ready-made Card needs scrolling at that size.
Collections can show different Cards later. Use a larger region or fewer details
for a TV, and check its actual fallback layout; the browser warning is not a
size guarantee. Layout map selection and these fit hints are not saved settings.

## Fullscreen Cards

Choose a ready-made design ending in **· Fullscreen** for a 1920×1080 Vista.
Use a single full-Canvas Card or collection with zero padding/gap. See
[Fullscreen layouts and available details](FULLSCREEN-CARDS.md).

### AND / OR rules

In the Task editor, **Combine rules** offers **OR · Any rule** (the default) and
**AND · All rules**. OR starts when any enabled rule fires. AND combines the
latest reported comparisons, such as phone connected AND ambient light below
50 lux. Add a comparison to every enabled Event rule. It runs when all become
true, then rearms when a comparison becomes false. Unknown readings block it.
Distinct matching Events, such as separate video releases, can each start it.

In AND mode, schedules, timers, intervals, sunrise and sunset must fall due
together; the Event comparisons must be true at that moment. A blocked occurrence
is skipped. Use OR for alternative times. Disabled rules are ignored. With no
enabled rules, start the Task manually. Manual Run and Rerun bypass these rules.

After restart, pause or source reconfiguration, AND waits for fresh comparison
reports. Existing true claims are preserved to prevent duplicate runs. Event
variables come only from the report starting the run, not from other comparisons.
Time-based starts provide no Event variables. The Variables page documents the
`ruleMode` property for JSON authors; use the administrator to edit live Tasks.

## Phone shortcut availability

Controller explains why a Task cannot run, including disabled Tasks, missing Event values, unavailable plugins or scenes, and concurrent-run limits. Fix the indicated setup in the administrator. AND conditions from a phone require its current reporting session; retained sensor values from an offline phone do not satisfy a condition. Offline presence can be selected as its own condition.

