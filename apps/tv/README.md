# JabTempo TV native app

JabTempo TV is a shared React Native TV game built for the Fire TV track. Its Expo configuration follows [Amazon's multi-TV sample](https://github.com/amazon-devices/react-native-multi-tv-app-sample) at commit `a2dce86ee2d0bdbf03b4fdda9985672213d3647e`; the copied sample code retains [LICENSE.amazon-sample](LICENSE.amazon-sample) (MIT-0). JabTempo code uses the root MIT license.

The native app has Home, Pair, How to play, Calibrate, Round, Summary, Family, Daily and Settings screens. The local phone browser performs pose inference; the TV receives keypoints and game events, draws two physical LEFT/RIGHT lanes, plays local beat audio, scores by the audio clock and responds to D-pad, phone buttons and optional local voice commands. Practice requires the correct hand; calibration collects four LEFT and four RIGHT samples. Back pauses rounds and Resume counts in. Family mode is turn based on the same chart and pace.

The current game offers Kids, Beginner, Workout and Pro presets and 1, 3 or 5 minute sessions. Preference and personal best are local to the TV. Summary punch totals count unique detected events and active time follows advancing audio position. These are game statistics, not validated sensor accuracy, health or fitness outcomes.

## Build and launch on the development emulator

From the repository root, use the `amazon-tv` Conda environment and the command-line Android SDK described in [native emulator play](../../docs/native_emulator_play.md). The scripts default to `D:\android-fire-TV`; set `JABTEMPO_ANDROID_ROOT` to a different absolute SDK workspace root before running them if needed. The standalone TV Yarn tree is intentionally separate from root npm workspaces.

```powershell
conda activate amazon-tv
. .\scripts\use_android_sdk.ps1
$env:EXPO_PUBLIC_JABTEMPO_RELAY_URL='ws://10.0.2.2:8789/bridge'
$env:EXPO_PUBLIC_JABTEMPO_SETUP_URL='http://10.0.2.2:8789/connection'
$env:EXPO_PUBLIC_JABTEMPO_PHONE_URL='https://YOUR_WIFI_IPV4:8787/phone'
python scripts/prepare_native_workspace.py jabtempo
python scripts/build_native.py jabtempo --attempt 5 --low-memory
. .\scripts\start_playing.ps1
```

Replace `YOUR_WIFI_IPV4` with the laptop's current Wi-Fi address. The optional setup URL lets the TV refresh its QR/link from the running local gateway if the address changes. The browser controller still needs a valid trusted HTTPS certificate on the phone; certificate trust remains a manual user step. The x86 debug APK is for the Android TV emulator, not an ARM Fire TV release package.

The official sample G0 ran in the emulator: [evidence](../../results/native/sample_g0.json). JabTempo's October 3 nine-screen native smoke also passed with synthetic protocol inputs: [evidence](../../results/native/smoke_verified.json). Later edits need their own build/run evidence. A complete physical iPhone round, audible sound, real sensor/latency testing and human usability remain separate gates.

For a browser-only preview, run `npm run build:tv-web` and `npm run dev` from the root inside `amazon-tv`, then open `/tv-web`. Browser preview images are not native emulator footage.
