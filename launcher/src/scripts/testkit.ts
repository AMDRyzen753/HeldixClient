// Hilfen für die Tests der Freunde-, Skin- und Store-Funktionen (npm run test:social / test:profile / test:store):
// Prüf-Ausgabe, kleiner PNG-Schreiber, Fake-Server statt Mojang und Start eines lokalen Heldix-Dienstes im
// Entwicklungsmodus. Nichts davon spricht mit Mojang, Microsoft oder dem echten Heldix-Dienst.

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------- Prüfen ----------

let failures = 0;
let passed = 0;

export function check(label: string, ok: boolean, detail: unknown = ''): void {
  const text = detail instanceof Error ? detail.message : typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log(`${ok ? 'OK    ' : 'FEHLER'} ${label}${!ok && text ? ` (${text})` : ''}`);
  if (ok) passed++;
  else failures++;
}

/** Erwartet einen Fehler, dessen Meldung pattern enthält. */
export async function rejects(label: string, task: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    const value = await task();
    check(label, false, `kein Fehler, Ergebnis: ${JSON.stringify(value)?.slice(0, 200)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(label, pattern.test(message), message);
  }
}

export function finish(name: string): never {
  console.log(failures === 0 ? `${name}: alle ${passed} Prüfungen bestanden` : `${name}: ${failures} Fehler (${passed} bestanden)`);
  process.exit(failures === 0 ? 0 : 1);
}

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const randomUuid = () => randomBytes(16).toString('hex');

// ---------- PNG schreiben ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export interface PngOptions {
  /** 6 = RGBA, 2 = RGB, 4 = Grau + Alpha, 3 = Palette */
  colorType?: 6 | 2 | 4 | 3;
  bitDepth?: 4 | 8 | 16;
  /** Filter je Zeile (0–4) oder 'mixed' = reihum */
  filter?: number | 'mixed';
  interlace?: boolean;
  /** zusätzliche Chunks vor IEND (z. B. tEXt) */
  extra?: Buffer[];
}

/**
 * Schreibt ein PNG aus RGBA-Pixeln (je 4 Byte). Für Farbtyp 3 werden die Farben zu einer Palette (mit tRNS),
 * für 2 und 4 fällt Farbe bzw. Alpha weg.
 */
export function encodePng(width: number, height: number, rgba: Buffer, options: PngOptions = {}): Buffer {
  const colorType = options.colorType ?? 6;
  const bitDepth = options.bitDepth ?? 8;
  const palette: number[] = [];
  const paletteIndex = new Map<number, number>();
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const values: number[] = [];
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
      if (colorType === 6) values.push(r, g, b, a);
      else if (colorType === 2) values.push(r, g, b);
      else if (colorType === 4) values.push(Math.round((r + g + b) / 3), a);
      else {
        const key = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
        let index = paletteIndex.get(key);
        if (index === undefined) {
          index = palette.length;
          palette.push(key);
          paletteIndex.set(key, index);
        }
        values.push(index);
      }
    }
    let row: Buffer;
    if (bitDepth === 16) {
      row = Buffer.alloc(values.length * 2);
      values.forEach((v, i) => row.writeUInt16BE(v * 257, i * 2));
    } else if (bitDepth === 4) {
      row = Buffer.alloc(Math.ceil(values.length / 2));
      values.forEach((v, i) => (row[i >> 1] |= (v & 15) << (i % 2 === 0 ? 4 : 0)));
    } else {
      row = Buffer.from(values);
    }
    rows.push(row);
  }
  if (colorType === 3 && palette.length > (bitDepth === 4 ? 16 : 256)) throw new Error('zu viele Farben für die Palette');
  const channels = { 6: 4, 2: 3, 4: 2, 3: 1 }[colorType];
  const bpp = Math.max(1, (channels * bitDepth) >> 3);
  const filtered: Buffer[] = [];
  rows.forEach((row, y) => {
    const filter = options.filter === 'mixed' ? y % 5 : (options.filter ?? 0);
    const prev = y > 0 ? rows[y - 1] : Buffer.alloc(row.length);
    const out = Buffer.alloc(row.length + 1);
    out[0] = filter;
    for (let i = 0; i < row.length; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      const predictor = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth(a, b, c) : 0;
      out[i + 1] = (row[i] - predictor) & 0xff;
    }
    filtered.push(out);
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[12] = options.interlace ? 1 : 0;
  const chunks = [pngChunk('IHDR', ihdr)];
  if (colorType === 3) {
    chunks.push(pngChunk('PLTE', Buffer.from(palette.flatMap((p) => [(p >>> 24) & 255, (p >>> 16) & 255, (p >>> 8) & 255]))));
    chunks.push(pngChunk('tRNS', Buffer.from(palette.map((p) => p & 255))));
  }
  chunks.push(pngChunk('IDAT', deflateSync(Buffer.concat(filtered))));
  chunks.push(...(options.extra ?? []));
  chunks.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
}

/**
 * Pixel für einen Test-Skin: alles deckend in einigen Farben; slim = Pixel x 54..55, y 20..31 durchsichtig.
 * colors begrenzt die Zahl der Farben (für Paletten).
 */
export function skinPixels(height: 64 | 32, slim: boolean, seed = 1, colors = 6): Buffer {
  const rgba = Buffer.alloc(64 * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      const tone = ((x * 7 + y * 3 + seed * 11) % colors) * Math.floor(200 / colors);
      rgba[i] = (tone + 40) & 255;
      rgba[i + 1] = (tone * 2 + seed * 17) & 255;
      rgba[i + 2] = (200 - tone) & 255;
      rgba[i + 3] = 255;
      if (slim && x >= 54 && x <= 55 && y >= 20 && y <= 31) rgba.fill(0, i, i + 4);
    }
  }
  return rgba;
}

export function makeSkin(options: { slim?: boolean; height?: 64 | 32; seed?: number } & PngOptions = {}): Buffer {
  const height = options.height ?? 64;
  return encodePng(64, height, skinPixels(height, options.slim === true, options.seed ?? 1, options.colorType === 3 && options.bitDepth === 4 ? 4 : 6), options);
}

// ---------- Fake-Server statt Mojang ----------

export interface FakeSkin {
  id: string;
  state: 'ACTIVE' | 'INACTIVE';
  url: string;
  variant: 'CLASSIC' | 'SLIM';
  alias?: string;
}

export interface FakeCape {
  id: string;
  state: 'ACTIVE' | 'INACTIVE';
  url: string;
  alias: string;
}

export interface FakePlayer {
  uuid: string;
  name: string;
  /** Minecraft-Token, das der Fake-Server annimmt */
  token: string;
  skins: FakeSkin[];
  capes: FakeCape[];
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Nachbau der benutzten Mojang-Schnittstellen: session/minecraft/join und hasJoined (für den Heldix-Dienst),
 * session/minecraft/profile (ohne Texturen), minecraft/profile mit Skins und Capes, Texturen unter /texture/<hash>.
 * Hochgeladene Skins speichert er wie Mojang neu (andere Bytes, gleiche Pixel).
 */
export class FakeMojang {
  url = '';
  readonly players = new Map<string, FakePlayer>();
  readonly textures = new Map<string, Buffer>();
  readonly joins = new Map<string, { uuid: string; name: string }>();
  readonly uploads: { variant: string; file: Buffer; fileName: string }[] = [];
  readonly log: string[] = [];
  /** nächste passende Anfrage mit diesem Status beantworten */
  fail: { route: RegExp; status: number; body?: unknown } | null = null;
  private server: Server | null = null;

  addTexture(png: Buffer): string {
    const hash = createHash('sha256').update(png).digest('hex');
    this.textures.set(hash, png);
    return `${this.url}/texture/${hash}`;
  }

  addPlayer(name: string, options: { skin?: Buffer; slim?: boolean; capes?: { alias: string; png: Buffer; active?: boolean }[] } = {}): FakePlayer {
    const player: FakePlayer = {
      uuid: randomUuid(),
      name,
      token: `fake-${randomBytes(12).toString('hex')}`,
      skins: [],
      capes: [],
    };
    if (options.skin) {
      player.skins.push({ id: randomUuid(), state: 'ACTIVE', url: this.addTexture(options.skin), variant: options.slim ? 'SLIM' : 'CLASSIC' });
    }
    for (const cape of options.capes ?? []) {
      player.capes.push({ id: randomUuid(), state: cape.active ? 'ACTIVE' : 'INACTIVE', url: this.addTexture(cape.png), alias: cape.alias });
    }
    this.players.set(player.token, player);
    return player;
  }

  private profileJson(player: FakePlayer): unknown {
    return { id: player.uuid, name: player.name, skins: player.skins, capes: player.capes, profileActions: {} };
  }

  private player(req: IncomingMessage): FakePlayer | null {
    const auth = req.headers.authorization ?? '';
    return auth.startsWith('Bearer ') ? (this.players.get(auth.slice(7)) ?? null) : null;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    const route = `${req.method} ${url.pathname}`;
    this.log.push(route);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (this.fail && this.fail.route.test(route)) {
      const { status, body } = this.fail;
      this.fail = null;
      return json(status, body ?? { error: 'Fake', errorMessage: 'forced' });
    }

    if (route === 'POST /session/minecraft/join') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as { accessToken?: string; selectedProfile?: string; serverId?: string };
      const player = this.players.get(body.accessToken ?? '');
      if (!player || player.uuid !== body.selectedProfile || !body.serverId) return json(403, { error: 'ForbiddenOperationException', errorMessage: 'Invalid token' });
      this.joins.set(body.serverId, { uuid: player.uuid, name: player.name });
      res.writeHead(204).end();
      return;
    }
    if (route === 'GET /session/minecraft/hasJoined') {
      const joined = this.joins.get(url.searchParams.get('serverId') ?? '');
      if (!joined || joined.name.toLowerCase() !== (url.searchParams.get('username') ?? '').toLowerCase()) {
        res.writeHead(204).end();
        return;
      }
      return json(200, { id: joined.uuid, name: joined.name, properties: [] });
    }
    const sessionProfile = /^GET \/session\/minecraft\/profile\/([0-9a-f]{32})$/.exec(route);
    if (sessionProfile) {
      // ohne Texturen: der Dienst antwortet dann mit 404 (kein Skin), ohne textures.minecraft.net zu fragen
      return json(200, { id: sessionProfile[1], name: 'Unbekannt', properties: [] });
    }
    const texture = /^GET \/texture\/([0-9a-f]{64})$/.exec(route);
    if (texture) {
      const png = this.textures.get(texture[1]);
      if (!png) return json(404, {});
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length });
      res.end(png);
      return;
    }

    if (url.pathname.startsWith('/minecraft/profile')) {
      const player = this.player(req);
      if (!player) return json(401, { path: url.pathname, errorType: 'UNAUTHORIZED', error: 'UnauthorizedOperationException' });
      if (route === 'GET /minecraft/profile') return json(200, this.profileJson(player));
      if (route === 'POST /minecraft/profile/skins') {
        const body = await readBody(req);
        const form = await new Request('http://fake/upload', { method: 'POST', headers: { 'content-type': req.headers['content-type'] ?? '' }, body: new Uint8Array(body) }).formData();
        const variant = String(form.get('variant') ?? '');
        const file = form.get('file');
        if (!(file instanceof Blob) || !['classic', 'slim'].includes(variant)) return json(400, { errorMessage: 'Invalid request' });
        const data = Buffer.from(await file.arrayBuffer());
        this.uploads.push({ variant, file: data, fileName: (file as File).name ?? '' });
        // Mojang speichert das Bild neu: hier mit einem zusätzlichen Chunk (gleiche Pixel, andere Bytes)
        const stored = Buffer.concat([data.subarray(0, data.length - 12), pngChunk('tEXt', Buffer.from('Comment\0fake-mojang')), data.subarray(data.length - 12)]);
        for (const skin of player.skins) skin.state = 'INACTIVE';
        player.skins = [{ id: randomUuid(), state: 'ACTIVE', url: this.addTexture(stored), variant: variant === 'slim' ? 'SLIM' : 'CLASSIC' }];
        return json(200, this.profileJson(player));
      }
      if (route === 'DELETE /minecraft/profile/skins/active') {
        player.skins = [{ id: randomUuid(), state: 'ACTIVE', url: this.addTexture(makeSkin({ seed: 99 })), variant: 'CLASSIC', alias: 'STEVE' }];
        return json(200, this.profileJson(player));
      }
      if (route === 'PUT /minecraft/profile/capes/active') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as { capeId?: string };
        const cape = player.capes.find((c) => c.id === body.capeId);
        if (!cape) return json(400, { errorMessage: 'profile does not own cape' });
        for (const c of player.capes) c.state = c === cape ? 'ACTIVE' : 'INACTIVE';
        return json(200, this.profileJson(player));
      }
      if (route === 'DELETE /minecraft/profile/capes/active') {
        for (const c of player.capes) c.state = 'INACTIVE';
        return json(200, this.profileJson(player));
      }
    }
    json(404, { error: 'Not Found' });
  }

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((error) => {
        res.writeHead(500).end(String(error));
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }
}

// ---------- lokaler Heldix-Dienst ----------

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

export interface DevService {
  url: string;
  stop(): Promise<void>;
  output(): string;
}

/**
 * Startet den Heldix-Dienst aus service/dist im Entwicklungsmodus (HELDIX_DIENST_DEV=1) auf 127.0.0.1 mit eigenem
 * Datenordner. sessionServer = Fake-Mojang für hasJoined und Skins.
 */
export async function startDevService(dataDir: string, sessionServer: string): Promise<DevService> {
  const entry = path.resolve(__dirname, '..', '..', '..', 'service', 'dist', 'server.js');
  if (!existsSync(entry)) throw new Error(`Heldix-Dienst nicht gebaut (${entry} fehlt): cd service && npm run build`);
  const port = await freePort();
  let output = '';
  const child: ChildProcess = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      HELDIX_DIENST_DEV: '1',
      HELDIX_DIENST_DATA: dataDir,
      HELDIX_DIENST_SESSION_SERVER: sessionServer,
      HELDIX_DIENST_WEBSITE: '',
      HELDIX_DIENST_UPDATE_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d: Buffer) => (output += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (output += d.toString()));
  const url = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill();
    await Promise.race([exited, delay(5000)]);
  };
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Heldix-Dienst beendet sich sofort:\n${output}`);
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return { url, stop, output: () => output };
    } catch {
      // startet noch
    }
    await delay(150);
  }
  await stop();
  throw new Error(`Heldix-Dienst startet nicht:\n${output}`);
}
