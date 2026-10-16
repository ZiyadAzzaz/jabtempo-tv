/** Presets are gameplay choices, not estimates of fitness or sensor accuracy. */
export type PresetId = 'kids' | 'beginner' | 'workout' | 'pro';
export type TimingWindows = Readonly<{perfectMs:number;goodMs:number}>;
export const SESSION_MINUTES = [1,3,5] as const;
export type SessionMinutes = typeof SESSION_MINUTES[number];
export const ROUND_PRESETS = Object.freeze({
  kids: {label:'Kids',bpm:90,density:1,noteSpacing:2,perfectMs:130,goodMs:260,approachMs:2400,description:'More space between punches. Extra time to find the beat.'},
  beginner: {label:'Beginner',bpm:110,density:1,noteSpacing:1,perfectMs:80,goodMs:160,approachMs:1800,description:'Short combinations with a beat to recover.'},
  workout: {label:'Workout',bpm:110,density:2,noteSpacing:1,perfectMs:80,goodMs:160,approachMs:1800,description:'More punches and shorter rests.'},
  pro: {label:'Pro',bpm:130,density:3,noteSpacing:1,perfectMs:60,goodMs:120,approachMs:1500,description:'Fast combinations and tighter timing.'},
} as const);
export const PRESET_IDS = Object.keys(ROUND_PRESETS) as PresetId[];
export function isPresetId(value:unknown):value is PresetId {return typeof value==='string'&&Object.hasOwn(ROUND_PRESETS,value);}
export function isSessionMinutes(value:unknown):value is SessionMinutes {return SESSION_MINUTES.some(minutes=>minutes===value);}

/** Count unique detector events and advancing audio time, never time spent paused. */
export class RoundActivity {
  private lastPosition=0;
  private elapsed=0;
  private eventIds=new Set<string>();
  constructor(readonly durationMs:number) {if(!Number.isFinite(durationMs)||durationMs<=0)throw new RangeError('Invalid duration');}
  advance(positionMs:number,rate=1) {
    if(!Number.isFinite(positionMs)||positionMs<0||!Number.isFinite(rate)||rate<.5||rate>2)throw new RangeError('Invalid audio progress');
    const position=Math.min(this.durationMs,Math.max(this.lastPosition,positionMs));
    this.elapsed+=(position-this.lastPosition)/rate;
    this.lastPosition=position;
  }
  recordPunch(id:string,songTimeMs:number) {
    if(!id||!Number.isFinite(songTimeMs)||songTimeMs<0||songTimeMs>=this.durationMs||this.eventIds.has(id))return false;
    this.eventIds.add(id);return true;
  }
  get activeMs(){return this.elapsed;}
  get detectedPunches(){return this.eventIds.size;}
}
