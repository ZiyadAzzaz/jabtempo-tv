export const commands = Object.freeze([
  'start', 'pause', 'resume', 'harder', 'easier', 'next round', 'two players',
]);

export class ProtocolError extends Error {
  constructor(message) { super(message); this.name = 'ProtocolError'; }
}

const fields = {
  hello: ['deviceId', 'pairCode', 'model', 'players'],
  welcome: ['sessionId', 'bpm', 'mode'],
  ping: ['t0'], pong: ['t0', 't1', 't2'],
  frame: ['t', 'players'],
  event: ['t_peak', 'player', 'kind', 'hand', 'extension', 'conf'],
  guard: ['t', 'player', 'state', 'conf'],
  voice: ['t', 'command', 'conf'],
  quality: ['t', 'framing', 'light', 'issues'],
  bye: ['reason'],
};
const fail = (condition, message) => { if (!condition) throw new ProtocolError(message); };
const number = (n, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const unit = n => number(n, 0, 1);
const player = n => Number.isInteger(n) && n >= 1 && n <= 2;
const word = (s, max = 128) => typeof s === 'string' && s.length > 0 && s.length <= max;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));

/** Strict allowlist: raw media, arbitrary transcripts and extra payload fields are rejected. */
export function parseMessage(input) {
  let m;
  try {
    // Clone object inputs so caller mutations cannot alter a validated message.
    const wire = typeof input === 'string' ? input : JSON.stringify(input);
    fail(typeof wire === 'string' && wire.length <= 16384, 'Message too large or absent');
    m = JSON.parse(wire);
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError('Invalid JSON');
  }
  fail(object(m) && m.v === 1 && typeof m.type === 'string' && Object.hasOwn(fields, m.type), 'Unsupported protocol');
  fail(exact(m, ['v', 'type', ...fields[m.type]]), 'Unexpected or missing fields');
  for (const k of ['t', 't_peak', 't0', 't1', 't2']) {
    if (Object.hasOwn(m, k)) fail(number(m[k]), `Invalid ${k}`);
  }
  if (Object.hasOwn(m, 'conf')) fail(unit(m.conf), 'Invalid confidence');
  if (Object.hasOwn(m, 'player')) fail(player(m.player), 'Invalid player');
  switch (m.type) {
    case 'hello':
      fail(word(m.deviceId, 64) && word(m.model, 64), 'Invalid device');
      fail(typeof m.pairCode === 'string' && /^\d{4}$/.test(m.pairCode), 'Invalid pair code');
      fail(player(m.players), 'Invalid player count');
      break;
    case 'welcome':
      fail(word(m.sessionId, 64) && [90, 110, 130].includes(m.bpm), 'Invalid session');
      fail(['solo', 'versus', 'coop', 'family'].includes(m.mode), 'Invalid mode');
      break;
    case 'pong': fail(m.t2 >= m.t1, 'Remote clock reversed'); break;
    case 'frame': {
      fail(Array.isArray(m.players) && m.players.length >= 1 && m.players.length <= 2, 'Invalid players');
      const ids = new Set();
      for (const p of m.players) {
        fail(object(p) && exact(p, ['id', 'kp']) && player(p.id) && !ids.has(p.id), 'Invalid player identity');
        ids.add(p.id);
        fail(Array.isArray(p.kp) && p.kp.length === 51, 'Expected 17 landmark triples');
        fail(p.kp.every(n => Number.isInteger(n) && n >= 0 && n <= 10000), 'Invalid keypoints');
      }
      break;
    }
    case 'event':
      fail(['jab', 'cross', 'hook'].includes(m.kind), 'Invalid punch');
      fail(['left', 'right'].includes(m.hand) && unit(m.extension), 'Invalid hand or extension');
      break;
    case 'guard': fail(['up', 'down'].includes(m.state), 'Invalid guard'); break;
    case 'voice': fail(commands.includes(m.command), 'Unrecognized command'); break;
    case 'quality':
      fail(unit(m.framing) && unit(m.light), 'Invalid quality');
      fail(Array.isArray(m.issues) && m.issues.length <= 5 &&
        m.issues.every(i => ['step back', 'move closer', 'more light', 'upper body missing', 'tracking lost'].includes(i)),
        'Invalid issues');
      break;
    case 'bye':
      fail(['user exit', 'timeout', 'replaced', 'protocol error', 'pairing rejected'].includes(m.reason), 'Invalid reason');
      break;
  }
  return m;
}
