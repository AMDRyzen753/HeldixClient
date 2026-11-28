// Skins & Cosmetics (#view-profile, Inhalt in #profile-root). Daten: api.getProfile(), api.getCosmetics() und die
// Skin-/Cape-/Cosmetic-Methoden.
//
// Links eine große 3D-Figur (skinview3d wie auf der Startseite, siehe figure.ts) mit Skin, Cape und Cosmetics. Fahren
// über einen Skin, ein Cape oder ein Cosmetic zeigt es sofort an der Figur (Vorschau); erst „Anwenden“ bzw. ein Klick
// auf ein Cape oder Cosmetic ändert etwas. Rechts die Reiter „Skins“ (eigene Sammlung im Datenordner), „Capes“
// (Heldix-Capes – eingebaute und aus dem Katalog –, Minecraft-Capes des Kontos) und „Cosmetics“ (Kopf, Rücken, Aura,
// Begleiter aus dem Katalog des Heldix-Dienstes; Modelle zeichnet cosmetic-scene.ts).
//
// Gesperrt sind Team-Einträge (Konto sicher nicht im Team) und Belohnungen (access „unlock“, z. B. Freundesfunken und
// Freundesband für Einladungen), solange ihre ID nicht in cosmetics.unlocked steht. Belohnungen tragen das Kennzeichen
// „Belohnung“; ein Klick auf eine gesperrte Belohnung und der Knopf .profile-invite-jump führen zu Freunde → Einladen.
//
// Cosmetics im Format 2 (animierte Meshes) haben mehrere Animationen: Unter der Figur stehen sie als Leiste (Namen aus
// dem Manifest, Standard: Zustand idle) für das überfahrene bzw. zuletzt gewählte Format-2-Cosmetic; beim Überfahren
// einer Kachel spielt es sein Emote. Angehalten (Knopf oder „Bewegung reduzieren“) zeigt die Figur ein Standbild.
//
// Heldix-Capes: capes/<id>.png enthält alle Bilder der Animation untereinander (je 512 × 256 = 8 × Cape-Vorlage 64 × 32),
// capes/<id>_glow.png die Leuchtebene (je 256 × 128). Wie auf der Webseite (website/src/capes.js) wird das aktuelle Bild
// auf ein Canvas geschnitten, die Leuchtebene darübergelegt und das Ergebnis an die Figur gegeben. Capes aus dem Katalog
// (signiert, 64/128/256 breit) laufen genauso, nur kommt das Bild als data:-URL und die Leuchtebene liegt darüber
// (wie die Vorschau der Cosmetics) statt addiert zu werden.
import type {
  CosmeticItem,
  CosmeticModelSlot,
  CosmeticSlotName,
  CosmeticsState,
  HeldixCape,
  MojangCape,
  ProfileState,
  SavedSkin,
  SkinVariant,
} from '../shared/api';
import { CosmeticRig, CosmeticThumbnails, type RigViewer } from './cosmetic-scene.js';
import { api, confirmDialog, errorMessage, h, state, toast, uiIcon } from './core.js';

// ---------- skinview3d (nur die Teile, die hier gebraucht werden) ----------
interface ViewerAnimation {
  speed: number;
}
interface ViewerControls {
  enableZoom: boolean;
  enablePan: boolean;
  minPolarAngle: number;
  maxPolarAngle: number;
  rotateSpeed: number;
  getAzimuthalAngle(): number;
  addEventListener(type: 'start' | 'end', listener: () => void): void;
}
type BackEquipment = 'cape' | 'elytra';
interface Viewer {
  animation: ViewerAnimation | null;
  autoRotate: boolean;
  autoRotateSpeed: number;
  renderPaused: boolean;
  readonly controls: ViewerControls;
  readonly playerWrapper: { rotation: { y: number } };
  readonly playerObject: { backEquipment: BackEquipment | null };
  readonly capeCanvas: HTMLCanvasElement;
  /** intern in skinview3d; zum schnellen Nachzeichnen der Cape-Animation (wie auf der Webseite) */
  readonly capeTexture?: { needsUpdate: boolean } | null;
  loadSkin(source: HTMLImageElement | null, options?: { model?: 'default' | 'slim' }): void;
  loadCape(source: HTMLImageElement | HTMLCanvasElement | null, options?: { backEquipment?: BackEquipment }): void;
  setSize(width: number, height: number): void;
}
interface ViewerLib {
  SkinViewer: new (options: { canvas: HTMLCanvasElement; width: number; height: number; fov?: number; zoom?: number }) => Viewer;
  IdleAnimation: new () => ViewerAnimation;
}

// ---------- Konstanten ----------
/** ein Bild eines Heldix-Capes (8 × Cape-Vorlage 64 × 32) */
const FRAME_W = 512;
const FRAME_H = 256;
/** Vorschaubild: Außenseite des Capes (10 × 16 Pixel der Vorlage ab 1,1), 8-fach */
const THUMB_W = 80;
const THUMB_H = 128;
/** Ids landen in Dateipfaden (capes/<id>.png) */
const SAFE_ID = /^[a-z0-9_-]{1,40}$/;
/** Drehung der Figur: leicht seitlich von vorn (Skins) bzw. von hinten (Capes) */
const FRONT_ANGLE = 0.5;
const BACK_ANGLE = Math.PI - 0.55;
/** Format-2-Begleiter sitzen links (bzw. rechts) am Körper: schräg von vorn auf diese Seite */
const LEFT_ANGLE = -0.75;
const RIGHT_ANGLE = 0.75;

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---------- Zustand ----------
type Tab = 'skins' | 'capes' | 'cosmetics';
/** heldix = eingebautes Heldix-Cape, catalog = Cape aus dem Cosmetics-Katalog */
type CapeChoice = { kind: 'none' } | { kind: 'mojang'; id: string } | { kind: 'heldix'; id: string } | { kind: 'catalog'; id: string };
const NO_CAPE: CapeChoice = { kind: 'none' };
/** Vorschau eines Cosmetics beim Überfahren (id null = Slot leer) */
type CosmeticHover = { slot: CosmeticModelSlot; id: string | null };
const MODEL_SLOTS: readonly CosmeticModelSlot[] = ['head', 'back', 'aura', 'companion'];
const SLOT_INFO: Record<CosmeticModelSlot, { title: string; text: string; none: string; removed: string }> = {
  head: { title: 'Kopf', text: 'Hüte, Kronen und mehr – sitzt auf deinem Kopf und bewegt sich mit.', none: 'Nichts', removed: 'Kopfschmuck abgelegt.' },
  back: { title: 'Rücken', text: 'Flügel und mehr – passt auch zu Cape und Elytra.', none: 'Nichts', removed: 'Rückenteil abgelegt.' },
  aura: { title: 'Aura', text: 'Effekte rund um dich – schwebende Partikel oder animierte Kreise am Boden.', none: 'Keine Aura', removed: 'Aura abgelegt.' },
  companion: { title: 'Begleiter', text: 'Ein kleiner Begleiter, der neben dir schwebt.', none: 'Kein Begleiter', removed: 'Begleiter abgelegt.' },
};

const page = {
  profile: null as ProfileState | null,
  /** Laden ist fehlgeschlagen und es gibt noch keine Daten */
  failure: null as string | null,
  loading: false,
  stale: true,
  loadedAt: 0,
  loadSeq: 0,
  /** aktives Konto beim letzten Laden (null = noch nie geladen) */
  accountKey: null as string | null,
  tab: 'skins' as Tab,
  /** laufende Änderung bei Mojang bzw. beim Heldix-Dienst, z. B. "skin:<id>", "reset", "mojang:<id>", "heldix:none" */
  busy: null as string | null,
  importing: false,
  /** angeklickter Skin, der an der Figur bleibt */
  pinnedSkin: null as string | null,
  hoverSkin: null as string | null,
  hoverCape: null as CapeChoice | null,
  hoverCosmetic: null as CosmeticHover | null,
  /** Katalog und eigene Auswahl (null = noch nicht geladen) */
  cosmetics: null as CosmeticsState | null,
  cosmeticsLoading: false,
  cosmeticsSeq: 0,
  elytra: false,
  motion: !reduceMotion.matches,
  active: false,
  renaming: false,
  /** Format 2: Slot, dessen Animationen die Leiste zeigt (zuletzt gewählt oder angeklickt) */
  animSlot: null as CosmeticModelSlot | null,
  /** Format 2: gewählte Animation je Cosmetic (id:sha256) */
  anims: new Map<string, string>(),
};

interface Ui {
  root: HTMLElement;
  sub: HTMLElement;
  main: HTMLElement;
  scroll: HTMLElement;
  tabSkins: HTMLButtonElement;
  tabCapes: HTMLButtonElement;
  tabCosmetics: HTMLButtonElement;
  skinCount: HTMLElement;
  actions: HTMLElement;
  addButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  stageView: HTMLElement;
  canvas: HTMLCanvasElement;
  fallback: HTMLCanvasElement;
  hint: HTMLElement;
  tag: HTMLButtonElement;
  motion: HTMLButtonElement;
  stageName: HTMLElement;
  stageSub: HTMLElement;
  elytra: HTMLButtonElement;
  /** Format 2: Auswahl der Animation unter der Figur */
  anims: HTMLElement;
}
let ui: Ui | null = null;

// ---------- Hilfen ----------
function canEdit(p: ProfileState | null = page.profile): boolean {
  return !!p && p.account?.type === 'microsoft' && p.canEditSkin;
}

/** Warum Skin und Minecraft-Cape gerade nicht änderbar sind (null = änderbar) */
function lockReason(p: ProfileState | null = page.profile): string | null {
  if (!p || !p.account) return 'Nicht angemeldet';
  if (p.account.type === 'offline') return 'Nur mit Microsoft-Konto';
  if (!p.canEditSkin) return 'Anmeldung abgelaufen – starte einmal das Spiel oder melde dich neu an';
  return null;
}

function activeAccountKey(): string {
  return state.accounts.find((a) => a.active)?.id ?? '';
}

function choiceKey(choice: CapeChoice): string {
  return choice.kind === 'none' ? 'none' : `${choice.kind}:${choice.id}`;
}

/** eingebautes Heldix-Cape (capes/<id>.png) */
function builtinCape(id: string): HeldixCape | undefined {
  return page.profile?.heldixCapes.find((c) => c.id === id && SAFE_ID.test(c.id));
}

/** Cosmetic aus dem Katalog (geprüft); slot = nur in diesem Slot */
function cosmeticItem(id: string | null | undefined, slot?: CosmeticSlotName): CosmeticItem | undefined {
  if (!id) return undefined;
  return page.cosmetics?.items.find((i) => i.id === id && (!slot || i.slot === slot));
}

/** Cape aus dem Katalog */
function catalogCapeItem(id: string | null | undefined): CosmeticItem | undefined {
  const item = cosmeticItem(id, 'cape');
  return item?.cape ? item : undefined;
}

