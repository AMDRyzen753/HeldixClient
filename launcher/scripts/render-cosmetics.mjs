// Erzeugt den Startsatz der Heldix-Cosmetics als Quellen im Repo-Wurzelordner cosmetics/<id>/:
//   cosmetic.json  – Manifest ohne type, date, texture und glow (siehe launcher/src/main/core/cosmetics-format.ts)
//   texture.png    – Textur in Minecraft-Auflösung (16 px je Block), Box-UV wie Minecraft/Blockbench
//   glow.png       – optional: leuchtende Teile (gleiche Größe, im Spiel ohne Licht gezeichnet)
// Alles ist Pixel-Art, programmatisch gezeichnet und reproduzierbar (feste Zufallszahlen). Danach:
//   npm run cosmetic                      prüfen, signieren, release/cosmetics/<id>-<version>.cosmetic.json schreiben
//   npm run cosmetic:preview -- <ordner>  Vorschaubilder rendern
// Aufruf: npm run cosmetics-art   (nur Node, kein Electron)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const launcherDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(launcherDir, '..', 'cosmetics');
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// Farben, Bilder, PNG
// ---------------------------------------------------------------------------------------------

/** '#rrggbb' → [r, g, b, 255] */
function hex(color) {
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

/** Palette aus fünf Tönen: hi (Glanz), li (hell), base, sh (Schatten), dk (dunkel) */
function palette(hi, li, base, sh, dk = sh) {
  return { hi: hex(hi), li: hex(li), base: hex(base), sh: hex(sh), dk: hex(dk) };
}

class Img {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }
  set(x, y, color) {
    if (!color || x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = color[0];
    this.data[i + 1] = color[1];
    this.data[i + 2] = color[2];
    this.data[i + 3] = color[3] ?? 255;
  }
  get(x, y) {
    const i = (y * this.width + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
  empty() {
    for (let i = 3; i < this.data.length; i += 4) if (this.data[i]) return false;
    return true;
  }
}

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

/** RGBA-PNG (8 Bit); probiert Filter 0 und Paeth je Zeile und nimmt die kleinere Datei. */
function png(img) {
  const { width, height, data } = img;
  const stride = width * 4;
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  const encode = (filter) => {
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
      raw[y * (stride + 1)] = filter;
      for (let x = 0; x < stride; x++) {
        const value = data[y * stride + x];
        const a = x >= 4 ? data[y * stride + x - 4] : 0;
        const b = y > 0 ? data[(y - 1) * stride + x] : 0;
        const c = x >= 4 && y > 0 ? data[(y - 1) * stride + x - 4] : 0;
        raw[y * (stride + 1) + 1 + x] = filter === 4 ? (value - paeth(a, b, c)) & 255 : value;
      }
    }
    return zlib.deflateSync(raw, { level: 9, memLevel: 9 });
  };
  const idat = [encode(0), encode(4)].sort((a, b) => a.length - b.length)[0];
  const file = (colorType, data, extra = []) => {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = colorType;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      ...extra,
      chunk('IDAT', data),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  };
  const rgba = file(6, idat);
  // Mit höchstens 256 Farben zusätzlich als Palette (Farbtyp 3, mit tRNS) versuchen und das kleinere nehmen
  const index = new Map();
  for (let i = 0; i < data.length && index.size <= 256; i += 4) {
    const key = data[i + 3] === 0 ? 0 : ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0;
    if (!index.has(key)) index.set(key, index.size);
  }
  if (index.size > 256) return rgba;
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const key = data[i + 3] === 0 ? 0 : ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0;
      raw[y * (width + 1) + 1 + x] = index.get(key);
    }
  }
  const keys = [...index.keys()];
  const plte = Buffer.alloc(keys.length * 3);
  const trns = Buffer.alloc(keys.length);
  keys.forEach((key, i) => {
    plte[i * 3] = key >>> 24;
    plte[i * 3 + 1] = (key >>> 16) & 255;
    plte[i * 3 + 2] = (key >>> 8) & 255;
    trns[i] = key & 255;
  });
  const indexed = file(3, zlib.deflateSync(raw, { level: 9, memLevel: 9 }), [chunk('PLTE', plte), chunk('tRNS', trns)]);
  return indexed.length < rgba.length ? indexed : rgba;
}

/** reproduzierbare Zufallszahlen */
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

