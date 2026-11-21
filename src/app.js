import { detectBeats, syntheticBeats, applyDifficulty, DIFFICULTY } from './beats.js';

const $ = selector => document.querySelector(selector);
const elements = {
  stage: $('#stage'), tiles: $('#tiles'), overlay: $('#overlay'), kicker: $('#overlay-kicker'),
  title: $('#overlay-title'), copy: $('#overlay-copy'), action: $('#overlay-action'),
  score: $('#score'), lives: $('#lives'), status: $('#game-status'), stop: $('#stop-button'),
  nowTitle: $('#now-title'), nowArtist: $('#now-artist'), nowDifficulty: $('#now-difficulty'),
  feedback: $('#feedback'), list: $('#track-list'), form: $('#search-form'), input: $('#search-input'),
  historyList: $('#history-list'), historyTitle: $('#history-title'),
  difficultyHint: $('#difficulty-hint'), holdToggle: $('#hold-toggle'),
  winResult: $('#win-result'), winArtwork: $('#win-artwork'), winTrack: $('#win-track'),
  winArtist: $('#win-artist'), winScore: $('#win-score'), continue: $('#continue-button')
};
const LEAD = 1.35;
const KEYS = ['d', 'f', 'j', 'k'];
let context;
let round;
let generation = 0;
let searchController;
let feedbackTimer;
let lastTrack = null;
let difficulty = 'medium';
let holdTiles = true;
try { holdTiles = localStorage.getItem('mnc-holds') !== '0'; } catch { holdTiles = true; }
const activePointers = new Map();

function showOverlay(kicker, title, copy, allowReplay = false) {
  elements.kicker.textContent = kicker;
  elements.title.textContent = title;
  elements.copy.textContent = copy;
  elements.action.hidden = !(allowReplay && lastTrack);
  elements.overlay.hidden = false;
}

function clearRound() {
  generation++;
  if (round) {
    cancelAnimationFrame(round.frame);
    if (round.source) {
      try { round.source.stop(); } catch (error) {
        if (error.name !== 'InvalidStateError') throw error;
      }
      round.source.disconnect();
    }
    if (round.element) {
      round.element.pause();
      round.element.removeAttribute('src');
    }
    round = null;
  }
  activePointers.clear();
  document.body.classList.remove('playing');
  elements.tiles.replaceChildren();
  elements.stop.hidden = true;
}

function updateStats() {
  elements.score.textContent = String(round.score).padStart(4, '0');
  elements.lives.textContent = '♥ '.repeat(round.lives).trim() + ' ♡'.repeat(3 - round.lives);
  elements.lives.setAttribute('aria-label', `${round.lives} lives remaining`);
}

function notify(text) {
  elements.feedback.textContent = text;
  elements.feedback.classList.remove('pop');
  void elements.feedback.offsetWidth;
  elements.feedback.classList.add('pop');
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => elements.feedback.classList.remove('pop'), 500);
}

function finish(won) {
  const { score, track } = round;
  if (track) saveHistory(track, score);
  clearRound();
  elements.status.textContent = won ? 'ROUND COMPLETE' : 'ROUND OVER';
  elements.winResult.hidden = !won;
  elements.continue.hidden = !won;
  elements.action.hidden = won || !lastTrack;
  if (won && track) {
    elements.winArtwork.src = track.artwork || '/icons/icon-192.png';
    elements.winTrack.textContent = track.title;
    elements.winArtist.textContent = track.artist;
    elements.winScore.textContent = String(score).padStart(4, '0');
  }
  showOverlay(won ? 'THAT WAS A WHOLE VIBE' : 'KEEP THAT HEAD UP', won ? 'You did it!' : 'One more time?',
    won ? 'You made it to the end of the song.' : `You scored ${score} points. Play the same song again or pick a new one.`, !won);
  elements.continue.hidden = !won;
}

function scoreBeat(beat, elapsed) {
  beat.hit = true;
  beat.holding = false;
  beat.element?.remove();
  const perfect = Math.abs(beat.time - elapsed) < 0.09;
  round.score += Math.round((beat.hold ? 150 : perfect ? 100 : 50) * round.multiplier);
  updateStats();
  notify(beat.hold ? 'GREAT HOLD!' : perfect ? 'PERFECT!' : 'NICE!');
}

