import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { randomInt, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, WebSocket } from 'ws';
import { parseMessage } from './protocol.js';

const token = () => randomBytes(24).toString('hex');
const exact = (m, keys) => Object.keys(m).length === keys.length && keys.every(k => Object.hasOwn(m, k));
const send = (ws, m) => {
  if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 65536) ws.send(JSON.stringify(m));
};
const control = (action, extra = {}) => ({ relay: 1, action, ...extra });
const timestamp = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** In-memory development relay. Logs contain event categories only; never IDs, codes or payloads. */
export async function createRelay({ host = '0.0.0.0', port = 8787, httpHandler,
  log = () => {}, now = Date.now, pairTtlMs = 300000, resumeMs = 10000,
  heartbeatMs = 2000, maxSessions = 32, tls, advertisedUrl } = {}) {
  if (advertisedUrl !== undefined) {
    const parsed = new URL(advertisedUrl);
    if (!['ws:', 'wss:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/bridge') throw new Error('Invalid advertised relay URL');
    advertisedUrl = parsed.href;
  }
  const advertised = advertisedUrl === undefined ? {} : { relayUrl: advertisedUrl };
  const sessions = new Map(), attempts = new Map();
  const handler = (req, res) => {
    if (httpHandler?.(req, res)) return;
    if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); }
    else { res.writeHead(404); res.end('Not found'); }
  };
  const server = tls === undefined ? createServer(handler) : createHttpsServer(tls, handler);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/bridge' || wss.clients.size >= 100) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  const fail = (ws, reason) => { send(ws, control('error', { reason })); ws.close(1008, reason); log('connection rejected'); };
  const newCode = () => {
    for (let n = 0; n < 10000; n++) {
      const code = String(randomInt(10000)).padStart(4, '0');
      if (![...sessions.values()].some(s => s.pairCode === code)) return code;
    }
    throw new Error('Pairing capacity reached');
  };
  const destroy = s => {
    sessions.delete(s.id);
    for (const p of [s.tv, ...s.phones.values()]) p.ws?.close(1000, 'session ended');
  };
  wss.on('connection', (ws, req) => {
    ws.alive = true; ws.started = now(); ws.bucket = { start: now(), count: 0 }; ws.peer = null;
    ws.on('error', () => log('socket error'));
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', (data, binary) => {
      try {
        if (binary) return fail(ws, 'text required');
        if (now() - ws.bucket.start >= 1000) ws.bucket = { start: now(), count: 0 };
        if (++ws.bucket.count > 80) return fail(ws, 'rate limit');
        const m = JSON.parse(data.toString());
        if (m.relay === 1) {
          if (m.action === 'create') {
            if (ws.peer || !exact(m, ['relay', 'action', 'versions']) || !Array.isArray(m.versions) || !m.versions.includes(1)) return fail(ws, 'unsupported version');
            if (sessions.size >= maxSessions) return fail(ws, 'session limit');
            const s = { id: token(), pairCode: newCode(), expiresAt: now() + pairTtlMs, phones: new Map() };
            s.tv = { id: 'tv', role: 'tv', token: token(), ws, session: s };
            ws.peer = s.tv; sessions.set(s.id, s);
            send(ws, control('created', { sessionId: s.id, pairCode: s.pairCode, resumeToken: s.tv.token, expiresAt: s.expiresAt, version: 1, ...advertised }));
            return;
          }
          if (m.action === 'resume') {
            if (ws.peer || !exact(m, ['relay', 'action', 'sessionId', 'peerId', 'resumeToken', 'versions']) || !Array.isArray(m.versions) || !m.versions.includes(1)) return fail(ws, 'invalid resume');
            const s = sessions.get(m.sessionId), p = m.peerId === 'tv' ? s?.tv : s?.phones.get(m.peerId);
            if (!p || p.token !== m.resumeToken || p.ws || now() - p.leftAt > resumeMs) return fail(ws, 'resume expired');
            p.ws = ws; ws.peer = p;
            send(ws, control('resumed', { sessionId: s.id, peerId: p.id, version: 1 }));
            if (p.role === 'tv') for (const ph of s.phones.values()) send(ws, control('peer', { state: ph.ws ? 'joined' : 'left', peerId: ph.id, playerBase: ph.playerBase, deviceId: ph.deviceId }));
            else send(s.tv.ws, control('peer', { state: 'joined', peerId: p.id, playerBase: p.playerBase, deviceId: p.deviceId }));
            return;
          }
          const p = ws.peer;
          if (!p) return fail(ws, 'authentication required');
          // Optional local latency instrumentation, separate from pose protocol v1.
          // TV and relay clocks remain distinct; callers estimate offset via this exchange.
          if (m.action === 'clock' && p.role === 'tv' && exact(m, ['relay', 'action', 't0']) && timestamp(m.t0)) {
            const t1 = performance.now();
            send(ws, control('clock', { t0: m.t0, t1, t2: performance.now() })); return;
          }
          if (m.action === 'trace' && p.role === 'phone' && exact(m, ['relay', 'action', 'tCapturePhone', 'tInferenceEndPhone', 'tSendPhone']) &&
              [m.tCapturePhone, m.tInferenceEndPhone, m.tSendPhone].every(timestamp) &&
              m.tCapturePhone <= m.tInferenceEndPhone && m.tInferenceEndPhone <= m.tSendPhone) {
            // Identity is derived from pairing, never accepted from the sender.
            send(p.session.tv.ws, control('trace', { peerId: p.id, tCapturePhone: m.tCapturePhone,
              tInferenceEndPhone: m.tInferenceEndPhone, tSendPhone: m.tSendPhone, tRelay: performance.now() })); return;
          }
          if (m.action === 'renew' && p.role === 'tv' && exact(m, ['relay', 'action'])) {
            p.session.pairCode = newCode(); p.session.expiresAt = now() + pairTtlMs;
            send(ws, control('pairing', { pairCode: p.session.pairCode, expiresAt: p.session.expiresAt, ...advertised })); return;
          }
          if (m.action === 'route' && p.role === 'tv' && exact(m, ['relay', 'action', 'peerId', 'message'])) {
            const message = parseMessage(m.message);
            if (!['ping', 'pong', 'welcome', 'bye'].includes(message.type)) return fail(ws, 'direction rejected');
            send(p.session.phones.get(m.peerId)?.ws, message); return;
          }
          return fail(ws, 'invalid control');
        }
        const message = parseMessage(m);
        if (!ws.peer) {
          if (message.type !== 'hello') return fail(ws, 'hello required');
          const ip = req.socket.remoteAddress;
          let a = attempts.get(ip);
          if (!a || now() - a.start > 60000) { a = { start: now(), count: 0 }; attempts.set(ip, a); }
          if (++a.count > 5) return fail(ws, 'pair attempt limit');
          const s = [...sessions.values()].find(s => s.pairCode === message.pairCode && now() < s.expiresAt && s.tv.ws);
          if (!s) return fail(ws, 'pairing rejected');
          const used = [...s.phones.values()].reduce((n, ph) => n + ph.players, 0);
          if (s.phones.size >= 2 || used + message.players > 2) return fail(ws, 'player limit');
          const occupied = new Set([...s.phones.values()].flatMap(ph => Array.from({ length: ph.players }, (_, i) => ph.playerBase + i)));
          const playerBase = occupied.has(1) ? 2 : 1;
          const p = { id: token(), role: 'phone', token: token(), ws, session: s, players: message.players, playerBase, deviceId: message.deviceId };
          s.phones.set(p.id, p); ws.peer = p;
          send(ws, control('paired', { sessionId: s.id, peerId: p.id, resumeToken: p.token, playerBase, version: 1 }));
          send(ws, { v: 1, type: 'welcome', sessionId: s.id, bpm: 110, mode: used ? 'versus' : 'solo' });
          send(s.tv.ws, control('peer', { state: 'joined', peerId: p.id, playerBase, deviceId: p.deviceId })); return;
        }
        const p = ws.peer, s = p.session;
        if (p.role === 'tv') {
          if (!['welcome', 'bye'].includes(message.type)) return fail(ws, 'use route for clock messages');
          for (const ph of s.phones.values()) send(ph.ws, message);
        } else {
          if (!['frame', 'event', 'guard', 'voice', 'quality', 'ping', 'pong', 'bye'].includes(message.type)) return fail(ws, 'direction rejected');
          if (message.player && message.player > p.players) return fail(ws, 'player rejected');
          if (message.type === 'frame') {
            if (message.players.some(pl => pl.id > p.players)) return fail(ws, 'player rejected');
            message.players = message.players.map(pl => ({ ...pl, id: pl.id + p.playerBase - 1 }));
          }
          if (message.player) message.player += p.playerBase - 1;
          send(s.tv.ws, control('message', { peerId: p.id, message }));
        }
      } catch { fail(ws, 'protocol error'); }
    });
    ws.on('close', () => {
      const p = ws.peer;
      if (!p || p.ws !== ws) return;
      p.ws = null; p.leftAt = now();
      if (p.role === 'phone') send(p.session.tv.ws, control('peer', { state: 'left', peerId: p.id, playerBase: p.playerBase }));
    });
  });
  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.peer && now() - ws.started > 6000) { ws.terminate(); continue; }
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false; ws.ping();
    }
    for (const s of sessions.values()) {
      if (!s.tv.ws && now() - s.tv.leftAt > resumeMs) { destroy(s); continue; }
      for (const ph of s.phones.values()) if (!ph.ws && now() - ph.leftAt > resumeMs) s.phones.delete(ph.id);
    }
    for (const [ip, a] of attempts) if (now() - a.start > 60000) attempts.delete(ip);
  }, heartbeatMs);
  interval.unref();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const address = server.address();
  return { server, url: `${tls === undefined ? 'ws' : 'wss'}://${host === '0.0.0.0' ? '127.0.0.1' : host}:${address.port}/bridge`,
    async close() { clearInterval(interval); for (const ws of wss.clients) ws.terminate(); await new Promise(r => wss.close(r)); await new Promise(r => server.close(r)); sessions.clear(); attempts.clear(); } };
}