/** Cosmetic nur fürs Team, und das Konto ist sicher nicht im Team */
function teamLocked(item: CosmeticItem): boolean {
  return item.teamOnly && page.cosmetics?.team === false;
}

const REWARD_LOCK = 'Belohnung für Einladungen – lade Freunde ein, um es freizuschalten';

/** Belohnung (access „unlock“), die das Konto noch nicht freigeschaltet hat */
function rewardLocked(item: CosmeticItem): boolean {
  return item.unlockOnly && !(page.cosmetics?.unlocked ?? []).includes(item.id);
}

/** warum eine Katalog-Kachel gesperrt ist (Team, Belohnung), sonst null */
function itemLock(item: CosmeticItem): string | null {
  if (teamLocked(item)) return 'nur für das HeldixClient-Team';
  if (rewardLocked(item)) return REWARD_LOCK;
  return null;
}

/** Sprung zu Freunde → Einladen (setzt app.ts über initProfile) */
let openInvites: () => void = () => undefined;

function sortedLibrary(p: ProfileState): SavedSkin[] {
  return [...p.library].sort((a, b) => b.addedAt - a.addedAt);
}

function spinner(): HTMLElement {
  return h('span', { class: 'profile-spinner', 'aria-hidden': 'true' });
}

// ---------- Bilder ----------
const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(src: string, cache = true): Promise<HTMLImageElement> {
  const cached = cache ? imageCache.get(src) : undefined;
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Bild nicht ladbar'));
    image.src = src;
  });
  if (cache) {
    imageCache.set(src, promise);
    promise.catch(() => imageCache.delete(src));
  }
  return promise;
}

/** Nur Bilder behalten, die die Seite noch zeigt (Skins der Sammlung, aktueller Skin, Minecraft-Capes). */
function pruneImages(p: ProfileState): void {
  const keep = new Set<string>([...p.library.map((s) => s.dataUrl), ...p.mojangCapes.map((c) => c.dataUrl ?? '')]);
  if (p.skin) keep.add(p.skin.dataUrl);
  for (const key of imageCache.keys()) if (!keep.has(key)) imageCache.delete(key);
}

interface CapeImages {
  image: HTMLImageElement;
  glow: HTMLImageElement | null;
}

/** Ein Heldix-Cape: eingebaut (capes/<id>.png) oder aus dem Katalog (data:-URL, 64, 128 oder 256 breit) */
interface CapeDef {
  /** "heldix:<id>" bzw. "catalog:<id>:<sha256>" */
  key: string;
  frames: number;
  fps: number;
  /** Leuchtebene addieren (eingebaut, wie auf der Webseite) oder darüberlegen (Katalog, wie die Cosmetics-Vorschau) */
  glowMode: 'lighter' | 'source-over';
  load(): Promise<CapeImages>;
}

function builtinDef(cape: HeldixCape): CapeDef {
  return {
    key: `heldix:${cape.id}`,
    frames: cape.frames,
    fps: cape.fps,
    glowMode: 'lighter',
    load: () =>
      Promise.all([
        loadImage(`capes/${cape.id}.png`, false),
        cape.glow ? loadImage(`capes/${cape.id}_glow.png`, false).catch(() => null) : Promise.resolve(null),
      ]).then(([image, glow]) => ({ image, glow })),
  };
}

function catalogDef(item: CosmeticItem): CapeDef {
  return {
    key: `catalog:${item.id}:${item.sha256}`,
    frames: item.cape?.frames ?? 1,
    fps: item.cape?.fps ?? 10,
    glowMode: 'source-over',
    load: () =>
      Promise.all([loadImage(item.texture, false), item.glow ? loadImage(item.glow, false).catch(() => null) : Promise.resolve(null)]).then(([image, glow]) => ({ image, glow })),
  };
}

function capeDef(choice: CapeChoice): CapeDef | undefined {
  if (choice.kind === 'heldix') {
    const cape = builtinCape(choice.id);
    return cape ? builtinDef(cape) : undefined;
  }
  if (choice.kind === 'catalog') {
    const item = catalogCapeItem(choice.id);
    return item ? catalogDef(item) : undefined;
  }
  return undefined;
}

/** Ganze Cape-Bilder für die Figur (groß: höchstens drei behalten) */
const heldixCache = new Map<string, Promise<CapeImages>>();

function heldixImages(cape: CapeDef): Promise<CapeImages> {
  let promise = heldixCache.get(cape.key);
  if (promise) {
    heldixCache.delete(cape.key);
  } else {
    promise = cape.load();
    promise.catch(() => heldixCache.delete(cape.key));
  }
  heldixCache.set(cape.key, promise);
  while (heldixCache.size > 3) {
    const oldest = heldixCache.keys().next().value;
    if (oldest === undefined) break;
    heldixCache.delete(oldest);
  }
  return promise;
}

/** Alte 64×32-Skins: Ist die Hut-Ebene ganz deckend, blendet Minecraft sie aus. */
const legacyHatVisible = new WeakMap<HTMLImageElement, boolean>();

function hatVisible(image: HTMLImageElement): boolean {
  const known = legacyHatVisible.get(image);
  if (known !== undefined) return known;
  let visible = true;
  try {
    const scale = image.naturalWidth / 64;
    const probe = document.createElement('canvas');
    probe.width = Math.round(32 * scale);
    probe.height = Math.round(16 * scale);
    const context = probe.getContext('2d', { willReadFrequently: true });
    if (context) {
      context.drawImage(image, 32 * scale, 0, 32 * scale, 16 * scale, 0, 0, probe.width, probe.height);
      const data = context.getImageData(0, 0, probe.width, probe.height).data;
      visible = false;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 128) {
          visible = true;
          break;
        }
      }
    }
  } catch {
    visible = true;
  }
  legacyHatVisible.set(image, visible);
  return visible;
}

/**
 * Vorderansicht eines Skins als 16 × 32 Pixel: Kopf, Körper, Arme und Beine mit der äußeren Ebene darüber.
 * Alte 64×32-Skins haben keine eigenen linken Gliedmaßen – dann wie in Minecraft die rechten gespiegelt.
 */
function drawSkinFront(canvas: HTMLCanvasElement, image: HTMLImageElement, variant: SkinVariant): void {
  canvas.width = 16;
  canvas.height = 32;
  const context = canvas.getContext('2d');
  if (!context || !image.naturalWidth) return;
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, 16, 32);
  const s = image.naturalWidth / 64;
  const legacy = image.naturalHeight * 2 === image.naturalWidth;
  const arm = variant === 'slim' ? 3 : 4;
  const part = (sx: number, sy: number, w: number, hgt: number, dx: number, dy: number, mirror = false) => {
    if (mirror) {
      context.save();
      context.translate(dx + w, dy);
      context.scale(-1, 1);
      context.drawImage(image, sx * s, sy * s, w * s, hgt * s, 0, 0, w, hgt);
      context.restore();
    } else {
      context.drawImage(image, sx * s, sy * s, w * s, hgt * s, dx, dy, w, hgt);
    }
  };
  // innere Ebene
  part(8, 8, 8, 8, 4, 0); // Kopf
  part(20, 20, 8, 12, 4, 8); // Körper
  part(44, 20, arm, 12, 4 - arm, 8); // rechter Arm (links im Bild)
  if (legacy) part(44, 20, arm, 12, 12, 8, true);
  else part(36, 52, arm, 12, 12, 8); // linker Arm
  part(4, 20, 4, 12, 4, 20); // rechtes Bein
  if (legacy) part(4, 20, 4, 12, 8, 20, true);
  else part(20, 52, 4, 12, 8, 20); // linkes Bein
  // äußere Ebene
  if (!legacy || hatVisible(image)) part(40, 8, 8, 8, 4, 0);
  if (!legacy) {
    part(20, 36, 8, 12, 4, 8);
    part(44, 36, arm, 12, 4 - arm, 8);
    part(52, 52, arm, 12, 12, 8);
    part(4, 36, 4, 12, 4, 20);
    part(4, 52, 4, 12, 8, 20);
  }
}

function paintSkin(canvas: HTMLCanvasElement, dataUrl: string, variant: SkinVariant): void {
  loadImage(dataUrl)
    .then((image) => drawSkinFront(canvas, image, variant))
    .catch(() => canvas.classList.add('broken'));
}

/** Außenseite eines Minecraft-Capes (10 × 16 Pixel) */
function paintMojangCape(canvas: HTMLCanvasElement, cape: MojangCape): void {
  if (!cape.dataUrl) return;
  loadImage(cape.dataUrl)
    .then((image) => {
      const context = canvas.getContext('2d');
      if (!context) return;
      const s = image.naturalWidth / 64;
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, s, s, 10 * s, 16 * s, 0, 0, canvas.width, canvas.height);
    })
    .catch(() => undefined);
}

// ---------- Vorschaubilder der Heldix-Capes ----------
/** je Cape alle Bilder der Außenseite untereinander (klein, damit die großen Bilder nicht im Speicher bleiben) */
const strips = new Map<string, HTMLCanvasElement>();
let stripsRunning = false;
const thumbs: { canvas: HTMLCanvasElement; cape: CapeDef; frame: number }[] = [];
let thumbRaf = 0;

function buildStrip(cape: CapeDef, { image, glow }: CapeImages): HTMLCanvasElement {
  const frames = Math.max(1, cape.frames);
  const strip = document.createElement('canvas');
  strip.width = THUMB_W;
  strip.height = THUMB_H * frames;
  const context = strip.getContext('2d');
  if (!context) return strip;
  // Katalog-Capes sind kleiner (64–256 breit): Pixel scharf vergrößern
  context.imageSmoothingEnabled = false;
  const frameHeight = image.naturalHeight / frames;
  const s = image.naturalWidth / 64;
  const glowHeight = glow ? glow.naturalHeight / frames : 0;
  const gs = glow ? glow.naturalWidth / 64 : 0;
  for (let f = 0; f < frames; f++) {
    context.globalCompositeOperation = 'source-over';
    context.drawImage(image, s, f * frameHeight + s, 10 * s, 16 * s, 0, f * THUMB_H, THUMB_W, THUMB_H);
    if (glow) {
      context.globalCompositeOperation = cape.glowMode;
      context.drawImage(glow, gs, f * glowHeight + gs, 10 * gs, 16 * gs, 0, f * THUMB_H, THUMB_W, THUMB_H);
    }
  }
  context.globalCompositeOperation = 'source-over';
  return strip;
}

function drawThumb(thumb: (typeof thumbs)[number], frame: number): void {
  const strip = strips.get(thumb.cape.key);
  const context = thumb.canvas.getContext('2d');
  if (!strip || !context) return;
  thumb.frame = frame;
  context.clearRect(0, 0, THUMB_W, THUMB_H);
  context.drawImage(strip, 0, frame * THUMB_H, THUMB_W, THUMB_H, 0, 0, THUMB_W, THUMB_H);
  thumb.canvas.classList.add('ready');
}

