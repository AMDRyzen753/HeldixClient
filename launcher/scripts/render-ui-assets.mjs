// Erzeugt die Grafiken der Heldix-Oberfläche im Spiel (mod/src/main/resources/assets/heldixclient):
//   textures/gui/heldix/icons.png + icons.json  – eigenes Icon-Set (weiß, wird im Spiel eingefärbt), 64 px je Icon
//   textures/gui/heldix/shapes.png              – kantengeglättete Ecken für abgerundete Flächen und Rahmen
//   textures/gui/heldix/shadow.png              – weicher Schatten (Neun-Teile-Grafik)
//   textures/gui/heldix/background.png          – Hintergrund des Hauptmenüs (gleiches Motiv wie im Launcher)
//   textures/gui/heldix/logo.png                – HeldixClient-Symbol
//   font/ui_<stil>_<skalierung>.json            – Schrift Inter je GUI-Skalierung (scharf ohne Skalieren)
//   font/badge.json + textures/font/badge*.png  – Heldix-Symbol als Schriftzeichen (U+E000–U+E003, je Rolle eins)
// Aufruf: npm run ui-assets
import { app, BrowserWindow } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const launcherDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const assets = path.join(launcherDir, '..', 'mod', 'src', 'main', 'resources', 'assets', 'heldixclient');
const out = path.join(assets, 'textures', 'gui', 'heldix');
const fontDir = path.join(assets, 'font');

// ---------------------------------------------------------------------------------------------
// Icons: 24er-Raster, 2 px Linien, runde Enden. Eigene Zeichnungen für HeldixClient.
// ---------------------------------------------------------------------------------------------

/** Zahnrad als Pfad (8 Zähne) */
function gear() {
  const points = [];
  const teeth = 8;
  for (let i = 0; i < teeth * 4; i++) {
    const angle = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / 2 + Math.PI / (teeth * 4);
    const r = i % 4 < 2 ? 9 : 6.8;
    points.push([12 + Math.cos(angle) * r, 12 + Math.sin(angle) * r]);
  }
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ') + ' Z';
  return `<path d="${d}"/><circle cx="12" cy="12" r="3"/>`;
}

