import test from 'node:test';
import assert from 'node:assert/strict';
import { detectBeats, syntheticBeats, applyDifficulty, DIFFICULTY } from '../src/beats.js';
import { allowedPreview } from '../api/audio.js';

test('detects separated transients after the lead-in and assigns playable lanes', () => {
  const rate = 1000;
  const samples = new Float32Array(5000);
  for (const time of [0.5, 2, 2.5, 3, 4]) samples.fill(0.8, time * rate, time * rate + 20);
  const beats = detectBeats({ sampleRate: rate, duration: 5, getChannelData: () => samples });
  assert.deepEqual(beats.map(beat => beat.time), [2, 2.5, 3, 4]);
  assert.ok(beats.every(beat => beat.lane >= 0 && beat.lane < 4));
});

test('does not invent beats for silence and keeps the strongest nearby transient', () => {
  const samples = new Float32Array(4000);
  const buffer = { sampleRate: 1000, duration: 4, getChannelData: () => samples };
  assert.deepEqual(detectBeats(buffer), []);
  samples.fill(0.3, 2000, 2020);
  samples.fill(0.9, 2160, 2180);
  assert.deepEqual(detectBeats(buffer).map(beat => beat.time), [2.16]);
});

test('syntheticBeats builds an even playable grid for undecodable previews', () => {
  const beats = syntheticBeats(10, 0.5);
  assert.ok(beats.length >= 15);
  assert.equal(beats[0].time, 2);
  assert.equal(beats[1].time - beats[0].time, 0.5);
  assert.ok(beats.at(-1).time < 10);
  assert.ok(beats.every(beat => beat.lane >= 0 && beat.lane < 4));
});

test('applyDifficulty increases medium tile density, marks hold tiles, and tightens windows per level', () => {
  const base = Array.from({ length: 12 }, (_, i) => ({ time: 2 + i * 0.5, lane: i % 4, hit: false }));
  const easy = applyDifficulty(base, 'easy');
  const medium = applyDifficulty(base, 'medium');
  const hard = applyDifficulty(base, 'hard');
  assert.equal(easy.length, 4);
  assert.equal(medium.length, 12);
  assert.equal(hard.length, 12);
  for (const beats of [easy, medium, hard]) assert.ok(beats.some(beat => beat.hold > 0));
  assert.ok(DIFFICULTY.hard.window < DIFFICULTY.medium.window);
  assert.ok(DIFFICULTY.medium.window < DIFFICULTY.easy.window);
  assert.ok(DIFFICULTY.hard.score > DIFFICULTY.easy.score);
});

test('applyDifficulty can disable hold tiles while keeping the beat grid', () => {
  const base = Array.from({ length: 12 }, (_, i) => ({ time: 2 + i * 0.5, lane: i % 4, hit: false }));
  const noHolds = applyDifficulty(base, 'hard', false);
  assert.equal(noHolds.length, 12);
  assert.ok(noHolds.every(beat => beat.hold === 0));
  assert.ok(applyDifficulty(base, 'hard', true).some(beat => beat.hold > 0));
});

test('only allows HTTPS previews on the exact Apple audio host', () => {
  assert.equal(allowedPreview('https://audio-ssl.itunes.apple.com/itunes-assets/example.m4a'), true);
  for (const url of ['http://audio-ssl.itunes.apple.com/a', 'https://audio-ssl.itunes.apple.com.evil.test/a', 'https://evil.test/a', 'https://user@audio-ssl.itunes.apple.com/a', 'https://audio-ssl.itunes.apple.com:444/a', 'not-a-url']) {
    assert.equal(allowedPreview(url), false, url);
  }
});
