# TRÅDFRI control room

Select **TRÅDFRI** in administration. The desktop workspace opens on **Rooms**.
It uses the original TRÅDFRI gateway; DIRIGERA is a different hub and is not
supported by this adapter.

## Connect the gateway

1. Open **Settings** and enter the gateway's private IPv4 address.
2. For a new connection, enter the security code printed on that gateway.
3. Save the settings and enable the plugin.
4. Use **Refresh lighting** to retrieve the device inventory.
5. Clear the optional security-code setting after successful authentication.
   Derived connection credentials are protected using Windows CurrentUser DPAPI.

Changing the gateway address hides the previous gateway's inventory until a
matching reading arrives. Readiness, reception time and device reachability
describe different things; a configured gateway is not proof of fresh readings.

## Rooms and lights

Rooms shows existing gateway groups. Select a room to filter its lights, or
select All rooms or Ungrouped. Room On/Off buttons send a gateway group command.
The room summary counts reported member-light states; the gateway's group value
does not prove that every member has changed.

Each light tile shows reported power, brightness and capability. Select Adjust
light to open its persistent details panel. White-spectrum bulbs offer warmth;
colour bulbs offer a colour picker. Unknown values remain explicit.

Sliders send on release or keyboard change, not on every drag frame. While a
command is running, further edits retain only the newest value for each setting.
The selected position and Reported value are separate. Brightness and colour
changes do not explicitly include power; use Turn on or Turn off to set power.

The sequence is Sending command → Awaiting reported confirmation → Reported
setting confirmed. After acknowledgement, Sormus refreshes once. Fades may still
be in progress; later normal polls can confirm the requested setting. Group
confirmation refers to the reported group setting. Confirmation does not prove
which application or physical remote caused a coincident change. Timeouts can
have uncertain effects; commands are never automatically retried.

Old readings disable lighting changes until refreshed. Pausing, disabling the
plugin or another active operation prevents new commands. Browsing and searching
send no lighting commands. Slider drafts and operation receipts are transient.

## Edit names and room membership

Use **Edit room** on a room tile to rename that gateway room and choose its
lights. Search filters the choices without changing selections. The summary
shows how many members will be added or removed. A light may belong to more than
one reported room; editing one room does not change the others. Existing non-light
or unreported members are kept and cannot be removed from this editor.

Use **Rename device** in the selected light's details, or **Rename** in Devices,
to change a gateway device's name. Names support up to 64 characters and 128
UTF-8 bytes. These are gateway changes, visible to other applications that read
the gateway. Membership can change which lights a physical control operates.
Neither editor changes light power, brightness or colour. No device is unpaired.

Saving requires a complete, recent inventory and an enabled, idle gateway. Sormus
checks the name and membership against fresh gateway reads before writing. If it
observes an intervening edit, reopen the editor using refreshed values. The
gateway has no atomic compare-and-swap transaction; another application can still
change a room after the final check. Acknowledgement triggers one confirmation
read, with no automatic write retry. If a save has an uncertain result, refresh
and inspect the reported values before opening another editor.

Only existing rooms are editable. Creating/deleting rooms and moving physical
steering devices are not available. Empty light-only
membership can be requested, but acceptance depends on the gateway.

## Devices and capabilities

Devices provides light controls and the complete bounded inventory: up to 100
devices and 100 groups. Reported battery, model and firmware are shown where
available. Serial numbers, credentials and raw protocol objects are excluded.
Existing public Card tables retain their separate 20-light/10-group bounds.

| Capability | Availability |
| --- | --- |
| Light power and brightness | Supported |
| Colour or white warmth | Supported when reported by that bulb |
| Group power and brightness | Supported |
| Full reported inventory | Supported |
| Battery, model and firmware | Read-only, when reported |
| Sormus lighting scenes and effects | Supported |
| Schedules and cross-plugin rules | Global Tasks |
| Device and existing room names | Supported in administration |
| Existing room light membership | Supported; other members are preserved |
| Gateway scene import | Explicit light-only copy when complete stored values are available |
| Plug, blind and air-purifier controls | Not exposed |
| Remote-button and motion events | Not exposed; not inferred from inventory |
| Pairing, removal, firmware installation or gateway reset | Not exposed |

## Scenes, effects and automation

Choose **Create task** on a scene or room, or in a light's details, to open the
global Task editor with that target already selected. Scene shortcuts apply the
stored scene; light and room shortcuts begin with Turn on, which you can edit.
The draft starts disabled with no start rules. Add a schedule or Event, review
the steps and save. Opening the editor does not run the action or publish a
Controller shortcut. Existing Tasks and the global scheduler remain unchanged.

Scenes reuses the administrator lighting scene library. Design per-light settings
or capture current lighting. New/copy scenes start disabled. Saving never changes
lights; Apply explicitly runs the scene. Scenes remain available to Controller
and TRÅDFRI → Run lighting scene in Tasks. Authoring/capture supports 1–20 lights.

New, captured and editable stored-light scenes offer **Transition**. Keep **Use
plugin default** enabled to follow the current fade in TRÅDFRI Settings, or turn
it off and choose 0–60 seconds in tenths. Zero requests an immediate change.
Copies retain the choice. Existing scenes continue using the plugin default
until edited; their saved files are not rewritten during an upgrade.

