# Oculus Go

Read-only Wi-Fi headset diagnostics

## Setup

Requires wireless ADB already enabled, the exact headset serial, a private IPv4:port and an already authorized RSA key. Enter Base64 of that authorized key in the masked replacement setting; clear it after a successful authenticated refresh. Localserve does not enable debugging, authorize a new key, scan devices, use USB or control the headset.

Starts disabled with fresh default settings, no cached readings, saved Cards or Controls. Configure through the shared administrator; do not copy credentials from someone else's installation.

## Settings

- **Wi-Fi address**: The headset’s local IPv4 address and ADB port, for example 192.168.0.7:5555. No automatic network scan..
- **Headset serial**: Readings require this exact serial; an address reused by another device is rejected..
- **Authorized ADB key (Base64)** (private secret): Optional replacement: Base64 of a 2048-bit RSA PEM key already authorized by the headset. After a successful refresh, clear this field; the Windows-protected key remains. Nonempty settings are saved privately as plaintext..
- **Polling interval**: Serial supervised reads. Failed polls retain successful readings and do not retry immediately.. Choices: 15 seconds, 30 seconds, 1 minute.

## Actions and events

Actions: Refresh diagnostics.

Events: Status updated; Headset changed.

Plugin actions appear in global Tasks only when the plugin is enabled and ready. Explicit device actions can have real effects. Polling failures retain successful same-target readings; missing values remain explicit and uncertain effects are not automatically retried/replayed.

## Cards

Ready-made designs: Orbital. Designs are package assets, not preconfigured saved Cards. Create a Card, choose its source and enable it before adding it to a Vista. Cards and Vistas are read-only; Controls/Tasks own actions.

See [installation instructions](../../INSTALL.md) for storage, credentials and LAN access. Private mutable files are created only under this plugin's data folder.
