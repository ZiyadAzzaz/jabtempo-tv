# Play JabTempo on the Android TV emulator

The **TV game** runs in the visible Android TV emulator on your laptop. Your **iPhone** runs the controller in Safari and supplies its camera. Both devices must use the same Wi-Fi. A phone never opens a `localhost` link from the laptop.

## Start in one command

Open PowerShell in this project folder:

The scripts default to `D:\android-fire-TV`. If your SDK workspace is
elsewhere, set `$env:JABTEMPO_ANDROID_ROOT` to its absolute root first; it must
contain `sdk`, `avd`, `tmp` and the generated `projects` directory.

```powershell
conda activate amazon-tv
. .\scripts\start_playing.ps1
```

The script checks the current Wi-Fi address, local HTTPS certificate, phone assets, relay, Android emulator, APK and keyboard input. It prints the **current phone URL**. Keep the laptop awake; the two small servers run in the background. If the script reports a missing APK or a stale APK, follow the exact rebuild directions below. To close only these JabTempo services later:

```powershell
conda activate amazon-tv
. .\scripts\stop_playing.ps1
```

The launcher records process identities in `.cache/jabtempo-running-services.json`. It refuses to stop another app's process or an unrecognized listener. The emulator is the Android TV emulator, not a physical Fire TV. The x86 debug APK is for this development emulator.

## Control the TV on the laptop

1. Click the **Android Emulator - JabTempo_TV_1080p:5580** window so it has focus.
2. Press **arrow keys** to move the bright focus border. Press **Enter** to select.
3. Press **Escape** or the emulator toolbar's **Back** button to go back. During a round Back pauses; select Resume for a 3-2-1 count-in.
4. If keyboard input fails, open the emulator's **three-dot** toolbar menu, choose **Directional Pad**, then use its arrows and center Select. The side toolbar also has Back.

Laptop keys were actually verified on the named emulator: Right moved from Play to Family Challenge, and Enter opened Family ([host input evidence](../results/native/host_input.json)). Mouse clicks are enabled on the development AVD but physical Fire TV still uses the D-pad; clicking is not required.

![JabTempo on Android TV emulator](../results/native/JabTempo-launch.png)

## Connect and play

1. On the TV Home screen select **Play**. The TV shows a four-digit code and a QR/link. A code refreshes automatically when its five-minute lifetime nears expiry.
2. On the iPhone, use **Safari** to open the phone URL printed by `start_playing.ps1`; scan the TV QR only after the updated native app and the launcher are running. The camera page must use trusted HTTPS. The laptop may have a new Wi-Fi IP after reboot; use the newly printed URL, never the old saved one.
3. If the iPhone shows a certificate warning, follow [the owner's local trust steps](how_to_play.md). Installation and trust are your manual iPhone actions. The current local certificate fingerprint is printed during startup. Do not ask testers to install this development certificate on their own phones.
4. Enter the current TV code on the phone and tap **Connect to TV**. The phone should say **TV connected** and the TV should show **Phone connected**. This step does not need camera or microphone access.
5. Check camera consent, tap **Start camera** and allow Safari camera access. Keep Safari in the foreground. Rest the iPhone securely: show face, both shoulders, elbows and wrists; leave room for each hand to extend. The phone outline turns green when tracking is ready. A light/framing hint says what to fix.
6. On the TV select **Practice left / right**. Gently extend your real LEFT hand and return it near your chin; then do the same with RIGHT. The matching color/shape cue should respond. If both are consistently reversed, select **Hands look swapped** and redo practice/calibration.
7. Choose **Calibrate both hands**, then **Start calibration**. Wait through 4-3-2-1. Collect four clean LEFT samples, then four RIGHT samples. Each motion is extend and return. Alternate a punch with a rest beat if needed. The TV must show **LEFT 4/4 / RIGHT 4/4** and **Ready to play**.
8. Select your difficulty and session length on the Pair or Settings screen, then **Start round**. Follow the LEFT and RIGHT notes to the hit line. Return to guard after each punch. Let the round reach its summary naturally.
9. Phone buttons can send Start, Pause, Resume, Harder, Easier, Next Round and Two Players. They **do not move TV menu focus**. Use laptop arrows/Enter for menu choices.

The [illustrated guide](start_playing_visual.md) explains the punch motion. No contact with a person or object is needed. If the phone loses tracking, gameplay pauses and says how to recover. Play is a game, not a medical or exercise prescription.

## If startup says the APK has an old phone address

The launcher checks the actual bundled native script. For a fresh debug build, run from the repository root:

```powershell
conda activate amazon-tv
. .\scripts\use_android_sdk.ps1
$env:EXPO_PUBLIC_JABTEMPO_RELAY_URL='ws://10.0.2.2:8789/bridge'
$env:EXPO_PUBLIC_JABTEMPO_SETUP_URL='http://10.0.2.2:8789/connection'
$env:EXPO_PUBLIC_JABTEMPO_PHONE_URL='https://YOUR_WIFI_IPV4:8787/phone'
python scripts/prepare_native_workspace.py jabtempo
python scripts/build_native.py jabtempo --attempt 10 --low-memory --force-bundle
. .\scripts\start_playing.ps1
```

Replace `YOUR_WIFI_IPV4` with your laptop's current Wi-Fi address, as reported by the launcher or `Get-NetIPAddress -AddressFamily IPv4`. The setup URL lets the native Pair QR pick up a later address change from the running gateway without rebuilding, once this build is installed. If a new IP needs a new local certificate, the iPhone trust step is manual.

## What remains to verify in person

The official sample G0 and JabTempo synthetic native smoke passed. Synthetic protocol events cannot establish real punch accuracy. Please complete one full round with your iPhone, note whether the beat and coach speech are audible, and say if LEFT/RIGHT match your hands. Then we can finish real phone performance and three first-time usability checks. Recording faces or uploading the demo is a separate consented human action.
