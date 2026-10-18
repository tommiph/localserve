# Localserve

Localserve is a Windows automation server with a browser administrator, plugins,
step-by-step Tasks, mobile device remotes and read-only information displays.
Demo: https://youtu.be/iRawtvXB6DQ

## Install and start

1. Clone or download the complete repository into a writable folder on a Windows
   10/11 x64 PC. Extract a downloaded ZIP before running anything.
2. Double-click **Start Localserve.cmd**. Keep the supplied folders together.
3. Open **Open administrator** from the Localserve notification-area icon.
4. Configure a plugin in its Settings, enable it, then create your own Tasks,
   Cards, Vistas or Controls.

The Windows Node runtime and server dependencies are included. No npm install,
global Node installation, AI subscription or cloud hosting is required. Provider
plugins need their services and your own credentials. Android and TV components
are optional.

Read [installation and troubleshooting](INSTALL.md), [the user guide](USER-GUIDE.md)
and [plugin setup](PLUGINS.md). Developers and AI coding tools should start with
[CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).
Generic [TV and lighting remote examples](examples/controls/README.md) are
included with an installer that preserves existing remotes. Configure your own
devices before enabling them. [Local display examples](assets/pages/README.md)
include a sci-fi screen and solar-system screensaver.

## Features

- **Tasks:** manual starts, schedules, timers, intervals, sunrise/sunset and plugin
  Events; ordered actions, delays, Event-value substitutions and manual Rerun.
- **Vistas:** browser displays built from nested rows, columns, Cards and rotating
  Card collections. Ready-made designs are available in the Card editor.
- **Universe:** 3D Card journeys through Space, Ocean depths, Alpine mountains,
  Calm forest and Sunset dunes, with configurable travel, population and detail.
- **Games:** Neon Labyrinth, an endless first-person maze game with TV remote
  controls, gems, speed scoring and optional local looping music. See [Games](GAMES.md).
- **Controls:** mobile TV and lighting remotes; local lighting scenes and supported
  transitions. Remote web app installation depends on browser/HTTPS support.
- **Android Sensors:** included sideload APK sends selected raw sensors and
  optional phone, location, region and activity events over your trusted LAN.
- **Samsung TV:** optional Tizen launcher displays Vistas, webpages and notices
  with sound, looping and timed/manual dismissal.

All bundled plugins start disabled. Tasks, Vistas, selected Universe Cards,
Card instances, remotes, scenes, devices and logs start empty. Ready-made Card
**designs** are included; create and enable your own Card instances.

Defaults are dark theme, 24-hour time, independent 100% administrator/Vista font
sizes and 30-day Activity retention. Time follows the server's system timezone.
No server location or provider/device target is preconfigured.

## Network and privacy

First start listens on localhost and chooses an available port; the tray opens
the actual address. LAN access requires your explicit private address and an
appropriate firewall rule. Localserve has no account login or HTTPS and is
intended for trusted local networks. Do not expose it directly to the internet.
See [SECURITY.md](SECURITY.md).

Private settings and runtime files are generated on your PC and excluded by
.gitignore. Never force-add them or upload a configured installation. No API
keys, accounts, saved user content or private signing keys are included.

## Components and licenses

Source is under server/, web/, plugins/, tray/ and tv-tizen/. Local assets and
dependencies remain alongside their licenses. Android source, its APK and
pinned client libraries are under plugins/sensors/android/; optional SDK/JDK
preparation is separate from running the server. Tizen source requires your
own SDK, signing identity and compatible TV.

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for dependency terms.
Third-party open-source licenses do not grant a license to Localserve-authored
code. Review applicable licensing before redistribution.