/** alle Heldix-Capes der Seite: eingebaute, dann die aus dem Katalog */
function allCapeDefs(): CapeDef[] {
  const builtin = (page.profile?.heldixCapes ?? []).filter((c) => SAFE_ID.test(c.id)).map(builtinDef);
  const catalog = (page.cosmetics?.items ?? []).filter((i) => i.slot === 'cape' && i.cape).map(catalogDef);
  return [...builtin, ...catalog];
}

async function ensureStrips(): Promise<void> {
  if (stripsRunning || !page.profile) return;
  stripsRunning = true;
  try {
    // nacheinander, damit nie alle großen Bilder gleichzeitig im Speicher sind
    for (const cape of allCapeDefs()) {
      if (strips.has(cape.key)) continue;
      try {
        const cached = heldixCache.get(cape.key);
        const images = cached ? await cached : await cape.load();
        strips.set(cape.key, buildStrip(cape, images));
        for (const thumb of thumbs) if (thumb.cape.key === cape.key) drawThumb(thumb, 0);
      } catch {
        // Vorschaubild bleibt leer
      }
    }
  } finally {
    stripsRunning = false;
  }
}

function startThumbs(): void {
  if (thumbRaf) return;
  const tick = (now: number) => {
    thumbRaf = window.requestAnimationFrame(tick);
    for (const thumb of thumbs) {
      const frames = Math.max(1, thumb.cape.frames);
      const frame = Math.floor((now / 1000) * Math.max(1, thumb.cape.fps)) % frames;
      if (frame !== thumb.frame) drawThumb(thumb, frame);
    }
  };
  thumbRaf = window.requestAnimationFrame(tick);
}

function stopThumbs(): void {
  window.cancelAnimationFrame(thumbRaf);
  thumbRaf = 0;
}

// ---------- 3D-Figur ----------
let viewer: Viewer | null = null;
let viewerTried = false;
let dragging = false;
let turning = 0;
let resumeTimer = 0;
let syncSeq = 0;
let shownSkin = '';
let shownCape = '';
/** Cosmetics an der Figur und 3D-Vorschaubilder (null = ohne three.js) */
let rig: CosmeticRig | null = null;
let thumbnails: CosmeticThumbnails | null = null;

const frameCanvas = document.createElement('canvas');
frameCanvas.width = FRAME_W;
frameCanvas.height = FRAME_H;
const model = { cape: null as CapeDef | null, images: null as CapeImages | null, frame: 0, timer: 0 };

function viewerLib(): ViewerLib | undefined {
  return (window as unknown as { skinview3d?: ViewerLib }).skinview3d;
}

function ensureViewer(): void {
  if (viewerTried || !ui) return;
  viewerTried = true;
  const lib = viewerLib();
  const host = ui.stageView;
  try {
    if (!lib) throw new Error('skinview3d fehlt');
    const created = new lib.SkinViewer({ canvas: ui.canvas, width: host.clientWidth || 300, height: host.clientHeight || 420, fov: 36, zoom: 0.76 });
    created.playerWrapper.rotation.y = FRONT_ANGLE;
    created.autoRotateSpeed = 0.45;
    const controls = created.controls;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.minPolarAngle = Math.PI * 0.3;
    controls.maxPolarAngle = Math.PI * 0.62;
    controls.rotateSpeed = 0.8;
    // Ziehen hält die Drehung an; kurz nach dem Loslassen dreht die Figur langsam weiter
    controls.addEventListener('start', () => {
      dragging = true;
      window.clearTimeout(resumeTimer);
      applyMotion();
    });
    controls.addEventListener('end', () => {
      window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        dragging = false;
        applyMotion();
      }, 2500);
    });
    new ResizeObserver(() => {
      if (host.clientWidth > 0 && host.clientHeight > 0) created.setSize(host.clientWidth, host.clientHeight);
    }).observe(host);
    viewer = created;
    try {
      rig = CosmeticRig.attach(created as unknown as RigViewer);
      rig?.autoZoom(0.76);
      rig?.setMotion(page.motion);
      thumbnails = rig ? new CosmeticThumbnails(created as unknown as RigViewer) : null;
    } catch {
      rig = null;
      thumbnails = null;
    }
  } catch {
    viewer = null;
    ui.canvas.hidden = true;
  }
  shownSkin = '';
  shownCape = '';
  applyMotion();
}

function applyMotion(): void {
  if (!viewer) return;
  viewer.autoRotate = page.motion && !dragging && !turning;
  const lib = viewerLib();
  if (page.motion && !viewer.animation && lib) viewer.animation = new lib.IdleAnimation();
  if (!page.motion && viewer.animation) viewer.animation = null;
}

/** Figur zur Kamera hin ausrichten (vorn bzw. Rücken), mit kurzer Drehung */
function turnTo(offset: number): void {
  if (!viewer) return;
  const target = viewer;
  const rotation = target.playerWrapper.rotation;
  const goal = offset + target.controls.getAzimuthalAngle();
  const from = rotation.y;
  const diff = Math.atan2(Math.sin(goal - from), Math.cos(goal - from));
  window.cancelAnimationFrame(turning);
  if (!page.motion || Math.abs(diff) < 0.01) {
    rotation.y = from + diff;
    turning = 0;
    applyMotion();
    return;
  }
  const started = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - started) / 650);
    rotation.y = from + diff * (1 - Math.pow(1 - t, 3));
    if (t < 1) {
      turning = window.requestAnimationFrame(step);
    } else {
      turning = 0;
      applyMotion();
    }
  };
  turning = window.requestAnimationFrame(step);
  applyMotion();
}

function backEquipment(): BackEquipment {
  return page.elytra ? 'elytra' : 'cape';
}

function drawModelFrame(): void {
  const { cape, images, frame } = model;
  const context = frameCanvas.getContext('2d');
  if (!cape || !images || !context) return;
  const frames = Math.max(1, cape.frames);
  const sourceHeight = images.image.naturalHeight / frames;
  // Katalog-Capes (64–256 breit) scharf auf 512 × 256 vergrößern
  context.imageSmoothingEnabled = false;
  context.globalCompositeOperation = 'source-over';
  context.clearRect(0, 0, FRAME_W, FRAME_H);
  context.drawImage(images.image, 0, frame * sourceHeight, images.image.naturalWidth, sourceHeight, 0, 0, FRAME_W, FRAME_H);
  if (images.glow) {
    const glowHeight = images.glow.naturalHeight / frames;
    context.globalCompositeOperation = cape.glowMode;
    context.drawImage(images.glow, 0, frame * glowHeight, images.glow.naturalWidth, glowHeight, 0, 0, FRAME_W, FRAME_H);
    context.globalCompositeOperation = 'source-over';
  }
}

/** Bild an die Figur geben. Schneller Weg: direkt in die Cape-Leinwand von skinview3d zeichnen. */
function pushModelFrame(force: boolean): void {
  if (!viewer) return;
  const target = viewer.capeCanvas;
  const texture = viewer.capeTexture;
  if (!force && texture && target.width === FRAME_W && target.height === FRAME_H) {
    const context = target.getContext('2d');
    if (context) {
      context.clearRect(0, 0, FRAME_W, FRAME_H);
      context.drawImage(frameCanvas, 0, 0);
      texture.needsUpdate = true;
      return;
    }
  }
  viewer.loadCape(frameCanvas, { backEquipment: backEquipment() });
}

function startModelTimer(): void {
  const cape = model.cape;
  if (model.timer || !cape || cape.frames <= 1) return;
  model.timer = window.setInterval(() => {
    if (!model.cape) return;
    model.frame = (model.frame + 1) % Math.max(1, model.cape.frames);
    drawModelFrame();
    pushModelFrame(false);
  }, Math.max(40, Math.round(1000 / Math.max(1, cape.fps))));
}

function stopModelTimer(): void {
  window.clearInterval(model.timer);
  model.timer = 0;
}

function clearModelCape(): void {
  stopModelTimer();
  model.cape = null;
  model.images = null;
  model.frame = 0;
}

/** Rendern, Drehen und Animationen nur, solange die Seite zu sehen ist */
function updateRunning(): void {
  const running = page.active && !document.hidden;
  if (viewer) {
    viewer.renderPaused = !running;
    applyMotion();
  }
  if (running && page.motion && model.cape) startModelTimer();
  else stopModelTimer();
  if (running && page.motion && page.tab === 'capes' && thumbs.length) startThumbs();
  else stopThumbs();
  rig?.setMotion(page.motion);
}

interface PreviewSkin {
  dataUrl: string;
  variant: SkinVariant;
  name: string;
  current: boolean;
}

function currentSkinName(p: ProfileState): string {
  return p.library.find((s) => s.active)?.name ?? 'Aktueller Skin';
}

function previewSkin(): PreviewSkin | null {
  const p = page.profile;
  if (!p) return null;
  const id = page.hoverSkin ?? page.pinnedSkin;
  const saved = id ? p.library.find((s) => s.id === id) : undefined;
  if (saved) return { dataUrl: saved.dataUrl, variant: saved.variant, name: saved.name, current: saved.active && saved.variant === p.skin?.variant };
  if (p.skin) return { dataUrl: p.skin.dataUrl, variant: p.skin.variant, name: currentSkinName(p), current: true };
  return null;
}

/** So sieht man sich in HeldixClient: das Heldix-Cape (eingebaut oder aus dem Katalog) ersetzt dort das Minecraft-Cape */
function currentCape(p: ProfileState | null = page.profile): CapeChoice {
  if (!p) return NO_CAPE;
  if (p.heldixCape && p.heldixCapes.some((c) => c.id === p.heldixCape)) return { kind: 'heldix', id: p.heldixCape };
  if (p.heldixCape && catalogCapeItem(p.heldixCape)) return { kind: 'catalog', id: p.heldixCape };
  const mojang = p.mojangCapes.find((c) => c.active);
  return mojang ? { kind: 'mojang', id: mojang.id } : NO_CAPE;
}

/** getragenes Cosmetic eines Slots (aus der eigenen Auswahl, nur wenn es im Katalog ist) */
function wornCosmetic(slot: CosmeticModelSlot): CosmeticItem | null {
  return cosmeticItem(page.cosmetics?.selection?.[slot], slot) ?? null;
}

/** Cosmetics an der Figur: die eigenen, ein überfahrenes ersetzt das seines Slots */
function previewCosmetics(): Record<CosmeticModelSlot, CosmeticItem | null> {
  const result = { head: wornCosmetic('head'), back: wornCosmetic('back'), aura: wornCosmetic('aura'), companion: wornCosmetic('companion') };
  const hover = page.hoverCosmetic;
  if (hover) result[hover.slot] = cosmeticItem(hover.id, hover.slot) ?? null;
  return result;
}