const FILL = 'fill="#fff" stroke="none"';
const ICONS = {
  // Navigation
  home: '<path d="M4 11 L12 4.5 L20 11"/><path d="M6 9.5 V19.5 H18 V9.5"/><path d="M10 19.5 V14.5 H14 V19.5"/>',
  world: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12 H20.5"/><path d="M12 3.5 C8.3 7.5 8.3 16.5 12 20.5"/><path d="M12 3.5 C15.7 7.5 15.7 16.5 12 20.5"/>',
  server: '<rect x="4" y="4" width="16" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/><path d="M7.5 7.5 H7.6 M7.5 16.5 H7.6 M11.5 7.5 H16.5 M11.5 16.5 H16.5"/>',
  realms: '<path d="M5 20 V9 H8 V5.5 H10.5 V9 H13.5 V5.5 H16 V9 H19 V20 Z"/><path d="M10 20 V15.5 A2 2 0 0 1 14 15.5 V20"/>',
  modules: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
  shader: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5 V4.8 M12 19.2 V21.5 M2.5 12 H4.8 M19.2 12 H21.5 M5.3 5.3 L6.9 6.9 M17.1 17.1 L18.7 18.7 M5.3 18.7 L6.9 17.1 M17.1 6.9 L18.7 5.3"/>',
  performance: '<path d="M13 3 L5 13.5 H11.5 L10.5 21 L19 10.5 H12.5 Z"/>',
  addons: '<path d="M5 8 H9.5 A2.5 2.5 0 1 1 14.5 8 H17 V11.5 A2.5 2.5 0 1 1 17 16.5 V20 H5 Z"/>',
  hud: '<rect x="3.5" y="5" width="17" height="14" rx="2.2"/><path d="M3.5 9.5 H20.5 M9 9.5 V19"/>',
  settings: gear(),
  options: `<path d="M4 7 H20 M4 12 H20 M4 17 H20"/><circle cx="9" cy="7" r="2.2" ${FILL}/><circle cx="15" cy="12" r="2.2" ${FILL}/><circle cx="7.5" cy="17" r="2.2" ${FILL}/>`,
  quit: '<path d="M12 3.5 V11"/><path d="M7.2 6.6 A7 7 0 1 0 16.8 6.6"/>',
  play: `<path d="M8.5 5.5 V18.5 L18.5 12 Z" fill="#fff"/>`,
  pause: `<rect x="6.5" y="5" width="4" height="14" rx="1.2" ${FILL}/><rect x="13.5" y="5" width="4" height="14" rx="1.2" ${FILL}/>`,
  'skip-next': `<path d="M5.5 6 V18 L14.5 12 Z" fill="#fff"/><rect x="16" y="5.5" width="3" height="13" rx="1.2" ${FILL}/>`,
  'skip-previous': `<path d="M18.5 6 V18 L9.5 12 Z" fill="#fff"/><rect x="5" y="5.5" width="3" height="13" rx="1.2" ${FILL}/>`,
  music: `<path d="M9 17.5 V5.8 L19 3.8 V15.5"/><circle cx="6.5" cy="17.5" r="2.6" ${FILL}/><circle cx="16.5" cy="15.5" r="2.6" ${FILL}/>`,
  back: '<path d="M19 12 H5.5 M11 6 L5 12 L11 18"/>',
  // Aktionen
  plus: '<path d="M12 5 V19 M5 12 H19"/>',
  edit: '<path d="M4.5 19.5 L5.5 15 L15.5 5 A2.1 2.1 0 0 1 19 8.5 L9 18.5 Z"/><path d="M13.5 7 L17 10.5"/>',
  trash: '<path d="M4 7 H20 M9.5 7 V4.5 H14.5 V7 M6 7 L7 19.5 H17 L18 7 M10 11 V16 M14 11 V16"/>',
  refresh: '<path d="M19.5 12 A7.5 7.5 0 1 1 17.3 6.7"/><path d="M19.5 4 V8.5 H15"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15 L20 20"/>',
  check: '<path d="M5 12.5 L9.5 17 L19 7.5"/>',
  close: '<path d="M6 6 L18 18 M18 6 L6 18"/>',
  'chevron-right': '<path d="M9.5 5.5 L16 12 L9.5 18.5"/>',
  'chevron-left': '<path d="M14.5 5.5 L8 12 L14.5 18.5"/>',
  'chevron-down': '<path d="M5.5 9.5 L12 16 L18.5 9.5"/>',
  connect: '<path d="M14 4 H18 A2 2 0 0 1 20 6 V18 A2 2 0 0 1 18 20 H14"/><path d="M10 16 L14 12 L10 8 M14 12 H4"/>',
  undo: '<path d="M9 14 L4 9 L9 4"/><path d="M4 9 H14.5 A5.5 5.5 0 0 1 14.5 20 H11"/>',
  reset: '<path d="M4.5 12 A7.5 7.5 0 1 0 6.7 6.7"/><path d="M4.5 4 V8.5 H9"/>',
  grid: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.33 H20 M4 14.67 H20 M9.33 4 V20 M14.67 4 V20"/>',
  magnet: '<path d="M5 4 H9.5 V11 A2.5 2.5 0 0 0 14.5 11 V4 H19 V11 A7 7 0 0 1 5 11 Z"/><path d="M5 8 H9.5 M14.5 8 H19"/>',
  list: '<path d="M9 6 H20 M9 12 H20 M9 18 H20 M4.5 6 H4.6 M4.5 12 H4.6 M4.5 18 H4.6"/>',
  eye: '<path d="M2.5 12 C5 7 8.5 5 12 5 C15.5 5 19 7 21.5 12 C19 17 15.5 19 12 19 C8.5 19 5 17 2.5 12 Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M2.5 12 C5 7 8.5 5 12 5 C15.5 5 19 7 21.5 12 C19 17 15.5 19 12 19 C8.5 19 5 17 2.5 12 Z"/><circle cx="12" cy="12" r="3"/><path d="M4 4 L20 20"/>',
  folder: '<path d="M3.5 7 A2 2 0 0 1 5.5 5 H9.5 L11.5 7 H18.5 A2 2 0 0 1 20.5 9 V17 A2 2 0 0 1 18.5 19 H5.5 A2 2 0 0 1 3.5 17 Z"/>',
  language: '<path d="M4 5.5 H13 M8.5 3.5 V5.5 M5.8 5.5 C6.8 9 9 11.5 12.5 13 M11.2 5.5 C10.2 9 8 11.5 4.5 13"/><path d="M13 20.5 L16.8 11.5 L20.5 20.5 M14.3 17.5 H19.3"/>',
  accessibility: `<circle cx="12" cy="4.8" r="1.9" ${FILL}/><path d="M5 8.5 L12 10 L19 8.5 M12 10 V14 M12 14 L8.5 20.5 M12 14 L15.5 20.5"/>`,
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11 V16.5 M12 7.6 H12.1"/>',
  warning: '<path d="M12 4 L21 19.5 H3 Z"/><path d="M12 10 V14 M12 17 H12.1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20 A7.5 7.5 0 0 1 19.5 20"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5 V12 L15 14"/>',
  hourglass: '<path d="M7 4 H17 M7 20 H17 M8 4 C8 9 16 9 16 12 C16 15 8 15 8 20 M16 4 C16 9 8 9 8 12 C8 15 16 15 16 20"/>',
  lightbulb: '<path d="M9 18 H15 M10 21 H14"/><path d="M12 3 A6 6 0 0 0 8.5 13.9 C9.1 14.4 9.5 15.1 9.5 16 H14.5 C14.5 15.1 14.9 14.4 15.5 13.9 A6 6 0 0 0 12 3 Z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5 V7.5 A4 4 0 0 1 16 7.5 V10.5"/>',
  external: '<path d="M14 4 H20 V10 M20 4 L11 13"/><path d="M18 14 V18 A2 2 0 0 1 16 20 H6 A2 2 0 0 1 4 18 V8 A2 2 0 0 1 6 6 H10"/>',
  lan: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8 V12 M6 16 V12 H18 V16"/>',
  more: `<circle cx="6" cy="12" r="1.7" ${FILL}/><circle cx="12" cy="12" r="1.7" ${FILL}/><circle cx="18" cy="12" r="1.7" ${FILL}/>`,
  // Module
  fps: '<path d="M4.5 17 A8.5 8.5 0 1 1 19.5 17"/><path d="M12 14 L16 9"/><circle cx="12" cy="14" r="1.2"/>',
  mouse: '<rect x="6.5" y="3.5" width="11" height="17" rx="5.5"/><path d="M12 7 V10.5"/>',
  signal: '<path d="M5 19 V16 M9.67 19 V13 M14.33 19 V10 M19 19 V6.5"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15 9 L13.2 13.2 L9 15 L10.8 10.8 Z"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10 H6.6 M10 10 H10.1 M13.5 10 H13.6 M17 10 H17.1 M8 14 H16"/>',
  zoom: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15 L20 20 M10.5 8 V13 M8 10.5 H13"/>',
  chat: '<path d="M4 6.5 A2.5 2.5 0 0 1 6.5 4 H17.5 A2.5 2.5 0 0 1 20 6.5 V14 A2.5 2.5 0 0 1 17.5 16.5 H10 L5.5 20 V16.5 A2.5 2.5 0 0 1 4 14 Z"/>',
  cube: '<path d="M12 3 L20 7.5 V16.5 L12 21 L4 16.5 V7.5 Z"/><path d="M4 7.5 L12 12 L20 7.5 M12 12 V21"/>',
  sparkles: '<path d="M10 3.5 L11.6 8.4 L16.5 10 L11.6 11.6 L10 16.5 L8.4 11.6 L3.5 10 L8.4 8.4 Z"/><path d="M17.5 14.5 L18.3 16.7 L20.5 17.5 L18.3 18.3 L17.5 20.5 L16.7 18.3 L14.5 17.5 L16.7 16.7 Z"/>',
  palette: '<path d="M12 3.5 A8.5 8.5 0 0 0 12 20.5 C13.3 20.5 13.8 19.6 13.3 18.6 C12.6 17.2 13.6 15.8 15.1 15.8 H17 A3.5 3.5 0 0 0 20.5 12.3 C20.5 7.4 16.7 3.5 12 3.5 Z"/><circle cx="8" cy="11" r="1.2" fill="#fff"/><circle cx="11" cy="7.5" r="1.2" fill="#fff"/><circle cx="15.5" cy="8.5" r="1.2" fill="#fff"/>',
  monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20 H15 M12 16.5 V20"/>',
  star: '<path d="M12 3.8 L14.5 9 L20.2 9.7 L16 13.6 L17.1 19.3 L12 16.5 L6.9 19.3 L8 13.6 L3.8 9.7 L9.5 9 Z"/>',
  cape: '<path d="M7.5 4.5 H16.5 L19.5 19 Q15.8 20.6 12 18.6 Q8.2 20.6 4.5 19 Z"/><path d="M9.2 4.5 Q12 8 14.8 4.5"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2.2"/><circle cx="9" cy="10" r="1.7"/><path d="M4 17.5 L9.5 12.8 L13 15.8 L16 13.3 L20 16.8"/>',
  // Loader (Kacheln der Instanzen): Heldix = „H“ aus dem Logo, Fabric = Garnrolle, Vanilla = Block mit Grasschicht
  'loader-heldix': `<rect x="4" y="4.2" width="5" height="15.6" rx="1.3" ${FILL}/><rect x="15" y="4.2" width="5" height="15.6" rx="1.3" ${FILL}/><path d="M9 13.1 L15 9.2 L15 13.9 L9 17.8 Z" ${FILL}/>`,
  'loader-fabric': '<rect x="5.5" y="3.5" width="13" height="3" rx="1.2"/><rect x="5.5" y="17.5" width="13" height="3" rx="1.2"/><path d="M8 6.5 V17.5 M16 6.5 V17.5 M8 9.5 L16 11.5 M8 13 L16 15"/>',
  'loader-vanilla': `<path d="M12 3 L20 7.5 V16.5 L12 21 L4 16.5 V7.5 Z"/><path d="M12 3 L20 7.5 L12 12 L4 7.5 Z" ${FILL}/><path d="M12 12 V21"/>`,
  // Launcher
  terminal: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9 L10 12 L7 15 M13 15 H17"/>',
  chip: '<rect x="5" y="5" width="14" height="14" rx="2.5"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2.5 V5 M15 2.5 V5 M9 19 V21.5 M15 19 V21.5 M2.5 9 H5 M2.5 15 H5 M19 9 H21.5 M19 15 H21.5"/>',
  cup: '<path d="M5 9 H16 V14 A5 5 0 0 1 11 19 H10 A5 5 0 0 1 5 14 Z"/><path d="M16 10.5 H17.5 A2.5 2.5 0 0 1 17.5 15.5 H16"/><path d="M8.5 3.5 C8 4.8 9.5 5.5 9 7 M12.5 3.5 C12 4.8 13.5 5.5 13 7"/>',
  code: '<path d="M8 7 L3 12 L8 17 M16 7 L21 12 L16 17 M13.5 5 L10.5 19"/>',
  download: '<path d="M12 4 V15 M7 10 L12 15 L17 10 M5 20 H19"/>',
  file: '<path d="M14 3 H7 A2 2 0 0 0 5 5 V19 A2 2 0 0 0 7 21 H17 A2 2 0 0 0 19 19 V8 Z"/><path d="M14 3 V8 H19"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8 V6 A2 2 0 0 0 14 4 H6 A2 2 0 0 0 4 6 V14 A2 2 0 0 0 6 16 H8"/>',
  news: '<path d="M4 5 H17 V18 A2 2 0 0 0 19 20 H6 A2 2 0 0 1 4 18 Z"/><path d="M17 9 H20 V18 A2 2 0 0 1 18 20"/><path d="M7.5 9 H13.5 M7.5 12.5 H13.5 M7.5 16 H11"/>',
  'user-plus': '<circle cx="10" cy="8" r="4"/><path d="M3 20 A7 7 0 0 1 17 20 M19 8 V14 M16 11 H22"/>',
  microsoft: `<rect x="4" y="4" width="7" height="7" rx="0.8" ${FILL}/><rect x="13" y="4" width="7" height="7" rx="0.8" ${FILL}/><rect x="4" y="13" width="7" height="7" rx="0.8" ${FILL}/><rect x="13" y="13" width="7" height="7" rx="0.8" ${FILL}/>`,
  // Module: Rüstung, Trank-Effekte, Dauersprint, Fadenkreuz, Wegpunkte, Freunde
  shield: '<path d="M12 3 L19.5 6 V11.5 C19.5 16 16.3 19.4 12 21 C7.7 19.4 4.5 16 4.5 11.5 V6 Z"/><path d="M9 12 L11.2 14.2 L15.5 9.8"/>',
  potion: '<path d="M9.5 3.5 H14.5 M10.5 3.5 V8.6 L5.6 16.4 A2.6 2.6 0 0 0 7.8 20.5 H16.2 A2.6 2.6 0 0 0 18.4 16.4 L13.5 8.6 V3.5"/><path d="M7.6 14.5 H16.4"/>',
  sprint: '<circle cx="14.5" cy="4.8" r="1.9"/><path d="M6 11.5 L9.5 8.3 L13.5 9.5 L11.5 14 L15 17 L14 21 M11.5 14 L8 16 L4.5 15.5 M13.5 9.5 L16.5 12.5 L19.5 11.5"/>',
  crosshair: `<circle cx="12" cy="12" r="7"/><path d="M12 2.5 V7.5 M12 16.5 V21.5 M2.5 12 H7.5 M16.5 12 H21.5"/><circle cx="12" cy="12" r="0.6" ${FILL}/>`,
  pin: '<path d="M12 21 C12 21 18.5 14.6 18.5 9.5 A6.5 6.5 0 0 0 5.5 9.5 C5.5 14.6 12 21 12 21 Z"/><circle cx="12" cy="9.5" r="2.3"/>',
  friends: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20 A6.5 6.5 0 0 1 15.5 20"/><path d="M15.5 4.8 A3.5 3.5 0 0 1 15.5 11.2 M18 14.2 A6.5 6.5 0 0 1 21.5 20"/>',
  send: '<path d="M20.5 3.5 L3.5 10.5 L10.5 13.5 L13.5 20.5 Z"/><path d="M20.5 3.5 L10.5 13.5"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6 L18 18"/>',
  flag: '<path d="M5.5 21 V3.5"/><path d="M5.5 4 H18 L15.5 8.5 L18 13 H5.5"/>',
};

