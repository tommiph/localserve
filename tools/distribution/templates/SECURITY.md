# Security and private data

Sormus is for a trusted local PC/private LAN. Optional administrator password
sign-in is off by default; enable it in Settings when desired. Administrator
sessions protect private APIs independently of existing display/native
capabilities and Host/Origin/write-token checks. It has no built-in HTTPS:
sign-in does not encrypt traffic or protect published local controls. Do not
forward its port to the internet, publish a tunnel or use an untrusted network.
Maintain Windows, the browser and dependencies. See [Administrator access](ADMIN-ACCESS.md).

Plugins are trusted executable code; worker supervision is not a sandbox. Review
plugin source before installation. Some actions control real devices. Read-only
Cards/Vistas/Universe must not gain those capabilities.

Enter your own credentials through the administrator. Masked inputs may be
private plaintext on disk; selected credentials use Windows CurrentUser DPAPI.
Do not share config.json, data/, plugins/*/data/, tray/settings.json, Android
preferences, logs, backups, signing files or captures. Restrict provider keys
when possible and never paste secrets in issues/chats.

Sensors intentionally trusts LAN devices without pairing. Enable it only where
you trust network devices. Phone sources are opt-in; notification text and precise
location may be sensitive. Latest raw samples are not a history archive, but
Tasks can retain captured public Event values in run history. Activity retention
does not delete all Task/application records.

Reproduce issues with disabled integrations or Simulator when possible and remove
private values from logs/screenshots. Use private GitHub vulnerability reporting
when offered. Do not publish exploit details alongside credentials or user data.
This repository does not provide managed hosting or a guaranteed response time.
