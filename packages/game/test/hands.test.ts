import test from 'node:test';
import assert from 'node:assert/strict';
import { handForPunch, punchForHand, handLabel, generateChart, RoundJudge } from '../src/index.ts';

test('boxing stance changes vocabulary, never the physical left/right label',()=>{
  for(const stance of ['orthodox','southpaw'] as const) for(const hand of ['left','right'] as const) {
    assert.equal(handForPunch(punchForHand(hand,stance),stance),hand);
    assert.equal(handLabel(hand,'left-right',stance),hand.toUpperCase());
    assert.equal(handLabel(hand,'icons',stance),'');
    assert.equal(handLabel(hand,'boxing',stance),punchForHand(hand,stance).toUpperCase());
  }
  assert.equal(handForPunch('hook'),undefined);
});
test('charts keep physical hands explicit for either stance',()=>{
  for(const stance of ['orthodox','southpaw'] as const) {
    const chart=generateChart({seed:5,bpm:90,durationMs:30000,stance});
    assert.ok(chart.some(n=>n.hand==='left')); assert.ok(chart.some(n=>n.hand==='right'));
    for(const n of chart) assert.equal(n.hand,handForPunch(n.type,stance));
  }
});
test('physical wrist wins over contradictory boxing words; wrong wrist earns no points',()=>{
  const judge=new RoundJudge([{id:'left',timeMs:1000,type:'jab',hand:'left'},{id:'right',timeMs:2000,type:'cross',hand:'right'}]);
  const correct=judge.punch({id:'one',timeMs:1000,type:'cross',hand:'left'});
  assert.equal(correct?.result,'Perfect'); assert.equal(correct?.expectedHand,'left'); assert.equal(correct?.actualHand,'left');
  const wrong=judge.punch({id:'two',timeMs:2000,type:'cross',hand:'left'});
  assert.equal(wrong?.result,'Wrong hand'); assert.equal(wrong?.expectedHand,'right'); assert.equal(wrong?.actualHand,'left');
  assert.equal(judge.score(),100); assert.equal(judge.combo(),0);
});
test('legacy punch vocabulary maps through configured southpaw stance',()=>{
  const judge=new RoundJudge([{id:'right',timeMs:1000,type:'jab',hand:'right'}],{stance:'southpaw'});
  assert.equal(judge.punch({id:'one',timeMs:1000,type:'jab'})?.result,'Perfect');
  assert.throws(()=>new RoundJudge([{id:'bad',timeMs:1,type:'jab',hand:'up' as any}]));
  assert.throws(()=>new RoundJudge([],{stance:'unknown' as any}));
});
test('per-hand summary measures hits, misses, timing and guard independently; no invented weaker hand',()=>{
  const judge=new RoundJudge([
    {id:'l1',timeMs:1000,type:'jab',hand:'left'}, {id:'l2',timeMs:2000,type:'jab',hand:'left'},
    {id:'r1',timeMs:3000,type:'cross',hand:'right'}, {id:'r2',timeMs:4000,type:'cross',hand:'right'},
  ]);
  assert.equal(judge.weakerHand(),undefined); assert.equal(judge.handStats('left').accuracy,undefined);
  judge.punch({id:'one',timeMs:1020,type:'jab',hand:'left'}); judge.guardRecovered('l1',250);
  judge.advance(2200); judge.punch({id:'two',timeMs:3040,type:'cross',hand:'right'}); judge.guardRecovered('r1',300);
  judge.punch({id:'three',timeMs:4060,type:'cross',hand:'right'});
  assert.deepEqual(judge.handStats('left'),{attempted:2,hits:1,accuracy:.5,meanAbsTimingMs:20,guardRecoveryPercent:100,meanGuardRecoveryMs:250});
  assert.deepEqual(judge.handStats('right'),{attempted:2,hits:2,accuracy:1,meanAbsTimingMs:50,guardRecoveryPercent:50,meanGuardRecoveryMs:300});
  assert.equal(judge.weakerHand(),'left'); assert.equal(judge.weakerHand(1),undefined);
  judge.reset(); assert.equal(judge.handStats('left').meanGuardRecoveryMs,undefined);
});

test('live tempo windows and reported timing use actual milliseconds while chart remains in media time',()=>{
  for(const timeScale of [.5,1,1.5,2]) for(const [delta,result] of [[80,'Perfect'],[160,'Good']] as const) {
    const judge=new RoundJudge([{id:'l',timeMs:1000,type:'jab',hand:'left'}]);
    const hit=judge.punch({id:'p',timeMs:1000+delta*timeScale,type:'jab',hand:'left',timeScale});
    assert.equal(hit?.result,result); assert.equal(hit?.deltaMs,delta);
    assert.equal(judge.handStats('left').meanAbsTimingMs,delta);
  }
  const wrong=new RoundJudge([{id:'l',timeMs:1000,type:'jab',hand:'left'}]);
  const miss=wrong.punch({id:'p',timeMs:1240,type:'cross',hand:'right',timeScale:1.5});
  assert.equal(miss?.result,'Wrong hand'); assert.equal(miss?.deltaMs,160);
  const expiry=new RoundJudge([{id:'l',timeMs:1000,type:'jab',hand:'left'}]);
  assert.equal(expiry.advance(1240,1.5).length,0); assert.equal(expiry.advance(1241,1.5)[0].result,'Miss');
  for(const invalid of [NaN,Infinity,0,.49,2.01]) {
    const judge=new RoundJudge([]);
    assert.throws(()=>judge.punch({id:'p',timeMs:1,type:'jab',timeScale:invalid}));
    assert.throws(()=>judge.advance(1,invalid));
  }
});
