# Google Apps Script

An optional outbound HTTPS inbox for remote phone reports, lighting scenes,
published Task shortcuts and external Task Events. No inbound server port is
opened. Starts disabled and needs your own Google deployment and private keys.

Follow the [setup and Android workflow](../../GOOGLE-APPS-SCRIPT.md). Generate
keys in the plugin Settings, deploy the bundled `server/apps-script/Code.gs`,
then approve new Controller phones with the short code shown in Settings.
Their individual connection details are transferred automatically. The signed
collector sync installs and rotates client credentials in the private Google
configuration; phones cannot change client permissions or register other clients.

Only granted capabilities are admitted. Sensor clients are pinned to one phone
installation; Task shortcuts must be explicitly published in Phone home. All
commands use normal pause, readiness, revision and durable execution checks.
Receipts distinguish cloud queueing from actual local completion. Uncertain
requests are not replayed automatically. This is a low-rate relay, not a VPN.

The plugin declares **Synchronize relay** and **Message received**. Its generic
Event exposes Message ID, Client ID, Channel, Message, Value, Active and Sent at.
Sensors use their existing typed capabilities with separate relay presence
Events. There is no ready-made Card for this transport plugin.

Private profiles, Google configuration, phone readings and receipt stores are
not included in distributable source. Never publish exported JSON or real keys.
