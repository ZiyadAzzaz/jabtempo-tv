# Local development camera and TV preview

This browser preview exercises the same bridge, motion and game packages as the native TV app.
It is development tooling, not evidence that the Fire TV build runs.

Prompt3's primary product preview is the shared React Native app at `/tv-web`, built with
`npm run build:tv-web` after the TV app's Yarn dependencies are installed. Its companion camera
page is `/phone`. See the [two-minute self-test](../../docs/m1_self_test.md).
Use USB `adb reverse tcp:8787 tcp:8787` for the phone's localhost page; optional LAN TLS is deferred.
The relay binds localhost by default. The commands and `/dev-tv` flow below retain the earlier lab
for diagnostics; the shared TV app is the product development target.

From the repository root in PowerShell:

```powershell
conda activate amazon-tv
npm ci
npm run setup:assets
npm run build:web
npm run dev
```

Open http://localhost:8787/dev-tv, choose Play, then open
http://localhost:8787/dev-cam in a second tab. Enter the TV code, explicitly consent and
start the camera. Choose stance in the camera page. Return to TV, Calibrate, run eight beats,
then Start round. The camera preview is mirrored with CSS; landmark coordinates remain anatomical.

Arrows move focus, Enter activates, Escape goes back, Space pauses during a round.
Camera and microphone remain off until explicit actions. Speech is disabled unless the browser
confirms the local recognition API and installed English language pack. No cloud fallback.
The model and WASM are served locally. Network access is needed once to fetch the licensed model.

The recorder saves consented keypoints locally; it does not upload or publish recordings.
Manual labels include the labeler's reaction delay and need offline review before accuracy evaluation.
Synthetic replay fixtures are unit tests only. Separate capture FPS, inference duration, RTT and
capture-to-render timing; the displayed FPS is a webcam measurement, never a phone result.

Pairing QR uses the explicitly advertised relay address when configured, otherwise same origin.
Localhost QR is explicitly a lab address. Optional TLS setup: [phone trust steps](../../docs/how_to_play.md).
Set up approved HTTPS/LAN transport before phone use. A normal phone browser cannot
access its camera on http://a-laptop-LAN-address.

The relay binds0.0.0.0:8787 as requested, without modifying Windows Firewall. Codes expire after
five minutes, credentials are memory-only, and media/transcripts/unknown protocol fields are rejected.
Direct Fire TV hosting is a documented design, not an implemented hardware claim.

Remaining verification: real camera framing/punch quality, phone HTTPS spike/offline voice,
capture-to-render measurements, audio/output latency, native emulator navigation and usability.
Optional trace collection is off initially; enable it in Settings and export JSONL after a real round.
Samples cover captured keypoints actually drawn on canvas, with clock-domain conversions and sync
age. Worker-end timestamps use timeOrigin conversion into the camera page's monotonic clock.
Canvas RAF submission is not display photons; dropped/skipped frames are not included in that sample.
Remaining features: timing histogram, local streak persistence, native per-device persistence,
verified local TTS and feedback cue playback. These remain on the gate checklist.

http://localhost:8787/dev-check loads only the local pose worker/model; it does not request media.
