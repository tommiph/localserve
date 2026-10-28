# Movies

Daily film suggestions, a personal watchlist and optional TMDB discovery.

1. Enable Movies in Settings. The starter collection works without an account or key.
2. Open Watch guide. Four picks are selected for the server's current date. Choose any preferred genres in Settings; a suggestion may match any selected genre. All genres removes the filter.
3. Select Save to keep a film in Watchlist. Watched moves it to history and, by default, removes it from daily picks. Mark unwatched returns it to Watchlist. The combined library holds up to 200 films.
4. Find movies searches the starter collection without a token. With a token it searches the TMDB catalogue. Search results remain open while saving films.
5. Create Card opens the ordinary ready-made Card editor. Daily movie suggestions and its Fullscreen design can be used in Vistas, Today, Controller and Card collections. New Cards start disabled until you enable them.

The daily selection is deterministic for a given date and source. It is simple genre filtering and daily rotation, not AI or a personalized prediction. The ordinary guide check applies a date change; the default check is every 15 minutes. Read-only viewers never refresh providers or run Tasks.

## Live movie information

In your TMDB account, open Settings > API and obtain your own API Read Access Token. Paste it into Movies > Settings. Select Discover released movies, Popular movies or Upcoming cinema releases, and choose the release country and information language. A live source requires a token; the starter collection does not.

Live metadata is cached for 6, 12 or 24 hours. Ordinary guide checks recompute the daily selection from that cache. **Refresh guide** explicitly fetches the catalogue again, subject to provider cooldowns. Full-catalogue title searches are explicit requests. Provider failures retain cached data and saved films with a warning; interrupted requests are not automatically repeated. Tokens are sent only in authorization headers to the fixed official TMDB API. No article pages, streaming account logins or browser cookies are fetched.

Validated poster and backdrop references from TMDB can appear in Today and the public `/watch` guide. The PC retrieves bounded JPEGs from the fixed TMDB image service and caches them inside this installation; viewers use local URLs without tokens. A missing image leaves the story text and local artwork visible. See [Today artwork and controls](../../TODAY.md) and TMDB's [image documentation](https://developer.themoviedb.org/docs/image-basics).

Genre filters narrow the returned collection, so a small collection may have fewer than four matches. Release dates and provider names do not confirm that a film is available in your region or subscription. Upcoming releases may be in the future. Details opens the source page; it does not play a movie or change the TV.

Starter classifications and short recommendations are Sormus editorial content. Film titles and years are identification metadata; linked Wikipedia pages provide further information. The collection is a starting point, not a live popularity ranking.

## Attribution

Optional live data is supplied by [TMDB](https://www.themoviedb.org). This product uses the TMDB API but is not endorsed or certified by TMDB. Its approved logo is bundled unchanged. Noncommercial API use requires attribution; commercial use requires an agreement with TMDB. Read the [TMDB API terms](https://www.themoviedb.org/api-terms-of-use).

Configuration, watchlist/history, searches and cached metadata are private installation data, excluded from source distributions. No Movies Task, playback action or notification is created automatically.