/** fester Pseudo-Zufallswert 0…1 je Pixelposition */
function hash(x, y, seed = 0) {
  let h = Math.imul(x * 374761393 + y * 668265263 + seed * 2147483647, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const round = (n) => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------------------------------------
// Modelle: Würfel mit Box-UV, automatisch gepackt und bemalt
// ---------------------------------------------------------------------------------------------

/**
 * Flächen eines Würfels in der Textur (wie cosmeticCubeFaces in cosmetics-format.ts): Position (u, v), Größe und die
 * Modellkoordinaten der Ecken oben links (tl), oben rechts (tr) und unten links (bl).
 */
function faceRegions(origin, size, uv) {
  const [w, h, d] = size;
  const [u, v] = uv;
  const [x0, y0, z0] = origin;
  const x1 = x0 + w, y1 = y0 + h, z1 = z0 + d;
  return [
    { face: 'right', u, v: v + d, w: d, h, n: [-1, 0, 0], tl: [x0, y1, z0], tr: [x0, y1, z1], bl: [x0, y0, z0] },
    { face: 'front', u: u + d, v: v + d, w, h, n: [0, 0, 1], tl: [x0, y1, z1], tr: [x1, y1, z1], bl: [x0, y0, z1] },
    { face: 'left', u: u + d + w, v: v + d, w: d, h, n: [1, 0, 0], tl: [x1, y1, z1], tr: [x1, y1, z0], bl: [x1, y0, z1] },
    { face: 'back', u: u + 2 * d + w, v: v + d, w, h, n: [0, 0, -1], tl: [x1, y1, z0], tr: [x0, y1, z0], bl: [x1, y0, z0] },
    { face: 'top', u: u + d, v, w, h: d, n: [0, 1, 0], tl: [x0, y1, z0], tr: [x1, y1, z0], bl: [x0, y1, z1] },
    { face: 'bottom', u: u + d + w, v, w, h: d, n: [0, -1, 0], tl: [x0, y0, z0], tr: [x1, y0, z0], bl: [x0, y0, z1] },
  ].filter((r) => r.w > 0 && r.h > 0);
}

/**
 * Bemalt alle Flächen eines Würfels. paint(f) bekommt { face, fx, fy, fw, fh, p (Modellpunkt der Texelmitte), n, cube }
 * und liefert eine Farbe oder null (durchsichtig).
 */
function paintCube(img, cube, paint) {
  for (const r of faceRegions(cube.origin, cube.size, cube.uv)) {
    for (let fy = 0; fy < r.h; fy++) {
      for (let fx = 0; fx < r.w; fx++) {
        const a = (fx + 0.5) / r.w;
        const b = (fy + 0.5) / r.h;
        const p = [0, 1, 2].map((i) => r.tl[i] + a * (r.tr[i] - r.tl[i]) + b * (r.bl[i] - r.tl[i]));
        img.set(r.u + fx, r.v + fy, paint({ face: r.face, fx, fy, fw: r.w, fh: r.h, p, n: r.n, cube }));
      }
    }
  }
}

/** Würfel; paint und glow sind Maler-Funktionen; share = anderer Würfel, dessen UV mitbenutzt wird (meist mit mirror). */
const cube = (origin, size, paint, extra = {}) => ({ origin, size, paint, ...extra });

/**
 * Baut aus Bones mit Würfeln Modell-JSON, Textur und Leuchtebene. UV-Flächen werden zeilenweise gepackt
 * (Breite width, Höhe auf ein Vielfaches von 8 aufgerundet).
 */
function buildModel(bones, { width = 64 } = {}) {
  const all = bones.flatMap((b) => b.cubes);
  for (const c of all) if (!c.size.every(Number.isInteger)) throw new Error(`Würfelkanten müssen ganzzahlig sein: ${c.size}`);
  const own = all.filter((c) => !c.share);
  const rect = (c) => [2 * c.size[2] + 2 * c.size[0], c.size[2] + c.size[1]];
  const order = [...own].sort((a, b) => rect(b)[1] - rect(a)[1] || rect(b)[0] - rect(a)[0]);
  let x = 0, y = 0, shelf = 0;
  for (const c of order) {
    const [rw, rh] = rect(c);
    if (rw > width) throw new Error(`UV-Fläche ${rw} breiter als Textur ${width}`);
    if (x + rw > width) {
      y += shelf;
      x = 0;
      shelf = 0;
    }
    c.uv = [x, y];
    x += rw;
    shelf = Math.max(shelf, rh);
  }
  const height = Math.max(8, Math.ceil((y + shelf) / 8) * 8);
  for (const c of all) if (c.share) c.uv = c.share.uv;
  const texture = new Img(width, height);
  const glow = new Img(width, height);
  for (const c of own) {
    paintCube(texture, c, c.paint);
    if (c.glow) paintCube(glow, c, c.glow);
  }
  const json = {
    textureSize: [width, height],
    bones: bones.map((b) => {
      const bone = { name: b.name };
      if (b.parent) bone.parent = b.parent;
      bone.pivot = b.pivot.map(round);
      if (b.rotation && b.rotation.some((r) => r !== 0)) bone.rotation = b.rotation.map(round);
      bone.cubes = b.cubes.map((c) => {
        const out = { origin: c.origin.map(round), size: c.size.map(round), uv: c.uv };
        if (c.inflate) out.inflate = c.inflate;
        if (c.mirror) out.mirror = true;
        return out;
      });
      return bone;
    }),
  };
  return { model: json, texture, glow: glow.empty() ? null : glow };
}

// ---------------------------------------------------------------------------------------------
// Maler (Materialien)
// ---------------------------------------------------------------------------------------------

/** Würfel mit klarer Form: oben hell, Seiten mit heller Oberkante und dunkler Unterkante, unten dunkel */
const solid = (pal, { topHi = false, bottom = 'sh' } = {}) => (f) => {
  if (f.face === 'top') return topHi ? pal.hi : pal.li;
  if (f.face === 'bottom') return pal[bottom];
  if (f.fh >= 2 && f.fy === 0) return pal.li;
  if (f.fh >= 3 && f.fy === f.fh - 1) return pal.sh;
  return pal.base;
};

/** eine Farbe für alle Flächen */
const flat = (color) => () => color;

/** Sprite auf einer Ebene (Würfel mit einer Kante 0): Zeilen von oben, Spalten ab origin; map: Zeichen → Farbe */
function planeSprite(rows, map, axes = 'xy') {
  return (f) => {
    const [x0, y0, z0] = f.cube.origin;
    const [w, h, d] = f.cube.size;
    let col, row;
    if (axes === 'xy') {
      col = Math.floor(f.p[0] - x0);
      row = Math.floor(y0 + h - f.p[1]);
    } else {
      // xz-Ebene: Zeilen von hinten (z0) nach vorn
      col = Math.floor(f.p[0] - x0);
      row = Math.floor(f.p[2] - z0);
    }
    const ch = rows[row]?.[col];
    return ch && ch !== '.' ? map[ch] ?? null : null;
  };
}

// ---------------------------------------------------------------------------------------------
// Paletten (je 4–5 Töne, abgestimmt auf die Heldix-Capes)
// ---------------------------------------------------------------------------------------------

const GOLD = palette('#fff6c4', '#ffd75a', '#f0ae27', '#c27616', '#86500e');
const RUBY = palette('#ffc2c2', '#ff5f6d', '#d6263d', '#8c1228');
const SAPPHIRE = palette('#d4f0ff', '#62b8ff', '#2563eb', '#1e3a8a');
const EMERALD = palette('#d3ffe2', '#52e08a', '#17a34a', '#0f5c2e');
const PEARL = palette('#ffffff', '#f6f2ea', '#ddd5c6', '#aaa192');
const VELVET = palette('#ef7f95', '#cc3d5c', '#a32447', '#741634', '#4f0c22');
const PLATINUM = palette('#ffffff', '#e8eef7', '#c2cddd', '#8794ad', '#58627a');
const HELDIX = palette('#e0fbff', '#67e8f9', '#22b8e0', '#1d6fd8', '#1e3a8a');

// ---------------------------------------------------------------------------------------------
// head: Krone und Team-Krone
// ---------------------------------------------------------------------------------------------

/**
 * Krone: Reif aus vier Wänden (innen hohl), Zacken mit Perlen, Samtkappe mit Reichsapfel.
 * metal = Palette des Reifs, gems = { center, side, back }, glowGems = Edelsteine leuchten (Team-Krone)
 */
function crown({ metal, gems, cap, glowGems = false, tall = false }) {
  const gemOf = (ch) => ({ r: gems.center, s: gems.side, e: gems.back, p: PEARL }[ch.toLowerCase()]);
  // Muster der mittleren Zeile je Außenseite (Großbuchstabe = heller Ton des Steins)
  const band = (pattern) => (f) => {
    if (f.face === 'top') return metal.li;
    if (f.face === 'bottom') return metal.dk;
    const isOuter = (f.cube.outer === f.face);
    if (!isOuter) {
      // Innenseite und Stirnflächen
      if (f.fw === 1) return f.fy === 0 ? metal.li : f.fy === f.fh - 1 ? metal.sh : metal.base;
      return f.fy === 0 ? metal.base : metal.sh;
    }
    if (f.fy === 0) return f.fx === 1 || f.fx === f.fw - 2 ? metal.hi : metal.li;
    if (f.fy === f.fh - 1) return metal.sh;
    const ch = pattern[f.fx] ?? 'b';
    if (ch === 'b') return metal.base;
    if (ch === 'l') return metal.li;
    if (ch === 'L') return metal.hi;
    const gem = gemOf(ch);
    return ch === ch.toUpperCase() ? gem.li : gem.base;
  };
  const bandGlow = (pattern) => (f) => {
    if (!glowGems || f.cube.outer !== f.face || f.fy !== 1) return null;
    const ch = pattern[f.fx] ?? 'b';
    if (ch === 'b' || ch.toLowerCase() === 'l' || ch.toLowerCase() === 'p') return null;
    const gem = gemOf(ch);
    return ch === ch.toUpperCase() ? gem.hi : gem.li;
  };
  const spire = (f) => {
    if (f.face === 'top') return metal.hi;
    if (f.face === 'bottom') return metal.dk;
    if (f.fw >= 2) {
      // breite Zacke: links heller Rand, rechts Schatten
      if (f.fy === f.fh - 1) return f.fx === 0 ? metal.base : metal.sh;
      return f.fx === 0 ? metal.li : metal.base;
    }
    return f.fy === 0 ? metal.li : metal.base;
  };
  const knob = (f) => (f.face === 'top' ? metal.hi : f.face === 'bottom' ? metal.sh : f.face === 'front' || f.face === 'right' ? metal.hi : metal.li);
  const gemCube = (gem) => (f) => (f.face === 'top' ? gem.hi : f.face === 'bottom' ? gem.sh : f.face === 'front' || f.face === 'right' ? gem.li : gem.base);
  const gemGlow = (gem) => (glowGems ? (f) => (f.face === 'top' ? gem.hi : gem.li) : undefined);
  const velvet = (f) => {
    if (f.face !== 'top') return f.fy === 0 ? cap.base : cap.sh;
    // gesteppter Samt: Rauten aus Schattenlinien, helle Punkte in der Mitte
    const x = f.fx, y = f.fy;
    if ((x + y) % 4 === 1 || (x - y + 8) % 4 === 1) return cap.sh;
    if ((x + y) % 4 === 3 && (x - y + 8) % 4 === 3) return cap.li;
    return cap.base;
  };

  const front = 'bSbLrRlbSb'; // Saphire außen, Rubin in der Mitte, helle Punkte
  const side = 'bPbEeLbP'.slice(0, 8);
  const back = 'bPblEelbPb';
  const wall = (o, s, outer, pattern) => cube(o, s, band(pattern), { outer, glow: glowGems ? bandGlow(pattern) : undefined });
  const corner = tall ? 4 : 3;
  const middle = tall ? 3 : 2;
  const cubes = [
    // Reif
    wall([-5, -1, 4], [10, 3, 1], 'front', front),
    wall([-5, -1, -5], [10, 3, 1], 'back', back),
    wall([4, -1, -4], [1, 3, 8], 'left', side),
    wall([-5, -1, -4], [1, 3, 8], 'right', side),
    // Samtkappe
    cube([-4, -1, -4], [8, 3, 8], velvet),
    cube([-3, 2, -3], [6, 1, 6], velvet),
    // Eckzacken mit Knauf
    ...[[-5, 4], [4, 4], [-5, -5], [4, -5]].flatMap(([x, z]) => [cube([x, 2, z], [1, corner, 1], spire), cube([x, 2 + corner, z], [1, 1, 1], knob)]),
    // mittlere Zacken mit Stein obenauf
    cube([-1, 2, 4], [2, middle, 1], spire),
    cube([-1, 2, -5], [2, middle, 1], spire),
    cube([4, 2, -1], [1, middle, 2], spire),
    cube([-5, 2, -1], [1, middle, 2], spire),
    cube([-0.5, 2 + middle, 4], [1, 1, 1], gemCube(gems.center), { glow: gemGlow(gems.center) }),
    cube([-0.5, 2 + middle, -5], [1, 1, 1], gemCube(gems.back), { glow: gemGlow(gems.back) }),
    cube([4, 2 + middle, -0.5], [1, 1, 1], gemCube(gems.side), { glow: gemGlow(gems.side) }),
    cube([-5, 2 + middle, -0.5], [1, 1, 1], gemCube(gems.side), { glow: gemGlow(gems.side) }),
    // kleine Zacken dazwischen
    ...[[-3, 4], [2, 4], [-3, -5], [2, -5]].map(([x, z]) => cube([x, 2, z], [1, 1, 1], spire)),
    ...[[4, -3], [4, 2], [-5, -3], [-5, 2]].map(([x, z]) => cube([x, 2, z], [1, 1, 1], spire)),
  ];
  return buildModel([{ name: 'krone', pivot: [0, 0, 0], cubes }]);
}

// ---------------------------------------------------------------------------------------------
// head: Zylinder
// ---------------------------------------------------------------------------------------------

function topHat() {
  const hat = palette('#5d5d72', '#40404f', '#2b2b36', '#1d1d25', '#121217');
  const ribbon = palette('#ff8a8a', '#e0474f', '#b3243a', '#7d1628', '#540d1b');
  const pin = GOLD;
  // runde Wirkung: auf jeder Seite links Glanz, rechts Schatten
  const body = (f) => {
    if (f.face === 'top') {
      const edge = f.fx === 0 || f.fy === 0;
      const edge2 = f.fx === f.fw - 1 || f.fy === f.fh - 1;
      return edge ? hat.li : edge2 ? hat.sh : (f.fx + f.fy) % 5 === 2 ? hat.li : hat.base;
    }
    if (f.face === 'bottom') return hat.dk;
    const bandRows = f.fy >= f.fh - 3 && f.fy <= f.fh - 2;
    if (bandRows) {
      // Band mit Schleife links (Seite +X) und goldener Nadel vorn
      if (f.face === 'front' && f.fx === 5 && f.fy === f.fh - 3) return pin.li;
      if (f.face === 'front' && f.fx === 5) return pin.sh;
      const row = f.fy - (f.fh - 3);
      if (f.fx === 0) return row === 0 ? ribbon.li : ribbon.base;
      if (f.fx === f.fw - 1) return ribbon.sh;
      return row === 0 ? ribbon.li : ribbon.base;
    }
    if (f.fy === f.fh - 1) return hat.sh;
    if (f.fx === 0) return hat.li;
    if (f.fx === 1) return f.fy === 0 ? hat.hi : hat.li;
    if (f.fx === f.fw - 1) return hat.sh;
    return f.fy === 0 ? hat.li : hat.base;
  };
  const brim = (f) => {
    if (f.face === 'top') {
      const ring = f.fx === 0 || f.fy === 0 || f.fx === f.fw - 1 || f.fy === f.fh - 1;
      return ring ? hat.li : hat.base;
    }
    if (f.face === 'bottom') return hat.dk;
    return hat.sh;
  };
  const bow = (f) => (f.face === 'top' ? ribbon.li : f.face === 'bottom' ? ribbon.dk : f.fx === 0 ? ribbon.base : ribbon.sh);
  const cubes = [
    cube([-6, 0, -5], [12, 1, 10], brim),
    cube([-5, 0, -6], [10, 1, 12], brim),
    cube([-4, 1, -4], [8, 8, 8], body),
    // kleine Schleife am Band (Seite des Trägers links = +X)
    cube([4, 2, -1], [1, 2, 2], bow),
  ];
  return buildModel([{ name: 'hut', pivot: [0, 0, 0], rotation: [0, 0, 0], cubes }]);
}

// ---------------------------------------------------------------------------------------------
// head: Heiligenschein
// ---------------------------------------------------------------------------------------------

function halo() {
  const ring = palette('#fffbe0', '#fff0a8', '#ffd75a', '#e8a93a', '#c07a1c');
  const glowPal = palette('#fffbe6', '#ffeb8a', '#ffd84f', '#f5b935');
  // leicht schimmernder Ring: oben hell, Außenseite im Wechsel hell/mittel
  const paint = (f) => {
    if (f.face === 'top') return (Math.floor(f.p[0] + 5) + Math.floor(f.p[2] + 5)) % 3 === 0 ? ring.hi : ring.li;
    if (f.face === 'bottom') return ring.sh;
    return (Math.floor(f.p[0] + 5) + Math.floor(f.p[2] + 5)) % 2 ? ring.base : ring.li;
  };
  const glow = (f) => {
    const k = Math.floor(f.p[0] + 5) + Math.floor(f.p[2] + 5);
    if (f.face === 'bottom') return glowPal.sh;
    if (f.face === 'top') return k % 3 === 0 ? glowPal.hi : glowPal.li;
    return k % 2 ? glowPal.base : glowPal.li;
  };
  const y = 3.5;
  const c = (o, s) => cube(o, s, paint, { glow });
  const cubes = [
    c([-3, y, 4], [6, 1, 1]),
    c([-3, y, -5], [6, 1, 1]),
    c([4, y, -3], [1, 1, 6]),
    c([-5, y, -3], [1, 1, 6]),
    c([3, y, 3], [1, 1, 1]),
    c([-4, y, 3], [1, 1, 1]),
    c([3, y, -4], [1, 1, 1]),
    c([-4, y, -4], [1, 1, 1]),
  ];
  return buildModel([{ name: 'schein', pivot: [0, 4, 0], rotation: [0, 0, 0], cubes }], { width: 32 });
}

// ---------------------------------------------------------------------------------------------
// head: Partyhut
// ---------------------------------------------------------------------------------------------

function partyHat() {
  const pink = palette('#ffd1ec', '#ff7ac8', '#ec4899', '#b3266f', '#7d1550');
  const yellow = palette('#fff9cc', '#ffe45c', '#facc15', '#c99a06');
  const cyan = palette('#d9fbff', '#67e8f9', '#22c7e0', '#0e8fa8');
  const pom = palette('#ffffff', '#fff4c2', '#ffd75e', '#e0a83a');
  // Stufen in klaren Farben, je mit Punkten in einer Kontrastfarbe
  const tier = (pal, dot) => (f) => {
    if (f.face === 'bottom') return pal.dk;
    if (f.face === 'top') return (f.fx + f.fy) % 3 === 1 ? dot : pal.li;
    const face = { front: 0, left: 1, back: 2, right: 3 }[f.face];
    if (f.fy === f.fh - 1 && f.fh > 1 && (f.fx * 2 + face) % 3 === 1) return dot;
    if (f.fy === 0 && f.fh > 1) return pal.li;
    return pal.base;
  };
  const pompom = (f) => {
    if (f.face === 'top') return f.fx === 1 && f.fy === 1 ? pom.li : pom.hi;
    if (f.face === 'bottom') return pom.base;
    if (f.fy === 0) return pom.hi;
    if (f.fy === f.fh - 1) return (f.fx + f.fy) % 2 ? pom.base : pom.li;
    return f.fx === 1 ? pom.hi : pom.li;
  };
  const cubes = [
    cube([-3, -0.5, -3], [6, 2, 6], tier(pink, yellow.li)),
    cube([-2.5, 1.5, -2.5], [5, 2, 5], tier(yellow, cyan.base)),
    cube([-2, 3.5, -2], [4, 2, 4], tier(cyan, pink.li)),
    cube([-1.5, 5.5, -1.5], [3, 2, 3], tier(pink, yellow.li)),
    cube([-1, 7.5, -1], [2, 1, 2], tier(yellow, pink.base)),
    cube([-1.5, 8.5, -1.5], [3, 3, 3], pompom),
  ];
  return buildModel([{ name: 'hut', pivot: [0, 0, 0], rotation: [-6, 0, -12], cubes }], { width: 64 });
}

// ---------------------------------------------------------------------------------------------
// back: Flügel (Engel und Drache) – Silhouetten als Pixel-Bitmap auf zwei Ebenen je Flügel
// ---------------------------------------------------------------------------------------------

/** Bitmap eines Flügels in Flügel-Koordinaten (x vom Ansatz nach außen, y nach oben); map(x, y) → Farbe|null */
function bitmap(width, top, bottom, map) {
  const rows = [];
  for (let y = top; y > bottom; y--) {
    const row = [];
    for (let x = 0; x < width; x++) row.push(map(x + 0.5, y - 0.5));
    rows.push(row);
  }
  return { width, top, bottom, rows, at: (x, y) => rows[top - 1 - y]?.[x] ?? null };
}

/** Kanten nachzeichnen: Pixel ohne Nachbarn oben bekommen topEdge(c), ohne Nachbarn unten bottomEdge(c) */
function outline(bm, { bottomEdge, topEdge }) {
  const src = bm.rows.map((r) => [...r]);
  for (let j = 0; j < src.length; j++) {
    for (let i = 0; i < src[j].length; i++) {
      const c = src[j][i];
      if (!c) continue;
      if (!src[j - 1]?.[i] && topEdge) bm.rows[j][i] = topEdge(c);
      else if (!src[j + 1]?.[i] && bottomEdge) bm.rows[j][i] = bottomEdge(c);
    }
  }
  return bm;
}

/** Abstand von p zur Strecke a–b, dazu Lage entlang (0…1) und Seite (Kreuzprodukt) */
function segment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx, cy = ay + t * dy;
  return { dist: Math.hypot(px - cx, py - cy), t, side: dx * (py - ay) - dy * (px - ax) };
}

/** glatte Kurve durch Punkte (stückweise linear interpoliert in x) */
function curve(points) {
  return (x) => {
    if (x <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x0, y0] = points[i - 1];
      if (x <= x1) {
        const t = (x - x0) / (x1 - x0);
        const s = t * t * (3 - 2 * t);
        return y0 + (y1 - y0) * s;
      }
    }
    return points[points.length - 1][1];
  };
}

