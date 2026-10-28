# Home modes

Shared Home, Away, Evening and Night modes with optional Tasks

## Setup

Enable to share editable Home, Away, Evening and Night modes. Examples have no Tasks assigned. Select a mode explicitly; startup never selects a mode or replays its optional Task. See ../../HOME-MODES.md.

Starts disabled with fresh default settings, no cached readings, saved Cards or Controls. Configure through the shared administrator; do not copy credentials from someone else's installation.

## Settings

- **Home modes**: list.
  - **ID**: string
  - **Mode name**: string
  - **Symbol**: string
  - **Color**: string
  - **Task on entry**: Optional. Runs once when this mode becomes active. Restarting or selecting the active mode does not run it again.
  - **Enabled**: boolean

## Actions and events

Actions: Select home mode.

Events: Home mode.

Plugin actions appear in global Tasks only when the plugin is enabled and ready. Explicit device actions can have real effects. Polling failures retain successful same-target readings; missing values remain explicit and uncertain effects are not automatically retried/replayed.

## Cards

Ready-made designs: Home status. Designs are package assets, not preconfigured saved Cards. Create a Card, choose its source and enable it before adding it to a Vista. Cards and Vistas are read-only; Controls/Tasks own actions.

See [installation instructions](../../INSTALL.md) for storage, credentials and LAN access. Private mutable files are created only under this plugin's data folder.
