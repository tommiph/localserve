# Samsung TV

Local Samsung TV readings, apps and remote controls

## Setup

Enter the TV's private IPv4 and explicitly choose port 8002 (TLS) or 8001 (plain). Port 8002 remote actions require the verified exact SHA-256 certificate fingerprint. Remote actions need an already authorized TV token obtained separately through an approved pairing workflow; this plugin does not perform tokenless pairing. Clear the replacement token input after a successful remote action/read. The optional wired MAC is used only by explicit Wake TV. A clean install has no saved remote page or button mappings; create your own Controls page.

Starts disabled with fresh default settings, no cached readings, saved Cards or Controls. Configure through the shared administrator; do not copy credentials from someone else's installation.

## Settings

- **TV address**: This TV’s private IPv4 address. No network discovery or fallback target..
- **Remote port**: number. Choices: 8002 · TLS, 8001 · plain local WebSocket.
- **TV certificate fingerprint (SHA-256)**: Port 8002 remote actions verify this exact self-signed certificate before sending the token. Changing it never happens automatically..
- **Remote name**: Name presented to the TV by this Localserve installation..
- **Remote command interval (ms)**: Minimum spacing between remote commands, in milliseconds. Use 0 for no extra spacing. Connection and delivery time still apply. Applies to remote pages and Task actions; status reads are unaffected..
- **Saved TV pairing token** (private secret): Optional replacement: an already authorized TV token. After a successful remote read/action, clear this setting; the Windows-protected copy remains. Nonempty settings are private plaintext. Status polls do not pair..
- **Wired MAC address**: Used only by the explicit Wake TV action. A wake packet does not confirm power-on..
- **Polling interval**: number. Choices: 30 seconds, 1 minute, 5 minutes.
- **YouTube playback**: Allows Play YouTube video to read this TV’s private screen ID and send it to YouTube for a temporary playback session. No Google account or API key is used. Off by default..
- **YouTube control port**: Explicit port on this same TV for /ws/app/YouTube. No discovery, fallback port or automatic retry..

## Actions and events

Actions: Refresh TV readings; Read installed apps; Send remote key; Set volume; Set mute; Select input; Show TV notice; Launch installed app; Play YouTube video; Open TV browser URL; Play media URL; Resume media; Pause media; Stop media; Send text; Move pointer; Power off; Wake TV; Test connection; Update pairing address.

Events: TV readings updated; Reported TV state changed.

Plugin actions appear in global Tasks only when the plugin is enabled and ready. Explicit device actions can have real effects. Polling failures retain successful same-target readings; missing values remain explicit and uncertain effects are not automatically retried/replayed.

## Cards

Ready-made designs: Home cinema. Designs are package assets, not preconfigured saved Cards. Create a Card, choose its source and enable it before adding it to a Vista. Cards and Vistas are read-only; Controls/Tasks own actions.

See [installation instructions](../../INSTALL.md) for storage, credentials and LAN access. Private mutable files are created only under this plugin's data folder.
