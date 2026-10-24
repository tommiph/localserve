# Weather

Current weather from wttr.in

## Setup

Add named Locations using a wttr.in query. New coordinates can prefill from your own Server location after you configure it. Each Location owns its readings and polling. No location is supplied by this release.

Starts disabled with fresh default settings, no cached readings, saved Cards or Controls. Configure through the shared administrator; do not copy credentials from someone else's installation.

## Settings

- **Polling interval**: Applies to each enabled location. Requests are staggered across the interval.. Choices: 15 minutes, 30 minutes, 45 minutes, 1 hour.
- **Locations**: Add named locations for separate readings, card fields, and Task events. New Location inputs default to Server location coordinates when configured..
  - **Location ID**: string
  - **Name**: string
  - **Location**: Supported location formats (the leading / is optional):
/paris — City name
/Eiffel+tower — Any location (+ for spaces)
/Москва — Unicode name in any language
/muc — Airport code (3 letters)
/@stackoverflow.com — Domain name
/94107 — Area code
/-78.46,106.79 — GPS coordinates
New entries default to Server location coordinates; saved locations remain editable and independent.
  - **Enabled**: boolean

## Actions and events

Actions: Refresh weather.

Events: Weather updated.

Plugin actions appear in global Tasks only when the plugin is enabled and ready. Explicit device actions can have real effects. Polling failures retain successful same-target readings; missing values remain explicit and uncertain effects are not automatically retried/replayed.

## Cards

Ready-made designs: Atmosphere, Atmosphere · Fullscreen. Designs are package assets, not preconfigured saved Cards. Create a Card, choose its source and enable it before adding it to a Vista. Cards and Vistas are read-only; Controls/Tasks own actions.

See [installation instructions](../../INSTALL.md) for storage, credentials and LAN access. Private mutable files are created only under this plugin's data folder.
