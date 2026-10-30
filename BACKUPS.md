# Backup and restore

Open **Settings → Backup and restore → Create backup**. Sormus reads saved
configuration twice, rejects concurrent changes, encrypts the snapshot, and
verifies that it can be unlocked before showing it in the list. Creating a
snapshot does not change Tasks, plugin enablement or connected devices.

Snapshots include server/tray preferences, Tasks, Vistas and display selection,
Cards, Controls, Universe, Games settings, Controller sharing and approved-phone
records, device inventory, lighting animation definitions, plugin settings and
DPAPI credential files, and the home-map layout and canonical images. They are
configuration backups: executable application files, custom page/media/APK
libraries, plugin cached state (including watched/history data), Activity logs,
runtime claims/receipts, process locks and Windows integration are excluded.
Administrator sign-in/password/session files are also excluded: restores retain
current access protection. See [Administrator access](ADMIN-ACCESS.md) for local recovery.
Keep a separate copy of custom assets and the matching application software.

## Local protection and storage

Files live under `data/backups`. Each snapshot uses AES-256-GCM authenticated
encryption and per-file SHA-256 checksums. A random local encryption key is
protected by Windows CurrentUser DPAPI, with application-specific entropy.
No plaintext key or credential content is returned by the backup API. Backup
creation and recovery make no provider requests and upload nothing.

Copy the **whole `data/backups` folder**, including `key.dpapi`, to separate safe
storage. Recovery requires the original Windows account and computer. Losing
the key or that account's DPAPI protection prevents decryption. These local
snapshots are not password-portable backups for moving to another computer.
Do not publish the backup folder, private settings or configured installation.

## Automatic backups

**Backup options** enables backups before updates and retains 1–50 automatic
snapshots (default: on, five snapshots). Setup stops the owned installation
normally, creates the backup using the installed version, and proceeds only
after success. An older installation without backup support cannot create this
snapshot. A manual ZIP/source update instead gets a settings snapshot on the
first start of a different server version, before settings/adapters load; it
does not recover replaced executable files. An identical existing pre-update
snapshot is reused. Turning the option off skips automatic snapshots.

Retention removes only older **Before update** snapshots after a successful
backup/options save. Manual and restore safety snapshots stay until explicitly
deleted. Keep at most 200 snapshots in the local list. Limits are 2,048 files,
16 MiB per file, and 64 MiB of saved data per snapshot.

## Preview and restore

1. Choose **Preview restore**. Review added/replaced/removed file paths, the
   backup version, and Task/plugin counts. Previewing changes nothing and shows
   no credential values. Installed plugin versions must match the snapshot;
   newer or incompatible server versions cannot be restored to older software.
2. Confirm the review reminder and choose **Pause and stage restore** (or
   **Stage restore** when already paused). Sormus pauses first, checks that
   settings still match the preview, and creates a separate safety snapshot.
   Active Tasks/operations must finish first. No saved definitions are replaced
   during staging. The preview expires after five minutes and is single-use.
3. Use the tray menu's normal **Restart server**. Recovery runs under the server
   folder lock before stores, Tasks, or adapters start. All restored Tasks and
   plugins are disabled, and the server stays paused. Review connections and
   definitions, enable what you want, then resume explicitly.

While staged, administrator edits and Resume are blocked. **Cancel staged
restore** leaves current definitions and the safety snapshot intact, with the
server paused. Restart recovery is journalled: an interrupted application is
completed on the next normal start; partially applied settings are never loaded
by the running server. Runtime receipts and history stay current, rather than
being rewound to the snapshot. Unreferenced current map images are retained.

If external edits change saved files after staging, startup refuses to replace
them. With the server stopped, run:

```powershell
.\runtime\node.exe server/backups-cli.mjs --cancel-restore
```

This cancels a staged restore only. An already applying restore must finish on
the next normal start. If a backup is damaged or cannot be decrypted, retain its
original files/key and review the installation; Sormus does not replace it with
defaults or fall back to an unencrypted copy. Restore does not change firewall
rules, Windows startup registration, install clients, or send device commands.

Themed Vista setup state (`data/theme-pack.json`) is configuration and is included with saved Cards and Vistas. Restoring a snapshot from before pack creation removes that later journal as well as the later content, allowing explicit setup again. Backups do not restore application code; version compatibility checks still apply.
