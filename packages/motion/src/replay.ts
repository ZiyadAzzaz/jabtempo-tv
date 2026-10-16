import { MotionDetector, type Landmark, type Hand } from './detector.js';
export interface RecordingPermissions { evaluation: true; commitKeypoints: boolean; localVideo: boolean; appearInDemo: boolean }
export interface ReplayHeader { type: 'session'; v: 1; participant: string; session: string; consent: true; synthetic: boolean; aspectRatio: number; stance: 'orthodox' | 'southpaw'; labelsExpected?: boolean; permissions?: RecordingPermissions; trainingOnly?: boolean }
export interface ReplayFrame { type: 'keypoints'; t: number; landmarks: Landmark[] }
export interface ReplayLabel { type: 'label'; t: number; kind: 'jab' | 'cross'; hand: Hand }
export type ReplayRecord = ReplayHeader | ReplayFrame | ReplayLabel;
const exact = (obj: object, keys: string[]) => Object.keys(obj).length === keys.length && keys.every(k => Object.hasOwn(obj,k));
/** Local recorder. Caller must obtain participant consent; contains keypoints, never video/audio. */
export class KeypointRecorder {
  private records: ReplayRecord[];
  private lastTime = -Infinity;
  constructor(header: ReplayHeader) {
    // Round-trip through parser validates metadata and excludes accidental media fields.
    this.records = parseReplay(JSON.stringify(header));
  }
  frame(t: number, landmarks: Landmark[]) {
    if (t <= this.lastTime) throw new RangeError('Frame timestamps must increase');
    const record: ReplayFrame = { type:'keypoints', t, landmarks: landmarks.map(p => ({x:p.x,y:p.y,...(p.z === undefined ? {} : {z:p.z}),visibility:p.visibility})) };
    parseReplay(`${JSON.stringify(this.records[0])}\n${JSON.stringify(record)}`);
    this.records.push(record); this.lastTime = t;
  }
  label(t: number, kind: 'jab' | 'cross', hand: Hand) {
    const record: ReplayLabel = { type:'label',t,kind,hand };
    parseReplay(`${JSON.stringify(this.records[0])}\n${JSON.stringify(record)}`);
    this.records.push(record);
  }
  toJSONL() { return this.records.map(record => JSON.stringify(record)).join('\n')+'\n'; }
}
export function parseReplay(jsonl: string): ReplayRecord[] {
  const records = jsonl.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  const header = records[0];
  const headerKeys=['type','v','participant','session','consent','synthetic','aspectRatio','stance',...(header?.labelsExpected===undefined?[]:['labelsExpected']),...(header?.permissions===undefined?[]:['permissions']),...(header?.trainingOnly===undefined?[]:['trainingOnly'])];
  if (!header || !exact(header,headerKeys) || header.type !== 'session' || header.v !== 1 || header.consent !== true || typeof header.synthetic !== 'boolean' || (header.labelsExpected !== undefined && typeof header.labelsExpected !== 'boolean') || !['orthodox','southpaw'].includes(header.stance) || !Number.isFinite(header.aspectRatio) || header.aspectRatio <= 0 || ![header.participant,header.session].every(s => typeof s === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(s))) throw new Error('Invalid consented keypoint session header');
  if(header.permissions!==undefined&&(!header.permissions||!exact(header.permissions,['evaluation','commitKeypoints','localVideo','appearInDemo'])||header.permissions.evaluation!==true||![header.permissions.commitKeypoints,header.permissions.localVideo,header.permissions.appearInDemo].every(n=>typeof n==='boolean')||(header.permissions.appearInDemo&&!header.permissions.localVideo)))throw new Error('Invalid recording permissions');
  if(header.trainingOnly!==undefined&&typeof header.trainingOnly!=='boolean')throw new Error('Invalid training-only flag');
  let previous = -Infinity;
  for (const r of records.slice(1)) {
    if (!r || !Number.isFinite(r.t) || r.t < 0) throw new Error('Invalid replay timestamp');
    if (r.type === 'keypoints') {
      if (!exact(r,['type','t','landmarks']) || r.t <= previous || !Array.isArray(r.landmarks) || r.landmarks.length !== 33 || r.landmarks.some((p: Landmark) => !p || !exact(p,p.z === undefined ? ['x','y','visibility'] : ['x','y','z','visibility']) || ![p.x,p.y,p.visibility,...(p.z === undefined ? [] : [p.z])].every(Number.isFinite) || p.visibility < 0 || p.visibility > 1)) throw new Error('Invalid keypoint replay frame');
      previous = r.t;
    } else if (r.type !== 'label' || !exact(r,['type','t','kind','hand']) || !['jab','cross'].includes(r.kind) || !['left','right'].includes(r.hand)) throw new Error('Invalid replay record');
  }
  return records;
}
export function replayMotion(jsonl: string, config?: ConstructorParameters<typeof MotionDetector>[0]) {
  const records = parseReplay(jsonl), header = records[0] as ReplayHeader;
  const detector = new MotionDetector({ aspectRatio:header.aspectRatio,stance:header.stance,...config });
  return records.filter((record): record is ReplayFrame => record.type === 'keypoints').map(frame => ({t:frame.t,...detector.update(frame.landmarks,frame.t)}));
}
