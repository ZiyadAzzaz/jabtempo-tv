import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeMediaPipe } from '../src/landmarks.js';
import { parseMessage } from '../../tv-pose-bridge/src/index.js';

test('phone pose mapping preserves anatomical wrists and interoperates with the bridge', () => {
  const points = Array.from({ length: 33 }, () => ({ x: .5, y: .4, visibility: .9 }));
  points[15] = { x: .1, y: .2, visibility: .8 };
  points[16] = { x: .9, y: .2, visibility: .7 };
  const kp = encodeMediaPipe(points);
  assert.deepEqual(kp.slice(9 * 3, 11 * 3), [1000, 2000, 8000, 9000, 2000, 7000]);
  assert.equal(parseMessage({ v: 1, type: 'frame', t: 1, players: [{ id: 1, kp }] }).players[0].kp.length, 51);
});
test('out-of-frame and missing points cannot masquerade as confident pose data', () => {
  const points = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 1 }));
  points[0].x = -1;
  points[2].y = NaN;
  assert.deepEqual(encodeMediaPipe(points).slice(0, 6), [0, 5000, 0, 0, 0, 0]);
  assert.throws(() => encodeMediaPipe([]), RangeError);
});
