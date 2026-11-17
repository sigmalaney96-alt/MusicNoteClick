# MusicNoteClick

A colorful, installable rhythm game built for iTunes song previews. Search for a track, then tap its tiles at the hit line (or use D, F, J and K). Beat detection runs locally on the decoded preview; if a preview cannot be decoded, the game falls back to direct playback with a steady beat grid, so every song stays playable. Three misses end a round, and finished rounds appear in your play history (stored on your device) for one-tap replays. A synthesized warm-up beat works without the catalog.

The landing page (`/`) explains how to install the app on iOS, Android, and desktop, with a one-tap install button where the browser supports it. After installation (or when launched from the home screen), players are taken straight to the game at `/play`.

## Run locally

Requires Node.js 20 or newer. Run `npm run dev`, then open http://localhost:3000. Run `npm test` for the focused tests.

## Deploy to Vercel

Import this repository into Vercel and deploy with the default settings; no build command or environment variables are required. The serverless `/api/search` and `/api/audio` routes proxy iTunes search results and approved preview URLs so the browser can analyze audio without cross-origin restrictions. iTunes availability varies by region and requires an internet connection. The app shell and warm-up beat are available offline after the first visit; song search and previews are not cached for offline use.

Music previews are supplied by iTunes. Availability and use are subject to Apple's terms.
