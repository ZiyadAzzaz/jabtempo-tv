import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createRelay } from '../src/relay.js';
import { BridgeClient } from '../src/client.js';
import { performance } from 'node:perf_hooks';

async function socket(url) {
  const ws = new WebSocket(url), queue = [], waits = [];
  ws.on('message', data => { const m = JSON.parse(data.toString()); if (waits.length) waits.shift()(m); else queue.push(m); });
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  return { ws, send: m => ws.send(JSON.stringify(m)), next: () => queue.length ? Promise.resolve(queue.shift()) : new Promise(r => waits.push(r)) };
}
const hello = pairCode => ({ v: 1, type: 'hello', deviceId: 'test', model: 'simulated', players: 1, pairCode });
const event = { v: 1, type: 'event', t_peak: 10, player: 1, kind: 'jab', hand: 'left', extension: 0.9, conf: 0.8 };
async function fixture(t, options = {}) {
  const relay = await createRelay({ host: '127.0.0.1', port: 0, ...options });
  t.after(() => relay.close());
  const tv = await socket(relay.url); tv.send({ relay: 1, action: 'create', versions: [1] });
  const session = await tv.next();
  return { relay, tv, session };
}
async function pair(relay, tv, session) {
  const phone = await socket(relay.url); phone.send(hello(session.pairCode));
  const paired = await phone.next();
  if (paired.action === 'paired') { await phone.next(); await tv.next(); }
  return { phone, paired };
}
test('relay pairs two phones, forwards mapped players and routes clock replies', { timeout: 5000 }, async t => {
  const { relay, tv, session } = await fixture(t);
  assert.equal(session.version, 1);
  const a = await pair(relay, tv, session), b = await pair(relay, tv, session);
  b.phone.send(event);
  const forwarded = await tv.next();
  assert.equal(forwarded.message.player, 2); assert.equal(forwarded.peerId, b.paired.peerId);
  const pong = { v: 1, type: 'pong', t0: 1, t1: 2, t2: 3 };
  tv.send({ relay: 1, action: 'route', peerId: b.paired.peerId, message: pong });
  assert.deepEqual(await b.phone.next(), pong);
  const third = await socket(relay.url); third.send(hello(session.pairCode));
  assert.equal((await third.next()).reason, 'player limit');
  a.phone.send({ ...event, transcript: 'private' });
  assert.equal((await a.phone.next()).reason, 'protocol error');
});
test('code expiry, negotiation and five bounded pairing attempts', { timeout: 5000 }, async t => {
  let time = 1000;
  const { relay, session } = await fixture(t, { now: () => time });
  time += 300001;
  for (let i = 0; i < 6; i++) {
    const s = await socket(relay.url); s.send(hello(session.pairCode));
    assert.equal((await s.next()).reason, i === 5 ? 'pair attempt limit' : 'pairing rejected');
  }
  const v = await socket(relay.url); v.send({ relay: 1, action: 'create', versions: [2] });
  assert.equal((await v.next()).reason, 'unsupported version');
});
test('phone resumes with secret within ten seconds; invalid token rejected', { timeout: 5000 }, async t => {
  const { relay, tv, session } = await fixture(t);
  const { phone, paired } = await pair(relay, tv, session);
  phone.ws.close(); await new Promise(r => phone.ws.once('close', r)); await tv.next();
  const bad = await socket(relay.url);
  bad.send({ relay: 1, action: 'resume', sessionId: session.sessionId, peerId: paired.peerId, resumeToken: 'wrong', versions: [1] });
  assert.equal((await bad.next()).reason, 'resume expired');
  const resumed = await socket(relay.url);
  resumed.send({ relay: 1, action: 'resume', sessionId: session.sessionId, peerId: paired.peerId, resumeToken: paired.resumeToken, versions: [1] });
  assert.equal((await resumed.next()).action, 'resumed'); await tv.next();
  resumed.send(event); assert.equal((await tv.next()).message.kind, 'jab');
});
test('resume expires after ten seconds and rate limits unauthenticated messages', { timeout: 5000 }, async t => {
  let time = 100;
  const { relay, tv, session } = await fixture(t, { now: () => time });
  const { phone, paired } = await pair(relay, tv, session);
  phone.ws.close(); await new Promise(r => phone.ws.once('close', r)); await tv.next(); time += 10001;
  const s = await socket(relay.url); s.send({ relay: 1, action: 'resume', sessionId: session.sessionId, peerId: paired.peerId, resumeToken: paired.resumeToken, versions: [1] });
  assert.equal((await s.next()).reason, 'resume expired');
  const active = await socket(relay.url); active.send({ relay: 1, action: 'create', versions: [1] }); await active.next();
  for (let i = 0; i < 81; i++) active.send({ relay: 1, action: 'renew' });
  let last; do { last = await active.next(); } while (last.action !== 'error');
  assert.equal(last.reason, 'rate limit');
});
test('HTTP routing callback shares relay port; no pairing data in health', { timeout: 5000 }, async t => {
  const { relay } = await fixture(t, { httpHandler(req, res) { if (req.url !== '/dev-cam') return false; res.end('camera'); return true; } });
  const base = relay.url.replace('ws:', 'http:').replace('/bridge', '');
  assert.equal(await (await fetch(`${base}/dev-cam`)).text(), 'camera');
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true });
});
test('browser-compatible client connects and receives simulated protocol', { timeout: 5000 }, async t => {
  const relay = await createRelay({ host: '127.0.0.1', port: 0 }); t.after(() => relay.close());
  let tv, phone;
  await new Promise((resolve, reject) => {
    tv = new BridgeClient({ url: relay.url, role: 'tv', WebSocketImpl: WebSocket,
      onControl(m) { if (m.action === 'created') {
        phone = new BridgeClient({ url: relay.url, role: 'phone', hello: hello(m.pairCode), WebSocketImpl: WebSocket,
          onControl(m) { if (m.action === 'paired') phone.send(event); } }).connect();
      } }, onMessage(m) { try { assert.deepEqual(m, event); resolve(); } catch(e) { reject(e); } } }).connect();
  });
  phone.close(); tv.close();
});
test('heartbeat closes unresponsive sockets and unauthenticated handshake times out', { timeout: 5000 }, async t => {
  let time = 1000;
  const relay = await createRelay({ host: '127.0.0.1', port: 0, heartbeatMs: 20, now: () => time });
  t.after(() => relay.close());
  const silent = new WebSocket(relay.url, { autoPong: false });
  await new Promise(r => silent.once('open', r));
  const closed = new Promise(r => silent.once('close', r));
  await closed;
  const unauth = await socket(relay.url);
  const expired = new Promise(r => unauth.ws.once('close', r));
  time += 6001;
  await expired;
});
test('client automatically reconnects and resumes existing TV session', { timeout: 5000 }, async t => {
  const relay = await createRelay({ host: '127.0.0.1', port: 0 }); t.after(() => relay.close());
  let session, tv;
  await new Promise(resolve => {
    tv = new BridgeClient({ url: relay.url, role: 'tv', WebSocketImpl: WebSocket, random: () => 0.5,
      onControl(m) {
        if (m.action === 'created') { session = m.sessionId; tv.ws.terminate(); }
        if (m.action === 'resumed') { assert.equal(m.sessionId, session); resolve(); }
      } }).connect();
  });
  tv.close();
});

