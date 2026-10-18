# Security and private data

Localserve is for a trusted local PC/private LAN. It has no account authentication
or built-in HTTPS. Administrator/Controls tokens and Host/Origin checks protect
requests, not user login. Do not forward its port to the internet, publish an
unauthenticated tunnel or use an untrusted network. Maintain Windows, the browser
and dependencies.

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
