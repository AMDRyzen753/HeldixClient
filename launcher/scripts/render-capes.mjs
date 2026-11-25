// Erzeugt die Heldix-Capes für die Client-Mod (mod/src/main/resources/assets/heldixclient/textures/cape/):
//   <id>.png       – alle Bilder der Animation untereinander (je 512 × 256, achtfache Minecraft-Cape-Vorlage)
//   <id>_glow.png  – leuchtende Teile je Bild (256 × 128, durchsichtig = leuchtet nicht); im Spiel voll hell darübergelegt
//   capes.json     – Name, Beschreibung, Bildanzahl, Bilder pro Sekunde, Leuchten
// und eine Übersicht docs/images/capes.png. Eigene Motive, gezeichnet als SVG im Raster der Cape-Vorlage (64 × 32 Texel).
// Aufruf: npm run capes
//
// Aufteilung der Vorlage (Texel):
//   Cape:   Außenseite (1,1) 10×16 · Innenseite (12,1) 10×16 · Ränder links/rechts (0,1)/(11,1) 1×16 · oben/unten (1,0)/(11,0) 10×1
//   Elytra: Flügelflächen (24,2) und (36,2) je 10×20 · Ränder (22,2)/(34,2) 2×20 · oben/unten (24,0)/(34,0) 10×2
import { app, BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const launcherDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(launcherDir, '..', 'mod', 'src', 'main', 'resources', 'assets', 'heldixclient', 'textures', 'cape');
const SCALE = 8;
const GLOW_SCALE = 4;
const FRAMES = 24;
const TAU = Math.PI * 2;

let idCounter = 0;
const uid = (name) => `${name}${++idCounter}`;
const f = (n) => Number(n.toFixed(3));
const frac = (x) => x - Math.floor(x);
/** 0…1, periodisch in t (eine Schleife pro Animation) */
const wave = (t, phase = 0, speed = 1) => 0.5 + 0.5 * Math.sin(TAU * (t * speed + phase));

/** reproduzierbare Zufallszahlen, damit die Capes bei jedem Lauf gleich aussehen */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const HEX = 'M82.68 22 Q100 12 117.32 22 L158.89 46 Q176.21 56 176.21 76 L176.21 124 Q176.21 144 158.89 154 L117.32 178 Q100 188 82.68 178 L41.11 154 Q23.79 144 23.79 124 L23.79 76 Q23.79 56 41.11 46 Z';

/** Heldix-Zeichen (Sechseck mit „H“) in einem Quadrat der Größe s */
function emblem(x, y, s, { fill = '#ffffff', ring = '#ffffff', ringOpacity = 0.9, back = 0.12 } = {}) {
  return `<svg x="${f(x)}" y="${f(y)}" width="${f(s)}" height="${f(s)}" viewBox="0 0 200 200" overflow="visible">
    <path d="${HEX}" fill="${fill}" fill-opacity="${back}" stroke="${ring}" stroke-opacity="${ringOpacity}" stroke-width="9"/>
    <g fill="${fill}"><rect x="60" y="60" width="25" height="80" rx="6"/><rect x="115" y="60" width="25" height="80" rx="6"/><polygon points="85,106 115,86 115,109 85,129"/></g>
  </svg>`;
}

/** Lichtband, das schräg über die Fläche wandert (Position p von 0 bis 1) */
function sheen(w, h, p, strength = 0.28) {
  const id = uid('sh');
  const at = -0.35 + 1.7 * p;
  const stop = (o, a) => `<stop offset="${f(Math.min(1, Math.max(0, o)))}" stop-color="#ffffff" stop-opacity="${a}"/>`;
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">${stop(at - 0.18, 0)}${stop(at, strength)}${stop(at + 0.18, 0)}</linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#${id})"/>`;
}

/** Sternchen mit vier Zacken (Funkeln) */
function sparkle(x, y, r, color, opacity) {
  const k = r * 0.22;
  return `<path d="M${f(x)} ${f(y - r)} L${f(x + k)} ${f(y - k)} L${f(x + r)} ${f(y)} L${f(x + k)} ${f(y + k)} L${f(x)} ${f(y + r)} L${f(x - k)} ${f(y + k)} L${f(x - r)} ${f(y)} L${f(x - k)} ${f(y - k)} Z"
    fill="${color}" opacity="${f(opacity)}"/>`;
}

function blur(std) {
  const id = uid('bl');
  return { id, def: `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${std}"/></filter>` };
}

/** Tannen-Silhouette am unteren Rand */
function forest(w, h, top, color, seed) {
  const rnd = random(seed);
  let trees = '';
  for (let x = -0.4; x < w + 0.5; x += 0.75 + rnd() * 0.5) {
    const th = h * (0.07 + rnd() * 0.07);
    const base = h * top + rnd() * h * 0.03;
    const half = th * 0.32;
    trees += `<path d="M${f(x)} ${f(base - th)} L${f(x + half)} ${f(base)} L${f(x - half)} ${f(base)} Z" fill="${color}"/>`;
  }
  return `${trees}<rect x="0" y="${f(h * top + h * 0.025)}" width="${w}" height="${f(h)}" fill="${color}"/>`;
}

// ---------------------------------------------------------------------------------------------
// Motive. art() zeichnet die Fläche, glow() die leuchtenden Teile (optional).
// ctx: { cape: Außenseite des Capes (sonst Elytra-Flügel), t: 0…1 (Zeit in der Schleife) }
// ---------------------------------------------------------------------------------------------

const DESIGNS = [
  {
    id: 'heldix',
    name: 'Heldix',
    description: 'Tiefes Blau mit leuchtendem Heldix-Zeichen und Lichtschimmer',
    fps: 12,
    edge: '#1e3a8a',
    lining: '#0b1430',
    trim: '#93c5fd',
    poster: 0.45,
    art(w, h, { cape, t }) {
      const g = uid('g');
      let hex = '';
      const r = 0.95;
      for (let row = -1, y = 0; y < h + 2; row++, y = row * r * 1.5) {
        for (let x = row % 2 ? r * 0.866 : 0; x < w + 2; x += r * 1.732) {
          const pts = [0, 1, 2, 3, 4, 5].map((i) => {
            const a = (Math.PI / 3) * i + Math.PI / 6;
            return `${f(x + Math.cos(a) * r)},${f(y + Math.sin(a) * r)}`;
          });
          hex += `<polygon points="${pts.join(' ')}"/>`;
        }
      }
      const dash = frac(t);
      const sx = (p) => w * p;
      const sy = (p) => h * (0.64 - 0.2 * p);
      return `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stop-color="#3b82f6"/><stop offset="0.45" stop-color="#1d4ed8"/><stop offset="1" stop-color="#0c1a45"/>
        </linearGradient></defs>
        <rect width="${w}" height="${h}" fill="url(#${g})"/>
        <g fill="none" stroke="#bfdbfe" stroke-opacity="0.07" stroke-width="0.08">${hex}</g>
        <path d="M0 ${f(h * 0.7)} L${w} ${f(h * 0.5)} L${w} ${h} L0 ${h} Z" fill="#06102e" opacity="0.5"/>
        <path d="M0 ${f(h * 0.64)} L${w} ${f(h * 0.44)} L${w} ${f(h * 0.475)} L0 ${f(h * 0.675)} Z" fill="#22d3ee"/>
        <path d="M0 ${f(h * 0.7)} L${w} ${f(h * 0.5)} L${w} ${f(h * 0.515)} L0 ${f(h * 0.715)} Z" fill="#22d3ee" opacity="0.4"/>
        <line x1="${f(sx(dash - 0.12))}" y1="${f(sy(dash - 0.12) + h * 0.0175)}" x2="${f(sx(dash))}" y2="${f(sy(dash) + h * 0.0175)}" stroke="#ecfeff" stroke-width="0.35" stroke-linecap="round"/>
        ${cape ? emblem(w * 0.2, h * 0.1, w * 0.6, { ringOpacity: 0.95 }) : emblem(w * 0.25, h * 0.14, w * 0.5, { ringOpacity: 0.7, back: 0.08 })}
        ${sheen(w, h, t)}`;
    },
    glow(w, h, { cape, t }) {
      const b = blur(0.35);
      const pulse = 0.55 + 0.45 * wave(t);
      const dash = frac(t);
      const sx = (p) => w * p;
      const sy = (p) => h * (0.64 - 0.2 * p) + h * 0.0175;
      const mark = cape
        ? emblem(w * 0.2, h * 0.1, w * 0.6, { fill: '#60a5fa', ring: '#93c5fd', back: 0 })
        : emblem(w * 0.25, h * 0.14, w * 0.5, { fill: '#60a5fa', ring: '#93c5fd', back: 0 });
      return `<defs>${b.def}</defs>
        <g opacity="${f(pulse)}" filter="url(#${b.id})">${mark}</g>
        <g opacity="${f(pulse * 0.8)}">${mark}</g>
        <path d="M0 ${f(h * 0.64)} L${w} ${f(h * 0.44)} L${w} ${f(h * 0.475)} L0 ${f(h * 0.675)} Z" fill="#0891b2" opacity="0.8"/>
        <line x1="${f(sx(dash - 0.14))}" y1="${f(sy(dash - 0.14))}" x2="${f(sx(dash))}" y2="${f(sy(dash))}" stroke="#a5f3fc" stroke-width="0.6" stroke-linecap="round" filter="url(#${b.id})"/>`;
    },
  },
  {
    id: 'mitternacht',
    name: 'Mitternacht',
    description: 'Funkelnder Sternenhimmel, Mondsichel und Sternschnuppe',
    fps: 10,
    edge: '#111a3d',
    lining: '#070b18',
    trim: '#c7d2fe',
    poster: 0.22,
    stars(w, h, t) {
      const rnd = random(7 + w * 31 + h);
      const list = [];
      for (let i = 0; i < Math.round(w * h * 0.3); i++) {
        const x = rnd() * w;
        const y = rnd() * h * 0.74;
        const r = 0.06 + rnd() * 0.16;
        const twinkle = 0.35 + 0.65 * wave(t, rnd(), 1 + Math.floor(rnd() * 2));
        list.push({ x, y, r, o: twinkle, bright: r > 0.17, color: rnd() > 0.75 ? '#a5f3fc' : '#ffffff' });
      }
      return list;
    },
    shooting(w, h, t) {
      const s = (t - 0.08) / 0.3;
      if (s < 0 || s > 1) return null;
      return { x: w * (1.15 - 1.5 * s), y: h * (0.04 + 0.26 * s), fade: Math.sin(Math.PI * s) };
    },
    art(w, h, { cape, t }) {
      const g = uid('g');
      const m = uid('m');
      const trail = uid('tr');
      let stars = '';
      for (const s of this.stars(w, h, t)) {
        stars += s.bright
          ? sparkle(s.x, s.y, s.r * 2.4, s.color, s.o)
          : `<circle cx="${f(s.x)}" cy="${f(s.y)}" r="${f(s.r)}" fill="${s.color}" opacity="${f(s.o)}"/>`;
      }
      const moon = cape
        ? `<mask id="${m}"><rect width="${w}" height="${h}" fill="#fff"/><circle cx="${f(w * 0.75)}" cy="${f(h * 0.16)}" r="${f(w * 0.15)}" fill="#000"/></mask>
           <circle cx="${f(w * 0.66)}" cy="${f(h * 0.2)}" r="${f(w * 0.16)}" fill="#e0e7ff" mask="url(#${m})"/>`
        : '';
      const shot = cape ? this.shooting(w, h, t) : null;
      const shooting = shot
        ? `<linearGradient id="${trail}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
           <g opacity="${f(shot.fade)}"><line x1="${f(shot.x)}" y1="${f(shot.y)}" x2="${f(shot.x + w * 0.38)}" y2="${f(shot.y - h * 0.065)}" stroke="url(#${trail})" stroke-width="0.22" stroke-linecap="round"/>
           <circle cx="${f(shot.x)}" cy="${f(shot.y)}" r="0.22" fill="#ffffff"/></g>`
        : '';
      const ridge = `M0 ${f(h * 0.82)} L${f(w * 0.2)} ${f(h * 0.72)} L${f(w * 0.36)} ${f(h * 0.79)} L${f(w * 0.6)} ${f(h * 0.66)} L${f(w * 0.82)} ${f(h * 0.77)} L${w} ${f(h * 0.71)}`;
      return `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#050816"/><stop offset="0.6" stop-color="#18245a"/><stop offset="1" stop-color="#3b2a6b"/>
        </linearGradient></defs>
        <rect width="${w}" height="${h}" fill="url(#${g})"/>
        ${stars}${moon}${shooting}
        <path d="${ridge} L${w} ${h} L0 ${h} Z" fill="#0b1029"/>
        <path d="M${f(w * 0.53)} ${f(h * 0.69)} L${f(w * 0.6)} ${f(h * 0.66)} L${f(w * 0.67)} ${f(h * 0.69)} L${f(w * 0.6)} ${f(h * 0.68)} Z" fill="#c7d2fe" opacity="0.7"/>
        <path d="${ridge}" fill="none" stroke="#22d3ee" stroke-opacity="0.55" stroke-width="0.16"/>
        ${forest(w, h, 0.9, '#050816', 3)}`;
    },
    glow(w, h, { cape, t }) {
      const b = blur(0.3);
      let stars = '';
      for (const s of this.stars(w, h, t)) {
        if (s.bright) stars += sparkle(s.x, s.y, s.r * 2.6, '#c7d2fe', s.o * 0.9);
      }
      const shot = cape ? this.shooting(w, h, t) : null;
      const moon = cape ? `<circle cx="${f(w * 0.62)}" cy="${f(h * 0.21)}" r="${f(w * 0.12)}" fill="#6366f1" opacity="0.35" filter="url(#${b.id})"/>` : '';
      return `<defs>${b.def}</defs>${moon}<g filter="url(#${b.id})">${stars}</g>${stars}
        ${shot ? `<line x1="${f(shot.x)}" y1="${f(shot.y)}" x2="${f(shot.x + w * 0.25)}" y2="${f(shot.y - h * 0.043)}" stroke="#e0f2fe" stroke-width="0.35" opacity="${f(shot.fade)}" filter="url(#${b.id})"/>` : ''}`;
    },
  },
  {
    id: 'aurora',
    name: 'Aurora',
    description: 'Wogende Polarlichter über einem dunklen Wald',
    fps: 10,
    edge: '#06323a',
    lining: '#031016',
    trim: '#5eead4',
    poster: 0.3,
    bands(w, h, t, blurId, opacityScale = 1) {
      const bands = [
        ['#22c55e', 0.12, 0.95, 1],
        ['#2dd4bf', 0.3, 1, -1],
        ['#a78bfa', 0.48, 0.8, 2],
      ];
      let paths = '';
      for (const [color, top, opacity, speed] of bands) {
        const gid = uid('a');
        const y = h * top;
        const amp = h * 0.07;
        const p = TAU * t * speed;
        const c1 = y - amp * 2 * Math.cos(p);
        const c2 = y + amp * 2.5 * Math.cos(p + 1.3);
        const e = y - amp * Math.sin(p + 0.6);
        const s = y + amp * Math.sin(p);
        paths += `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${color}" stop-opacity="0"/><stop offset="0.55" stop-color="${color}" stop-opacity="${f(opacity * opacityScale)}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
          </linearGradient>
          <path d="M${f(-w * 0.1)} ${f(s)} C ${f(w * 0.25)} ${f(c1)}, ${f(w * 0.55)} ${f(c2)}, ${f(w * 1.1)} ${f(e)}
            L ${f(w * 1.1)} ${f(e + h * 0.22)} C ${f(w * 0.55)} ${f(c2 + h * 0.22)}, ${f(w * 0.25)} ${f(c1 + h * 0.22)}, ${f(-w * 0.1)} ${f(s + h * 0.22)} Z"
            fill="url(#${gid})" filter="url(#${blurId})"/>`;
      }
      return paths;
    },
    art(w, h, { t }) {
      const g = uid('g');
      const b = blur(0.45);
      const rnd = random(11 + w * 7 + h);
      let stars = '';
      for (let i = 0; i < Math.round(w * h * 0.12); i++) {
        stars += `<circle cx="${f(rnd() * w)}" cy="${f(rnd() * h * 0.7)}" r="${f(0.05 + rnd() * 0.1)}" fill="#ffffff" opacity="${f(0.25 + 0.5 * wave(t, rnd()))}"/>`;
      }
      return `<defs>${b.def}
          <linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#020b12"/><stop offset="1" stop-color="#08243a"/></linearGradient>
        </defs>
        <rect width="${w}" height="${h}" fill="url(#${g})"/>${stars}${this.bands(w, h, t, b.id)}
        ${forest(w, h, 0.86, '#020a10', 17)}`;
    },
    glow(w, h, { t }) {
      const b = blur(0.6);
      return `<defs>${b.def}</defs>${this.bands(w, h, t, b.id, 0.55)}`;
    },
  },
  {
    id: 'glut',
    name: 'Glut',
    description: 'Flackernde Flammen und aufsteigende Funken – leuchtet im Dunkeln',
    fps: 14,
    edge: '#431407',
    lining: '#140604',
    trim: '#fbbf24',
    poster: 0.4,
    flames(w, h, t, fill, scale = 1) {
      const rnd = random(23 + w * 5 + h);
      let flames = '';
      for (let i = 0; i < 6; i++) {
        const cx = w * (0.05 + i * 0.18) + (rnd() - 0.5) * w * 0.08;
        const flicker = Math.sin(TAU * (2 * t + i * 0.37)) * 0.1 + Math.sin(TAU * (3 * t + i * 0.61)) * 0.05;
        const top = h * (0.42 + rnd() * 0.2 + flicker) + (1 - scale) * h * 0.25;
        const half = w * (0.12 + rnd() * 0.05) * scale;
        const sway = Math.sin(TAU * (t + i * 0.23)) * w * 0.06;
        flames += `<path d="M${f(cx - half)} ${h} C ${f(cx - half)} ${f(h - (h - top) * 0.5)}, ${f(cx - half * 0.2 + sway)} ${f(top + (h - top) * 0.25)}, ${f(cx + sway)} ${f(top)}
          C ${f(cx + half * 0.3 + sway)} ${f(top + (h - top) * 0.3)}, ${f(cx + half)} ${f(h - (h - top) * 0.45)}, ${f(cx + half)} ${h} Z" fill="${fill}"/>`;
      }
      return flames;
    },
    embers(w, h, t, glow) {
      const rnd = random(29 + w * 3 + h);
      let embers = '';
      for (let i = 0; i < Math.round(w * h * 0.1); i++) {
        const speed = 1 + Math.floor(rnd() * 2);
        const y = h * (1 - frac(rnd() + t * speed)) * 0.95;
        const x = rnd() * w + Math.sin(TAU * (t * speed + rnd())) * 0.5;
        const life = y / h;
        const r = 0.07 + rnd() * 0.12;
        embers += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(glow ? r * 1.6 : r)}" fill="${rnd() > 0.5 ? '#fbbf24' : '#fb923c'}" opacity="${f(Math.min(1, life * 1.3))}"/>`;
      }
      return embers;
    },
    art(w, h, { t }) {
      const g = uid('g');
      const glow = uid('r');
      const fl = uid('f');
      const core = uid('c');
      const b = blur(0.22);
      return `<defs>${b.def}
          <linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c0504"/><stop offset="0.55" stop-color="#3a0d06"/><stop offset="1" stop-color="#9a3412"/></linearGradient>
          <radialGradient id="${glow}" cx="0.5" cy="1" r="0.85"><stop offset="0" stop-color="#f97316" stop-opacity="${f(0.6 + 0.2 * wave(t, 0, 2))}"/><stop offset="1" stop-color="#f97316" stop-opacity="0"/></radialGradient>
          <linearGradient id="${fl}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fde68a"/><stop offset="0.35" stop-color="#f59e0b"/><stop offset="0.75" stop-color="#dc2626" stop-opacity="0.75"/><stop offset="1" stop-color="#7f1d1d" stop-opacity="0"/></linearGradient>
          <linearGradient id="${core}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fffbeb"/><stop offset="0.5" stop-color="#fde68a" stop-opacity="0.8"/><stop offset="1" stop-color="#fde68a" stop-opacity="0"/></linearGradient>
        </defs>
        <rect width="${w}" height="${h}" fill="url(#${g})"/>
        <rect width="${w}" height="${h}" fill="url(#${glow})"/>
        <g filter="url(#${b.id})">${this.flames(w, h, t, `url(#${fl})`)}</g>
        <g filter="url(#${b.id})" opacity="0.85">${this.flames(w, h, t, `url(#${core})`, 0.55)}</g>
        ${this.embers(w, h, t, false)}`;
    },
    glow(w, h, { t }) {
      const fl = uid('f');
      const b = blur(0.4);
      return `<defs>${b.def}<linearGradient id="${fl}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#f59e0b"/><stop offset="0.5" stop-color="#ea580c" stop-opacity="0.7"/><stop offset="1" stop-color="#7f1d1d" stop-opacity="0"/></linearGradient></defs>
        <g filter="url(#${b.id})" opacity="0.8">${this.flames(w, h, t, `url(#${fl})`)}</g>${this.embers(w, h, t, true)}`;
    },
  },
  {
    id: 'kristall',
    name: 'Kristall',
    description: 'Eisblaue Facetten mit wanderndem Glanz und Funkeln',
    fps: 12,
    edge: '#0c4a6e',
    lining: '#061a2a',
    trim: '#e0f2fe',
    poster: 0.45,
    mesh(w, h) {
      const rnd = random(41 + w * 13 + h);
      const cols = 4;
      const rows = Math.round((h / w) * cols * 1.2);
      const pts = [];
      for (let r = 0; r <= rows; r++) {
        const row = [];
        for (let c = 0; c <= cols; c++) {
          const edgeX = c === 0 || c === cols;
          const edgeY = r === 0 || r === rows;
          row.push([(c / cols) * w + (edgeX ? 0 : (rnd() - 0.5) * (w / cols) * 0.7), (r / rows) * h + (edgeY ? 0 : (rnd() - 0.5) * (h / rows) * 0.7)]);
        }
        pts.push(row);
      }
      const tris = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const a = pts[r][c];
          const b = pts[r][c + 1];
          const d = pts[r + 1][c];
          const e = pts[r + 1][c + 1];
          const pair = (r + c) % 2 === 0 ? [[a, b, e], [a, e, d]] : [[a, b, d], [b, e, d]];
          for (const tri of pair) tris.push({ tri, shade: rnd(), row: r / rows });
        }
      }
      return { tris, pts };
    },
    art(w, h, { t }) {
      const palette = ['#082f49', '#0c4a6e', '#075985', '#0369a1', '#0284c7', '#0ea5e9', '#38bdf8', '#7dd3fc', '#bae6fd', '#e0f2fe'];
      const band = -0.3 + 1.6 * frac(t);
      let out = '';
      for (const { tri, shade, row } of this.mesh(w, h).tris) {
        const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3 / w;
        const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3 / h;
        const near = Math.max(0, 1 - Math.abs((cx + cy) / 2 - band) / 0.16);
        const index = Math.min(palette.length - 1, Math.round((1 - row) * (palette.length - 4) + shade * 2.5 + near * 3));
        out += `<polygon points="${tri.map((p) => `${f(p[0])},${f(p[1])}`).join(' ')}" fill="${palette[index]}" stroke="#e0f2fe" stroke-opacity="${f(0.14 + near * 0.4)}" stroke-width="0.07"/>`;
      }
      return `<rect width="${w}" height="${h}" fill="#0c4a6e"/>${out}`;
    },
    glow(w, h, { t }) {
      const b = blur(0.3);
      const { pts } = this.mesh(w, h);
      const rnd = random(77 + w + h);
      let sparkles = '';
      for (const row of pts.slice(1, -1)) {
        for (const p of row.slice(1, -1)) {
          const o = Math.max(0, Math.sin(TAU * (t + rnd())) * 1.4 - 0.4);
          if (o > 0) sparkles += sparkle(p[0], p[1], 0.75, '#e0f2fe', Math.min(1, o));
        }
      }
      return `<defs>${b.def}</defs><g filter="url(#${b.id})">${sparkles}</g>${sparkles}`;
    },
  },
  {
    id: 'neon',
    name: 'Neon',
    description: 'Pulsierende Leuchtstreifen auf dunklem Raster',
    fps: 12,
    edge: '#1e1b4b',
    lining: '#05050b',
    trim: '#f0abfc',
    poster: 0.2,
    stripes: [[0.3, '#ec4899', 0], [0.55, '#22d3ee', 0.33], [0.8, '#a855f7', 0.66]],
    line(w, h, offset) {
      return [[-w * 0.2, h * offset + w * 0.6], [w * 1.2, h * offset - w * 0.6]];
    },
    art(w, h, { t }) {
      const b = blur(0.45);
      let grid = '';
      for (let x = 1; x < w; x += 1.25) grid += `<line x1="${f(x)}" y1="0" x2="${f(x)}" y2="${h}" stroke="#312e81" stroke-width="0.06"/>`;
      for (let y = 1 - frac(t) * 1.25; y < h; y += 1.25) grid += `<line x1="0" y1="${f(y)}" x2="${w}" y2="${f(y)}" stroke="#312e81" stroke-width="0.06"/>`;
      let stripes = '';
      for (const [offset, color, phase] of this.stripes) {
        const [[x1, y1], [x2, y2]] = this.line(w, h, offset);
        const flicker = 0.8 + 0.2 * wave(t, phase, 3);
        const p = frac(t + phase);
        const px = x1 + (x2 - x1) * p;
        const py = y1 + (y2 - y1) * p;
        const qx = x1 + (x2 - x1) * (p - 0.12);
        const qy = y1 + (y2 - y1) * (p - 0.12);
        const d = `M${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)}`;
        stripes += `<g opacity="${f(flicker)}"><path d="${d}" stroke="${color}" stroke-width="1.1" filter="url(#${b.id})" opacity="0.9"/>
          <path d="${d}" stroke="${color}" stroke-width="0.5"/><path d="${d}" stroke="#ffffff" stroke-width="0.14" opacity="0.8"/></g>
          <line x1="${f(qx)}" y1="${f(qy)}" x2="${f(px)}" y2="${f(py)}" stroke="#ffffff" stroke-width="0.45" stroke-linecap="round"/>`;
      }
      return `<defs>${b.def}</defs><rect width="${w}" height="${h}" fill="#07060f"/>${grid}${stripes}`;
    },
    glow(w, h, { t }) {
      const b = blur(0.55);
      let out = '';
      for (const [offset, color, phase] of this.stripes) {
        const [[x1, y1], [x2, y2]] = this.line(w, h, offset);
        const flicker = 0.8 + 0.2 * wave(t, phase, 3);
        const p = frac(t + phase);
        out += `<path d="M${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)}" stroke="${color}" stroke-width="0.9" opacity="${f(flicker * 0.75)}" filter="url(#${b.id})"/>
          <line x1="${f(x1 + (x2 - x1) * (p - 0.14))}" y1="${f(y1 + (y2 - y1) * (p - 0.14))}" x2="${f(x1 + (x2 - x1) * p)}" y2="${f(y1 + (y2 - y1) * p)}" stroke="#ffffff" stroke-width="0.6" stroke-linecap="round" filter="url(#${b.id})"/>`;
      }
      return `<defs>${b.def}</defs>${out}`;
    },
  },
  {
    id: 'sakura',
    name: 'Sakura',
    description: 'Kirschblüten und tanzende Blütenblätter',
    fps: 10,
    edge: '#9d174d',
    lining: '#3b0a20',
    trim: '#fbcfe8',
    poster: 0.3,
    art(w, h, { t }) {
      const g = uid('g');
      const rnd = random(59 + w * 3 + h);
      const blossom = (x, y, r) => {
        let petals = '';
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU - Math.PI / 2 + 0.3;
          const px = x + Math.cos(a) * r * 0.52;
          const py = y + Math.sin(a) * r * 0.52;
          petals += `<ellipse cx="${f(px)}" cy="${f(py)}" rx="${f(r * 0.46)}" ry="${f(r * 0.36)}" transform="rotate(${f((a * 180) / Math.PI)} ${f(px)} ${f(py)})"
            fill="#fff1f7" stroke="#f472b6" stroke-width="0.07"/>`;
        }
        return `${petals}<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 0.24)}" fill="#db2777"/>`;
      };
      const sway = Math.sin(TAU * t) * 0.15;
      const branch = `M${f(-w * 0.05)} ${f(h * 0.2)} C ${f(w * 0.3)} ${f(h * 0.16)}, ${f(w * 0.5)} ${f(h * 0.3 + sway)}, ${f(w * 1.05)} ${f(h * 0.26 + sway)}
        M${f(w * 0.42)} ${f(h * 0.24)} C ${f(w * 0.48)} ${f(h * 0.36)}, ${f(w * 0.56)} ${f(h * 0.42 + sway)}, ${f(w * 0.66)} ${f(h * 0.48 + sway)}`;
      let blossoms = '';
      for (const [px, py] of [[0.2, 0.17], [0.66, 0.27], [0.62, 0.48], [0.95, 0.25]]) blossoms += blossom(w * px, h * py + sway * (px > 0.5 ? 1 : 0.3), w * 0.21);
      let petals = '';
      for (let i = 0; i < Math.round(w * h * 0.05); i++) {
        const speed = 1 + Math.floor(rnd() * 2);
        const y = frac(rnd() + t * speed) * (h + 2) - 1;
        const x = rnd() * w + Math.sin(TAU * (t * speed + rnd())) * 0.8;
        const spin = 360 * t * speed + rnd() * 180;
        const flip = 0.55 + 0.45 * Math.abs(Math.cos(TAU * (t * speed + rnd())));
        petals += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(0.42 + rnd() * 0.2)}" ry="${f(0.22 * flip)}" transform="rotate(${f(spin)} ${f(x)} ${f(y)})"
          fill="#fff1f7" opacity="${f(0.65 + rnd() * 0.3)}"/>`;
      }
      return `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fdf2f8"/><stop offset="0.5" stop-color="#f9a8d4"/><stop offset="1" stop-color="#be185d"/>
        </linearGradient></defs>
        <rect width="${w}" height="${h}" fill="url(#${g})"/>
        <path d="${branch}" fill="none" stroke="#4a1d2e" stroke-width="0.7" stroke-linecap="round"/>
        ${blossoms}${petals}`;
    },
  },
  {
    id: 'gewitter',
    name: 'Gewitter',
    description: 'Dunkle Wolken, Regen und zuckende Blitze',
    fps: 14,
    edge: '#1e293b',
    lining: '#0b1220',
    trim: '#cbd5e1',
    poster: 0.585,
    flash(t) {
      if (t >= 0.55 && t < 0.62) return 1 - ((t - 0.55) / 0.07) * 0.4;
      if (t >= 0.66 && t < 0.71) return 0.7;
      return 0;
    },
    bolt(w, h) {
      return `M${f(w * 0.58)} ${f(h * 0.12)} L${f(w * 0.46)} ${f(h * 0.36)} L${f(w * 0.6)} ${f(h * 0.38)} L${f(w * 0.4)} ${f(h * 0.66)} L${f(w * 0.5)} ${f(h * 0.62)} L${f(w * 0.36)} ${f(h * 0.9)}`;
    },
    art(w, h, { cape, t }) {
      const g = uid('g');
      const b = blur(0.5);
      const rnd = random(91 + w * 11 + h);
      const flash = cape ? this.flash(t) : this.flash(frac(t + 0.3));
      let clouds = '';
      for (let i = 0; i < 9; i++) {
        const x = rnd() * w + Math.sin(TAU * (t + i * 0.1)) * 0.4;
        const y = h * (0.02 + rnd() * 0.16);
        const r = w * (0.18 + rnd() * 0.16);
        clouds += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(r)}" ry="${f(r * 0.55)}" fill="${rnd() > 0.5 ? '#334155' : '#1e293b'}" opacity="0.9"/>`;
      }
      let rain = '';
      for (let i = 0; i < Math.round(w * h * 0.16); i++) {
        const x = rnd() * (w + 2) - 1;
        const y = frac(rnd() + t * 2) * (h + 3) - 1.5;
        rain += `<line x1="${f(x)}" y1="${f(y)}" x2="${f(x - 0.35)}" y2="${f(y + 1.1)}" stroke="#94a3b8" stroke-opacity="0.45" stroke-width="0.07"/>`;
      }
      const bolt = flash > 0
        ? `<path d="${this.bolt(w, h)}" fill="none" stroke="#e0f2fe" stroke-width="0.9" opacity="0.7" filter="url(#${b.id})"/>
           <path d="${this.bolt(w, h)}" fill="none" stroke="#ffffff" stroke-width="0.32" stroke-linejoin="round"/>`
        : '';
      return `<defs>${b.def}<linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f172a"/><stop offset="1" stop-color="#1e293b"/></linearGradient></defs>
        <rect width="${w}" height="${h}" fill="url(#${g})"/>
        <rect width="${w}" height="${h}" fill="#c7d2fe" opacity="${f(flash * 0.28)}"/>
        ${rain}${bolt}<g filter="url(#${b.id})">${clouds}</g>
        <path d="M0 ${f(h * 0.9)} L${f(w * 0.3)} ${f(h * 0.86)} L${f(w * 0.55)} ${f(h * 0.9)} L${f(w * 0.8)} ${f(h * 0.85)} L${w} ${f(h * 0.88)} L${w} ${h} L0 ${h} Z" fill="#020617"/>`;
    },
    glow(w, h, { cape, t }) {
      const b = blur(0.6);
      const flash = cape ? this.flash(t) : this.flash(frac(t + 0.3));
      if (flash <= 0) return '';
      return `<defs>${b.def}</defs><rect width="${w}" height="${h}" fill="#1e3a8a" opacity="${f(flash * 0.35)}"/>
        <path d="${this.bolt(w, h)}" fill="none" stroke="#bae6fd" stroke-width="1" filter="url(#${b.id})" opacity="${f(flash)}"/>
        <path d="${this.bolt(w, h)}" fill="none" stroke="#ffffff" stroke-width="0.35" opacity="${f(flash)}"/>`;
    },
  },
  {
    id: 'galaxie',
    name: 'Galaxie',
    description: 'Eine langsam drehende Spiralgalaxie im Nebel',
    fps: 10,
    edge: '#2e1065',
    lining: '#0b0418',
    trim: '#c4b5fd',
    poster: 0.2,
    arms(w, h, t, cape, glow) {
      const rnd = random(101 + w * 17 + h);
      const cx = w * 0.5;
      const cy = cape ? h * 0.4 : h * 0.45;
      const turn = TAU * t * 0.5;
      let out = '';
      for (let i = 0; i < 140; i++) {
        const arm = i % 2;
        const d = Math.pow(rnd(), 0.75);
        const a = turn + arm * Math.PI + d * 3.6 + (rnd() - 0.5) * 0.5;
        const r = d * w * 0.48;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r * 0.62;
        const size = 0.05 + rnd() * 0.12 + (1 - d) * 0.06;
        const color = d < 0.3 ? '#fde68a' : rnd() > 0.5 ? '#c4b5fd' : '#a5f3fc';
        const twinkle = 0.5 + 0.5 * wave(t, rnd(), 2);
        if (glow && (size < 0.12 || d < 0.25)) continue;
        out += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(glow ? size * 1.5 : size)}" fill="${color}" opacity="${f(twinkle)}"/>`;
      }
      return { out, cx, cy };
    },
    art(w, h, { cape, t }) {
      const g = uid('g');
      const neb = uid('n');
      const b = blur(0.9);
      const rnd = random(103 + w + h);
      const { out, cx, cy } = this.arms(w, h, t, cape, false);
      let stars = '';
      for (let i = 0; i < Math.round(w * h * 0.12); i++) {
        stars += `<circle cx="${f(rnd() * w)}" cy="${f(rnd() * h)}" r="${f(0.04 + rnd() * 0.08)}" fill="#ffffff" opacity="${f(0.3 + 0.6 * wave(t, rnd()))}"/>`;
      }
      return `<defs>${b.def}
          <linearGradient id="${g}" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#0b0418"/><stop offset="0.55" stop-color="#1e0b3a"/><stop offset="1" stop-color="#0b0418"/></linearGradient>
          <radialGradient id="${neb}" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fde68a" stop-opacity="0.9"/><stop offset="0.25" stop-color="#c084fc" stop-opacity="0.6"/><stop offset="1" stop-color="#4c1d95" stop-opacity="0"/></radialGradient>
        </defs>
        <rect width="${w}" height="${h}" fill="url(#${g})"/>
        <ellipse cx="${f(w * 0.2)}" cy="${f(h * 0.8)}" rx="${f(w * 0.5)}" ry="${f(h * 0.14)}" fill="#be185d" opacity="0.25" filter="url(#${b.id})"/>
        <ellipse cx="${f(w * 0.85)}" cy="${f(h * 0.15)}" rx="${f(w * 0.4)}" ry="${f(h * 0.1)}" fill="#1d4ed8" opacity="0.3" filter="url(#${b.id})"/>
        ${stars}
        <ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(w * 0.5)}" ry="${f(w * 0.3)}" fill="url(#${neb})" opacity="0.55"/>
        ${out}
        <circle cx="${f(cx)}" cy="${f(cy)}" r="${f(w * 0.07)}" fill="#fffbeb"/>`;
    },
    glow(w, h, { cape, t }) {
      const b = blur(0.45);
      const { out, cx, cy } = this.arms(w, h, t, cape, true);
      return `<defs>${b.def}</defs><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(w * 0.16)}" fill="#a78bfa" opacity="0.55" filter="url(#${b.id})"/>
        <circle cx="${f(cx)}" cy="${f(cy)}" r="${f(w * 0.07)}" fill="#fde68a"/><g opacity="0.8">${out}</g>`;
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Zusammensetzen: Stoffstruktur, Schatten und Zierkante über jede Fläche
// ---------------------------------------------------------------------------------------------

function finish(design, w, h) {
  const noise = uid('no');
  const vig = uid('vi');
  const top = uid('to');
  const metal = uid('me');
  return `<defs>
      <linearGradient id="${noise}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#000" stop-opacity="0.16"/><stop offset="0.18" stop-color="#fff" stop-opacity="0.05"/>
        <stop offset="0.38" stop-color="#000" stop-opacity="0.08"/><stop offset="0.62" stop-color="#fff" stop-opacity="0.06"/>
        <stop offset="0.82" stop-color="#000" stop-opacity="0.08"/><stop offset="1" stop-color="#000" stop-opacity="0.16"/>
      </linearGradient>
      <radialGradient id="${vig}" cx="0.5" cy="0.42" r="0.78"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.42"/></radialGradient>
      <linearGradient id="${top}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.38"/><stop offset="0.16" stop-color="#000" stop-opacity="0"/></linearGradient>
      <linearGradient id="${metal}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff"/><stop offset="0.3" stop-color="${design.trim}"/><stop offset="0.6" stop-color="${design.edge}"/><stop offset="0.8" stop-color="${design.trim}"/><stop offset="1" stop-color="#ffffff"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#${noise})"/>
    <rect width="${w}" height="${h}" fill="url(#${vig})"/>
    <rect width="${w}" height="${h}" fill="url(#${top})"/>
    <rect x="0.22" y="0.22" width="${f(w - 0.44)}" height="${f(h - 0.44)}" fill="none" stroke="url(#${metal})" stroke-width="0.36"/>
    <rect x="0.62" y="0.62" width="${f(w - 1.24)}" height="${f(h - 1.24)}" fill="none" stroke="${design.trim}" stroke-opacity="0.35" stroke-width="0.09"/>`;
}

/** Vollständige Textur (Cape und Elytra) eines Bildes der Animation, als SVG im 64×32-Raster */
function capeSvg(design, t, glow, pixelScale) {
  const face = (x, y, w, h, cape) => {
    const ctx = { cape, t };
    const body = glow ? (design.glow ? design.glow(w, h, ctx) : '') : design.art(w, h, ctx) + finish(design, w, h);
    return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="hidden">${body}</svg>`;
  };
  const lining = (x, y, w, h) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${design.lining}"/><svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${finish(design, w, h)}</svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${64 * pixelScale}" height="${32 * pixelScale}" viewBox="0 0 64 32" style="display:block">
    ${glow
      ? ''
      : `<rect x="0" y="0" width="22" height="17" fill="${design.edge}"/><rect x="22" y="0" width="24" height="22" fill="${design.edge}"/>${lining(12, 1, 10, 16)}`}
    ${face(1, 1, 10, 16, true)}
    ${face(24, 2, 10, 20, false)}
    ${face(36, 2, 10, 20, false)}
  </svg>`;
}

// ---------------------------------------------------------------------------------------------
// PNG schreiben (Bilder untereinander)
// ---------------------------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
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
  header[8] = 8;
  header[9] = 6;
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

/**
 * Leuchtbild aufbereiten: Chromium liefert vormultiplizierte Farben (dunkel an weichen Rändern) – zurückrechnen und
 * die Deckkraft etwas anheben, damit das Leuchten im Spiel kräftig wirkt.
 */
function strengthen(rgba) {
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a === 0) continue;
    for (let c = 0; c < 3; c++) rgba[i + c] = Math.min(255, Math.round((rgba[i + c] * 255) / a));
    rgba[i + 3] = Math.min(255, Math.round(a * 1.45));
  }
  return rgba;
}

