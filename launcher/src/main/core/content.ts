import AdmZip from 'adm-zip';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AddonAccess, ContentFormat, ContentImportResult, ContentItem, ContentKind, InstanceLoader } from '../../shared/api';
import { satisfies } from './fabricmods';
import { readJson, writeJson } from './fsutil';

/** Ordner der Heldix-Addons in einer Instanz */
export const ADDON_DIR = 'heldix-addons';
export const MANAGED_LIST = '.heldix-managed.json';
export const MODRINTH_INDEX = '.heldix-modrinth.json';

export interface ModrinthIndexEntry {
  projectId: string;
  versionId: string;
  title: string;
  /** Update auf diese Version passte nicht zu den übrigen Mods – nicht mehr anbieten, solange heldBecause (Datei) da ist */
  heldUpdate?: string;
  heldBecause?: string;
}

export type ModrinthIndex = Record<string, ModrinthIndexEntry>;

/** Was der Launcher über die Instanz wissen muss, um Mods und Addons zu prüfen */
export interface ContentContext {
  loader: InstanceLoader;
  /** Minecraft-Version der Instanz (fehlt = nicht prüfen) */
  minecraft?: string;
  /** HeldixClient läuft in der Instanz (fehlt = nicht prüfen) */
  heldixClient?: boolean;
  /** Version des Heldix Loaders, mit dem die Instanz startet (heldix-loader bzw. heldix-loader-fabric); null = nicht prüfen */
  loaderVersion?: string | null;
}

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

// ---------- heldix.addon.json (Version 2) ----------

/** Felder einer heldix.addon.json, die über den Zugriff entscheiden */
export interface AddonDescriptor {
  /** HeldixAddon (Heldix-API) */
  entrypoint: string | null;
  /** HeldixModInitializer (Heldix-Loader-API), läuft beim Spielstart */
  clientEntrypoint: string | null;
  /** ClassTransformer (Heldix-Loader-API) */
  transformers: string[];
  /** Minecraft-Versionen (leer = jede; Pflicht bei Zugriff minecraft) */
  minecraft: string[];
  /** Mindestversion des Heldix Loaders, z. B. ">=2.4.0" */
  loader: string | null;
  /** abgeleitet: minecraft, sobald clientEntrypoint oder transformers da sind, sonst api */
  access: AddonAccess;
}

function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error(`„${field}“ ist ungültig`);
  return value.trim();
}

function textList(value: unknown, field: string, max: number): string[] {
  if (value === undefined || value === null) return [];
  const list = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(list) || list.length > max || list.some((v) => typeof v !== 'string' || !v.trim() || v.length > 200)) throw new Error(`„${field}“ ist ungültig`);
  return [...new Set(list.map((v: string) => v.trim()))];
}

/**
 * Liest die Felder von heldix.addon.json (Version 2, abwärtskompatibel): entrypoint, clientEntrypoint, transformers,
 * minecraft, loader. Wirft mit deutscher Meldung, wenn das Addon so nicht laufen kann.
 */
export function parseAddonDescriptor(json: Record<string, unknown>): AddonDescriptor {
  const entrypoint = optionalText(json.entrypoint, 'entrypoint');
  const clientEntrypoint = optionalText(json.clientEntrypoint, 'clientEntrypoint');
  const transformers = textList(json.transformers, 'transformers', 50);
  const minecraft = textList(json.minecraft, 'minecraft', 50);
  const loader = optionalText(json.loader, 'loader');
  if (!entrypoint && !clientEntrypoint && transformers.length === 0) throw new Error('Kein Einstiegspunkt (entrypoint, clientEntrypoint oder transformers fehlt)');
  const access: AddonAccess = clientEntrypoint || transformers.length > 0 ? 'minecraft' : 'api';
  if (access === 'minecraft' && minecraft.length === 0) throw new Error('Greift in Minecraft ein, nennt aber keine Minecraft-Version („minecraft“ fehlt)');
  return { entrypoint, clientEntrypoint, transformers, minecraft, loader, access };
}

// ---------- Minecraft- und Loader-Versionen ----------

