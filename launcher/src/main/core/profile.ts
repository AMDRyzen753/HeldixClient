// Skins & Capes: Skin und Cape bei Mojang ändern, eigene Skin-Sammlung, Heldix-Cape beim Heldix-Dienst.
//
// Mojang (nur Microsoft-Konten mit gültigem Token): GET /minecraft/profile, POST /minecraft/profile/skins
// (multipart: variant + file), DELETE /minecraft/profile/skins/active, PUT/DELETE /minecraft/profile/capes/active.
// Die Sammlung liegt im Datenordner unter skins/ (index.json + PNG-Dateien).

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import type { HeldixCape, MojangCape, ProfileState, SavedSkin, SkinInfo, SkinVariant } from '../../shared/api';
import { readJson, writeJson } from './fsutil';
import type { LauncherPaths } from './paths';
import { cachedTexture, isPng, textureUrl } from './skins';

export const MOJANG_API = 'https://api.minecraftservices.com';
/** größte Skin-Datei für die Sammlung */
export const MAX_SKIN_FILE = 64 * 1024;
const PROFILE_CACHE_MS = 2 * 60_000;
/** Texturen ändern sich unter derselben Adresse nie */
const TEXTURE_MAX_AGE = 365 * 24 * 60 * 60_000;
const CURRENT_SKIN_NAME = 'Aktueller Skin';

// ---------- PNG prüfen und Modell raten ----------

interface DecodedPng {
  width: number;
  height: number;
  /** Deckkraft 0–255 eines Pixels */
  alpha(x: number, y: number): number;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

class UnsupportedPng extends Error {}

/**
 * Kleiner PNG-Leser (nur für Skins): alle Farbtypen, Bittiefen 1–16, ohne Interlacing.
 * Wirft bei beschädigten Dateien; UnsupportedPng bei Interlacing.
 */
export function decodePng(buf: Buffer): DecodedPng {
  if (!isPng(buf)) throw new Error('kein PNG');
  let offset = 8;
  let ihdr: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (data.length !== length) throw new Error('abgeschnitten');
    if (type === 'IHDR') ihdr = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!ihdr || ihdr.length < 13 || idat.length === 0) throw new Error('unvollständig');
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  if (ihdr[12] !== 0) throw new UnsupportedPng('Interlacing');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels || ![1, 2, 4, 8, 16].includes(bitDepth)) throw new Error('unbekanntes Format');
  if (width < 1 || height < 1 || width > 1024 || height > 1024) throw new Error('Größe');
  const bitsPerPixel = channels * bitDepth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < height * (stride + 1)) throw new Error('zu wenig Bilddaten');
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      const x = line[i];
      switch (filter) {
        case 0: out[i] = x; break;
        case 1: out[i] = x + a; break;
        case 2: out[i] = x + b; break;
        case 3: out[i] = x + ((a + b) >> 1); break;
        case 4: out[i] = x + paeth(a, b, c); break;
        default: throw new Error('unbekannter Filter');
      }
    }
  }
  const sample = (row: Buffer, index: number): number => {
    // index = Nummer des Werts in der Zeile; 16 Bit: oberes Byte, unter 8 Bit: aus dem Byte herausschneiden
    if (bitDepth === 8) return row[index];
    if (bitDepth === 16) return row[index * 2];
    const bit = index * bitDepth;
    return (row[bit >> 3] >> (8 - bitDepth - (bit & 7))) & ((1 << bitDepth) - 1);
  };
  const rawSample = (row: Buffer, index: number): number => (bitDepth === 16 ? row.readUInt16BE(index * 2) : sample(row, index));
  return {
    width,
    height,
    alpha(x: number, y: number): number {
      if (x < 0 || y < 0 || x >= width || y >= height) return 0;
      const row = pixels.subarray(y * stride, (y + 1) * stride);
      switch (colorType) {
        case 6: return sample(row, x * 4 + 3);
        case 4: return sample(row, x * 2 + 1);
        case 3: {
          const index = sample(row, x);
          return trns && index < trns.length ? trns[index] : 255;
        }
        case 2: {
          if (!trns || trns.length < 6) return 255;
          const same = [0, 1, 2].every((ch) => rawSample(row, x * 3 + ch) === trns!.readUInt16BE(ch * 2));
          return same ? 0 : 255;
        }
        default: {
          if (!trns || trns.length < 2) return 255;
          return rawSample(row, x) === trns.readUInt16BE(0) ? 0 : 255;
        }
      }
    },
  };
}