const NAMES = Object.keys(ICONS);
const CELL = 64;
const COLUMNS = 8;
const ROWS = Math.ceil(NAMES.length / COLUMNS);

function iconSvg(name, cell = CELL) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="${cell}" viewBox="0 0 24 24" fill="none" stroke="#fff"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}

/** Icon-Atlas mit Zellen der Größe cell (64 px für große, 32 px für kleine Darstellung) */
const iconsHtml = (cell) => `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">
<div style="display:grid;grid-template-columns:repeat(${COLUMNS}, ${cell}px);grid-auto-rows:${cell}px;width:${COLUMNS * cell}px">
${NAMES.map((n) => `<div style="width:${cell}px;height:${cell}px">${iconSvg(n, cell)}</div>`).join('')}
</div></body></html>`;

// Vorschau für die Doku: alle Icons auf dunklem Grund mit Namen
const previewHtml = `<!doctype html><html><body style="margin:0;overflow:hidden;background:#0d1220;font:600 11px 'Segoe UI',sans-serif;color:#98a2b3">
<div style="display:grid;grid-template-columns:repeat(${COLUMNS}, 88px);gap:6px;padding:14px">
${NAMES.map((n) => `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 0;background:rgba(255,255,255,0.04);border-radius:10px">
<div style="width:32px;height:32px">${iconSvg(n).replace(`width="${CELL}" height="${CELL}"`, 'width="32" height="32"').replaceAll('#fff', '#e8edf5')}</div>${n}</div>`).join('\n')}
</div></body></html>`;

