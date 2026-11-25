import AdmZip from 'adm-zip';
import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ContentItem, ContentKind, InstanceLoader } from '../../shared/api';
import { readJson, writeJson } from './fsutil';

/** Ordner der Heldix-Addons in einer Instanz */
export const ADDON_DIR = 'heldix-addons';
export const MANAGED_LIST = '.heldix-managed.json';
export const MODRINTH_INDEX = '.heldix-modrinth.json';

export interface ModrinthIndexEntry {
  projectId: string;
  versionId: string;
  title: string;
}

export type ModrinthIndex = Record<string, ModrinthIndexEntry>;

export function contentDir(gameDir: string, kind: ContentKind): string {
  return path.join(gameDir, kind === 'mods' ? 'mods' : ADDON_DIR);
}

/** Dateinamen aus der Oberfläche prüfen: nur ein Name, nur .jar bzw. .jar.disabled. */
function assertContentFile(file: string): string {
  if (typeof file !== 'string' || path.basename(file) !== file || !/\.jar(\.disabled)?$/.test(file)) {
    throw new Error(`Ungültiger Dateiname: ${file}`);
  }
  return file;
}

interface ParsedMeta {
  id: string | null;
  name: string | null;
  version: string | null;
  description: string;
  authors: string[];
  icon: string | null;
  error: string | null;
  /** Welches Format die JAR hat */
  format: 'heldix' | 'fabric' | 'addon' | null;
  /** Heldix-Mod, die zusätzlich eine fabric.mod.json hat (läuft auch in Fabric, z. B. HeldixClient) */
  fabricToo: boolean;
}

const metaCache = new Map<string, { key: string; meta: ParsedMeta }>();

function authorsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((a) => (typeof a === 'string' ? a : a && typeof a === 'object' && 'name' in a ? String((a as { name: unknown }).name) : ''))
    .filter(Boolean);
}

function iconPath(icon: unknown): string | null {
  if (typeof icon === 'string') return icon;
  if (icon && typeof icon === 'object') {
    const sizes = Object.keys(icon as Record<string, string>).map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
    const best = sizes.find((s) => s >= 64) ?? sizes.at(-1);
    return best != null ? (icon as Record<string, string>)[String(best)] : null;
  }
  return null;
}

function parseJar(file: string, kind: ContentKind): ParsedMeta {
  const empty: ParsedMeta = { id: null, name: null, version: null, description: '', authors: [], icon: null, error: null, format: null, fabricToo: false };
  try {
    const zip = new AdmZip(file);
    // Mods: Heldix-Mod (heldix.mod.json) oder Fabric-Mod (fabric.mod.json); Addons: heldix.addon.json
    const candidates: [string, ParsedMeta['format']][] =
      kind === 'mods' ? [['heldix.mod.json', 'heldix'], ['fabric.mod.json', 'fabric']] : [['heldix.addon.json', 'addon']];
    const found = candidates.map(([name, format]) => ({ entry: zip.getEntry(name), format })).find((c) => c.entry);
    if (!found?.entry) return { ...empty, error: kind === 'mods' ? 'Keine Mod (heldix.mod.json oder fabric.mod.json fehlt)' : 'Kein Heldix-Addon (heldix.addon.json fehlt)' };
    const entry = found.entry;
    // Manche Mods haben Zeilenumbrüche in Strings – die stören JSON.parse
    const json = JSON.parse(entry.getData().toString('utf8').replace(/\r?\n/g, ' ')) as Record<string, unknown>;
    let icon: string | null = null;
    const fabricEntry = found.format === 'heldix' ? zip.getEntry('fabric.mod.json') : null;
    const fabricJson = fabricEntry ? (JSON.parse(fabricEntry.getData().toString('utf8').replace(/\r?\n/g, ' ')) as Record<string, unknown>) : null;
    const iconFile = found.format === 'fabric' ? iconPath(json.icon) : fabricJson ? iconPath(fabricJson.icon) : null;
    if (iconFile) {
      const iconEntry = zip.getEntry(iconFile.replace(/^\//, ''));
      if (iconEntry && iconEntry.header.size < 256 * 1024) {
        icon = `data:image/png;base64,${iconEntry.getData().toString('base64')}`;
      }
    }
    return {
      id: typeof json.id === 'string' ? json.id : null,
      name: typeof json.name === 'string' ? json.name : null,
      version: typeof json.version === 'string' ? json.version : null,
      description: typeof json.description === 'string' ? json.description : '',
      authors: authorsOf(json.authors),
      icon,
      error: null,
      format: found.format,
      fabricToo: fabricEntry != null,
    };
  } catch (error) {
    return { ...empty, error: `Datei nicht lesbar: ${error instanceof Error ? error.message : error}` };
  }
}

async function readMeta(file: string, kind: ContentKind): Promise<ParsedMeta> {
  const info = await stat(file);
  const key = `${info.size}:${info.mtimeMs}`;
  const cached = metaCache.get(file);
  if (cached && cached.key === key) return cached.meta;
  const meta = parseJar(file, kind);
  metaCache.set(file, { key, meta });
  return meta;
}

/** Passt die Mod zur Instanz? Heldix-Instanzen laden nur Heldix-Mods, Fabric-Instanzen nur Fabric-Mods. */
function compatibility(meta: ParsedMeta, loader: InstanceLoader, managed: boolean): string | null {
  if (meta.error) return meta.error;
  if (loader === 'heldix' && meta.format === 'fabric') {
    // Vom Launcher verwaltete Dateien aus der Zeit, als Heldix-Instanzen noch Fabric nutzten
    if (managed) return 'Alte Fabric-Version – wird beim nächsten Start automatisch entfernt bzw. ersetzt';
    return 'Fabric-Mod – läuft nicht mit dem Heldix Loader, nur in Fabric-Instanzen';
  }
  if (loader === 'fabric' && meta.format === 'heldix' && !meta.fabricToo) return 'Heldix-Mod ohne Fabric-Unterstützung – läuft nur in Heldix-Instanzen';
  return null;
}

export async function listContent(gameDir: string, kind: ContentKind, loader: InstanceLoader): Promise<ContentItem[]> {
  const dir = contentDir(gameDir, kind);
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => /\.jar(\.disabled)?$/.test(f));
  } catch {
    return [];
  }
  const managed = new Set(kind === 'mods' ? ((await readJson<string[]>(path.join(dir, MANAGED_LIST))) ?? []) : []);
  const index = kind === 'mods' ? ((await readJson<ModrinthIndex>(path.join(dir, MODRINTH_INDEX))) ?? {}) : {};

  const items: ContentItem[] = [];
  for (const file of files) {
    const meta = await readMeta(path.join(dir, file), kind);
    const baseName = file.replace(/\.disabled$/, '');
    items.push({
      file,
      enabled: !file.endsWith('.disabled'),
      managed: managed.has(file),
      id: meta.id,
      name: meta.name ?? baseName.replace(/\.jar$/, ''),
      version: meta.version,
      description: meta.description,
      authors: meta.authors,
      icon: meta.icon,
      projectId: index[baseName]?.projectId ?? null,
      error: compatibility(meta, loader, managed.has(file)),
    });
  }
  return items.sort((a, b) => Number(b.managed) - Number(a.managed) || a.name.localeCompare(b.name, 'de'));
}