/** Schmal (Alex), wenn die Pixel der Arme bei x = 54..55, y = 20..31 durchsichtig sind; alte 64×32-Skins sind immer breit. */
export function guessVariant(png: DecodedPng): SkinVariant {
  if (png.height !== 64) return 'classic';
  for (let y = 20; y <= 31; y++) {
    for (let x = 54; x <= 55; x++) if (png.alpha(x, y) !== 0) return 'classic';
  }
  return 'slim';
}

/**
 * Prüft eine Skin-Datei (echte PNG-Signatur, 64×64 oder 64×32, höchstens 64 KB) und rät das Modell.
 * label = Dateiname für die Fehlermeldung.
 */
export function inspectSkin(data: Buffer, label = 'Die Datei'): { width: number; height: number; variant: SkinVariant } {
  const quoted = label === 'Die Datei' ? label : `„${label}“`;
  if (data.length > MAX_SKIN_FILE) throw new Error(`${quoted} ist zu groß – Skins haben höchstens 64 KB.`);
  if (!isPng(data) || data.length < 33 || data.toString('latin1', 12, 16) !== 'IHDR') throw new Error(`${quoted} ist kein PNG-Bild.`);
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== 64 || (height !== 64 && height !== 32)) {
    throw new Error(`${quoted} hat ${width}×${height} Pixel – Minecraft-Skins haben 64×64 (alt: 64×32) Pixel.`);
  }
  try {
    return { width, height, variant: guessVariant(decodePng(data)) };
  } catch (error) {
    if (error instanceof UnsupportedPng) return { width, height, variant: 'classic' };
    throw new Error(`${quoted} ist beschädigt und lässt sich nicht lesen.`);
  }
}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const pngDataUrl = (data: Buffer) => `data:image/png;base64,${data.toString('base64')}`;

// ---------- Sammlung ----------

interface LibraryEntry {
  id: string;
  name: string;
  variant: SkinVariant;
  addedAt: number;
  sha256: string;
  /** Adresse bei Mojang, seit dieser Skin hochgeladen wurde (Mojang speichert das Bild neu, die Bytes weichen ab) */
  textureUrl?: string;
}

interface LibraryIndex {
  version: 1;
  skins: LibraryEntry[];
  /** automatisch übernommene Mojang-Skins je Konto (SHA-256), damit gelöschte nicht wiederkommen */
  adopted: Record<string, string[]>;
}

export interface ActiveSkin {
  sha256: string | null;
  url: string | null;
}

const ID_RE = /^[0-9a-f]{16}$/;

function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, '').trim() : '';
  return [...name].slice(0, 32).join('').trim();
}

