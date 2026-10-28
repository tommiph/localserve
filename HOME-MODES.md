# Home modes

Home modes is an optional plugin for shared Home, Away, Evening and Night state.
Add example modes creates four editable examples with no assigned Tasks. The plugin starts disabled in
a fresh installation, and no mode is selected automatically.

## Set up

1. Open Home modes in the administrator and enable the plugin in Settings.
2. Open Modes. Choose Add example modes for a starting set, or Add mode.
   Add or edit a mode's name, Material Symbol, color and Enabled state.
   Copy creates a disabled entry; Delete removes its definition.
3. Optionally choose a saved Task for Task on entry. Enable that Task before use.
4. Select a mode in Modes, Controller, Control room or the TV Launcher's Home page.

The selected mode is server state, not confirmation that devices changed.
Selecting it again does nothing. A different selection is saved before its Event
and Task are dispatched. Restarting restores the selection without replaying
Events or Tasks. Editing a name, symbol, color or Task assignment does not run it.
If the selected mode is disabled or deleted, no enabled current mode is displayed.

Enabled modes are available to home-network controllers. Assigning a Task grants
execution through that mode even if it is not published separately in Controller.
Task on entry bypasses that Task's automatic start rules. It runs once on a real
change, carries the captured Home mode Event, uses the normal Task concurrency
limits and respects automatic TV Do not disturb. A missing, disabled or failed
Task leaves the mode selected; inspect Tasks and Activity. No Task is retried.
One Task bound to the mode and also matching its Event is admitted only once.
Mode-triggered Task chains retain the engine's bounded causal ancestry.

## Use in Tasks

- Add the Home modes action Select home mode, then choose a named mode.
- Add the Home mode Event to react to changes. Compare Mode name (for example,
  Home) or the stable Mode ID. Renaming a mode changes its name comparison.
- Use Combine rules: AND to combine a current-mode comparison with another
  source, such as a phone or light reading. Restored mode state is available to
  these comparisons, but other sources still require their normal fresh reports.
- Event values include mode-id, mode-name, previous-mode-id, previous-mode-name,
  changed-at and transition-id. To use them in a Task's text, declare the Home
  mode Event in that Task's rules, then use the Event value picker. For example,
  {{event.mode-name}} is the captured name, not a later live selection.

## Displays and phones

Card designer includes the Home status ready-made design, with current mode,
previous mode and selection time. Create an enabled Card instance to put it in a
Vista. Names follow current definitions, and selectors use each mode's color. The
previous name/time remain historical observations.

The direct mode selector uses the home network. Existing Controller APKs can
load it from the server; no new phone permissions or installation are needed.
For away-from-home use, publish a Task containing Select home mode through
Controller setup and use the existing optional relay. The relay does not publish
the direct selector or extra mode settings.

## Availability and data

Server pause, unavailable/disabled plugin, disabled modes and stale selector
capabilities prevent selection. If multiple enabled plugins declare the selector
contract, controls remain unavailable rather than guessing an owner. A lost
response is uncertain: inspect the current mode and Activity before selecting
again. Refreshes never resend a selection command.

Mode definitions live in the plugin's private configuration; selected state is
stored in its private state file. Public replies contain enabled mode names,
symbols, colors and selection capabilities, not assigned Task IDs or arguments.
The separate bounded receipt store prevents repeated public requests; a damaged
receipt file is retained and disables public selections without stopping the
server. It is excluded from source distributions together with all saved state.
