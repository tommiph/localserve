# Simulator

Local actions, values, and events

## Setup

Enable for local test actions, values and events without a device. Leave Configuration complete on unless testing readiness behavior. On an empty installation, Overview offers an optional Create demo button for an editable Task, Signal lab Card and Vista; nothing runs automatically.

Starts disabled with fresh default settings, no cached readings, saved Cards or Controls. Configure through the shared administrator; do not copy credentials from someone else's installation.

## Settings

- **Configuration complete**: boolean.

## Actions and events

Actions: Log message; Set value; Emit signal; Emit pulse; Wait; Fail action.

Events: Signal; Value changed; Pulse.

Plugin actions appear in global Tasks only when the plugin is enabled and ready. Explicit device actions can have real effects. Polling failures retain successful same-target readings; missing values remain explicit and uncertain effects are not automatically retried/replayed.

## Cards

Ready-made designs: Signal lab, Signal lab · Fullscreen. Designs are package assets, not preconfigured saved Cards. Create a Card, choose its source and enable it before adding it to a Vista. Cards and Vistas are read-only; Controls/Tasks own actions.

See [installation instructions](../../INSTALL.md) for storage, credentials and LAN access. Private mutable files are created only under this plugin's data folder.