function missBeat(beat, message = 'MISS!') {
  beat.missed = true;
  beat.holding = false;
  beat.element?.remove();
  round.lives--;
  updateStats();
  notify(message);
  if (!round.lives) finish(false);
}

function press(lane) {
  if (!round) return;
  const elapsed = round.clock();
  // Tapping a lane hits its nearest on-screen tile — no need to wait for the line.
  const beat = round.beats
    .filter(item => !item.hit && !item.missed && !item.holding && item.lane === lane &&
      item.time - elapsed <= LEAD)
    .sort((a, b) => Math.abs(a.time - elapsed) - Math.abs(b.time - elapsed))[0];
  if (!beat) {
    round.lives--;
    updateStats();
    notify('EMPTY LANE!');
    if (!round.lives) finish(false);
    return;
  }
  if (beat.hold) {
    beat.holding = true;
    beat.element?.classList.add('holding');
    notify('HOLD!');
    return;
  }
  scoreBeat(beat, elapsed);
}

function release(lane) {
  if (!round) return;
  const beat = round.beats.find(item => item.holding && item.lane === lane);
  if (!beat) return;
  const elapsed = round.clock();
  if (elapsed >= beat.time + beat.hold - 0.12) scoreBeat(beat, elapsed);
  else missBeat(beat, 'TOO SHORT!');
}

function tick() {
  if (!round) return;
  const elapsed = round.clock();
  const hitY = elements.stage.clientHeight - 70;
  for (const beat of round.beats) {
    if (beat.holding && elapsed >= beat.time + beat.hold) scoreBeat(beat, elapsed);
    if (!beat.hit && !beat.missed && !beat.holding && elapsed > beat.time + round.window) {
      missBeat(beat);
      if (!round) return;
    }
    if (beat.hit || beat.missed) continue;
    const remaining = beat.time - elapsed;
    if (remaining <= LEAD && remaining >= -round.window - (beat.hold || 0)) {
      if (!beat.element) {
        beat.element = document.createElement('div');
        beat.element.className = `tile tile-${beat.lane}${beat.hold ? ' tile-hold' : ''}`;
        beat.element.textContent = beat.hold ? '♪ HOLD' : '♫';
        beat.height = 60 + (beat.hold || 0) * (hitY / LEAD);
        beat.element.style.height = `${beat.height}px`;
        elements.tiles.append(beat.element);
      }
      beat.element.style.top = `${hitY - remaining / LEAD * hitY - beat.height / 2}px`;
    }
  }
  if (!round) return;
  if (elapsed >= round.duration) return finish(true);
  round.frame = requestAnimationFrame(tick);
}

async function startTrack(track) {
  clearRound();
  const current = generation;
  lastTrack = track;
  const cfg = DIFFICULTY[difficulty];
  elements.nowTitle.textContent = track.title;
  elements.nowArtist.textContent = track.artist;
  elements.nowDifficulty.textContent = cfg.label;
  elements.nowDifficulty.hidden = false;
  elements.score.textContent = '0000';
  elements.lives.textContent = '♥ ♥ ♥';
  elements.lives.setAttribute('aria-label', '3 lives remaining');
  elements.status.textContent = 'GETTING THE BEAT READY';
  elements.winResult.hidden = true;
  elements.continue.hidden = true;
  showOverlay('HANG TIGHT', 'Finding the beat...', 'Getting your track ready to play.');
  elements.stop.hidden = false;
  try {
    context ||= new (window.AudioContext || window.webkitAudioContext)();
    await context.resume();
    let source = null;
    let element = null;
    let beats;
    let duration;
    let clock;
    const startBuffer = buffer => {
      // If a preview has no clear transients, fall back to a steady grid so it still plays.
      beats = detectBeats(buffer);
      if (!beats.length) beats = syntheticBeats(buffer.duration);
      beats = applyDifficulty(beats, difficulty, holdTiles);
      duration = buffer.duration;
      source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const start = context.currentTime + 0.1;
      clock = () => context.currentTime - start;
      source.start(start);
    };
    const audioUrl = `/api/audio?url=${encodeURIComponent(track.preview)}`;
    const response = await fetch(audioUrl);
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Could not load this preview.');
    }
    try {
      startBuffer(await context.decodeAudioData(await response.arrayBuffer()));
    } catch (decodeError) {
      // Some browsers cannot decode AAC previews with Web Audio. Play the file
      // through a media element instead and keep a steady beat grid.
      console.warn('Preview decode failed, using direct playback:', decodeError);
      element = new Audio(audioUrl);
      await element.play();
      duration = Number.isFinite(element.duration) ? element.duration : 30;
      beats = applyDifficulty(syntheticBeats(duration), difficulty, holdTiles);
      clock = () => element.currentTime;
    }
    if (current !== generation) {
      if (source) try { source.stop(); } catch { /* already stopped */ }
      if (element) element.pause();
      return;
    }
    round = { source, element, track, duration, beats, clock, score: 0, lives: 3, frame: 0, window: cfg.window, multiplier: cfg.score };
    document.body.classList.add('playing');
    elements.overlay.hidden = true;
    elements.status.textContent = 'FEEL THE BEAT';
    tick();
  } catch (error) {
    if (current !== generation) return;
    console.error('Unable to start track:', error);
    clearRound();
    elements.status.textContent = 'READY WHEN YOU ARE';
    showOverlay('OOPS, WRONG NOTE', 'Let’s try that again.', error.message || 'This track could not be played. Try another one.', true);
  }
}

