import { detectBeats, syntheticBeats } from './beats.js';

const $ = selector => document.querySelector(selector);
const elements = {
  stage: $('#stage'), tiles: $('#tiles'), overlay: $('#overlay'), kicker: $('#overlay-kicker'),
  title: $('#overlay-title'), copy: $('#overlay-copy'), warmup: $('#warmup-button'),
  score: $('#score'), lives: $('#lives'), status: $('#game-status'), stop: $('#stop-button'),
  nowTitle: $('#now-title'), nowArtist: $('#now-artist'), feedback: $('#feedback'),
  list: $('#track-list'), form: $('#search-form'), input: $('#search-input'),
  historyList: $('#history-list'), historyTitle: $('#history-title')
};
const LEAD = 1.8;
const WINDOW = 0.22;
let context;
let round;
let generation = 0;
let searchController;
let feedbackTimer;

function showOverlay(kicker, title, copy, button = 'PLAY THE WARM-UP') {
  elements.kicker.textContent = kicker;
  elements.title.textContent = title;
  elements.copy.textContent = copy;
  elements.warmup.innerHTML = '';
  elements.warmup.append(document.createTextNode(button + ' '));
  const arrow = document.createElement('span');
  arrow.textContent = '↗';
  elements.warmup.append(arrow);
  elements.warmup.hidden = false;
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
  if (track && !track.practice) saveHistory(track, score);
  clearRound();
  elements.status.textContent = won ? 'ROUND COMPLETE' : 'ROUND OVER';
  showOverlay(won ? 'THAT WAS A WHOLE VIBE' : 'KEEP THAT HEAD UP', won ? 'Nice moves!' : 'One more time?', `You scored ${score} points. Pick another track or play it again.`, 'PLAY IT AGAIN');
}

function tick() {
  if (!round) return;
  const elapsed = round.clock();
  for (const beat of round.beats) {
    if (!beat.hit && !beat.missed && elapsed > beat.time + WINDOW) {
      beat.missed = true;
      beat.element?.remove();
      round.lives--;
      updateStats();
      notify('MISS!');
      if (!round.lives) return finish(false);
    }
    if (beat.hit || beat.missed) continue;
    const remaining = beat.time - elapsed;
    if (remaining <= LEAD && remaining >= -WINDOW) {
      if (!beat.element) {
        beat.element = document.createElement('div');
        beat.element.className = `tile tile-${beat.lane}`;
        beat.element.textContent = '♫';
        elements.tiles.append(beat.element);
      }
      const hitY = elements.stage.clientHeight - 70;
      beat.element.style.top = `${hitY - remaining / LEAD * hitY - 30}px`;
    }
  }
  if (elapsed >= round.duration) return finish(true);
  round.frame = requestAnimationFrame(tick);
}

function tap(lane) {
  if (!round) return;
  const elapsed = round.clock();
  const beat = round.beats.find(item => !item.hit && !item.missed && item.lane === lane && Math.abs(item.time - elapsed) <= WINDOW);
  if (!beat) {
    notify('WAIT FOR IT!');
    return;
  }
  beat.hit = true;
  beat.element?.remove();
  round.score += Math.abs(beat.time - elapsed) < 0.09 ? 100 : 50;
  updateStats();
  notify(Math.abs(beat.time - elapsed) < 0.09 ? 'PERFECT!' : 'NICE!');
}

async function startTrack(track) {
  clearRound();
  const current = generation;
  elements.nowTitle.textContent = track.title;
  elements.nowArtist.textContent = track.artist;
  elements.score.textContent = '0000';
  elements.lives.textContent = '♥ ♥ ♥';
  elements.lives.setAttribute('aria-label', '3 lives remaining');
  elements.status.textContent = 'GETTING THE BEAT READY';
  showOverlay('HANG TIGHT', 'Finding the beat...', 'Getting your track ready to play.');
  elements.warmup.hidden = true;
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
      duration = buffer.duration;
      source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const start = context.currentTime + 0.1;
      clock = () => context.currentTime - start;
      source.start(start);
    };
    if (track.practice) {
      startBuffer(makePractice(context));
    } else {
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
        beats = syntheticBeats(duration);
        clock = () => element.currentTime;
      }
    }
    if (current !== generation) {
      if (source) try { source.stop(); } catch { /* already stopped */ }
      if (element) element.pause();
      return;
    }
    round = { source, element, track, duration, beats, clock, score: 0, lives: 3, frame: 0 };
    elements.overlay.hidden = true;
    elements.status.textContent = 'FEEL THE BEAT';
    tick();
  } catch (error) {
    if (current !== generation) return;
    console.error('Unable to start track:', error);
    clearRound();
    elements.status.textContent = 'READY WHEN YOU ARE';
    showOverlay('OOPS, WRONG NOTE', 'Let’s try that again.', error.message || 'This track could not be played. Try another one.');
  }
}

