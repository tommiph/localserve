# PlayStation mode

PlayStation mode combines HDMI 1 video with a dedicated 1920×1080 information
screen, in split view or a transparent full-screen game HUD. It is a separate
optional Tizen application and leaves Vista installed.
The browser screen is available at `/playstation-mode` on your Sormus server.
A regular web browser shows the information layout with a reserved video area;
only the packaged TV application can display the native HDMI video there.

## Set up

1. Configure and enable the PlayStation plugin with your own PSN connection.
   Its existing polling interval and provider access apply.
2. Connect the console to the TV's HDMI 1 input. The application does not wake
   the console or authenticate to PlayStation Network on the TV.
3. Build/sign/install the separate Tizen source under `tv-tizen/playstation/app`
   using your own Samsung SDK, TV developer target and signing identity. See
   [TV application setup](tv-tizen/README.md). No signing keys, developer target
   or signed widget is part of a source distribution.
4. Open **PlayStation** from the TV app list. Enter the Sormus protocol,
   server IP/hostname and port if Connection appears. Choose Save and connect.

The fixed information path is `/playstation-mode`. The saved server address is
local to this application on this TV and is separate from Vista's address.
The application ID is `LsPsMode01.PlaystationMode`; use that ID for a manually
configured Samsung TV Launch installed app action if desired.

## Video and layout

Once its server screen reports connected, the application explicitly selects
the TV's reported HDMI 1 port and opens a native video window with rectangle
`[2%, 2%, 50%, 50%]`. At 1920×1080 this is x=38.4, y=21.6, width=960, height=540.
The empty bay extends beyond the native rectangle; all essential information
starts to its right or beneath it. In split view native video overlays HTML; it is not an
iframe capture of another application and it does not rearrange the screen.

Channel Up opens Connection and hides HDMI. Return to game explicitly shows it
again; Back or Exit closes this application and returns control to the TV. The
TV chooses which prior screen resumes; an exact third-party app is not guaranteed.
Server connection loss,
navigation, backgrounding and page disposal cancel/hide the native window.
There are no source retries, fallback to other ports, console wake commands or
automatic restoration of a previous TV input. A reported port or a successful
API command does not prove there is an HDMI signal.

## Information and controls

The screen uses only the plugin's declared public readings: presence, Online
ID, platform, current game/title ID, PlayStation Plus, playtime, trophy level
and progress, grade counts, current-game trophies, received timestamps, bounded
game history, trophy collections and associated console details. No extra Sony
API requests are made by the screen. Missing readings remain unavailable; retained
readings, partial details and library bounds remain visible in the detail pages.

The trophy scroller shows reported **collections**, progress and earned/available
counts. Individual trophy names/descriptions/artwork are not currently fetched.
The lower information panel rotates every 20 seconds. Left/Right switches its
pages, Up/Down pages through activity, and Play/Pause pauses/resumes rotation and
decorative animation. Reduced-motion preferences also disable CSS animation.
Dates use the server's timezone and selected 12/24-hour format.

## Session activity

The plugin emits **Play session activity** after a changed presence observation
has been committed. It includes current/previous presence and game, observation
time and, when known, the observed session duration. These receipts appear in
plugin/global Activity and the screen's bounded 60-observation feed. The server's
global Activity retention setting applies; this screen does not create a second
log file. The feed uses the plugin's recent in-memory log window, not a full
archive search. Older presence-change receipts appear as presence observations.

First readings establish a baseline and do not invent a session start. Unknown
presence or a gap longer than three polling intervals (at least three minutes)
breaks duration continuity. Time spent online before monitoring began is unknown.
Polling can miss short sessions and does not report exact physical console power,
boot time or instantaneous play activity. Restart never replays saved transitions.

The public display endpoint is `/api/playstation-mode`. It contains public Card
readings and selected observation fields only; it does not expose credentials,
account request IDs, private cursors, raw provider responses or administrator
tokens. Keep LAN access limited to the network where you intend to share these
readings. See [PS5 artwork attribution](assets/playstation-mode/NOTICE.md).

## Automatic online/offline Tasks

Create an Event rule using PlayStation → PSN status updated and compare **Online**
to true. Add Samsung TV → Launch installed app with app ID
`LsPsMode01.PlaystationMode`, launch mode **NATIVE_LAUNCH** and empty arguments.
For a separate offline Task, compare Online to false and use Samsung TV →
Close installed app with the same ID. Enable the Tasks when ready.

These conditions run once when their comparison becomes true, rearming after
a known opposite reading. Unknown/missing presence does not count as offline.
The first matching report after enablement can run the Task; PSN polling means
there can be a delay of up to the configured polling interval plus provider lag.
Server pause, Do not disturb, cancellation and normal Task overlap rules apply.
There is no wake or retry. Closing targets this app alone, including when it is
in the background; it does not send Exit/Home to a different foreground app.
Unsupported or unavailable app-status endpoints fail without a key fallback.

## Appearance