// ---------------------------------------------------------------------------------------------
// Heldix-Symbol je Rolle (Tab-Liste und Namensschild): Sechseck des Logos in der Farbe der Rolle, weißes Zeichen darin.
// U+E000 ist das Logo selbst (alle HeldixClient-Spieler); die Rollen meldet der Heldix-Dienst (siehe docs/dienst.md).
// ---------------------------------------------------------------------------------------------

const BADGE_HEXAGON = 'M82.68 22 Q100 12 117.32 22 L158.89 46 Q176.21 56 176.21 76 L176.21 124 Q176.21 144 158.89 154 L117.32 178 Q100 188 82.68 178 L41.11 154 Q23.79 144 23.79 124 L23.79 76 Q23.79 56 41.11 46 Z';
const BADGE_ROLES = [
  {
    // Team-Admin: rot, Krone
    name: 'admin',
    char: '\uE001',
    colors: ['#991b1b', '#dc2626', '#fb923c'],
    shadow: '#450a0a',
    symbol: '<path d="M52 136 L52 78 L77 101 L100 60 L123 101 L148 78 L148 136 Z" stroke="#fff" stroke-width="10" stroke-linejoin="round"/>',
  },
  {
    // Moderator: grün, Schild mit Haken
    name: 'moderator',
    char: '\uE002',
    colors: ['#047857', '#10b981', '#6ee7b7'],
    shadow: '#022c22',
    symbol: '<path d="M100 52 L146 68 V100 C146 128 127 146 100 157 C73 146 54 128 54 100 V68 Z"/>'
      + '<path d="M78 104 L94 120 L123 89" fill="none" stroke="#0d9466" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    // Addon-Entwickler: violett, „</>“
    name: 'developer',
    char: '\uE003',
    colors: ['#5b21b6', '#8b5cf6', '#e879f9'],
    shadow: '#2e1065',
    symbol: '<path d="M77 68 L45 100 L77 132 M123 68 L155 100 L123 132 M111 60 L89 140" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>',
  },
];

