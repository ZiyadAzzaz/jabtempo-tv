import { OneEuroFilter } from './one-euro.js';

export interface Landmark { x: number; y: number; z?: number; visibility: number }
export type Hand = 'left' | 'right';
export type Phase = 'GUARD' | 'EXTENDING' | 'PEAK' | 'RETRACTING';
export const DEFAULT_CONFIG = Object.freeze({ visibility: 0.5, minCutoff: 1, beta: 0.007, derivativeCutoff: 1, speedOn: 1.5, minExtension: 0.72, extensionRise: 0.08, peakFall: 0.015, guardRadius: 0.85, refractoryMs: 250, maxGapMs: 250, maxPunchMs: 1500 });
export type MotionConfig = { [K in keyof typeof DEFAULT_CONFIG]: number };
interface Point { x: number; y: number; visibility: number }
export interface HandFeatures { speed: number; lateralVelocity: number; elbowAngle: number; extension: number; guardDistance: number; confidence: number; rotation: number }
export interface PunchEvent { v: 1; type: 'event'; t_peak: number; player: number; kind: 'jab' | 'cross'; hand: Hand; extension: number; conf: number }
export interface GuardEvent { v: 1; type: 'guard'; t: number; player: number; state: 'up' | 'down'; conf: number }
export interface MotionResult { valid: boolean; events: PunchEvent[]; guards: GuardEvent[]; guardRecoveryMs: number[]; features?: Record<Hand, HandFeatures>; phases: Record<Hand, Phase> }
interface HandState { phase: Phase; armed: boolean; previous?: Point; extension: number; peak: number; peakTime: number; startTime: number; lastEvent: number }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function angle(a: Point, b: Point, c: Point) {
  const ab = distance(a, b), cb = distance(c, b);
  return ab * cb < 1e-8 ? 0 : Math.acos(Math.max(-1, Math.min(1, ((a.x-b.x)*(c.x-b.x)+(a.y-b.y)*(c.y-b.y))/(ab*cb)))) * 180 / Math.PI;
}
const initial = (): HandState => ({ phase: 'GUARD', armed: false, extension: 0, peak: 0, peakTime: 0, startTime: 0, lastEvent: -Infinity });

/** Landmark indices always identify anatomical hands (15 left, 16 right).
 * mirrored reflects input pixel coordinates only; it must never exchange landmark indices.
 * 2D straight-punch rules baseline. Thresholds are provisional, not fitted or accuracy validated. */
