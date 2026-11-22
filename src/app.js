import { detectBeats, syntheticBeats, applyDifficulty, isWithinHitWindow, DIFFICULTY, TILE_SPEEDS, tileMotion, isPointInExpandedRect } from './beats.js';

const $ = selector => document.querySelector(selector);
const elements = {
  stage: $('#stage'), tiles: $('#tiles'), overlay: $('#overlay'), kicker: $('#overlay-kicker'),
  title: $('#overlay-title'), copy: $('#overlay-copy'), action: $('#overlay-action'),
  score: $('#score'), lives: $('#lives'), status: $('#game-status'), stop: $('#stop-button'),
  nowTitle: $('#now-title'), nowArtist: $('#now-artist'), nowDifficulty: $('#now-difficulty'),
  feedback: $('#feedback'), list: $('#track-list'), form: $('#search-form'), input: $('#search-input'),
  historyList: $('#history-list'),
  difficultyHint: $('#difficulty-hint'), holdToggle: $('#hold-toggle'),
  winResult: $('#win-result'), winArtwork: $('#win-artwork'), winTrack: $('#win-track'),
  winArtist: $('#win-artist'), winScore: $('#win-score'), lossResult: $('#loss-result'),
  lossScore: $('#loss-score'), continue: $('#continue-button'), overallScore: $('#overall-score')
};
const EMOJI_IMAGES = { '🐻': '/icons/emoji-bear.svg', '🐶': '/icons/emoji-dog.svg', '🐱': '/icons/emoji-cat.svg', '🐸': '/icons/emoji-frog.svg' };
const DEFAULT_CUSTOM_COLORS = Object.freeze({ primary: '#4a3671', accent: '#ff9dc7', third: '#a8dcff' });
const DEFAULT_PREFERENCES = { speed: 'normal', theme: 'jazz', emoji: '♫', customColors: { ...DEFAULT_CUSTOM_COLORS } };
const isValidColor = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
let preferences = { ...DEFAULT_PREFERENCES };
try {
  const savedPreferences = JSON.parse(localStorage.getItem('mnc-settings') || '{}');
  preferences = {
    speed: TILE_SPEEDS[savedPreferences.speed] ? savedPreferences.speed : DEFAULT_PREFERENCES.speed,
    theme: ['jazz', 'caffeinated', 'ocean', 'ember', 'earth', 'cotton-candy', 'custom'].includes(savedPreferences.theme) ? savedPreferences.theme : DEFAULT_PREFERENCES.theme,
    emoji: ['♫', '🐻', '🐶', '🐱', '🐸', '🍿', '🍓', '🐯', '🦄', '🍕'].includes(savedPreferences.emoji) ? savedPreferences.emoji : DEFAULT_PREFERENCES.emoji,
    customColors: {
      primary: isValidColor(savedPreferences.customColors?.primary) ? savedPreferences.customColors.primary : DEFAULT_CUSTOM_COLORS.primary,
      accent: isValidColor(savedPreferences.customColors?.accent) ? savedPreferences.customColors.accent : DEFAULT_CUSTOM_COLORS.accent,
      third: isValidColor(savedPreferences.customColors?.third) ? savedPreferences.customColors.third : DEFAULT_CUSTOM_COLORS.third
    }
  };
} catch { preferences = { ...DEFAULT_PREFERENCES }; }
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
let overallScore = 0;

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

function updateOverallScore() {
  elements.overallScore.textContent = String(overallScore).padStart(6, '0');
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
  document.body.classList.add('result-screen');
  elements.status.textContent = won ? 'ROUND COMPLETE' : 'ROUND OVER';
  elements.winResult.hidden = !won;
  elements.lossResult.hidden = won;
  elements.continue.hidden = !won;
  elements.action.hidden = !lastTrack;
  elements.lossScore.textContent = String(score).padStart(4, '0');
  if (!won) elements.action.innerHTML = 'TRY AGAIN <span>↗</span>';
  if (won && track) {
    elements.winArtwork.src = track.artwork || '/icons/icon-192.png';
    elements.winTrack.textContent = track.title;
    elements.winArtist.textContent = track.artist;
    elements.winScore.textContent = String(score).padStart(4, '0');
  }
  showOverlay(won ? 'THAT WAS A WHOLE VIBE' : 'ROUND OVER', won ? 'You did it!' : 'Out of hearts!',
    won ? 'You made it to the end of the song.' : 'Tap TRY AGAIN to take another shot at this song.', !won);
  elements.continue.hidden = !won;
}

