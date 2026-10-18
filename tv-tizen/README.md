# Optional Vista Tizen application source

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