/** Symbol einer Rolle als SVG (gleicher Aufbau wie logo.svg: Verlauf, Glanz, Kante, Zeichen mit Schatten) */
function badgeSvg(role) {
  const [c0, c1, c2] = role.colors;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="256" height="256">
  <defs>
    <linearGradient id="fill" x1="0.15" y1="1" x2="0.85" y2="0">
      <stop offset="0" stop-color="${c0}"/><stop offset="0.55" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.32"/><stop offset="0.55" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="0.6" stop-color="#ffffff" stop-opacity="0.08"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.15"/>
    </linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="${role.shadow}" flood-opacity="0.5"/>
    </filter>
  </defs>
  <path d="${BADGE_HEXAGON}" fill="url(#fill)"/>
  <path d="${BADGE_HEXAGON}" fill="url(#sheen)"/>
  <path d="${BADGE_HEXAGON}" fill="none" stroke="url(#edge)" stroke-width="2"/>
  <g filter="url(#shadow)" fill="#ffffff">${role.symbol}</g>
</svg>`;
}

// ---------------------------------------------------------------------------------------------
// Ecken, Schatten (direkt berechnet, ohne Browser)
// ---------------------------------------------------------------------------------------------

const MAX_R = 40;

/** Anteil eines Pixels, der in der Form liegt (8×8 Unterabtastung) */
function coverage(inside, px, py) {
  let hits = 0;
  for (let sy = 0; sy < 8; sy++) {
    for (let sx = 0; sx < 8; sx++) {
      if (inside(px + (sx + 0.5) / 8, py + (sy + 0.5) / 8)) hits++;
    }
  }
  return hits / 64;
}

/**
 * Ecken-Atlas: für jeden Radius r (1..MAX_R) ein r×r-Feld; Spalte ab r(r-1)/2.
 * Zeilen (je MAX_R hoch): 0-3 gefüllt (oben links, oben rechts, unten links, unten rechts),
 * 4-7 Rahmen 1 px, 8-11 Rahmen 2 px.
 */
function shapes() {
  const width = (MAX_R * (MAX_R + 1)) / 2;
  const height = MAX_R * 12;
  const data = Buffer.alloc(width * height * 4);
  for (let r = 1; r <= MAX_R; r++) {
    const u = (r * (r - 1)) / 2;
    for (let kind = 0; kind < 3; kind++) {
      const stroke = kind === 0 ? 0 : kind;
      for (let corner = 0; corner < 4; corner++) {
        const v = (kind * 4 + corner) * MAX_R;
        // Mittelpunkt des Kreises im Feld je nach Ecke
        const cx = corner === 0 || corner === 2 ? r : 0;
        const cy = corner === 0 || corner === 1 ? r : 0;
        const inside = (x, y) => {
          const d = Math.hypot(x - cx, y - cy);
          return stroke === 0 ? d <= r : d <= r && d >= r - stroke;
        };
        for (let y = 0; y < r; y++) {
          for (let x = 0; x < r; x++) {
            const a = Math.round(coverage(inside, x, y) * 255);
            const i = ((v + y) * width + u + x) * 4;
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = a;
          }
        }
      }
    }
  }
  return png(width, height, data);
}

/** Weicher Schatten: abgerundetes Rechteck (32..64, Radius 10) mit Gauß-Unschärfe, 96×96 */
function shadow() {
  const size = 96;
  const alpha = new Float32Array(size * size);
  const inside = (x, y) => {
    const qx = Math.max(32 + 10 - x, 0, x - (64 - 10));
    const qy = Math.max(32 + 10 - y, 0, y - (64 - 10));
    return Math.hypot(qx, qy) <= 10;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) alpha[y * size + x] = coverage(inside, x, y);
  const sigma = 9;
  const radius = Math.ceil(sigma * 3);
  const kernel = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const k = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(k);
    sum += k;
  }
  const blur = (src, horizontal) => {
    const dst = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let acc = 0;
        for (let i = -radius; i <= radius; i++) {
          const sx = horizontal ? x + i : x;
          const sy = horizontal ? y : y + i;
          if (sx < 0 || sy < 0 || sx >= size || sy >= size) continue;
          acc += src[sy * size + sx] * kernel[i + radius];
        }
        dst[y * size + x] = acc / sum;
      }
    }
    return dst;
  };
  const blurred = blur(blur(alpha, true), false);
  const data = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4 + 3] = Math.round(Math.min(1, blurred[i]) * 255);
  }
  return png(size, size, data);
}

// ---------------------------------------------------------------------------------------------
// PNG schreiben (RGBA, ohne Abhängigkeiten)
// ---------------------------------------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // Bit je Kanal
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------------------------
// Schriften: Inter für jede GUI-Skalierung (oversample = Skalierung → 1 Texel = 1 Bildschirmpixel)
// ---------------------------------------------------------------------------------------------

const FONT_STYLES = {
  small: { file: 'inter-medium.ttf', size: 7, shift: -0.5 },
  body: { file: 'inter-medium.ttf', size: 8.5, shift: 0 },
  label: { file: 'inter-semibold.ttf', size: 8.5, shift: 0 },
  title: { file: 'inter-bold.ttf', size: 12, shift: -1.5 },
  hero: { file: 'inter-bold.ttf', size: 22, shift: 9 },
};

async function writeFonts() {
  await mkdir(fontDir, { recursive: true });
  for (const [style, def] of Object.entries(FONT_STYLES)) {
    for (let scale = 1; scale <= 6; scale++) {
      const json = {
        providers: [
          { type: 'ttf', file: `heldixclient:${def.file}`, size: def.size, oversample: scale, shift: [0, def.shift] },
          { type: 'reference', id: 'minecraft:default' },
        ],
      };
      await writeFile(path.join(fontDir, `ui_${style}_${scale}.json`), JSON.stringify(json, null, 2) + '\n');
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Rendern mit Electron (SVG → PNG)
// ---------------------------------------------------------------------------------------------

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('window-all-closed', () => {});

async function render(html, width, height) {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  win.webContents.setZoomFactor(1);
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => setTimeout(resolve, 600));
  let image = await win.webContents.capturePage();
  const size = image.getSize();
  if (size.width !== width || size.height !== height) image = image.resize({ width, height, quality: 'best' });
  win.destroy();
  return image;
}

app.whenReady().then(async () => {
  await mkdir(out, { recursive: true });

  await writeFile(path.join(out, 'icons.png'), (await render(iconsHtml(CELL), COLUMNS * CELL, ROWS * CELL)).toPNG());
  await writeFile(path.join(out, 'icons_small.png'), (await render(iconsHtml(CELL / 2), (COLUMNS * CELL) / 2, (ROWS * CELL) / 2)).toPNG());
  await writeFile(path.join(out, 'icons.json'), JSON.stringify({ cell: CELL, columns: COLUMNS, names: NAMES }, null, 2) + '\n');

  const previewRows = Math.ceil(NAMES.length / COLUMNS);
  const preview = await render(previewHtml, COLUMNS * 94 + 22, previewRows * 85 + 28);
  await writeFile(path.join(launcherDir, '..', 'docs', 'images', 'ui-icons.png'), preview.toPNG());

  await writeFile(path.join(out, 'shapes.png'), shapes());
  await writeFile(path.join(out, 'shadow.png'), shadow());

  const background = await readFile(path.join(launcherDir, 'src', 'renderer', 'background.svg'), 'utf8');
  const backgroundHtml = `<!doctype html><html><body style="margin:0;overflow:hidden"><div style="width:1600px;height:1000px">${background
    .replace('<svg ', '<svg width="1600" height="1000" ')}</div></body></html>`;
  await writeFile(path.join(out, 'background.png'), (await render(backgroundHtml, 1600, 1000)).toPNG());

  const logo = await readFile(path.join(launcherDir, 'src', 'renderer', 'logo.svg'), 'utf8');
  const logoHtml = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden"><div style="width:256px;height:256px">${logo
    .replace('<svg ', '<svg width="256" height="256" ')}</div></body></html>`;
  const logoImage = await render(logoHtml, 256, 256);
  await writeFile(path.join(out, 'logo.png'), logoImage.resize({ width: 128, height: 128, quality: 'best' }).toPNG());

  // Heldix-Symbol als Schriftzeichen – steht in der Tab-Liste und im Namensschild vor dem Namen von HeldixClient-Spielern:
  // U+E000 das Logo (alle), U+E001 Team-Admin, U+E002 Moderator, U+E003 Addon-Entwickler
  const fontTextures = path.join(assets, 'textures', 'font');
  await mkdir(fontTextures, { recursive: true });
  await writeFile(path.join(fontTextures, 'badge.png'), logoImage.resize({ width: 32, height: 32, quality: 'best' }).toPNG());
  const badgeProviders = [{ type: 'bitmap', file: 'heldixclient:font/badge.png', ascent: 7, height: 8, chars: ['\uE000'] }];
  for (const role of BADGE_ROLES) {
    const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden"><div style="width:256px;height:256px">${badgeSvg(role)}</div></body></html>`;
    const image = await render(html, 256, 256);
    await writeFile(path.join(fontTextures, `badge_${role.name}.png`), image.resize({ width: 32, height: 32, quality: 'best' }).toPNG());
    badgeProviders.push({ type: 'bitmap', file: `heldixclient:font/badge_${role.name}.png`, ascent: 7, height: 8, chars: [role.char] });
  }
  await writeFile(path.join(fontDir, 'badge.json'), `${JSON.stringify({ providers: badgeProviders }, null, 2)}\n`);

  await writeFonts();

  // dieselben Icons für den Launcher (src/renderer/ui-icons.ts), Farbe dort per currentColor
  const launcherIcons = Object.fromEntries(NAMES.map((n) => [n, ICONS[n].replaceAll('#fff', 'currentColor')]));
  const header = [
    '// Erzeugt von scripts/render-ui-assets.mjs (npm run ui-assets) – nicht von Hand ändern.',
    '// Das Icon-Set von HeldixClient: dieselben Icons wie im Spiel, 24er-Raster, 2 px Linien.',
  ].join('\n');
  await writeFile(path.join(launcherDir, 'src', 'renderer', 'ui-icons.ts'),
    `${header}\nexport const UI_ICONS: Record<string, string> = ${JSON.stringify(launcherIcons, null, 2)};\n`);
  console.log(`Oberflächen-Grafiken geschrieben: ${NAMES.length} Icons, Ecken bis ${MAX_R} px, Schriften für Skalierung 1–6`);
  app.quit();
});
