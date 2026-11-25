// HeldixClient – Webseite: Capes in 3D (/capes) mit skinview3d (three.js, WebGL).
// Jede Cape-Textur enthält 24 Bilder untereinander (je 512×256 im üblichen Cape-Format). Das aktuelle Bild wird auf
// ein Canvas geschnitten (mit Leuchtebene, falls vorhanden) und an die Figur gegeben. Langsames Drehen, Ziehen zum
// Drehen, Elytra-Ansicht. Mit Anmeldung: „Mit meinem Skin anprobieren“ über /api/v1/skins/<uuid>.
import { api, toast } from './app-common.js';

const FRAME_W = 512;
const FRAME_H = 256;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const host = document.getElementById('cape-viewer');
const canvas = document.getElementById('cape-canvas');
const picker = document.getElementById('cape-auswahl');
const buttons = [...picker.querySelectorAll('.cape-pick')];
const elytraButton = document.getElementById('cape-elytra');
const animButton = document.getElementById('cape-animation');
const skinButton = document.getElementById('cape-mein-skin');

const frameCanvas = document.createElement('canvas');
frameCanvas.width = FRAME_W;
frameCanvas.height = FRAME_H;
const frameContext = frameCanvas.getContext('2d');

const state = { cape: null, image: null, glow: null, frames: 24, fps: 10, frame: 0, timer: 0, playing: !reduceMotion, elytra: false, visible: true, loadToken: 0, ownSkin: null, wearingOwn: false };
let viewer = null;
let pushedOnce = false;

function createViewer() {
  const lib = window.skinview3d;
  if (!lib) return null;
  try {
    const created = new lib.SkinViewer({ canvas, width: host.clientWidth || 480, height: host.clientHeight || 520, skin: '/assets/standard-skin.png', fov: 40, zoom: 0.66 });
    created.autoRotate = !reduceMotion;
    created.autoRotateSpeed = 0.55;
    created.playerWrapper.rotation.y = Math.PI * 0.82; // Rücken zeigen: da hängt das Cape
    const controls = created.controls;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.minPolarAngle = Math.PI * 0.32;
    controls.maxPolarAngle = Math.PI * 0.62;
    controls.addEventListener('start', () => {
      created.autoRotate = false;
      document.getElementById('viewer-hinweis').hidden = true;
    });
    if (!reduceMotion && lib.IdleAnimation) created.animation = new lib.IdleAnimation();
    new ResizeObserver(() => {
      if (host.clientWidth > 0 && host.clientHeight > 0) created.setSize(host.clientWidth, host.clientHeight);
    }).observe(host);
    return created;
  } catch {
    return null;
  }
}

function drawFrame() {
  const { image, glow, frames, frame } = state;
  if (!image) return;
  const sourceHeight = image.naturalHeight / frames;
  frameContext.clearRect(0, 0, FRAME_W, FRAME_H);
  frameContext.globalCompositeOperation = 'source-over';
  frameContext.drawImage(image, 0, frame * sourceHeight, image.naturalWidth, sourceHeight, 0, 0, FRAME_W, FRAME_H);
  if (glow) {
    const glowHeight = glow.naturalHeight / frames;
    frameContext.globalCompositeOperation = 'lighter';
    frameContext.drawImage(glow, 0, frame * glowHeight, glow.naturalWidth, glowHeight, 0, 0, FRAME_W, FRAME_H);
    frameContext.globalCompositeOperation = 'source-over';
  }
}

/** Bild an die Figur geben. Schneller Weg: direkt in die Cape-Leinwand von skinview3d zeichnen. */
function pushFrame(force = false) {
  if (!viewer) return;
  const options = { backEquipment: state.elytra ? 'elytra' : 'cape' };
  const target = viewer.capeCanvas;
  const texture = viewer.capeTexture;
  if (!force && pushedOnce && target && texture && target.width === FRAME_W && target.height === FRAME_H) {
    const context = target.getContext('2d');
    context.clearRect(0, 0, FRAME_W, FRAME_H);
    context.drawImage(frameCanvas, 0, 0);
    texture.needsUpdate = true;
    return;
  }
  viewer.loadCape(frameCanvas, options);
  pushedOnce = true;
}

function stopTimer() {
  window.clearInterval(state.timer);
  state.timer = 0;
}

function startTimer() {
  stopTimer();
  if (!state.playing || !state.visible || !state.image || document.hidden) return;
  state.timer = window.setInterval(() => {
    state.frame = (state.frame + 1) % state.frames;
    drawFrame();
    pushFrame();
  }, Math.max(40, Math.round(1000 / state.fps)));
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', reject);
    image.src = src;
  });
}

