# Friction log — observed issues only

## Amazon tool/sample observations (3)

| ID | Task / steps | Expected | Actual | Severity | Workaround | Actionable suggestion |
| --- | --- | --- | --- | --- | --- | --- |
| F008 | Run Builder Tools init-context --help in restricted workspace | Show help without writes | Tries to create ~/.vega/logs and logger fails before help | Important | Same command succeeds after escalation | Parse --help before initializing logs; support configurable writable log directory |
| F009 | Use init-context --agent codex --skip-mcp-config with no interactive input | Noninteractive setup completes | Context/skills installed, then project identifier question raises ERR_USE_AFTER_CLOSE | Important | Add explicit Fire OS config and rerun in a terminal; succeeds | Expose a noninteractive opt-out flag and handle EOF safely |
| F010 | Install official TV sample's locked dependencies | Compatible baseline | Yarn reports React/Expo peer mismatches and an optional TypeScript patch warning | Important | Retain baseline lockfile and inspect build before updating versions | Test the supplied starter against one coherent Expo/RN dependency matrix |

## Generic environment/third-party observations (11)

| ID | Task / steps | Expected | Actual | Severity | Workaround | Actionable suggestion |
| --- | --- | --- | --- | --- | --- | --- |
| F001 | Activate amazon-tv in a profile-free PowerShell shell | Conda command available | Command not found | Important | Use the existing initialized PowerShell profile | Document shell initialization and verify the shell before setup |
| F002 | Activate amazon-tv using initialized shell | Dedicated project environment available | EnvironmentNameNotFound | Important | Create from committed environment.yml | Make environment creation an explicit bootstrap exception to activate-first |
| F003 | List Conda environments in restricted execution | Environment discovery completes | WinError 5 in Conda CUDA virtual-package multiprocessing | Important | Request normal sandbox escalation | Provide graceful diagnostics when multiprocessing is restricted |
| F004 | Query CPU virtualization via Get-CimInstance | Read-only hardware status | Access denied by execution sandbox | Important | Request normal sandbox escalation before emulator diagnosis | Distinguish access failure from disabled virtualization |
| F005 | Run Node 20 tests with shell wildcard paths on Windows | Tests discovered | Node receives literal *.test.js and cannot find file | Important | Use explicit test paths | Use test-runner discovery or portable explicit paths rather than Unix shell expansion |
| F006 | Run Node test runner in sandbox | Tests execute | Child process spawn EPERM | Important | Escalated same test command; all ten tests pass | Surface subprocess sandbox failures separately from test assertion failures |
| F007 | Clone official sample in sandbox | GitHub download succeeds | Sandbox proxy connection refused | Important | Escalate the same clone | Explain network restrictions in onboarding diagnostics |
| F011 | Download Android Studio through winget | Installer downloads | Delivery Optimization times out; WinINet fallback receives no bytes for several minutes | Important | Cancelled stalled installer; direct Google download started with SHA256 validation | Give bounded downloader timeouts and a resumable direct-download alternative |

| F012 | Activate amazon-tv, launch a child PowerShell with its default profile to export source | Child inherits project environment | Child profile changes Conda environment; script's activation check rejects execution | Important | Invoke script in the activated shell; use NoProfile for npm PowerShell tasks | Keep automation profiles from overriding the parent's explicit project environment |
| F013 | Prebuild JabTempo's standalone Expo54/config-tv0.0.10 TV target | Native generation completes | Older Flipper removal helper calls unavailable glob default.sync | Important | Confirm generated sources have no Flipper references, then disable obsolete removal helper | Update plugin compatibility with modern glob/Expo and make absent Flipper a no-op |
| F014 | Export native Metro bundle with temporary TypeScript declaration-path aliases | Runtime packages resolve | Expo consumes TS paths and React resolves to @types/react | Important | Remove temporary aliases after real standalone dependencies install | Separate declaration-only verification from runtime resolution; require bundling evidence |

Total14 observed entries; only3 concern Amazon tools/sample. F013/F014 are integration issues in
our derived target, not claims of defects reproduced in Amazon's unchanged sample.
Builder init-context and local MCP handshake were executed; the chat has not used connected Builder
tools. Do not invent entries to reach the10-Amazon-entry bonus target.

Prompt 2b additional generic observation:

| ID | Action | Expected | Observed | Severity | Resolution | Improvement |
| --- | --- | --- | --- | --- | --- | --- |
| F015 | Inspect mobile-mcp1.0.7 dependency compatibility with required Node20 | Compatible dependency engines | Current transitive mobilewright requires Node≥22.12 | Important | Second pinned candidate mobile-mcp1.0.0/mobilewright0.0.52 supports Node20; actual handshake PASS | Validate transitive engines before choosing a pinned automation tool |

Current total15, still only3 Amazon-specific observations. This is a tooling compatibility issue,
not an Amazon defect or an invented emulator/device failure.

## Prompt 4 observed integration issues (+4)

