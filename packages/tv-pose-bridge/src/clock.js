/** t0/t3 are local; t1/t2 are remote. All use monotonic milliseconds. */
export function clockSample({ t0, t1, t2, t3 }) {
  if (![t0, t1, t2, t3].every(Number.isFinite) || t3 < t0 || t2 < t1) {
    throw new RangeError('Invalid clock exchange');
  }
  const rttMs = (t3 - t0) - (t2 - t1);
  if (rttMs < 0) throw new RangeError('Negative network RTT');
  return { remoteMinusLocalMs: ((t1 - t0) + (t2 - t3)) / 2, rttMs };
}

/** Keep bounded history and choose the least queued exchange. Not a latency benchmark. */
export class ClockSync {
  #samples = [];
  #lastLocal = -Infinity;
  constructor({ maxSamples = 30, maxRttMs = 1000, maxAgeMs = 10000 } = {}) {
    if (!Number.isInteger(maxSamples) || maxSamples < 1 ||
        !Number.isFinite(maxRttMs) || maxRttMs <= 0 ||
        !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new RangeError('Invalid sync options');
    this.maxSamples = maxSamples;
    this.maxRttMs = maxRttMs;
    this.maxAgeMs = maxAgeMs;
  }
  add(exchange) {
    const sample = clockSample(exchange);
    if (exchange.t3 < this.#lastLocal) throw new RangeError('Local clock moved backwards');
    this.#lastLocal = exchange.t3;
    this.#samples = this.#samples.filter(s => exchange.t3 - s.at <= this.maxAgeMs);
    if (sample.rttMs > this.maxRttMs) return false;
    this.#samples.push({ ...sample, at: exchange.t3 });
    this.#samples = this.#samples.slice(-this.maxSamples);
    return true;
  }
  estimate(now) {
    if (!Number.isFinite(now) || now < this.#lastLocal) throw new RangeError('Invalid local time');
    const valid = this.#samples.filter(s => now - s.at <= this.maxAgeMs);
    if (!valid.length) return null;
    const best = valid.reduce((a, b) => b.rttMs <= a.rttMs ? b : a);
    return { remoteMinusLocalMs: best.remoteMinusLocalMs, rttMs: best.rttMs, samples: valid.length };
  }
  toLocal(remoteTime, now) {
    if (!Number.isFinite(remoteTime)) throw new RangeError('Invalid remote time');
    const estimate = this.estimate(now);
    if (!estimate) throw new Error('Clock not synchronized');
    return remoteTime - estimate.remoteMinusLocalMs;
  }
  reset() { this.#samples = []; this.#lastLocal = -Infinity; }
}