function makePractice(audioContext) {
  const rate = audioContext.sampleRate;
  const duration = 22;
  const buffer = audioContext.createBuffer(1, rate * duration, rate);
  const samples = buffer.getChannelData(0);
  const notes = [110, 130.81, 146.83, 164.81, 146.83, 130.81, 110, 98];
  for (let i = 0; i < samples.length; i++) {
    const time = i / rate;
    const beat = Math.floor(time / 0.5);
    const phase = time % 0.5;
    const kick = Math.sin(2 * Math.PI * (65 * phase - 35 * phase * phase)) * Math.exp(-phase * 20) * 0.65;
    const bass = Math.sin(2 * Math.PI * notes[beat % notes.length] * phase) * Math.exp(-phase * 5) * 0.22;
    const offbeat = (time + 0.25) % 0.5;
    const hat = Math.sin(2 * Math.PI * 5200 * time) * Math.exp(-offbeat * 80) * 0.08;
    samples[i] = kick + bass + hat;
  }
  return buffer;
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

function renderHistory() {
  let history = [];
  try { history = JSON.parse(localStorage.getItem('mnc-history') || '[]'); } catch { return; }
  elements.historyTitle.hidden = !history.length;
  elements.historyList.replaceChildren();
  history.forEach(entry => {
    const button = document.createElement('button');
    button.className = 'track';
    button.setAttribute('aria-label', `Replay ${entry.title} by ${entry.artist}`);
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
    const score = document.createElement('span');
    score.className = 'history-score';
    score.textContent = String(entry.score).padStart(4, '0');
    const replay = document.createElement('span');
    replay.className = 'track-play';
    replay.textContent = '↻';
    button.append(art, info, score, replay);
    button.addEventListener('click', () => startTrack(entry));
    elements.historyList.append(button);
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
      const button = document.createElement('button');
      button.className = 'track';
      button.setAttribute('aria-label', `Play ${track.title} by ${track.artist}`);
      const art = document.createElement('img');
      art.src = track.artwork || '/icons/icon-192.png';
      art.alt = '';
      art.loading = 'lazy';
      const info = document.createElement('span');
      info.className = 'track-info';
      const title = document.createElement('strong');
      title.textContent = track.title;
      const artist = document.createElement('small');
      artist.textContent = track.artist;
      info.append(title, artist);
      const play = document.createElement('span');
      play.className = 'track-play';
      play.textContent = '▶';
      const number = document.createElement('span');
      number.className = 'track-number';
      number.textContent = String(index + 1).padStart(2, '0');
      button.append(number, art, info, play);
      button.addEventListener('click', () => startTrack(track));
      elements.list.append(button);
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
elements.warmup.addEventListener('click', () => startTrack({ title: 'The Warm-Up Groove', artist: 'MusicNoteClick', practice: true }));
elements.stop.addEventListener('click', () => {
  clearRound();
  elements.status.textContent = 'READY WHEN YOU ARE';
  showOverlay('READY FOR ANOTHER?', 'Your beat is waiting.', 'Choose a song, or warm up with our house beat.');
});
elements.stage.addEventListener('pointerdown', event => {
  if (!round) return;
  const rect = elements.stage.getBoundingClientRect();
  const lane = Math.max(0, Math.min(3, Math.floor((event.clientX - rect.left) / rect.width * 4)));
  tap(lane);
});
window.addEventListener('keydown', event => {
  if (event.repeat || event.target.matches('input, textarea, button')) return;
  const lane = ['d', 'f', 'j', 'k'].indexOf(event.key.toLowerCase());
  if (lane !== -1) { event.preventDefault(); tap(lane); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && round) {
    clearRound();
    elements.status.textContent = 'ROUND ENDED';
    showOverlay('WELCOME BACK', 'Ready to groove?', 'Your round ended while the app was away. Pick a track to play again.');
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
