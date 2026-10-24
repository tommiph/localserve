# Emby

Reported playback sessions from your Emby server

## Setup

Enter your private/loopback Emby URL including port and a dedicated Emby API key. Paste only the key value, without its application label or spaces. Reads sessions only; connected clients without reported media can show No data. No playback or library control is provided.

Starts disabled with fresh default settings, no cached readings, saved Cards or Controls. Configure through the shared administrator; do not copy credentials from someone else's installation.

## Settings

- **Server URL**: Private IPv4 or loopback address with explicit port, for example http://192.168.0.10:8096. HTTPS requires a trusted certificate. No discovery or redirects..
- **API key** (private secret): Paste only the dedicated API key value from the Emby dashboard, without its application name, label or spaces. Used only for read-only session requests; never sent to Cards or Tasks..
- **Polling interval**: Reads reported sessions serially. Playback events are observed changes; no playback commands are sent.. Choices: 10 seconds, 30 seconds, 1 minute.

## Actions and events

Actions: Refresh Emby sessions.

Events: Emby reading updated; Playback started; Playback paused; Playback resumed; Playback stopped.

Plugin actions appear in global Tasks only when the plugin is enabled and ready. Explicit device actions can have real effects. Polling failures retain successful same-target readings; missing values remain explicit and uncertain effects are not automatically retried/replayed.

## Cards

Ready-made designs: Screening room, Screening room · Fullscreen. Designs are package assets, not preconfigured saved Cards. Create a Card, choose its source and enable it before adding it to a Vista. Cards and Vistas are read-only; Controls/Tasks own actions.

See [installation instructions](../../INSTALL.md) for storage, credentials and LAN access. Private mutable files are created only under this plugin's data folder.
