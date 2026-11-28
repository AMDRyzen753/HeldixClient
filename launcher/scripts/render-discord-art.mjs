// Erzeugt die Bilder für den Discord-Status und das Symbol im Infobereich – schlicht, im Heldix-Stil, reproduzierbar:
//   website/src/discord/<lage>.png      512×512, großes Bild je Lage (Launcher, Hauptmenü, Oberwelt, Nether, End,
//                                       Server, geteilte Welt, Spiel) – die Webseite liefert sie unter /discord/ aus
//   website/src/discord/loader-*.png    256×256, kleines Bild (Loader-Symbol), wenn kein Kopf gezeigt wird
//   launcher/src/renderer/tray.png      16×16 und tray@2x.png 32×32: Heldix-Logo für den Infobereich (Tray)
// Gezeichnet wird mit Abstandsfeldern (glatte Kanten ohne Grafikbibliothek), nur Node, kein Electron.
// Aufruf: npm run discord-art   (danach: website neu bauen; der Launcher kopiert die Bilder für die Vorschau mit)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const launcherDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DISCORD_OUT = path.join(launcherDir, '..', 'website', 'src', 'discord');
const RENDERER_OUT = path.join(launcherDir, 'src', 'renderer');

// ---------------------------------------------------------------------------------------------
// Bild und PNG
// ---------------------------------------------------------------------------------------------

