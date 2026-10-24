# Fullscreen ready-made Cards

Each bundled ready-made design has a separate **· Fullscreen** version for a
1920×1080 display. It keeps the plugin's motif and adds larger instruments,
more public readings and expanded lists. Existing Cards keep their own design.

1. Choose **Add ready-made card** in the plugin or Vista Card library.
2. In **Design**, select the option whose name ends in **· Fullscreen** and
   choose its source. This choice appears when the plugin offers multiple designs.
3. Enable the Card. In a Vista, use one Card block filling the Canvas, with zero
   Canvas padding and gap, for an edge-to-edge display.
4. Open that Vista's own URL. To cycle screens, put fullscreen Cards in a
   collection occupying the whole Canvas.

These are layouts, not new connections. Configure and enable the plugin before
expecting data. No extra polling, camera enablement, device commands or provider
requests are caused by choosing a design. Missing and retained readings remain
explicit. Font size follows the Vista setting, independently of administration.

| Design | Additional information |
| --- | --- |
| Airspace | Area, radius, filtering/limit indicators and up to 10 aircraft with registration and address |
| Agenda | Event description, end/all-day state, count and 10 events with start/end dates |
| Screening room | User, client, volume, playing/paused totals and 10 session rows |
| Departure lounge | Flight count, route/flight filters and 10 flights with scheduled/reported times |
| Grid | Selected dataset title/organization/description, period and 10 sample values beside system figures |
| Platform | Filters, count and 10 trains with track, status and arrival information |
| Front page | Publication/language details, count and 10 headlines |
| Orbital | Connection/controller/thermal summary and 10 thermal sensor rows |
| Observatory | OS/memory details, up to 4 GPUs, 5 disks and 5 adapters |
| Gaming lounge | Presence, detailed trophy totals, up to 6 games and 6 trophy collections |
| Home cinema | Firmware/OS, playback details and 10 applications |
| Sensorium | Reception state, sensor count, raw readings and up to 20 sensor rows |
| Signal lab | Changed value, pulse sequence and independent signal/value/pulse times |
| Nordic | Connection and device/group counts, up to 10 lights and 6 groups |
| Atmosphere | Pressure, cloud cover, UV, rain flag and region/country |
| Camera monitor | Large buffered picture, motion/brightness, lighting and capture dimensions |
| Studio | Next-check/budget details and up to 10 videos with published dates/durations |

Lists remain bounded and source-specific. Captions state their maximum rows;
they do not imply a complete device or provider inventory. Dates do not wrap.
Long list text clips within its column. Smaller viewports, unusually long values
or enlarged text can scroll within panels; check Vista Preview at the intended
size. The older Tizen path uses literal colors and Flexbox. Close and reopen an
already-open TV display to load updated assets.

Shared geometry lives in `assets/card-fullscreen.css`. Each design's
`fullscreen-theme.css` owns its motif accent; `fullscreen.html` owns its declared
bindings. Run `runtime/node.exe tools/cards/build-fullscreen.mjs` after editing
styles and use `--check` to verify them. The generated, self-contained
`fullscreen.css` stays inside each plugin's asset allowlist, including for the
Android app. No native app update is required for these designs.