export class SkinLibrary {
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private readonly dir: string) {}

  private get indexFile(): string {
    return path.join(this.dir, 'index.json');
  }

  private file(id: string): string {
    if (!ID_RE.test(id)) throw new Error('Diesen Skin gibt es nicht (mehr).');
    return path.join(this.dir, `${id}.png`);
  }

  /** Änderungen nacheinander ausführen (index.json) */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.lock.catch(() => undefined).then(task);
    this.lock = run.catch(() => undefined);
    return run;
  }

  private async read(): Promise<LibraryIndex> {
    const raw = await readJson<Partial<LibraryIndex>>(this.indexFile);
    const skins = (Array.isArray(raw?.skins) ? raw.skins : []).filter(
      (s): s is LibraryEntry => !!s && typeof s.id === 'string' && ID_RE.test(s.id) && typeof s.sha256 === 'string',
    );
    for (const skin of skins) {
      if (skin.variant !== 'slim') skin.variant = 'classic';
      skin.name = cleanName(skin.name) || 'Skin';
      if (typeof skin.addedAt !== 'number') skin.addedAt = 0;
    }
    const adopted = raw?.adopted && typeof raw.adopted === 'object' ? raw.adopted : {};
    return { version: 1, skins, adopted };
  }

  private async write(index: LibraryIndex): Promise<void> {
    await writeJson(this.indexFile, index);
  }

  private async toSaved(entry: LibraryEntry, active: ActiveSkin): Promise<SavedSkin | null> {
    const data = await readFile(this.file(entry.id)).catch(() => null);
    if (!data) return null;
    return {
      id: entry.id,
      name: entry.name,
      variant: entry.variant,
      dataUrl: pngDataUrl(data),
      addedAt: entry.addedAt,
      active: (!!active.sha256 && entry.sha256 === active.sha256) || (!!active.url && entry.textureUrl === active.url),
    };
  }

  /** Sammlung, neueste zuerst */
  async list(active: ActiveSkin = { sha256: null, url: null }): Promise<SavedSkin[]> {
    const index = await this.read();
    const saved = await Promise.all(index.skins.map((entry) => this.toSaved(entry, active)));
    return saved.filter((s): s is SavedSkin => s !== null).sort((a, b) => b.addedAt - a.addedAt);
  }

  private async addLocked(index: LibraryIndex, data: Buffer, name: string, variant: SkinVariant): Promise<LibraryEntry> {
    const hash = sha256(data);
    const existing = index.skins.find((s) => s.sha256 === hash);
    if (existing) return existing;
    const entry: LibraryEntry = { id: randomBytes(8).toString('hex'), name: cleanName(name) || 'Skin', variant, addedAt: Date.now(), sha256: hash };
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(entry.id), data);
    index.skins.push(entry);
    return entry;
  }

  /** Prüft und übernimmt eine Skin-Datei (gleiches Bild = vorhandener Eintrag). */
  add(data: Buffer, name: string, variant?: SkinVariant, active?: ActiveSkin): Promise<SavedSkin> {
    const checked = inspectSkin(data);
    return this.exclusive(async () => {
      const index = await this.read();
      const entry = await this.addLocked(index, data, name, variant ?? checked.variant);
      await this.write(index);
      return (await this.toSaved(entry, active ?? { sha256: null, url: null }))!;
    });
  }

  /** Dateien übernehmen; wirft nur, wenn keine einzige ein Skin war. */
  async importFiles(files: unknown[], active?: ActiveSkin): Promise<SavedSkin[]> {
    const added: SavedSkin[] = [];
    const errors: string[] = [];
    for (const file of files) {
      if (typeof file !== 'string' || !file) continue;
      const label = path.basename(file);
      try {
        const info = await stat(file);
        if (!info.isFile()) throw new Error(`„${label}“ ist keine Datei.`);
        if (info.size > MAX_SKIN_FILE) throw new Error(`„${label}“ ist zu groß – Skins haben höchstens 64 KB.`);
        const data = await readFile(file);
        const { variant } = inspectSkin(data, label);
        const saved = await this.add(data, label.replace(/\.png$/i, ''), variant, active);
        if (!added.some((s) => s.id === saved.id)) added.push(saved);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (added.length === 0 && errors.length > 0) throw new Error(errors.length === 1 ? errors[0] : `${errors[0]} (und ${errors.length - 1} weitere Dateien)`);
    return added;
  }

  async get(id: unknown): Promise<{ entry: LibraryEntry; data: Buffer }> {
    const entry = typeof id === 'string' ? (await this.read()).skins.find((s) => s.id === id) : undefined;
    const data = entry ? await readFile(this.file(entry.id)).catch(() => null) : null;
    if (!entry || !data) throw new Error('Diesen Skin gibt es nicht (mehr).');
    return { entry, data };
  }

  update(id: unknown, patch: unknown, active?: ActiveSkin): Promise<SavedSkin> {
    return this.exclusive(async () => {
      const index = await this.read();
      const entry = typeof id === 'string' ? index.skins.find((s) => s.id === id) : undefined;
      if (!entry) throw new Error('Diesen Skin gibt es nicht (mehr).');
      const p = (patch && typeof patch === 'object' ? patch : {}) as { name?: unknown; variant?: unknown };
      if (p.name !== undefined) {
        const name = cleanName(p.name);
        if (!name) throw new Error('Bitte einen Namen eingeben.');
        entry.name = name;
      }
      if (p.variant !== undefined) {
        if (p.variant !== 'classic' && p.variant !== 'slim') throw new Error('Ungültiges Modell.');
        entry.variant = p.variant;
      }
      await this.write(index);
      const saved = await this.toSaved(entry, active ?? { sha256: null, url: null });
      if (!saved) throw new Error('Diesen Skin gibt es nicht (mehr).');
      return saved;
    });
  }

  remove(id: unknown): Promise<void> {
    return this.exclusive(async () => {
      const index = await this.read();
      const entry = typeof id === 'string' ? index.skins.find((s) => s.id === id) : undefined;
      if (!entry) return;
      index.skins = index.skins.filter((s) => s !== entry);
      await this.write(index);
      await rm(this.file(entry.id), { force: true });
    });
  }

  /** Nach dem Hochladen: Adresse bei Mojang merken (für „aktiv“) und das Bild als bekannt für das Konto. */
  markUploaded(id: string, account: string, url: string | null, mojangSha: string | null): Promise<void> {
    return this.exclusive(async () => {
      const index = await this.read();
      for (const skin of index.skins) {
        if (url && skin.textureUrl === url) delete skin.textureUrl;
        if (skin.id === id && url) skin.textureUrl = url;
      }
      if (mojangSha) index.adopted[account] = [...new Set([...(index.adopted[account] ?? []), mojangSha])].slice(-200);
      await this.write(index);
    });
  }

  /**
   * Aktuellen Mojang-Skin einmalig in die Sammlung übernehmen („Aktueller Skin“), damit man nach einem Wechsel zurück
   * kann. Schon übernommene (auch wieder gelöschte) und schon vorhandene Bilder bleiben, wie sie sind.
   */
  adoptCurrent(account: string, data: Buffer, variant: SkinVariant, url: string | null): Promise<boolean> {
    return this.exclusive(async () => {
      const index = await this.read();
      const hash = sha256(data);
      const seen = index.adopted[account] ?? [];
      if (seen.includes(hash) || index.skins.some((s) => s.sha256 === hash || (url && s.textureUrl === url))) {
        if (!seen.includes(hash)) {
          index.adopted[account] = [...seen, hash].slice(-200);
          await this.write(index);
        }
        return false;
      }
      try {
        inspectSkin(data);
      } catch {
        return false;
      }
      const taken = new Set(index.skins.map((s) => s.name));
      let name = CURRENT_SKIN_NAME;
      for (let n = 2; taken.has(name); n++) name = `${CURRENT_SKIN_NAME} (${n})`;
      const entry = await this.addLocked(index, data, name, variant);
      if (url) entry.textureUrl = url;
      index.adopted[account] = [...seen, hash].slice(-200);
      await this.write(index);
      return true;
    });
  }
}

// ---------- Mojang ----------

export interface MojangSkinEntry {
  id: string;
  state: string;
  url: string;
  variant: SkinVariant;
  /** nur bei Standard-Skins von Mojang, z. B. "STEVE" */
  alias: string | null;
}

export interface MojangCapeEntry {
  id: string;
  state: string;
  url: string;
  alias: string;
}

export interface MojangProfile {
  id: string;
  name: string;
  skins: MojangSkinEntry[];
  capes: MojangCapeEntry[];
}

const MOJANG_UNREACHABLE = 'Mojang ist gerade nicht erreichbar. Bitte später noch einmal versuchen.';

function parseProfile(raw: unknown): MojangProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as { id?: unknown; name?: unknown; skins?: unknown; capes?: unknown };
  if (typeof p.id !== 'string' || typeof p.name !== 'string') return null;
  const list = (value: unknown) => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []).filter((e) => e && typeof e.id === 'string' && typeof e.url === 'string');
  return {
    id: p.id.replace(/-/g, '').toLowerCase(),
    name: p.name,
    skins: list(p.skins).map((s) => ({
      id: String(s.id),
      state: String(s.state ?? ''),
      url: String(s.url),
      variant: String(s.variant ?? '').toUpperCase() === 'SLIM' ? 'slim' : 'classic',
      alias: typeof s.alias === 'string' && s.alias ? s.alias : null,
    })),
    capes: list(p.capes).map((c) => ({ id: String(c.id), state: String(c.state ?? ''), url: String(c.url), alias: typeof c.alias === 'string' ? c.alias : 'Cape' })),
  };
}

