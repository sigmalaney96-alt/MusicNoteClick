import test from 'node:test';
import assert from 'node:assert/strict';
import { detectBeats } from '../src/beats.js';
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

test('only allows HTTPS previews on the exact Apple audio host', () => {
  assert.equal(allowedPreview('https://audio-ssl.itunes.apple.com/itunes-assets/example.m4a'), true);
  for (const url of ['http://audio-ssl.itunes.apple.com/a', 'https://audio-ssl.itunes.apple.com.evil.test/a', 'https://evil.test/a', 'https://user@audio-ssl.itunes.apple.com/a', 'https://audio-ssl.itunes.apple.com:444/a', 'not-a-url']) {
    assert.equal(allowedPreview(url), false, url);
  }
});