test('instrumentation clock uses relay monotonic domain while trace identity comes from pairing', { timeout: 5000 }, async t => {
  // Deliberately incompatible wall time proves relay instrumentation never uses now/Date.now.
  const { relay, tv, session } = await fixture(t, { now: () => 1700000000000 });
  const { phone, paired } = await pair(relay, tv, session);
  const before = performance.now(), tvClock = 700000;
  tv.send({ relay: 1, action: 'clock', t0: tvClock });
  const clock = await tv.next(), after = performance.now();
  assert.deepEqual(Object.keys(clock).sort(), ['relay', 'action', 't0', 't1', 't2'].sort());
  assert.equal(clock.t0, tvClock); assert.ok(clock.t1 >= before && clock.t2 >= clock.t1 && clock.t2 <= after);
  const trace = { relay: 1, action: 'trace', tCapturePhone: 900000, tInferenceEndPhone: 900015, tSendPhone: 900016 };
  const relayBefore = performance.now(); phone.send(trace);
  const forwarded = await tv.next();
  assert.deepEqual(Object.keys(forwarded).sort(), ['relay','action','peerId','tCapturePhone','tInferenceEndPhone','tSendPhone','tRelay'].sort());
  assert.equal(forwarded.peerId, paired.peerId); assert.equal(forwarded.tCapturePhone, trace.tCapturePhone);
  assert.equal(forwarded.tInferenceEndPhone, trace.tInferenceEndPhone); assert.equal(forwarded.tSendPhone, trace.tSendPhone);
  assert.ok(forwarded.tRelay >= relayBefore && forwarded.tRelay <= performance.now());
  assert.ok(forwarded.tRelay < forwarded.tCapturePhone); // Different clock origins; never subtract raw timestamps as latency.
});