/** Zeigt die Figur gerade ein anderes Cosmetic als getragen? */
function previewingCosmetic(): boolean {
  const hover = page.hoverCosmetic;
  return !!hover && (hover.id ?? null) !== (wornCosmetic(hover.slot)?.id ?? null);
}

function previewCape(): CapeChoice {
  return page.hoverCape ?? currentCape();
}

function capeName(choice: CapeChoice): { label: string; detail: string } {
  if (choice.kind === 'mojang') {
    const cape = page.profile?.mojangCapes.find((c) => c.id === choice.id);
    return { label: `${cape?.alias ?? 'Cape'} · Minecraft-Cape`, detail: 'Für alle Spieler sichtbar' };
  }
  if (choice.kind === 'heldix') {
    const cape = builtinCape(choice.id);
    return { label: `${cape?.name ?? choice.id} · Heldix-Cape`, detail: cape?.description ?? '' };
  }
  if (choice.kind === 'catalog') {
    const item = catalogCapeItem(choice.id);
    return { label: `${item?.name ?? choice.id} · Heldix-Cape`, detail: item?.description ?? '' };
  }
  return { label: 'Ohne Cape', detail: '' };
}

async function syncViewer(): Promise<void> {
  const seq = ++syncSeq;
  const skin = previewSkin();
  if (!viewer) {
    if (viewerTried) drawFallback(skin);
    return;
  }
  const cape = skin ? previewCape() : NO_CAPE;
  // Cosmetics nur mit Figur (ohne Skin ist die Figur unsichtbar)
  if (rig) void rig.showAll(skin ? previewCosmetics() : {});
  try {
    const skinKey = skin ? `${skin.variant}|${skin.dataUrl}` : '';
    if (skinKey !== shownSkin) {
      if (skin) {
        const image = await loadImage(skin.dataUrl);
        if (seq !== syncSeq) return;
        viewer.loadSkin(image, { model: skin.variant === 'slim' ? 'slim' : 'default' });
      } else {
        viewer.loadSkin(null);
      }
      shownSkin = skinKey;
    }
    const capeKey = choiceKey(cape);
    if (capeKey === shownCape) return;
    if (cape.kind === 'heldix' || cape.kind === 'catalog') {
      const definition = capeDef(cape);
      if (!definition) return;
      ui?.stageView.classList.add('loading');
      const images = await heldixImages(definition);
      if (seq !== syncSeq) return;
      clearModelCape();
      Object.assign(model, { cape: definition, images, frame: 0 });
      drawModelFrame();
      pushModelFrame(true);
    } else if (cape.kind === 'mojang') {
      const owned = page.profile?.mojangCapes.find((c) => c.id === cape.id);
      const image = owned?.dataUrl ? await loadImage(owned.dataUrl) : null;
      if (seq !== syncSeq) return;
      clearModelCape();
      if (image) viewer.loadCape(image, { backEquipment: backEquipment() });
      else viewer.loadCape(null);
    } else {
      clearModelCape();
      viewer.loadCape(null);
    }
    shownCape = capeKey;
    updateRunning();
  } catch {
    // Bild nicht ladbar: die Figur bleibt, wie sie ist
  } finally {
    if (seq === syncSeq) ui?.stageView.classList.remove('loading');
  }
}

/** ohne WebGL: Vorderansicht des Skins statt der 3D-Figur */
function drawFallback(skin: PreviewSkin | null): void {
  if (!ui) return;
  const canvas = ui.fallback;
  canvas.hidden = !skin;
  if (skin) paintSkin(canvas, skin.dataUrl, skin.variant);
}

// ---------- Vorschau beim Überfahren ----------
let hoverTimer = 0;

function setHover(skin: string | null, cape: CapeChoice | null, cosmetic: CosmeticHover | null = null): void {
  window.clearTimeout(hoverTimer);
  hoverTimer = window.setTimeout(() => {
    const key = (choice: CapeChoice | null) => (choice ? choiceKey(choice) : '');
    const cosmeticKey = (c: CosmeticHover | null) => (c ? `${c.slot}:${c.id ?? ''}` : '');
    if (page.hoverSkin === skin && key(page.hoverCape) === key(cape) && cosmeticKey(page.hoverCosmetic) === cosmeticKey(cosmetic)) return;
    page.hoverSkin = skin;
    page.hoverCape = cape;
    page.hoverCosmetic = cosmetic;
    // Rückenteile von hinten zeigen, Format-2-Begleiter von ihrer Seite, alles andere von vorn
    if (cosmetic) face(cosmetic.slot === 'back' ? 'back' : companionSide(cosmetic) ?? 'front');
    renderStage();
    void syncViewer();
  }, skin || cape || cosmetic ? 40 : 110);
}

/** Seite eines überfahrenen Format-2-Begleiters (links gebaut, rechts gespiegelt), sonst null */
function companionSide(hover: CosmeticHover): 'left' | 'right' | null {
  const mesh = hover.slot === 'companion' ? cosmeticItem(hover.id, hover.slot)?.mesh : null;
  return mesh ? mesh.attach.side : null;
}

/** Figur mit dieser Seite zur Kamera drehen – nur, wenn sie gerade (auch durch das Drehen von selbst) woanders hinzeigt */
function face(side: 'front' | 'back' | 'left' | 'right'): void {
  if (!viewer) return;
  const goal = side === 'back' ? BACK_ANGLE : side === 'left' ? LEFT_ANGLE : side === 'right' ? RIGHT_ANGLE : FRONT_ANGLE;
  const current = viewer.playerWrapper.rotation.y - viewer.controls.getAzimuthalAngle();
  if (Math.abs(Math.atan2(Math.sin(goal - current), Math.cos(goal - current))) > 0.9) turnTo(goal);
}

function togglePin(id: string): void {
  page.pinnedSkin = page.pinnedSkin === id ? null : id;
  ui?.scroll.querySelectorAll<HTMLElement>('.profile-skin').forEach((card) => {
    const pinned = card.dataset.id === page.pinnedSkin;
    card.classList.toggle('previewing', pinned);
    const art = card.querySelector('.profile-skin-art');
    art?.setAttribute('aria-pressed', String(pinned));
    art?.setAttribute('title', pinned ? 'Vorschau beenden' : 'An der Figur anprobieren');
  });
  renderStage();
  void syncViewer();
}

// ---------- Laden ----------
async function load(options: { silent?: boolean; refresh?: boolean; reset?: boolean } = {}): Promise<void> {
  const seq = ++page.loadSeq;
  page.accountKey = activeAccountKey();
  if (options.reset) {
    page.profile = null;
    page.cosmetics = null;
    page.pinnedSkin = null;
    page.hoverSkin = null;
    page.hoverCape = null;
    page.hoverCosmetic = null;
  }
  void loadCosmetics(options.refresh === true);
  if (!options.silent || !page.profile) {
    page.loading = true;
    page.failure = null;
    render();
  }
  try {
    const profile = await api.getProfile(options.refresh);
    if (seq !== page.loadSeq) return;
    setProfile(profile);
    page.failure = null;
    page.loadedAt = Date.now();
  } catch (error) {
    if (seq !== page.loadSeq) return;
    if (!page.profile) page.failure = errorMessage(error);
    else if (!options.silent) toast(errorMessage(error), 'error');
  } finally {
    if (seq === page.loadSeq) {
      page.loading = false;
      page.stale = false;
      render();
    }
  }
}

/** Cosmetics-Katalog und eigene Auswahl (unabhängig von Mojang: Fehler stehen in cosmetics.error) */
async function loadCosmetics(refresh = false): Promise<void> {
  const seq = ++page.cosmeticsSeq;
  page.cosmeticsLoading = true;
  try {
    const cosmetics = await api.getCosmetics(refresh);
    if (seq !== page.cosmeticsSeq) return;
    setCosmetics(cosmetics);
  } catch (error) {
    if (seq !== page.cosmeticsSeq) return;
    if (!page.cosmetics) page.cosmetics = { items: [], selection: null, canChoose: false, team: null, unlocked: null, error: errorMessage(error) };
  } finally {
    if (seq === page.cosmeticsSeq) {
      page.cosmeticsLoading = false;
      render();
    }
  }
}

function setCosmetics(cosmetics: CosmeticsState): void {
  page.cosmetics = cosmetics;
  const hover = page.hoverCosmetic;
  if (hover?.id && !cosmeticItem(hover.id, hover.slot)) page.hoverCosmetic = null;
}

function setProfile(profile: ProfileState): void {
  page.profile = profile;
  const ids = new Set(profile.library.map((s) => s.id));
  if (page.pinnedSkin && !ids.has(page.pinnedSkin)) page.pinnedSkin = null;
  if (page.hoverSkin && !ids.has(page.hoverSkin)) page.hoverSkin = null;
  pruneImages(profile);
}

function replaceSaved(skin: SavedSkin): void {
  const p = page.profile;
  if (!p) return;
  page.profile = { ...p, library: p.library.map((s) => (s.id === skin.id ? skin : s)) };
}

let accountTimer = 0;

function onAccountsChanged(): void {
  page.stale = true;
  if (!page.active) return;
  // app.ts lädt die Konten auf dasselbe Ereignis hin neu – kurz warten, dann vergleichen
  window.clearTimeout(accountTimer);
  accountTimer = window.setTimeout(() => {
    if (page.busy) return; // die laufende Änderung liefert den neuen Stand selbst
    const changed = page.accountKey !== null && activeAccountKey() !== page.accountKey;
    void load({ silent: !changed, reset: changed });
  }, 400);
}

/** Kontowechsel über die Seitenleiste (ohne eigenes Ereignis): solange die Seite offen ist, nachsehen */
let watchTimer = 0;

function setActive(active: boolean): void {
  if (page.active === active) return;
  page.active = active;
  window.clearInterval(watchTimer);
  if (active) {
    watchTimer = window.setInterval(() => {
      if (!page.loading && page.accountKey !== null && activeAccountKey() !== page.accountKey) void load({ reset: true });
    }, 1000);
  } else {
    window.clearTimeout(hoverTimer);
    page.hoverSkin = null;
    page.hoverCape = null;
    page.hoverCosmetic = null;
  }
  updateRunning();
}

