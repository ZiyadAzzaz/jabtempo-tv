# Phone controller architecture

The **browser companion in [apps/dev-web](../dev-web/README.md)** is the primary controller.
Open `/phone` in iPhone Safari, Android Chrome, a supported tablet browser or a laptop browser;
no phone app installation is required. A supported camera, secure context, WebAssembly and
adequate local performance are required. Actual devices remain separate measurement targets.

The camera produces anatomical LEFT / RIGHT wrist events. Preview mirroring changes only
pixel display, never hand identity; TV boxing labels are derived from the selected stance.
Use the on-screen hand check before four LEFT and four RIGHT calibration samples. The TV's
swap control corrects a demonstrated mapping reversal; do not change it just because a
mirrored selfie looks unfamiliar.

Development setup: laptop relay with a locally trusted certificate. Local certificate trust
is an owner-only development choice. Never ask testers to install certificates on their own
phones; use the owner's iPhone or laptop webcam unless a fully browser-trusted connection
is available. See [setup and play](../../docs/how_to_play.md).

Camera permission and training recording consent are separate. Runtime pose inference is
local; no raw video/audio is committed. Buttons and D-pad remain available when verified
local speech recognition is unavailable. Push-to-talk alone does not establish on-device
speech processing, and Web Speech must not silently become a cloud fallback.

The former native Android P2 scaffold is **parked**. No native phone app is required for this
sprint, and no native Android phone build or accuracy is claimed. Preserve the research in
[phone_spike.md](../../docs/phone_spike.md) as historical design, not the primary setup guide.
