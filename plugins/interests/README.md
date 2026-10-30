# Interests

Build a personal briefing from AI, pop culture, film/TV, music, gaming, sci-fi, technology, science, space, environment and daily news. Interests supplies Cards for Vistas and Controller, and Events for Tasks. It uses publisher descriptions and literal text filters; no AI subscription is required.

## Setup

1. Enable Interests in Settings.
2. Add an interest, give it a name and choose its source. Leave Enabled on to poll it.
3. Optionally enter comma-separated Include words or Exclude words. Include matches any phrase; Exclude hides any match. Matching ignores case.
4. Open Discover. Select an interest to see its latest cached items, or choose Refresh beside a source. Refresh respects the source cooldown.
5. Create an Interest briefing ready-made Card for the interest, then place it in a Vista or publish it to Controller.

An All interests source builds a mixed digest from the other enabled sources, with at most two items per source. It gives each available source a first turn before taking second stories; when more than ten sources have data, a stable daily rotation shares the ten slots. Refresh the underlying sources first. A digest uses cached data and sends no additional provider requests.

Sources refresh every 15,30,60 or 120 minutes. Each interest retains up to 10 items. Source failures retain prior readings and wait before another attempt. Unknown publication dates remain unknown. Movie release dates are cinema listings, not article publication dates or streaming availability.

## Movies and trailers

Upcoming movies requires your own TMDB API read access token from your TMDB account Settings. Enter it only in the masked Interests setting. Choose a two-letter release country and language such as FI and en-US. The token is sent only to TMDB; Cards and Events never expose it.

This product uses the TMDB API but is not endorsed or certified by TMDB. TMDB permits free noncommercial API use with attribution; commercial use requires its separate agreement. See [TMDB terms and attribution](https://developer.themoviedb.org/docs/faq).

For newly uploaded trailers, configure the existing YouTube plugin with selected official studio channels. Interests does not duplicate channel polling or start playback.

## Tasks

New item provides interest name/ID, headline, supplied description, source, original link and publication time when reported. Configure the Event in the Task editor and select its values through the value picker. First reads and first reads after restart establish a baseline. An item is claimed before its Event; repeated reads never retry an interrupted Task. Mixed digests do not emit duplicate Events. Undated articles do not emit New item; new movie listings after the baseline can emit it without a publication timestamp. Each poll emits at most five new items.

## Free source catalogue

Add an interest in Settings, choose a Source, and name the interest. Every RSS/Atom source below works without an account or API key. Feed access is free; linked articles may require a publisher subscription. Providers retain their content rights and original links.

| Source | Coverage / feed |
| --- | --- |
| ScienceDaily | [ScienceDaily · Science](https://www.sciencedaily.com/rss/top/science.xml) |
| Ars Technica | [Ars Technica · Technology](https://feeds.arstechnica.com/arstechnica/technology-lab) |
| Ars Technica | [Ars Technica · Science](https://arstechnica.com/science/feed/) |
| BBC News | [Pop culture · BBC Entertainment & Arts](https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml) |
| Variety | [Film & TV · Variety](https://variety.com/feed/) |
| Deadline | [Film & TV · Deadline](https://deadline.com/feed/) |
| The Guardian | [Culture · The Guardian](https://www.theguardian.com/uk/culture/rss) |
| Pitchfork | [Music · Pitchfork](https://pitchfork.com/feed/feed-news/rss) |
| NME | [Music · NME](https://www.nme.com/news/music/feed) |
| PC Gamer | [Gaming · PC Gamer](https://www.pcgamer.com/rss/) |
| Reactor | [Sci-fi & fantasy · Reactor](https://reactormag.com/feed/) |
| The Verge | [Technology & culture · The Verge](https://www.theverge.com/rss/index.xml) |
| The Guardian | [AI news · The Guardian](https://www.theguardian.com/technology/artificialintelligenceai/rss) |
| Google DeepMind | [AI research · Google DeepMind](https://deepmind.google/blog/rss.xml) |
| OpenAI | [AI announcements · OpenAI](https://openai.com/news/rss.xml) |
| Hugging Face | [Open models · Hugging Face](https://huggingface.co/blog/feed.xml) |
| Google | [AI announcements · Google](https://blog.google/innovation-and-ai/technology/ai/rss/) |
| NASA | [Space & exploration · NASA](https://www.nasa.gov/feed/) |
| ScienceDaily | [Environment · ScienceDaily](https://www.sciencedaily.com/rss/top/environment.xml) |
| BBC News | [World news · BBC](https://feeds.bbci.co.uk/news/world/rss.xml) |
| BBC News | [Health · BBC](https://feeds.bbci.co.uk/news/health/rss.xml) |
| BBC News | [Technology · BBC](https://feeds.bbci.co.uk/news/technology/rss.xml) |
| BBC News | [Science & environment · BBC](https://feeds.bbci.co.uk/news/science_and_environment/rss.xml) |
| BBC Sport | [Sport · BBC](https://feeds.bbci.co.uk/sport/rss.xml?edition=uk) |
| BBC News | [Business · BBC](https://feeds.bbci.co.uk/news/business/rss.xml) |
| Google Trends · Finland | [Trending searches · Finland](https://trends.google.com/trending/rss?geo=FI) |
| Google Trends · United States | [Trending searches · United States](https://trends.google.com/trending/rss?geo=US) |

Google Trends entries are search interest in the named country, not a worldwide popularity ranking or verified news. Each search has its own Google Trends Explore link; approximate traffic is shown only when reported. Dates identify the reported trend start rather than article publication. Official AI company feeds contain their own announcements; independent AI reporting is offered separately.

Existing API choices remain available: [Spaceflight News](https://www.spaceflightnewsapi.net/), the official [Hacker News API](https://github.com/HackerNews/API), optional [TMDB](https://www.themoviedb.org), and the cache-only mixed digest.

RSS 2.0, Atom alternate links, safe permalink GUIDs, and timezone-qualified dates are supported. Responses are limited to 1 MiB, 2,000 input entries, 30 parsed metadata rows and 10 retained items per interest. Text fields/depth remain bounded and DTDs are rejected. Large or changed feeds can become unavailable; cached items remain and the source backs off.

No article pages or article images are fetched. Source text is displayed as text, never executed as HTML. Saved interests, tokens, cached items and discovery history are private installation data and excluded from distributions. SAX parsing uses the bundled sax package under its included licence in vendor/sax/LICENSE.md.

## Themed Cards

This plugin includes Sci-fi, Hacker, Rustic and LCARS ready-made designs. Choose a source in the Card editor, or use **Vistas → Create themed Vistas** for the complete collection and Holographic Command presentation. Disabled or missing sources remain explicit; these read-only designs never send commands. See [Themed Cards and TV decks](../../THEMED-VISTAS.md).