type MojangAction = 'profile' | 'skin' | 'reset' | 'cape';

function mojangError(status: number, body: string, action: MojangAction): string {
  if (status === 401) return 'Die Anmeldung bei Minecraft ist abgelaufen. Bitte das Konto im Launcher neu anmelden.';
  if (status === 429) {
    return action === 'profile'
      ? 'Mojang bekommt gerade zu viele Anfragen. Bitte kurz warten und noch einmal versuchen.'
      : 'Zu viele Änderungen in kurzer Zeit – Mojang lässt erst in ein paar Minuten wieder eine zu.';
  }
  if (status >= 500) return MOJANG_UNREACHABLE;
  if (action === 'profile' && status === 404) return 'Mit diesem Konto wurde Minecraft: Java Edition nicht gekauft (oder es gibt noch kein Profil).';
  if (action === 'cape' && (status === 400 || status === 404)) return 'Dieses Cape gehört nicht zu deinem Konto.';
  if (action === 'skin' && status === 400) {
    return /size|dimension|width|height/i.test(body)
      ? 'Mojang hat den Skin abgelehnt: falsche Bildgröße (64×64 oder 64×32 Pixel).'
      : 'Mojang hat den Skin abgelehnt (ungültiges Bild).';
  }
  if (status === 403) return 'Mojang erlaubt diese Änderung für dieses Konto gerade nicht.';
  return `Mojang antwortet mit ${status}. Bitte später noch einmal versuchen.`;
}

