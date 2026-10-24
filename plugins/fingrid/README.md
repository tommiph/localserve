# Fingrid

Finland electricity system datasets and latest readings

## Setup

Enter your own Fingrid Open Data API key and add named numeric dataset IDs. No key or sample dataset entries are installed. Queries are rate-limited; enabling many sources can slow background refreshes.

Starts disabled with fresh default settings, no cached readings, saved Cards or Controls. Configure through the shared administrator; do not copy credentials from someone else's installation.

## Settings

- **Fingrid API key** (private secret): Stored privately in this plugin, masked here and excluded from Cards. Sent only as the x-api-key header to data.fingrid.fi..
- **Pause API calls**: boolean.
- **Polling interval**: Per enabled Dataset, staggered serially. API reads are spaced by at least two seconds. Many sources may slow polling to stay within the local request budget.. Choices: 3 minutes, 5 minutes, 15 minutes, 30 minutes, 1 hour.
- **Dataset language**: string. Choices: English, Finnish.
- **Datasets**: Add a named time-series dataset from data.fingrid.fi. Separate readings, Cards and Task events. Copies start disabled..
  - **Source ID**: string
  - **Name**: string
  - **Dataset ID**: Enter the numeric Dataset ID shown on its Fingrid dataset page. Only time-series datasets are supported; units and period times come from the API.
  - **Enabled**: boolean

## Actions and events

Actions: Refresh dataset.

Events: Reading updated; Value changed.

Plugin actions appear in global Tasks only when the plugin is enabled and ready. Explicit device actions can have real effects. Polling failures retain successful same-target readings; missing values remain explicit and uncertain effects are not automatically retried/replayed.

## Cards

Ready-made designs: Grid, Grid · Fullscreen. Designs are package assets, not preconfigured saved Cards. Create a Card, choose its source and enable it before adding it to a Vista. Cards and Vistas are read-only; Controls/Tasks own actions.

## Data attribution

Source Fingrid / data.fingrid.fi: https://data.fingrid.fi/en/about

CC BY 4.0 https://creativecommons.org/licenses/by/4.0/

Values unchanged; labels and dates formatted. Other publishers may have dataset-specific licenses. Fingrid does not warrant completeness or accuracy.

See [installation instructions](../../INSTALL.md) for storage, credentials and LAN access. Private mutable files are created only under this plugin's data folder.