// ---------- Aktionen ----------
async function applySkin(skin: SavedSkin): Promise<void> {
  if (page.busy || !canEdit()) return;
  page.busy = `skin:${skin.id}`;
  render();
  try {
    const profile = await api.applySkin(skin.id);
    page.pinnedSkin = null;
    setProfile(profile);
    toast(`„${skin.name}“ ist jetzt dein Skin – überall, auch auf Servern.`, 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    page.busy = null;
    render();
  }
}

async function resetSkin(): Promise<void> {
  if (page.busy || !canEdit()) return;
  const ok = await confirmDialog(
    'Standard-Skin wiederherstellen?',
    'Mojang setzt deinen Skin auf einen Standard-Skin zurück – überall, auch auf Servern und in anderen Launchern. Dein jetziger Skin bleibt in der Sammlung.',
    'Zurücksetzen',
  );
  if (!ok || page.busy) return;
  page.busy = 'reset';
  render();
  try {
    setProfile(await api.resetSkin());
    page.pinnedSkin = null;
    toast('Standard-Skin wiederhergestellt.', 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    page.busy = null;
    render();
  }
}

async function selectMojangCape(cape: MojangCape | null): Promise<void> {
  if (page.busy || !canEdit()) return;
  page.busy = `mojang:${cape?.id ?? 'none'}`;
  render();
  try {
    setProfile(await api.setMojangCape(cape?.id ?? null));
    toast(cape ? `Cape „${cape.alias}“ angelegt.` : 'Minecraft-Cape abgelegt.', 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    page.busy = null;
    render();
  }
}

async function selectHeldixCape(cape: HeldixCape | null): Promise<void> {
  if (page.busy || !page.profile?.heldixAvailable) return;
  page.busy = `heldix:${cape?.id ?? 'none'}`;
  render();
  try {
    setProfile(await api.setHeldixCape(cape?.id ?? null));
    // dasselbe Feld beim Dienst wie der Slot cape der Cosmetics
    const cosmetics = page.cosmetics;
    if (cosmetics?.selection) page.cosmetics = { ...cosmetics, selection: { ...cosmetics.selection, cape: page.profile?.heldixCape ?? null } };
    toast(cape ? `Heldix-Cape „${cape.name}“ angelegt.` : 'Heldix-Cape abgelegt.', 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    page.busy = null;
    render();
  }
}

/** Cosmetic anlegen (item) oder den Slot leeren (null); slot cape = Cape aus dem Katalog */
async function selectCosmetic(slot: CosmeticSlotName, item: CosmeticItem | null): Promise<void> {
  if (page.busy || !page.cosmetics?.canChoose) return;
  // Format 2: die Leiste unter der Figur zeigt danach die Animationen dieses Slots
  if (item?.mesh && slot !== 'cape') page.animSlot = slot;
  page.busy = `cosmetic:${slot}:${item?.id ?? 'none'}`;
  render();
  try {
    const cosmetics = await api.setCosmetic(slot, item?.id ?? null);
    setCosmetics(cosmetics);
    if (slot === 'cape' && page.profile) page.profile = { ...page.profile, heldixCape: cosmetics.selection?.cape ?? null };
    if (slot === 'cape') toast(item ? `Heldix-Cape „${item.name}“ angelegt.` : 'Heldix-Cape abgelegt.', 'success');
    else toast(item ? `„${item.name}“ angelegt.` : SLOT_INFO[slot].removed, 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
    // z. B. „nur fürs Team“: der Launcher weiß es jetzt und sperrt die Kachel
    void loadCosmetics();
  } finally {
    page.busy = null;
    render();
  }
}

async function importSkins(paths?: string[]): Promise<void> {
  if (page.importing) return;
  page.importing = true;
  renderBar();
  try {
    const added = await api.importSkins(paths);
    if (!added.length) return;
    const p = page.profile;
    if (p) {
      const ids = new Set(added.map((s) => s.id));
      page.profile = { ...p, library: [...p.library.filter((s) => !ids.has(s.id)), ...added] };
    }
    page.pinnedSkin = added[0].id;
    if (page.tab !== 'skins') setTab('skins');
    if (ui) ui.scroll.scrollTop = 0;
    toast(added.length === 1 ? `„${added[0].name}“ ist in deiner Sammlung.` : `${added.length} Skins sind in deiner Sammlung.`, 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    page.importing = false;
    render();
  }
}

async function setVariant(skin: SavedSkin, variant: SkinVariant): Promise<void> {
  if (skin.variant === variant) return;
  replaceSaved({ ...skin, variant });
  render();
  try {
    replaceSaved(await api.updateSavedSkin(skin.id, { variant }));
  } catch (error) {
    replaceSaved(skin);
    toast(errorMessage(error), 'error');
  }
  render();
}

async function renameSkin(skin: SavedSkin, name: string): Promise<void> {
  replaceSaved({ ...skin, name });
  render();
  try {
    replaceSaved(await api.updateSavedSkin(skin.id, { name }));
  } catch (error) {
    replaceSaved(skin);
    toast(errorMessage(error), 'error');
  }
  render();
}

async function deleteSkin(skin: SavedSkin): Promise<void> {
  const ok = await confirmDialog(
    'Skin entfernen?',
    `„${skin.name}“ wird aus deiner Sammlung gelöscht.${skin.active ? ' Dein Skin bei Mojang bleibt, wie er ist.' : ''}`,
    'Entfernen',
  );
  if (!ok) return;
  try {
    await api.deleteSavedSkin(skin.id);
    const p = page.profile;
    if (p) page.profile = { ...p, library: p.library.filter((s) => s.id !== skin.id) };
    if (page.pinnedSkin === skin.id) page.pinnedSkin = null;
    if (page.hoverSkin === skin.id) page.hoverSkin = null;
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
  render();
}

function startRename(skin: SavedSkin, button: HTMLElement): void {
  const input = h('input', { type: 'text', class: 'profile-skin-input', value: skin.name, maxlength: '32', spellcheck: 'false', 'aria-label': 'Name des Skins' });
  page.renaming = true;
  button.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    page.renaming = false;
    const name = input.value.trim().replace(/\s+/g, ' ');
    if (save && name && name !== skin.name) void renameSkin(skin, name);
    else render();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
}

function openAccounts(event: Event): void {
  // Konten-Auswahl der Seitenleiste öffnen (der Klick darf sie nicht gleich wieder schließen)
  event.stopPropagation();
  document.getElementById('account-button')?.click();
}

// ---------- Ziehen & Ablegen ----------
function setupDrop(root: HTMLElement): void {
  let depth = 0;
  const hasFiles = (event: DragEvent) => !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');
  const leave = () => {
    depth = 0;
    ui?.main.classList.remove('dragging');
  };
  root.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth++;
    if (depth === 1) {
      if (page.tab !== 'skins') setTab('skins');
      ui?.main.classList.add('dragging');
    }
  });
  root.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  root.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) leave();
  });
  root.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    leave();
    const files = Array.from(event.dataTransfer?.files ?? []);
    const pngs = files.filter((file) => file.type === 'image/png' || /\.png$/i.test(file.name));
    if (!pngs.length) {
      toast('Nur PNG-Skins (64 × 64 oder 64 × 32 Pixel) lassen sich hinzufügen.', 'error');
      return;
    }
    const paths = pngs.map((file) => api.pathForFile(file)).filter((path) => !!path);
    if (paths.length) void importSkins(paths);
    if (pngs.length < files.length) toast('Andere Dateien als PNG wurden übersprungen.');
  });
}

// ---------- Darstellung ----------
function render(): void {
  if (!ui) return;
  renderHead();
  renderBar();
  renderBody();
  renderStage();
  void syncViewer();
  updateRunning();
}

function renderHead(): void {
  if (!ui) return;
  const p = page.profile;
  const account = p?.account;
  ui.sub.replaceChildren();
  if (!p) ui.sub.textContent = page.loading ? 'Lädt …' : 'Dein Aussehen in Minecraft.';
  else if (!account) ui.sub.textContent = 'Nicht angemeldet';
  else {
    const kind = account.type === 'offline' ? 'Offline-Konto' : account.via === 'launcher' ? 'Microsoft-Konto über den Minecraft Launcher' : 'Microsoft-Konto';
    ui.sub.append('Angemeldet als ', h('strong', { text: account.name }), ` · ${kind}`);
  }
}

function renderBar(): void {
  if (!ui) return;
  const p = page.profile;
  for (const [tab, button] of [['skins', ui.tabSkins], ['capes', ui.tabCapes], ['cosmetics', ui.tabCosmetics]] as const) {
    button.classList.toggle('active', page.tab === tab);
    button.setAttribute('aria-selected', String(page.tab === tab));
  }
  ui.skinCount.textContent = p ? String(p.library.length) : '';
  ui.skinCount.hidden = !p;
  ui.actions.hidden = page.tab !== 'skins' || !p;
  const reason = lockReason();
  ui.resetButton.disabled = !!page.busy || !canEdit();
  ui.resetButton.title = reason ?? 'Standard-Skin von Mojang wiederherstellen';
  const resetting = page.busy === 'reset';
  ui.resetButton.replaceChildren(resetting ? spinner() : uiIcon('reset', 'btn-icon'), resetting ? 'Setzt zurück …' : 'Standard-Skin');
  ui.addButton.disabled = page.importing;
}

function renderBody(): void {
  if (!ui) return;
  // ein offenes Namensfeld nicht wegwerfen; nach dem Umbenennen wird ohnehin neu gezeichnet
  if (page.renaming) return;
  const scrollTop = ui.scroll.scrollTop;
  thumbs.length = 0;
  const p = page.profile;
  const nodes: Node[] = [];
  if (!p && page.loading) nodes.push(loadingView());
  else if (!p) nodes.push(failureView(page.failure));
  else {
    nodes.push(...notices(p));
    nodes.push(page.tab === 'skins' ? skinsView(p) : page.tab === 'capes' ? capesView(p) : cosmeticsView());
  }
  ui.scroll.replaceChildren(...nodes);
  ui.scroll.scrollTop = scrollTop;
  if (p && page.tab === 'capes') void ensureStrips();
}

