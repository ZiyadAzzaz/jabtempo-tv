# Connect a phone to JabTempo

1. Start the native emulator and relay with `. .\scripts\start_playing.ps1`
   inside the `amazon-tv` Conda environment. Read the **current HTTPS phone URL**
   and certificate SHA256 printed by the launcher.
2. Put the phone and laptop on the same trusted Wi-Fi. Open that exact HTTPS URL
   in Safari on iPhone or a current Android browser. `localhost` copied from
   the laptop will point at the phone itself and will not work.
3. If the phone does not trust the local development certificate, use the
   certificate download address printed by the launcher. Compare its SHA256
   with the launcher's value. Install and explicitly trust it using the phone's
   system settings. This is a manual owner action; do not ask testers to trust
   a development certificate on their devices.
4. Enter the four-digit code shown on the TV. Tap **Connect to TV**, then
   **Start camera** and grant permission. Keep the phone stable and the browser
   in the foreground, with your face, shoulders, elbows and wrists visible.
5. Use TV arrows and Enter for menus. Practice left/right, calibrate four
   punches per hand, then start a round. Phone buttons send game commands but
   do not move TV menu focus.

If the phone cannot connect, verify the printed LAN IP, the same Wi-Fi, local
firewall access to the launcher's ports, and current certificate trust. Never
share a private key or development certificate authority file from `.cache/`.
