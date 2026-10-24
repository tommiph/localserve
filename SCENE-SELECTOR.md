# Scenes & Tasks

Open `/scenes` on your Localserve server, or choose **Scenes & Tasks** in Phone
Home. The page is designed for phones, tablets and desktop browsers. **Lights**
shows enabled stored scenes from enabled lighting Controls pages. **Tasks**
shows the enabled shortcuts published under **Administration → Phone home**.
Existing scene names and glyphs are used; the selector creates no new scenes
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

To add lighting scenes, save the current lighting state in the lighting remote
and enable the saved scene. To add Tasks, publish them in Administration → Phone
home. The selector uses those existing definitions and permissions.

## Android app

Choose **Get Scenes for Android** on `/scenes`, install the APK, then open
**Scenes**. Set the server's private LAN IP address and port once in **Server
connection**. Future launches open the selector directly. The gear changes the
connection; a failed connection offers address settings and a manual retry.
The launcher uses the black Localserve logo on white; the splash uses a white
logo on black. This separate
app requires no sensor permissions and does not replace Localserve/Sensors.
See [Scenes for Android](apps/scenes/README.md) for installation and building.

The page also has a standalone web-app manifest and local application icons. Use the
browser menu to install it or add it to the home screen if supported. HTTP LAN
addresses may offer only a browser shortcut. No service worker caches private
capabilities or queues offline actions. The Android Localserve APK 1.4.3 also
opens the selector from Home; install the update over the existing app to add
its fixed routes to the native wrapper. Existing sensor settings are retained.

## Contributor contract

`PhoneHome.viewer(true)` projects only scene identities, labels/glyphs, owning
Controls page, current revision/capability, availability and already-published
Task shortcuts. It excludes step arguments, credentials, private readings and
administrator tokens. `/api/scene-selector` is GET-only and accepts no queries.
Writes use the existing revisioned Controls and Phone Home APIs, fresh durable
request identities, exact Origin checks, pause/readiness and shutdown guards.
Scene and Task definitions are never modified by this page. Capability and
receipt data remain in memory; only appearance is saved in browser storage.
