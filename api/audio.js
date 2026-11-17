const MAX_BYTES = 4 * 1024 * 1024;

export function allowedPreview(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'audio-ssl.itunes.apple.com' &&
      !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  let url = typeof req.query.url === 'string' ? req.query.url : '';
  if (!allowedPreview(url)) return res.status(400).json({ error: 'Invalid preview URL.' });
  try {
    let response;
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (!allowedPreview(url)) return res.status(400).json({ error: 'Invalid preview redirect.' });
      response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', Accept: 'audio/*,*/*' }
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location');
      if (!location || redirects === 3) throw new Error('Invalid preview redirect');
      url = new URL(location, url).href;
    }
    if (!response.ok || !response.body) throw new Error(`Preview returned ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (!type.startsWith('audio/')) throw new Error('Unexpected preview content type');
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Preview is too large');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error('Preview is too large');
      }
      chunks.push(value);
    }
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    return res.status(200).send(Buffer.concat(chunks));
  } catch (error) {
    console.error('Preview download failed:', error);
    return res.status(502).json({ error: 'Could not load this preview. Try another track.' });
  }
}
