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

/** Skin eines Kontos: eigener Skin, wenn vorhanden, sonst der passende Standard-Skin. */
export async function skinFor(paths: LauncherPaths, account: { uuid: string; skinUrl?: string }): Promise<SkinInfo | null> {
  if (account.skinUrl && /^https?:\/\/textures\.minecraft\.net\//.test(account.skinUrl)) {
    const url = account.skinUrl.replace(/^http:/, 'https:');
    const file = path.join(paths.cache, 'skins', `${createHash('sha1').update(url).digest('hex')}.png`);
    try {
      const info = await stat(file).catch(() => null);
      if (!info || Date.now() - info.mtimeMs > SKIN_MAX_AGE_MS) {
        const res = await request(url);
        if (res.ok) {
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, Buffer.from(await res.arrayBuffer()));
        }
      }
      const data = await readFile(file);
      // Modell (schmal/breit) erkennt die 3D-Ansicht selbst am Bild
      return { dataUrl: `data:image/png;base64,${data.toString('base64')}`, slim: null, source: 'account' };
    } catch {
      // offline und noch nicht zwischengespeichert: Standard-Skin
    }
  }
  return defaultSkin(paths, account.uuid);
}
