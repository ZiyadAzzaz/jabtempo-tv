# Product feedback — executed experience

Reviewed October 13, 2026. This answers the required feedback fields using actual
evidence. Pending fixes are not reported as completed. Generic Windows, sandbox
and application bugs are not attributed to Amazon tooling.

## Amazon multi-TV sample and React Native TV

**Use:** Fire OS app configuration and TV foundation, retaining the MIT-0 notice.
The pinned sample and JabTempo built and ran on the Android TV emulator:
[sample G0](../results/native/sample_g0.json),
[native smoke](../results/native/smoke_verified.json).

**Worked:** a concrete Expo/TV starting point and shared UI supported browser
iteration followed by nine-screen native focus/layout checks.
**Needs work:** the sample lockfile reports React/Expo peer warnings and an optional
TypeScript patch warning. A tested dependency matrix would distinguish expected
warnings from broken setup.

**Onboarding:** prebuild succeeded before the SDK was available; the actual sample
run followed command-line SDK installation. Our staged workspace needed
`EXPO_NO_METRO_WORKSPACE_ROOT=1`, a local integration observation rather than a
reproduced defect in unchanged sample source. **Build again:** yes, with native
focus/audio/layout verification kept separate from the web preview.

## Amazon Devices Builder Tools 1.0.13

**Use:** install Fire OS-aware Codex context/skills and verify the local MCP
handshake/tool list. [Evidence](../results/builder_tools_check.json).
**Worked:** pinned isolated installation and tool discovery succeeded.
**Needs work:** `init-context --help` initializes a home-directory logger before
help. Noninteractive initialization installed context then failed at the final
identifier question when input closed. Parse help before writes, support a
configurable log directory and provide an explicit noninteractive opt-out.

**Onboarding:** normal sandbox escalation and interactive retry with explicit
Fire OS configuration completed setup (F008/F009). Restricted sandbox access
itself is not a vendor defect. **Build again:** provisionally yes for context;
an actual connected debugging workflow has not been demonstrated. Vendor tooling
is not redistributed as project MIT code.

## Expo, config-tv, react-native-video and Expo Speech

**Use:** shared app build, TV native generation, local audio playback and coach
speech integration. **Worked:** immutable native dependencies and standalone
bundling produced a working x86 APK; actual playback position drove synthetic
calibration. **Needs work:** config-tv's old Flipper-removal helper failed against
the installed glob API; generated sources contained no Flipper, so disabling
that obsolete helper resolved prebuild. Our stray SVG text child also passed on
web but failed on native; fixing the markup resolved it.

**Onboarding:** a separate Yarn tree avoided mixing incompatible Expo peers into
root npm workspaces. **Build again:** yes, with early native checks. Audible
beat/TTS quality and dedicated rendering performance still need real checks.

## MediaPipe Tasks Vision

**Use:** pinned, locally served worker pose inference, followed by our mapping and
motion rules. **Worked:** actual WASM/model inference on a file-backed synthetic
empty scene produced tracking-loss output through the relay; the camera test
reported no external requests. [Evidence](../results/camera_lab.json).
**Needs work:** the loader needs a classic worker for `importScripts`; model and
tracking failures need actionable player guidance.

**Onboarding:** pinned assets and licenses are reproducibly downloaded to an
ignored cache. **Build again:** yes, subject to actual phone heat, frame-rate and
held-out movement evaluation. Desktop inference is not phone hardware validation.

## Vosk-browser and local English speech model

**Use:** explicitly enabled push-to-talk, restricted grammar and no cloud speech
fallback. **Worked:** local worker/model loading and synthetic desktop recognition
are regression-tested. [Report](../results/controller/report.json).
**Needs work:** normalize the UMD module shape, use a deliberate static-worker/CSP
strategy, preserve archive directories and make persistence optional (F016–F018).

**Onboarding:** more involved than importing a library; local worker assets and
in-memory model files made operation explicit. **Build again:** provisionally
yes. Actual iPhone voice under game audio is unverified, so remote/buttons remain
available and a human voice demo still needs testing.

## Android SDK, emulator and ADB

**Use:** D: SDK/AVD setup, x86 debug builds, installation, screenshots, D-pad smoke
and scoped runtime logs. **Worked:** WHPX ran sample and product without keeping
Android Studio installed; native screenshots caught issues missed on web.
**Needs work:** explain host keyboard/touch defaults separately from ADB input.
UIAutomator can fail to refresh the hierarchy during animation; tests must check
the dump-success response. Host-control repairs are currently being verified.

**Onboarding:** owner license acceptance, storage and SDK paths were the main
steps. **Build again:** yes, with storage/input preflight. These observations do
not establish physical Fire TV performance or Amazon SDK defects.

## Supporting tools

| Tool | Use / worked well | Needs work / onboarding | Build again |
| --- | --- | --- | --- |
| Conda, Node/npm, Python/JDK, Yarn | Isolated tooling and separate core/native dependency trees | Activate each shell; a child profile previously changed the environment | Yes, predictable Windows tooling |
| TypeScript, esbuild, Node tests | Source checks, companion bundling, game/protocol regressions | Explicit test discovery avoids Windows wildcard differences | Yes, with device checks separately |
| Playwright | Desktop Chromium/WebKit regressions and UI captures | Mock/file media and viewport emulation must be labeled | Yes, alongside physical devices |
| ws and qrcode | Local transport and QR generation | App still needs TLS, bounded pairing and clear network instructions | Yes; retain dependency notices |
| FFmpeg and Python evaluation tools | Synthetic fixtures and local analysis | Real evaluation needs consented, independently reviewed data | Yes; keep fixtures separate |

MoveNet/TF.js, native Android SpeechRecognizer, AWS runtime services and Kiro Crew
are not completed integrations here. Do not list them as used or select AWS
Builder on the strength of documentation research alone.