function angelWingBitmap() {
  const W = palette('#ffffff', '#f3f6fb', '#dbe3ee', '#b2bfd4', '#8c9ab5');
  const gold = palette('#fff8d6', '#ffe8a3', '#f5cf63', '#d9a640');
  // Oberkante (Flügelbug) und Unterkante (Federspitzen) in Flügel-Koordinaten
  const arm = curve([[0, 1.5], [5, 5], [11, 7.6], [16, 8], [21, 6.2], [25, 3.2], [27, 0.5]]);
  const tips = curve([[0, -8], [5, -12.5], [10, -15.5], [15, -16.5], [19.5, -14.5], [23, -10], [25.5, -5], [27, 0]]);
  const top = (ix) => Math.round(arm(ix + 0.5));
  // Schwungfedern: Spalten aus 3 Pixeln (2 Feder + 1 Schatten), abwechselnd etwas länger
  const columnBottom = (c) => Math.round(tips(c * 3 + 1.5)) + (c % 2 ? 1 : 0);
  // Deckfedern: kleine runde Schuppen, 4 breit und 2 hoch, Reihen versetzt
  const SCALES = ['hhhl', 'llbs'];
  const tone = { h: W.hi, l: W.li, b: W.base, s: W.sh };
  return bitmap(27, 9, -18, (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const t = top(ix);
    if (iy >= t) return null;
    const depth = t - 1 - iy; // 0 = oberste Zeile
    const c = Math.floor(ix / 3), k = ix % 3;
    const bottom = columnBottom(c);
    if (iy < bottom || (iy === bottom && k !== 1)) return null;
    if (depth === 0) return gold.li;
    if (depth === 1) return W.hi;
    const coverts = Math.round(3 + 2 * Math.sin(Math.min(1, ix / 20) * Math.PI));
    if (depth <= coverts) {
      const row = Math.floor((depth - 2) / 2);
      return tone[SCALES[(depth - 2) % 2][(ix + row * 2) % 4]];
    }
    const fromTip = iy - bottom;
    if (fromTip === 0) return W.sh;
    if (k === 2) return W.sh;
    if (fromTip === 1 || depth === coverts + 1) return W.base;
    if (k === 0) return c % 2 ? W.li : W.hi;
    return c % 2 ? W.base : W.li;
  });
}

function dragonWingBitmap() {
  const M = palette('#e65a50', '#c8323a', '#9e2030', '#741522', '#4c0c16'); // Flughaut
  const B = palette('#9a88a8', '#6f5e82', '#4e405f', '#352a43', '#221a2c'); // Knochen
  const C = palette('#fffbe8', '#f1e6c4', '#cdb98a', '#9a8558'); // Kralle
  const wrist = [10, 8];
  const tips = [[28, 4], [24.5, -7], [15, -13]];
  const rootLow = [0.5, -10];
  // Bogen a→b, um depth nach innen gewölbt (Polygon läuft im Uhrzeigersinn, innen = rechts der Richtung)
  const sag = (a, b, depth) => (x, y) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const nx = dy / len, ny = -dx / len;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (len * len)));
    const bulge = depth * 4 * t * (1 - t);
    const px = a[0] + t * dx + nx * bulge, py = a[1] + t * dy + ny * bulge;
    return (x - px) * nx + (y - py) * ny >= 0;
  };
  const insidePolygon = (x, y, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const polygon = [[0, 3], wrist, ...tips, rootLow];
  const scallops = [sag(tips[0], tips[1], 3.4), sag(tips[1], tips[2], 3.8), sag(tips[2], rootLow, 3.2)];
  const arm = { a: [0.5, 2.5], b: wrist, r: 1.05 };
  const fingers = tips.map((t) => ({ a: wrist, b: t, r: 0.58 }));
  const bm = bitmap(29, 11, -16, (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    // Daumenkralle über dem Handgelenk
    if ((ix === wrist[0] && iy === wrist[1] + 1) || (ix === wrist[0] + 1 && iy === wrist[1] + 2)) return ix === wrist[0] ? C.li : C.hi;
    const sa = segment(x, y, arm.a[0], arm.a[1], arm.b[0], arm.b[1]);
    if (sa.dist <= arm.r) return sa.side > 0.4 ? B.li : B.base;
    for (const f of fingers) {
      const s = segment(x, y, f.a[0], f.a[1], f.b[0], f.b[1]);
      if (s.dist <= f.r) return s.t > 0.9 ? B.li : B.base;
    }
    if (!insidePolygon(x, y, polygon)) return null;
    for (const inside of scallops) if (!inside(x, y)) return null;
    // Flughaut: am Handgelenk heller, nach außen dunkler, entlang der Finger eine helle Kante
    const near = Math.min(...fingers.map((f) => segment(x, y, f.a[0], f.a[1], f.b[0], f.b[1]).dist), sa.dist);
    const fromWrist = Math.hypot(x - wrist[0], y - wrist[1]);
    if (near < 1.5 && fromWrist < 13) return M.li;
    if (fromWrist < 9) return M.li;
    if (fromWrist < 15) return M.base;
    return M.sh;
  });
  outline(bm, { bottomEdge: (c) => (c === M.li || c === M.base || c === M.sh ? M.dk : c) });
  return bm;
}

