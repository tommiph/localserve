# HSL Trains

Finnish passenger train station boards · Source: Fintraffic / Digitraffic, CC BY 4.0

## Setup

Add a Finnish station board using the bundled public station catalogue, then choose arrival/departure, route and line filters. Uses Fintraffic Digitraffic; no API key is required. Upcoming times are provider reports, not guaranteed movements.

Starts disabled with fresh default settings, no cached readings, saved Cards or Controls. Configure through the shared administrator; do not copy credentials from someone else's installation.

## Settings

- **Polling interval**: Applies per enabled location. Serial requests are staggered; API caching and slow requests can delay events.. Choices: 1 minute, 2 minutes, 5 minutes.
- **Locations**: Named Finnish station boards. Add separate route or line filters at the same station. Source: Fintraffic / Digitraffic (CC BY 4.0)..
  - **Location ID**: string
  - **Name**: string
  - **Station**: Choose or type a station name/code. Kerava: KE; Pasila: PSL; Helsinki: HKI. Bundled passenger station catalogue; new codes can be typed.
  - **Show trains**: string
  - **Route station**: Optional: departures must stop here later; arrivals must have stopped here earlier. Kerava → Pasila: Station KE, Departures, Route station PSL. Direct trains only.
  - **Train line**: Optional single line, for example K, R, I, P or Z. Blank includes all matching lines.
  - **Train category**: string
  - **Advance notice (minutes)**: Upcoming events use the estimate, or scheduled time when no estimate exists. Zero fires only when a poll observes that time; use confirmed events for reported movements.
  - **Enabled**: boolean

## Actions and events

Actions: Refresh trains.

Events: Train arriving; Train departing; Train arriving or departing; Train arrived; Train departed; Train arrived or departed.

Plugin actions appear in global Tasks only when the plugin is enabled and ready. Explicit device actions can have real effects. Polling failures retain successful same-target readings; missing values remain explicit and uncertain effects are not automatically retried/replayed.

## Cards

Ready-made designs: Platform. Designs are package assets, not preconfigured saved Cards. Create a Card, choose its source and enable it before adding it to a Vista. Cards and Vistas are read-only; Controls/Tasks own actions.

## Data attribution

Fintraffic / Digitraffic: https://www.digitraffic.fi/en/railway-traffic/

CC BY 4.0 https://creativecommons.org/licenses/by/4.0/

Filtered and formatted by Localserve

See [installation instructions](../../INSTALL.md) for storage, credentials and LAN access. Private mutable files are created only under this plugin's data folder.
