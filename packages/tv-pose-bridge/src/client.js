import { parseMessage } from './protocol.js';

/** Browser/RN compatible; inject Node ws only in Node. Credentials stay in memory. */
export class BridgeClient {
  /** @param {{url:string, role:'phone'|'tv', hello?:object, WebSocketImpl?:any, onMessage?:(message:any,peerId?:string)=>void, onControl?:(control:any)=>void, onState?:(state:string)=>void, now?:()=>number, random?:()=>number}} options */
  constructor({ url, role, hello, WebSocketImpl = globalThis.WebSocket, onMessage = () => {},
    onControl = () => {}, onState = () => {}, now = Date.now, random = Math.random }) {
    Object.assign(this, { url, role, hello, WebSocketImpl, onMessage, onControl, onState, now, random });
    if (!['phone', 'tv'].includes(role)) throw new Error('Invalid role');
    this.stopped = true; this.attempt = 0; this.credentials = null;
  }
  connect() { this.stopped = false; this.open(); return this; }
  open() {
    if (this.stopped) return;
    const ws = new this.WebSocketImpl(this.url); this.ws = ws; this.onState('connecting');
    ws.onopen = () => {
      if (this.credentials && this.now() - this.disconnectedAt <= 10000) {
        this.write({ relay: 1, action: 'resume', ...this.credentials, versions: [1] });
      } else {
        this.credentials = null;
        this.write(this.role === 'tv' ? { relay: 1, action: 'create', versions: [1] } : parseMessage(this.hello));
      }
    };
    ws.onmessage = event => {
      try {
        const m = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
        if (m.relay === 1) {
          if (['created', 'paired'].includes(m.action)) {
            this.credentials = { sessionId: m.sessionId, peerId: this.role === 'tv' ? 'tv' : m.peerId, resumeToken: m.resumeToken };
          }
          if (['created', 'paired', 'resumed'].includes(m.action)) { this.attempt = 0; this.disconnectedAt = undefined; this.onState('connected'); }
          if (m.action === 'error') { this.credentials = null; this.onState('rejected'); this.stopped = true; }
          if (m.action === 'message') this.onMessage(parseMessage(m.message), m.peerId);
          this.onControl(m);
        } else this.onMessage(parseMessage(m));
      } catch { this.onState('protocol error'); this.close(); }
    };
    ws.onerror = () => this.onState('network error');
    ws.onclose = () => {
      this.onState('disconnected');
      if (this.stopped) return;
      this.disconnectedAt ??= this.now();
      const delay = Math.min(5000, 250 * 2 ** Math.min(this.attempt++, 5)) * (0.8 + this.random() * 0.4);
      this.retry = setTimeout(() => this.open(), delay);
    };
  }
  write(m) {
    if (this.ws?.readyState !== 1 || this.ws.bufferedAmount > 65536) return false;
    this.ws.send(JSON.stringify(m)); return true;
  }
  send(message, peerId) {
    const parsed = parseMessage(message);
    return this.write(peerId ? { relay: 1, action: 'route', peerId, message: parsed } : parsed);
  }
  renewPairing() { return this.write({ relay: 1, action: 'renew' }); }
  close() { this.stopped = true; clearTimeout(this.retry); this.ws?.close(); this.credentials = null; }
}