/** Profil-Schnittstelle von Mojang; base nur in Tests anders (Fake-Server). */
export class MojangApi {
  private readonly base: string;

  constructor(base: string = MOJANG_API) {
    this.base = base.replace(/\/+$/, '');
  }

  private async call(action: MojangAction, route: string, token: string, init: { method?: string; body?: BodyInit; json?: unknown } = {}): Promise<MojangProfile> {
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json' };
    let body = init.body;
    if (init.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(init.json);
    }
    let response: Response;
    try {
      response = await fetch(`${this.base}${route}`, { method: init.method ?? 'GET', headers, body, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new Error(MOJANG_UNREACHABLE);
    }
    const text = await response.text().catch(() => '');
    if (!response.ok) throw new Error(mojangError(response.status, text, action));
    let profile: MojangProfile | null = null;
    try {
      profile = parseProfile(JSON.parse(text));
    } catch {
      profile = null;
    }
    // manche Antworten haben keinen Körper: dann das Profil neu holen
    if (!profile && action !== 'profile') return this.profile(token);
    if (!profile) throw new Error('Mojang hat eine ungültige Antwort geschickt.');
    return profile;
  }

  profile(token: string): Promise<MojangProfile> {
    return this.call('profile', '/minecraft/profile', token);
  }

  uploadSkin(token: string, png: Buffer, variant: SkinVariant): Promise<MojangProfile> {
    const form = new FormData();
    form.append('variant', variant);
    form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'skin.png');
    return this.call('skin', '/minecraft/profile/skins', token, { method: 'POST', body: form });
  }

  resetSkin(token: string): Promise<MojangProfile> {
    return this.call('reset', '/minecraft/profile/skins/active', token, { method: 'DELETE' });
  }

  setCape(token: string, capeId: string | null): Promise<MojangProfile> {
    return capeId
      ? this.call('cape', '/minecraft/profile/capes/active', token, { method: 'PUT', json: { capeId } })
      : this.call('cape', '/minecraft/profile/capes/active', token, { method: 'DELETE' });
  }
}

// ---------- Heldix-Capes ----------

/** Katalog der Heldix-Capes (capes.json aus der Client-Mod, liegt neben der Oberfläche unter capes/). */
export async function loadHeldixCapes(file: string): Promise<HeldixCape[]> {
  const raw = await readJson<{ capes?: unknown }>(file);
  const list = Array.isArray(raw?.capes) ? (raw.capes as Record<string, unknown>[]) : [];
  return list
    .filter((c) => c && typeof c.id === 'string' && /^[a-z0-9_-]{1,40}$/.test(c.id))
    .map((c) => ({
      id: String(c.id),
      name: typeof c.name === 'string' && c.name ? c.name : String(c.id),
      description: typeof c.description === 'string' ? c.description : '',
      frames: Number.isInteger(c.frames) && (c.frames as number) > 0 ? (c.frames as number) : 1,
      fps: Number.isInteger(c.fps) && (c.fps as number) > 0 ? (c.fps as number) : 10,
      glow: c.glow === true,
    }));
}

// ---------- Zusammenspiel ----------

export interface ProfileAccount {
  id: string;
  type: 'microsoft' | 'offline';
  name: string;
  uuid: string;
  /** angemeldet über den offiziellen Minecraft Launcher */
  source?: 'launcher';
}

export interface ProfileOptions<A extends ProfileAccount> {
  paths: LauncherPaths;
  /** Ordner der Sammlung (Datenordner/skins) */
  libraryDir: string;
  mojang: MojangApi;
  account(): Promise<A | null>;
  /** gültiges Minecraft-Token ohne Rückfragen (erneuert über den Refresh-Token); wirft mit deutscher Meldung */
  accessToken(account: A): Promise<string>;
  /** Heldix-Dienst (GET/PUT /v1/me); null = keiner eingerichtet */
  heldix: { getMe(): Promise<{ cape: string }>; setCape(id: string): Promise<{ cape: string }> } | null;
  /** auch Offline-Konten beim Heldix-Dienst (nur Tests) */
  heldixForOffline?: boolean;
  capes(): Promise<HeldixCape[]>;
  /** Skin, wenn Mojang nicht gefragt werden kann (Standard-Skin bzw. zwischengespeicherter Skin des Kontos) */
  fallbackSkin(account: A): Promise<SkinInfo | null>;
  /** Skin bei Mojang geändert (Startseiten-Figur neu laden); url = neuer aktiver Skin */
  onSkinChanged?(account: A, url: string | null): Promise<void> | void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class ProfileService<A extends ProfileAccount = ProfileAccount> {
  readonly library: SkinLibrary;
  private readonly profiles = new Map<string, { profile: MojangProfile; at: number }>();
  private active: ActiveSkin = { sha256: null, url: null };
  private busy: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: ProfileOptions<A>) {
    this.library = new SkinLibrary(options.libraryDir);
  }

