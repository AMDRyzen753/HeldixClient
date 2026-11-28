// Dauerhafte Welten (1.13.0): Symbol einer Welt für die Serverliste und Entdecken (64×64 PNG) mit einer kleinen
// Heldix-Plakette unten rechts – Werbung wie die Beschreibung „Geteilt mit HeldixClient“. Aus dem icon.png der
// hochgeladenen Einzelspielerwelt; ohne (oder nicht lesbar) ein schlichtes Standard-Symbol.
import { decodePng, encodePng } from '../heads';

const SIZE = 64;
/** „H“ der Plakette, 7×7 Pixel */
const GLYPH = ['X...X', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'];

type Image = NonNullable<ReturnType<typeof decodePng>>;

function blank(r: number, g: number, b: number): Image {
  const data = Buffer.alloc(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    // leichter Verlauf von oben nach unten
    const y = Math.floor(i / SIZE);
    const shade = 1 - y / (SIZE * 3);
    data[i * 4] = Math.round(r * shade);
    data[i * 4 + 1] = Math.round(g * shade);
    data[i * 4 + 2] = Math.round(b * shade);
    data[i * 4 + 3] = 255;
  }
  return { width: SIZE, height: SIZE, data };
}

/** Auf 64×64 bringen (nächster Nachbar); andere Größen kommen bei Einzelspielerwelten kaum vor. */
function fit(image: Image): Image {
  if (image.width === SIZE && image.height === SIZE) return image;
  const data = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const sx = Math.floor((x * image.width) / SIZE);
      const sy = Math.floor((y * image.height) / SIZE);
      image.data.copy(data, (y * SIZE + x) * 4, (sy * image.width + sx) * 4, (sy * image.width + sx) * 4 + 4);
    }
  }
  return { width: SIZE, height: SIZE, data };
}

function set(image: Image, x: number, y: number, rgba: [number, number, number, number]): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const at = (y * image.width + x) * 4;
  const alpha = rgba[3] / 255;
  for (let c = 0; c < 3; c++) image.data[at + c] = Math.round(rgba[c]! * alpha + image.data[at + c]! * (1 - alpha));
  image.data[at + 3] = Math.max(image.data[at + 3]!, rgba[3]);
}

/** Plakette 15×15 unten rechts: türkises Feld mit dunklem Rand und weißem „H“. */
function badge(image: Image): void {
  const x0 = SIZE - 17;
  const y0 = SIZE - 17;
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 15; x++) {
      const corner = (x === 0 || x === 14) && (y === 0 || y === 14);
      if (corner) continue;
      const edge = x === 0 || x === 14 || y === 0 || y === 14;
      set(image, x0 + x, y0 + y, edge ? [8, 40, 48, 255] : [36, 200, 210, 255]);
    }
  }
  GLYPH.forEach((row, gy) => {
    for (let gx = 0; gx < row.length; gx++) if (row[gx] === 'X') set(image, x0 + 5 + gx, y0 + 4 + gy, [255, 255, 255, 255]);
  });
}

/** Symbol mit Plakette aus einem PNG (oder dem Standard-Symbol). */
export function worldIcon(png: Buffer | null): Buffer {
  const decoded = png ? decodePng(png) : null;
  const image = decoded ? fit({ width: decoded.width, height: decoded.height, data: Buffer.from(decoded.data) }) : blank(30, 70, 80);
  badge(image);
  return encodePng(image);
}