function renderStage(): void {
  if (!ui) return;
  const p = page.profile;
  const skin = previewSkin();
  const cape = skin ? previewCape() : NO_CAPE;
  // Vorschau durch einen angeklickten Skin (nicht nur durch Überfahren): lässt sich am Schild beenden
  const pinned = !!page.pinnedSkin && !page.hoverSkin && !page.hoverCape && !page.hoverCosmetic;
  const previewing = !!skin && (!skin.current || choiceKey(cape) !== choiceKey(currentCape()) || previewingCosmetic());

  ui.stageName.textContent = skin?.name ?? (!p ? '' : p.account ? 'Kein Skin' : 'Keine Figur');
  let { label, detail } = capeName(cape);
  const hover = page.hoverCosmetic;
  if (hover) {
    // überfahrenes Cosmetic statt des Capes nennen
    const item = cosmeticItem(hover.id, hover.slot);
    label = item ? `${item.name} · ${SLOT_INFO[hover.slot].title}` : `${SLOT_INFO[hover.slot].title}: ${SLOT_INFO[hover.slot].none}`;
    detail = item?.description ?? '';
  }
  ui.stageSub.textContent = skin ? label : '';
  ui.stageSub.title = detail;

  ui.tag.hidden = !skin;
  ui.tag.classList.toggle('preview', previewing);
  ui.tag.disabled = !(previewing && pinned);
  ui.tag.title = previewing && pinned ? 'Vorschau beenden' : '';
  ui.tag.replaceChildren(h('span', { class: 'profile-tag-dot' }), previewing ? 'Vorschau' : 'Aktuell');
  if (previewing && pinned) ui.tag.append(uiIcon('close', 'profile-tag-close'));

  let hint: string | null = null;
  if (!p) hint = page.loading ? 'Lädt …' : null;
  else if (!skin) {
    if (p.library.length) hint = 'Fahre über einen Skin, um ihn anzuprobieren.';
    else if (!p.account) hint = 'Melde dich an, um deine Figur zu sehen.';
    // Standard-Skins kommen aus der installierten Minecraft-Version
    else hint = p.account.type === 'offline' ? 'Den Standard-Skin zeigt die Vorschau, sobald eine Minecraft-Version installiert ist.' : 'Dein Skin ließ sich gerade nicht laden.';
  }
  ui.hint.hidden = !hint;
  ui.hint.textContent = hint ?? '';

  const hasCape = !!skin && cape.kind !== 'none';
  ui.elytra.disabled = !hasCape;
  ui.elytra.setAttribute('aria-pressed', String(page.elytra));
  ui.elytra.title = hasCape ? (page.elytra ? 'Wieder als Cape zeigen' : 'Cape als Elytra zeigen') : 'Kein Cape gewählt';
  ui.motion.replaceChildren(uiIcon(page.motion ? 'pause' : 'play'));
  ui.motion.title = page.motion ? 'Drehen und Animation anhalten' : 'Drehen und Animation abspielen';
  ui.motion.setAttribute('aria-pressed', String(page.motion));
  ui.motion.hidden = !viewer;
  updateEmote();
  renderAnims();
}

// ---------- Format 2: Animationen ----------

const animKey = (item: CosmeticItem) => `${item.id}:${item.sha256}`;

/** Das überfahrene Format-2-Cosmetic spielt sein Emote, alle anderen ihre gewählte Animation */
function updateEmote(): void {
  if (!rig) return;
  const hover = page.hoverCosmetic;
  const item = hover ? cosmeticItem(hover.id, hover.slot) : undefined;
  for (const slot of MODEL_SLOTS) rig.emote(slot, hover?.slot === slot && item?.mesh ? item : null);
}

/** Format-2-Cosmetic an der Figur, dessen Animationen die Leiste zeigt: überfahren, zuletzt gewählt, sonst nach Slot */
function animatedFocus(): CosmeticItem | null {
  if (!previewSkin()) return null;
  const shown = previewCosmetics();
  const order: CosmeticModelSlot[] = [];
  if (page.hoverCosmetic) order.push(page.hoverCosmetic.slot);
  if (page.animSlot) order.push(page.animSlot);
  order.push('back', 'companion', 'aura', 'head');
  for (const slot of order) {
    const item = shown[slot];
    if (item?.mesh) return item;
  }
  return null;
}

/** Leiste mit den Animationen (Namen aus dem Manifest); einmalige tragen „1×“ und laufen danach zurück */
function renderAnims(): void {
  if (!ui) return;
  const box = ui.anims;
  const item = viewer && rig ? animatedFocus() : null;
  const mesh = item?.mesh;
  if (!item || !mesh || mesh.animations.length < 2) {
    box.hidden = true;
    box.replaceChildren();
    delete box.dataset.cosmetic;
    return;
  }
  const names = mesh.animations.map((a) => a.name);
  const idle = names.includes(mesh.states.idle) ? mesh.states.idle : names[0];
  const emote = mesh.states.emote && names.includes(mesh.states.emote) ? mesh.states.emote : null;
  const hovered = page.hoverCosmetic?.slot === item.slot && page.hoverCosmetic.id === item.id;
  const chosen = page.anims.get(animKey(item)) ?? idle;
  const active = hovered && emote ? emote : chosen;
  box.hidden = false;
  box.dataset.cosmetic = item.id;
  box.dataset.animation = active;
  box.setAttribute('aria-label', `Animation von ${item.name}`);
  box.replaceChildren(...mesh.animations.map((a) => h('button', {
    class: 'profile-anim',
    type: 'button',
    'aria-pressed': String(a.name === active),
    title: a.loop ? `${a.name} abspielen` : `${a.name} einmal abspielen, danach zurück`,
    onclick: () => {
      page.anims.set(animKey(item), a.name);
      page.animSlot = item.slot as CosmeticModelSlot;
      rig?.setAnimation(item, a.name);
      renderAnims();
    },
  }, a.name, a.loop ? null : h('span', { class: 'profile-anim-once', text: '1×' }))));
}

function loadingView(): HTMLElement {
  return h('div', { class: 'profile-loading', 'aria-busy': 'true' },
    h('div', { class: 'profile-loading-line' }, spinner(), 'Skins, Capes und Cosmetics werden geladen …'),
    h('div', { class: 'profile-skin-grid' }, ...[0, 1, 2].map(() => h('div', { class: 'profile-skeleton' }))));
}

function failureView(message: string | null): HTMLElement {
  return h('div', { class: 'content-empty profile-failure' },
    uiIcon('warning', 'empty-icon'),
    h('div', { class: 'content-empty-title', text: 'Skins & Cosmetics ließen sich nicht laden' }),
    h('div', { text: message ?? 'Unbekannter Fehler.' }),
    h('button', { class: 'ghost', type: 'button', onclick: () => void load({ refresh: true }) }, uiIcon('refresh', 'btn-icon'), 'Erneut versuchen'));
}

/** „Erneut versuchen“: lädt neu bei Mojang und beim Heldix-Dienst; zeigt, solange es lädt, einen Kreisel */
function retryButton(): HTMLElement {
  return h('button', { class: 'ghost small', type: 'button', disabled: page.loading, onclick: () => void load({ refresh: true }) },
    page.loading ? spinner() : null, 'Erneut versuchen');
}

function notice(kind: 'info' | 'warn' | 'danger', icon: string, title: string | null, text: string, action?: HTMLElement): HTMLElement {
  return h('div', { class: `profile-notice profile-notice-${kind}`, role: kind === 'danger' ? 'alert' : null },
    h('span', { class: 'profile-notice-icon' }, uiIcon(icon)),
    h('div', { class: 'profile-notice-text' }, title ? h('strong', { text: title }) : null, h('span', { text })),
    action ?? null);
}

function notices(p: ProfileState): HTMLElement[] {
  const list: HTMLElement[] = [];
  if (!p.account) {
    list.push(notice('info', 'user', 'Nicht angemeldet', 'Skin und Cape ändern geht mit deinem Microsoft-Konto. Sammlung und Vorschau funktionieren auch so.',
      h('button', { class: 'ghost small', type: 'button', onclick: openAccounts }, 'Anmelden')));
  } else if (p.account.type === 'offline') {
    list.push(notice('info', 'user', 'Offline-Konto', 'Skin und Cape lassen sich nur mit einem Microsoft-Konto ändern. Sammlung und Vorschau funktionieren auch so.'));
  } else if (!p.canEditSkin && !p.error) {
    list.push(notice('warn', 'lock', 'Ändern gerade nicht möglich', 'Die Anmeldung ist abgelaufen. Starte einmal das Spiel oder melde dich neu an.'));
  }
  if (p.error) {
    list.push(notice('danger', 'warning', p.account?.type === 'microsoft' && !p.canEditSkin ? 'Ändern gerade nicht möglich' : null, p.error, retryButton()));
  }
  return list;
}

// ----- Reiter „Skins“ -----
function skinsView(p: ProfileState): HTMLElement {
  const panel = h('div', { class: 'profile-panel' });
  if (p.account?.type === 'microsoft') {
    panel.append(h('p', { class: 'profile-info' }, uiIcon('info'),
      h('span', { text: 'Ein neuer Skin gilt überall – auf Servern und in anderen Launchern. Mojang begrenzt, wie oft du in kurzer Zeit wechseln kannst.' })));
  }
  if (!p.library.length) {
    panel.append(h('div', { class: 'content-empty' },
      uiIcon('image', 'empty-icon'),
      h('div', { class: 'content-empty-title', text: 'Noch keine Skins in der Sammlung' }),
      h('div', { text: 'Füge PNG-Dateien hinzu oder zieh sie hierher (64 × 64 oder 64 × 32 Pixel).' }),
      h('button', { class: 'primary', type: 'button', onclick: () => void importSkins() }, uiIcon('plus', 'btn-icon'), 'Skin hinzufügen')));
  } else {
    panel.append(h('div', { class: 'profile-skin-grid' }, ...sortedLibrary(p).map((skin) => skinCard(skin, p))));
  }
  return panel;
}

function skinCard(skin: SavedSkin, p: ProfileState): HTMLElement {
  const current = skin.active && (!p.skin || p.skin.variant === skin.variant);
  const busy = page.busy === `skin:${skin.id}`;
  const pinned = page.pinnedSkin === skin.id;
  const reason = lockReason(p);

  const art = h('canvas', { width: '16', height: '32', 'aria-hidden': 'true' });
  paintSkin(art, skin.dataUrl, skin.variant);

  const name = h('button', { class: 'profile-skin-name', type: 'button', title: 'Umbenennen' },
    h('span', { text: skin.name }), uiIcon('edit', 'profile-skin-edit'));
  name.addEventListener('click', () => startRename(skin, name));

  const variantButton = (variant: SkinVariant, label: string, title: string) =>
    h('button', {
      type: 'button',
      class: skin.variant === variant ? 'active' : '',
      title,
      'aria-pressed': String(skin.variant === variant),
      disabled: busy,
      onclick: () => void setVariant(skin, variant),
    }, label);

  let apply: HTMLElement;
  if (busy) {
    apply = h('button', { class: 'primary', type: 'button', disabled: true }, spinner(), 'Lädt hoch …');
  } else if (current) {
    apply = h('button', { class: 'ghost', type: 'button', disabled: true, title: 'Das ist dein aktueller Skin' }, uiIcon('check', 'btn-icon'), 'Angewendet');
  } else {
    apply = h('button', {
      class: 'primary',
      type: 'button',
      disabled: !canEdit(p) || !!page.busy,
      title: reason ?? (skin.active ? 'Modell bei Mojang ändern' : 'Bei Mojang als Skin setzen'),
      onclick: () => void applySkin(skin),
    }, 'Anwenden');
  }

  return h('div', {
    class: `profile-skin${skin.active ? ' active' : ''}${pinned ? ' previewing' : ''}`,
    'data-id': skin.id,
    onmouseenter: () => setHover(skin.id, null),
    onmouseleave: () => setHover(null, null),
  },
  h('button', {
    class: 'profile-skin-art',
    type: 'button',
    title: pinned ? 'Vorschau beenden' : 'An der Figur anprobieren',
    'aria-label': `${skin.name} an der Figur anprobieren`,
    'aria-pressed': String(pinned),
    onclick: () => togglePin(skin.id),
    onfocus: () => setHover(skin.id, null),
    onblur: () => setHover(null, null),
  }, art, skin.active ? h('span', { class: 'profile-skin-badge' }, uiIcon('check'), 'Aktiv') : null),
  h('div', { class: 'profile-skin-body' },
    name,
    h('div', { class: 'chip-toggle profile-variant', role: 'group', 'aria-label': 'Modell' },
      variantButton('classic', 'Steve', 'Breite Arme (Steve)'),
      variantButton('slim', 'Alex', 'Schmale Arme (Alex)')),
    h('div', { class: 'profile-skin-actions' },
      apply,
      h('button', {
        class: 'icon-button danger-hover',
        type: 'button',
        title: 'Aus der Sammlung entfernen',
        'aria-label': `${skin.name} entfernen`,
        disabled: busy,
        onclick: () => void deleteSkin(skin),
      }, uiIcon('trash')))));
}