The TV launcher icon is a 16:9 PNG with a uniformly scaled wordmark. Square
information panels use local Rajdhani static fonts and lightweight CSS 3D
wireframes. Play/Pause pauses animation; hiding, losing connection or enabling reduced
motion also stops decorative animation. Font licensing and provenance are under
`assets/playstation-mode/fonts`. Native HDMI geometry remains independent.

## Current-game panel

While PSN reports a running game, PlayStation mode keeps the bottom-right panel
on that game's trophy summary: earned/available totals, platinum/gold/silver/bronze
counts, reported progress, playtime, play count and first/last played times.
The general detail carousel resumes when no game is reported running.

The game is resolved by its exact PSN title ID. These are public summary readings
from the existing detail requests, cached for up to five minutes and refreshed
when the reported game changes. Individual trophy names/descriptions are not
fetched. Multiple distinct trophy sets are summed without double-counting IDs;
progress is shown only for a single set because PSN does not supply a combined
percentage. Missing data remains unavailable. A game change clears the previous
game's statistics even if the new detail request fails.

Reopen the PlayStation TV application to load updated server viewer scripts.
No TV application reinstall is needed for server-page-only changes.

## Full-screen game HUD

Use **Info** on a supported physical remote to switch between split view and the
full-screen HUD. Alternatively press Channel Up, choose **Display mode**, then Return
to game. The selection is saved on this TV. The browser preview also has a view
button and the H key; browsers display the HUD without an HDMI picture.
The base HUD requires PlayStation TV application 1.2.0 or later. Version 1.3.0
adds **Edges**, **Top**, **Right**, **Bottom**, **Left** and **Single-line scroller**.
Version 1.3.1 adds **No HUD**, which hides every overlay, including the bottom
control strip, while HDMI stays full-screen. Channel Down cycles to Edges again;
Channel Up still opens settings. In a browser, L restores the HUD and H switches
back to split view.
Press **Channel Down** to cycle these layouts; from split view it also enters HUD.
Channel Up opens settings, where **HUD layout** and **HUD opacity** (0–100%) are
saved on this TV. Opacity affects the entire game overlay, not the HDMI picture;
the settings/view controls stay visible even at 0%. Left/Right adjusts the slider
in 5% steps. The browser preview uses L or its HUD button to cycle layouts.

Address fields remain read-only on focus. Press **OK** to open editing and the
TV keyboard; press OK again or move Up/Down to finish editing. Merely opening
settings does not request the keyboard.

HUD mode places HDMI 1 at `[0%, 0%, 100%, 100%]` **behind** transparent HTML.
Compact panels show the current game, platform, observed session timer, playtime,
play count, trophy grades and provider progress. The middle remains clear for
gameplay. A newer same-game summary with an increased trophy count briefly shows
the number of trophies synced, without claiming an instantaneous unlock.
Individual trophy names and artwork are not fetched. The existing polling and
five-minute detail cache apply; there are no additional provider requests.

The session clock starts when Sormus first observes a running game. It is
calculated locally, survives view switches and continuous monitoring, and resets
for another game or after monitoring continuity is lost. Time played before
Sormus observed the game is unknown. Stale/disconnected readings freeze at
their last receipt and are labelled retained. The timer is separate from PSN's
lifetime game playtime. No game reading means no active timer or old-game stats.

The packaged parent accepts only the two fixed layout names from its current
scoped server frame, and acknowledges a mode after the native API succeeds.
Switching changes geometry and stacking without reselecting the HDMI source.
Cancellation or a failed switch cannot restore a cancelled window. Back, settings,
disconnect and background handling are the same in both layouts. The HUD belongs
to this application; it cannot overlay Netflix, YouTube or another TV app.

## Automatic Resident Evil HUD theme

While a running game's reported title contains Resident Evil (including numbered
games, remakes and subtitles), the HUD uses a quarantine-terminal design: dark
olive panels, phosphor-green session numerals, muted paper-colored labels, red
case-file accents and an original containment emblem. BIOHAZARD and Japanese
バイオハザード branding are also recognized. The standard blue theme returns
when another game is reported, the game ends, its title is unavailable or the
plugin is disabled. Matching follows the ordinary PSN polling cadence. Retained
readings remain labelled as retained.

The theme applies to every HUD arrangement and the single-line scroller. It
preserves the selected layout, opacity, No HUD setting and observed game timer;
it does not launch the TV app or switch inputs. Open PlayStation mode normally
and select full-screen HUD to view it. Reopen the TV app to load updated server
assets; no TV app reinstall is needed. The design uses local CSS/SVG and existing
fonts, with no external artwork or provider requests. Decorative markings do
not represent in-game health, ammunition, inventory or other unavailable data.

## Automatic closing

The Samsung TV Close installed app action first checks the selected application. For the Sormus PlayStation app, a connected foreground screen can accept a single cooperative exit request through the native remote Back handler. The server confirms closure through the exact app status endpoint. Open the PlayStation app again after a server interface update to load its viewer scripts. Missing acknowledgement uses one REST close request; unsupported firmware remains an explicit error. There is no Home key fallback, wake, delayed restart replay or automatic command retry.
