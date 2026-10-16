/** Original implementation of the published One-Euro equations; timestamps are milliseconds. */
export class OneEuroFilter {
  private time?: number;
  private raw = 0;
  private value = 0;
  private derivative = 0;
  constructor(readonly minCutoff = 1, readonly beta = 0.007, readonly derivativeCutoff = 1) {
    if (![minCutoff, derivativeCutoff].every(n => Number.isFinite(n) && n > 0) || !Number.isFinite(beta) || beta < 0) throw new RangeError('Invalid filter parameters');
  }
  reset() { this.time = undefined; }
  filter(value: number, time: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(time)) throw new RangeError('Invalid filter sample');
    if (this.time === undefined) { this.time = time; this.raw = this.value = value; this.derivative = 0; return value; }
    if (time <= this.time) throw new RangeError('Filter timestamps must increase');
    const dt = (time - this.time) / 1000;
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    this.derivative += alpha(this.derivativeCutoff) * ((value - this.raw) / dt - this.derivative);
    this.value += alpha(this.minCutoff + this.beta * Math.abs(this.derivative)) * (value - this.value);
    this.time = time; this.raw = value;
    return this.value;
  }
}
