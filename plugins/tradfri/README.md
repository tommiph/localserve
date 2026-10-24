# TRÅDFRI

Legacy IKEA gateway lights, groups and lighting controls

## Setup

Supports the legacy IKEA TRÅDFRI gateway, not DIRIGERA. Enter your private gateway IPv4 and printed security code, enable and refresh to derive Windows-protected credentials. Clear the security-code input after success. Add your own Controls page and device mappings; no lighting scenes, gateway identities or routines are supplied.

Starts disabled with fresh default settings, no cached readings, saved Cards or Controls. Configure through the shared administrator; do not copy credentials from someone else's installation.

## Settings

- **Gateway address**: Private IPv4 address of the original TRÅDFRI gateway. DIRIGERA is not supported..
- **Gateway security code** (private secret): Optional replacement: the code printed on this gateway. A refresh derives a Windows-protected identity/PSK. Clear after success; a nonempty setting remains private plaintext..
- **Fade duration (seconds)**: Brightness, white temperature and colour transitions, including saved scenes. 0–60 seconds, rounded to 0.1 second; 0 means immediate. Simple on/off commands do not fade..
- **Polling interval**: number. Choices: 30 seconds, 1 minute, 5 minutes.

## Actions and events

Actions: Refresh lights and groups; Reauthenticate gateway; Set light power; Set light brightness; Set light white temperature; Set light color; Set group power; Set group brightness; Restore light state; Run lighting scene.

Events: Lights updated; Light changed.

Plugin actions appear in global Tasks only when the plugin is enabled and ready. Explicit device actions can have real effects. Polling failures retain successful same-target readings; missing values remain explicit and uncertain effects are not automatically retried/replayed.

## Cards

Ready-made designs: Nordic, Nordic · Fullscreen. Designs are package assets, not preconfigured saved Cards. Create a Card, choose its source and enable it before adding it to a Vista. Cards and Vistas are read-only; Controls/Tasks own actions.

See [installation instructions](../../INSTALL.md) for storage, credentials and LAN access. Private mutable files are created only under this plugin's data folder.
