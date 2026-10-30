# PlayStation

PSN presence, active game, playtime and trophies

## Setup

Sign in to PlayStation in your own browser, then open https://ca.account.sony.com/api/v1/ssocookie in that browser. Enter only your own npsso value, enable and refresh. After success clear the NPSSO input; the Windows-protected session remains. This reads PSN account presence and history, not physical console power, and sends no console/account controls.

Starts disabled with fresh default settings, no cached readings, saved Cards or Controls. Configure through the shared administrator; do not copy credentials from someone else's installation.

## Settings

- **NPSSO token** (private secret): Enter only the 64-character value from Sony. After a successful refresh, clear this field; the Windows-protected session is retained. A nonempty value is saved in private settings..
- **Polling interval**: Presence refreshes at this interval. Profile, playtime, trophies and console details refresh every 5 minutes or when the active game changes.. Choices: 1 minute, 2 minutes, 5 minutes.

## Actions and events

Actions: Refresh PSN status.

Events: PSN status updated; PSN presence changed; Play session activity.

Plugin actions appear in global Tasks only when the plugin is enabled and ready. Explicit device actions can have real effects. Polling failures retain successful same-target readings; missing values remain explicit and uncertain effects are not automatically retried/replayed.

## Cards

Ready-made designs: Gaming lounge, Gaming lounge · Fullscreen, Sci-fi console, Hacker terminal, Rustic almanac, LCARS display. Designs are package assets, not preconfigured saved Cards. Create a Card, choose its source and enable it before adding it to a Vista. Cards and Vistas are read-only; Controls/Tasks own actions.

See [installation instructions](../../INSTALL.md) for storage, credentials and LAN access. Private mutable files are created only under this plugin's data folder.

## PlayStation mode

The optional /playstation-mode screen and separate Tizen app combine HDMI 1 with current-game readings, trophy collections and observed session Activity. See [setup and controls](../../PLAYSTATION-MODE.md). Observation times reflect polling; the global Activity retention setting applies. No exact physical console state is inferred.
