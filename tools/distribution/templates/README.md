# Sormus

<!-- demo:start -->
<!-- The demo link is generated from project-info.json. -->
<!-- demo:end -->

Sormus is a Windows automation server with a browser administrator, plugins,
step-by-step Tasks, mobile device remotes and read-only information displays.

## Install and start

[Download Windows Setup or the portable ZIP](https://github.com/tommiph/sormus/releases).
Choose the newest preview and read its release notes. Windows 10/11 x64 and
Microsoft .NET Framework 4.8 or later are required. Preview builds are unsigned.

For Setup, run the downloaded executable as your normal Windows user and select
**Open Sormus** at the end. It adds Start menu shortcuts and opens the
administrator. Sign-in startup is optional. See [setup details](tools/installer/README.md)
for upgrades and data retention.

For a portable/source installation:

1. Clone or download the complete repository into a writable folder on a Windows
   10/11 x64 PC. Extract a downloaded ZIP before running anything.
2. Double-click **Start Localserve.cmd**. Keep the supplied folders together.
3. Open **Open administrator** from the Sormus notification-area icon.
4. Configure a plugin in its Settings, enable it, then create your own Tasks,
   Cards, Vistas or Controls.

The Windows Node runtime and server dependencies are included. No npm install,
global Node installation, AI subscription or cloud hosting is required. Provider
plugins need their services and your own credentials. Android and TV components
are optional.

For remote phone reports and scene/Task shortcuts without exposing your PC,
see the optional [Google Apps Script relay](GOOGLE-APPS-SCRIPT.md).

Read [installation and troubleshooting](INSTALL.md), [the user guide](USER-GUIDE.md)
and [plugin setup](PLUGINS.md). Developers and AI coding tools should start with
[CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).
Generic [TV and lighting remote examples](examples/controls/README.md) are
included with an installer that preserves existing remotes. Configure your own
devices before enabling them. [Local display examples](assets/pages/README.md)
include a sci-fi screen and solar-system screensaver.

## Follow the setup guide

Open **Overview ? Setup guide** whenever you need a next step. Choose **Connect a
service**, **Create a first Task**, **Create a display** or **Use Controller**.
The guide shows current setup counts and opens the ordinary editors. It does not
enable plugins, save content, send device commands or run Tasks.

For a first Task, the guide prepares a disabled, unsaved **Log activity** draft.
Review it, leave automatic rules empty, enable it and save. Run it once from Tasks,
then check its completed run and Activity. Publish selected Tasks to your phone in
**Controls ? Controller setup ? Choose Tasks**.

For a real device or information source, complete its plugin Settings, enable it
when ready and inspect its readings. **Configure** means required fields are
missing; **Ready** describes the plugin runtime, not proof of a successful device
response. Overview separates the latest check from the latest reported reception
and gives next-step hints when an enabled service needs attention.

## Your first Task

For a finished example, choose **Create demo** on Overview in an empty
installation. It enables only Simulator and creates an editable Task, Signal lab
Card and Vista. Open the demo screen, then choose **Run demo Task** to watch its
value, pulse count and message change. Nothing runs automatically and no devices
or provider accounts are needed. Existing content is never replaced.

To start from scratch instead:

1. Open **Tasks**, create a Task and name it **First Task**.
2. Add the Server action **Log activity** and enter a short message.
3. Enable the Task and save it, leaving automatic rules empty.
4. Run it manually. Check its completed run and find your message in **Activity**.

Server actions work without enabling Simulator or another plugin.

This uses no device or provider account. Add rules and real plugin actions when
you are ready. See the [user guide](USER-GUIDE.md) for Tasks and display setup.

## Features

- **Home modes:** persistent named modes, optional Tasks on entry, current-mode
  conditions and selectors in Controller, Control room and TV Launcher. See
  [Home modes](HOME-MODES.md).

- **Recipes:** a visual step-by-step builder for actions, device conditions and
  schedules, with editable intent summaries and optional detailed editing.

- **Tasks:** manual starts, schedules, timers, intervals, sunrise/sunset and plugin
  Events; ordered actions, delays, Event-value substitutions and manual Rerun.
- **Vistas:** browser displays built from nested rows, columns, Cards and rotating
  Card collections. Ready-made designs are available in the Card editor.
- **Webcam:** a local Windows camera Card with movement and relative brightness
  Events for Tasks. Capture is opt-in; no audio or recordings are stored.
- **Universe:** 3D Card journeys through Space, Ocean depths, Alpine mountains,
  Calm forest and Sunset dunes, with configurable travel, population and detail.
- **Lighting animations:** eleven editable TRÅDFRI palettes, per-step fades and
  explicit Start/Stop controls. See [Lighting animations](LIGHTING-ANIMATIONS.md).
  The [TRÅDFRI control room](TRADFRI-CONTROL-ROOM.md) provides desktop room controls,
  complete device inventory, lighting scenes and reported-state feedback.
- **Games:** Neon Labyrinth, an endless first-person maze game with TV remote
  controls, gems, speed scoring and optional local looping music. See [Games](GAMES.md).
- **Controls:** mobile TV and lighting remotes; local lighting scenes and supported
  transitions. Remote web app installation depends on browser/HTTPS support.
- **Control room:** a separate desktop/tablet page for scenes, published Tasks,
  room controls, full remotes and selected live Cards. See [Control room](CONTROL-ROOM.md).
- **Controller:** the Android phone app for Lights, Tasks, full Remotes and
  ready-made Cards, with optional phone sharing in Settings. Choose phone Tasks
  in **Controls → Controller setup** and edit lighting scenes on the server.
  See [Controller](CONTROLLER.md).
- **Downloads:** one administrator page for Controller, TV widgets and source,
  the Oculus Go app and Google Apps Script. Versions and readiness are listed.
  See [Downloads](DOWNLOADS.md).
- **Sormus Launcher:** an optional separate TV home screen for installed apps,
  inputs, displays, lighting scenes and published Tasks. It supports favorites,
  app search, hidden entries, Smart Hub artwork and glyphs, including artwork-only
  tiles. See [Launcher](tv-tizen/launcher/README.md).
- **Samsung TV:** optional Tizen launcher displays Vistas, webpages and notices
  with sound, looping and timed/manual dismissal.
- **Oculus Go:** manual APK library and a separate **# Sormus #** VR client
  with search, favorites, local launch and confirmed package management. Supply
  your own compatible APKs; no application collection is included. See
  [headset setup](plugins/oculus-go/android/README.md).

All bundled plugins start disabled. Tasks, Vistas, selected Universe Cards,
Card instances, remotes, scenes, devices and logs start empty. Ready-made Card
**designs** are included; create and enable your own Card instances.

Defaults are dark theme, 24-hour time, independent 100% administrator/Vista font
sizes and 30-day Activity retention. Time follows the server's system timezone.
No server location or provider/device target is preconfigured.

## Network and privacy

First start listens on localhost and chooses an available port; the tray opens
the actual address. LAN access requires your explicit private address and an
appropriate firewall rule. Sormus has no account login or HTTPS and is
intended for trusted local networks. Do not expose it directly to the internet.
See [SECURITY.md](SECURITY.md).

Private settings and runtime files are generated on your PC and excluded by
.gitignore. Never force-add them or upload a configured installation. No API
keys, accounts, saved user content or private signing keys are included.

## Components and licenses

Source is under server/, web/, plugins/, tray/ and tv-tizen/. Local assets and
dependencies remain alongside their licenses. Android source, its APK and
pinned client libraries are under plugins/sensors/android/. The separate Oculus
Go client, generic APK and VrApi license are under plugins/oculus-go/android/.
Optional SDK/JDK preparation is separate from running the server. Tizen source requires your
own SDK, signing identity and compatible TV.

Sormus-authored code is available under the [MIT License](LICENSE).
Bundled dependencies and third-party assets retain their own licenses and
attribution. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Daily briefing

Use Vistas → Create Today for an animated daily briefing built from your selected Cards, with a balanced story carousel, upcoming previews, rotating essentials, cached movie artwork and layered 3D effects. Read [Today setup](TODAY.md) for source selection, motion preferences and remote controls. TV Calendar and Interests start with empty source lists; configure your own shows and topics in the administrator. Interests includes free publisher RSS/Atom feeds for AI, pop culture, gaming, music, science and daily news, plus country-specific search trends.

## What to watch

Open `/watch`, or Controls > Watch guide, for daily TV and movie suggestions
and the next episodes from your followed shows. Enable TV Calendar and Movies
in the administrator, then refresh their guides. TV Calendar > For you offers
one-click Follow. Movies offers daily picks, Watchlist and Watched views.
The starter movie collection needs no account; optional live discovery and
catalogue search require your own TMDB API read-access token in Movies Settings.
Suggestions do not confirm availability on a streaming subscription.

Enable Library movie suggestions in Emby to add picks from your own server.
Playback monitoring is separate and can stay off. Create an Emby library Card
to include those individual picks in Today. Watched status is not filtered.
See [Emby setup](plugins/emby/README.md).

Create regular or fullscreen designs through each guide's Create Card button,
or Add ready-made Card in a plugin's Card designer. Choose Daily TV suggestions or Daily
movie suggestions, save and enable the Card, then add it to a Vista. See
[TV Calendar](plugins/tv-calendar/README.md) and [Movies](plugins/movies/README.md).

## The Daily portal

Open `/portal`, or Controls > The Daily, for source-linked headlines and daily information. Configure enabled Interests topics or News searches to populate it. The front page balances topics; choose a topic for its own shareable page. Search the current edition or narrow it by publisher. Refresh edition reads collected information without polling providers or running Tasks.

Your day uses the Cards selected in the enabled Vista with slug `today`: current weather, the next valid train, daylight, followed TV episodes and lighting status. Reception times and cached readings remain visible. It uses the display theme, text size and server time format. It never changes devices. Countdown labels update locally without moving headlines; when a departure has passed, refresh the edition for the next train.

New highlights stories that were absent on your previous visit. Mark edition as seen clears the highlights. This is per browser and server address; a different browser starts a fresh edition. Only up to 500 hashed story identifiers and a visit time are stored locally, with no reading history sent to Sormus. Storage restrictions disable the indicator without hiding stories. Original articles open on their publishers? websites.
