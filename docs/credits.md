# Credits and licenses

| Item | Origin | License / status |
| --- | --- | --- |
| Project source written in this repository | Original implementation for the user | MIT |
| Master prompt and companion architecture | Supplied by user | Preserve source originals; confirm public redistribution before publishing them |
| Amazon multi-TV sample | AmazonAppDev/react-native-multi-tv-app-sample | MIT-0; preserve upstream license when code is incorporated |
| Amazon Devices Builder Tools 1.0.13 | Official npm development tool, tools/amazon-builder | Package declares UNLICENSED; installed dependency only, bundled vendor content is not our MIT code |
| MediaPipe Tasks Vision0.10.32 and full float16 pose model version1 | google-ai-edge/mediapipe; pinned Google storage model | Apache-2.0; full license in licenses/MediaPipe-Apache-2.0.txt; model maintainer confirmation in issue6306; local cache only |
| ws8.22.0 | websockets/ws | MIT; licenses/ws-MIT.txt |
| qrcode1.5.4 | soldair/node-qrcode | MIT, Copyright2012 Ryan Day; licenses/qrcode-MIT.txt |
| Beat and feedback WAVs | scripts/gen_beats.py original sine synthesis | CC0-1.0; generated locally, no sampled audio |
| LEFT / RIGHT fist SVG paths and play diagrams | Original code/vector assets in App.tsx and docs/images | MIT; no third-party imagery |
| Vosk-browser0.0.8 and Vosk small English0.15 | ccoreilly/vosk-browser; Alpha Cephei model table | Apache-2.0; local worker and model only; pinned provenance in results/voice_asset.json |
| Expo Speech14.0.8 | Expo SDK54 native speech module | MIT; native engine execution pending emulator |

No third-party imagery, sampled music or participant recordings have been added to product source.
The9,398,198-byte pose model is downloaded only into the ignored cache; provenance and SHA256
are in results/model_asset.json. The exact model URL's Apache license was explicitly confirmed by
the maintainer in https://github.com/google-ai-edge/mediapipe/issues/6306. Preserve license and
notices with distributions; project MIT does not replace dependency licenses.
The sample checkout and dependency files are ignored development downloads. Generated vendor context
in docs/amazon-builder is ignored as well; setup reproduces it rather than republishing vendor text.
Inventory actual package/model licenses before release, not merely their intended license.
# Product typography

Barlow Condensed Bold: Copyright 2017 The Barlow Project Authors,
[official font source](https://github.com/google/fonts/tree/main/ofl/barlowcondensed).
Manrope variable: Copyright 2018 The Manrope Project Authors,
[official font source](https://github.com/google/fonts/tree/main/ofl/manrope).
Both SIL Open Font License 1.1. Original fonts, complete notices and SHA256 manifest are bundled
under apps/tv/assets/fonts. Fonts are loaded locally; no Google Fonts runtime requests.