function mapTrack(track) {
  return {
    id: track.trackId ?? track.id,
    title: track.trackName ?? track.title,
    artist: track.artistName ?? track.artist,
    artwork: track.artworkUrl100 ?? track.artwork,
    preview: track.previewUrl ?? track.preview,
    collection: track.collectionName ?? track.collection
  };
}

async function fetchTracks(term, signal) {
  try {
    const response = await fetch(`/api/search?term=${encodeURIComponent(term)}`, { signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Search failed.');
    return data.tracks;
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    // The iTunes Search API allows cross-origin reads, so the browser can ask
    // directly if the same-origin proxy is unavailable.
    console.warn('Proxy search failed, trying iTunes directly:', error);
    const url = new URL('https://itunes.apple.com/search');
    url.search = new URLSearchParams({ term, entity: 'song', media: 'music', limit: '20' });
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('Search failed. Try again in a moment.');
    const data = await response.json();
    return (data.results || []).filter(track => track.previewUrl && track.trackName && track.artistName).map(mapTrack);
  }
}

function saveHistory(track, score) {
  try {
    const history = JSON.parse(localStorage.getItem('mnc-history') || '[]')
      .filter(entry => entry.title !== track.title || entry.artist !== track.artist);
    history.unshift({ title: track.title, artist: track.artist, artwork: track.artwork, preview: track.preview, score });
    localStorage.setItem('mnc-history', JSON.stringify(history.slice(0, 10)));
    renderHistory();
  } catch (error) {
    console.warn('Play history unavailable:', error);
  }
}

function trackButton(entry, { number, badge, label, icon }) {
  const button = document.createElement('button');
  button.className = 'track';
  button.setAttribute('aria-label', label);
  const art = document.createElement('img');
  art.src = entry.artwork || '/icons/icon-192.png';
  art.alt = '';
  art.loading = 'lazy';
  const info = document.createElement('span');
  info.className = 'track-info';
  const title = document.createElement('strong');
  title.textContent = entry.title;
  const artist = document.createElement('small');
  artist.textContent = entry.artist;
  info.append(title, artist);
  const play = document.createElement('span');
  play.className = 'track-play';
  play.textContent = icon;
  if (number) {
    const numberEl = document.createElement('span');
    numberEl.className = 'track-number';
    numberEl.textContent = number;
    button.append(numberEl);
  }
  if (badge) {
    const badgeEl = document.createElement('span');
    badgeEl.className = 'history-score';
    badgeEl.textContent = badge;
    button.append(art, info, badgeEl, play);
  } else {
    button.append(art, info, play);
  }
  button.addEventListener('click', () => startTrack(entry));
  return button;
}

function renderHistory() {
  let history = [];
  try { history = JSON.parse(localStorage.getItem('mnc-history') || '[]'); } catch { return; }
  elements.historyTitle.hidden = !history.length;
  elements.historyList.replaceChildren();
  history.forEach(entry => {
    elements.historyList.append(trackButton(entry, {
      badge: String(entry.score).padStart(4, '0'),
      label: `Replay ${entry.title} by ${entry.artist}`,
      icon: '↻'
    }));
  });
}

async function search(term) {
  searchController?.abort();
  const controller = new AbortController();
  searchController = controller;
  elements.list.innerHTML = '<p class="list-message">Finding some good vibes...</p>';
  try {
    const tracks = await fetchTracks(term, controller.signal);
    elements.list.replaceChildren();
    if (!tracks.length) {
      elements.list.textContent = 'No tracks found. Try another search!';
      return;
    }
    tracks.forEach((track, index) => {
      elements.list.append(trackButton(track, {
        number: String(index + 1).padStart(2, '0'),
        label: `Play ${track.title} by ${track.artist}`,
        icon: '▶'
      }));
    });
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('Search failed:', error);
    elements.list.textContent = error.message || 'Could not load tracks. Please try again.';
  }
}

elements.form.addEventListener('submit', event => {
  event.preventDefault();
  const term = elements.input.value.trim();
  if (term) search(term);
});
elements.action.addEventListener('click', () => {
  if (lastTrack) startTrack(lastTrack);
});
elements.continue.addEventListener('click', () => {
  elements.overlay.hidden = true;
  elements.winResult.hidden = true;
  elements.continue.hidden = true;
  elements.status.textContent = 'READY WHEN YOU ARE';
});
elements.stop.addEventListener('click', () => {
  clearRound();
  elements.status.textContent = 'READY WHEN YOU ARE';
  showOverlay('READY FOR ANOTHER?', 'Your beat is waiting.', 'Pick a song from the track list, or replay your last one.', true);
});
document.querySelectorAll('#difficulty button').forEach(button => {
  button.addEventListener('click', () => {
    difficulty = button.dataset.level;
    document.querySelectorAll('#difficulty button').forEach(item => item.classList.toggle('active', item === button));
    elements.difficultyHint.textContent = button.dataset.hint;
  });
});
elements.holdToggle.checked = holdTiles;
elements.holdToggle.addEventListener('change', () => {
  holdTiles = elements.holdToggle.checked;
  try { localStorage.setItem('mnc-holds', holdTiles ? '1' : '0'); } catch { /* storage unavailable */ }
  notify(holdTiles ? 'HOLD TILES ON!' : 'HOLD TILES OFF!');
});
elements.stage.addEventListener('pointerdown', event => {
  if (!round) return;
  const rect = elements.stage.getBoundingClientRect();
  const lane = Math.max(0, Math.min(3, Math.floor((event.clientX - rect.left) / rect.width * 4)));
  activePointers.set(event.pointerId, lane);
  press(lane);
});
for (const type of ['pointerup', 'pointercancel']) {
  elements.stage.addEventListener(type, event => {
    const lane = activePointers.get(event.pointerId);
    if (lane === undefined) return;
    activePointers.delete(event.pointerId);
    release(lane);
  });
}
window.addEventListener('keydown', event => {
  if (event.repeat || event.target.matches('input, textarea, button')) return;
  const lane = KEYS.indexOf(event.key.toLowerCase());
  if (lane !== -1) { event.preventDefault(); press(lane); }
});
window.addEventListener('keyup', event => {
  const lane = KEYS.indexOf(event.key.toLowerCase());
  if (lane !== -1) release(lane);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && round) {
    clearRound();
    elements.status.textContent = 'ROUND ENDED';
    showOverlay('WELCOME BACK', 'Ready to groove?', 'Your round ended while the app was away. Pick a track to play again.', true);
  }
});
renderHistory();
search('pop hits');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(error => console.error('Offline support unavailable:', error));

let installPrompt;
const installButtons = [$('#install-button'), $('#overlay-install')];
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  installButtons.forEach(button => { button.hidden = false; });
});
installButtons.forEach(button => button.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  installButtons.forEach(item => { item.hidden = true; });
}));
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  installButtons.forEach(item => { item.hidden = true; });
  notify('INSTALLED! ♪');
});
