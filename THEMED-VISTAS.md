# Theme-native TV Vistas

The five themed Vistas turn selected plugin information into instruments inside a procedural world. There are no Card panels or embedded Card frames in this presentation.

| Theme | Information and scenery |
| --- | --- |
| Sci-fi | Floating readings above a planet, with orbital instruments and satellites |
| Hacker | A full typed search/answer terminal in a data corridor, with supporting readouts |
| Rustic | A wooden reading sign in a low-poly valley, with almanac labels and a working windmill |
| LCARS | Curved orange/lilac controls, ship-system readings, an original starship and scanning rings |
| Holographic Command | A reading suspended above a reactor, gyroscope machinery and holographic instruments |

The primary reading, supporting metrics, actual percentage gauges and bounded table summaries use only the selected public plugin fields. Missing and disabled data stays explicit. Provider attribution remains visible, including the local TMDB logo. The standalone ready-made Cards remain available in Standard layouts; Today and Universes retain their existing renderers.

## Create and edit

In **Vistas**, choose **Create themed Vistas** to create four source definitions per installed plugin and five themed Vistas. A fresh 25-plugin installation receives 100 ready-made Cards as reusable data selections. Existing content stays intact. Each plugin uses its first enabled source, otherwise its first saved source; missing named sources stay unavailable. The source can be changed in the ordinary Card editor.

The ordinary Vista editor offers **Presentation → TV deck · Cinematic / holographic**. Choose a theme, Full/Gentle/None motion, a 10–300 second spotlight interval and 70–100% readout intensity. The layout's enabled Card references determine which information is shown, without displaying their Card templates. Duplicate references are removed. At the 1920×1080 target resolution, six sources appear together: a main source, three supporting instruments and two lower readouts. The layout uses this fuller composition from 1600×900 upward; smaller viewports retain the compact three-source composition, with fewer supporting sources at 720p. Left/Right and the arrows explore the source sequence.

Normal initial URLs are /vistas/theme-sci-fi, /vistas/theme-hacker, /vistas/theme-rustic, /vistas/theme-lcars and /vistas/holographic-command. Existing slugs receive a numeric suffix. Setup is journalled and append-only; a completed pack is not recreated automatically. Backups include its journal and ordinary Vista definitions.

## Full HD information

The scene reserves more space for real information: up to six selected supporting fields for the main source, three for each side source, two for each lower source, and three recent scoped Task statuses. Longer text readings use the native text area as well as the 3D headline. Unavailable supporting fields are omitted while their source's unavailable status remains explicit.

The main source's selected table can project up to eight rows using its already selected public columns; the scene fits as many detailed rows as the font and available height allow. Standard Cards, Today and Universes retain their existing row limits. No additional fields, columns, sources or provider requests are introduced. Without a main table, the lower-left space shows a bounded status sweep of other sources already selected in the Vista.

Hacker uses ten transcript lines at Full HD and adds three live supporting readings to its typed answer. Polls update those readings without replaying the session. The center world scales to leave the lower readouts clear. Full HD and compact layouts share pause, selection, attribution, offline and reduced-motion behavior.

## Optional reactions

**Connect readings to effects** is saved as part of the Vista. Enable reactive scenery, then choose fields already selected in that Vista. **Use available readings** fills the editor draft with supported available weather, wind, daylight and lighting/CPU connections; it does not save until **Save changes**. For Hacker it also selects enabled Tasks, up to 32, for a local status feed. Review or clear these selections in the same editor.

- **Sky and precipitation:** a selected conditions string recognizes clear, cloud, rain and snow. Unrecognized conditions stay neutral.
- **Windmill movement:** a numeric reading maps through a configured minimum and maximum. No selected wind reading uses decorative movement.
- **Reactor / orbit strength:** a numeric or boolean reading changes machinery and orbit speed. An optional numeric total must come from the same selected source, such as lights on / total lights. This is a visual normalization, not a power measurement.
- **Alert colour:** a selected boolean or recognized health string changes the scene colour. A selected Task's latest failure can also colour the scene when no explicit alert reading is available.
- **Server daylight:** configured sunrise/sunset changes the valley's sky and scene lighting. Missing location or solar instants stays neutral.
- **Task activity:** only selected current Task names, run status and times are published to this Vista, with a bounded 12-run snapshot. Steps, parameters, reasons and error details are excluded. Hacker types new changes once; opening a viewer does not replay old history. Other themes show the latest selected status.

Turning reactions off immediately returns to neutral scenery and removes the Task projection. Stale, disabled, missing or unselected fields do not drive effects. Retained unavailable connections may be edited without destroying the saved layout. These connections never operate a device or run a Task.

## Playback and compatibility

One locally bundled Three.js r97/WebGL1 canvas renders each world, with fixed geometry and capped drawing resolution. The main reading is a scene texture in Sci-fi, Rustic and Holographic Command; Hacker and LCARS use native theme text. An animated Canvas2D fallback includes the primary reading and weather effects if WebGL is absent or lost. Restoring WebGL restores the scene. There are no remote visual dependencies or invented readings.

Play/Pause freezes rotation, scenery and console typing while allowing manual browsing. Hidden and disconnected viewers hold movement and retain readings. None and reduced-motion show steady scenery and a complete console transcript. Ordinary polls keep the current source and animation session. The console commands are fictional text and are never executed; real source-status changes and the selected Task feed are distinct labelled lines.

The shared ES5 viewer uses literal colours, typography and explicit top/right/bottom/left bounds. It does not rely on CSS Grid, custom properties, inset, clamp or Flexbox gap for scene geometry. Typography adapts to viewport size and the display font preference; bounded text fitting keeps supporting readings within their regions. Provider credit remains outside the readouts. Reopen an existing viewer normally to load updated scripts; no native client reinstall is needed.

Browser checks cover all five themes and the bundled plugin sources at 1080p/720p and 130% text on modern and simulated old-capability CSS, plus moving pixels, pause, reduced motion, context loss/restoration and Canvas2D. Isolated editor/reaction/Task checks do not execute real Tasks or contact providers. These checks do not qualify physical TV/GPU performance.

Creating or opening a Vista does not enable an integration, refresh a provider, change shared /display, install a client or send a device command. Use the existing shared-display or TV controls explicitly to select a Vista on a device.