// ----- Reiter „Capes“ -----
interface TileOptions {
  /** Vorschau beim Überfahren: ein Cape … */
  choice?: CapeChoice;
  /** … oder ein Cosmetic */
  cosmetic?: CosmeticHover;
  label: string;
  art: Node;
  /** quadratisches Vorschaubild (Cosmetics) statt Cape-Format */
  square?: boolean;
  checked: boolean;
  /** nicht wählbar (Vorschau beim Überfahren geht trotzdem) */
  locked: boolean;
  /** nur für das HeldixClient-Team */
  team?: boolean;
  /** Belohnung (access „unlock“) */
  reward?: boolean;
  /** Klick auf die gesperrte Kachel (z. B. zu „Freunde einladen“) */
  onLocked?: () => void;
  busyKey: string;
  title: string;
  select: () => void;
}

function capeTile(o: TileOptions): HTMLElement {
  const busy = page.busy === o.busyKey;
  const blocked = o.locked || (!!page.busy && !busy);
  const enter = () => setHover(null, o.choice ?? null, o.cosmetic ?? null);
  const leave = () => setHover(null, null, null);
  return h('button', {
    class: `profile-cape${busy ? ' busy' : ''}${o.square ? ' square' : ''}`,
    type: 'button',
    role: 'radio',
    'aria-checked': String(o.checked),
    'aria-disabled': blocked ? 'true' : null,
    title: o.title,
    onclick: () => {
      if (o.locked && o.onLocked && !page.busy) o.onLocked();
      else if (!blocked && !busy && !o.checked) o.select();
    },
    onmouseenter: enter,
    onmouseleave: leave,
    onfocus: enter,
    onblur: leave,
  },
  h('span', { class: 'profile-cape-art' }, o.art),
  // Lange Einzelwörter (z. B. „Freundesfunken“) kleiner setzen statt mitten im Wort umzubrechen
  h('span', { class: `profile-cape-name${o.label.split(/\s+/).some((word) => word.length > 11) ? ' long' : ''}`, text: o.label }),
  o.team ? h('span', { class: 'profile-cape-team', title: 'Nur für das HeldixClient-Team' }, uiIcon('shield'), 'Team') : null,
  o.reward && !o.team ? h('span', { class: 'profile-cape-team profile-cape-reward', title: 'Belohnung für Einladungen' }, uiIcon('user-plus'), 'Belohnung') : null,
  o.checked ? h('span', { class: 'profile-cape-check' }, uiIcon('check')) : null,
  busy ? h('span', { class: 'profile-cape-busy' }, spinner()) : null);
}

/** Titel einer Katalog-Kachel (gesperrt: warum) */
function cosmeticTitle(item: CosmeticItem, lockedBy: string | null): string {
  const text = item.description ? `${item.name}: ${item.description}` : item.name;
  if (lockedBy) return `${item.name} – ${lockedBy}`;
  if (item.unlockOnly) return `${text} (Belohnung für Einladungen)`;
  return item.teamOnly ? `${text} (nur für das HeldixClient-Team)` : text;
}

function noneArt(): HTMLElement {
  return h('span', { class: 'profile-cape-none' }, uiIcon('ban'));
}

