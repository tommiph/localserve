# Control room

Open **Administration → Controls → Control room → Open**, or visit `/control-room`
on your server. This separate page is designed for desktop browsers and tablets.
It provides everyday operation without editing server configuration.

## What appears

- **Current state** summarises reported remote readings and availability.
- **Your controls** opens each enabled remote in a popup, including the full TV
  and lighting remotes. Closing it returns to the same page position.
- **Lighting scenes** runs enabled scenes from enabled lighting remotes.
- **Tasks** runs shortcuts selected in **Controls → Controller setup → Choose
  Tasks**. These buttons run a Task once; they do not change its schedule or
  enabled state. Tasks requiring captured Event values remain unavailable.
- **Rooms** shows reported gateway groups. Open one for group power/brightness
  and individual light controls when complete membership is available. A light
  can appear in several rooms. Unreported members are not guessed.
- **At a glance** displays ready-made Cards from enabled plugins. **Choose Cards**
  selects up to six for this browser; the default uses three different plugins
  when available. Only Card identifiers are saved in browser storage.

Room controls use the existing remote's public catalogue: up to 20 lights and
10 groups per lighting remote. The full administrator inventory is separate.
Room names and membership are edited in TRÅDFRI administration, not here.

## Setup and appearance

Configure and enable remotes, scenes, plugins and Task shortcuts in administration.
No devices, home modes or sample readings are invented for an empty installation.
Card selection is personal to the browser. Clearing its site storage resets it.
The page uses the end-user **Display theme** and **Vista font size**, independently
of administrator appearance. Dates and time follow the server's timezone and
12/24-hour preference. All fonts, icons and artwork are served locally.

## Commands and connection

Sliders send on release or keyboard change. Reported values stay separate from
the selected value until a later matching reading arrives. Command completion
does not prove the device reached the requested state. Stale lighting readings,
server pause and unavailable capabilities disable new inline commands.

An action runs only after an explicit tap. The page tracks its existing receipt;
it never automatically retries a command. If the connection drops during a save
or run, inspect reported values or Task history before trying again. Browsing,
opening a remote and selecting Cards send no device commands.

The page is intended for the same trusted LAN as existing remotes. It does not
provide an internet relay or expose administrator credentials. Hidden pages stop
their overview/Card polling; visible Cards are refreshed in bounded batches.

## Developer contract

`GET /api/control-room` combines the existing published PhoneHome capabilities,
remote summaries and public lighting targets. Full inventory contributes only
member IDs that already have public remote controls. No raw resources, edit
tokens, action arguments, configuration or administrator state are exposed.
Commands use the existing Control and PhoneHome APIs with their normal scoped
tokens, revisions, durable request identities, pause and cancellation rules.
The page owns no scheduler or duplicate definition store. Keyed DOM updates
retain controls, scroll positions and Card iframe documents across polls.

The Card chooser uses the registry's metadata-only `cardLibrary()` projection;
it does not read plugin state, activity or saved Card stores. Each visible Card
uses `cardSource(pluginId)` to project only its selected plugin, followed by the
existing selected-field/table-row boundary. These synchronous reads use current
enablement, source declarations, runtime status, pause state and server clock;
they do not cache an administrator snapshot or trigger provider polling.