function scoreBeat(beat, elapsed) {
  beat.hit = true;
  beat.holding = false;
  beat.element?.remove();
  const perfect = Math.abs(beat.time - elapsed) < 0.09;
  const points = Math.round((beat.hold ? 150 : perfect ? 100 : 50) * round.multiplier);
  round.score += points;
  overallScore += points;
  updateStats();
  updateOverallScore();
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

function press(lane, point) {
  if (!round) return;
  const elapsed = round.clock();
  const candidates = round.beats
    .filter(item => !item.hit && !item.missed && !item.holding && item.lane === lane &&
      isWithinHitWindow(item.time, elapsed, round.window))
    .sort((a, b) => Math.abs(a.time - elapsed) - Math.abs(b.time - elapsed));
  const bubbleBeat = point && round.beats
    .filter(item => !item.hit && !item.missed && !item.holding && item.element &&
      isPointInExpandedRect(point, item.element.getBoundingClientRect(), 44))
    .sort((a, b) => {
      const rectA = a.element.getBoundingClientRect();
      const rectB = b.element.getBoundingClientRect();
      return Math.hypot(point.x - (rectA.left + rectA.width / 2), point.y - (rectA.top + rectA.height / 2)) -
        Math.hypot(point.x - (rectB.left + rectB.width / 2), point.y - (rectB.top + rectB.height / 2));
    })[0];
  const beat = bubbleBeat || candidates[0];
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
    return beat.lane;
  }
  scoreBeat(beat, elapsed);
  return beat.lane;
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
    const motion = tileMotion(hitY, remaining, round.speed, beat.hold || 0);
    if (remaining <= motion.leadTime && remaining >= -round.window - (beat.hold || 0)) {
      if (!beat.element) {
        beat.element = document.createElement('div');
        beat.element.className = `tile tile-${beat.lane}${beat.hold ? ' tile-hold' : ''}`;
        if (EMOJI_IMAGES[preferences.emoji]) {
          const icon = document.createElement('img');
          icon.className = 'tile-emoji';
          icon.src = EMOJI_IMAGES[preferences.emoji];
          icon.alt = '';
          beat.element.append(icon);
          if (beat.hold) {
            const label = document.createElement('span');
            label.textContent = 'HOLD';
            beat.element.append(label);
          }
        } else beat.element.textContent = beat.hold ? `${preferences.emoji} HOLD` : preferences.emoji;
        beat.height = motion.height;
        beat.element.style.height = `${beat.height}px`;
        elements.tiles.append(beat.element);
      }
      beat.element.style.top = `${motion.top}px`;
    }
  }
  if (!round) return;
  if (elapsed >= round.duration) return finish(true);
  round.frame = requestAnimationFrame(tick);
}

async function startTrack(track) {
  clearRound();
  document.body.classList.remove('result-screen');
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
  elements.lossResult.hidden = true;
  elements.continue.hidden = true;
  elements.action.innerHTML = 'PLAY IT AGAIN <span>↗</span>';
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
      duration = Number.isFinite(element.duration) ? element.duration : Number.POSITIVE_INFINITY;
      const fallbackLength = Number.isFinite(duration) ? duration : Math.max(180, (track.duration || 0) / 1000);
      beats = applyDifficulty(syntheticBeats(fallbackLength), difficulty, holdTiles);
      clock = () => element.currentTime;
    }
    if (current !== generation) {
      if (source) try { source.stop(); } catch { /* already stopped */ }
      if (element) element.pause();
      return;
    }
    round = { source, element, track, duration, beats, clock, score: 0, lives: 3, frame: 0, speed: TILE_SPEEDS[preferences.speed], window: cfg.window, multiplier: cfg.score };
    if (element) {
      if (Number.isFinite(element.duration)) round.duration = element.duration;
      element.addEventListener('loadedmetadata', () => {
        if (round?.element === element && Number.isFinite(element.duration)) round.duration = element.duration;
      }, { once: true });
      element.addEventListener('ended', () => {
        if (round?.element === element) finish(true);
      }, { once: true });
    }
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
    duration: track.trackTimeMillis ?? track.duration,
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
    history.unshift({ title: track.title, artist: track.artist, artwork: track.artwork, preview: track.preview, duration: track.duration, score });
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
  elements.historyList.replaceChildren();
  if (!history.length) {
    const emptyMessage = document.createElement('p');
    emptyMessage.className = 'list-message';
    emptyMessage.textContent = 'No plays yet. Your recent songs will show up here.';
    elements.historyList.append(emptyMessage);
    return;
  }
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

