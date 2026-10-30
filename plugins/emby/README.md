# Emby

Use your Emby server for playback observations and daily film suggestions.
Both features share one private server connection and its dedicated API key.

## Connect

1. Open Emby > Settings in the Sormus administrator.
2. Enter your server's private IPv4 address and port, for example `http://192.168.0.10:8096`, and its dedicated API key. Paste only the key value.
3. Enable Emby. HTTPS requires a trusted certificate. Requests stay on the configured private server; redirects are rejected.

## Movie library

Turn on **Library movie suggestions**. Choose a window of 50, 100 or 200 recently added movies, the 6/12/24-hour metadata refresh interval, and any preferred genres. A film may match any selected genre. Science fiction and common Sci-Fi spelling variations are matched consistently.

The **Library** tab shows four day-by-day picks. **Refresh library** reads metadata explicitly, subject to request cooldowns. **Movies > Watch guide** and `/watch` also show the current Emby choices. **Open in Emby** opens its web client; Emby handles its own sign-in and playback. No API key is embedded in links.

If Emby is configured through this PC's loopback address, links opened from a private LAN address use that address with Emby's port. Release years appear only when Emby reports them.

**Create Card** opens the ordinary ready-made Card editor with **From your Emby library** selected. A Fullscreen version is available. Enable the saved Card and add it to Today, a Vista or a Card collection. Today rotates the individual movies in its movie section. Adding a Card never starts a film.

These are selections from movies reported in your library, not a complete-library scan or a personalized ranking. Watched status is not filtered. The cached window is sorted by date added; four picks rotate deterministically with the server date. Public information includes movie titles, descriptions, years, genres and token-free item links. No media file paths, user profiles, credentials or video streams are exposed.

Available primary/backdrop image tags are retained with this metadata. Today and `/watch` can retrieve those movie images through the PC's bounded private cache. Only the configured private Emby server is contacted, with its token in a header; viewers receive local image URLs. Missing artwork falls back to the story text and local motif. Use Refresh library to obtain image tags for an older cached selection. See [Today artwork](../../TODAY.md) and the official [Emby image API](https://dev.emby.media/reference/RestAPI/ImageService/getItemsByIdImagesByType.html).

Metadata requests are bounded to one response up to 1 MiB and a 15-second timeout. Failed reads keep same-server cached metadata and show its status. Changing the server, key or selection-window size invalidates the old library identity on the next check. Repeated checks use the cache; failed reads back off for 15 minutes, or an hour for authorization/rate-limit failures. Nothing retries immediately.

## Playback monitoring

**Monitor playback sessions** is independent from library suggestions. Turn it off for library-only use; the plugin emits no playback or session-update Events in that mode. Retained observations remain historical. When enabled, reported session changes can drive existing Tasks. Observation times reflect polling and do not confirm that a commanded action happened.

Session baselines commit before Events. Startup, restart and interrupted polling do not replay previous changes. Library errors do not overwrite successful session observations or create playback Events. The plugin sends no playback, account or media-management commands.

Saved configuration, cached metadata, Cards and activity belong to the installation and are excluded from public source distributions. See the official [Emby Items API](https://dev.emby.media/reference/RestAPI/ItemsService/getItems.html) for the metadata interface.

## Themed Cards

This plugin includes Sci-fi, Hacker, Rustic and LCARS ready-made designs. Choose a source in the Card editor, or use **Vistas → Create themed Vistas** for the complete collection and Holographic Command presentation. Disabled or missing sources remain explicit; these read-only designs never send commands. See [Themed Cards and TV decks](../../THEMED-VISTAS.md).
