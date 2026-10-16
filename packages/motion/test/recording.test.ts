import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionScript,validatePermissions,GuidedRecordingLab} from '../../../apps/dev-web/src/recording.js';
import {parseReplay} from '../src/replay.js';
test('guided synthetic unit script is seeded, bounded and covers session stages plus all commands',()=>{
  const script=createSessionScript(123,1);assert.deepEqual(script,createSessionScript(123,1));assert.notDeepEqual(script,createSessionScript(123,2));
  assert.equal(script.durationMs,600000);assert.equal(script.labelsAreExpectedOnly,true);
  assert.equal(script.instructions.filter(cue=>cue.category==='negative').length,3);
  assert.equal(script.instructions.filter(cue=>cue.category==='voice').length,14);
  assert.deepEqual([...new Set(script.instructions.filter(cue=>cue.category==='punch').map(cue=>cue.bpm))],[90,110]);
  assert.ok(script.instructions.every(cue=>cue.startMs>=0&&cue.endMs<=600000&&cue.endMs>cue.startMs));
  assert.equal(script.instructions.filter(cue=>cue.category==='free')[0].startMs,540000);
  assert.throws(()=>createSessionScript(-1,1));
});
test('independent consent choices guard evaluation, raw video and demo use',()=>{
  const base={evaluation:true as const,commitKeypoints:false,localVideo:false,appearInDemo:false};
  assert.doesNotThrow(()=>validatePermissions(base,false));assert.throws(()=>validatePermissions(base,true));
  assert.throws(()=>validatePermissions({...base,evaluation:false} as any,false));assert.throws(()=>validatePermissions({...base,appearInDemo:true},false));
  const lab=new GuidedRecordingLab();assert.throws(()=>lab.begin({participant:'unit',sessionIndex:1,seed:1,stance:'orthodox',aspectRatio:1,permissions:base,recordVideo:false},{getVideoTracks:()=>[]} as any,0));
  assert.throws(()=>lab.begin({participant:'unit',sessionIndex:1,seed:1,stance:'orthodox',aspectRatio:1,permissions:base,recordVideo:false},{getVideoTracks:()=>[{readyState:'live',label:'fixture.y4m'}]} as any,0),/fake capture/);
});
test('extended replay permits explicit expected-label metadata without calling it truth',()=>{
  const header={type:'session',v:1,participant:'unit',session:'fixture',consent:true,synthetic:true,aspectRatio:1,stance:'orthodox',labelsExpected:true,permissions:{evaluation:true,commitKeypoints:false,localVideo:false,appearInDemo:false}};
  assert.equal((parseReplay(JSON.stringify(header))[0] as any).labelsExpected,true);
  assert.throws(()=>parseReplay(JSON.stringify({...header,permissions:{...header.permissions,appearInDemo:true}})));
  assert.throws(()=>parseReplay(JSON.stringify({...header,labelsExpected:'true'})));
});
