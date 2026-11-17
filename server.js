import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import search from './api/search.js';
import audio from './api/audio.js';

const root = import.meta.dirname;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  req.query = Object.fromEntries(url.searchParams);
  res.status = code => { res.statusCode = code; return res; };
  res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  res.send = value => res.end(value);
  if (url.pathname === '/api/search') return search(req, res);
  if (url.pathname === '/api/audio') return audio(req, res);
  const routes = { '/': '/index.html', '/play': '/play.html' };
  const path = resolve(root, `.${routes[url.pathname] || url.pathname}`);
  if (!path.startsWith(root + sep) || !types[extname(path)]) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  try {
    const data = await readFile(path);
    res.setHeader('Content-Type', types[extname(path)]);
    res.end(data);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'EISDIR') console.error('Static file error:', error);
    res.statusCode = error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500;
    res.end(res.statusCode === 404 ? 'Not found' : 'Server error');
  }
});
server.listen(process.env.PORT || 3000, () => console.log(`MusicNoteClick running on http://localhost:${process.env.PORT || 3000}`));
