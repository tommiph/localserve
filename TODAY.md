# Today

Today is a fullscreen daily briefing presented through the ordinary Vista system. It combines your selected Cards with a clock, local date, daylight panel, animated atmosphere, daily essentials and a rotating spotlight. It reads existing plugin data and sends no device commands.

## Create and edit

1. Open Vistas and choose Create Today. The draft suggests enabled Cards from your configured daily sources. Nothing is saved until you choose Create Vista.
2. Name the Vista and choose its URL name. Enable it when ready.
3. Add or remove Cards through the existing layout editor and Card library. Today uses enabled Cards inside enabled layout blocks. It manages their screen positions; the saved rows and columns remain available if you switch back to Standard layout.
4. Choose a Mood: Atmospheric, Aurora or Midnight. Choose Full, Gentle or None for motion, a spotlight interval of 10–300 seconds, and panel opacity of 40–100%.
5. Preview, then save. Open this Vista in a browser, choose Use on shared display, or explicitly Open on TV.

The screen targets 1920×1080 and scales to fit other viewports. Display theme and text preferences remain separate from administrator preferences. Reduced-motion browser preferences disable animated effects. Literal colors and a shared ES 5 renderer support older Tizen browsers; visual behavior on individual TV firmware may vary.

## Daily information

- Weather uses the first selected Weather Card's available temperature and conditions. Those conditions influence the decorative atmosphere. Choose a Card exposing these fields for the complete weather panel.
- Daylight uses Server location and the server timezone. Missing coordinates or a day without a solar event displays an unknown time. No location service is contacted for this calculation.
- Daily essentials start with selected train, agenda, television and lighting Cards. When more than four are selected, the side panels rotate through the remaining readings every 15 seconds, including electricity, nearby aircraft, airport information and Home modes. This rotation pauses with the spotlight.
- Agenda table rows are filtered to events whose reported start falls today in the server timezone. Multi-day events that began earlier are not expanded into new daily occurrences. Visibility is limited to the rows and columns published by the selected Card.
- Train rows with reported times more than a minute in the past are hidden. These remain provider-reported departures, not guaranteed movements.
- Tonight on television comes from TV Calendar's followed shows and its 16:00–06:00 local window. It is not a regional channel guide or a promise of streaming availability.
- Interests Cards supply source-attributed headlines and descriptions. Each headline published in a selected Card's table receives its own turn; duplicate titles appear once. A secondary headline never borrows the lead article's description. Add individual topic Cards for more variety, alongside a mixed digest. Movie release dates are separate from article publication dates.
- Daily TV suggestions and Daily movie suggestions rotate each available pick through the spotlight with its title, year, genre, source and summary. TV, movies, news and other daily information each receive one turn per round when selected. Shorter sections repeat their items so a larger collection cannot dominate screen time. These Cards do not replace Tonight on television in daily essentials. Select either the regular or fullscreen suggestion design; both provide the same information to Today.

To add watch suggestions to an existing Today, create and enable **Daily TV suggestions** in TV Calendar > Create Card and **Daily movie suggestions** in Movies > Create Card. Edit Today, add both saved Cards from the library, and save. New Create Today drafts include these enabled suggestion Cards when available. Existing saved Vistas change only when edited. Starter suggestions work without a movie account; live movie sources require a TMDB token in Movies Settings.

For films you already have, enable Emby's Library movie suggestions and create its **From your Emby library** Card. Add it to Today in the same way. These suggestions use a bounded window of recently added movies; watched status is not filtered. Emby and TMDB picks share the movie section's turns. Playback monitoring can remain off when only library information is needed.

Missing sources display an explicit empty state. Unavailable services retain their status label; selected reception timestamps older than six hours are marked Cached. The screen never invents readings or summaries.

Healthy readings omit Ready badges, plugin/source headings and source counts. Content titles, weather location, useful dates and film details remain visible. Offline, cached and unavailable warnings appear only when needed; the TMDB attribution mark is retained for its movie information.

## Carousel and artwork

The next three stories appear beneath the spotlight. Select a preview to jump to it, or use Left/Right. TV, movies, news and other readings take balanced turns. Weather remains visible with available feels-like temperature, wind and humidity; daylight includes sunrise and sunset.

Full motion uses perspective arrivals, floating source motifs and orbital geometry. Gentle keeps softer arrivals and slower background movement. None and the browser's reduced-motion preference stop animations. The text remains still between story changes; no WebGL engine is required.

The older-TV viewer uses steady-opacity slides and flat decorative layers, without fullscreen zoom or breathing effects. Reading and timestamp updates keep the current panels mounted and do not replay entrance animations. Essential panels only rotate when there are more than four selected readings.

Current TMDB and Emby movie picks can show posters and subtle fullscreen backdrops. The PC retrieves JPEGs only from TMDB's fixed image service or your configured private Emby server. The browser receives local artwork URLs, without API tokens or direct Emby addresses. Images are fetched only when displayed, with a four-download concurrency limit, an eight-second deadline and a 15-minute failure cooldown. The installation cache keeps at most 48 images of up to 1.5 MiB each under `data/watch-artwork/`; it is excluded from distributions. Missing or unavailable images leave the local motif and story text in place.

Movie metadata already cached without image references remains usable. Use **Movies > Watch guide > Refresh guide** or **Emby > Library > Refresh library** to retrieve current references; ordinary polling keeps its configured cache interval. The public `/watch` guide also shows available posters. Reading Today never starts a movie or a Task.

## Remote control

Use Left/Right to browse spotlight Cards. Play/Pause pauses or resumes automatic rotation. The existing TV viewer handles Settings and Return; Today does not alter its app-return behavior. Browser keyboard arrows can also browse the spotlight.

Editing a Card updates its existing data in Today. Ordinary refreshes retain the selected spotlight item. Removing a source or switching Vista presentation rebuilds only that view. Hidden pages suspend visual work, and closing the view releases its timers.