| ID | Task | Actual issue | Resolution | Suggestion |
| --- | --- | --- | --- | --- |
| F016 | Lazy-load Vosk browser module | UMD import exposed the constructor under default, so Model was not a constructor | Normalize module default and exercise real initialization | Document module shape and test modern bundler imports |
| F017 | Run local Vosk under restrictive CSP | Embedded blob worker inherited the document policy; Emscripten dynamic JS binding was blocked | Extract the pinned worker as its own local asset, allowing eval only in that worker response | Provide a static-worker/CSP deployment mode |
| F018 | Initialize the English model in the browser | IndexedDB sync failed; converted archive initially omitted directory entries | Use worker-memory model files and preserve tar directory entries; actual WASM load/recognition passed | Make persistence optional and validate model packaging |
| F019 | Add hand lanes and per-hand summary | Larger notes/metrics clipped round and summary controls | Compact headings/score layout; strengthen regression to check full focused-button clipping | Recheck safe-area geometry whenever content is added |

Current total19; only3 are Amazon-specific. These are executed observations, not invented device failures.

## Prompt 5 native setup observations

| ID | Task | Actual issue | Resolution | Suggestion |
| --- | --- | --- | --- | --- |
| F020 | Stage the app's standalone native workspace on D: | Workspace junction creation referenced missing apps/dev-web | Include that workspace source when staging and recreate only known in-repository links | Validate workspace targets before copying dependencies |
| F021 | Bundle the official sample from its staged monorepo | Metro resolved the app-relative Expo entry against the monorepo root and failed | Supported EXPO_NO_METRO_WORKSPACE_ROOT=1 setting; second build succeeded and app ran | Make the Metro root explicit for standalone native debug bundles |
| F022 | Launch the freshly installed official sample | Package-scoped Leanback intent did not resolve on the first invocation | Start its declared com.anonymous.MultiTVSample/.MainActivity explicitly; actual rendered UI verified | Keep an explicit activity fallback and verify rendering after startup |

Current total22; these new observations are local integration issues, not
additional Amazon-specific defects. Sample screenshot and build records are in
`results/native/`; no physical iPhone measurement is implied.

| ID | Task | Actual issue | Resolution | Suggestion |
| --- | --- | --- | --- | --- |
| F023 | First native JabTempo launch | Literal whitespace inside the SVG silhouette triggered React Native's text-outside-Text error; web accepted it | Removed the stray SVG text child, rebuilt and verified rendered native screens | Inspect native SVG children after web-first UI work |
| F024 | Observe animated calibration with UIAutomator | Dump could not obtain idle UI but left prior XML in place; test read stale counters although app captured samples | Require an actual dump-success response; let calibration complete and stop synthetic inputs before reading counters; pause gameplay for hierarchy capture | Never infer fresh UI from command exit code alone |

Current total24; new native integration/test observations are not attributed as
Amazon-specific defects. No additional Amazon-specific issue count is claimed.

## October 13 first-play and build observations

| ID | Task | Actual issue | Resolution | Suggestion |
| --- | --- | --- | --- | --- |
| F025 | Use the emulator from the laptop | The development AVD had `hw.keyboard=no`, so the documented arrow/Enter controls did not reach the TV | Enabled keyboard and touch only in the named development AVD, then verified foreground-scoped Windows Right/Enter on the native app | Inspect AVD input settings before documenting keyboard controls |
| F026 | Make pairing obvious before camera setup | The phone delayed its relay connection until camera playback and pose initialization succeeded; a camera/model failure made game buttons appear broken | Separate Connect to TV from explicit camera start, retain controls after camera failure and test native Family navigation from a desktop browser | Test the pairing state independently from sensor permission and worker loading |
| F027 | Add duration and presets to shared RN TV source | Metro could not resolve a new TypeScript module through a `.js` import, though Node/TypeScript tests passed | Added a physical JS bridge to the typed module; native build5 then bundled and ran | Include a native Metro build whenever shared package module structure changes |
| F028 | Show the larger Summary after adding measured counts | Full web TV focus smoke found the Next player button partly clipped at 1080p | Reduced Summary histogram and hand-stat height; web/native retests track the result | Check focus visibility in the most crowded family and long-session states |

Current total28. These are observed project/Android integration issues and are
not submitted as four new Amazon-specific tool defects. The Pair screenshot,
pair-first/native reports and build4 failure/build5 success retain the evidence.

## October 16 owner-start observation

| ID | Task | Actual issue | Resolution | Suggestion |
| --- | --- | --- | --- | --- |
| F029 | Start the TV emulator after ADB was stopped | Windows PowerShell 5.1 promoted ADB's normal daemon-start stderr line to `NativeCommandError` under `ErrorActionPreference=Stop`, aborting the launcher before emulator boot | Capture native stdout/stderr with local `Continue` preference, then use ADB's actual exit code; the launcher reached READY on a cold daemon, and native/keyboard/pairing retests passed | Exercise launchers from a fully stopped emulator and ADB daemon on Windows PowerShell 5.1 |
| F030 | Rerun native smoke with retained app data | The test assumed a cold launch always opens Home, but this emulator reopened on Pair | Normalize the known Pair state with Back before asserting Home; the full nine-screen rerun passed | Preserve app data in smoke runs and test both Home and saved-entry states |

These are local PowerShell/test integration issues, not Amazon-specific defects.
