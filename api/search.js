export default async function handler(req, res) {
  const term = typeof req.query.term === 'string' ? req.query.term.trim().slice(0, 100) : '';
  if (!term) return res.status(400).json({ error: 'Enter a song or artist to search.' });
  try {
    const url = new URL('https://itunes.apple.com/search');
    url.search = new URLSearchParams({ term, entity: 'song', media: 'music', limit: '20' });
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`iTunes returned ${response.status}`);
    const data = await response.json();
    const tracks = (data.results || []).filter(track => track.previewUrl && track.trackName && track.artistName).map(track => ({
      id: track.trackId,
      title: track.trackName,
      artist: track.artistName,
      artwork: track.artworkUrl100,
      preview: track.previewUrl,
      collection: track.collectionName
    }));
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
    return res.status(200).json({ tracks });
  } catch (error) {
    console.error('iTunes search failed:', error);
    return res.status(502).json({ error: 'Could not reach iTunes. Try again in a moment.' });
  }
}
