// 3D-Figur auf der Startseite: der Skin des aktiven Kontos mit den eigenen Cosmetics (Kopf, Rücken, Aura, Begleiter),
// drehbar mit der Maus. Nutzt skinview3d (MIT-Lizenz), geladen als fertige Browser-Version aus vendor/; die Cosmetics
// zeichnet cosmetic-scene.ts.
import type { CosmeticItem, CosmeticModelSlot, SkinInfo } from '../shared/api';
import { CosmeticRig, type RigViewer } from './cosmetic-scene.js';
import { $, api } from './core.js';

/** Nur die Teile von skinview3d, die hier gebraucht werden. */
interface Animation {
  speed: number;
}
interface OrbitControls {
  enableZoom: boolean;
  enablePan: boolean;
  enableRotate: boolean;
  minPolarAngle: number;
  maxPolarAngle: number;
  rotateSpeed: number;
  getAzimuthalAngle(): number;
  update(): void;
  addEventListener(type: 'start' | 'end', listener: () => void): void;
}
interface SkinViewer {
  animation: Animation | null;
  nameTag: unknown;
  renderPaused: boolean;
  zoom: number;
  fov: number;
  camera: { position: { x: number; y: number; z: number } };
  controls: OrbitControls;
  playerObject: { rotation: { y: number } };
  playerWrapper: { rotation: { y: number } };
  loadSkin(source: string | null, options?: { model?: 'default' | 'slim' | 'auto-detect' }): Promise<void> | void;
  setSize(width: number, height: number): void;
}
interface SkinView3d {
  SkinViewer: new (options: { canvas: HTMLCanvasElement; width: number; height: number; fov?: number; zoom?: number }) => SkinViewer;
  IdleAnimation: new () => Animation;
  WaveAnimation: new (arm?: 'left' | 'right') => Animation;
  NameTagObject: new (text: string, options?: { font?: string; textStyle?: string; backgroundStyle?: string; margin?: [number, number, number, number] }) => unknown;
}
declare global {
  interface Window {
    skinview3d?: SkinView3d;
  }
}

let viewer: SkinViewer | null = null;
let rig: CosmeticRig | null = null;
let shownSkin = '';
let active = true;
/** Konto, dessen Cosmetics gerade geladen sind ('' = keins) */
let cosmeticsFor = '';
let cosmeticsSeq = 0;

function hint(text: string | null): void {
  const el = $('#figure-hint');
  el.hidden = !text;
  el.textContent = text ?? '';
}

/**
 * Drehen nur waagerecht (kein Kippen, kein Zoomen). Nach dem Loslassen dreht sich die Figur
 * von selbst wieder nach vorn, statt verdreht stehen zu bleiben.
 */
function setupControls(target: SkinViewer): void {
  const controls = target.controls;
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.minPolarAngle = Math.PI / 2;
  controls.maxPolarAngle = Math.PI / 2;
  controls.rotateSpeed = 0.7;

  let timer = 0;
  let frame = 0;
  const stop = () => {
    window.clearTimeout(timer);
    window.cancelAnimationFrame(frame);
  };
  const springBack = () => {
    const camera = target.camera.position;
    const radius = Math.hypot(camera.x, camera.z);
    const step = () => {
      const angle = controls.getAzimuthalAngle();
      const next = Math.abs(angle) < 0.004 ? 0 : angle * 0.88;
      camera.x = radius * Math.sin(next);
      camera.z = radius * Math.cos(next);
      controls.update();
      if (next !== 0) frame = window.requestAnimationFrame(step);
    };
    step();
  };
  controls.addEventListener('start', stop);
  controls.addEventListener('end', () => {
    stop();
    timer = window.setTimeout(springBack, 1500);
  });
}

function create(): SkinViewer | null {
  const lib = window.skinview3d;
  if (!lib) return null;
  const host = $('#figure');
  const canvas = $<HTMLCanvasElement>('#figure-canvas');
  const created = new lib.SkinViewer({ canvas, width: host.clientWidth || 400, height: host.clientHeight || 300, fov: 34, zoom: 0.7 });
  // zur Begrüßung links gedreht – auf der äußeren Gruppe, die keine Animation zurücksetzt
  created.playerWrapper.rotation.y = 0.42;
  setupControls(created);
  new ResizeObserver(() => {
    if (host.clientWidth > 0 && host.clientHeight > 0) created.setSize(host.clientWidth, host.clientHeight);
  }).observe(host);
  // Kein Rendern, wenn das Fenster unsichtbar ist
  document.addEventListener('visibilitychange', () => {
    created.renderPaused = document.hidden || !active;
  });
  try {
    rig = CosmeticRig.attach(created as unknown as RigViewer);
    rig?.autoZoom(0.7);
  } catch {
    rig = null;
  }
  // Auswahl auf „Skins & Cosmetics“ geändert
  api.onCosmeticsChanged(() => {
    if (cosmeticsFor) void loadCosmetics(cosmeticsFor);
  });
  return created;
}

/** Eigene Cosmetics an die Figur (ohne Dienst oder Konto: keine). Fehler bleiben still. */
async function loadCosmetics(account: string): Promise<void> {
  const seq = ++cosmeticsSeq;
  cosmeticsFor = account;
  if (!rig) return;
  try {
    const state = await api.getCosmetics();
    if (seq !== cosmeticsSeq) return;
    const worn = (slot: CosmeticModelSlot): CosmeticItem | null => {
      const id = state.selection?.[slot];
      return (id && state.items.find((i) => i.id === id && i.slot === slot)) || null;
    };
    await rig.showAll({ head: worn('head'), back: worn('back'), aura: worn('aura'), companion: worn('companion') });
  } catch {
    // Figur bleibt ohne Cosmetics
  }
}

/** Zeigt den Skin des Kontos (oder einen Hinweis). */
export async function showFigure(skin: SkinInfo | null, name: string | null): Promise<void> {
  viewer ??= create();
  if (!viewer) {
    hint('Die 3D-Ansicht ist nicht verfügbar.');
    return;
  }
  const lib = window.skinview3d!;
  if (!skin) {
    if (shownSkin) viewer.loadSkin(null);
    shownSkin = '';
    cosmeticsSeq++;
    cosmeticsFor = '';
    rig?.clear();
    hint(name ? 'Deine Figur erscheint nach dem ersten Spielstart.' : 'Melde dich an, um deine Figur zu sehen.');
  } else {
    if ((name ?? '') !== cosmeticsFor) void loadCosmetics(name ?? '');
    hint(null);
    if (skin.dataUrl !== shownSkin) {
      shownSkin = skin.dataUrl;
      await viewer.loadSkin(skin.dataUrl, { model: skin.slim === null ? 'auto-detect' : skin.slim ? 'slim' : 'default' });
      // Kurz winken, dann ruhig stehen
      viewer.animation = new lib.WaveAnimation('right');
      window.setTimeout(() => {
        if (viewer) viewer.animation = new lib.IdleAnimation();
      }, 2600);
    }
  }
}

/** Rendern pausieren, solange die Startseite nicht sichtbar ist. */
export function setFigureActive(visible: boolean): void {
  active = visible;
  if (viewer) viewer.renderPaused = !visible || document.hidden;
}
