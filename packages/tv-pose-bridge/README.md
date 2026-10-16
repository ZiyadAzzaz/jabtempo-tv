# tv-pose-bridge

An MIT local phone-to-TV protocol, clock estimator, browser/React Native client and Node relay for
JabTempo TV. Only landmark coordinates, punch/guard events, fixed voice commands and quality hints cross
the bridge. Strict v1 validation rejects raw media, arbitrary transcripts and extra fields.

Implemented: relay pairing, version negotiation, player slot mapping, liveness heartbeat,
bounded reconnect/backoff and ten-second secret-based session resume; Node integration tests and example.
Phone inference, RN device integration and capture-to-render measurements remain unverified.

In the standalone `tv-pose-bridge` folder, use the project's Node 20
environment and three commands. If `amazon-tv` does not exist yet, first run
`conda env create -f environment.yml` (the small standalone environment file):

```powershell
conda activate amazon-tv
npm ci
npm test
npm run example
```

The example is a self-contained simulated loopback exchange.
Run `npm run relay` for the server (TCP 8787, /bridge). It prints host LAN
addresses. A TV client creates the code, then displays `{relayUrl,pairCode}` as its QR payload; codes
are never printed by the relay. Same Wi-Fi and a user-approved Private-network firewall rule are needed
for phone access. This package never changes firewall rules. Port 0/127.0.0.1 is used only in tests.

```js
import { BridgeClient } from 'tv-pose-bridge';
const tv = new BridgeClient({
  url: 'ws://10.0.2.2:8787/bridge', role: 'tv',
  onControl: m => { /* show created/pairing code; update peer state */ },
  onMessage: (message, peerId) => { /* consume validated protocol; reply to ping via send(pong,peerId) */ },
}).connect();
// Phone: role:'phone', hello:{v:1,type:'hello',deviceId:'ephemeral',
// pairCode:'0123',model:'browser',players:1}; send(event), close().
```

Browser and RN use native WebSocket; Node injects `WebSocketImpl` from `ws`. `send` returns false
when disconnected or when its outbound queue exceeds 64 KiB. Callers should pause gameplay and indicate
connection loss; transport does not replay events after reconnect. Reset clock sync after every reconnect.
Pairing rejection stops retries; explicitly reconnect with a current code. Resume tokens stay in memory.
The client exposes protocol messages to the application: sample monotonic t0/t1/t2/t3 there, and exchange
ping/pong every two seconds during play. WebSocket heartbeat is liveness, not a clock measurement.

Server import: `import { createRelay } from 'tv-pose-bridge/relay'`. Await
`createRelay({httpHandler:(req,res)=>boolean})` to share port 8787 with a camera page; await `relay.close()`.
The handler must return true when it owns the response. `/health` provides only `{ok:true}`.

Limits: 16 KiB messages, 80/s/socket, five pair attempts/IP/minute, two phones and two total player slots,
32 TV sessions, 100 sockets. Codes expire in five minutes; TV `renewPairing()` rotates them. Disconnected
slots remain reserved for ten seconds. No persistence, payload logging, cloud account or paid API.
The server's optional log callback receives fixed categories only. There is no camera recording.

Demo disclosure: **Demo uses the Android TV emulator; a laptop relay connects phone and emulator on the
local network.** Physical Fire TV Direct mode is a protocol-compatible design; a TV-hosted server has
not been implemented or verified on hardware. Relay device performance is also pending G0/G1.
LAN `ws://` is plaintext and suitable only for a trusted Private network. It is not Internet hosting.
A phone browser camera needs HTTPS; `http://localhost:8787/dev-cam` is the laptop-only development path.

See [protocol.md](protocol.md). ws is [MIT](https://github.com/websockets/ws/blob/master/LICENSE).
Tests use simulated clients and controlled clocks; they are not sensor/device accuracy or latency evidence.
