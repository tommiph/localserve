# Optional Vista Tizen application source

For a dedicated HDMI 1 and PSN information screen, see the separate
[PlayStation application source](playstation/README.md) and
[PlayStation mode instructions](../PLAYSTATION-MODE.md). It has its own app ID
and does not replace Vista.

This folder contains unsigned launcher source only. The Windows server and web
Vistas work without installing a TV application. No author/distributor private
key, signing password, signed widget, developer target, SDK workspace or device
identity from another installation is supplied.

The packaged parent keeps a sandboxed full-screen web frame alive for HTTP/HTTPS
URL launches and timed or manually dismissed Task notices. Invalid/blank launch arguments return to its
configured default. Embedding restrictions still apply. It never receives an
administrator token or device credentials.

Before building for your own TV:

1. Choose a fixed private LAN address/port for your Localserve server and enable
   the intended Vista or use `/display`.
2. Replace the example default URL in `app/launch.js` with your own complete LAN
   display URL. The distribution uses the documentation-only address
   `http://192.0.2.1:7041/display`, which is not a working default on your network.
3. Import `app/` as a TV web project into the official Samsung/Tizen development
   tools. Install your own SDK locally if needed; it is a development dependency,
   not part of the Windows server runtime. Preserve the folder's relative assets.
4. Configure your own author/distributor certificates and authorized TV target,
   then build/sign/install through that tool's workflow. Keep all generated
   credentials, signing files and output packages private. This distribution does
   not provide an automatic signing/install script or perform device discovery.

The source keeps application ID `HwGlance01.HomeGlance`. Updating a package that
was already installed under another author requires that author's signing
identity; this ZIP deliberately provides none. Use your own appropriate package
identity for an independent install if required by your development workflow,
and use its reported ID in Localserve's Samsung TV Launch installed app action.

The example default is deliberately inert until configured. Task launch arguments
may choose a saved Vista URL. TV notices require a working compatible launcher
installation and your own authorized Samsung TV plugin configuration. No TV
control, firmware or universal compatibility is implied by these sources.

The launcher supports elapsed-time notices and optional looping
audio, with cancellation on dismissal/hide. Plain URL launches open full screen;
embedded pages retain their original embedding restrictions. No personal default
Vista URL, TV target, signed widget or example automatic Task is supplied.

## Connection and remote control

The default path is `/display`, following the server's shared Vista selection.
When the server is unavailable, Connection opens automatically. Enter protocol,
server IP/hostname, port and path, then choose Save and connect. The address is
saved on that TV; future menu launches use it. Use /display edits just the path.
Back opens Connection from a Vista. Back from Connection returns to a working
page or closes Vista if no working page is available. Recovery does not overwrite
an unsaved settings draft. Retry and Save and connect are explicit attempts.

Left/Right steps every visible Card collection, wrapping and restarting its
interval. Single Cards remain unchanged. This is local viewing state, never a
saved layout or server display-selection change. Task notice dismissal takes
priority, and other pages retain their own controls. Vista heartbeats use a
scoped navigation challenge and no administrator token. Collection navigation
itself requires no additional Tizen permission.

## Live TV / HDMI window

On a connected Vista, press Back and choose Live TV / HDMI. Select a connected
input, a 25%, 33% or 50% size and a corner, then choose Show video. Up/Down moves
between controls; Left/Right changes the selected option. Refresh sources only
reads inputs. Use the remote's normal volume controls.

Video starts off and must be shown explicitly. Showing selects that TV input;
hiding does not restore a previous input. Settings, notices, navigation,
connection loss and leaving the app hide the window. Choices last for the app
session. Native video overlays Cards without rearranging them. Only tuner/HDMI
inputs are supported, not another installed streaming application.

The source declares the public `http://tizen.org/privilege/tv.window` permission.
Only the packaged parent can select video sources. Web frames and server Tasks
have no PIP command bridge. Errors are reported locally without retries;
availability depends on the TV, its firmware and the selected signal. See the
[Samsung TVWindow reference](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/tvwindow-api.html).
