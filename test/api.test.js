import test from 'node:test';
import assert from 'node:assert/strict';
import search from '../api/search.js';
import audio from '../api/audio.js';

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; }
  };
}

test('search maps playable iTunes results and rejects empty searches', async t => {
  let fetched;
  t.mock.method(globalThis, 'fetch', async url => {
    fetched = url;
    return Response.json({ results: [
      { trackId: 1, trackName: 'Song', artistName: 'Artist', previewUrl: 'https://audio-ssl.itunes.apple.com/a', artworkUrl100: 'https://example.com/art', trackTimeMillis: 47231 },
      { trackName: 'No preview', artistName: 'Artist' }
    ] });
  });
  const res = response();
  await search({ query: { term: '  funk & soul  ' } }, res);
  assert.equal(fetched.searchParams.get('term'), 'funk & soul');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.tracks.length, 1);
  assert.equal(res.body.tracks[0].title, 'Song');
  assert.equal(res.body.tracks[0].duration, 47231);
  const empty = response();
  await search({ query: { term: '  ' } }, empty);
  assert.equal(empty.statusCode, 400);
});

test('audio serves an approved preview and refuses redirects to other hosts', async t => {
  const preview = 'https://audio-ssl.itunes.apple.com/a';
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('audio', { headers: { 'content-type': 'audio/mp4' } }));
  const res = response();
  await audio({ query: { url: preview } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'audio/mp4');
  assert.equal(res.body.toString(), 'audio');
  fetchMock.mock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: 'https://example.com/other' } }));
  const redirect = response();
  await audio({ query: { url: preview } }, redirect);
  assert.equal(redirect.statusCode, 400);
  assert.equal(fetchMock.mock.callCount(), 2);
});