/**
 * Flügelpaar aus einer Bitmap: zwei Ebenen je Seite (innen + Spitze), die rechte Seite gespiegelt mit gleicher UV.
 * split = x der Gelenkachse; base = Ansatz (x, y, z) am Rücken.
 */
function wingPair(bm, { split, base, rest, tipRest, flap, tipFlap }) {
  const [bx, by, bz] = base;
  const toColor = (x, y) => bm.at(x, y);
  const sprite = (x0Local) => (f) => {
    const lx = Math.floor(f.p[0] - f.cube.origin[0]) + x0Local;
    const ly = Math.floor(f.p[1] - by);
    return toColor(lx, ly);
  };
  // Zeilenbereich je Ebene: nur so hoch wie nötig
  const rangeY = (xa, xb) => {
    let top = -Infinity, bottom = Infinity;
    for (let x = xa; x < xb; x++) {
      for (let y = bm.bottom; y < bm.top; y++) {
        if (bm.at(x, y)) {
          top = Math.max(top, y + 1);
          bottom = Math.min(bottom, y);
        }
      }
    }
    return [bottom, top];
  };
  const [ib, it] = rangeY(0, split);
  const [ob, ot] = rangeY(split, bm.width);
  const inner = cube([bx, by + ib, bz], [split, it - ib, 0], sprite(0));
  const outer = cube([bx + split, by + ob, bz], [bm.width - split, ot - ob, 0], sprite(split));
  const innerR = cube([-bx - split, by + ib, bz], [split, it - ib, 0], null, { share: inner, mirror: true });
  const outerR = cube([-bx - bm.width, by + ob, bz], [bm.width - split, ot - ob, 0], null, { share: outer, mirror: true });
  const bones = [
    { name: 'fluegel_links', pivot: [bx, by, bz], rotation: rest, cubes: [inner] },
    { name: 'spitze_links', parent: 'fluegel_links', pivot: [bx + split, by, bz], rotation: tipRest, cubes: [outer] },
    { name: 'fluegel_rechts', pivot: [-bx, by, bz], rotation: [rest[0], -rest[1], -rest[2]], cubes: [innerR] },
    { name: 'spitze_rechts', parent: 'fluegel_rechts', pivot: [-bx - split, by, bz], rotation: [tipRest[0], -tipRest[1], -tipRest[2]], cubes: [outerR] },
  ];
  const animations = [
    { bone: 'fluegel_links', type: 'flap', axis: 'y', amplitude: flap.amplitude, speed: flap.speed, phase: 0 },
    { bone: 'fluegel_rechts', type: 'flap', axis: 'y', amplitude: flap.amplitude, speed: flap.speed, phase: 0.5 },
    { bone: 'spitze_links', type: 'flap', axis: 'y', amplitude: tipFlap.amplitude, speed: flap.speed, phase: tipFlap.lag },
    { bone: 'spitze_rechts', type: 'flap', axis: 'y', amplitude: tipFlap.amplitude, speed: flap.speed, phase: 0.5 + tipFlap.lag },
  ];
  return { ...buildModel(bones), animations };
}

// ---------------------------------------------------------------------------------------------
// back: Schwert auf dem Rücken
// ---------------------------------------------------------------------------------------------

function backSword() {
  const steel = palette('#ffffff', '#e3ecf5', '#b4c3d4', '#7c8ca3', '#4f5b6e');
  const rune = palette('#e8fdff', '#8ff3ff', '#3fd8f0', '#1b9fc0');
  const guard = palette('#d4dbe6', '#8d99ad', '#5a6478', '#3a4152', '#252a36');
  const leather = palette('#c48a5a', '#9a6238', '#7a4a28', '#56331b', '#3a2212');
  const z = -3.5;
  // Rinne in der Mitte der Klinge: dunkler Stahl mit leuchtenden Runenzeichen (Muster von oben nach unten)
  const RUNES = 'x.xx..x.x..xx.x.';
  const isRune = (fy) => fy >= 2 && fy <= 13 && RUNES[fy] === 'x';
  const blade = (f) => {
    if (f.face === 'top' || f.face === 'bottom') return steel.base;
    if (f.face === 'front' || f.face === 'back') {
      // drei Spalten: Schneide hell, Rinne, Schneide dunkel
      const col = f.face === 'front' ? f.fx : f.fw - 1 - f.fx;
      if (col === 1) return isRune(f.fy) ? rune.base : steel.sh;
      return col === 0 ? (f.fy % 5 === 2 ? steel.hi : steel.li) : steel.base;
    }
    return f.fy % 6 === 3 ? steel.li : steel.base;
  };
  const bladeGlow = (f) => {
    if (f.face !== 'front' && f.face !== 'back') return null;
    const col = f.face === 'front' ? f.fx : f.fw - 1 - f.fx;
    return col === 1 && isRune(f.fy) ? rune.li : null;
  };
  const strap = (f) => {
    if (f.face === 'top') return leather.li;
    if (f.face === 'bottom') return leather.sh;
    if (f.face === 'back' && f.fx === 2) return GOLD.li;
    return leather.base;
  };
  const tip = (f) => (f.face === 'front' || f.face === 'back' ? (f.fx === 0 ? steel.li : steel.sh) : steel.base);
  const point = () => steel.li;
  const guardPaint = (f) => {
    if (f.face === 'top') return guard.li;
    if (f.face === 'bottom') return guard.sh;
    if (f.face === 'front' || f.face === 'back') {
      if (f.fx === 0 || f.fx === f.fw - 1) return GOLD.base;
      if (f.fx === Math.floor(f.fw / 2)) return rune.li;
      return f.fx < f.fw / 2 ? guard.li : guard.base;
    }
    return GOLD.sh;
  };
  const guardGlow = (f) => ((f.face === 'front' || f.face === 'back') && f.fx === Math.floor(f.fw / 2) ? rune.hi : null);
  const grip = (f) => {
    if (f.face === 'top' || f.face === 'bottom') return leather.sh;
    return (f.fy + (f.face === 'right' || f.face === 'left' ? 1 : 0)) % 2 ? leather.base : leather.li;
  };
  const pommel = (f) => {
    if (f.face === 'top') return GOLD.li;
    if (f.face === 'bottom') return GOLD.sh;
    if ((f.face === 'front' || f.face === 'back') && f.fy === 1) return f.fx === 0 ? SAPPHIRE.li : SAPPHIRE.base;
    return f.fx === 0 ? GOLD.li : GOLD.base;
  };
  const cubes = [
    cube([-1.5, -15, z], [3, 16, 1], blade, { glow: bladeGlow }),
    cube([-1, -17, z], [2, 2, 1], tip),
    cube([-0.5, -18, z], [1, 1, 1], point),
    cube([-3.5, 1, -4.5], [7, 1, 2], guardPaint, { glow: guardGlow }),
    cube([-0.5, 2, z], [1, 4, 1], grip),
    cube([-1, 6, -4], [2, 2, 2], pommel),
    // Halterung: Lederriemen quer über der Klinge
    cube([-2.5, -8, -4.5], [5, 1, 2], strap),
    cube([-2.5, -2, -4.5], [5, 1, 2], strap),
  ];
  return buildModel([{ name: 'schwert', pivot: [0, -6, -3], rotation: [0, 0, 38], cubes }], { width: 64 });
}

// ---------------------------------------------------------------------------------------------
// companion: Mini-Drache
// ---------------------------------------------------------------------------------------------

