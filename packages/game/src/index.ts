/** All times are milliseconds. Audio position, not a wall-clock timer, owns song time. */
import type {TimingWindows} from './session.js';
export * from './session.js';
export type PunchType = 'jab' | 'cross' | 'hook';
/** Physical anatomy is independent of camera preview mirroring and boxing stance. */
export type Hand = 'left' | 'right';
export type Stance = 'orthodox' | 'southpaw';
export type LabelMode = 'left-right' | 'boxing' | 'icons';
export function handForPunch(type: PunchType, stance: Stance = 'orthodox'): Hand | undefined {
  if(type==='hook') return undefined; // Hook is not a supported hand-specific chart action yet.
  return (type==='jab') === (stance==='orthodox') ? 'left' : 'right';
}
export function punchForHand(hand: Hand, stance: Stance = 'orthodox'): 'jab' | 'cross' {
  return (hand==='left') === (stance==='orthodox') ? 'jab' : 'cross';
}
export function handLabel(hand: Hand, mode: LabelMode = 'left-right', stance: Stance = 'orthodox') {
  return mode==='icons' ? '' : mode==='boxing' ? punchForHand(hand,stance).toUpperCase() : hand.toUpperCase();
}
export type HandStats = { attempted: number; hits: number; accuracy?: number; meanAbsTimingMs?: number; guardRecoveryPercent?: number; meanGuardRecoveryMs?: number };