The stored fade applies wherever that scene is run: Apply, lighting remotes,
Controller, Control room and the global Run lighting scene Task action. Saving
the choice sends no command. Each light starts its transition when its serial
command reaches the gateway; lights are not guaranteed to start simultaneously.
Power commands do not themselves fade, and acknowledgement does not mean the
transition has finished. Use a Delay in a Task when later steps must wait.
Mixed mapped-action scenes keep the plugin default; author or recapture stored
per-light settings to use a scene override.

### Copy a gateway scene

1. Refresh lighting so the complete room inventory is current.
2. Select **Import from gateway** in Scenes and choose a gateway room.
3. Select **Load scenes**, choose a scene, then **Read selected scene**.
4. Review the light list and choose a unique name for the Sormus copy.
5. Select **Import scene**. The copy starts disabled; enable and Apply it when
   you want to change the lights.

Reading and importing never activate or modify a gateway scene. The imported
scene is an independent snapshot, uses the plugin's default fade initially and
does not track later gateway edits. A preview expires after five minutes or
changes to its room, plugin configuration or target scene library. If the save
response is lost, inspect the library before making another explicit copy.

Only 1–20 complete settings for supported, reachable lights can be copied.
Non-light settings, current-state scenes, unavailable members and incomplete
white/colour values block import; nothing is silently omitted or substituted
from the current lighting. XY-only colours are not converted. Larger rooms or
lights outside the remote's public 20-light catalogue may need a separately
authored scene. The picker shows up to 32 gateway scenes per room. Inspect one
room at a time; no observers or extra automatic polling are started.

Effects uses the same library as Controls → Lighting animations. Start explicitly
selects targets. Stop leaves their last requested settings; manual controls take
over from active animations. See [Lighting animations](LIGHTING-ANIMATIONS.md).

Scheduling stays in global Tasks and requires Sormus to run. It does not create
a duplicate gateway scheduler. Activity, Settings, Card designer, Events and
Remotes retain their existing functions.

## Diagnostics

Diagnostics brings together gateway connectivity, the next automatic check,
inventory freshness, battery/reachability reports, last scene progress and
retained execution failures. Opening it reads existing server information; it
does not poll the gateway. **Refresh lighting** explicitly retrieves a fresh
inventory. **View activity** opens the plugin log.

Device capabilities distinguish supported lighting controls from inventory-only
devices. Command acknowledgement, later reported confirmation and retained stale
readings remain separate. A successful response cannot identify which app or
physical remote caused a coincident change. Missing readings stay unknown.

An execution failure identifies the stage and a limited error code without
showing action arguments, credentials or raw gateway data. Windows may briefly
lock a history file during atomic replacement: only that receipt replacement
can be attempted again, up to twice. Lighting commands are never replayed.
Detailed failure categories cover the current server session; older run receipts
and plugin messages remain available through Activity.

## Developer contract

The optional `controls.lighting.inventoryState` declaration enables the workspace.
Adapters retain a bounded typed `schemaVersion: 1` inventory separately from
public Card tables. `GET /api/lighting-room/<plugin>` projects only named fields,
checks gateway identity and never refreshes the gateway.

POST uses normal administrator Origin/token checks and a captured configuration
revision. Callers select reported targets and fixed properties, never action
names or protocol resources. Duplicate request identifiers are rejected within
a bounded in-memory window. Existing actions own validation, serialization,
pause, cancellation and effects. Restart never replays commands. Gateway access
remains serial polling with one reusable owned session; no background observer is introduced.

`POST /api/lighting-room/<plugin>/manage` accepts the captured revision, request
identifier, target kind/ID, name, expected edit token and, for rooms, member IDs.
It derives fixed Settings-only `device-rename` and `room-edit` contracts from
declarations. These operations are excluded from Tasks, Recipes and remote
Controls. Inventory edit tokens cover the gateway name and sorted room members,
not volatile lighting readings. They are conflict markers, not credentials or
device-state proof. The plugin validates fresh targets and changed member types
and sends a single minimal update. Receipts remain transient administrator state.

`controls.lighting.sceneFadeSetting` opts an adapter into per-scene fades by
naming its declared 0–60 second default setting. Optional `fadeSeconds` belongs
to stored-light scene items, not action parameters. Absence means inherit; an
administrator scene save may send null to remove an override. Validation rounds
to tenths. The host admits the override only from the active durable Controls
run, captured page/configuration revision and cancellation signal. It rechecks
that ownership before queued execution. Worker IPC receives the finite fade
only for the declared light-state action; ordinary actions retain the plugin
default. Editing, disabling, cancellation, shutdown and restart never replay a
partially executed scene.


## Mobile lighting administration

TRÅDFRI administration adapts to phones and tablets. Rooms form a horizontal
selector; light controls stack into a single column on narrow screens. Tap a
light name to open its inline inspector, then **Back to lights** to return to
that light. Reported values and unsent edits remain separate. Device inventory
rows become labelled cards on phones. All commands use the same gateway guards
as the desktop interface.

