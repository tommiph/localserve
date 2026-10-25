# Lighting animations

Open **Controls → Lighting animations** in the administrator, or visit `/lighting-animations`.
The page includes Party mode, Disco floor, Fine dining, Aurora borealis,
Candlelight, Sunset lounge, Ocean drift, Forest canopy, Neon city, Moonlight and Lightning.
Nothing starts automatically, including after a server restart.

## Play

Configure and enable the original TRÅDFRI gateway plugin, then refresh its
readings. Choose **Start** on an enabled animation, select up to ten reported
lights and set a duration. **0 minutes** runs until you choose **Stop**. Starting
turns the selected lights on. The animation runs on Sormus even if you close
the browser. Only one animation can run at a time.

RGB bulbs use colour and brightness. White-temperature bulbs use warmth and
brightness; other bulbs use brightness. **Spread colours across lights** offsets
each light's colour/brightness palette position; the current step owns hold and
fade timing for all lights. Turn it off for the same step across all
lights; gateway commands are serial, so changes are not perfectly simultaneous.

**Stop** cancels future commands and leaves the last requested lighting values.
A fade already accepted by the gateway may finish. Manual lighting Controls or
Task lighting commands take over and stop the animation. Failed commands stop
the run without retry. Command acceptance does not confirm the bulbs' final
state; ordinary plugin readings remain authoritative.

Pausing server functions freezes future steps and the optional duration timer.
Stop still works while paused. Editing/disabling/deleting the active animation,
changing the plugin configuration, losing plugin readiness, or shutting down
stops its remaining work. Restart records an interrupted run without resuming it.

## Edit

Every animation supports **Edit**, **Copy**, **Delete** and **Enabled**. Copies
and new animations start disabled. The editor keeps a sequence of up to 32
steps. Add, copy, reorder, enable or delete steps in the popup without leaving
the gallery. Saving an active animation stops its current run.

Each step has colour, brightness (0–100%), warmth (0 cool to 100 warm), minimum
and maximum hold times (0.1–3600 seconds), and fade time (0–60 seconds). Equal hold
limits give a fixed duration; different limits choose a random hold on each pass.
Brightness 0 sends an explicit Off command. Fade must fit inside the minimum hold. A copied
step starts disabled. Enable at least one step before saving.

Hold begins after commands for that step have been delivered. Gateway fades
use tenths of a second. Animation fades override the plugin's default for that
command only; saved scene and remote defaults are unchanged. Commands are
serialized with at least 500 ms between lights, so gateway latency and larger
light selections slow fast presets. There are no catch-up bursts, audio syncing
or guaranteed high-frequency strobe timing. The colour artwork is a preview, not a live
representation of light state.

### Lightning

Lightning alternates 100% white and Off, with immediate transitions and random
short/long gaps. It defaults to a one-minute run with no lights selected. Edit
the hold ranges and duration to change the effect. Fewer selected lights give
faster changes: every gateway command still completes serially without retry or
catch-up bursts. This is not a synchronized hardware strobe. The gallery and
Start dialog identify rapid-flash sequences; avoid use around anyone sensitive
to flashing light. The gallery artwork itself does not strobe.

## Files and integration

`server/lighting-animations.mjs` owns validation, preset seeds and execution.
`assets/lighting-ui.js` supplies the administrator gallery/editor. Definitions
and bounded run receipts are private installation data under
`data/lighting-animations.json` and `data/lighting-animation-runs.json`. Existing
definitions survive upgrades; missing stores alone receive the eleven defaults.
Invalid stores disable this feature without overwriting them. Distribution
builds exclude saved definitions and run history.

Authenticated administrator POST routes under `/api/lighting-animations` use
the normal Origin/token and shutdown admission checks. Definitions are revisioned;
Start also requires a request UUID, current revision, target IDs and duration.
The last 50 run identities prevent retained duplicate submissions from replaying.
Only server-owned animation context can suppress per-command informational
logging; lifecycle and failure records remain in Activity. No arbitrary gateway
endpoints, direct worker connections or privileged browser controls are exposed.