export type Note = Readonly<{ id: string; timeMs: number; type: PunchType; hand?: Hand; comboId?: number; playerId?: number }>;
export type Punch = { id: string; timeMs: number; type: PunchType; hand?: Hand; timeScale?: number; playerId?: number; extension?: number };
export type Judgment = { noteId: string; eventId?: string; playerId: number; result: 'Perfect' | 'Good' | 'Miss' | 'Wrong hand'; deltaMs?: number; expectedHand?: Hand; actualHand?: Hand; points: number };
function validateTimeScale(timeScale: number) { finite(timeScale); if(timeScale<0.5||timeScale>2) throw new RangeError('Time scale must be 0.5..2'); }
function finite(...values: number[]) { if (values.some(v => !Number.isFinite(v))) throw new RangeError('Expected finite numbers'); }
export class BeatClock {
  private time = 0;
  private paused = false;
  constructor(readonly bpm: 90 | 110 | 130, public outputLatencyMs = 0) { if (![90,110,130].includes(bpm)) throw new RangeError('Unsupported BPM'); finite(outputLatencyMs); if(outputLatencyMs<0) throw new RangeError('Negative latency'); }
  update(audioPositionMs: number) { finite(audioPositionMs, this.outputLatencyMs); if(audioPositionMs<0 || this.outputLatencyMs<0) throw new RangeError('Negative audio position/latency'); if (!this.paused) this.time = Math.max(this.time, audioPositionMs - this.outputLatencyMs, 0); return this.time; }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  reset() { this.time = 0; this.paused = false; }
  get songTimeMs() { return this.time; }
  get beat() { return this.time / (60000 / this.bpm); }
}
/** clockOffsetMs is TV-minus-phone. Negate the bridge remoteMinusLocal offset. */
export function phonePeakToSongTime(peakMs: number, clockOffsetMs: number, inputLatencyMs: number, songEpochTvMs: number, pausedDurationMs = 0) {
  finite(peakMs,clockOffsetMs,inputLatencyMs,songEpochTvMs,pausedDurationMs);
  if(pausedDurationMs<0) throw new RangeError('Negative pause duration');
  return peakMs + clockOffsetMs - inputLatencyMs - songEpochTvMs - pausedDurationMs;
}
export function generateChart(options: { seed: number; bpm: 90 | 110 | 130; durationMs: number; density?: number; noteSpacing?:1|2; hooks?: boolean; progressive?: boolean; playerId?: number; stance?: Stance }): Note[] {
  const {bpm, durationMs, playerId = 0} = options;
  finite(options.seed,durationMs,playerId); if(![90,110,130].includes(bpm) || durationMs<=0 || !Number.isInteger(playerId) || playerId<0) throw new RangeError('Invalid chart options');
  const density = options.density ?? 1; if(!Number.isInteger(density) || density<1 || density>4) throw new RangeError('Density must be 1..4');
  const noteSpacing=options.noteSpacing??1;if(![1,2].includes(noteSpacing))throw new RangeError('Invalid note spacing');
  let state = options.seed >>> 0; const random = () => {state = (Math.imul(state,1664525)+1013904223)>>>0; return state / 4294967296;};
  const patterns: PunchType[][] = [['jab'],['cross'],['jab','cross'],['jab','jab','cross'],['cross','jab','cross']];
  if(options.hooks) patterns.push(['jab','hook','cross']);
  const notes: Note[] = []; const beatMs = 60000/bpm; const spacing = (density<=2 ? 1 : 0.5)*noteSpacing;
  let beat = 4, comboId = 0;
  while(beat*beatMs < durationMs) {
    // The first 14 seconds leave each glove alone on screen. The next 14
    // establish a steady rhythm before the selected preset's full patterns.
    if(options.progressive&&beat*beatMs<28000){
      const type:PunchType=comboId%2===0?'jab':'cross';
      notes.push({id:`${playerId}:${notes.length}`,timeMs:beat*beatMs,type,hand:handForPunch(type,options.stance),comboId,playerId});
      beat+=beat*beatMs<14000?(noteSpacing===2?5:4):(noteSpacing===2?3:2);
      comboId++;
      continue;
    }
    const pattern = patterns[Math.floor(random()*patterns.length)];
    for(const type of pattern) { if(beat*beatMs>=durationMs) break; notes.push({id:`${playerId}:${notes.length}`,timeMs:beat*beatMs,type,...(type==='hook'?{}:{hand:handForPunch(type,options.stance)}),comboId,playerId}); beat+=spacing; }
    // One full empty beat at level 1; increasing density shortens rest later.
    beat += density===1 ? 1 : density===2 ? 0.5 : 0.25; comboId++;
  }
  return notes;
}
export class RoundJudge {
  private judged = new Map<string, Judgment>();
  private seen = new Set<string>();
  private bonuses = new Set<string>();
  private recoveries = new Map<string,number>();
  private combos = new Map<number,number>();
  private scores = new Map<number,number>();
  private paused = false;
  readonly notes: readonly Note[];
  readonly timing: TimingWindows;
  constructor(notes: readonly Note[], readonly options: { stance?: Stance;timing?:TimingWindows } = {}) {
    const {perfectMs=80,goodMs=160}=options.timing??{};
    finite(perfectMs,goodMs);if(perfectMs<=0||goodMs<perfectMs||goodMs>1000)throw new RangeError('Invalid timing windows');
    this.timing=Object.freeze({perfectMs,goodMs});
    if(options.stance!==undefined&&!['orthodox','southpaw'].includes(options.stance)) throw new RangeError('Invalid stance');
    if(new Set(notes.map(n=>n.id)).size!==notes.length) throw new Error('Duplicate note IDs');
    for(const n of notes) {finite(n.timeMs,n.playerId??0); if(n.timeMs<0 || !Number.isInteger(n.playerId??0) || (n.playerId??0)<0 || !['jab','cross','hook'].includes(n.type) || (n.hand!==undefined&&!['left','right'].includes(n.hand))) throw new RangeError('Invalid note');}
    this.notes = notes.map(n=>Object.freeze({...n})).sort((a,b)=>a.timeMs-b.timeMs);
  }
  pause() {this.paused=true;}
  resume() {this.paused=false;}
  reset() {this.judged.clear();this.seen.clear();this.bonuses.clear();this.recoveries.clear();this.combos.clear();this.scores.clear();this.paused=false;}
  private apply(note: Note, result: Judgment['result'], event?: Punch): Judgment {
    const playerId=note.playerId??0; const hit=result==='Perfect'||result==='Good';
    const streak=hit ? (this.combos.get(playerId)??0)+1 : 0; this.combos.set(playerId,streak);
    const multiplier=Math.min(4,1+Math.floor(Math.max(0,streak-1)/10));
    const points=(result==='Perfect'?100:result==='Good'?50:0)*multiplier;
    const judgment: Judgment={noteId:note.id,playerId,result,points,expectedHand:note.hand??handForPunch(note.type,this.options.stance),...(event?{eventId:event.id,deltaMs:(event.timeMs-note.timeMs)/(event.timeScale??1),actualHand:event.hand??handForPunch(event.type,this.options.stance)}:{})};
    this.judged.set(note.id,judgment);this.scores.set(playerId,this.score(playerId)+points); return {...judgment};
  }
  punch(event: Punch): Judgment | undefined {
    const timeScale=event.timeScale??1; validateTimeScale(timeScale);
    finite(event.timeMs,event.playerId??0); if(!event.id || !['jab','cross','hook'].includes(event.type) || (event.hand!==undefined&&!['left','right'].includes(event.hand))) throw new RangeError('Invalid punch');
    const key=`${event.playerId??0}:${event.id}`; if(this.paused || this.seen.has(key)) return;
    this.seen.add(key);
    const candidates=this.notes.filter(n=>!this.judged.has(n.id) && (n.playerId??0)===(event.playerId??0) && Math.abs(n.timeMs-event.timeMs)<=this.timing.goodMs*timeScale).sort((a,b)=>Math.abs(a.timeMs-event.timeMs)-Math.abs(b.timeMs-event.timeMs)||a.timeMs-b.timeMs);
    const actualHand=event.hand??handForPunch(event.type,this.options.stance);
    // Physical wrist identity owns straight-punch scoring; boxing words are presentation only.
    const correct=candidates.find(n=> {
      const expectedHand=n.hand??handForPunch(n.type,this.options.stance);
      return n.type==='hook'||event.type==='hook' ? n.type===event.type : expectedHand===actualHand;
    });
    if(correct) return this.apply(correct,Math.abs(correct.timeMs-event.timeMs)<=this.timing.perfectMs*timeScale?'Perfect':'Good',event);
    if(candidates[0]) return this.apply(candidates[0],'Wrong hand',event);
  }
  /** Call with a watermark known to include all delivered event timestamps (not receipt time). */
  advance(songWatermarkMs: number, timeScale=1): Judgment[] {finite(songWatermarkMs);validateTimeScale(timeScale);if(this.paused)return [];return this.notes.filter(n=>!this.judged.has(n.id)&&songWatermarkMs>n.timeMs+this.timing.goodMs*timeScale).map(n=>this.apply(n,'Miss'));}
  guardRecovered(noteId: string, recoveryMs: number) {finite(recoveryMs); const j=this.judged.get(noteId);if(this.paused||!j||!['Perfect','Good'].includes(j.result)||recoveryMs<0||recoveryMs>600||this.bonuses.has(noteId))return false;this.bonuses.add(noteId);this.recoveries.set(noteId,recoveryMs);this.scores.set(j.playerId,this.score(j.playerId)+20);return true;}
  handStats(hand: Hand, playerId=0): HandStats {
    const js=this.judgments.filter(j=>j.playerId===playerId&&j.expectedHand===hand);
    const hits=js.filter(j=>j.result==='Perfect'||j.result==='Good');
    const times=hits.map(j=>Math.abs(j.deltaMs!));
    const recovery=hits.flatMap(j=>this.recoveries.has(j.noteId)?[this.recoveries.get(j.noteId)!]:[]);
    const mean=(values:number[])=>values.length?values.reduce((sum,n)=>sum+n,0)/values.length:undefined;
    return {attempted:js.length,hits:hits.length,accuracy:js.length?hits.length/js.length:undefined,meanAbsTimingMs:mean(times),guardRecoveryPercent:hits.length?recovery.length/hits.length*100:undefined,meanGuardRecoveryMs:mean(recovery)};
  }
  weakerHand(playerId=0): Hand | undefined {
    const left=this.handStats('left',playerId),right=this.handStats('right',playerId);
    if(left.accuracy===undefined||right.accuracy===undefined) return undefined;
    if(left.accuracy!==right.accuracy) return left.accuracy<right.accuracy?'left':'right';
    if(left.meanAbsTimingMs!==undefined&&right.meanAbsTimingMs!==undefined&&left.meanAbsTimingMs!==right.meanAbsTimingMs) return left.meanAbsTimingMs>right.meanAbsTimingMs?'left':'right';
    return undefined;
  }
  score(playerId=0) {return this.scores.get(playerId)??0;}
  combo(playerId=0) {return this.combos.get(playerId)??0;}
  get judgments(): Judgment[] {return [...this.judged.values()].map(j=>({...j}));}
  accuracy(playerId=0) {const js=this.judgments.filter(j=>j.playerId===playerId);return js.length?js.filter(j=>j.result==='Perfect'||j.result==='Good').length/js.length:undefined;}
}
export function calibrateInputLatency(samples: readonly {beatTvMs:number;peakPhoneMs:number}[],clockOffsetMs:number) {
  if(samples.length!==8)throw new RangeError('Calibration requires exactly 8 beats');finite(clockOffsetMs);
  const values=samples.map(s=>{finite(s.beatTvMs,s.peakPhoneMs);return s.peakPhoneMs+clockOffsetMs-s.beatTvMs;}).sort((a,b)=>a-b);
  return (values[3]+values[4])/2;
}
export class AdaptiveDensity {
  private history:boolean[]=[];
  constructor(public density=1){if(!Number.isInteger(density)||density<1||density>4)throw new RangeError('Invalid density');}
  record(hit:boolean) {this.history.push(hit);if(this.history.length<16)return undefined;const accuracy=this.history.filter(Boolean).length/16;this.history=[];const next=Math.max(1,Math.min(4,this.density+(accuracy>0.85?1:accuracy<0.5?-1:0)));if(next===this.density)return undefined;this.density=next;return {density:next,accuracy,announcement:`Density ${next}`};}
  reset(){this.history=[];}
}
export type MeasuredMetrics={meanAbsTimingMs?:number;guardRecoveryPercent?:number;meanExtension?:number;jabs?:number;crosses?:number};
export function planCoaching(metrics:MeasuredMetrics) {
  const candidates:{focus:string;measured:number;target:number;unit:string;drill:string;weakness:number}[]=[];
  for(const value of Object.values(metrics))if(value!==undefined)finite(value);
  if(metrics.meanAbsTimingMs!==undefined && metrics.meanAbsTimingMs>=0)candidates.push({focus:'Timing',measured:metrics.meanAbsTimingMs,target:80,unit:'ms',drill:'Single jabs on the beat, 90 BPM',weakness:metrics.meanAbsTimingMs/160});
  if(metrics.guardRecoveryPercent!==undefined && metrics.guardRecoveryPercent>=0&&metrics.guardRecoveryPercent<=100)candidates.push({focus:'Guard',measured:metrics.guardRecoveryPercent,target:Math.min(100,Math.max(75,metrics.guardRecoveryPercent+10)),unit:'%',drill:'Jab-Cross with guard check, 110 BPM',weakness:1-metrics.guardRecoveryPercent/100});
  if(metrics.meanExtension!==undefined && metrics.meanExtension>=0&&metrics.meanExtension<=1)candidates.push({focus:'Extension',measured:metrics.meanExtension,target:Math.min(1,Math.max(0.8,metrics.meanExtension+0.1)),unit:'ratio',drill:'Slow single punches, 90 BPM',weakness:1-metrics.meanExtension});
  if(metrics.jabs!==undefined&&metrics.crosses!==undefined&&metrics.jabs>=0&&metrics.crosses>=0&&metrics.jabs+metrics.crosses>0){const share=metrics.jabs/(metrics.jabs+metrics.crosses)*100;candidates.push({focus:'Jab/Cross balance',measured:share,target:50,unit:'% jabs',drill:'Alternating Jab-Cross, 90 BPM',weakness:Math.abs(share-50)/50});}
  const weakest=candidates.sort((a,b)=>b.weakness-a.weakness)[0];if(!weakest)return undefined;const {weakness,...plan}=weakest;return plan;
}
export const ACTION_REGISTRY = Object.freeze({start:'Start',pause:'Pause',resume:'Resume',harder:'Harder',easier:'Easier','next round':'Next round','two players':'Two players'});
export type Action=keyof typeof ACTION_REGISTRY;
export class CommandBus {
  private lastVoice=-Infinity;
  constructor(private readonly execute:(action:Action)=>void,readonly confidenceThreshold=0.75){finite(confidenceThreshold);if(confidenceThreshold<0||confidenceThreshold>1)throw new RangeError('Invalid voice confidence threshold');}
  dispatch(command:string,source:'voice'|'dpad'|'button',nowMs:number,confidence=1){finite(nowMs,confidence);const action=command.trim().toLowerCase();if(!Object.hasOwn(ACTION_REGISTRY,action)||confidence<0||confidence>1||source==='voice'&&confidence<this.confidenceThreshold)return {executed:false,confirmation:"Didn't catch that"};if(source==='voice'&&nowMs-this.lastVoice<1500)return {executed:false,confirmation:'Please wait'};this.execute(action as Action);if(source==='voice')this.lastVoice=nowMs;return {executed:true,confirmation:`${source==='voice'?'Voice: ':''}${ACTION_REGISTRY[action as Action]} ✓`};}
  reset(){this.lastVoice=-Infinity;}
}
