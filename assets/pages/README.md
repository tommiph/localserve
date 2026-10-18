# Your local display pages

Add your own HTML and its package-local CSS/JavaScript here. A Webpage source
can reference `/assets/pages/name.html`, including safe subfolders. Keep paths
relative to this folder/project; no source PC paths or private credentials.
Two generic examples are included: `/assets/pages/scifi.html` (animated sci-fi
display) and `/assets/pages/solar-system.html` (3D solar-system screensaver).
Both use local code/assets and no personal data. No saved Webpage entries or
automatic Tasks are installed. Add either path in Webpage Settings to select it
for an explicit Open on TV action after configuring your own TV connection.

Local pages are display-only: they are not polled, parsed or used to invent
Page changed events. Webpage Open on TV uses the configured LAN listener, your
own authorized Samsung TV connection and a compatible Vista Tizen application.
The page must exist inside this directory before that Task can run.

These pages are isolated displays. Local external scripts and CSS can run,
but inline scripts/handlers, remote resources, API connections, forms and nested
frames are blocked. Move scripts to separate local files. Test compatibility
with your own TV; embedding restrictions are not bypassed.
