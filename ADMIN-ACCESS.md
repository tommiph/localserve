# Optional administrator sign-in

Administrator sign-in is **off by default**. There is no default password or
cloud account. Leaving it off preserves Sormus's existing trusted PC/private
LAN administration. Open **Settings → Administrator access → Enable sign-in**
when you want a local password. Enter and confirm a 10–256 character password,
name this browser, and save. Only saving enables protection.

## What sign-in protects

When enabled, an administrator session is required for administrator pages and
private APIs: settings/credentials, Task editing/runs/history, backup and restore,
source editors, diagnostics, preview frames and VR library administration.
The administrator's existing Host, exact Origin and write-token checks remain.
Published Vistas, Cards, Home map, Control room, Portal, watch guide and scoped
remote/Home actions retain their existing access and capability checks.

Native Controller approval, Sensors ingress and Sormus Go bearer authorization
remain separate. An administrator session does not grant new native or display
capabilities. This is not a viewer/remote password feature or multi-user role
system. Review what you publish to those local pages separately.

Sormus still uses local HTTP, without built-in TLS. Passwords/session traffic
are not encrypted in transit by this feature. Use a trusted PC/private network;
do not expose its port on the internet or an untrusted network. Browser sessions
do not protect files from the Windows account owner or trusted plugin code.

## Sessions and password changes

Each sign-in creates a named administrator browser session lasting up to twelve
hours, with an absolute expiry. Up to 32 sessions can be active. Settings lists
their names, last use and expiry, and identifies the current session. Rename a
session or revoke it there; revocation takes effect on subsequent private
requests and checked responses. Already admitted operations may finish.
**Sign out this browser** removes only the current session.

Sessions are bound to the server origin used for sign-in. Sign in separately
when changing between localhost, a LAN address, or a different port. They can
survive a normal server restart at the same address. A new password revokes all
previous sessions and signs in the browser making the change. Password changes
and **Turn sign-in off** require the current password. Turning protection off
clears the saved password derivation and sessions, returning administration to
its original trusted-LAN access; it does not change Tasks, devices or pause.

Only a salted scrypt password derivation and SHA-256 session-token hashes are
persisted in private `data/admin-access.json`. Raw passwords and session tokens
are not returned in administrator state or written to logs/settings. Browser
tokens use HttpOnly, SameSite=Strict cookies; HTTP prevents use of Secure cookies.
Login work has bounded concurrency and per-peer/global attempt limits. After
too many attempts, wait ten minutes before retrying. No automatic password reset
or account registration service is used.

## Local recovery and backups

If you forget the password, on the server PC:

1. Stop this Sormus installation normally from its tray menu.
2. Run from its folder:

   ```powershell
   .\runtime\node.exe server/admin-access-cli.mjs --disable
   ```

3. Start Sormus again. Sign-in is off and all administrator sessions are revoked.
   Configure a new password in Settings if desired.

The command reserves the installation's server lock and refuses to run while
the server is active. It retains Tasks, plugin settings, credentials, Vistas and
the home map. Invalid/unreadable access files fail closed and are retained for
offline repair rather than silently disabling protection.

Configuration backup/restore intentionally keeps current administrator access
settings and sessions: it does not copy, rewind or disable sign-in. Access files
are excluded from configuration snapshots. Configure access separately when
moving data to a different installation. The local recovery command remains
available to the Windows file owner independently of a backup.
