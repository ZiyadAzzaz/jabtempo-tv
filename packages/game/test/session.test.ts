import test from 'node:test';
import assert from 'node:assert/strict';
import {ROUND_PRESETS,PRESET_IDS,SESSION_MINUTES,isPresetId,isSessionMinutes,RoundActivity,RoundJudge,generateChart} from '../src/index.ts';

test('each preset produces deterministic complete 1/3/5-minute charts with a four-beat lead-in',()=>{
  for(const presetId of PRESET_IDS)for(const minutes of SESSION_MINUTES){
    const preset=ROUND_PRESETS[presetId],durationMs=minutes*60000;
    const options={...preset,durationMs,seed:42};
    const notes=generateChart(options);
    assert.deepEqual(notes,generateChart(options));
    assert.equal(notes[0].timeMs,4*60000/preset.bpm);
    assert.ok(notes.every(note=>note.timeMs<durationMs));
    assert.ok(notes.at(-1)!.timeMs>durationMs-5000,'A long session must not silently stop at one minute');
    assert.equal(new Set(notes.map(note=>note.id)).size,notes.length);
  }
});

test('Kids has fewer notes and at least two beats between punches; higher presets increase density',()=>{
  const counts=PRESET_IDS.map(id=>generateChart({...ROUND_PRESETS[id],seed:42,durationMs:60000}).length);
  assert.ok(counts.every((count,index)=>index===0||count>counts[index-1]));
  const kids=generateChart({...ROUND_PRESETS.kids,seed:42,durationMs:60000});
  assert.ok(kids.slice(1).every((note,index)=>note.timeMs-kids[index].timeMs>=2*60000/90-.0001));
  assert.throws(()=>generateChart({seed:42,bpm:90,durationMs:60000,noteSpacing:3 as 1}));
});

test('Kids/Pro timing windows control both hits and expiration, including changed playback rate',()=>{
  for(const id of PRESET_IDS){
    const preset=ROUND_PRESETS[id];
    for(const rate of [1,130/90]){
      for(const [delta,expected] of [[preset.perfectMs,'Perfect'],[preset.goodMs,'Good']] as const){
        const judge=new RoundJudge([{id:'note',timeMs:0,type:'jab'}],{timing:preset});
        assert.equal(judge.punch({id:'event',type:'jab',timeMs:delta*rate,timeScale:rate})?.result,expected);
      }
      const judge=new RoundJudge([{id:'note',timeMs:0,type:'jab'}],{timing:preset});
      assert.deepEqual(judge.advance(preset.goodMs*rate,rate),[]);
      assert.equal(judge.advance(preset.goodMs*rate+1,rate)[0].result,'Miss');
    }
  }
  assert.throws(()=>new RoundJudge([],{timing:{perfectMs:200,goodMs:100}}));
  assert.throws(()=>new RoundJudge([],{timing:{perfectMs:80,goodMs:Infinity}}));
});

test('active time follows advancing audio, excludes repeated paused positions and caps at track end',()=>{
  const activity=new RoundActivity(180000);
  activity.advance(30000); // 30 seconds at normal pace.
  activity.advance(30000);activity.advance(29000); // Paused and stale audio updates.
  assert.equal(activity.activeMs,30000);
  activity.advance(90000,2); // 60 track seconds take 30 actual seconds.
  assert.equal(activity.activeMs,60000);
  activity.advance(181500); // Detector drain after the chart must not count as activity.
  assert.equal(activity.activeMs,150000);
  activity.advance(185000);assert.equal(activity.activeMs,150000);
  assert.throws(()=>activity.advance(NaN));assert.throws(()=>activity.advance(1,0));
  assert.throws(()=>new RoundActivity(0));
});

test('detected punch totals count unique in-round events, including unscored punches',()=>{
  const activity=new RoundActivity(60000);
  assert.equal(activity.recordPunch('first',0),true);
  assert.equal(activity.recordPunch('first',1000),false);
  assert.equal(activity.recordPunch('unscored',33000),true);
  for(const time of [-1,60000,NaN])assert.equal(activity.recordPunch(`invalid${time}`,time),false);
  assert.equal(activity.recordPunch('',1),false);
  assert.equal(activity.detectedPunches,2);
  assert.equal(new RoundActivity(60000).detectedPunches,0);
});

test('stored preference values accept only supported preset IDs and session lengths',()=>{
  for(const id of PRESET_IDS)assert.equal(isPresetId(id),true);
  for(const invalid of ['constructor','__proto__','hard',null,1])assert.equal(isPresetId(invalid),false);
  for(const minutes of SESSION_MINUTES)assert.equal(isSessionMinutes(minutes),true);
  for(const invalid of [0,2,Infinity,'3',null])assert.equal(isSessionMinutes(invalid),false);
});
