# Two-minute first-playable self-test

For the full beginner walkthrough and **your iPhone connection setup**, read
[How to connect and play](how_to_play.md). Copying localhost to an unconnected phone does not work.
The URLs below are the laptop-only webcam test; iPhone uses the trusted Wi-Fi HTTPS URLs in that guide.

Only you start your real camera. This test records keypoints locally after your own explicit
consent; no video or microphone recording. Your identity/session is training-only and is rejected
by held-out evaluation. We will tune on it only if detection feels wrong.

```powershell
conda activate amazon-tv
npm run setup:assets
npm run build:web
npm run build:tv-web
npm run dev
```

Open `http://localhost:8787/tv-web` on the TV/laptop display and
`http://localhost:8787/phone` in a second browser window. The TV is a web preview, not an emulator.
Choose Play, enter its code on the camera page, read consent and start capture. Select your actual
stance for optional boxing labels. Default labels are LEFT / RIGHT: blue circle = your physical
LEFT hand, orange rounded square = your physical RIGHT hand. Frame face, shoulders, elbows
and wrists, with room for comfortable movement. Complete the waiting tutorial note with LEFT,
then RIGHT; each note waits for the correct wrist. Selfie preview mirroring never exchanges
anatomical hands. If the live hand check actually reverses your hands, use the TV swap control
once and verify both sides before calibration.

On the camera page, check the separate two-minute training consent and start the self-test. On
the TV, continue to calibration at 90 BPM, wait four beats, then collect **four LEFT punches,
followed by four RIGHT punches**. Jab and return to your chin; alternate beats are fine.
The visible counter should follow the requested hand. Start a round, use the LEFT / RIGHT
lanes and hand icons, return to guard and include a few rests. Confirm a deliberate wrong-hand
trial shows "Other hand!" and does not award a hit.
Use Arrow/Enter/Backspace for menus; all actions remain available by remote in the native build.

Check: beat audible, notes approach the hit line, actual punches yield judgments, score/combo
respond, guard feedback appears and Summary leads back Home. Record how timing **feels**, not
a guessed latency. The self-test automatically caps capture at two minutes; Stop ends it sooner.

Check Summary separately for LEFT / RIGHT accuracy, timing and guard recovery; missing
measurements must remain unavailable. A weaker-hand drill is a game result, not clinical coaching.

Review the local keypoint skeleton and timeline: blue detector events and orange independent
observations. Use the replay slider to inspect actual punch peaks and mark observed jab/crosses.
Live label taps include human reaction delay; replay review is more useful. Counts on the timeline
are not precision/recall. Download the training-only JSONL into ignored `local_private/` for tuning.
Do not include this person in G2's three held-out participants.

Tell the agent whether a full round plays and the timing feels right, or share the local training
file path plus what felt wrong (missed jab, wrong type, repeated hits, late judgment). Nothing is
uploaded or published automatically. M1 remains **ready for human validation**, not sensor-verified,
until this real-camera test succeeds.


## Owner iPhone and other browser checks

The owner's iPhone uses the trusted same-Wi-Fi HTTPS setup in the guide; label its measured
results **iPhone-Safari-LAN**. Android Chrome and tablet browsers use the same `/phone`
companion and hand model, but each needs its own real-device run. Responsive screenshots or
synthetic punches establish UI/protocol behavior only. Never ask testers to install our local
certificate on their own devices; use the owner's iPhone or laptop webcam unless a fully
browser-trusted connection is available.

After the two-minute training capture, optionally play for five minutes without recording raw
media. Report actual pose FPS from the display, battery percentages before/after and whether
the device warmed or slowed. Capture-to-render latency requires the instrumented trace path;
feeling "fast" is feedback, not a numeric latency measurement. Quiet/beat voice accuracy is
pending actual consented recognition tests; buttons and the TV remote work independently.
The updated self-test is **pending until you perform it**, even if the previous version worked.
