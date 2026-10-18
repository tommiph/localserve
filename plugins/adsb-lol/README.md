# adsb.lol

Nearby aircraft from adsb.lol public position reports

## Setup

Add an Area with your coordinates, radius in nautical miles and maximum reported position age. Enabling the plugin and Area sends those coordinates to api.adsb.lol. No map, route enrichment or device control is provided.

Starts disabled with fresh default settings, no cached readings, saved Cards or Controls. Configure through the shared administrator; do not copy credentials from someone else's installation.

## Settings

- **Polling interval**: Per enabled area, staggered serial reads. Provider backoff can slow refreshes.. Choices: 1 minute, 2 minutes, 5 minutes, 10 minutes, 15 minutes.
- **Areas**: Named search areas. Coordinates are sent to adsb.lol only when this plugin and area are enabled or explicitly refreshed..
  - **Area ID**: string
  - **Name**: string
  - **Coordinates (latitude, longitude)**: Decimal degrees, for example 60.3,25.0. New entries prefill Server location; saved areas remain independent.
  - **Radius (nautical miles)**: number
  - **Maximum reported position age**: number
  - **Enabled**: boolean

## Actions and events

Actions: Refresh aircraft.

Events: Aircraft reading updated; Aircraft first observed.

Plugin actions appear in global Tasks only when the plugin is enabled and ready. Explicit device actions can have real effects. Polling failures retain successful same-target readings; missing values remain explicit and uncertain effects are not automatically retried/replayed.

## Cards

Ready-made designs: Airspace. Designs are package assets, not preconfigured saved Cards. Create a Card, choose its source and enable it before adding it to a Vista. Cards and Vistas are read-only; Controls/Tasks own actions.

## Data attribution

Aircraft data: adsb.lol: https://www.adsb.lol/

ODbL 1.0 https://opendatacommons.org/licenses/odbl/1-0/

Aircraft positions may be incomplete or delayed. Not for navigation.

See [installation instructions](../../INSTALL.md) for storage, credentials and LAN access. Private mutable files are created only under this plugin's data folder.
