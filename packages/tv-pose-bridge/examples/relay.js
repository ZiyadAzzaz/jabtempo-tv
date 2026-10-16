import { networkInterfaces } from 'node:os';
import { createRelay } from '../src/relay.js';
const relay = await createRelay();
console.log('JabTempo TV development relay listening on TCP 8787. No firewall changes made.');
for (const entries of Object.values(networkInterfaces())) for (const entry of entries) {
  if (entry.family === 'IPv4' && !entry.internal) console.log(`Phone relay URL: ws://${entry.address}:8787/bridge`);
}
console.log('TV emulator URL: ws://10.0.2.2:8787/bridge. TV creates pairing code; QR payload is {relayUrl,pairCode}.');
process.on('SIGINT', async () => { await relay.close(); process.exit(0); });
