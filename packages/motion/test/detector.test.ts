import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionDetector, OneEuroFilter, KeypointRecorder, parseReplay, replayMotion, type Landmark } from '../src/index.js';
const fast = {minCutoff:100000,beta:0}; // Unit fixtures isolate FSM geometry from smoothing lag.
function pose(extension = 0, hand: 'left' | 'right' = 'left'): Landmark[] {
  const p = Array.from({length:33}, () => ({x:0.5,y:0.5,visibility:1}));
  p[0]={x:0.5,y:0.3,visibility:1};
  p[11]={x:0.4,y:0.5,visibility:1}; p[12]={x:0.6,y:0.5,visibility:1};
  p[13]={x:0.3,y:0.55,visibility:1}; p[14]={x:0.7,y:0.55,visibility:1};
  p[15]={x:0.45-extension*0.35,y:0.35+extension*0.15,visibility:1};
  p[16]={x:0.55,y:0.35,visibility:1};
  if (hand==='right') { p[15]={x:0.45,y:0.35,visibility:1}; p[16]={x:0.55+extension*0.35,y:0.35+extension*0.15,visibility:1}; }
  p[23]={x:0.42,y:0.8,visibility:1}; p[24]={x:0.58,y:0.8,visibility:1};
  return p;
}
const sequence = [0,0.3,0.65,1,1,0.8,0.45,0,0,0];
test('One-Euro constant, smoothing, adaptive response and timestamp validation', () => {
  const f=new OneEuroFilter(); assert.equal(f.filter(1,0),1); assert.equal(f.filter(1,20),1);
  const filtered=f.filter(2,40); assert.ok(filtered>1 && filtered<2);
  assert.throws(()=>f.filter(1,40)); assert.throws(()=>f.filter(NaN,50)); assert.throws(()=>new OneEuroFilter(0));
  const slow=new OneEuroFilter(1,0), adaptive=new OneEuroFilter(1,1); slow.filter(0,0); adaptive.filter(0,0);
  assert.ok(adaptive.filter(10,20)>slow.filter(10,20)); f.reset(); assert.equal(f.filter(5,0),5);
});
test('straight punch emits once at stored maximum and recovers guard', () => {
  const detector=new MotionDetector({config:fast});
  const results=sequence.map((extension,i)=>detector.update(pose(extension),i*50));
  const events=results.flatMap(r=>r.events);
  assert.equal(events.length,1); assert.equal(events[0].kind,'jab'); assert.equal(events[0].hand,'left');
  assert.ok(events[0].t_peak<=250); assert.ok(events[0].extension>0.72);
  assert.ok(results.some(r=>r.phases.left==='EXTENDING')); assert.ok(results.some(r=>r.phases.left==='PEAK'));
  assert.ok(results.some(r=>r.phases.left==='RETRACTING'));
  assert.equal(results.at(-1)!.phases.left,'GUARD');
  assert.ok(results.flatMap(r=>r.guardRecoveryMs).every(ms=>ms>=0));
  assert.ok(results.flatMap(r=>r.guardRecoveryMs).length>0);
});
test('stance maps anatomical right hand to cross or jab; mirror preserves anatomy', () => {
  for (const stance of ['orthodox','southpaw'] as const) {
    for (const mirrored of [false,true]) {
      const detector=new MotionDetector({stance,mirrored,config:fast});
      const events=sequence.flatMap((e,i)=>detector.process(pose(e,'right'),i*50).events);
      assert.equal(events.length,1); assert.equal(events[0].kind,stance==='orthodox'?'cross':'jab');
    }
  }
});
test('idle, translation and scale do not produce punches', () => {
  const detector=new MotionDetector();
  for(let i=0;i<60;i++) {
    const p=pose().map(point=>({...point,x:point.x*0.8+0.05+i*0.001,y:point.y*0.8+0.05}));
    const result=detector.update(p,i*30); assert.equal(result.events.length,0); assert.equal(result.valid,true);
  }
});
test('refractory period rejects a rapid second cycle and guard must precede extension', () => {
  const detector=new MotionDetector({config:fast});
  const events=[...sequence,...sequence].flatMap((e,i)=>detector.update(pose(e),i*20).events);
  assert.equal(events.length,1);
  const noGuard=new MotionDetector({config:fast});
  const unarmed=[0.5,0.65,1,0.8,0.5].flatMap((e,i)=>noGuard.update(pose(e),i*50).events);
  assert.equal(unarmed.length,0);
});
test('visibility, degenerate shoulders, gaps and reversed time are safe', () => {
  const detector=new MotionDetector({config:fast}); detector.update(pose(),0); detector.update(pose(0.5),50);
  const hidden=pose(1); hidden[15].visibility=0.49; assert.equal(detector.update(hidden,100).valid,false);
  assert.equal(detector.update(pose(0.8),150).events.length,0);
  assert.equal(detector.update(pose(1),1000).events.length,0);
  assert.throws(()=>detector.update(pose(),999));
  const collapsed=pose(); collapsed[12]={...collapsed[11]}; assert.equal(detector.update(collapsed,1050).valid,false);
  assert.throws(()=>new MotionDetector({aspectRatio:0}));
});
test('aspect correction preserves features across differently shaped images', () => {
  const first=new MotionDetector({aspectRatio:1}), second=new MotionDetector({aspectRatio:2});
  const p=pose(), wide=p.map(point=>({...point,y:point.y*2-0.5}));
  // Use upper body only; hips are optional for seated mode.
  wide[23].visibility=wide[24].visibility=0;
  const a=first.update(p,0),b=second.update(wide,0);
  assert.ok(Math.abs(a.features!.left.extension-b.features!.left.extension)<1e-10);
});
test('record/replay is deterministic, consented, media-free and synthetic-labelled', () => {
  const recorder=new KeypointRecorder({type:'session',v:1,participant:'synthetic-unit',session:'fixture',consent:true,synthetic:true,aspectRatio:1,stance:'orthodox'});
  sequence.forEach((e,i)=>recorder.frame(i*50,pose(e))); recorder.label(150,'jab','left');
  const text=recorder.toJSONL(); assert.deepEqual(replayMotion(text,{config:fast}),replayMotion(text,{config:fast}));
  assert.equal(replayMotion(text,{config:fast}).flatMap(r=>r.events).length,1);
  assert.throws(()=>parseReplay(text.replace('"consent":true','"consent":false')));
  assert.throws(()=>parseReplay(text.replace('"type":"keypoints"','"video":"data:secret","type":"keypoints"')));
  assert.throws(()=>recorder.frame(0,pose()));
});

// Synthetic geometry validates the coordinate contract, not real camera recognition accuracy.
test('front-camera pixel reflection preserves anatomical wrist and peak timing for both hands',()=>{
  for(const hand of ['left','right'] as const) for(const stance of ['orthodox','southpaw'] as const) {
    const plain=new MotionDetector({stance,config:fast});
    const mirrored=new MotionDetector({stance,mirrored:true,config:fast});
    const normal=sequence.flatMap((e,i)=>plain.update(pose(e,hand),i*50).events);
    const reflected=sequence.flatMap((e,i)=>mirrored.update(pose(e,hand).map(p=>({...p,x:1-p.x})),i*50).events);
    assert.equal(normal.length,1); assert.equal(reflected.length,1);
    assert.equal(reflected[0].hand,hand); assert.equal(reflected[0].kind,normal[0].kind);
    assert.equal(reflected[0].t_peak,normal[0].t_peak);
    assert.ok(Math.abs(reflected[0].extension-normal[0].extension)<1e-10);
  }
});
