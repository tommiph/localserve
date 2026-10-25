# Webcam

Display a Windows webcam in a Vista and use movement or lighting readings to
start Tasks. The **Camera monitor** ready-made Card shows the live image,
movement, relative brightness and lighting classification.

## Connect a camera

1. Connect a Windows-compatible USB webcam, or use the PC's built-in camera.
2. In Windows camera privacy settings, allow desktop applications to access it.
   Close another application if it has exclusive use of the camera.
3. Open **Webcam → Settings**, select **Camera index** (the first is `0`) and
   enable the plugin. Capture begins on the next refresh. **List cameras** shows
   Windows camera names and their indices; change the index if necessary.
4. Add **Camera monitor** from the ready-made Card library, enable the Card and
   place it in a Vista. Open that Vista locally or through the Tizen viewer.

One camera is selected per plugin installation. Windows enumeration order can
change when cameras are added or removed; list them again if the wrong one is
selected. A configured index does not prove that a camera is connected or usable.
Check the plugin's read activity and Log for capture errors.

## Image settings

Maximum width/height bound the image while preserving its aspect ratio. Defaults
are 640 × 360, 5 capture frames/second and JPEG quality 70. Capture supports
1–10 frames/second and up to 1280 × 720; the Card requests up to five images per
second, so higher capture rates primarily improve detection sampling.

The picture badge says Live only after the viewer decodes an available frame.
Disabled, disconnected, hidden and failed previews have explicit labels instead.
The timestamp and measurements are labelled Last reading; they can remain visible
after capture stops and must not be interpreted as a new observation.

The viewer uses refreshed same-origin JPEG images rather than WebRTC or a new
video codec. It includes an ES5 path for older Tizen browsers. Images fill the
Card's available picture area without cropping. The normal Vista URL and TV
launch controls apply; adding a Card does not change the TV's screen.

## Movement and lighting

Movement compares a 32 × 24 grayscale sample of successive frames. **Minimum
pixel change** ignores small differences. **Movement threshold** is the minimum
percentage of changed pixels, and **confirmation frames** requires that many
consecutive samples. **Movement hold** keeps movement active after the last
confirmed change. Uniform brightness compensation reduces triggers from a
whole-image lighting shift; it does not recognize people or objects.

Brightness is processed-image luminance from 0–100%, **not calibrated lux**.
Camera auto-exposure, framing, shadows and moving objects influence it. Configure
the Dark/Bright thresholds for the actual view; values between them are Normal.
Hysteresis and confirmation frames reduce classification flicker.

Detection runs at the capture rate. Readings and pending transitions reach Tasks
through the normal supervised poll, approximately every 3–6 seconds. At most the
latest occurrence of each transition is retained between polls, in frame-time
order. This is not a frame-by-frame recording or a security alarm system.
The first frames after startup, a stale gap or reconnection establish a baseline
without inventing movement or lighting transitions.

## Tasks and variables

- **Movement detected**: confirmed movement begins.
- **Movement ended**: its hold period expires while fresh frames arrive.
- **Lighting changed**: a confirmed Dark/Normal/Bright classification changes.
- **Camera readings**: current numeric brightness, changed-pixel percentage,
  movement state and classification for comparisons.

For example, choose **Camera readings → Brightness (%) → Less than → 20**,
then add the desired lighting action. Reading comparisons use Sormus's
normal false-to-true condition behavior. Transition Events have distinct
occurrence IDs so separate detections can trigger the same condition again.
Event text such as `{{event.brightness}}`, `{{event.motion-percent}}` and
`{{event.captured-at}}` is available where the selected Event declares it.
**Administration → Variables** lists the current complete contract.

## Privacy and stopping

Webcam starts disabled. Enabling it permits local capture, including when no
viewer is open; Tasks need the measurements independently of Cards. Disable
Webcam or pause Sormus to stop capture and clear its in-memory image.
Resuming permits the next normal refresh to start a fresh capture.

No microphone, recording, snapshot file, image history or cloud service is used.
Frames and grayscale samples remain in memory; only declared measurements,
Event scalars and camera names enter ordinary state/history. Frame timestamps
record receipt by the capture worker, not a hardware camera clock. A stale or failed
capture is hidden instead of presenting an old image as live. Failed capture
attempts wait at least 15 seconds before another supervised attempt.

The read-only image route is available to browsers that can reach Sormus,
like other public Vista data. Use it on your trusted local network. Windows
camera privacy restrictions and camera-driver availability still apply.

## Native helper and source

`native/Capture.exe` is the bundled Windows x64 .NET Framework DirectShow helper.
It captures RGB video only, scales and JPEG-encodes bounded frames, and sends
them to its owning worker over stdout. It opens no network listener. EOF,
explicit stop or a missing owner heartbeat ends capture. Cleanup targets only
that worker's own child process.

Rebuild from the project root with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File plugins/webcam/native/build.ps1
```

`Capture.exe --self-test` encodes a synthetic image without accessing a camera.
`Capture.exe --list` reads camera names without opening a capture. Automated
tests use synthetic pixels and disposable workers; actual camera drivers and
physical TV playback require checking on the intended hardware.

### Updating an open TV display

After installing an update, fully close and reopen the Vista TV app to load the
new viewer scripts. Server restarts and Card data refreshes do not reload an
already-open page. Live JPEG refresh keeps a decoded front image visible while
the next image loads in a second buffer, so collection fades remain independent
of the camera's image updates.

Settings group Camera, Preview, Readings, Movement and Lighting. Advanced
sections hold detailed tuning. Reading interval is entered in seconds (3–6);
the stored `poll-minutes` setting and polling contract remain in minutes.
Live Card previews in the Android app require version 1.4.1 or newer.

## Select a camera before capture

List cameras is a read-only Settings operation and works while the plugin is
disabled or not fully configured. It uses a supervised setup hook, opens no
stream and saves no readings. Choose a returned name/index, then use Use selected
camera to save it explicitly. Enable the plugin when ready. Names are a scan
receipt, not a permanent device identity; list again after USB devices change.
Changing the camera while enabled restarts capture through normal configuration.

## Fullscreen design

The separate **· Fullscreen** ready-made Card uses a 1920×1080 layout with
additional declared readings and bounded detail lists. Choose it in Add ready-made
card; existing Cards keep their design. See [fullscreen setup](../../FULLSCREEN-CARDS.md).
