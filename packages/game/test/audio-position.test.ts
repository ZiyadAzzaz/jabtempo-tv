import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioPositionTracker} from '../src/audio-position.ts';

test('a transient native audio-position rollback cannot skip the rest of a round',()=>{
  const position=new AudioPositionTracker();
  position.setDuration(78545);
  assert.equal(position.update(21000),21000);
  assert.equal(position.update(0),21000);
  assert.equal(position.update(21100),21100);
  assert.equal(position.update(21200),21200);
});

test('a confirmed early player restart resumes elapsed time without a full-track jump',()=>{
  const position=new AudioPositionTracker();
  position.setDuration(78545);
  position.update(21000);
  assert.equal(position.update(0),21000);
  assert.equal(position.update(33),21000);
  assert.equal(position.update(66),21033);
  assert.equal(position.update(1000),21967);
});

test('a confirmed wrap at the track end adds exactly one duration',()=>{
  const position=new AudioPositionTracker();
  position.setDuration(78545);
  position.update(78000);
  assert.equal(position.update(0),78000);
  assert.equal(position.update(33),78578);
  assert.equal(position.update(66),78611);
});