/** Hinweis unter gesperrten Belohnungen mit Sprung zu „Freunde einladen“ */
function rewardHint(items: CosmeticItem[]): HTMLElement {
  const names = items.map((i) => i.name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} und ${names.at(-1)}` : names[0];
  return h('p', { class: 'profile-locked profile-reward-hint' }, uiIcon('user-plus'),
    h('span', { text: `Belohnung für Einladungen: ${list} schaltest du frei, indem du Freunde zu HeldixClient einlädst.` }),
    h('button', { class: 'ghost small profile-invite-jump', type: 'button', onclick: () => openInvites() }, 'Freunde einladen'));
}

function sectionHead(heading: string, text: string): HTMLElement {
  return h('div', { class: 'profile-section-head' }, h('h3', { text: heading }), h('p', { class: 'hint', text }));
}

function capesView(p: ProfileState): HTMLElement {
  const panel = h('div', { class: 'profile-panel' });
  const microsoft = p.account?.type === 'microsoft';
  const reason = lockReason(p);

  // Minecraft-Capes des Kontos
  const mojang = h('section', { class: 'profile-section' },
    sectionHead('Minecraft-Capes', 'Capes deines Microsoft-Kontos – für alle Spieler sichtbar.'));
  if (!microsoft) {
    mojang.append(h('p', { class: 'profile-locked' }, uiIcon('lock'), h('span', { text: 'Nur mit Microsoft-Konto' })));
  } else if (!p.mojangCapes.length) {
    mojang.append(h('p', { class: 'profile-locked' }, uiIcon('info'), h('span', { text: p.error && !p.canEditSkin ? 'Deine Capes ließen sich gerade nicht laden.' : 'Dein Konto besitzt keine Minecraft-Capes.' })));
  } else {
    const anyActive = p.mojangCapes.some((c) => c.active);
    const locked = !canEdit(p);
    const tiles = [
      capeTile({ choice: NO_CAPE, label: 'Kein Cape', art: noneArt(), checked: !anyActive, locked, busyKey: 'mojang:none', title: reason ?? 'Kein Minecraft-Cape tragen', select: () => void selectMojangCape(null) }),
      ...p.mojangCapes.map((cape) => {
        const canvas = h('canvas', { width: '10', height: '16', class: 'pixel' });
        paintMojangCape(canvas, cape);
        return capeTile({
          choice: { kind: 'mojang', id: cape.id },
          label: cape.alias,
          art: cape.dataUrl ? canvas : uiIcon('cape', 'profile-cape-missing'),
          checked: cape.active,
          locked,
          busyKey: `mojang:${cape.id}`,
          title: reason ?? `${cape.alias} tragen`,
          select: () => void selectMojangCape(cape),
        });
      }),
    ];
    mojang.append(h('div', { class: 'profile-cape-grid', role: 'radiogroup', 'aria-label': 'Minecraft-Cape' }, ...tiles));
    if (locked && reason) mojang.append(h('p', { class: 'profile-locked' }, uiIcon('lock'), h('span', { text: reason })));
  }

  // Heldix-Capes
  const heldixLocked = !p.heldixAvailable;
  let lockedRow: HTMLElement | null = null;
  if (heldixLocked) {
    const offline = !microsoft;
    lockedRow = h('p', { class: 'profile-locked' }, uiIcon('lock'),
      h('span', { text: offline ? 'Nur mit Microsoft-Konto und Heldix-Dienst' : 'Heldix-Dienst nicht erreichbar – Vorschau geht trotzdem.' }),
      offline ? null : retryButton());
  }
  const heldix = h('section', { class: 'profile-section' },
    sectionHead('Heldix-Capes', 'Andere HeldixClient-Spieler sehen dein Heldix-Cape im Spiel. Dort ersetzt es dein Minecraft-Cape.'));
  if (lockedRow) heldix.append(lockedRow);
  const catalog = p.heldixCapes.filter((c) => SAFE_ID.test(c.id));
  // Capes aus dem Cosmetics-Katalog (signiert, vom Team veröffentlicht) neben den eingebauten
  const extra = (page.cosmetics?.items ?? []).filter((i) => i.slot === 'cape' && i.cape);
  if (!catalog.length && !extra.length) {
    heldix.append(h('p', { class: 'profile-locked' }, uiIcon('info'), h('span', { text: 'Keine Heldix-Capes gefunden.' })));
  } else {
    const selected = p.heldixCape && (catalog.some((c) => c.id === p.heldixCape) || extra.some((i) => i.id === p.heldixCape)) ? p.heldixCape : null;
    const lockTitle = microsoft ? 'Heldix-Dienst nicht erreichbar' : 'Nur mit Microsoft-Konto und Heldix-Dienst';
    const tiles = [
      capeTile({ choice: NO_CAPE, label: 'Kein Heldix-Cape', art: noneArt(), checked: !selected, locked: heldixLocked, busyKey: 'heldix:none', title: heldixLocked ? lockTitle : 'Kein Heldix-Cape tragen', select: () => void selectHeldixCape(null) }),
      ...catalog.map((cape) => {
        const canvas = h('canvas', { width: String(THUMB_W), height: String(THUMB_H) });
        const thumb = { canvas, cape: builtinDef(cape), frame: -1 };
        thumbs.push(thumb);
        if (strips.has(thumb.cape.key)) drawThumb(thumb, 0);
        // Team-Capes (capes.json „team“): wie Katalog-Cosmetics gesperrt, wenn das Konto sicher nicht im Team ist
        const teamLock = cape.team && page.cosmetics?.team === false;
        return capeTile({
          choice: { kind: 'heldix', id: cape.id },
          label: cape.name,
          art: canvas,
          checked: cape.id === selected,
          locked: heldixLocked || teamLock,
          busyKey: `heldix:${cape.id}`,
          title: heldixLocked
            ? `${cape.name} – ${lockTitle}`
            : teamLock
              ? `${cape.name} – nur für das HeldixClient-Team`
              : `${cape.name}: ${cape.description}${cape.team ? ' (nur für das HeldixClient-Team)' : ''}`,
          team: cape.team,
          select: () => void selectHeldixCape(cape),
        });
      }),
      ...extra.map((item) => {
        const canvas = h('canvas', { width: String(THUMB_W), height: String(THUMB_H) });
        const thumb = { canvas, cape: catalogDef(item), frame: -1 };
        thumbs.push(thumb);
        if (strips.has(thumb.cape.key)) drawThumb(thumb, 0);
        const chooseLocked = heldixLocked || !page.cosmetics?.canChoose;
        const lockedBy = chooseLocked ? lockTitle : itemLock(item);
        return capeTile({
          choice: { kind: 'catalog', id: item.id },
          label: item.name,
          art: canvas,
          checked: item.id === selected,
          locked: !!lockedBy,
          team: item.teamOnly,
          reward: item.unlockOnly,
          onLocked: !chooseLocked && rewardLocked(item) ? openInvites : undefined,
          busyKey: `cosmetic:cape:${item.id}`,
          title: cosmeticTitle(item, lockedBy),
          select: () => void selectCosmetic('cape', item),
        });
      }),
    ];
    heldix.append(h('div', { class: `profile-cape-grid${heldixLocked ? ' locked' : ''}`, role: 'radiogroup', 'aria-label': 'Heldix-Cape' }, ...tiles));
    if (extra.some(rewardLocked)) heldix.append(rewardHint(extra.filter(rewardLocked)));
  }

  panel.append(heldix, mojang);
  return panel;
}

// ----- Reiter „Cosmetics“ -----
/** 3D-Vorschaubild (bzw. Partikelbilder) einer Katalog-Kachel; kommt nach, sobald gezeichnet */
function cosmeticArt(item: CosmeticItem): HTMLElement {
  const image = h('img', { class: 'profile-cosmetic-thumb', alt: '', draggable: 'false' });
  const art = h('span', { class: 'profile-cosmetic-art' }, image);
  if (thumbnails) {
    void thumbnails.get(item, 144).then((url) => {
      if (url) {
        image.src = url;
        image.classList.add('ready');
      } else art.replaceChildren(uiIcon('sparkles', 'profile-cape-missing'));
    });
  } else art.replaceChildren(uiIcon('sparkles', 'profile-cape-missing'));
  return art;
}

function cosmeticsView(): HTMLElement {
  const panel = h('div', { class: 'profile-panel' });
  const cosmetics = page.cosmetics;
  if (!cosmetics) {
    panel.append(h('div', { class: 'profile-loading-line' }, spinner(), 'Cosmetics werden geladen …'));
    return panel;
  }
  panel.append(h('p', { class: 'profile-info' }, uiIcon('info'),
    h('span', { text: 'Alle HeldixClient-Spieler sehen deine Cosmetics im Spiel – ohne etwas zu installieren. Fahr über ein Cosmetic, um es an deiner Figur anzuprobieren.' })));
  const locked = !cosmetics.canChoose;
  const reason = cosmetics.error ?? 'Nur mit Microsoft-Konto und Heldix-Dienst';
  if (locked) {
    panel.append(h('p', { class: 'profile-locked' }, uiIcon('lock'),
      h('span', { text: cosmetics.items.length ? `${reason} Vorschau geht trotzdem.` : reason }),
      cosmetics.error && /erreichbar|antwortet/.test(cosmetics.error) ? retryButton() : null));
  } else if (cosmetics.error) {
    panel.append(h('p', { class: 'profile-locked' }, uiIcon('info'), h('span', { text: cosmetics.error }), retryButton()));
  }
  if (!cosmetics.items.some((i) => i.slot !== 'cape')) {
    if (!cosmetics.error) panel.append(h('div', { class: 'content-empty' }, uiIcon('sparkles', 'empty-icon'),
      h('div', { class: 'content-empty-title', text: 'Noch keine Cosmetics' }),
      h('div', { text: 'Sobald das Team welche veröffentlicht, findest du sie hier.' })));
    return panel;
  }
  const lockTitle = locked ? reason : null;
  for (const slot of MODEL_SLOTS) {
    const items = cosmetics.items.filter((i) => i.slot === slot);
    if (!items.length) continue;
    const info = SLOT_INFO[slot];
    const worn = wornCosmetic(slot);
    const tiles = [
      capeTile({
        cosmetic: { slot, id: null },
        label: info.none,
        art: noneArt(),
        square: true,
        // Auswahl unbekannt (ohne Dienst): nichts als gewählt zeigen
        checked: cosmetics.selection !== null && !worn,
        locked,
        busyKey: `cosmetic:${slot}:none`,
        title: lockTitle ?? `${info.title}: ${info.none}`,
        select: () => void selectCosmetic(slot, null),
      }),
      ...items.map((item) => {
        const lockedBy = lockTitle ?? itemLock(item);
        return capeTile({
          cosmetic: { slot, id: item.id },
          label: item.name,
          art: cosmeticArt(item),
          square: true,
          checked: worn?.id === item.id,
          locked: !!lockedBy,
          team: item.teamOnly,
          reward: item.unlockOnly,
          onLocked: !lockTitle && rewardLocked(item) ? openInvites : undefined,
          busyKey: `cosmetic:${slot}:${item.id}`,
          title: cosmeticTitle(item, lockedBy),
          select: () => void selectCosmetic(slot, item),
        });
      }),
    ];
    panel.append(h('section', { class: 'profile-section', 'data-slot': slot },
      sectionHead(info.title, info.text),
      h('div', { class: `profile-cape-grid${locked ? ' locked' : ''}`, role: 'radiogroup', 'aria-label': info.title }, ...tiles),
      items.some(rewardLocked) ? rewardHint(items.filter(rewardLocked)) : null));
  }
  return panel;
}

function setTab(tab: Tab): void {
  if (page.tab === tab || !ui) return;
  page.tab = tab;
  window.clearTimeout(hoverTimer);
  page.hoverSkin = null;
  page.hoverCape = null;
  page.hoverCosmetic = null;
  renderBar();
  renderBody();
  ui.scroll.scrollTop = 0;
  renderStage();
  void syncViewer();
  turnTo(tab === 'capes' ? BACK_ANGLE : FRONT_ANGLE);
  updateRunning();
}

// ---------- Aufbau ----------
function build(root: HTMLElement): Ui {
  const sub = h('p', { class: 'page-sub' });
  const head = h('div', { class: 'page-head' }, h('h2', { class: 'page-title', text: 'Skins & Cosmetics' }), sub);

  const canvas = h('canvas', { class: 'profile-canvas', 'aria-label': '3D-Vorschau deiner Figur, zum Drehen ziehen' });
  const fallback = h('canvas', { class: 'profile-fallback', width: '16', height: '32', hidden: true });
  const hint = h('div', { class: 'profile-stage-hint', hidden: true });
  const tag = h('button', { class: 'profile-stage-tag', type: 'button', hidden: true, onclick: () => page.pinnedSkin && togglePin(page.pinnedSkin) });
  const motion = h('button', { class: 'icon-button profile-motion', type: 'button' });
  motion.addEventListener('click', () => {
    page.motion = !page.motion;
    if (!page.motion) dragging = false;
    renderStage();
    updateRunning();
    // Standbild statt Animation: erstes Bild zeigen
    for (const thumb of thumbs) if (strips.has(thumb.cape.key)) drawThumb(thumb, page.motion ? thumb.frame : 0);
  });
  const anims = h('div', { class: 'profile-anims', role: 'group', hidden: true });
  const stageView = h('div', { class: 'profile-stage-view' }, canvas, fallback, hint, tag, motion, anims);
  const stageName = h('div', { class: 'profile-stage-name' });
  const stageSub = h('div', { class: 'profile-stage-sub' });
  const elytra = h('button', { class: 'ghost small profile-toggle', type: 'button', 'aria-pressed': 'false' }, 'Elytra');
  elytra.addEventListener('click', () => {
    page.elytra = !page.elytra;
    if (viewer?.playerObject.backEquipment) viewer.playerObject.backEquipment = backEquipment();
    renderStage();
  });
  const stage = h('div', { class: 'profile-stage' },
    stageView,
    h('div', { class: 'profile-stage-foot' }, h('div', { class: 'profile-stage-text' }, stageName, stageSub), elytra));

  const skinCount = h('span', { class: 'profile-count' });
  const tabSkins = h('button', { type: 'button', role: 'tab', class: 'active', onclick: () => setTab('skins') }, 'Skins', skinCount);
  const tabCapes = h('button', { type: 'button', role: 'tab', onclick: () => setTab('capes') }, 'Capes');
  const tabCosmetics = h('button', { type: 'button', role: 'tab', onclick: () => setTab('cosmetics') }, 'Cosmetics');
  const resetButton = h('button', { class: 'ghost', type: 'button', onclick: () => void resetSkin() });
  const addButton = h('button', { class: 'primary', type: 'button', title: 'PNG-Datei auswählen (64 × 64 oder 64 × 32 Pixel)', onclick: () => void importSkins() },
    uiIcon('plus', 'btn-icon'), 'Skin hinzufügen');
  const actions = h('div', { class: 'profile-bar-actions' }, resetButton, addButton);
  const scroll = h('div', { class: 'profile-scroll' });
  const main = h('div', { class: 'profile-main' },
    h('div', { class: 'profile-bar' }, h('div', { class: 'tabs', role: 'tablist' }, tabSkins, tabCapes, tabCosmetics), actions),
    scroll,
    h('div', { class: 'drop-overlay' }, h('div', { text: 'PNG-Skins hier ablegen' })));

  root.replaceChildren(head, h('div', { class: 'profile-layout' }, stage, main));
  return { root, sub, main, scroll, tabSkins, tabCapes, tabCosmetics, skinCount, actions, addButton, resetButton, stageView, canvas, fallback, hint, tag, motion, stageName, stageSub, elytra, anims };
}

/** einmal beim Start; invites = Sprung zu Freunde → Einladen */
export function initProfile(invites?: () => void): void {
  if (invites) openInvites = invites;
  const root = document.getElementById('profile-root');
  if (!root || ui) return;
  root.classList.add('profile-page');
  ui = build(root);
  setupDrop(root);

  // Sichtbarkeit: app.ts schaltet die Klasse "active" an der Ansicht um
  const view = root.closest<HTMLElement>('.view');
  if (view) {
    new MutationObserver(() => setActive(view.classList.contains('active'))).observe(view, { attributes: true, attributeFilter: ['class'] });
  }
  document.addEventListener('visibilitychange', updateRunning);
  reduceMotion.addEventListener('change', () => {
    page.motion = !reduceMotion.matches;
    renderStage();
    updateRunning();
  });
  api.onAccountsChanged(onAccountsChanged);
  render();
}

/** jedes Mal, wenn die Seite gezeigt wird */
export function activateProfile(): void {
  if (!ui) return;
  setActive(true);
  ensureViewer();
  const accountChanged = page.accountKey !== null && activeAccountKey() !== page.accountKey;
  if (page.accountKey === null || accountChanged) void load({ reset: accountChanged });
  else if (!page.loading && (page.stale || !page.profile || Date.now() - page.loadedAt > 60_000)) void load({ silent: !!page.profile });
  else render();
}

/** Freischaltungen haben sich geändert (neue Belohnung): Cosmetics neu laden bzw. beim nächsten Öffnen */
export function reloadCosmetics(): void {
  page.stale = true;
  if (page.active) void loadCosmetics();
}

/** Seite mit dem Reiter zu diesem Cosmetic öffnen (Capes für Capes, sonst Cosmetics); vorher activateProfile() */
export async function showProfileCosmetic(id: string): Promise<void> {
  if (!ui) return;
  let item = cosmeticItem(id);
  if (!item) {
    await loadCosmetics();
    item = cosmeticItem(id);
  }
  setTab(item?.slot === 'cape' ? 'capes' : 'cosmetics');
}