/**
 * Passt die Minecraft-Version zu einem Eintrag aus „minecraft“? Genaue Version (26.3 passt nur zu 26.3) oder eine Regel wie
 * im Heldix Loader: *, 26.x, >=26.2, „>=26.1 <26.4“ oder „26.2 || 26.3“.
 */
export function minecraftMatches(version: string, entry: string): boolean {
  const rule = entry.trim();
  if (rule === '*' || rule === version) return true;
  if (!/[xX*<>=~^|\s]/.test(rule)) return false;
  return rule.split('||').map((alt) => alt.trim()).some((alt) => alt !== '' && satisfies(version, alt));
}

/** Läuft es in dieser Minecraft-Version? Leere Liste = jede Version. */
export function fitsMinecraft(version: string, list: readonly string[]): boolean {
  return list.length === 0 || list.some((entry) => minecraftMatches(version, entry));
}

/** „26.3“, „26.2 und 26.3“, „1.21.11, 26.2 und 26.3“, ab fünf: „26.0, 26.1, 26.2 und 3 weitere“ */
export function versionList(list: readonly string[]): string {
  if (list.length > 4) return `${list.slice(0, 3).join(', ')} und ${list.length - 3} weitere`;
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} und ${list.at(-1)}` : (list[0] ?? '');
}

/** Grund, wenn die Minecraft-Version nicht passt: „Nur für Minecraft 26.3“ */
export function minecraftReason(list: readonly string[]): string {
  return `Nur für Minecraft ${versionList(list)}`;
}

/** Braucht das Addon einen neueren Heldix Loader, als die Instanz bekommt? */
export function loaderReason(rule: string | null, loaderVersion: string | null | undefined): string | null {
  if (!rule || !loaderVersion) return null;
  if (rule.split('||').map((alt) => alt.trim()).some((alt) => alt === '' || satisfies(loaderVersion, alt))) return null;
  const min = /^>=\s*(\d[\w.+-]*)$/.exec(rule.trim());
  return min ? `Braucht Heldix Loader ${min[1]} oder neuer` : `Braucht einen anderen Heldix Loader (${rule.trim()})`;
}

// ---------- JARs lesen ----------

type Format = 'heldix' | 'fabric' | 'addon';
const DESCRIPTOR: Record<Format, string> = { addon: 'heldix.addon.json', heldix: 'heldix.mod.json', fabric: 'fabric.mod.json' };

interface ParsedMeta {
  id: string | null;
  name: string | null;
  version: string | null;
  description: string;
  authors: string[];
  icon: string | null;
  error: string | null;
  /** Welches Format die JAR hat */
  format: Format | null;
  /** Heldix-Mod, die zusätzlich eine fabric.mod.json hat (läuft auch in Fabric, z. B. HeldixClient) */
  fabricToo: boolean;
  /** Heldix-Addon bzw. Heldix-Mod: Zugriff, Minecraft-Versionen, Loader-Regel */
  access: AddonAccess | null;
  minecraft: string[];
  loaderRule: string | null;
  /** Forge/NeoForge/Quilt erkannt (nur für eine bessere Meldung) */
  foreign: 'forge' | 'quilt' | null;
}

const EMPTY: ParsedMeta = {
  id: null, name: null, version: null, description: '', authors: [], icon: null, error: null, format: null, fabricToo: false,
  access: null, minecraft: [], loaderRule: null, foreign: null,
};

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

// Manche Mods haben Zeilenumbrüche in Strings – die stören JSON.parse
const readJsonEntry = (entry: AdmZip.IZipEntry) => JSON.parse(entry.getData().toString('utf8').replace(/\r?\n/g, ' ')) as Record<string, unknown>;

/** Liest die Beschreibung einer JAR; order = welche Datei zuerst zählt. */
function inspectJar(file: string, order: Format[]): ParsedMeta {
  try {
    const zip = new AdmZip(file);
    const found = order.map((format) => ({ entry: zip.getEntry(DESCRIPTOR[format]), format })).find((c) => c.entry);
    if (!found?.entry) {
      const foreign = zip.getEntry('META-INF/mods.toml') || zip.getEntry('META-INF/neoforge.mods.toml') ? 'forge' : zip.getEntry('quilt.mod.json') ? 'quilt' : null;
      return { ...EMPTY, foreign, error: 'missing' };
    }
    const json = readJsonEntry(found.entry);
    const fabricEntry = found.format === 'heldix' ? zip.getEntry('fabric.mod.json') : null;
    const fabricJson = fabricEntry ? readJsonEntry(fabricEntry) : null;
    let icon: string | null = null;
    const iconFile = found.format === 'fabric' ? iconPath(json.icon) : fabricJson ? iconPath(fabricJson.icon) : null;
    if (iconFile) {
      const iconEntry = zip.getEntry(iconFile.replace(/^\//, ''));
      if (iconEntry && iconEntry.header.size < 256 * 1024) icon = `data:image/png;base64,${iconEntry.getData().toString('base64')}`;
    }
    const meta: ParsedMeta = {
      ...EMPTY,
      id: typeof json.id === 'string' ? json.id : null,
      name: typeof json.name === 'string' ? json.name : null,
      version: typeof json.version === 'string' ? json.version : null,
      description: typeof json.description === 'string' ? json.description : '',
      authors: authorsOf(json.authors),
      icon,
      format: found.format,
      fabricToo: fabricEntry != null,
    };
    if (found.format === 'addon') {
      try {
        const descriptor = parseAddonDescriptor(json);
        meta.access = descriptor.access;
        meta.minecraft = descriptor.minecraft;
        meta.loaderRule = descriptor.loader;
      } catch (error) {
        meta.error = `Ungültiges Addon: ${error instanceof Error ? error.message : error}`;
      }
    } else if (found.format === 'heldix') {
      // ältere Heldix-Mod: läuft mit dem Heldix Loader und greift damit immer in Minecraft ein
      meta.access = 'minecraft';
      meta.minecraft = typeof json.minecraft === 'string' && json.minecraft.trim() && json.minecraft.trim() !== '*'
        ? json.minecraft.split('||').map((v) => v.trim()).filter(Boolean)
        : [];
      meta.loaderRule = typeof json.loader === 'string' && json.loader.trim() ? json.loader.trim() : null;
    }
    return meta;
  } catch (error) {
    return { ...EMPTY, error: `Datei nicht lesbar: ${error instanceof Error ? error.message : error}` };
  }
}

/** Listen: in mods/ zählen heldix.mod.json und fabric.mod.json (ein Addon dort gehört woandershin), in heldix-addons/ heldix.addon.json */
function parseJar(file: string, kind: ContentKind): ParsedMeta {
  const meta = inspectJar(file, kind === 'mods' ? ['heldix', 'fabric', 'addon'] : ['addon']);
  if (meta.error === 'missing') return { ...meta, error: kind === 'mods' ? 'Keine Mod (heldix.mod.json oder fabric.mod.json fehlt)' : 'Kein Heldix-Addon (heldix.addon.json fehlt)' };
  if (kind === 'mods' && meta.format === 'addon') return { ...meta, error: 'Heldix-Addon im Ordner mods – hier löschen und über „Datei hinzufügen“ neu hinzufügen' };
  return meta;
}

async function readMeta(file: string, kind: ContentKind): Promise<ParsedMeta> {
  const info = await stat(file);
  const key = `${kind}:${info.size}:${info.mtimeMs}`;
  const cached = metaCache.get(file);
  if (cached && cached.key === key) return cached.meta;
  const meta = parseJar(file, kind);
  metaCache.set(file, { key, meta });
  return meta;
}

const FORMAT: Record<Format, ContentFormat> = { addon: 'addon', heldix: 'heldix-mod', fabric: 'fabric' };

/** Passt die Datei zur Instanz? Heldix-Instanzen laden keine Fabric-Mods, Fabric-Instanzen nur Heldix-Mods mit fabric.mod.json. */
function compatibility(meta: ParsedMeta, context: ContentContext, managed: boolean): string | null {
  if (meta.error) return meta.error;
  const { loader } = context;
  if (meta.format === 'addon') {
    if (context.heldixClient === false) return 'HeldixClient ist in dieser Instanz aus – Addons laufen nur mit HeldixClient';
    if (context.minecraft && !fitsMinecraft(context.minecraft, meta.minecraft)) return minecraftReason(meta.minecraft);
    return loaderReason(meta.loaderRule, context.loaderVersion);
  }
  if (loader === 'heldix' && meta.format === 'fabric') {
    // Vom Launcher verwaltete Dateien aus der Zeit, als Heldix-Instanzen noch Fabric nutzten
    if (managed) return 'Alte Fabric-Version – wird beim nächsten Start automatisch entfernt bzw. ersetzt';
    return 'Fabric-Mod – läuft nicht mit dem Heldix Loader, nur in Fabric-Instanzen';
  }
  if (meta.format === 'heldix' && !managed) {
    if (loader === 'fabric' && !meta.fabricToo) return 'Ältere Heldix-Mod ohne Fabric-Unterstützung – läuft nur in Heldix-Instanzen';
    if (context.minecraft && !fitsMinecraft(context.minecraft, meta.minecraft)) return minecraftReason(meta.minecraft);
    return loaderReason(meta.loaderRule, context.loaderVersion);
  }
  return null;
}

/**
 * Im Spiel ausgeschaltete Addons, deren JAR Windows gerade sperrt: das Spiel trägt sie in heldix-addons/.ausschalten ein
 * (eine Datei „x.jar“ pro Zeile); umbenannt wird beim nächsten Mal, wenn die Instanz nicht läuft.
 */
const PENDING_DISABLE = '.ausschalten';

export async function readPendingDisable(gameDir: string): Promise<Set<string>> {
  try {
    const list = await readFile(path.join(contentDir(gameDir, 'addons'), PENDING_DISABLE), 'utf8');
    return new Set(list.split(/\r?\n/).map((line) => line.trim()).filter((name) => name && path.basename(name) === name && name.endsWith('.jar')));
  } catch {
    return new Set();
  }
}

async function writePendingDisable(gameDir: string, names: Set<string>): Promise<void> {
  const file = path.join(contentDir(gameDir, 'addons'), PENDING_DISABLE);
  if (names.size) await writeFile(file, `${[...names].join('\n')}\n`);
  else await rm(file, { force: true });
}

/** Vorgemerktes Ausschalten ausführen: x.jar → x.jar.disabled, dann die Liste löschen (nur, wenn die Instanz nicht läuft). */
export async function applyPendingDisable(gameDir: string): Promise<void> {
  const names = await readPendingDisable(gameDir);
  if (!names.size) return;
  const dir = contentDir(gameDir, 'addons');
  for (const name of names) {
    const from = path.join(dir, name);
    if (!(await stat(from).catch(() => null))) continue;
    await rm(`${from}.disabled`, { force: true });
    await rename(from, `${from}.disabled`).catch(() => undefined);
  }
  await rm(path.join(dir, PENDING_DISABLE), { force: true });
}

/** Inhalt eines Ordners (mods/ oder heldix-addons/). context ergänzt die Prüfung um Minecraft-Version, HeldixClient und Loader. */
export async function listContent(gameDir: string, kind: ContentKind, loader: InstanceLoader, context: Omit<ContentContext, 'loader'> = {}): Promise<ContentItem[]> {
  const dir = contentDir(gameDir, kind);
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => /\.jar(\.disabled)?$/.test(f));
  } catch {
    return [];
  }
  const managed = new Set(kind === 'mods' ? ((await readJson<string[]>(path.join(dir, MANAGED_LIST))) ?? []) : []);
  const index = kind === 'mods' ? ((await readJson<ModrinthIndex>(path.join(dir, MODRINTH_INDEX))) ?? {}) : {};
  const ctx: ContentContext = { ...context, loader };
  // im Spiel ausgeschaltet, Datei noch gesperrt: gilt schon als aus
  const pendingOff = kind === 'addons' ? await readPendingDisable(gameDir) : new Set<string>();

  const items: ContentItem[] = [];
  for (const file of files) {
    const meta = await readMeta(path.join(dir, file), kind);
    const baseName = file.replace(/\.disabled$/, '');
    items.push({
      file,
      enabled: !file.endsWith('.disabled') && !pendingOff.has(file),
      managed: managed.has(file),
      id: meta.id,
      name: meta.name ?? baseName.replace(/\.jar$/, ''),
      version: meta.version,
      description: meta.description,
      authors: meta.authors,
      icon: meta.icon,
      projectId: index[baseName]?.projectId ?? null,
      error: compatibility(meta, ctx, managed.has(file)),
      kind,
      format: meta.format ? FORMAT[meta.format] : null,
      access: meta.access,
      minecraft: meta.minecraft,
    });
  }
  return items.sort((a, b) => Number(b.managed) - Number(a.managed) || a.name.localeCompare(b.name, 'de'));
}

/** „Mods & Addons“: mods/ und heldix-addons/ zusammen (Vanilla: nichts). Verwaltete zuerst, dann nach Name. */
export async function listAllContent(gameDir: string, context: ContentContext): Promise<ContentItem[]> {
  if (context.loader === 'vanilla') return [];
  const { loader, ...rest } = context;
  const [mods, addons] = await Promise.all([listContent(gameDir, 'mods', loader, rest), listContent(gameDir, 'addons', loader, rest)]);
  return [...mods, ...addons].sort((a, b) => Number(b.managed) - Number(a.managed) || a.name.localeCompare(b.name, 'de'));
}

export async function setContentEnabled(gameDir: string, kind: ContentKind, file: string, enabled: boolean): Promise<void> {
  const dir = contentDir(gameDir, kind);
  assertContentFile(file);
  const managed = new Set((await readJson<string[]>(path.join(dir, MANAGED_LIST))) ?? []);
  if (managed.has(file)) throw new Error('Diese Mod wird vom Launcher verwaltet und kann nicht abgeschaltet werden.');
  if (kind === 'addons') {
    const pendingOff = await readPendingDisable(gameDir);
    if (pendingOff.has(file)) {
      // im Spiel ausgeschaltet, aber noch nicht umbenannt: gilt schon als aus; wieder an = Vormerkung streichen
      if (enabled) {
        pendingOff.delete(file);
        await writePendingDisable(gameDir, pendingOff);
      }
      return;
    }
  }
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
  if (kind === 'mods') await dropFromModrinthIndex(dir, file);
}

async function dropFromModrinthIndex(modsDir: string, file: string): Promise<void> {
  const indexFile = path.join(modsDir, MODRINTH_INDEX);
  const index = (await readJson<ModrinthIndex>(indexFile)) ?? {};
  const key = file.replace(/\.disabled$/, '');
  if (!(key in index)) return;
  delete index[key];
  await writeJson(indexFile, index);
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

// ---------- „Datei hinzufügen“: JARs anhand ihrer Beschreibung einsortieren ----------

export type JarRoute = { kind: ContentKind; format: ContentFormat; id: string | null; name: string } | { error: string };

/**
 * Wohin gehört diese JAR? heldix.addon.json → heldix-addons/, heldix.mod.json bzw. fabric.mod.json → mods/.
 * Passt sie nicht zur Instanz (oder ist sie gar keine Mod), steht der Grund auf Deutsch in error.
 */
export function routeJar(file: string, context: ContentContext): JarRoute {
  const base = path.basename(file);
  if (!/\.jar$/i.test(base)) return { error: `„${base}“ ist keine JAR-Datei.` };
  if (context.loader === 'vanilla') return { error: 'Vanilla-Instanzen haben keine Mods und Addons.' };
  const meta = inspectJar(file, ['addon', 'heldix', 'fabric']);
  if (meta.error === 'missing') {
    if (meta.foreign === 'forge') return { error: `„${base}“ ist eine Forge- oder NeoForge-Mod – hier laufen nur Fabric-Mods und Heldix-Addons.` };
    if (meta.foreign === 'quilt') return { error: `„${base}“ ist eine Quilt-Mod – hier laufen nur Fabric-Mods und Heldix-Addons.` };
    return { error: `„${base}“ ist weder Fabric-Mod noch Heldix-Addon (keine fabric.mod.json, heldix.mod.json oder heldix.addon.json).` };
  }
  if (!meta.format) return { error: `„${base}“ ist keine gültige JAR-Datei.` };
  const name = meta.name ?? meta.id ?? base.replace(/\.jar$/i, '');
  const misfit = (reason: string) => ({ error: `„${name}“ passt nicht zu dieser Instanz: ${reason}.` });
  if (meta.format === 'addon') {
    if (meta.error) return { error: `„${name}“: ${meta.error}.` };
    if (context.heldixClient === false) return { error: `„${name}“ ist ein Heldix-Addon und braucht HeldixClient – schalte HeldixClient unter Einstellungen dieser Instanz ein.` };
    if (context.minecraft && !fitsMinecraft(context.minecraft, meta.minecraft)) return misfit(minecraftReason(meta.minecraft));
    const loader = loaderReason(meta.loaderRule, context.loaderVersion);
    if (loader) return misfit(loader);
    return { kind: 'addons', format: 'addon', id: meta.id, name };
  }
  if (meta.format === 'heldix') {
    if (context.loader === 'fabric' && !meta.fabricToo) return { error: `„${name}“ ist eine ältere Heldix-Mod und läuft nur in Heldix-Instanzen.` };
    if (context.minecraft && !fitsMinecraft(context.minecraft, meta.minecraft)) return misfit(minecraftReason(meta.minecraft));
    const loader = loaderReason(meta.loaderRule, context.loaderVersion);
    if (loader) return misfit(loader);
    return { kind: 'mods', format: 'heldix-mod', id: meta.id, name };
  }
  if (context.loader === 'heldix') return { error: `„${name}“ ist eine Fabric-Mod und läuft nur in Fabric-Instanzen, nicht mit dem Heldix Loader.` };
  return { kind: 'mods', format: 'fabric', id: meta.id, name };
}

/**
 * Kopiert JARs in den passenden Ordner der Instanz. Ältere Dateien mit derselben ID (auch ausgeschaltete) werden ersetzt;
 * was der Launcher selbst verwaltet (Fabric API, HeldixClient), wird nicht noch einmal hinzugefügt.
 */
export async function importContentFiles(gameDir: string, context: ContentContext, files: string[]): Promise<ContentImportResult> {
  const result: ContentImportResult = { added: [], errors: [] };
  for (const source of files) {
    if (typeof source !== 'string' || !source) continue;
    const route = routeJar(source, context);
    if ('error' in route) {
      result.errors.push(route.error);
      continue;
    }
    const dir = contentDir(gameDir, route.kind);
    await mkdir(dir, { recursive: true });
    const name = path.basename(source).replace(/\.jar$/i, '.jar');
    const present = route.id ? (await listContent(gameDir, route.kind, context.loader)).filter((item) => item.id === route.id) : [];
    const managed = present.find((item) => item.managed);
    if (managed) {
      result.errors.push(`„${route.name}“ bringt der Launcher schon selbst mit (${managed.name}).`);
      continue;
    }
    const target = path.join(dir, name);
    try {
      if (path.resolve(source).toLowerCase() !== path.resolve(target).toLowerCase()) await copyFile(source, target);
    } catch (error) {
      result.errors.push(`„${route.name}“ konnte nicht kopiert werden: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    // ältere Versionen derselben Mod bzw. desselben Addons weg (doppelte IDs mag weder Fabric noch der Heldix Loader)
    for (const item of present) {
      if (item.file === name) continue;
      await rm(path.join(dir, item.file), { force: true });
      if (route.kind === 'mods') await dropFromModrinthIndex(dir, item.file);
    }
    await rm(`${target}.disabled`, { force: true });
    // eine von Hand hinzugefügte Datei ist keine Modrinth-Installation mehr
    if (route.kind === 'mods') await dropFromModrinthIndex(dir, name);
    result.added.push({ file: name, name: route.name, kind: route.kind, format: route.format });
  }
  return result;
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

/** Liest die heldix.addon.json einer Addon-JAR (für den Addon-Store): ID, Version, Zugriff und Minecraft-Versionen. */
export async function readAddonMeta(file: string): Promise<{ id: string | null; name: string | null; version: string | null; error: string | null; access: AddonAccess | null; minecraft: string[] }> {
  const meta = parseJar(file, 'addons');
  return { id: meta.id, name: meta.name, version: meta.version, error: meta.error, access: meta.access, minecraft: meta.minecraft };
}

export async function countEnabled(gameDir: string, kind: ContentKind): Promise<number> {
  try {
    return (await readdir(contentDir(gameDir, kind))).filter((f) => f.endsWith('.jar')).length;
  } catch {
    return 0;
  }
}
