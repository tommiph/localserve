# Using Localserve

## Administrator and services

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

Settings controls your server name, theme, separate administrator/Vista font
sizes, time format, server location, LAN address, Activity retention and Do not
disturb. Schedules use the server PC's system timezone. Activity retention applies
to server/plugin activity logs, not all runtime records.

Plugin entries come from folders under plugins/. Enable only trusted plugins
you want to run. Configure named sources in Settings before selecting them in
Events, Cards or Tasks. See [PLUGINS.md](PLUGINS.md).
Plugin appearance offers a searchable local Material Symbols glyph catalogue.
Existing glyph choices remain supported. All icons/fonts are bundled locally;
no Google Fonts connection is needed while using Localserve.

## Build a Task

An empty installation offers **Create demo** on Overview. The optional example
connects a Simulator Task, Signal lab Card and Vista. Open its screen, then run
the Task to see real changes. It requires no device or account and never starts
automatically. Edit the Task in its normal editor and explore its Card/Vista
through the plugin and Vistas pages. The demo shortcut only runs its original
definition; after editing, review and run it in Tasks.

For guided setup, open Recipes and enable it. Its Create page offers a cloud of
ideas. Choose one, personalize it, then choose when it should happen. Tap either
part of the finished sentence to change it. Create task saves it turned off;
enable it in Tasks when ready. More options and the detailed editor are available
when needed. See [Recipes](plugins/recipes/README.md).

Administration → Variables lists supported Event tags, Card bindings, List
columns, ready-made slots, action parameters and start rules. Filter by owner or
context, search and copy code. File references are relative to the installation
root; examples are fragments. Stop Localserve before editing saved JSON directly.
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
retained matching Event history. A finished run's Rerun starts the current Task
from step one with that run's captured Event values. It does not resume an old
step or rewind triggers. Pause, readiness and overlap checks still apply.

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
For a starting point, see [TV and lighting examples](examples/controls/README.md).
The optional installer adds disabled examples only to empty Controls stores;
it never imports another user's devices or overwrites existing remotes.
A sent command is not proof of the final physical state. Never assume an
unavailable reading means Off.

Lighting Save as scene captures selected complete recent readings. Enable the
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
