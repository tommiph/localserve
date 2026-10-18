# Finavia

Finnish airport flight boards · Source: Finavia Public Flights

## Setup

Obtain your own Finavia Public Flights API key and add a Location/airport board. This plugin uses the fixed apigw.finavia.fi gateway and app_key header. Availability depends on provider access and your key.

Starts disabled with fresh default settings, no cached readings, saved Cards or Controls. Configure through the shared administrator; do not copy credentials from someone else's installation.

## Settings

- **API key** (private secret): Private Finavia subscription key. Sent only in the authentication header; never included in Cards or Vistas..
- **Polling interval**: Applies per enabled location. Serial requests are staggered; provider caching and slow requests can delay events.. Choices: 1 minute, 2 minutes, 5 minutes.
- **Locations**: Named Finnish airport boards with optional route and flight filters. Source: Finavia Public Flights..
  - **Location ID**: string
  - **Name**: string
  - **Airport**: Choose a Finnish airport or type its three-letter IATA code, for example HEL, OUL or RVN.
  - **Show flights**: string
  - **Route airport**: Optional route stop IATA code, for example LHR. Blank includes all routes. No transfer planning.
  - **Flight number**: Optional exact flight or codeshare number, for example AY1331. Blank includes all flights.
  - **Advance notice (minutes)**: Upcoming events use the current estimate, or schedule when no estimate exists. Confirmed events require a provider actual movement time.
  - **Enabled**: boolean

## Actions and events

Actions: Refresh flights.

Events: Flight arriving; Flight departing; Flight arriving or departing; Flight arrived; Flight departed; Flight arrived or departed.

Plugin actions appear in global Tasks only when the plugin is enabled and ready. Explicit device actions can have real effects. Polling failures retain successful same-target readings; missing values remain explicit and uncertain effects are not automatically retried/replayed.

## Cards

Ready-made designs: Departure lounge. Designs are package assets, not preconfigured saved Cards. Create a Card, choose its source and enable it before adding it to a Vista. Cards and Vistas are read-only; Controls/Tasks own actions.

## Data attribution

Finavia: https://apiportal.finavia.fi/

API terms https://apiportal.finavia.fi/signup

Filtered and formatted by Localserve

See [installation instructions](../../INSTALL.md) for storage, credentials and LAN access. Private mutable files are created only under this plugin's data folder.