const libraryTabs = [$('#search-tab'), $('#history-tab')];
const libraryPanels = [$('#search-panel'), $('#history-panel')];
function activateLibraryTab(index, focus = false) {
  libraryTabs.forEach((tab, tabIndex) => {
    const selected = tabIndex === index;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    libraryPanels[tabIndex].hidden = !selected;
  });
  if (focus) libraryTabs[index].focus();
}
libraryTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateLibraryTab(index));
  tab.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      activateLibraryTab((index + 1) % libraryTabs.length, true);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      activateLibraryTab((index + libraryTabs.length - 1) % libraryTabs.length, true);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      activateLibraryTab(event.key === 'Home' ? 0 : libraryTabs.length - 1, true);
    }
  });
});

elements.form.addEventListener('submit', event => {
  event.preventDefault();
  const term = elements.input.value.trim();
  if (term) search(term);
});
elements.action.addEventListener('click', () => {
  if (lastTrack) startTrack(lastTrack);
});
elements.continue.addEventListener('click', () => {
  document.body.classList.remove('result-screen');
  elements.overlay.hidden = true;
  elements.winResult.hidden = true;
  elements.continue.hidden = true;
  elements.status.textContent = 'READY WHEN YOU ARE';
});
elements.stop.addEventListener('click', () => {
  document.body.classList.remove('result-screen');
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

const settingsScreen = $('#settings-screen');
const settingsTrigger = $('#settings-trigger');
const settingGroups = [...document.querySelectorAll('[data-setting]')];
const customThemeControls = $('#custom-theme-controls');
const customColorInputs = [...document.querySelectorAll('[data-custom-color]')];
let draftPreferences = { ...preferences, customColors: { ...preferences.customColors } };
function applyTheme(values = preferences) {
  document.body.dataset.theme = values.theme;
  Object.entries(values.customColors || DEFAULT_CUSTOM_COLORS).forEach(([name, color]) => {
    document.body.style.setProperty(`--custom-${name}`, color);
  });
}
function renderSettings(values) {
  settingGroups.forEach(group => group.querySelectorAll('button').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.value === values[group.dataset.setting]));
  }));
  customThemeControls.hidden = values.theme !== 'custom';
  customColorInputs.forEach(input => {
    input.value = values.customColors?.[input.dataset.customColor] || DEFAULT_CUSTOM_COLORS[input.dataset.customColor];
  });
}
function closeSettings() {
  settingsScreen.hidden = true;
  document.body.classList.remove('settings-open');
  settingsTrigger.focus();
}
function openSettings() {
  draftPreferences = { ...preferences, customColors: { ...preferences.customColors } };
  renderSettings(draftPreferences);
  settingsScreen.hidden = false;
  document.body.classList.add('settings-open');
  $('#settings-back').focus();
}
settingGroups.forEach(group => group.addEventListener('click', event => {
  const button = event.target.closest('button[data-value]');
  if (!button) return;
  draftPreferences[group.dataset.setting] = button.dataset.value;
  renderSettings(draftPreferences);
}));
customColorInputs.forEach(input => input.addEventListener('input', () => {
  draftPreferences.customColors[input.dataset.customColor] = input.value;
}));
settingsTrigger.addEventListener('click', openSettings);
$('#settings-back').addEventListener('click', closeSettings);
$('#settings-cancel').addEventListener('click', closeSettings);
$('#settings-save').addEventListener('click', () => {
  preferences = { ...draftPreferences, customColors: { ...draftPreferences.customColors } };
  applyTheme(preferences);
  try { localStorage.setItem('mnc-settings', JSON.stringify(preferences)); } catch { /* storage unavailable */ }
  closeSettings();
});
applyTheme();
updateOverallScore();
window.addEventListener('keydown', event => {
  if (settingsScreen.hidden) return;
  if (event.key === 'Escape') {
    closeSettings();
    return;
  }
  if (event.key === 'Tab') {
    const focusable = [...settingsScreen.querySelectorAll('button:not([disabled])')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
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
  const hitLane = press(lane, { x: event.clientX, y: event.clientY });
  activePointers.set(event.pointerId, hitLane ?? lane);
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
  if (event.repeat || !settingsScreen.hidden || event.target.matches('input, textarea, select, [contenteditable="true"]')) return;
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