function miniDragon() {
  const G = palette('#c8f7a8', '#7fe07a', '#3fb35c', '#23804a', '#155a33');
  const belly = palette('#fff6c8', '#fde58a', '#f4c95a', '#d39c34');
  const horn = palette('#fffaf0', '#f1e4c2', '#d2bd8c', '#a08a5c');
  const wing = palette('#b9f5d0', '#7fe0b0', '#3fbf8a', '#23885f', '#145c40');
  const eye = hex('#1b1320');
  const shine = hex('#ffffff');
  const scales = (f) => {
    if (f.face === 'top') return (f.fx + f.fy * 2) % 4 === 0 ? G.li : (f.fx + f.fy * 2) % 4 === 2 ? G.base : G.li;
    if (f.face === 'bottom') return belly.base;
    if (f.fy === f.fh - 1) return G.sh;
    if (f.fy === 0) return G.li;
    return (f.fx + f.fy) % 3 === 0 ? G.sh : G.base;
  };
  const body = (f) => {
    // Bauch vorn/unten hell
    if (f.face === 'bottom') return (f.fy % 2) ? belly.base : belly.li;
    if (f.face === 'front') return f.fy === 0 ? G.li : (f.fy % 2 ? belly.li : belly.base);
    return scales(f);
  };
  const head = (f) => {
    if (f.face === 'front') {
      // Stirn über der Schnauze
      return f.fy === 0 ? G.li : G.base;
    }
    if (f.face === 'left' || f.face === 'right') {
      // Auge seitlich, groß und freundlich (2 × 2 mit Glanzpunkt)
      const fromFront = f.face === 'left' ? f.fx : f.fw - 1 - f.fx;
      if (f.fy >= 1 && f.fy <= 2 && fromFront >= 0 && fromFront <= 1) return fromFront === 0 && f.fy === 1 ? shine : eye;
      if (f.fy === f.fh - 1) return G.sh;
      return f.fy === 0 ? G.li : G.base;
    }
    return scales(f);
  };
  const snout = (f) => {
    if (f.face === 'front') {
      if (f.fy === 0 && (f.fx === 0 || f.fx === f.fw - 1)) return G.dk; // Nasenlöcher
      return f.fy === f.fh - 1 ? belly.base : G.base;
    }
    if (f.face === 'bottom') return belly.base;
    if (f.face === 'top') return G.li;
    return f.fy === f.fh - 1 ? belly.base : G.base;
  };
  const hornPaint = (f) => (f.face === 'top' ? horn.hi : f.fy === 0 ? horn.li : horn.base);
  const spike = (f) => (f.face === 'top' ? belly.li : f.face === 'front' || f.face === 'right' ? belly.base : belly.sh);
  const tail = (f) => (f.face === 'bottom' ? belly.base : f.face === 'top' ? G.li : f.fy === f.fh - 1 ? G.sh : G.base);
  const tailTip = (f) => (f.face === 'top' ? belly.li : f.face === 'bottom' ? belly.sh : belly.base);
  const leg = (f) => (f.face === 'bottom' ? horn.sh : f.fy === f.fh - 1 ? horn.base : G.sh);
  // Flügel als waagerechte Ebene (Oberseite = Unterseite), Fledermaus-Form; Zeilen von hinten nach vorn
  const wingRows = [
    '...s..s.',
    '..sbssbs',
    '.sbbbbbs',
    'sbblbbls',
    'sbllllbs',
    'kkkkkkk.',
  ];
  const wingMap = { s: wing.dk, b: wing.base, l: wing.li, k: G.sh };
  const wingPaint = planeSprite(wingRows, wingMap, 'xz');
  const wingL = cube([2.5, 6, -3.5], [8, 0, 6], wingPaint);
  const wingR = cube([-10.5, 6, -3.5], [8, 0, 6], null, { share: wingL, mirror: true });
  const bones = [
    {
      name: 'koerper', pivot: [0, 4, 0], cubes: [
        cube([-2.5, 2, -3], [5, 4, 6], body),
        cube([-2, 0, 1], [1, 2, 1], leg),
        cube([1, 0, 1], [1, 2, 1], leg),
        cube([-2, 0, -2], [1, 2, 1], leg),
        cube([1, 0, -2], [1, 2, 1], leg),
        cube([-0.5, 6, -2], [1, 1, 1], spike),
        cube([-0.5, 6, 0], [1, 1, 1], spike),
      ],
    },
    {
      name: 'kopf', parent: 'koerper', pivot: [0, 6, 2], cubes: [
        cube([-2.5, 5, 2], [5, 4, 4], head),
        cube([-1.5, 5, 6], [3, 2, 2], snout),
        cube([-2, 9, 2.5], [1, 2, 1], hornPaint),
        cube([1, 9, 2.5], [1, 2, 1], hornPaint),
      ],
    },
    { name: 'fluegel_links', parent: 'koerper', pivot: [2.5, 6, 0], rotation: [0, 0, 22], cubes: [wingL] },
    { name: 'fluegel_rechts', parent: 'koerper', pivot: [-2.5, 6, 0], rotation: [0, 0, -22], cubes: [wingR] },
    {
      name: 'schwanz', parent: 'koerper', pivot: [0, 3.5, -3], rotation: [12, 0, 0], cubes: [
        cube([-1, 2.5, -7], [2, 2, 4], tail),
      ],
    },
    {
      name: 'schwanzspitze', parent: 'schwanz', pivot: [0, 3.5, -7], rotation: [-18, 0, 0], cubes: [
        cube([-0.5, 3, -10], [1, 1, 3], tail),
        cube([-1, 3, -11], [2, 1, 1], tailTip),
      ],
    },
  ];
  const built = buildModel(bones, { width: 64 });
  const animations = [
    { bone: 'koerper', type: 'bob', axis: 'y', amplitude: 1.2, speed: 0.5, phase: 0 },
    { bone: 'fluegel_links', type: 'flap', axis: 'z', amplitude: 32, speed: 1.6, phase: 0 },
    { bone: 'fluegel_rechts', type: 'flap', axis: 'z', amplitude: 32, speed: 1.6, phase: 0.5 },
    { bone: 'schwanz', type: 'sway', axis: 'y', amplitude: 14, speed: 0.5, phase: 0.25 },
    { bone: 'schwanzspitze', type: 'sway', axis: 'y', amplitude: 18, speed: 0.5, phase: 0.1 },
    { bone: 'kopf', type: 'sway', axis: 'x', amplitude: 5, speed: 0.5, phase: 0.6 },
  ];
  return { ...built, animations };
}

// ---------------------------------------------------------------------------------------------
// companion: Glühwürmchen-Geist
// ---------------------------------------------------------------------------------------------

function fireflySpirit() {
  const body = palette('#b9c3ff', '#7d8ef0', '#4f5fc8', '#33408f', '#222a63');
  const lamp = palette('#fbffe0', '#efffa0', '#c9f45a', '#8fcf2a', '#5e9a14');
  const lampGlow = palette('#ffffff', '#f6ffc4', '#dcff7a', '#b5ec3a');
  const wing = palette('#ffffff', '#e8fbff', '#bfeefc', '#8fd3ef');
  const eye = hex('#f2fbff');
  const pupil = hex('#141a3a');
  const head = (f) => {
    if (f.face === 'front') {
      // große Augen
      const left = f.fx === 0 || f.fx === 1, right = f.fx === 3 || f.fx === 4;
      if (f.fy >= 1 && f.fy <= 2 && (left || right)) {
        const inner = (left && f.fx === 1) || (right && f.fx === 3);
        return f.fy === 2 && inner ? pupil : eye;
      }
      if (f.fy === 3 && f.fx === 2) return body.sh; // kleiner Mund
      return f.fy === 0 ? body.li : body.base;
    }
    if (f.face === 'top') return (f.fx + f.fy) % 3 === 0 ? body.hi : body.li;
    if (f.face === 'bottom') return body.sh;
    return f.fy === 0 ? body.li : f.fy === f.fh - 1 ? body.sh : body.base;
  };
  const headGlow = (f) => (f.face === 'front' && f.fy >= 1 && f.fy <= 2 && (f.fx <= 1 || f.fx >= 3) && !(f.fy === 2 && (f.fx === 1 || f.fx === 3)) ? eye : null);
  const thorax = (f) => (f.face === 'top' ? body.li : f.face === 'bottom' ? body.dk : f.fy === 0 ? body.base : body.sh);
  const lantern = (f) => {
    if (f.face === 'bottom') return lamp.base;
    if (f.face === 'top') return (f.fx + f.fy) % 2 ? lamp.li : lamp.base;
    // Ringe wie beim Glühwürmchen
    if (f.fy === 0) return body.sh;
    return f.fy % 2 ? lamp.li : lamp.base;
  };
  const lanternGlow = (f) => {
    if (f.face === 'top' || f.face === 'bottom') return lampGlow.li;
    if (f.fy === 0) return null;
    return f.fy % 2 ? lampGlow.hi : lampGlow.li;
  };
  const stalk = () => body.sh;
  const knob = (f) => (f.face === 'top' ? lamp.hi : lamp.li);
  const knobGlow = () => lampGlow.hi;
  // Flügel: zarte, helle Ebene mit Adern (waagerecht), Zeilen von hinten nach vorn
  const wingRows = [
    '.bbbb.',
    'blllb.',
    'blhllb',
    '.bllhb',
    '..bbb.',
  ];
  const wingPaint = planeSprite(wingRows, { b: wing.sh, l: wing.li, h: wing.hi }, 'xz');
  const wingL = cube([1.5, 6, -3], [6, 0, 5], wingPaint);
  const wingR = cube([-7.5, 6, -3], [6, 0, 5], null, { share: wingL, mirror: true });
  const bones = [
    {
      name: 'koerper', pivot: [0, 4, 0], cubes: [
        cube([-2.5, 2, 0], [5, 5, 4], head, { glow: headGlow }),
        cube([-1.5, 2.5, -2], [3, 3, 2], thorax),
        cube([-2, 1, -6], [4, 4, 4], lantern, { glow: lanternGlow }),
        cube([-2, 7, 2], [1, 2, 1], stalk),
        cube([1, 7, 2], [1, 2, 1], stalk),
        cube([-3, 9, 2], [1, 1, 1], knob, { glow: knobGlow }),
        cube([2, 9, 2], [1, 1, 1], knob, { glow: knobGlow }),
      ],
    },
    { name: 'fluegel_links', parent: 'koerper', pivot: [1.5, 6, -1], rotation: [0, 0, 30], cubes: [wingL] },
    { name: 'fluegel_rechts', parent: 'koerper', pivot: [-1.5, 6, -1], rotation: [0, 0, -30], cubes: [wingR] },
  ];
  const built = buildModel(bones, { width: 64 });
  const animations = [
    { bone: 'koerper', type: 'bob', axis: 'y', amplitude: 1.5, speed: 0.35, phase: 0 },
    { bone: 'koerper', type: 'sway', axis: 'z', amplitude: 6, speed: 0.35, phase: 0.25 },
    { bone: 'fluegel_links', type: 'flap', axis: 'z', amplitude: 28, speed: 3, phase: 0 },
    { bone: 'fluegel_rechts', type: 'flap', axis: 'z', amplitude: 28, speed: 3, phase: 0.5 },
  ];
  return { ...built, animations };
}

// ---------------------------------------------------------------------------------------------
// aura: Partikel-Streifen (8 × 8 je Bild)
// ---------------------------------------------------------------------------------------------

function sprites(frames, map) {
  const img = new Img(frames.length * 8, 8);
  frames.forEach((rows, i) => {
    rows.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (ch !== '.') img.set(i * 8 + x, y, map[ch]);
      });
    });
  });
  return img;
}

