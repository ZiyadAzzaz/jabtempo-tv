import test from 'node:test';
import assert from 'node:assert/strict';
import {SelfTestSession} from '../../../apps/dev-web/src/selftest.js';
import {parseReplay,type ReplayHeader} from '../src/replay.js';
test('self-test requires personal consent and camera readiness, captures keypoints only and enforces two minutes',()=>{
  const session=new SelfTestSession();
  assert.throws(()=>session.begin({consent:false,ready:true,stance:'orthodox',aspectRatio:1},0));
  assert.throws(()=>session.begin({consent:true,ready:false,stance:'orthodox',aspectRatio:1},0));
  session.begin({consent:true,ready:true,stance:'orthodox',aspectRatio:1},100);
  const points=Array.from({length:33},()=>({x:.5,y:.5,visibility:1}));
  points[11].x=.4;points[12].x=.6;
  session.onFrame(points,99);assert.equal(session.data().frames.length,0);
  session.onFrame(points,100);session.label('jab',110);session.onFrame(points,150);
  session.onFrame(points,120101);assert.equal(session.active,false);assert.equal(session.data().frames.length,2);
  const records=parseReplay(session.jsonl()),header=records[0] as ReplayHeader;
  assert.equal(header.trainingOnly,true);assert.equal(header.participant,'m1-training-person');
  assert.deepEqual(session.data().punches,[{t:110,kind:'jab',source:'independent-tap'}]);
  assert.ok(records.every(record=>['session','keypoints','label'].includes(record.type)));
});
