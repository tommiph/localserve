# PlayStation Tizen application

This separate optional TV application opens the Sormus `/playstation-mode`
screen and HDMI 1 in the upper-left at 50% size with 2% outer margins, or
full-screen behind a transparent game HUD. Info switches modes when the remote
supports it; Channel Up → Display mode offers the same choice. It has its
own application ID (`LsPsMode01.PlaystationMode`), PS5 launcher icon, connection
preferences and version (`app/config.xml`). Vista remains a separate application.

Import `app/` into your own official Samsung/Tizen TV web development workspace,
configure your author/distributor certificates and authorized TV target, then
build/sign/install. The example address in `app/launch.js` must be configured for
your own Sormus LAN server; the installed application also offers connection
settings. A source distribution includes no signing material or signed widget.
Keep all relative assets together. See [PlayStation mode](../../PLAYSTATION-MODE.md)
for data, controls, session logging, video geometry and compatibility limits.

For a project-local configured SDK, `runtime/node.exe tv-tizen/build.mjs playstation`
and `runtime/node.exe tv-tizen/install.mjs playstation` build/install only this
application. These local signing/install helpers require your own configured SDK
and are not supplied as an automatic signing workflow in a clean distribution.
Installation does not launch the app, select an input or wake the console.

Only the packaged parent uses the public `tv.window` privilege. The optional Info
key and Channel Up/Down/media controls use `tv.inputdevice`. Back closes this app;
Channel Up opens settings and Play/Pause controls HUD motion, not console gameplay.
Version 1.3.0 adds Channel Down to cycle Edges/Top/Right/Bottom/Left/Single-line
scroller. Version 1.3.1 also offers No HUD for an unobstructed full-screen HDMI
picture. Channel Down restores Edges; Channel Up still opens settings. HUD layout and 0–100% opacity are saved locally. Address fields request
the keyboard only after OK; focus alone leaves them read-only.
Its server frame can report scoped connection state, request Back and choose
one of the two fixed layouts; it cannot supply an HDMI
number, arbitrary native command or navigation URL. Explicit app launch/return
selects HDMI 1 once, after the current server frame confirms its data connection.
Cancellation handles late native callbacks without replay or automatic retries.
Full-screen HUD uses MAIN/BEHIND and transparent documents; split uses MAIN/FRONT.
The layout preference persists only on this TV and applies after native success.

PS5 and PlayStation are Sony Interactive Entertainment trademarks. This is an
independent Sormus integration. See the [artwork notice](../../assets/playstation-mode/NOTICE.md).

The launcher uses a landscape 16:9 icon and local static Rajdhani fonts under
`app/fonts/`, with their SIL Open Font License. Keep the font files and license
with the application when packaging.