const SPARK_FRAMES = [
  ['........', '........', '........', '...+....', '..+#+...', '...+....', '........', '........'],
  ['...-....', '.-.+.-..', '...#....', '-+###+-.', '...#....', '.-.+.-..', '...-....', '........'],
  ['........', '...-....', '...+....', '.-+#+-..', '...+....', '...-....', '........', '........'],
  ['........', '........', '........', '...-....', '..-+-...', '...-....', '........', '........'],
];
const HEART_FRAMES = [
  ['........', '........', '..d.d...', '.dhdbd..', '.dbbbd..', '..dbd...', '...d....', '........'],
  ['.dd.dd..', 'dlhdbbd.', 'dhlbbbd.', 'dlbbbsd.', '.dbbsd..', '..dsd...', '...d....', '........'],
  ['.dd.dd..', 'dhhdlbd.', 'dhlbbbd.', 'dlbbbsd.', '.dbbsd..', '..dsd...', '...d....', '........'],
  ['........', '........', '..d.d...', '.dldsd..', '.dbbsd..', '..dsd...', '...d....', '........'],
];
/**
 * Blatt, das beim Fallen taumelt: Drehwinkel und sichtbare Breite je Bild (schmal = von der Kante gesehen).
 * Zeichen: d Rand, h/l helle Hälfte, b/s dunkle Hälfte, v Mittelader, k Stiel
 */
function leafFrame(angle, width) {
  const rows = [];
  const a = (angle * Math.PI) / 180;
  const L = 3.3;
  const shape = (x, y) => {
    const dx = x - 3.5, dy = y - 3.5;
    const u = dx * Math.cos(a) + dy * Math.sin(a); // entlang (Spitze bei +L)
    const v = -dx * Math.sin(a) + dy * Math.cos(a); // quer
    if (Math.abs(u) > L) return { inside: false, u, v };
    const half = width * Math.sqrt(1 - (u / L) ** 2) * (u > 0 ? 1 - 0.35 * (u / L) : 1);
    return { inside: Math.abs(v) <= half, u, v, half };
  };
  for (let y = 0; y < 8; y++) {
    let row = '';
    for (let x = 0; x < 8; x++) {
      const c = shape(x + 0.5, y + 0.5);
      if (!c.inside) {
        // Stiel hinter dem Blattgrund
        const su = (x + 0.5 - 3.5) * Math.cos(a) + (y + 0.5 - 3.5) * Math.sin(a);
        const sv = -(x + 0.5 - 3.5) * Math.sin(a) + (y + 0.5 - 3.5) * Math.cos(a);
        row += su < -L + 0.2 && su > -L - 1.3 && Math.abs(sv) < 0.5 ? 'k' : '.';
        continue;
      }
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => !shape(x + 0.5 + ox, y + 0.5 + oy).inside);
      if (edge) row += 'd';
      else if (Math.abs(c.v) < 0.45 && width > 1) row += 'v';
      else if (c.v < 0) row += c.u > 0.5 && c.v > -c.half * 0.6 ? 'h' : 'l';
      else row += c.v > c.half * 0.55 ? 's' : 'b';
    }
    rows.push(row);
  }
  return rows;
}
const LEAF_FRAMES = [leafFrame(-45, 2.1), leafFrame(-100, 1.6), leafFrame(-160, 2.1), leafFrame(-215, 1.1)];

// ---------------------------------------------------------------------------------------------
// cape: Minecraft-Vorlage 64 × 32 in k-facher Auflösung (k = 1, 2 oder 4 → 64, 128 oder 256 breit), 24 Bilder
// untereinander – gleiche Aufteilung wie die eingebauten Capes. Die Motive rechnen in Texeln der Vorlage
// (x, y mit Nachkommastellen), damit sie in jeder Auflösung gleich aussehen.
// ---------------------------------------------------------------------------------------------

const CAPE_FRAMES = 24;

/** geordnetes Dithering (4 × 4) für weiche Verläufe mit wenigen Farben */
const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]].map((r) => r.map((v) => (v + 0.5) / 16));
function ramp(colors, value, ix, iy) {
  const pos = Math.max(0, Math.min(colors.length - 1, value * (colors.length - 1)));
  const lo = Math.floor(pos);
  return colors[Math.min(colors.length - 1, lo + (pos - lo > BAYER4[iy & 3][ix & 3] ? 1 : 0))];
}

/**
 * Zeichnet ein Cape-Bild in k-facher Auflösung. design.outer(ctx) / design.glow(ctx) / design.lining(ctx) bekommen
 * ctx = { x, y (Texel, Pixelmitte), ix, iy (Pixel), w, h (Texel), k, t (0…1), frame, elytra }.
 */
function capeFrame(img, glowImg, frame, design, k) {
  const t = frame / CAPE_FRAMES;
  const oy = frame * 32 * k;
  const rect = (x0, y0, w, h, color) => {
    for (let y = 0; y < h * k; y++) for (let x = 0; x < w * k; x++) img.set(x0 * k + x, oy + y0 * k + y, color);
  };
  const face = (x0, y0, w, h, elytra, paint, glow) => {
    for (let iy = 0; iy < h * k; iy++) {
      for (let ix = 0; ix < w * k; ix++) {
        const ctx = { x: (ix + 0.5) / k, y: (iy + 0.5) / k, ix, iy, w, h, k, t, frame, elytra };
        let color = paint(ctx);
        // Zierkante wie bei den eingebauten Capes (ab 2-facher Auflösung): oben/links hell, unten/rechts dunkler
        if (design.trim && k >= 2 && paint === design.outer) {
          const edge = Math.min(ix, iy, w * k - 1 - ix, h * k - 1 - iy);
          if (edge === 0) color = ix === 0 || iy === 0 ? design.trim.li : design.trim.sh;
        }
        img.set(x0 * k + ix, oy + y0 * k + iy, color);
        if (glow) glowImg.set(x0 * k + ix, oy + y0 * k + iy, glow(ctx));
      }
    }
  };
  // Cape: Ränder, Außenseite, Innenseite
  rect(1, 0, 10, 1, design.top);
  rect(11, 0, 10, 1, design.bottom);
  rect(0, 1, 1, 16, design.edge);
  rect(11, 1, 1, 16, design.edge);
  face(1, 1, 10, 16, false, design.outer, design.glow);
  face(12, 1, 10, 16, false, design.lining, null);
  // Elytra: Ränder und beide Flächen
  rect(24, 0, 10, 2, design.top);
  rect(34, 0, 10, 2, design.bottom);
  rect(22, 2, 2, 20, design.edge);
  rect(34, 2, 2, 20, design.edge);
  face(24, 2, 10, 20, true, design.outer, design.glow);
  face(36, 2, 10, 20, true, design.outer, design.glow);
}

function ocean() {
  const water = ['#c4f3ff', '#86e0fb', '#4cc6f5', '#22a8e6', '#0d8bd0', '#0a6fae', '#0b5689', '#0c4168', '#0b2f4f'].map(hex);
  const sky = [hex('#e9fbff'), hex('#c9f1ff')];
  const foam = [hex('#ffffff'), hex('#dff8ff')];
  const sand = ['#f7df92', '#e9c66e', '#cfa452', '#a8803a'].map(hex);
  const shell = hex('#ff9fb4');
  const weed = ['#8af5ae', '#45d37e', '#24a85d', '#14703f'].map(hex);
  const clown = { body: hex('#ff8a2e'), dark: hex('#d4541a'), band: hex('#ffffff'), eye: hex('#1a1424') };
  const tang = { body: hex('#ffd83d'), dark: hex('#d9a51c'), band: hex('#fff3a6'), eye: hex('#1a1424') };
  const bubble = { rim: hex('#e9fbff'), inner: hex('#9fe6fb'), shine: hex('#ffffff') };
  const BUBBLES = [
    { x: 2.2, offset: 0, r: 0.55 }, { x: 7.4, offset: 9, r: 0.85 }, { x: 4.6, offset: 15, r: 0.45 }, { x: 8.6, offset: 4, r: 0.5 }, { x: 5.6, offset: 20, r: 0.65 },
  ];
  /** Fisch mit Länge len (Texel), Kopf in Richtung dir (+1 rechts, -1 links) */
  const fish = (x, y, cx, cy, len, dir, c, banded) => {
    const u = ((x - cx) / (len / 2)) * dir; // -1 Schwanzansatz … +1 Kopf
    const v = (y - cy) / (len * 0.3);
    const body = u * u + v * v <= 1;
    const tail = u < -0.75 && u > -1.55 && Math.abs(v) <= (-0.75 - u) * 1.35;
    if (!body && !tail) return null;
    if (tail) return Math.abs(v) > (-0.75 - u) * 1.35 - 0.35 ? c.dark : c.body;
    if (Math.hypot((u - 0.5) * 1.1, v + 0.22) < 0.2) return c.eye;
    if (u * u + v * v > 0.72) return c.dark;
    if (banded && (Math.abs(u - 0.18) < 0.13 || Math.abs(u + 0.48) < 0.11)) return c.band;
    if (!banded && v > 0.35) return c.band;
    return c.body;
  };
  const outer = ({ x, y, ix, iy, w, h, t, frame }) => {
    // Oberfläche: Wellenlinie wandert nach rechts (zwei Wellen, nahtlos über die Schleife)
    const surface = 1.15 + 0.4 * Math.sin(TAU * (x / 5 - 2 * t)) + 0.18 * Math.sin(TAU * (x / 2.5 + 3 * t));
    if (y < surface - 0.45) return ramp(sky, y / surface, ix, iy);
    if (y < surface) return foam[0];
    if (y < surface + 0.3) return foam[1];
    // Sandboden mit Muschel
    const ground = h - 1.25 + 0.25 * Math.sin(x * 1.9 + 1);
    if (y > ground) {
      if (Math.hypot(x - 6.3, y - (h - 0.55)) < 0.32) return shell;
      return ramp(sand, Math.min(1, (y - ground) / 1.3), ix, iy);
    }
    // Seegras (wiegt sich, oben stärker)
    for (const [base, height, phase] of [[1.3, 4.6, 0], [8.4, 5.6, 0.4], [9.2, 3.2, 0.7]]) {
      const level = h - 1 - y; // Höhe über dem Boden
      if (level < 0 || level > height) continue;
      const cx = base + 0.55 * Math.sin(TAU * (t + phase) + level * 0.7) * (level / height);
      const d = Math.abs(x - cx);
      if (d < 0.36) return d < 0.14 ? weed[1] : level > height - 0.6 ? weed[0] : weed[2];
      // kleine Blätter, abwechselnd links und rechts
      const n = Math.round(level / 1.3);
      if (n > 0 && Math.abs(level - n * 1.3) < 0.25 && (n % 2 ? x > cx && x - cx < 0.85 : x < cx && cx - x < 0.85)) return n % 2 ? weed[2] : weed[3];
    }
    // Fische: Clownfisch nach rechts, Doktorfisch nach links (je eine Runde pro Schleife)
    const span = w + 5;
    const f1 = fish(x, y, -2.5 + span * t, h * 0.52 + 0.4 * Math.sin(TAU * t * 2), 2.6, 1, clown, true);
    if (f1) return f1;
    const f2 = fish(x, y, w + 2.5 - span * ((t + 0.5) % 1), h * 0.3 + 0.3 * Math.sin(TAU * t * 2 + 1), 2.2, -1, tang, false);
    if (f2) return f2;
    // Luftblasen steigen auf
    for (const b of BUBBLES) {
      const by = h + 1 - ((frame + b.offset) % CAPE_FRAMES) * ((h + 2) / CAPE_FRAMES);
      const bx = b.x + 0.25 * Math.sin(TAU * (t * 2 + b.offset / 7));
      const d = Math.hypot(x - bx, y - by);
      if (d <= b.r) {
        if (Math.hypot(x - (bx - b.r * 0.35), y - (by - b.r * 0.35)) < b.r * 0.28) return bubble.shine;
        return d > b.r - 0.28 ? bubble.rim : bubble.inner;
      }
    }
    // Wasser: Tiefenverlauf mit schrägen, wandernden Lichtstrahlen
    const depth = (y - surface) / (ground - surface);
    let value = 0.12 + depth * 0.88;
    const ray = (((x * 0.45 + y * 0.2 - t * 2) % 3.4) + 3.4) % 3.4;
    if (ray < 0.9 && depth < 0.8) value -= 0.13 * (1 - depth) * Math.sin((ray / 0.9) * Math.PI);
    return ramp(water, value, ix, iy);
  };
  const lining = ({ x, y, ix, iy, h }) => {
    const wave = Math.sin(x * 1.3 + y * 0.9) * 0.5 + 0.5;
    return ramp([hex('#0b2f4f'), hex('#0c3a60'), hex('#0e4a75')], 0.15 + 0.5 * wave * (1 - y / h), ix, iy);
  };
  return { outer, lining, edge: hex('#0b3557'), top: hex('#86e0fb'), bottom: sand[1], trim: palette('#ffffff', '#c4f3ff', '#4cc6f5', '#0a6fae') };
}