// ---------------------------------------------------------------------------------------------
// Rendern
// ---------------------------------------------------------------------------------------------

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('window-all-closed', () => {});

async function createRenderer(width, height) {
  const win = new BrowserWindow({ width, height, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  win.webContents.setZoomFactor(1);
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><body style="margin:0;overflow:hidden;background:transparent"></body></html>'));
  return {
    win,
    /** zeichnet HTML und liefert RGBA-Pixel in genau width × height */
    async rgba(html) {
      await win.webContents.executeJavaScript(`document.body.innerHTML = ${JSON.stringify(html)};
        new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30))))`);
      let image = await win.webContents.capturePage();
      const size = image.getSize();
      if (size.width !== width || size.height !== height) image = image.resize({ width, height, quality: 'best' });
      const bgra = image.toBitmap();
      const rgba = Buffer.alloc(bgra.length);
      for (let i = 0; i < bgra.length; i += 4) {
        rgba[i] = bgra[i + 2];
        rgba[i + 1] = bgra[i + 1];
        rgba[i + 2] = bgra[i];
        rgba[i + 3] = bgra[i + 3];
      }
      return { rgba, image };
    },
  };
}

app.whenReady().then(async () => {
  await mkdir(out, { recursive: true });
  const base = await createRenderer(64 * SCALE, 32 * SCALE);
  const glow = await createRenderer(64 * GLOW_SCALE, 32 * GLOW_SCALE);
  const posters = [];
  const meta = [];
  for (const design of DESIGNS) {
    const frames = [];
    const glowFrames = [];
    for (let i = 0; i < FRAMES; i++) {
      const t = i / FRAMES;
      frames.push((await base.rgba(capeSvg(design, t, false, SCALE))).rgba);
      if (design.glow) glowFrames.push(strengthen((await glow.rgba(capeSvg(design, t, true, GLOW_SCALE))).rgba));
    }
    await writeFile(path.join(out, `${design.id}.png`), png(64 * SCALE, 32 * SCALE * FRAMES, Buffer.concat(frames)));
    if (design.glow) await writeFile(path.join(out, `${design.id}_glow.png`), png(64 * GLOW_SCALE, 32 * GLOW_SCALE * FRAMES, Buffer.concat(glowFrames)));
    posters.push({ design, url: (await base.rgba(capeSvg(design, design.poster ?? 0, false, SCALE))).image.toDataURL() });
    meta.push({ id: design.id, name: design.name, description: design.description, frames: FRAMES, fps: design.fps, glow: Boolean(design.glow) });
    console.log(`${design.id}: ${FRAMES} Bilder${design.glow ? ' + Leuchten' : ''}`);
  }
  await writeFile(path.join(out, 'capes.json'), JSON.stringify({ capes: meta }, null, 2) + '\n');
  base.win.destroy();
  glow.win.destroy();

  // Übersicht für die Doku: Außenseite jedes Capes nebeneinander (ein Bild der Animation)
  const tile = 120;
  const tileH = 192;
  const width = DESIGNS.length * (tile + 22) + 26;
  const height = tileH + 60;
  const tiles = posters
    .map(({ design, url }) => `<div style="display:flex;flex-direction:column;align-items:center;gap:10px">
      <div style="width:${tile}px;height:${tileH}px;border-radius:10px;overflow:hidden;box-shadow:0 8px 20px rgba(0,0,0,.45);
        background:url(${url}) no-repeat;background-size:${(tile / 10) * 64}px ${(tileH / 16) * 32}px;background-position:-${tile / 10}px -${tileH / 16}px"></div>
      <div style="font:600 14px system-ui;color:#cbd5e1">${design.name}</div></div>`)
    .join('');
  const overview = await createRenderer(width, height);
  const { image } = await overview.rgba(`<div style="display:flex;gap:22px;padding:20px 24px;background:#0b0f19;width:${width}px;height:${height}px;box-sizing:border-box">${tiles}</div>`);
  await writeFile(path.join(launcherDir, '..', 'docs', 'images', 'capes.png'), image.toPNG());
  overview.win.destroy();

  console.log(`Capes geschrieben: ${DESIGNS.map((d) => d.id).join(', ')}`);
  app.quit();
});
