# Games

Open **SERVER → Games**. **Neon Labyrinth** is an endless first-person maze game
with pastel walls, a neon grid, floating gems and a glowing EXIT portal. Select
**Play locally** for a separate browser tab, or visit `/games/maze` on your
Localserve address. **Fullscreen** fills the local display where supported.

**Start on TV** opens the page in the installed Vista Tizen app. Configure and
enable Samsung TV first, keep the TV on, and enable server functions. Localserve
needs a private LAN listening address reachable by the TV. The button sends one
launch command; check the television to confirm display. It does not wake the
TV or retry a failed launch. This explicit manual action is not blocked by the
automatic-TV Do not disturb setting.

## Playing

| Remote / keyboard | Action |
| --- | --- |
| Up / W | Walk forward one room |
| Down / S | Walk backward one room |
| Left / A | Turn left 90 degrees |
| Right / D | Turn right 90 degrees |
| Enter | Start or pause; select the focused menu button |
| Back / Escape | Pause; continue an unfinished run from the pause menu |
| Arrows in the menu | Move between buttons |
| M on a keyboard | Toggle configured music |

Hold a direction to keep moving. Walls block movement; the compass shows your
facing direction. Collect pink gems for points. Reaching the mint EXIT portal
adds a speed bonus and offers **Next maze**. The next maze is newly generated
and larger. There is no final level. Gems are optional.

The timer counts visible, unpaused play time. Hiding the page or switching away
pauses the run and stops music. Choose **Continue run** when returning. Slow
rendering still counts toward the timer. A graphics-context failure requires a
reload. Reloading starts a fresh run; level, maze and score are not saved on the
server. Only the best score is stored in that browser, separately from other
browsers, and may be lost when browser storage is cleared.

## Settings

Use **Edit** on the Games page. Changes apply when a game page next loads.

- **Starting rooms per side**: 3–25, default 5.
- **Added rooms per side each level**: 1–10, default 2.
- **Gems per maze**: up to 64, default 18. Starting and exit rooms never contain
  gems; small mazes can contain fewer than the requested number.
- **Points per gem**: default 100.
- **Speed bonus base**: default 1,000. Bonus = `base × level ÷ (1 + active
  seconds ÷ par time)`, rounded to whole points with a minimum of one.
- **Par seconds per room**: default 2. Par time is side length squared multiplied
  by this setting. Faster runs receive a larger bonus.
- **Walking step duration**: 120–800 milliseconds, default 280.
- **Rendering detail**: Low (up to 960 pixels on the longest edge), Medium
  (1,440), or High (1,920). All target at most 30 frames per second. Low is
  recommended for older TVs. Layout still fills the 1920 × 1080 viewport.
- **Looping music file** and **Music volume**: described below.

Disable Neon Labyrinth to prevent new page loads and TV launches. A game already
loaded continues until closed. Games are bundled application content, so the
entry itself is not copied or deleted. Preferences live in `data/games.json`;
revision checks prevent one editor overwriting another editor's save.

## Adding music

Put a track you have permission to use in `assets/games/music/`, for example
`assets/games/music/maze.mp3`. Enter `/assets/games/music/maze.mp3` in the editor.
Filenames accept letters, digits, underscores and hyphens; supported extensions
are `.mp3`, `.ogg`, `.wav` and `.m4a`. Keep the file under 12 MiB. Actual decoding
depends on browser codec support. No track is bundled.

Players explicitly enable **Music** in the game menu. It loops through Web Audio,
obeys the configured volume and stops while paused or hidden. Localserve does
not change the TV's volume or mute setting. Unsupported or failed audio displays
a message; toggle Music explicitly to try again. User tracks are public server
assets, but are excluded from clean distributions.

## Compatibility

The viewer uses local Three.js r97, ES5 syntax, XHR, WebGL1, procedural canvas
textures and literal/prefixed Flexbox CSS. Samsung's [web-engine specifications](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html)
identify Chromium M47 for 2017 TVs. Samsung's [remote-control guide](https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html)
documents arrows, Enter and Back, which need no additional key registration.
The game focuses its own canvas and handles Back inside the game. Physical-TV
behavior and performance still need hardware verification.

Recursive partitions form a connected maze without allocating a complete room
grid. Only nearby walls are merged into render batches, with at most 64 gems.
Geometry is released when the visible window changes; rendering and audio
resources are released on page exit. Reduced-motion preferences remove gem
animation and walking/turning interpolation. No remote artwork, analytics,
score upload, plugin polling or device commands originate from the game page.

In the installed Vista TV app, Channel Up opens application settings, Play/Pause
pauses/resumes the maze, and Back closes the TV app. Enter remains a start/pause
shortcut. Keyboard Esc in a standalone browser pauses the game. See the shared
[TV remote controls](tv-tizen/README.md#remote-control) for return limitations.