function pixelRain(k) {
  const P = [
    palette('#f2feff', '#8af3ff', '#22d3ee', '#0e7490', '#103c56'),
    palette('#f2f7ff', '#a6ccff', '#3b82f6', '#1d4ed8', '#18265a'),
    palette('#f8f4ff', '#d0c2ff', '#8b5cf6', '#6028d0', '#2a1652'),
    palette('#fff2f9', '#ffb0dc', '#ec4899', '#b0186a', '#3e0d2c'),
  ];
  const cellBg = [hex('#141a3c'), hex('#111632')];
  const line = hex('#0a0d1f');
  const rnd = random(1709);
  // LED-Raster: Zellen von 1 Texel; in jeder Spalte fallen zwei „Pixel“ mit Spur. Geschwindigkeit in Pixeln je Bild
  // (ganzzahlig) → nahtlose Schleife über 24 Bilder.
  const cell = k; // Pixel je Zelle
  const lamp = Math.max(1, k - 1); // leuchtender Teil der Zelle, der Rest ist Fuge
  const columns = [];
  for (let c = 0; c < 10; c++) {
    const drops = [];
    for (let j = 0; j < 2; j++) {
      const speed = [1, 1, 2][Math.floor(rnd() * 3)] * Math.max(1, k / 2);
      drops.push({ speed, offset: Math.floor(rnd() * 24 * k) + j * 12 * k, color: P[Math.floor(rnd() * P.length)], trail: 3 + Math.floor(rnd() * 3) });
    }
    columns.push(drops);
  }
  /** Stufe der Spur (0 = Kopf) an Pixelzeile py in Spalte c, { gap } in einer Fuge, sonst null */
  const hit = (c, py, frame, heightPx) => {
    for (const d of columns[c] ?? []) {
      const loop = 24 * d.speed * Math.max(1, Math.ceil((heightPx + (d.trail + 2) * cell) / (24 * d.speed)));
      const head = ((d.offset + frame * d.speed) % loop) - (d.trail + 1) * cell;
      const dist = head - py; // Pixel oberhalb des Kopfes
      if (dist < 0 || dist >= (d.trail + 1) * cell) continue;
      if (k > 1 && dist % cell >= lamp) return { gap: true };
      return { d, step: Math.floor(dist / cell) };
    }
    return null;
  };
  const outer = ({ ix, iy, h, frame }) => {
    const c = Math.floor(ix / cell);
    if (k > 1 && ix % cell >= lamp) return line;
    const r = hit(c, iy, frame, h * k);
    if (r && !r.gap) {
      const tones = [r.d.color.hi, r.d.color.li, r.d.color.base, r.d.color.sh, r.d.color.dk];
      return tones[Math.min(tones.length - 1, Math.round((r.step * 4) / r.d.trail))];
    }
    if (r?.gap || (k > 1 && iy % cell >= lamp)) return line;
    return (Math.floor(iy / cell) + c) % 2 ? cellBg[0] : cellBg[1];
  };
  const glow = ({ ix, iy, h, frame }) => {
    if (k > 1 && ix % cell >= lamp) return null;
    const r = hit(Math.floor(ix / cell), iy, frame, h * k);
    if (!r || r.gap || r.step > 1) return null;
    return r.step === 0 ? r.d.color.hi : r.d.color.li;
  };
  const lining = ({ ix, iy }) => ((Math.floor(ix / cell) * 7 + Math.floor(iy / cell) * 3) % 11 === 0 ? hex('#1a2150') : hex('#0c1022'));
  return { outer, glow, lining, edge: hex('#1e2a5a'), top: hex('#2a3a7a'), bottom: hex('#1e2a5a'), trim: palette('#ffffff', '#a6ccff', '#3b82f6', '#2a3a7a') };
}

/**
 * Freundesband (Belohnung für Einladungen): zwei Bänder in Heldix-Türkis und Gold winden sich als Doppelspirale über
 * einen Nachthimmel; das vordere Band ist breiter und heller, die Windung wandert in 24 Bildern einmal nach unten.
 */
function friendshipBand() {
  const night = ['#1a1f4a', '#161a40', '#121536', '#0e102b', '#0a0b20'].map(hex);
  const ribbonA = ['#e0fbff', '#9ff3ff', '#67e8f9', '#22b8e0', '#1d6fd8', '#173f8f'].map(hex); // Türkis
  const ribbonB = ['#fff6c4', '#ffe58a', '#ffd75a', '#f0ae27', '#c27616', '#7a470c'].map(hex); // Gold
  const star = [hex('#ffffff'), hex('#c9d6ff'), hex('#8090d0')];
  const STARS = [[1.6, 2.2, 0], [8.3, 1.4, 5], [5.2, 4.1, 11], [2.4, 8.6, 17], [8.8, 7.4, 3], [1.5, 13.4, 9], [8.1, 12.6, 20], [5.6, 15.2, 14]];
  /** Mittellinie (Texel) und Tiefe (-1 hinten … 1 vorne) beider Bänder an Höhe y */
  const strands = (y, w, h, t) => {
    const phase = TAU * (y / h * 1.25 - t);
    const swing = w * 0.27;
    return [
      { x: w / 2 + swing * Math.sin(phase), depth: Math.cos(phase), tones: ribbonA },
      { x: w / 2 - swing * Math.sin(phase), depth: -Math.cos(phase), tones: ribbonB },
    ];
  };
  /** Band an (x, y): Ton und ob es leuchtet, sonst null; das vordere Band deckt das hintere */
  const ribbonAt = (x, y, w, h, t, ix, iy) => {
    const pair = strands(y, w, h, t).sort((a, b) => b.depth - a.depth);
    for (const s of pair) {
      const half = 0.95 + 0.45 * (s.depth + 1) / 2; // vorne breiter
      const d = Math.abs(x - s.x);
      if (d > half) continue;
      const across = d / half; // 0 Mitte … 1 Rand
      const light = 0.55 - 0.45 * s.depth; // vorne heller (kleiner Index)
      if (across > 0.78) return { color: s.tones[Math.min(5, Math.round(3 + 2 * light))], glow: false };
      const value = Math.min(1, Math.max(0, light * 0.8 + across * 0.35));
      // feine Querstreifen wie gewebt, wandern mit
      const weave = (((y * 2.2 - t * 6) % 1) + 1) % 1 < 0.18 && s.depth > -0.2;
      return { color: weave ? s.tones[Math.max(0, Math.round(value * 4) - 1)] : ramp(s.tones.slice(0, 5), value, ix, iy), glow: s.depth > 0.25 && across < 0.5 };
    }
    return null;
  };
  const outer = ({ x, y, ix, iy, w, h, t, frame }) => {
    const r = ribbonAt(x, y, w, h, t, ix, iy);
    if (r) return r.color;
    for (const [sx, sy, offset] of STARS) {
      const tw = (frame + offset) % 12; // funkelt zweimal je Schleife
      const d = Math.hypot(x - sx * (w / 10), y - sy * (h / 16));
      if (d < 0.32) return tw < 3 ? star[0] : tw < 7 ? star[1] : star[2];
      if (tw < 2 && d < 0.75 && (Math.abs(x - sx * (w / 10)) < 0.2 || Math.abs(y - sy * (h / 16)) < 0.2)) return star[1];
    }
    return ramp(night, 0.25 + 0.6 * (y / h) + 0.1 * Math.sin(x * 0.9 + y * 0.4), ix, iy);
  };
  const glow = ({ x, y, ix, iy, w, h, t }) => {
    const r = ribbonAt(x, y, w, h, t, ix, iy);
    return r?.glow ? r.color : null;
  };
  const lining = ({ x, y, ix, iy, h }) => ramp([hex('#141836'), hex('#10132c'), hex('#0c0e22')], 0.3 + 0.4 * (y / h) + 0.15 * Math.sin(x + y * 0.7), ix, iy);
  return { outer, glow, lining, edge: hex('#141836'), top: hex('#67e8f9'), bottom: hex('#ffd75a'), trim: palette('#fff6c4', '#ffe58a', '#f0ae27', '#c27616') };
}

