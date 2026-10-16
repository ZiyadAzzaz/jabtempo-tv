# Local pose protocol v1

Optional development relay controls are separate from protocolv1 messages. Authenticated TV sends
`{relay:1,action:'clock',t0}`; server replies with monotonic server-domain t1/t2. Authenticated phone
sends `{relay:1,action:'trace',tCapturePhone,tInferenceEndPhone,tSendPhone}` with nonnegative finite,
ordered timestamps; the relay derives peerId and appends monotonic tRelay when forwarding to TV.
Exact allowlists reject media, extras and reversed stage times; shared rate limits apply.
The browser lab can explicitly collect/export these traces only after fresh phone and relay sync.
Canvas draw submission is not physical display latency. No trace persistence occurs in the relay.
An optional validated advertised ws/wss URL accompanies created/pairing controls; it is not auth.

Every message has `v: 1` and `type`. JSON messages have a 16 KiB ceiling.
Only the exact fields below are accepted; no video, audio, arbitrary text or nested extras.

| Type | Payload | Direction |
| --- | --- | --- |
| hello | deviceId, pairCode (four-character string), model, players (1 or 2) | Phone → TV |
| welcome | sessionId, bpm (90/110/130), mode (solo/versus/coop/family) | TV → phone |
| ping | t0 | Either initiates |
| pong | t0, t1, t2 | Responder |
| frame | t, players: [{id, kp}] | Phone → TV |
| event | t_peak, player, kind (jab/cross/hook), hand, extension, conf | Phone → TV |
| guard | t, player, state (up/down), conf | Phone → TV |
| voice | t, command, conf | Phone → TV |
| quality | t, framing, light, issues | Phone → TV |
| bye | reason | Either |

Timestamps are monotonic milliseconds in each endpoint's clock domain, never Date.now mixed
with performance.now. Receiver records t3 on pong arrival. Offset is remote minus local;
convert remote peak with localPeak = remotePeak - offset. Reject stale sync before judging.
Device latency is a separately measured signed gameplay offset; network RTT is not that offset.
NTP assumes approximately symmetric paths; record that limitation in benchmark reports.

`kp` is 51 JSON integers, 17 triples in COCO order: nose; left/right eyes; left/right ears;
left/right shoulders; left/right elbows; left/right wrists; left/right hips;
left/right knees; left/right ankles. Each triple is (x, y, confidence), quantized by 10000.
Coordinates refer to unmirrored source images. Display mirroring must not swap anatomical hand labels.
Coordinates are clipped to [0,1]; a point outside the image gets zero confidence.
This is JSON integer encoding, not a binary int16 transport. Display frames target 15 Hz;
TV rendering targets at least 20 fps independently. Frames do not drive punch judging.

All confidence, extension and quality values are in [0,1]. IDs are 1/2.
Voice commands: start, pause, resume, harder, easier, next round, two players.
Unknown speech stays on phone and causes no action. Schema validity does not imply confidence
or session validity: receiver must also enforce pairing, direction, active players, rate limits,
command thresholds and replay checks. Four-digit pairing alone is not strong authentication.

## Relay control plane

The implemented development topology uses a laptop relay. TV is a client to
`ws://10.0.2.2:8787/bridge`; phone is a client to the host LAN address. G1 decides the product
phone camera path using actual device evidence. Direct TV server mode remains unimplemented.

Relay controls are separate from the strict pose schema: `relay:1` and `action` replace `v/type`.
They may never be parsed as pose messages. Inputs have exact field allowlists.

| Action | Fields after relay/action | Direction |
| --- | --- | --- |
| create | versions:[1] | TV to relay |
| created | sessionId, pairCode, resumeToken, expiresAt, version:1 | relay to TV |
| paired | sessionId, peerId, resumeToken, playerBase, version:1 | relay to phone after hello |
| resume | sessionId, peerId, resumeToken, versions:[1] | disconnected endpoint to relay |
| resumed | sessionId, peerId, version:1 | relay to endpoint |
| renew | none | authenticated TV to relay |
| pairing | pairCode, expiresAt | relay to TV |
| peer | state:joined/left, peerId, playerBase | relay to TV |
| message | peerId, message (validated pose schema) | relay to TV |
| route | peerId, message (ping/pong/welcome/bye only) | TV to relay to selected phone |
| error | reason (fixed category) | relay to endpoint before policy close |

TV must negotiate version 1 before pairing. Phone hello negotiates through its v:1 and receives
paired plus welcome. Pair code lifetime is five minutes. Secret credentials are ephemeral; resume
requires the previous socket to be disconnected and no more than ten seconds elapsed. Two phones
and two total player slots are allowed; a two-player phone consumes both slots. Each phone uses
local IDs 1/2; relay maps to unique TV IDs with playerBase. It does not alter monotonic timestamps.
Relay welcome starts at 110 BPM; authoritative TV welcome overrides it after game setup.

Relay uses native WebSocket ping/pong every two seconds and terminates an endpoint that fails the
next liveness check. Unauthenticated sockets have a six-second handshake deadline. Clock ping/pong
stays in the pose protocol and is routed end-to-end, not answered using the relay's clock.
Client retry delay starts at 250 ms, doubles to at most 5 s and applies 0.8–1.2 random jitter.
Explicit policy rejection stops retries; network failure resumes within ten seconds or renegotiates.
No game events are persisted or replayed. Sync must reset on every connection and resumed game.

Pairing codes are not strong authentication. Use only a trusted Private LAN and visible pairing.
No persistence; no identifying data in logs. Do not expose the receiver to the public internet.
