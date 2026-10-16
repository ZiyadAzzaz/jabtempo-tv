# Prompt 4: browser controller and verification

Date: October 3, 2026 (Cairo). Browser controller is the primary path; native Android phone P2 is parked.

## Device support

Use iPhone/iPad Safari, Android Chrome, or a laptop/tablet browser that supplies trusted HTTPS,
camera permission, WebAssembly, Worker and ImageBitmap support. The controller checks these
features and explains missing capabilities. This is a supported architecture, not a promise that
every device or embedded browser works. Open directly in Safari/Chrome rather than an in-app browser.

The same page supports portrait/landscape layouts, front/rear camera selection, local hand counters,
seven command buttons and optional offline push-to-talk. Camera orientation changes reset the
detector. Hiding the page stops camera/microphone capture; returning requires Start again.
Screen wake lock is best-effort; keep the page visible. Model processing uses CPU/WASM in a worker.
Google documents the [web Pose Landmarker runtime](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js).

CSS mirrors the selfie preview only. Landmark indices retain anatomical left/right throughout the
wire protocol. TV rendering mirrors coordinates to place the player's actual left on screen-left.
A user-confirmed correction handles an unusual swapped setup; a wrong-hand detection alone cannot
prove the hands are swapped. Correction clears timing calibration and requires both hands again.

## Development and tester networking

Development setup: laptop relay with a locally trusted certificate. Our owner's iPhone can use
the existing trusted LAN HTTPS/WSS setup. A tablet needs the same secure-origin and camera permissions.
Android USB localhost forwarding is an optional developer alternative.

**Never ask testers to install development certificates on their own phones.** Testers use the
owner's configured iPhone or laptop webcam. Their own phones require a fully browser-trusted setup.
No certificate, firewall, account or public deployment is changed automatically.

## Certificate-free product path: designed, not verified

A public HTTPS static controller (for example GitHub Pages) would capture locally and send only
keypoints/events over a WebRTC data channel to the TV. [GitHub Pages is static hosting](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages);
it does not provide a dynamic pairing/signaling server.

[WebRTC leaves signaling to the application](https://webrtc.org/getting-started/peer-connections).
Options investigated: two-way QR/SDP exchange with completed ICE gathering (no hosted signaling
service, but awkward TV-to-phone answer entry), or a separately operated free-tier signaling endpoint
(availability, quota, account and lifecycle must be verified). Same-Wi-Fi host candidates may work;
network isolation/mDNS/native interoperability and TURN fallback still need actual testing.

A static page plus a local insecure WebSocket is insufficient: it does not remove secure-origin or
mixed-content constraints. No reliable direct TV implementation can be asserted from the current
Windows web preview alone. Keep this path as future work; no free public server, TURN availability
or certificate-free product connection is claimed.

## Speech selection and privacy

Selected [Vosk-browser](https://github.com/ccoreilly/vosk-browser), Apache-2.0, as an optional local
WASM worker with restricted grammar. The selected
[vosk-model-small-en-us-0.15](https://alphacephei.com/vosk/models) is listed as Apache-2.0 / 40 MB.
The pinned downloaded ZIP is 41,205,931 bytes; the converted local tar is recorded in
`results/voice_asset.json`. Model publisher notes that small models can require roughly 300 MB at
runtime: concurrent pose/speech performance must be checked on the physical device.

[TF.js speech commands](https://github.com/tensorflow/tfjs-models/tree/master/speech-commands) was the
alternative: its default vocabulary has isolated words, requiring awkward mappings or training for
our seven commands. Vosk's restricted grammar preserves start, pause, resume, harder, easier,
next round and two players. Unknown/low-confidence outputs are rejected.

Enable local speech explicitly, then hold to speak. The library/model are served by the local
relay; recognition runs in the browser worker. Microphone tracks are released on button release,
cancel, blur, Stop, page hide, or the eight-second cap. Audio and transcripts are never sent to the
relay: only an allowlisted command and confidence are sent. The model is held in worker memory and is reloaded when enabled after a page reload.
Our build removes the optional IndexedDB requirement for private-browser compatibility. Pose works without loading the voice model.

No Web Speech recognition fallback is used. Its
[processLocally property is experimental](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally)
and remote execution is permitted when false; do not claim Safari Web Speech is guaranteed offline.
Phone buttons and TV D-pad remain available if model/microphone/recognition fails. Recognition
confidence is not measured human accuracy. The iPhone quiet/beat voice gates remain pending.

## Physical five-minute measurement

Use the owner's iPhone Safari LAN session. Note device/iOS/browser, start/end battery, warmth and
interruptions; allow the camera page to run for five minutes and download session metrics. It records
inference fps and inference p50/p95, not capture-to-render latency. That latency remains null until
the existing bridge trace benchmark measures it. Label evidence `iPhone-Safari-LAN`, never desktop
viewport emulation. Repeat on Android/tablet when those physical devices are available.

Offline voice gate: real consented speakers, quiet and beat conditions, ≥90% quiet / ≥80% beat on
the owner's iPhone. Synthetic TTS regression is a prerequisite, not a gate pass. Native/emulator
TTS, frame rate, memory, D-pad and full iPhone round remain pending SDK/AVD access.

## Runtime integration notes

Vosk 0.0.8 ships a prebundled worker that needs Emscripten dynamic JS bindings. The build
extracts that pinned worker to a dedicated local asset. Only that worker response allows
JS eval; the controller/TV document policy stays restrictive. Model files live in worker
memory, avoiding the failed IndexedDB sync path observed during regression.

The package audit reports two moderate UUID-related entries in Vosk's dependency chain
(GHSA-w5hq-g745-h8pq). The embedded runtime uses UUIDv4 for recognizer IDs; the advisory
concerns buffer arguments in v3/v5/v6. A dependency override would not replace Vosk's
prebundled code, so no clean-audit claim is made. Review a maintained runtime upgrade
before public release. Current synthetic checks cover the executed recognition path.
