# Phone transport and recognition spike — October 2, 2026

No phone fps, phone latency or phone voice success has been measured. This is a research-backed
spike plan, not a transport selection or gate result. Work remains inside `amazon-tv`, local and $0.

## P1: browser camera

The existing development page loads pinned MediaPipe Tasks Vision and the local model/WASM
assets, runs pose inference in a classic worker and sends keypoints/events through the relay.
The [official MediaPipe web guide](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
documents synchronous inference and recommends workers to avoid blocking the UI.

Localhost supports laptop camera development. A phone accessing a laptop LAN address requires
a trusted secure context; the current HTTP dev server alone is not the phone HTTPS product path.
Prepare HTTPS locally and put certificate trust/install in the human queue before using it.
Do not weaken browser security or install a root certificate automatically.

The [Web Speech specification](https://webaudio.github.io/web-speech-api/)
and [on-device explainer](https://github.com/WebAudio/web-speech-api/blob/main/explainers/on-device-speech-recognition.md)
define `processLocally:true` as a requirement for local recognition, and
`available({langs:['en-US'],processLocally:true})` as the capability/language-pack check.
These are draft API capabilities, not proof that the user's Android browser implements them.
The page checks both and keeps voice disabled when unavailable. A hold button alone does not
make a remote recognizer private. Do not substitute default Web Speech recognition.

Implementation review: a run token covers permission/video playback/bitmap awaits; Stop cancels
the pending run and closes tracks/worker/bridge. The classic worker supports MediaPipe's
`importScripts` loader and same-origin CSP with `wasm-unsafe-eval`. Main-thread monotonic
timestamps go unchanged into inference and motion; worker time measures inference duration
only. One bitmap may be in flight. All application protocol sends are capped at 60/second,
below the relay limit, with display skeletons capped at 15 Hz. These choices are code behavior;
actual camera and CSP initialization still require a consented runtime test.

## P2: native candidate assessment

| Candidate | Primary evidence | Assessment |
| --- | --- | --- |
| VisionCamera | [Repository](https://github.com/margelo/react-native-vision-camera), [MIT license](https://raw.githubusercontent.com/margelo/react-native-vision-camera/main/LICENSE), [maintainer V5 changes](https://margelo.com/blog/whats-new-in-visioncamera-v5) | V5 is current; maintainer says V4 is no longer actively maintained. V5 changes frame processors to Nitro modules and uses `react-native-worklets`; do not assume V4 plugins are compatible. |
| cdiddy77/react-native-mediapipe | [Repository](https://github.com/cdiddy77/react-native-mediapipe), [MIT license](https://github.com/cdiddy77/react-native-mediapipe/blob/main/LICENSE), [package manifest](https://raw.githubusercontent.com/cdiddy77/react-native-mediapipe/main/package.json), [pose API](https://github.com/cdiddy77/react-native-mediapipe/blob/main/docsite/docs/api_pages/pose-landmark-detection.md) | Existing native packaging and pose hook. Manifest inspected at 0.6.0 uses VisionCamera 4.x/worklets-core in development, so a matched pinned stack or V5 adaptation is needed. Latest maintenance/build compatibility not established by documentation alone. |
| munishbp/react-native-mediapipe-pose-plugin | [Repository](https://github.com/munishbp/react-native-mediapipe-pose-plugin), [release](https://github.com/munishbp/react-native-mediapipe-pose-plugin/releases) | Author describes native Android/iOS wrappers and MIT licensing; initial release lists library packaging/autolinking and runnable example as follow-up work. License file fetch failed during research, so no code has been incorporated. Published author benchmarks are not our phone measurements. |
| EndLess728/react-native-mediapipe-posedetection | [Repository](https://github.com/EndLess728/react-native-mediapipe-posedetection), [manifest](https://github.com/EndLess728/react-native-mediapipe-posedetection/blob/main/package.json) | Declares New Architecture-only and MIT; derives from cdiddy77. New Architecture is not itself proof of VisionCamera V5 compatibility. Actual license file and Android build must be checked before adoption. |

Finding: no inspected wrapper establishes a tested current-V5, current-Expo, user's-phone
combination. Avoid a blind “latest everything” installation. Best short native spike is the
already packaged cdiddy77 pose example on its matched pinned dependency versions; assess
V5 compatibility separately. This is a candidate, not a decision to ship unmaintained code.
If wrapper build attempts fail twice, evaluate a thin Android Kotlin MediaPipe bridge against
Google's native Tasks API; preserve the same TypeScript detector and wire protocol.

For native voice, the [Android SpeechRecognizer reference](https://developer.android.com/reference/android/speech/SpeechRecognizer)
provides API 31+ `isOnDeviceRecognitionAvailable` and `createOnDeviceSpeechRecognizer`.
Use an on-device-only recognizer after availability checks, with push-to-talk interaction and
error feedback. Ordinary SpeechRecognizer may use remote services and is not an acceptable
privacy fallback. Local availability and English language support still need the user's phone.

## Execution and decision plan

1. User supplies phone model, Android/browser version, USB debugging and camera consent.
2. Time-box P1 to one day: trusted local HTTPS, actual pairing, consented real keypoints,
   worker initialization, sustained inference and an offline local-speech capability check.
3. Record actual inference fps and timestamped phone-to-relay-to-emulator samples for five
   minutes, disconnect count and pairing time. Explain whether capture timestamp is estimated
   from frame submission rather than a hardware exposure timestamp.
4. If local browser speech is unavailable, retain privacy and test the native mini-app path;
   visible command buttons can exercise the command bus during development but are not voice.
5. Time-box P2 to one day on a pinned tested example stack; verify licenses before copying,
   build locally, then perform the same phone measurements. No cloud build or paid tier.
6. Choose only from actual evidence: >=20 inference fps, p95 <=150 ms, reliable local voice,
   zero disconnects in five minutes and <=60 s pairing. Apply the documented warning branch
   only after measurement. G0 must pass before advancing the gate.

Confidence: high in API/privacy and VisionCamera version mismatch findings; medium in native
candidate feasibility; no confidence claim about this phone's performance until it is tested.
