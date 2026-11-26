// Skins für die 3D-Figur auf der Startseite.
// Microsoft-Konten: eigener Skin von Mojang (zwischengespeichert). Sonst ein Standard-Skin aus der
// installierten Minecraft-JAR – genau der, den auch das Spiel für diese UUID zeigt.
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SkinInfo } from '../../shared/api';
import { request } from './http';
import type { LauncherPaths } from './paths';

/** Reihenfolge wie in Minecrafts DefaultPlayerSkin: erst alle schmalen, dann alle breiten Modelle. */
const DEFAULT_SKINS = ['alex', 'ari', 'efe', 'kai', 'makena', 'noor', 'steve', 'sunny', 'zuri'];
const SKIN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Java: UUID.hashCode() – (int)(hilo >> 32) ^ (int) hilo mit hilo = most ^ least. */
function javaUuidHash(uuid: string): number {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) return 0;
  const most = BigInt.asIntN(64, BigInt(`0x${hex.slice(0, 16)}`));
  const least = BigInt.asIntN(64, BigInt(`0x${hex.slice(16)}`));
  const hilo = BigInt.asIntN(64, most ^ least);
  return Number(BigInt.asIntN(32, hilo >> 32n)) ^ Number(BigInt.asIntN(32, hilo));
}

export function defaultSkinFor(uuid: string): { name: string; slim: boolean } {
  const index = ((javaUuidHash(uuid) % 18) + 18) % 18;
  return { name: DEFAULT_SKINS[index % 9], slim: index < 9 };
}

/** Neueste installierte Client-JAR, die die Standard-Skins enthält. */
async function findClientJar(versionsDir: string): Promise<string | null> {
  let entries: { jar: string; mtime: number }[] = [];
  try {
    for (const id of await readdir(versionsDir)) {
      const jar = path.join(versionsDir, id, `${id}.jar`);
      const info = await stat(jar).catch(() => null);
      if (info?.isFile()) entries.push({ jar, mtime: info.mtimeMs });
    }
  } catch {
    return null;
  }
  entries = entries.sort((a, b) => b.mtime - a.mtime);
  for (const { jar } of entries) {
    try {
      if (new AdmZip(jar).getEntry('assets/minecraft/textures/entity/player/wide/steve.png')) return jar;
    } catch {
      // beschädigte JAR überspringen
    }
  }
  return null;
}

const defaultCache = new Map<string, SkinInfo>();

async function defaultSkin(paths: LauncherPaths, uuid: string): Promise<SkinInfo | null> {
  const { name, slim } = defaultSkinFor(uuid);
  const key = `${slim ? 'slim' : 'wide'}/${name}`;
  const cached = defaultCache.get(key);
  if (cached) return cached;
  const jar = await findClientJar(paths.versions);
  if (!jar) return null;
  const entry = new AdmZip(jar).getEntry(`assets/minecraft/textures/entity/player/${key}.png`);
  if (!entry) return null;
  const skin: SkinInfo = { dataUrl: `data:image/png;base64,${entry.getData().toString('base64')}`, slim, source: 'default' };
  defaultCache.set(key, skin);
  return skin;
}

const TEXTURE_HOST = 'textures.minecraft.net';
const MAX_TEXTURE_BYTES = 256 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Nur für Tests: zusätzlich erlaubte Loopback-Adresse für Texturen (Fake-Server statt textures.minecraft.net) */
let testTextureOrigin: string | null = null;

/** Nur Tests (Entwicklungsmodus): Texturen auch von dieser Loopback-Adresse laden, z. B. http://127.0.0.1:4567 */
export function allowTestTextureOrigin(origin: string | null): void {
  if (!origin) {
    testTextureOrigin = null;
    return;
  }
  const url = new URL(origin);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Test-Texturen nur von einer Loopback-Adresse');
  testTextureOrigin = url.origin;
}

/** Adresse einer Textur von Mojang (immer über HTTPS, Mojang nennt http://) oder null, wenn der Host nicht erlaubt ist. */
export function textureUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (testTextureOrigin && url.origin === testTextureOrigin) return url.toString();
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname !== TEXTURE_HOST || url.username || url.password) return null;
  if (url.port !== '' && url.port !== '80' && url.port !== '443') return null;
  url.protocol = 'https:';
  url.port = '';
  return url.toString();
}

export function isPng(data: Buffer): boolean {
  return data.length > PNG_SIGNATURE.length && data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

/**
 * Textur von textures.minecraft.net mit Zwischenspeicher (cache/skins/<sha1(url)>.png). Texturen ändern sich unter
 * derselben Adresse nicht; maxAgeMs bestimmt nur, wann neu geladen wird. Offline: auch ein älterer Stand. null = nicht ladbar.
 */
export async function cachedTexture(paths: LauncherPaths, rawUrl: string, maxAgeMs = SKIN_MAX_AGE_MS): Promise<Buffer | null> {
  const url = textureUrl(rawUrl);
  if (!url) return null;
  const file = path.join(paths.cache, 'skins', `${createHash('sha1').update(url).digest('hex')}.png`);
  const info = await stat(file).catch(() => null);
  if (!info || Date.now() - info.mtimeMs > maxAgeMs) {
    try {
      const res = await request(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) }, 2);
      if (res.ok) {
        const data = Buffer.from(await res.arrayBuffer());
        if (data.length <= MAX_TEXTURE_BYTES && isPng(data)) {
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, data);
          return data;
        }
      }
    } catch {
      // offline: älteren Stand nehmen, falls vorhanden
    }
  }
  const data = await readFile(file).catch(() => null);
  return data && isPng(data) ? data : null;
}

/** Skin eines Kontos: eigener Skin, wenn vorhanden, sonst der passende Standard-Skin. */
export async function skinFor(paths: LauncherPaths, account: { uuid: string; skinUrl?: string }): Promise<SkinInfo | null> {
  if (account.skinUrl) {
    const data = await cachedTexture(paths, account.skinUrl).catch(() => null);
    // Modell (schmal/breit) erkennt die 3D-Ansicht selbst am Bild
    if (data) return { dataUrl: `data:image/png;base64,${data.toString('base64')}`, slim: null, source: 'account' };
    // offline und noch nicht zwischengespeichert: Standard-Skin
  }
  return defaultSkin(paths, account.uuid);
}

/** Standard-Skin für eine UUID (aus der installierten Minecraft-JAR) */
export async function defaultSkinInfo(paths: LauncherPaths, uuid: string): Promise<SkinInfo | null> {
  return defaultSkin(paths, uuid);
}
