const cta = document.querySelector('#install-cta');
const headerButton = document.querySelector('#header-install');
const note = document.querySelector('#install-note');
const buttons = [cta, headerButton];

// Already installed and launched from the home screen? Go straight to the game.
if (window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    navigator.standalone === true) {
  window.location.replace('/play');
}

// Highlight the instructions matching the visitor's device.
const ua = navigator.userAgent;
const platform = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  ? 'ios'
  : /Android/.test(ua) ? 'android' : 'desktop';
document.querySelector(`[data-platform="${platform}"]`)?.classList.add('recommended');

let installPrompt;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  buttons.forEach(button => { if (button) button.hidden = false; });
  if (note) note.textContent = 'Your browser supports one-tap install — just hit the button!';
});

buttons.forEach(button => button?.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  const choice = await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  buttons.forEach(item => { if (item) item.hidden = true; });
  if (choice?.outcome !== 'accepted' && note) note.textContent = 'No worries — you can install anytime, or play in your browser below.';
}));

// After a successful install, take the player to the game.
window.addEventListener('appinstalled', () => {
  window.location.href = '/play';
});
