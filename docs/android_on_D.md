# Android TV setup on D:

Prompt 5 moves Android tools off C:. Android Studio is not needed for this path.
The initial disk check found C: 1.19 GiB free and D: 26.19 GiB free. C: is below
the requested 2 GiB warning threshold; Windows itself can still use C: for its own files.

## Completed by the agent

- Downloaded Google's official Windows command-line tools (155,655,386 bytes) to
  `D:\android-fire-TV\downloads` and extracted to `sdk\cmdline-tools\latest`.
- Verified the [published SHA-256](https://developer.android.com/studio):
  `90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a`.
- Persisted Android SDK/AVD/user and Gradle paths, JDK17, TEMP and TMP only in
  the `amazon-tv` conda environment. No global PATH snapshot or system setting changes.
- Updated `scripts/use_android_sdk.ps1` to add tool paths for the current session
  and direct JVM temporary files to `D:\android-fire-TV\tmp`.
- Queried the actual package catalogue: API34 TV offers
  `system-images;android-34;android-tv;x86`, not an x86_64 TV package.
  The intended one-image installation uses that available Intel image.

The conda warning about overwriting TEMP/TMP refers to the activated environment's
session values; the machine's persistent environment is not edited.

## Completed license handoff

The owner completed the commands and answered the agreements personally.
SDKmanager subsequently verified **All SDK package licenses accepted**.
The requested SDK packages and one API34 Android TV x86 image are installed.
The builds also required NDK27.1.12297006 and build-tools35.0.0; these are on D:.
WHPX is usable; no Windows feature changes were needed. The AVD booted in45.57s.
The official sample APK built and ran: sample G0 PASS, with actual screenshot
`results/native/Official-sample.png`. JabTempo's APK also built and installed;
native smoke completion and the physical iPhone round are separate checks.
Use [the native play guide](native_emulator_play.md). Disk sizes are recorded in
`results/android_disk_current.json`; C: remains low and all managed native build
files stay on D:. Nothing from the owner's files has been deleted.

### Earlier human license instructions

The executed review reported **7 of 7 SDK package licenses not accepted**.
The agent cancelled without answering yes. Your Prompt 5 says:
“This is my legal acceptance (human action).”

Open PowerShell in the project folder and run:

```powershell
conda activate amazon-tv
. .\scripts\use_android_sdk.ps1
& "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root="$env:ANDROID_HOME" --licenses
```

Read each agreement and answer `y` yourself only if you accept it. This review may
also offer agreements for optional packages that we will not install. Send the
terminal's final result, for example `All SDK package licenses accepted`, or explain
which agreement you declined. The agent does not accept agreements for you.

## Next autonomous sequence after that result

1. Install `platform-tools`, `emulator`, `platforms;android-34`,
   `platforms;android-36`, `build-tools;36.0.0`, and the single API34 TV x86 image.
   API36 is required by the current sample and app's compileSdk configuration;
   targetSdk remains 34. Install additional native build dependencies only when
   the generated Gradle configuration actually requires them.
2. Create `JabTempo_TV_1080p` with the `tv_1080p` hardware profile, with AVD disks
   under `D:\android-fire-TV\avd`. Run acceleration check before launch.
3. If acceleration fails, report the exact error; enabling Windows Hypervisor
   Platform and restarting remains your manual action. Do not change BIOS/security.
4. Build and launch the official sample first; save native screenshot evidence.
5. Build/install JabTempo, inspect its native logical screen dimensions, D-pad,
   assets, audio and speech, then pair your iPhone for an actual full round.
6. Record a real round only with your explicit recording participation/consent.

At the earlier checkpoint, G0, APK installation, acceleration and native round were **PENDING**.
Web preview screenshots and synthetic protocol tests do not satisfy them.
Evidence: `results/android_tools_setup.json`, `results/android_sdk_packages.txt`
and `results/prompt5_setup.json`. No SDK package or license acceptance is fabricated.