/** Freundesfunken: ein türkiser und ein goldener Funke kreisen umeinander (8 × 8 je Bild, 4 Bilder) */
function friendSparkFrames() {
  const frames = [];
  for (let f = 0; f < 4; f++) {
    const grid = Array.from({ length: 8 }, () => Array(8).fill('.'));
    const a = (f / 4) * TAU + Math.PI / 4;
    const put = (x, y, ch) => {
      if (x >= 0 && x < 8 && y >= 0 && y < 8 && (grid[y][x] === '.' || ch === ch.toUpperCase())) grid[y][x] = ch;
    };
    for (const [ang, lo, hi] of [[a, 't', 'T'], [a + Math.PI, 'g', 'G']]) {
      const cx = Math.round(3.5 + 2 * Math.cos(ang));
      const cy = Math.round(3.5 + 2 * Math.sin(ang));
      put(cx, cy, hi);
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(cx + ox, cy + oy, lo);
    }
    frames.push(grid.map((row) => row.join('')));
  }
  return frames;
}

function cape(design, k) {
  const img = new Img(64 * k, 32 * k * CAPE_FRAMES);
  const glow = new Img(64 * k, 32 * k * CAPE_FRAMES);
  for (let f = 0; f < CAPE_FRAMES; f++) capeFrame(img, glow, f, design, k);
  return { texture: img, glow: glow.empty() ? null : glow };
}

/** größte Auflösung (256, 128 oder 64 breit), bei der Textur und Leuchtebene je höchstens 60 KB groß sind */
function bestCape(make) {
  for (const k of [4, 2, 1]) {
    const built = cape(make(k), k);
    const sizes = [png(built.texture).length, built.glow ? png(built.glow).length : 0];
    if (sizes.every((s) => s <= 60 * 1024)) return built;
    console.log(`  ${64 * k} breit zu groß (${sizes.map((s) => (s / 1024).toFixed(1)).join(' + ')} KB), nächste Stufe`);
  }
  throw new Error('Cape passt in keiner Auflösung in 64 KB');
}

// ---------------------------------------------------------------------------------------------
// Startsatz
// ---------------------------------------------------------------------------------------------

const COSMETICS = [
  {
    id: 'krone', slot: 'head', name: 'Krone', description: 'Goldene Krone mit Rubin, Saphiren und Samtkappe',
    build: () => crown({ metal: GOLD, gems: { center: RUBY, side: SAPPHIRE, back: EMERALD }, cap: VELVET }),
  },
  {
    id: 'zylinder', slot: 'head', name: 'Zylinder', description: 'Eleganter schwarzer Zylinder mit rotem Band',
    build: topHat,
  },
  {
    id: 'heiligenschein', slot: 'head', name: 'Heiligenschein', description: 'Leuchtender Ring, der über deinem Kopf schwebt und sich dreht',
    build: () => ({
      ...halo(),
      animations: [
        { bone: 'schein', type: 'spin', axis: 'y', speed: 0.25 },
        { bone: 'schein', type: 'bob', axis: 'y', amplitude: 0.8, speed: 0.5 },
      ],
    }),
  },
  {
    id: 'partyhut', slot: 'head', name: 'Partyhut', description: 'Bunter Partyhut mit Bommel – schief aufgesetzt',
    build: partyHat,
  },
  {
    id: 'team-krone', slot: 'head', name: 'Team-Krone', description: 'Platinkrone mit leuchtenden Heldix-Steinen – nur für das HeldixClient-Team', access: 'team',
    build: () => crown({ metal: PLATINUM, gems: { center: HELDIX, side: SAPPHIRE, back: HELDIX }, cap: palette('#7fa8ff', '#3f6fe0', '#2a4fb8', '#1c3585', '#11225a'), glowGems: true, tall: true }),
  },
  {
    id: 'engelsfluegel', slot: 'back', name: 'Engelsflügel', description: 'Weiße Federflügel mit goldenem Saum, die sanft schlagen',
    build: () => wingPair(angelWingBitmap(), { split: 11, base: [1, -3, -2.5], rest: [0, 14, 8], tipRest: [0, 10, 0], flap: { amplitude: 14, speed: 0.6 }, tipFlap: { amplitude: 10, lag: 0.08 } }),
  },
  {
    id: 'drachenfluegel', slot: 'back', name: 'Drachenflügel', description: 'Ledrige Drachenschwingen mit Krallen – kräftiger Flügelschlag',
    build: () => wingPair(dragonWingBitmap(), { split: 10, base: [1, -3, -2.5], rest: [0, 16, 6], tipRest: [0, 14, 0], flap: { amplitude: 20, speed: 0.8 }, tipFlap: { amplitude: 16, lag: 0.1 } }),
  },
  {
    id: 'schwert-ruecken', slot: 'back', name: 'Schwert auf dem Rücken', description: 'Eine Klinge mit leuchtender Rune, quer über den Rücken geschnallt',
    build: backSword,
  },
  {
    id: 'funken', slot: 'aura', name: 'Funken', description: 'Goldene Funken, die um dich herum aufblitzen',
    build: () => ({
      texture: sprites(SPARK_FRAMES, { '#': hex('#ffffff'), '+': hex('#d6d6d6'), '-': hex('#8f8f8f') }),
      particles: { frames: 4, rate: 8, lifetime: 18, size: 0.18, motion: 'spark', radius: 0.6, color: '#ffd166', fullbright: true },
    }),
  },
  {
    id: 'herzen', slot: 'aura', name: 'Herzen', description: 'Kleine Herzen steigen um dich herum auf',
    build: () => ({
      texture: sprites(HEART_FRAMES, { h: hex('#ffe0e6'), l: hex('#ff7a8c'), b: hex('#e8344e'), s: hex('#a8162f'), d: hex('#5e0c1c') }),
      particles: { frames: 4, rate: 2, lifetime: 40, size: 0.18, motion: 'rise', radius: 0.7, color: '#ffffff' },
    }),
  },
  {
    id: 'blaetter', slot: 'aura', name: 'Blätter', description: 'Grüne Blätter rieseln sanft um dich herab',
    build: () => ({
      texture: sprites(LEAF_FRAMES, { h: hex('#cdf58e'), l: hex('#94d85a'), b: hex('#62b240'), s: hex('#4a9032'), d: hex('#2f6a22'), v: hex('#b4e478'), k: hex('#7a5230') }),
      particles: { frames: 4, rate: 3, lifetime: 60, size: 0.2, motion: 'fall', radius: 0.8, color: '#ffffff' },
    }),
  },
  {
    id: 'mini-drache', slot: 'companion', name: 'Mini-Drache', description: 'Ein kleiner grüner Drache, der neben dir schwebt',
    build: () => ({ ...miniDragon(), companion: { offset: [0.8, 1.45, -0.3], scale: 1 } }),
  },
  {
    id: 'gluehwuermchen-geist', slot: 'companion', name: 'Glühwürmchen-Geist', description: 'Ein leuchtender Geist mit Laterne, der dich begleitet',
    build: () => ({ ...fireflySpirit(), companion: { offset: [-0.75, 1.7, -0.2], scale: 0.9 } }),
  },
  {
    id: 'ozean', slot: 'cape', name: 'Ozean', description: 'Wellen, Fische, Luftblasen und wogendes Seegras',
    build: () => ({ ...bestCape(() => ocean()), cape: { frames: CAPE_FRAMES, fps: 10 } }),
  },
  {
    id: 'pixelregen', slot: 'cape', name: 'Pixelregen', description: 'Leuchtender Regen aus bunten Pixeln auf dunklem Grund',
    build: () => ({ ...bestCape((k) => pixelRain(k)), cape: { frames: CAPE_FRAMES, fps: 12 } }),
  },
  // Belohnungen für Einladungen (access: unlock – der Dienst schaltet sie frei, siehe docs/dienst.md)
  {
    id: 'freundesfunken', slot: 'aura', name: 'Freundesfunken', access: 'unlock',
    description: 'Ein türkiser und ein goldener Funke kreisen um dich – Belohnung für Einladungen',
    build: () => ({
      texture: sprites(friendSparkFrames(), { T: hex('#e0fbff'), t: hex('#67e8f9'), G: hex('#fff6c4'), g: hex('#ffd75a') }),
      particles: { frames: 4, rate: 5, lifetime: 30, size: 0.2, motion: 'orbit', radius: 0.75, color: '#ffffff', fullbright: true },
    }),
  },
  {
    id: 'freundesband', slot: 'cape', name: 'Freundesband', access: 'unlock',
    description: 'Zwei Bänder in Türkis und Gold winden sich über den Nachthimmel – ab drei eingeladenen Freunden',
    build: () => ({ ...bestCape(() => friendshipBand()), cape: { frames: CAPE_FRAMES, fps: 12 } }),
  },
];

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
await mkdir(OUT, { recursive: true });
for (const item of COSMETICS) {
  if (only.length && !only.includes(item.id)) continue;
  const built = item.build();
  const manifest = {
    format: 1,
    id: item.id,
    version: 1,
    slot: item.slot,
    name: item.name,
    description: item.description,
    access: item.access ?? 'all',
  };
  if (built.model) manifest.model = built.model;
  if (built.animations?.length) manifest.animations = built.animations;
  if (built.particles) manifest.particles = built.particles;
  if (built.cape) manifest.cape = built.cape;
  if (built.companion) manifest.companion = built.companion;
  const dir = path.join(OUT, item.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'cosmetic.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const texture = png(built.texture);
  await writeFile(path.join(dir, 'texture.png'), texture);
  let glowInfo = '';
  if (built.glow) {
    const glow = png(built.glow);
    await writeFile(path.join(dir, 'glow.png'), glow);
    glowInfo = ` + Leuchten ${(glow.length / 1024).toFixed(1)} KB`;
  }
  const cubes = built.model ? built.model.bones.reduce((n, b) => n + b.cubes.length, 0) : 0;
  console.log(`${item.id.padEnd(22)} ${item.slot.padEnd(9)} ${built.texture.width}×${built.texture.height} ${(texture.length / 1024).toFixed(1)} KB${glowInfo}${cubes ? ` · ${cubes} Würfel` : ''}`);
}
console.log(`Quellen geschrieben: ${OUT}`);