export async function setContentEnabled(gameDir: string, kind: ContentKind, file: string, enabled: boolean): Promise<void> {
  const dir = contentDir(gameDir, kind);
  assertContentFile(file);
  const managed = new Set((await readJson<string[]>(path.join(dir, MANAGED_LIST))) ?? []);
  if (managed.has(file)) throw new Error('Diese Mod wird vom Launcher verwaltet und kann nicht abgeschaltet werden.');
  const isEnabled = !file.endsWith('.disabled');
  if (isEnabled === enabled) return;
  const target = enabled ? file.replace(/\.disabled$/, '') : `${file}.disabled`;
  await rename(path.join(dir, file), path.join(dir, target));
}

export async function removeContent(gameDir: string, kind: ContentKind, file: string): Promise<void> {
  const dir = contentDir(gameDir, kind);
  assertContentFile(file);
  const managed = new Set((await readJson<string[]>(path.join(dir, MANAGED_LIST))) ?? []);
  if (managed.has(file)) throw new Error('Diese Mod wird vom Launcher verwaltet und kann nicht gelöscht werden.');
  await rm(path.join(dir, file), { force: true });
  if (kind === 'mods') {
    const indexFile = path.join(dir, MODRINTH_INDEX);
    const index = (await readJson<ModrinthIndex>(indexFile)) ?? {};
    delete index[file.replace(/\.disabled$/, '')];
    await writeJson(indexFile, index);
  }
}

/** Kopiert ausgewählte JAR-Dateien in die Instanz. Gibt die Anzahl zurück. */
export async function addContentFiles(gameDir: string, kind: ContentKind, files: string[]): Promise<number> {
  const dir = contentDir(gameDir, kind);
  await mkdir(dir, { recursive: true });
  let count = 0;
  for (const source of files) {
    if (typeof source !== 'string' || !source.toLowerCase().endsWith('.jar')) continue;
    await copyFile(source, path.join(dir, path.basename(source)));
    count++;
  }
  return count;
}

/** Vergleicht Versionen wie "1.2.0" zahlenweise (Rest wird ignoriert). */
export function compareVersions(a: string | null, b: string | null): number {
  const parts = (v: string | null) => (v ?? '').split(/[.+-]/).map((p) => Number.parseInt(p, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Liest die heldix.addon.json einer Addon-JAR (für den Addon-Store). */
export async function readAddonMeta(file: string): Promise<{ id: string | null; name: string | null; version: string | null; error: string | null }> {
  const meta = parseJar(file, 'addons');
  return { id: meta.id, name: meta.name, version: meta.version, error: meta.error };
}

export async function countEnabled(gameDir: string, kind: ContentKind): Promise<number> {
  try {
    return (await readdir(contentDir(gameDir, kind))).filter((f) => f.endsWith('.jar')).length;
  } catch {
    return 0;
  }
}