test('instrumentation rejects unauthenticated controls, incorrect direction and extra fields', { timeout: 5000 }, async t => {
  const { relay, tv, session } = await fixture(t);
  for (const control of [{relay:1,action:'clock',t0:1},{relay:1,action:'trace',tCapturePhone:1,tInferenceEndPhone:2,tSendPhone:3}]) {
    const unauth = await socket(relay.url); unauth.send(control);
    assert.equal((await unauth.next()).reason, 'authentication required');
  }
  const { phone } = await pair(relay, tv, session);
  phone.send({relay:1,action:'clock',t0:1}); assert.equal((await phone.next()).reason,'invalid control'); await tv.next();
  tv.send({relay:1,action:'trace',tCapturePhone:1,tInferenceEndPhone:2,tSendPhone:3}); assert.equal((await tv.next()).reason,'invalid control');
  const second = await fixture(t);
  second.tv.send({relay:1,action:'clock',t0:1,rawAudio:'private'}); assert.equal((await second.tv.next()).reason,'invalid control');
  const third = await fixture(t);
  const sender = await pair(third.relay, third.tv, third.session);
  sender.phone.send({relay:1,action:'trace',tCapturePhone:1,tInferenceEndPhone:2,tSendPhone:3,peerId:'spoof'});
  assert.equal((await sender.phone.next()).reason,'invalid control');
});

test('trace timestamps reject reversed, negative, null and non-number values', { timeout: 5000 }, async t => {
  const invalid = [
    {tCapturePhone:3,tInferenceEndPhone:2,tSendPhone:4},
    {tCapturePhone:1,tInferenceEndPhone:3,tSendPhone:2},
    {tCapturePhone:-1,tInferenceEndPhone:2,tSendPhone:3},
    {tCapturePhone:1,tInferenceEndPhone:null,tSendPhone:3},
    {tCapturePhone:'1',tInferenceEndPhone:2,tSendPhone:3},
  ];
  for (const times of invalid) {
    const {relay,tv,session}=await fixture(t);
    const {phone}=await pair(relay,tv,session);
    phone.send({relay:1,action:'trace',...times});
    assert.equal((await phone.next()).reason,'invalid control');
  }
});

test('trace controls share normal connection rate limit', { timeout: 5000 }, async t => {
  const {relay,tv,session}=await fixture(t,{now:()=>1000});
  const {phone}=await pair(relay,tv,session);
  for(let i=0;i<81;i++)phone.send({relay:1,action:'trace',tCapturePhone:i,tInferenceEndPhone:i+1,tSendPhone:i+2});
  assert.equal((await phone.next()).reason,'rate limit');
});
