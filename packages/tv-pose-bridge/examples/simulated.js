import WebSocket from 'ws';
import { createRelay } from '../src/relay.js';
import { BridgeClient } from '../src/client.js';
const relay = await createRelay({ host: '127.0.0.1', port: 0 });
let phone;
const tv = new BridgeClient({ url: relay.url, role: 'tv', WebSocketImpl: WebSocket,
  onControl(m) {
    if (m.action === 'created') {
      phone = new BridgeClient({ url: relay.url, role: 'phone', WebSocketImpl: WebSocket,
        hello: { v: 1, type: 'hello', deviceId: 'simulated', model: 'unit-only', players: 1, pairCode: m.pairCode },
        onControl(c) { if (c.action === 'paired') phone.send({ v: 1, type: 'event', t_peak: 100, player: 1, kind: 'jab', hand: 'left', extension: 0.9, conf: 0.9 }); },
      }).connect();
    }
  },
  async onMessage(m) {
    if (m.type !== 'event') return;
    console.log('Simulated loopback event received. This is not a camera/device/latency gate result.');
    phone.close(); tv.close(); await relay.close();
  },
}).connect();
