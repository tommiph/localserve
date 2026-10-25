# Controller

Open `/scenes` in a browser or install [Controller](CONTROLLER.md). Its bottom
tabs show Lights, Tasks, full Remotes and ready-made Cards. Phone reporting and
the active connection are available in the Android Settings screen. Administration
stays on the server. Existing scene names and glyphs are used; the selector creates no new scenes
or Tasks. Disabled plugins and unavailable actions cannot run.

Tap a circular button to run its scene or Task once. The result banner reports
Starting, Running and Completed from the server's receipt. Completed confirms
execution, not a fresh physical light-state reading. One action runs at a time
from this page. If delivery cannot be confirmed, check the detailed remote or
Task history before dismissing the result and trying again. Network recovery
refreshes availability; it never resends commands. Tasks requiring captured
Event values remain unavailable for this manual shortcut.

The appearance button switches between light and dark. This preference belongs
to the current browser and server address. Large circles, visible keyboard focus,
responsive columns and reduced-motion support are included. Theme animations
provide touch feedback; they do not indicate that a scene is currently active.

Manage scenes in **Controls → Lighting scenes**. Select phone Tasks in
**Controls → Controller setup → Choose Tasks**. The selector activates those
existing definitions and uses their current permissions.

## Android app

Install [Controller](CONTROLLER.md) from `/downloads/controller.apk`. Set the
server address once at home. Approved remote connection details are retrieved
automatically. Phone reporting is optional under Settings.

## Contributor contract

The browser uses scoped Scene, Phone home and Card APIs. It receives no
administrator token or relay credentials. One action UUID is committed before
dispatch and uncertain commands are never resubmitted. Preserve stable buttons,
keyboard focus, reduced motion, local themes and cancelled/hidden reads.
The full Lights remote can capture current lighting as a scene. Detailed scene
design and editing stay in administration. Native policies allow only the configured private origin
and fixed viewer resources. Private provisioning is deliberately excluded from
WebView resources. Android source lives under `plugins/sensors/android`.
