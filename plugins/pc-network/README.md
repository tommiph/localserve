# PC and Network

Windows CPU, GPU, memory, storage, adapters and network name lookups

## Setup

Enable to read this Windows PC's CPU, memory, fixed drives, network counters and supported GPU readings. Unsupported values remain unavailable. Neighbor names come from the existing cache and bounded lookups, not a network scan. No separate monitoring service or credentials are needed.

Starts disabled with fresh default settings, no cached readings, saved Cards or Controls. Configure through the shared administrator; do not copy credentials from someone else's installation.

## Settings

- **Refresh interval**: Each refresh samples counters for one second. Completion-based polling avoids overlap and catch-up bursts.. Choices: 10 seconds, 30 seconds, 1 minute.
- **Resolve local hostnames**: Try reverse DNS for up to two existing private IPv4 neighbor-cache entries per refresh. Missing names remain unavailable; this is not an exhaustive device inventory..

## Actions and events

Actions: Refresh PC status; Look up name or address.

Events: PC status updated; Network lookup completed.

Plugin actions appear in global Tasks only when the plugin is enabled and ready. Explicit device actions can have real effects. Polling failures retain successful same-target readings; missing values remain explicit and uncertain effects are not automatically retried/replayed.

## Cards

Ready-made designs: Observatory, Observatory · Fullscreen. Designs are package assets, not preconfigured saved Cards. Create a Card, choose its source and enable it before adding it to a Vista. Cards and Vistas are read-only; Controls/Tasks own actions.

See [installation instructions](../../INSTALL.md) for storage, credentials and LAN access. Private mutable files are created only under this plugin's data folder.
