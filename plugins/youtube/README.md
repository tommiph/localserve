# YouTube

Public channel uploads and new-video events

## Setup

Create your own Google API key with YouTube Data API v3 enabled, then add named public Channels in Settings by ID, handle or supported channel URL. Resolve ambiguous name searches explicitly. First readings establish a baseline; later public uploads can trigger Task Events. Provider quotas/local budgets apply. Optional playback belongs to Samsung TV: configure its authorized remote connection and enable YouTube playback separately. No keys, channel entries, account sessions or automatic TV Tasks are included.

Starts disabled with fresh default settings, no cached readings, saved Cards or Controls. Configure through the shared administrator; do not copy credentials from someone else's installation.

## Settings

- **YouTube Data API key** (private secret): Use a Google API key with YouTube Data API v3 enabled. Stored in private plugin settings, masked here and never available to Cards. Server/IP restrictions work; browser-referrer restrictions may reject server requests..
- **Pause API calls**: Stops upload checks and channel lookup without deleting the key or readings. Resuming does not replay uploads missed while paused..
- **Polling interval**: Minimum interval per enabled Channel, with staggered serial requests. Many Channels may slow checks to target 1,500 daily read units. Current values shows effective cadence and local estimated budgets.. Choices: 15 minutes, 30 minutes, 1 hour, 2 hours, 4 hours.
- **Channels**: Each named Channel has separate Cards and Task events. Copies start disabled. New/changed Channels baseline current public uploads without releasing old events..
  - **Channel source ID**: string
  - **Name**: string
  - **Channel ID, @handle or URL**: Enter an @handle, UC channel ID or supported HTTPS YouTube channel URL. Find channel in Settings lets you search by name and choose a result.
  - **Enabled**: boolean

## Actions and events

Actions: Refresh videos; Find channel.

Events: Video released; Videos updated.

Plugin actions appear in global Tasks only when the plugin is enabled and ready. Explicit device actions can have real effects. Polling failures retain successful same-target readings; missing values remain explicit and uncertain effects are not automatically retried/replayed.

## Cards

Ready-made designs: Studio. Designs are package assets, not preconfigured saved Cards. Create a Card, choose its source and enable it before adding it to a Vista. Cards and Vistas are read-only; Controls/Tasks own actions.

See [installation instructions](../../INSTALL.md) for storage, credentials and LAN access. Private mutable files are created only under this plugin's data folder.