async function selectCape(button, { focus = false } = {}) {
  for (const other of buttons) {
    const active = other === button;
    other.setAttribute('aria-checked', String(active));
    other.tabIndex = active ? 0 : -1;
  }
  if (focus) button.focus();
  const { cape, name, beschreibung, frames, fps, glow } = button.dataset;
  document.getElementById('cape-name').textContent = name;
  document.getElementById('cape-beschreibung').textContent = beschreibung;
  document.getElementById('cape-meta').textContent = `${frames} Bilder, ${fps} pro Sekunde${glow === '1' ? ' · leuchtet im Dunkeln' : ''}`;
  host.dataset.cape = cape;
  if (!viewer) return;
  const token = ++state.loadToken;
  host.classList.add('loading');
  try {
    const [image, glowImage] = await Promise.all([loadImage(`/capes/${cape}.png`), glow === '1' ? loadImage(`/capes/${cape}_glow.png`).catch(() => null) : null]);
    if (token !== state.loadToken) return;
    Object.assign(state, { cape, image, glow: glowImage, frames: Number(frames) || 1, fps: Number(fps) || 10, frame: 0 });
    drawFrame();
    pushFrame(true);
    host.dataset.geladen = cape;
    startTimer();
  } catch {
    if (token === state.loadToken) toast('Dieses Cape ließ sich gerade nicht laden.', 'error');
  } finally {
    if (token === state.loadToken) host.classList.remove('loading');
  }
}

function setupPicker() {
  picker.addEventListener('click', (event) => {
    const button = event.target.closest('.cape-pick');
    if (button) selectCape(button);
  });
  picker.addEventListener('keydown', (event) => {
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    let next = null;
    if (step) next = buttons[(index + step + buttons.length) % buttons.length];
    else if (event.key === 'Home') next = buttons[0];
    else if (event.key === 'End') next = buttons[buttons.length - 1];
    if (!next) return;
    event.preventDefault();
    selectCape(next, { focus: true });
  });
}

function setupControls() {
  elytraButton.addEventListener('click', () => {
    state.elytra = !state.elytra;
    elytraButton.setAttribute('aria-pressed', String(state.elytra));
    pushFrame(true);
  });
  const updateAnimButton = () => {
    animButton.setAttribute('aria-pressed', String(state.playing));
    animButton.querySelector('span').textContent = state.playing ? 'Animation anhalten' : 'Animation abspielen';
  };
  animButton.addEventListener('click', () => {
    state.playing = !state.playing;
    if (viewer && !reduceMotion) viewer.autoRotate = state.playing;
    updateAnimButton();
    startTimer();
  });
  updateAnimButton();
  // Nur rechnen, wenn man die Figur sieht
  new IntersectionObserver((entries) => {
    state.visible = entries.some((entry) => entry.isIntersecting);
    if (viewer) viewer.renderPaused = !state.visible || document.hidden;
    startTimer();
  }).observe(host);
  document.addEventListener('visibilitychange', () => {
    if (viewer) viewer.renderPaused = !state.visible || document.hidden;
    startTimer();
  });
}

async function offerOwnSkin() {
  let me;
  try {
    me = await api('GET', '/v1/web/me');
  } catch {
    return; // nicht angemeldet: Knopf bleibt versteckt
  }
  if (!me?.uuid) return;
  skinButton.hidden = false;
  skinButton.addEventListener('click', async () => {
    if (!viewer) return;
    skinButton.disabled = true;
    try {
      if (state.wearingOwn) {
        await viewer.loadSkin('/assets/standard-skin.png');
        state.wearingOwn = false;
      } else {
        await viewer.loadSkin(`/api/v1/skins/${encodeURIComponent(me.uuid)}`, { model: 'auto-detect' });
        state.wearingOwn = true;
      }
      skinButton.querySelector('span').textContent = state.wearingOwn ? 'Standard-Skin' : 'Mit meinem Skin anprobieren';
      host.dataset.skin = state.wearingOwn ? 'eigener' : 'standard';
    } catch {
      toast('Dein Skin ist gerade nicht abrufbar. Er erscheint, sobald du einmal mit HeldixClient gespielt hast.', 'error');
    } finally {
      skinButton.disabled = false;
    }
  });
}

viewer = createViewer();
host.dataset.webgl = viewer ? 'ja' : 'nein';
if (!viewer) {
  canvas.hidden = true;
  document.getElementById('viewer-hinweis').hidden = true;
  document.getElementById('viewer-ersatz').hidden = false;
  for (const button of [elytraButton, animButton]) button.hidden = true;
}
if (reduceMotion) document.getElementById('viewer-hinweis').textContent = 'Ziehen zum Drehen · Animation mit „Animation abspielen“';
setupPicker();
setupControls();
selectCape(buttons.find((button) => button.getAttribute('aria-checked') === 'true') ?? buttons[0]);
offerOwnSkin();
