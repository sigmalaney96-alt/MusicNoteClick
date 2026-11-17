import { detectBeats } from './beats.js';

const $ = selector => document.querySelector(selector);
const elements = {
  stage: $('#stage'), tiles: $('#tiles'), overlay: $('#overlay'), kicker: $('#overlay-kicker'),
  title: $('#overlay-title'), copy: $('#overlay-copy'), demo: $('#demo-button'),
  score: $('#score'), lives: $('#lives'), status: $('#game-status'), stop: $('#stop-button'),
  nowTitle: $('#now-title'), nowArtist: $('#now-artist'), feedback: $('#feedback'),
  list: $('#track-list'), form: $('#search-form'), input: $('#search-input')
};
const LEAD = 1.8;
const WINDOW = 0.22;
let context;
let round;
let generation = 0;
let searchController;
let feedbackTimer;

function showOverlay(kicker, title, copy, button = 'PLAY DEMO BEAT') {
  elements.kicker.textContent = kicker;
  elements.title.textContent = title;
  elements.copy.textContent = copy;
  elements.demo.innerHTML = '';
  elements.demo.append(document.createTextNode(button + ' '));
  const arrow = document.createElement('span');
  arrow.textContent = '↗';
  elements.demo.append(arrow);
  elements.demo.hidden = false;
  elements.overlay.hidden = false;
}

function clearRound() {
  generation++;
  if (round) {
    cancelAnimationFrame(round.frame);
    try { round.source.stop(); } catch (error) {
      if (error.name !== 'InvalidStateError') throw error;
    }
    round.source.disconnect();
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
  const score = round.score;
  clearRound();
  elements.status.textContent = won ? 'ROUND COMPLETE' : 'ROUND OVER';
  showOverlay(won ? 'THAT WAS A WHOLE VIBE' : 'KEEP THAT HEAD UP', won ? 'Nice moves!' : 'One more time?', `You scored ${score} points. Pick another track or play the demo again.`, 'PLAY DEMO AGAIN');
}

function tick() {
  if (!round) return;
  const elapsed = context.currentTime - round.start;
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
  const elapsed = context.currentTime - round.start;
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
  elements.demo.hidden = true;
  elements.stop.hidden = false;
  try {
    context ||= new AudioContext();
    await context.resume();
    let buffer;
    if (track.demo) buffer = makeDemo(context);
    else {
      const response = await fetch(`/api/audio?url=${encodeURIComponent(track.preview)}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Could not load this preview.');
      }
      buffer = await context.decodeAudioData(await response.arrayBuffer());
    }
    if (current !== generation) return;
    const beats = detectBeats(buffer);
    if (!beats.length) throw new Error('No clear beats found in this preview. Try another track!');
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const start = context.currentTime + 0.1;
    round = { source, start, duration: buffer.duration, beats, score: 0, lives: 3, frame: 0 };
    elements.overlay.hidden = true;
    elements.status.textContent = 'FEEL THE BEAT';
    source.start(start);
    tick();
  } catch (error) {
    if (current !== generation) return;
    console.error('Unable to start track:', error);
    clearRound();
    elements.status.textContent = 'READY WHEN YOU ARE';
    showOverlay('OOPS, WRONG NOTE', 'Let’s try that again.', error.message || 'This track could not be played. Try another one.');
  }
}

function makeDemo(audioContext) {
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

async function search(term) {
  searchController?.abort();
  const controller = new AbortController();
  searchController = controller;
  elements.list.innerHTML = '<p class="list-message">Finding some good vibes...</p>';
  try {
    const response = await fetch(`/api/search?term=${encodeURIComponent(term)}`, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Search failed.');
    elements.list.replaceChildren();
    if (!data.tracks.length) {
      elements.list.textContent = 'No tracks found. Try another search!';
      return;
    }
    data.tracks.forEach((track, index) => {
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
elements.demo.addEventListener('click', () => startTrack({ title: 'The Demo Groove', artist: 'MusicNoteClick', demo: true }));
elements.stop.addEventListener('click', () => {
  clearRound();
  elements.status.textContent = 'READY WHEN YOU ARE';
  showOverlay('READY FOR ANOTHER?', 'Your beat is waiting.', 'Choose a song or try our demo beat to get grooving.');
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