class Img {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    // RGBA als Gleitkommazahlen 0–1 (nicht vormultipliziert)
    this.data = new Float32Array(width * height * 4);
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
function encodePng(img) {
  const { width, height, data } = img;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width * 4; x++) {
      raw[y * (width * 4 + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(data[y * width * 4 + x] * 255)));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------------------------
// Farben
// ---------------------------------------------------------------------------------------------

/** '#rrggbb' (+ Deckkraft) → [r, g, b, a] als 0–1 */
function hex(color, alpha = 1) {
  const n = parseInt(color.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha];
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function stops(list, t) {
  const v = Math.max(0, Math.min(1, t));
  for (let i = 1; i < list.length; i++) {
    if (v <= list[i][0]) {
      const [p0, c0] = list[i - 1];
      const [p1, c1] = list[i];
      return mix(c0, c1, p1 === p0 ? 0 : (v - p0) / (p1 - p0));
    }
  }
  return list[list.length - 1][1];
}
function linear(x0, y0, x1, y1, list) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = dx * dx + dy * dy;
  return (x, y) => stops(list, ((x - x0) * dx + (y - y0) * dy) / len);
}
function radial(cx, cy, r, list) {
  return (x, y) => stops(list, Math.hypot(x - cx, y - cy) / r);
}

// ---------------------------------------------------------------------------------------------
// Abstandsfelder (negativ = innen, in Pixeln)
// ---------------------------------------------------------------------------------------------

const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;
function roundRect(x0, y0, w, h, r) {
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  return (x, y) => {
    const qx = Math.abs(x - cx) - (w / 2 - r);
    const qy = Math.abs(y - cy) - (h / 2 - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
}
function polygon(points) {
  return (x, y) => {
    let d = Infinity;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [ax, ay] = points[j];
      const [bx, by] = points[i];
      const ex = bx - ax;
      const ey = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
      d = Math.min(d, Math.hypot(x - ax - ex * t, y - ay - ey * t));
      if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
    return inside ? -d : d;
  };
}
const segment = (ax, ay, bx, by, r) => (x, y) => {
  const ex = bx - ax;
  const ey = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
  return Math.hypot(x - ax - ex * t, y - ay - ey * t) - r;
};
/** Ellipse (Abstand über den Gradienten genähert – reicht für Kanten und Linien) */
const ellipse = (cx, cy, rx, ry) => (x, y) => {
  const px = (x - cx) / rx;
  const py = (y - cy) / ry;
  const k = Math.hypot(px, py);
  if (k < 1e-6) return -Math.min(rx, ry);
  const gx = px / rx / k;
  const gy = py / ry / k;
  return (k - 1) / Math.max(1e-6, Math.hypot(gx, gy));
};
const round = (sd, r) => (x, y) => sd(x, y) - r;
const outline = (sd, width) => (x, y) => Math.abs(sd(x, y)) - width / 2;
const union = (...list) => (x, y) => Math.min(...list.map((sd) => sd(x, y)));
const subtract = (a, b) => (x, y) => Math.max(a(x, y), -b(x, y));
const intersect = (a, b) => (x, y) => Math.max(a(x, y), b(x, y));
/** weiche Vereinigung (k = Rundung in Pixeln) */
const smoothUnion = (a, b, k) => (x, y) => {
  const da = a(x, y);
  const db = b(x, y);
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (db - da)) / k));
  return db + (da - db) * h - k * h * (1 - h);
};
const move = (sd, dx, dy) => (x, y) => sd(x - dx, y - dy);
/** Form aus einem Quadrat der Größe unit an Position (ox, oy) mit Kantenlänge size */
const place = (sd, ox, oy, size, unit) => {
  const s = size / unit;
  return (x, y) => sd((x - ox) / s, (y - oy) / s) * s;
};

/**
 * Malt eine Form: glatte Kante (1 px), mit soft > 0 eine weiche Fläche (Schatten, Leuchten).
 * color: [r,g,b,a] oder (x, y) => [r,g,b,a]
 */
function paint(img, sd, color, { soft = 0, opacity = 1 } = {}) {
  const { width, height, data } = img;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d = sd(px, py);
      let cover;
      if (soft > 0) {
        const t = Math.max(0, Math.min(1, (d + soft) / (2 * soft)));
        cover = 1 - t * t * (3 - 2 * t);
      } else cover = Math.max(0, Math.min(1, 0.5 - d));
      if (cover <= 0) continue;
      const c = typeof color === 'function' ? color(px, py) : color;
      const a = c[3] * cover * opacity;
      if (a <= 0) continue;
      const i = (y * width + x) * 4;
      const da = data[i + 3];
      const out = a + da * (1 - a);
      for (let k = 0; k < 3; k++) data[i + k] = out > 0 ? (c[k] * a + data[i + k] * da * (1 - a)) / out : 0;
      data[i + 3] = out;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Heldix-Logo (wie src/renderer/logo.svg, Raster 200)
// ---------------------------------------------------------------------------------------------

function hexagon(cx, cy, r) {
  return polygon(Array.from({ length: 6 }, (_, i) => {
    const a = ((-90 + 60 * i) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }));
}
/** Sechseck mit runden Ecken wie die Grundform des Logos (Außenradius 88, Ecken ≈ 24) */
const LOGO_SHAPE = round(hexagon(100, 100, 88 - 24 / Math.cos(Math.PI / 6)), 24);
const LOGO_H = union(
  roundRect(57, 58, 27, 84, 7),
  roundRect(116, 58, 27, 84, 7),
  polygon([[84, 106], [116, 85], [116, 110], [84, 131]]),
);

function drawLogo(img, ox, oy, size, { shadow = true } = {}) {
  const s = size / 200;
  const shape = place(LOGO_SHAPE, ox, oy, size, 200);
  if (shadow) paint(img, move(shape, 0, 6 * s), hex('#020617', 0.55), { soft: 14 * s });
  const fill = linear(ox + 30 * s, oy + 200 * s, ox + 170 * s, oy, [[0, hex('#1d4ed8')], [0.55, hex('#3b82f6')], [1, hex('#22d3ee')]]);
  paint(img, shape, fill);
  paint(img, shape, linear(0, oy, 0, oy + 110 * s, [[0, hex('#ffffff', 0.32)], [1, hex('#ffffff', 0)]]));
  paint(img, outline(shape, Math.max(1, 2 * s)), linear(0, oy, 0, oy + size, [[0, hex('#ffffff', 0.55)], [0.6, hex('#ffffff', 0.08)], [1, hex('#ffffff', 0.15)]]));
  const letter = place(LOGO_H, ox, oy, size, 200);
  if (size >= 40) paint(img, move(letter, 0, 4 * s), hex('#0b1f4d', 0.5), { soft: 5 * s });
  paint(img, letter, hex('#ffffff'));
}

// ---------------------------------------------------------------------------------------------
// Große Bilder (512×512)
// ---------------------------------------------------------------------------------------------

const SIZE = 512;

/** dunkler Grund mit Leuchten in der Farbe der Lage */
function backdrop(glow, glow2 = glow) {
  const img = new Img(SIZE, SIZE);
  paint(img, () => -1, linear(0, 0, 0, SIZE, [[0, hex('#0f1526')], [1, hex('#070a12')]]));
  paint(img, () => -1, radial(256, 236, 330, [[0, hex(glow, 0.5)], [0.55, hex(glow2, 0.16)], [1, hex(glow2, 0)]]));
  // feiner Rand wie die Karten im Launcher
  paint(img, outline(roundRect(6, 6, SIZE - 12, SIZE - 12, 88), 2), hex('#ffffff', 0.08));
  return img;
}

/** Isometrischer Block: Mitte oben (cx, top), halbe Breite w, Höhe der Deckfläche 2h, Seiten depth */
function isoBlock(img, cx, top, w, h, depth, faces) {
  const T = [cx, top];
  const R = [cx + w, top + h];
  const B = [cx, top + 2 * h];
  const L = [cx - w, top + h];
  const down = ([x, y], d = depth) => [x, y + d];
  const left = polygon([L, B, down(B), down(L)]);
  const right = polygon([B, R, down(R), down(B)]);
  const upper = polygon([T, R, B, L]);
  paint(img, move(union(left, right, upper), 0, 14), hex('#020617', 0.55), { soft: 22 });
  paint(img, left, faces.left);
  paint(img, right, faces.right);
  paint(img, upper, faces.top);
  return { T, R, B, L, left, right, upper, down };
}

function speckles(img, area, colors, seed, step = 18) {
  let n = seed;
  const rand = () => ((n = (n * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < SIZE; y += step) {
    for (let x = 0; x < SIZE; x += step) {
      if (area(x + step / 2, y + step / 2) > -step / 2) continue;
      if (rand() < 0.55) continue;
      const square = roundRect(x + 3, y + 3, step - 6, step - 6, 2);
      paint(img, intersect(square, area), colors[Math.floor(rand() * colors.length)]);
    }
  }
}

const SCENES = {
  launcher() {
    const img = backdrop('#3b82f6', '#22d3ee');
    drawLogo(img, 256 - 170, 256 - 170, 340);
    return img;
  },

  hauptmenue() {
    const img = backdrop('#8b5cf6', '#6366f1');
    const panel = roundRect(126, 118, 260, 296, 30);
    paint(img, move(panel, 0, 14), hex('#020617', 0.6), { soft: 24 });
    paint(img, panel, linear(0, 118, 0, 414, [[0, hex('#241f4f')], [1, hex('#16132e')]]));
    paint(img, outline(panel, 3), hex('#a78bfa', 0.45));
    // Titel
    paint(img, roundRect(166, 156, 180, 46, 14), linear(166, 0, 346, 0, [[0, hex('#7c3aed')], [1, hex('#a78bfa')]]));
    // drei Knöpfe, der erste hervorgehoben
    paint(img, roundRect(166, 232, 180, 42, 13), hex('#8b5cf6'));
    paint(img, roundRect(196, 249, 120, 8, 4), hex('#ffffff', 0.9));
    for (const y of [290, 348]) {
      const button = roundRect(166, y, 180, 42, 13);
      paint(img, button, hex('#2e2766'));
      paint(img, outline(button, 2.5), hex('#a78bfa', 0.35));
      paint(img, roundRect(206, y + 17, 100, 8, 4), hex('#c4b5fd', 0.55));
    }
    return img;
  },

  oberwelt() {
    const img = backdrop('#38bdf8', '#22c55e');
    // Sonne
    paint(img, circle(392, 122, 70), hex('#fde047', 0.35), { soft: 40 });
    paint(img, circle(392, 122, 38), radial(380, 110, 48, [[0, hex('#fef9c3')], [1, hex('#facc15')]]));
    const block = isoBlock(img, 250, 132, 132, 76, 158, {
      top: linear(250, 132, 250, 284, [[0, hex('#86efac')], [1, hex('#22c55e')]]),
      left: linear(0, 208, 0, 442, [[0, hex('#b45309')], [1, hex('#7c2d12')]]),
      right: linear(0, 208, 0, 442, [[0, hex('#92400e')], [1, hex('#5a2309')]]),
    });
    // Gras hängt über die Seiten (Zacken wie bei Minecraft)
    const { L, B, R } = block;
    const zig = (from, to, depth, teeth) => {
      const pts = [from, to];
      for (let i = teeth; i >= 0; i--) {
        const t = i / teeth;
        const x = from[0] + (to[0] - from[0]) * t;
        const y = from[1] + (to[1] - from[1]) * t + depth * (i % 2 === 0 ? 1 : 0.55);
        pts.push([x, y]);
      }
      return polygon(pts);
    };
    paint(img, intersect(zig(L, B, 42, 8), block.left), hex('#16a34a'));
    paint(img, intersect(zig(B, R, 42, 8), block.right), hex('#15803d'));
    speckles(img, subtract(block.left, zig(L, B, 50, 8)), [hex('#d97706', 0.7), hex('#78350f', 0.6)], 7);
    speckles(img, subtract(block.right, zig(B, R, 50, 8)), [hex('#b45309', 0.55), hex('#451a03', 0.6)], 11);
    speckles(img, block.upper, [hex('#bbf7d0', 0.45), hex('#15803d', 0.4)], 3);
    // Kante oben
    paint(img, outline(block.upper, 2), hex('#ffffff', 0.25));
    return img;
  },

  nether() {
    const img = backdrop('#ef4444', '#f97316');
    const outer = smoothUnion(circle(256, 318, 112), polygon([[256, 72], [356, 288], [156, 288]]), 46);
    const tongue = smoothUnion(circle(334, 250, 34), polygon([[372, 150], [356, 262], [312, 240]]), 18);
    const flame = smoothUnion(outer, tongue, 22);
    paint(img, flame, hex('#ef4444', 0.6), { soft: 34 });
    paint(img, flame, linear(0, 80, 0, 430, [[0, hex('#fdba74')], [0.45, hex('#f97316')], [1, hex('#b91c1c')]]));
    const inner = smoothUnion(circle(256, 350, 64), polygon([[256, 196], [312, 330], [200, 330]]), 26);
    paint(img, inner, linear(0, 196, 0, 414, [[0, hex('#fef3c7')], [1, hex('#fb923c')]]));
    // Glut
    for (const [x, y, s] of [[146, 168, 16], [372, 352, 14], [120, 300, 12], [392, 98, 12], [180, 96, 10]]) {
      paint(img, roundRect(x, y, s, s, 2), hex('#fdba74', 0.85));
    }
    // Netherrack am Boden
    const ground = roundRect(96, 424, 320, 30, 12);
    paint(img, ground, linear(0, 424, 0, 454, [[0, hex('#7f1d1d')], [1, hex('#450a0a')]]));
    return img;
  },

  end() {
    const img = backdrop('#a855f7', '#6d28d9');
    const sparkle = (x, y, s, a = 0.9) => {
      paint(img, union(ellipse(x, y, s, s * 0.18), ellipse(x, y, s * 0.18, s)), hex('#f5f3ff', a));
    };
    sparkle(118, 120, 22);
    sparkle(404, 150, 16, 0.75);
    sparkle(396, 396, 20);
    sparkle(126, 380, 12, 0.6);
    sparkle(300, 84, 10, 0.6);
    const eye = circle(256, 266, 118);
    paint(img, eye, hex('#2dd4bf', 0.45), { soft: 40 });
    paint(img, eye, radial(236, 244, 150, [[0, hex('#99f6e4')], [0.45, hex('#14b8a6')], [1, hex('#0f5f59')]]));
    paint(img, outline(eye, 10), hex('#042f2e', 0.85));
    paint(img, ellipse(256, 266, 24, 78), hex('#021a17'));
    paint(img, circle(212, 220, 15), hex('#ffffff', 0.7));
    return img;
  },

  server() {
    const img = backdrop('#3b82f6', '#06b6d4');
    for (const [i, y] of [150, 238, 326].entries()) {
      const unit = roundRect(128, y, 256, 72, 18);
      paint(img, move(unit, 0, 8), hex('#020617', 0.5), { soft: 14 });
      paint(img, unit, linear(0, y, 0, y + 72, [[0, hex('#1e293b')], [1, hex('#111827')]]));
      paint(img, outline(unit, 2.5), hex('#93c5fd', 0.45));
      paint(img, circle(170, y + 36, 10), hex(i === 1 ? '#60a5fa' : '#34d399'));
      paint(img, circle(170, y + 36, 18), hex(i === 1 ? '#60a5fa' : '#34d399', 0.35), { soft: 8 });
      paint(img, roundRect(214, y + 22, 128, 9, 4.5), hex('#64748b'));
      paint(img, roundRect(214, y + 41, 84, 9, 4.5), hex('#475569'));
    }
    return img;
  },

  'geteilte-welt'() {
    const img = backdrop('#14b8a6', '#22c55e');
    const cx = 256;
    const cy = 262;
    const orbit = ellipse(cx, cy + 8, 186, 58);
    // Umlaufbahn hinten (obere Hälfte, hinter der Kugel)
    paint(img, intersect(outline(orbit, 5), (x, y) => y - (cy + 8)), hex('#99f6e4', 0.45));
    const globe = circle(cx, cy, 118);
    paint(img, move(globe, 0, 10), hex('#020617', 0.5), { soft: 22 });
    paint(img, globe, radial(cx - 36, cy - 40, 170, [[0, hex('#5eead4')], [0.55, hex('#0d9488')], [1, hex('#115e59')]]));
    const lines = union(
      outline(ellipse(cx, cy, 52, 118), 7),
      segment(cx - 118, cy, cx + 118, cy, 3.5),
      segment(cx, cy - 118, cx, cy + 118, 3.5),
      segment(cx - 104, cy - 56, cx + 104, cy - 56, 3),
      segment(cx - 104, cy + 56, cx + 104, cy + 56, 3),
    );
    paint(img, intersect(lines, globe), hex('#ecfeff', 0.75));
    paint(img, outline(globe, 6), hex('#ecfeff', 0.85));
    // Umlaufbahn vorn mit zwei Spielern
    paint(img, intersect(outline(orbit, 5), (x, y) => cy + 8 - y), hex('#ccfbf1', 0.8));
    for (const [x, y, color] of [[cx - 160, cy + 38, '#fbbf24'], [cx + 150, cy - 14, '#60a5fa']]) {
      paint(img, roundRect(x - 20, y - 20, 40, 40, 9), hex('#020617', 0.5), { soft: 10 });
      paint(img, roundRect(x - 18, y - 18, 36, 36, 8), hex(color));
      paint(img, union(roundRect(x - 10, y - 6, 7, 7, 1.5), roundRect(x + 3, y - 6, 7, 7, 1.5)), hex('#0f172a', 0.85));
    }
    return img;
  },

  spiel() {
    const img = backdrop('#3b82f6', '#6366f1');
    const block = isoBlock(img, 256, 120, 136, 78, 160, {
      top: linear(256, 120, 256, 276, [[0, hex('#93c5fd')], [1, hex('#3b82f6')]]),
      left: linear(0, 198, 0, 436, [[0, hex('#2563eb')], [1, hex('#1e3a8a')]]),
      right: linear(0, 198, 0, 436, [[0, hex('#1d4ed8')], [1, hex('#172554')]]),
    });
    paint(img, outline(block.upper, 2.5), hex('#ffffff', 0.3));
    paint(img, segment(block.B[0], block.B[1], block.B[0], block.B[1] + 160, 1.2), hex('#ffffff', 0.18));
    return img;
  },
};

// ---------------------------------------------------------------------------------------------
// Kleine Bilder (Loader-Symbole, Discord zeigt sie rund)
// ---------------------------------------------------------------------------------------------

const SMALL = 256;

function smallBase() {
  const img = new Img(SMALL, SMALL);
  const disc = circle(128, 128, 126);
  paint(img, disc, linear(0, 0, 0, SMALL, [[0, hex('#18213a')], [1, hex('#0b1020')]]));
  paint(img, outline(circle(128, 128, 122), 3), hex('#ffffff', 0.1));
  return img;
}

const LOADERS = {
  'loader-heldix'() {
    const img = smallBase();
    drawLogo(img, 128 - 82, 128 - 82, 164);
    return img;
  },
  'loader-fabric'() {
    // Garnrolle: neutrales Symbol für „Fabric“ (kein fremdes Logo)
    const img = smallBase();
    paint(img, roundRect(80, 58, 96, 26, 10), hex('#e2d6b5'));
    paint(img, roundRect(80, 172, 96, 26, 10), hex('#c9b98e'));
    paint(img, roundRect(92, 80, 72, 96, 8), linear(92, 0, 164, 0, [[0, hex('#a78bfa')], [1, hex('#7c3aed')]]));
    for (let y = 92; y < 172; y += 13) paint(img, segment(96, y, 160, y + 4, 2.2), hex('#ede9fe', 0.55));
    paint(img, segment(164, 150, 196, 196, 3), hex('#a78bfa'));
    return img;
  },
  'loader-vanilla'() {
    // Grasblock wie die Oberwelt
    const img = smallBase();
    const w = 64;
    const h = 37;
    const top = 62;
    const T = [128, top];
    const R = [128 + w, top + h];
    const B = [128, top + 2 * h];
    const L = [128 - w, top + h];
    const d = 76;
    paint(img, polygon([L, B, [B[0], B[1] + d], [L[0], L[1] + d]]), hex('#92400e'));
    paint(img, polygon([B, R, [R[0], R[1] + d], [B[0], B[1] + d]]), hex('#6b2f0b'));
    paint(img, polygon([L, B, [B[0], B[1] + 20], [L[0], L[1] + 20]]), hex('#16a34a'));
    paint(img, polygon([B, R, [R[0], R[1] + 20], [B[0], B[1] + 20]]), hex('#15803d'));
    paint(img, polygon([T, R, B, L]), linear(0, top, 0, top + 2 * h, [[0, hex('#86efac')], [1, hex('#22c55e')]]));
    return img;
  },
};

// ---------------------------------------------------------------------------------------------
// Infobereich (Tray): nur das Logo, durchsichtig
// ---------------------------------------------------------------------------------------------

function trayIcon(size) {
  const img = new Img(size, size);
  drawLogo(img, 0, 0, size, { shadow: false });
  return img;
}

await mkdir(DISCORD_OUT, { recursive: true });
for (const [name, draw] of Object.entries({ ...SCENES, ...LOADERS })) {
  await writeFile(path.join(DISCORD_OUT, `${name}.png`), encodePng(draw()));
}
await writeFile(path.join(RENDERER_OUT, 'tray.png'), encodePng(trayIcon(16)));
await writeFile(path.join(RENDERER_OUT, 'tray@2x.png'), encodePng(trayIcon(32)));
console.log(`Discord-Bilder geschrieben: ${Object.keys(SCENES).length} Lagen, ${Object.keys(LOADERS).length} Loader-Symbole (website/src/discord/), Tray-Symbol (src/renderer/tray.png)`);