export class MotionDetector {
  readonly config: MotionConfig;
  private filters = new Map<number, [OneEuroFilter, OneEuroFilter]>();
  private hands: Record<Hand, HandState> = { left: initial(), right: initial() };
  private time?: number;
  private guard?: boolean;
  private pendingRecovery: number[] = [];
  constructor(readonly options: { stance?: 'orthodox' | 'southpaw'; mirrored?: boolean; aspectRatio?: number; player?: 1 | 2; config?: Partial<MotionConfig> } = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    if (options.stance !== undefined && !['orthodox','southpaw'].includes(options.stance)) throw new RangeError('Invalid stance');
    if (options.player !== undefined && ![1,2].includes(options.player)) throw new RangeError('Invalid player');
    if (Object.values(this.config).some(n => !Number.isFinite(n) || n < 0) || this.config.minCutoff <= 0 || this.config.derivativeCutoff <= 0 || this.config.maxGapMs <= 0 || this.config.maxPunchMs <= 0 || this.config.visibility > 1 || this.config.minExtension > 1 || (options.aspectRatio !== undefined && (!Number.isFinite(options.aspectRatio) || options.aspectRatio <= 0))) throw new RangeError('Invalid motion configuration');
  }
  reset() { this.filters.clear(); this.hands = { left: initial(), right: initial() }; this.guard = undefined; this.pendingRecovery = []; this.time = undefined; }
  process(landmarks: Landmark[], time: number) { return this.update(landmarks, time); }
  update(landmarks: Landmark[], time: number): MotionResult {
    if (!Number.isFinite(time) || time < 0 || (this.time !== undefined && time <= this.time)) throw new RangeError('Motion timestamps must increase');
    const previousTime = this.time;
    if (previousTime !== undefined && time - previousTime > this.config.maxGapMs) this.reset();
    const indices = [0, 11, 12, 13, 14, 15, 16];
    const result: MotionResult = { valid: false, events: [], guards: [], guardRecoveryMs: [], phases: { left: 'GUARD', right: 'GUARD' } };
    if (landmarks.length !== 33 || indices.some(i => !landmarks[i] || ![landmarks[i].x, landmarks[i].y, landmarks[i].visibility].every(Number.isFinite) || landmarks[i].visibility < this.config.visibility || landmarks[i].visibility > 1 || landmarks[i].x < 0 || landmarks[i].x > 1 || landmarks[i].y < 0 || landmarks[i].y > 1)) {
      this.reset(); this.time = time; return result;
    }
    const aspect = this.options.aspectRatio ?? 1;
    const raw = (i: number): Point => ({ x: this.options.mirrored ? 1-landmarks[i].x : landmarks[i].x, y: landmarks[i].y / aspect, visibility: landmarks[i].visibility });
    const left = raw(11), right = raw(12), width = distance(left, right);
    if (width < 0.02) { this.reset(); this.time = time; return result; }
    const origin = { x: (left.x+right.x)/2, y: (left.y+right.y)/2 };
    const points = new Map<number, Point>();
    for (const i of indices) {
      let filters = this.filters.get(i);
      if (!filters) { filters = [new OneEuroFilter(this.config.minCutoff, this.config.beta, this.config.derivativeCutoff), new OneEuroFilter(this.config.minCutoff, this.config.beta, this.config.derivativeCutoff)]; this.filters.set(i, filters); }
      const p = raw(i);
      points.set(i, { x: filters[0].filter((p.x-origin.x)/width, time), y: filters[1].filter((p.y-origin.y)/width, time), visibility: p.visibility });
    }
    const shoulderRotation = Math.atan2(right.y-left.y, right.x-left.x);
    const hipsValid = [23,24].every(i => landmarks[i] && [landmarks[i].x, landmarks[i].y, landmarks[i].visibility].every(Number.isFinite) && landmarks[i].visibility >= this.config.visibility && landmarks[i].visibility <= 1 && landmarks[i].x >= 0 && landmarks[i].x <= 1 && landmarks[i].y >= 0 && landmarks[i].y <= 1);
    const rotation = hipsValid ? Math.atan2(Math.sin(shoulderRotation-Math.atan2(raw(24).y-raw(23).y, raw(24).x-raw(23).x)), Math.cos(shoulderRotation-Math.atan2(raw(24).y-raw(23).y, raw(24).x-raw(23).x))) : 0;
    const dt = this.time === undefined ? 0 : (time-this.time)/1000;
    const features = {} as Record<Hand, HandFeatures>;
    for (const [hand,s,e,w] of [['left',11,13,15],['right',12,14,16]] as const) {
      const shoulder = points.get(s)!, elbow = points.get(e)!, wrist = points.get(w)!, state = this.hands[hand];
      const length = distance(shoulder,elbow)+distance(elbow,wrist);
      const extension = length < 1e-8 ? 0 : Math.min(1,distance(shoulder,wrist)/length);
      const f: HandFeatures = { speed: state.previous && dt ? distance(state.previous,wrist)/dt : 0, lateralVelocity: state.previous && dt ? (wrist.x-state.previous.x)/dt : 0, elbowAngle: angle(shoulder,elbow,wrist), extension, guardDistance: distance(wrist,points.get(0)!), confidence: Math.min(shoulder.visibility,elbow.visibility,wrist.visibility,points.get(0)!.visibility), rotation };
      features[hand] = f;
      const inGuard = f.guardDistance <= this.config.guardRadius;
      if (state.phase === 'GUARD' && state.armed && state.previous && f.speed > this.config.speedOn && extension-state.extension >= this.config.extensionRise && time-state.lastEvent >= this.config.refractoryMs) {
        state.phase = 'EXTENDING'; state.peak = extension; state.peakTime = time; state.startTime = time;
      } else if (state.phase === 'EXTENDING') {
        if (extension > state.peak) { state.peak = extension; state.peakTime = time; }
        if (time-state.startTime > this.config.maxPunchMs) { state.phase = 'RETRACTING'; }
        else if (state.peak-extension >= this.config.peakFall && state.peak >= this.config.minExtension) {
          state.phase = 'PEAK'; state.lastEvent = time;
          const lead: Hand = (this.options.stance ?? 'orthodox') === 'orthodox' ? 'left' : 'right';
          result.events.push({ v: 1, type: 'event', t_peak: state.peakTime, player: this.options.player ?? 1, kind: hand === lead ? 'jab' : 'cross', hand, extension: state.peak, conf: f.confidence });
          this.pendingRecovery.push(state.peakTime);
        } else if (state.peak-extension >= this.config.peakFall) state.phase = 'RETRACTING';
      } else if (state.phase === 'PEAK') state.phase = 'RETRACTING';
      else if (state.phase === 'RETRACTING' && inGuard) state.phase = 'GUARD';
      if (state.phase === 'GUARD' && inGuard) state.armed = true;
      if (state.phase !== 'GUARD') state.armed = false;
      state.previous = wrist; state.extension = extension; result.phases[hand] = state.phase;
    }
    const guard = features.left.guardDistance <= this.config.guardRadius && features.right.guardDistance <= this.config.guardRadius;
    if (guard !== this.guard) result.guards.push({ v: 1, type: 'guard', t: time, player: this.options.player ?? 1, state: guard ? 'up' : 'down', conf: Math.min(features.left.confidence,features.right.confidence) });
    if (guard && this.pendingRecovery.length) { result.guardRecoveryMs = this.pendingRecovery.map(t => time-t); this.pendingRecovery = []; }
    this.guard = guard; this.time = time; result.valid = true; result.features = features;
    return result;
  }
}