  /** Änderungen bei Mojang nacheinander (kein doppeltes Hochladen bei Doppelklick) */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.busy.catch(() => undefined).then(task);
    this.busy = run.catch(() => undefined);
    return run;
  }

  private async mojangProfile(account: A, refresh: boolean): Promise<MojangProfile> {
    const cached = this.profiles.get(account.id);
    if (!refresh && cached && Date.now() - cached.at < PROFILE_CACHE_MS) return cached.profile;
    const profile = await this.options.mojang.profile(await this.options.accessToken(account));
    this.profiles.set(account.id, { profile, at: Date.now() });
    return profile;
  }

  private async editable(): Promise<{ account: A; token: string }> {
    const account = await this.options.account();
    if (!account) throw new Error('Bitte zuerst ein Konto hinzufügen.');
    if (account.type !== 'microsoft') throw new Error('Skins und Capes lassen sich nur mit einem Microsoft-Konto ändern.');
    return { account, token: await this.options.accessToken(account) };
  }

  /** Stand für die Seite „Skins & Capes“. Fehler einzelner Teile stehen in error, der Rest bleibt nutzbar. */
  async state(refresh = false): Promise<ProfileState> {
    const heldixCapes = await this.options.capes().catch(() => []);
    const account = await this.options.account();
    if (!account) {
      this.active = { sha256: null, url: null };
      return { account: null, canEditSkin: false, skin: null, mojangCapes: [], heldixAvailable: false, heldixCape: null, heldixCapes, library: await this.library.list(), error: null };
    }
    const errors: string[] = [];
    let profile: MojangProfile | null = null;
    if (account.type === 'microsoft') {
      try {
        profile = await this.mojangProfile(account, refresh);
      } catch (error) {
        errors.push(message(error));
      }
    }

    // aktueller Skin
    let skin: ProfileState['skin'] = null;
    this.active = { sha256: null, url: null };
    const activeSkin = profile?.skins.find((s) => s.state === 'ACTIVE');
    if (activeSkin) {
      const data = await cachedTexture(this.options.paths, activeSkin.url, TEXTURE_MAX_AGE).catch(() => null);
      if (data) {
        skin = { dataUrl: pngDataUrl(data), variant: activeSkin.variant };
        const url = textureUrl(activeSkin.url);
        this.active = { sha256: sha256(data), url };
        // Standard-Skins von Mojang (Steve, Alex …) gibt es über „Standard-Skin“, sie kommen nicht in die Sammlung
        if (!activeSkin.alias) await this.library.adoptCurrent(account.uuid, data, activeSkin.variant, url).catch(() => false);
      }
    }
    if (!skin) {
      const fallback = await this.options.fallbackSkin(account).catch(() => null);
      if (fallback) {
        let variant: SkinVariant = fallback.slim ? 'slim' : 'classic';
        if (fallback.slim === null) {
          try {
            variant = guessVariant(decodePng(Buffer.from(fallback.dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')));
          } catch {
            variant = 'classic';
          }
        }
        skin = { dataUrl: fallback.dataUrl, variant };
      }
    }

    // Capes von Mojang
    const mojangCapes: MojangCape[] = profile
      ? await Promise.all(
          profile.capes.map(async (cape) => {
            const data = await cachedTexture(this.options.paths, cape.url, TEXTURE_MAX_AGE).catch(() => null);
            return { id: cape.id, alias: cape.alias, dataUrl: data ? pngDataUrl(data) : null, active: cape.state === 'ACTIVE' };
          }),
        )
      : [];

    // Heldix-Cape
    let heldixAvailable = false;
    let heldixCape: string | null = null;
    if (this.options.heldix && (account.type === 'microsoft' || this.options.heldixForOffline)) {
      try {
        const me = await this.options.heldix.getMe();
        heldixAvailable = true;
        heldixCape = me.cape || null;
      } catch (error) {
        errors.push(`Heldix-Cape: ${message(error)}`);
      }
    }

    return {
      account: { uuid: account.uuid, name: account.name, type: account.type, ...(account.source ? { via: account.source } : {}) },
      canEditSkin: account.type === 'microsoft' && profile !== null,
      skin,
      mojangCapes,
      heldixAvailable,
      heldixCape,
      heldixCapes,
      library: await this.library.list(this.active),
      error: errors.length ? [...new Set(errors)].join(' ') : null,
    };
  }

  importSkins(files: unknown[]): Promise<SavedSkin[]> {
    return this.library.importFiles(files, this.active);
  }

  updateSavedSkin(id: unknown, patch: unknown): Promise<SavedSkin> {
    return this.library.update(id, patch, this.active);
  }

  deleteSavedSkin(id: unknown): Promise<void> {
    return this.library.remove(id);
  }

  /** neuen Stand von Mojang übernehmen (nach einer Änderung) */
  private async changed(account: A, profile: MojangProfile, skinChanged: boolean): Promise<void> {
    this.profiles.set(account.id, { profile, at: Date.now() });
    if (skinChanged) await this.options.onSkinChanged?.(account, profile.skins.find((s) => s.state === 'ACTIVE')?.url ?? null);
  }

  applySkin(id: unknown): Promise<ProfileState> {
    return this.exclusive(async () => {
      const { entry, data } = await this.library.get(id);
      const { account, token } = await this.editable();
      const profile = await this.options.mojang.uploadSkin(token, data, entry.variant);
      const active = profile.skins.find((s) => s.state === 'ACTIVE');
      const url = active ? textureUrl(active.url) : null;
      const served = active ? await cachedTexture(this.options.paths, active.url, TEXTURE_MAX_AGE).catch(() => null) : null;
      await this.library.markUploaded(entry.id, account.uuid, url, served ? sha256(served) : null);
      await this.changed(account, profile, true);
      return this.state();
    });
  }

  resetSkin(): Promise<ProfileState> {
    return this.exclusive(async () => {
      const { account, token } = await this.editable();
      await this.changed(account, await this.options.mojang.resetSkin(token), true);
      return this.state();
    });
  }

  setMojangCape(id: unknown): Promise<ProfileState> {
    return this.exclusive(async () => {
      const { account, token } = await this.editable();
      if (id !== null && id !== undefined) {
        const profile = await this.mojangProfile(account, false);
        if (typeof id !== 'string' || !profile.capes.some((c) => c.id === id)) throw new Error('Dieses Cape gehört nicht zu deinem Konto.');
      }
      await this.changed(account, await this.options.mojang.setCape(token, typeof id === 'string' ? id : null), false);
      return this.state();
    });
  }

  setHeldixCape(id: unknown): Promise<ProfileState> {
    return this.exclusive(async () => {
      const heldix = this.options.heldix;
      if (!heldix) throw new Error('Kein Heldix-Dienst eingerichtet.');
      const account = await this.options.account();
      if (!account) throw new Error('Bitte zuerst ein Konto hinzufügen.');
      if (account.type !== 'microsoft' && !this.options.heldixForOffline) throw new Error('Heldix-Capes gibt es nur mit einem Microsoft-Konto.');
      let cape = '';
      if (id !== null && id !== undefined && id !== '') {
        const capes = await this.options.capes();
        if (typeof id !== 'string' || !capes.some((c) => c.id === id)) throw new Error('Dieses Heldix-Cape gibt es nicht.');
        cape = id;
      }
      await heldix.setCape(cape);
      return this.state();
    });
  }
}
