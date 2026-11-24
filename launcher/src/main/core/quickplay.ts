// "Weiterspielen": Welten und Server einer Instanz für den Direktstart (Minecraft Quick Play, ab 1.20).
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { QuickPlayList, QuickPlayTarget } from '../../shared/api';

// ---------- NBT (Minecrafts Binärformat, Big Endian) ----------

type Nbt = string | number | bigint | Nbt[] | { [key: string]: Nbt } | Uint8Array | Int32Array | BigInt64Array;

class NbtReader {
  private offset = 0;
  constructor(private readonly buf: Buffer) {}

  root(): { [key: string]: Nbt } {
    const type = this.buf.readUInt8(this.offset++);
    if (type !== 10) throw new Error('Kein NBT-Compound');
    this.string(); // Name des Wurzel-Tags
    return this.payload(10) as { [key: string]: Nbt };
  }

  private string(): string {
    const length = this.buf.readUInt16BE(this.offset);
    this.offset += 2;
    const value = this.buf.toString('utf8', this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  private payload(type: number): Nbt {
    const b = this.buf;
    switch (type) {
      case 1: return b.readInt8(this.offset++);
      case 2: { const v = b.readInt16BE(this.offset); this.offset += 2; return v; }
      case 3: { const v = b.readInt32BE(this.offset); this.offset += 4; return v; }
      case 4: { const v = b.readBigInt64BE(this.offset); this.offset += 8; return v; }
      case 5: { const v = b.readFloatBE(this.offset); this.offset += 4; return v; }
      case 6: { const v = b.readDoubleBE(this.offset); this.offset += 8; return v; }
      case 7: {
        const length = b.readInt32BE(this.offset);
        this.offset += 4;
        const v = b.subarray(this.offset, this.offset + length);
        this.offset += length;
        return v;
      }
      case 8: return this.string();
      case 9: {
        const itemType = b.readUInt8(this.offset++);
        const length = b.readInt32BE(this.offset);
        this.offset += 4;
        const list: Nbt[] = [];
        for (let i = 0; i < length; i++) list.push(this.payload(itemType));
        return list;
      }
      case 10: {
        const compound: { [key: string]: Nbt } = {};
        for (;;) {
          const tag = b.readUInt8(this.offset++);
          if (tag === 0) return compound;
          const name = this.string();
          compound[name] = this.payload(tag);
        }
      }
      case 11: {
        const length = b.readInt32BE(this.offset);
        this.offset += 4 + length * 4;
        return new Int32Array(0);
      }
      case 12: {
        const length = b.readInt32BE(this.offset);
        this.offset += 4 + length * 8;
        return new BigInt64Array(0);
      }
      default:
        throw new Error(`Unbekannter NBT-Typ ${type}`);
    }
  }
}

export function readNbt(buffer: Buffer): { [key: string]: Nbt } {
  const data = buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer) : buffer;
  return new NbtReader(data).root();
}

// ---------- Welten und Server ----------

async function pngDataUrl(file: string): Promise<string | null> {
  try {
    const info = await stat(file);
    if (info.size > 128 * 1024) return null;
    return `data:image/png;base64,${(await readFile(file)).toString('base64')}`;
  } catch {
    return null;
  }
}

async function listWorlds(gameDir: string): Promise<QuickPlayTarget[]> {
  const savesDir = path.join(gameDir, 'saves');
  let folders: string[];
  try {
    folders = (await readdir(savesDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  const worlds: QuickPlayTarget[] = [];
  for (const folder of folders) {
    const levelFile = path.join(savesDir, folder, 'level.dat');
    let info;
    try {
      info = await stat(levelFile);
    } catch {
      continue; // kein level.dat = keine Welt
    }
    let name = folder;
    let lastPlayed: number | null = info.mtimeMs;
    try {
      const data = readNbt(await readFile(levelFile)).Data as { [key: string]: Nbt } | undefined;
      if (typeof data?.LevelName === 'string' && data.LevelName.trim()) name = data.LevelName;
      if (typeof data?.LastPlayed === 'bigint') lastPlayed = Number(data.LastPlayed);
    } catch {
      // beschädigte oder neue Datei: Ordnername und Änderungsdatum reichen
    }
    worlds.push({ kind: 'world', id: folder, name, address: null, lastPlayed, icon: await pngDataUrl(path.join(savesDir, folder, 'icon.png')) });
  }
  return worlds.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
}

async function listServers(gameDir: string): Promise<QuickPlayTarget[]> {
  try {
    const root = readNbt(await readFile(path.join(gameDir, 'servers.dat')));
    const servers = Array.isArray(root.servers) ? (root.servers as { [key: string]: Nbt }[]) : [];
    return servers
      .filter((s) => typeof s.ip === 'string' && s.ip.trim())
      .map((s) => ({
        kind: 'server' as const,
        id: (s.ip as string).trim(),
        name: typeof s.name === 'string' && s.name.trim() ? s.name : (s.ip as string),
        address: (s.ip as string).trim(),
        lastPlayed: null,
        icon: typeof s.icon === 'string' && s.icon.length < 200_000 ? `data:image/png;base64,${s.icon}` : null,
      }));
  } catch {
    return [];
  }
}

/** Unterstützt die installierte Version Quick Play? (steht in ihrer Versions-JSON) */
async function supportsQuickPlay(versionsDir: string, minecraft: string): Promise<boolean> {
  try {
    const json = await readFile(path.join(versionsDir, minecraft, `${minecraft}.json`), 'utf8');
    return json.includes('is_quick_play_singleplayer');
  } catch {
    return false;
  }
}

export async function listQuickPlay(gameDir: string, versionsDir: string, minecraft: string): Promise<QuickPlayList> {
  const [supported, worlds, servers] = await Promise.all([
    supportsQuickPlay(versionsDir, minecraft),
    listWorlds(gameDir),
    listServers(gameDir),
  ]);
  return { supported, targets: [...worlds.slice(0, 4), ...servers.slice(0, 3)] };
}

/** Prüft ein Ziel aus der Oberfläche, bevor es an Minecraft geht. */
export async function validateQuickPlay(gameDir: string, kind: unknown, id: unknown): Promise<{ singleplayer?: string; multiplayer?: string }> {
  if (typeof id !== 'string' || !id || id.length > 255) throw new Error('Ungültiges Ziel für den Direktstart.');
  if (kind === 'world') {
    if (path.basename(id) !== id || id === '.' || id === '..') throw new Error('Ungültiger Weltname.');
    await stat(path.join(gameDir, 'saves', id, 'level.dat')).catch(() => {
      throw new Error(`Die Welt „${id}“ gibt es in dieser Instanz nicht mehr.`);
    });
    return { singleplayer: id };
  }
  if (kind === 'server') {
    if (!/^[^\s/\\]+$/.test(id)) throw new Error('Ungültige Serveradresse.');
    return { multiplayer: id };
  }
  throw new Error('Unbekanntes Ziel für den Direktstart.');
}
