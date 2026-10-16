import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage, ProtocolError, clockSample, ClockSync } from '../src/index.js';

const punch = { v: 1, type: 'event', t_peak: 400, player: 1, kind: 'jab', hand: 'left', extension: .9, conf: .95 };
test('valid punch survives wire round trip without caller aliases', () => {
  const m = parseMessage(punch);
  punch.conf = .9;
  assert.equal(m.conf, .95);
  assert.deepEqual(parseMessage(JSON.stringify(m)), m);
});
test('protocol rejects raw media, unsupported versions and non-finite values', () => {
  for (const payload of [{ ...punch, audio: 'base64' }, { ...punch, v: 2 },
    { ...punch, conf: NaN }, { ...punch, t_peak: Infinity }, { ...punch, player: 3 },
    { ...punch, hand: 'foot' }, { ...punch, extension: 1.1 }, { ...punch, type: ['event'] }]) {
    assert.throws(() => parseMessage(payload), ProtocolError);
  }
  assert.throws(() => parseMessage('x'.repeat(16385)), ProtocolError);
  assert.throws(() => parseMessage('{'), ProtocolError);
});
test('unknown speech cannot become an actionable command', () => {
  assert.throws(() => parseMessage({ v: 1, type: 'voice', t: 0, command: 'restart everything', conf: 1 }), ProtocolError);
  assert.equal(parseMessage({ v: 1, type: 'voice', t: 0, command: 'pause', conf: .9 }).command, 'pause');
});
test('frame validates landmark shape, confidence scale and unique IDs', () => {
  const frame = { v: 1, type: 'frame', t: 0, players: [{ id: 1, kp: Array(51).fill(5000) }] };
  assert.deepEqual(parseMessage(frame), frame);
  assert.throws(() => parseMessage({ ...frame, players: [frame.players[0], frame.players[0]] }), ProtocolError);
  frame.players[0].kp[2] = -1;
  assert.throws(() => parseMessage(frame), ProtocolError);
  frame.players[0].kp = Array(50).fill(0);
  assert.throws(() => parseMessage(frame), ProtocolError);
});
test('pair codes preserve leading zeroes; extra nested fields are rejected', () => {
  const hello = { v: 1, type: 'hello', deviceId: 'phone', pairCode: '0017', model: 'pose-lite', players: 1 };
  assert.equal(parseMessage(hello).pairCode, '0017');
  assert.throws(() => parseMessage({ ...hello, pairCode: 17 }), ProtocolError);
  assert.throws(() => parseMessage({ v: 1, type: 'frame', t: 1,
    players: [{ id: 1, kp: Array(51).fill(0), video: 'bytes' }] }), ProtocolError);
});
test('NTP-style estimate handles positive and negative clock offsets and processing time', () => {
  assert.deepEqual(clockSample({ t0: 1000, t1: 1120, t2: 1125, t3: 1045 }),
    { remoteMinusLocalMs: 100, rttMs: 40 });
  assert.deepEqual(clockSample({ t0: 1000, t1: 820, t2: 825, t3: 1045 }),
    { remoteMinusLocalMs: -200, rttMs: 40 });
  assert.throws(() => clockSample({ t0: 10, t1: 10, t2: 100, t3: 20 }), RangeError);
});
test('sync rejects queued samples, ages out stale offsets and uses correct conversion sign', () => {
  const sync = new ClockSync({ maxAgeMs: 100, maxRttMs: 50 });
  assert.throws(() => sync.toLocal(10, 0), /not synchronized/);
  assert.equal(sync.add({ t0: 0, t1: 110, t2: 110, t3: 20 }), true);
  assert.equal(sync.add({ t0: 20, t1: 160, t2: 160, t3: 100 }), false);
  assert.equal(sync.toLocal(150, 100), 50);
  assert.equal(sync.estimate(121), null);
  sync.reset();
  assert.equal(sync.estimate(0), null);
});
test('lowest RTT sample avoids asymmetric queue contamination and rejects clock reversal', () => {
  const sync = new ClockSync();
  sync.add({ t0: 0, t1: 110, t2: 110, t3: 20 });
  sync.add({ t0: 20, t1: 130, t2: 130, t3: 80 });
  assert.equal(sync.estimate(80).remoteMinusLocalMs, 100);
  assert.throws(() => sync.add({ t0: 0, t1: 100, t2: 100, t3: 1 }), /backwards/);
});
