// Addon-Store: Heldix-Addons kommen einzeln vom Heldix-Dienst statt mit dem Launcher.
//
// Jede Addon-Version hat ein Manifest, das das Team mit dem Update-Schlüssel signiert (npm run addon -- <id>).
// Signiert sind die Bytes von "heldix-addon\n" + Manifest – so gilt ein Addon-Manifest nie als Launcher-Update.
// Der Launcher prüft Signatur, Größe, SHA-256 und die heldix.addon.json in der JAR, bevor er sie in die Instanz legt.

import { createHash, createPublicKey, verify } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AddonAccess, AddonDetails, ContentItem, InstanceLoader, StoreAddon, StoreListing, StoreOverview } from '../../shared/api';
import { LAUNCHER_NAME, LAUNCHER_VERSION } from '../config';
import { applyPendingDisable, compareVersions, contentDir, fitsMinecraft, listContent, minecraftReason, readAddonMeta } from './content';

export const ADDON_SIGNATURE_PREFIX = 'heldix-addon\n';
/** Höchste Heldix-API-Stufe, die die mitgelieferte HeldixClient-Mod kann (HeldixApi.API_VERSION, geprüft beim Bauen) */
export const HELDIX_ADDON_API = 4;
/** Dateien, die das Spiel beim nächsten Start entfernen soll (gesperrte JARs unter Windows), eine pro Zeile */
export const PENDING_REMOVALS = '.entfernen';
/** Ersatz für eine im Spiel gesperrte JAR gleichen Namens (legt das Spiel an) */
const REPLACEMENT = '.neu';

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const CATEGORIES = ['hud', 'musik', 'chat', 'werkzeuge', 'sonstiges'] as const;
const PLATFORMS = ['windows', 'mac', 'linux'] as const;
const LOADERS = ['heldix', 'fabric'] as const;
const MAX_SIZE = 50 * 1024 * 1024;
/** Minecraft-Version wie 26.3, 1.21.11, 26.3-pre1 oder 25w45a (oder eine Regel wie 26.x) */
const MINECRAFT_RE = /^[0-9A-Za-z][0-9A-Za-z._+*-]{0,31}$/;

export type AddonPlatform = (typeof PLATFORMS)[number];
export type AddonLoader = (typeof LOADERS)[number];

export interface AddonManifest {
  type: 'heldix-addon';
  id: string;
  name: string;
  version: string;
  summary: string;
  description: string;
  authors: string[];
  api: number;
  icon: string;
  category: (typeof CATEGORIES)[number];
  platforms: AddonPlatform[];
  file: string;
  size: number;
  sha256: string;
  date: string;
  notes: string[];
  /** vom HeldixClient-Team (npm run addon); fehlt in alten Manifesten = false */
  official: boolean;
  /** Einreicher eines Community-Addons, null bei offiziellen */
  author: { uuid: string; name: string } | null;
  /** Manifest v2 (aus heldix.addon.json übernommen); alte Manifeste: api */
  access: AddonAccess;
  /** Minecraft-Versionen; leer = jede (nur bei access api) */
  minecraft: string[];
  /** wo es läuft; alte Manifeste: heldix und fabric */
  loaders: AddonLoader[];
}

function text(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new Error(`Addon-Manifest: „${field}“ ist ungültig`);
  return value;
}

/** Prüft die Felder eines Addon-Manifests (gleiche Regeln wie der Heldix-Dienst). */
export function parseAddonManifest(raw: unknown): AddonManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Addon-Manifest ist kein Objekt');
  const m = raw as Record<string, unknown>;
  if (m.type !== 'heldix-addon') throw new Error('Kein Addon-Manifest');
  const id = text(m.id, 'id', 1, 40);
  if (!ID_RE.test(id)) throw new Error('Addon-Manifest: ungültige ID');
  const version = text(m.version, 'version', 1, 64);
  if (!VERSION_RE.test(version)) throw new Error('Addon-Manifest: ungültige Version');
  const authors = Array.isArray(m.authors) ? m.authors : [];
  if (authors.length < 1 || authors.length > 5) throw new Error('Addon-Manifest: „authors“ ist ungültig');
  const notes = m.notes === undefined ? [] : Array.isArray(m.notes) ? m.notes : null;
  if (!notes || notes.length > 20) throw new Error('Addon-Manifest: „notes“ ist ungültig');
  const platforms = Array.isArray(m.platforms) ? m.platforms : null;
  if (!platforms || platforms.some((p) => !PLATFORMS.includes(p as AddonPlatform)) || new Set(platforms).size !== platforms.length) {
    throw new Error('Addon-Manifest: „platforms“ ist ungültig');
  }
  if (!CATEGORIES.includes(m.category as (typeof CATEGORIES)[number])) throw new Error('Addon-Manifest: „category“ ist ungültig');
  if (!Number.isInteger(m.api) || (m.api as number) < 1 || (m.api as number) > 99) throw new Error('Addon-Manifest: „api“ ist ungültig');
  if (!Number.isInteger(m.size) || (m.size as number) < 1 || (m.size as number) > MAX_SIZE) throw new Error('Addon-Manifest: „size“ ist ungültig');
  if (typeof m.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(m.sha256)) throw new Error('Addon-Manifest: „sha256“ ist ungültig');
  if (m.file !== `heldix-addon-${id}-${version}.jar`) throw new Error('Addon-Manifest: Dateiname passt nicht zu ID und Version');
  const icon = typeof m.icon === 'string' && /^[a-z0-9-]{1,30}$/.test(m.icon) ? m.icon : 'addons';
  if (m.official !== undefined && typeof m.official !== 'boolean') throw new Error('Addon-Manifest: „official“ ist ungültig');
  let author: AddonManifest['author'] = null;
  if (m.author !== undefined && m.author !== null) {
    const a = m.author as { uuid?: unknown; name?: unknown };
    if (typeof a !== 'object' || typeof a.uuid !== 'string' || !/^[0-9a-f]{32}$/.test(a.uuid) || typeof a.name !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(a.name)) {
      throw new Error('Addon-Manifest: „author“ ist ungültig');
    }
    author = { uuid: a.uuid, name: a.name };
  }
  // Manifest v2: Zugriff, Minecraft-Versionen und Loader (fehlen in alten Manifesten)
  if (m.access !== undefined && m.access !== 'api' && m.access !== 'minecraft') throw new Error('Addon-Manifest: „access“ ist ungültig');
  const access: AddonAccess = m.access === 'minecraft' ? 'minecraft' : 'api';
  const minecraft = m.minecraft === undefined ? [] : Array.isArray(m.minecraft) ? m.minecraft : null;
  if (!minecraft || minecraft.length > 50 || minecraft.some((v) => typeof v !== 'string' || !MINECRAFT_RE.test(v)) || new Set(minecraft).size !== minecraft.length) {
    throw new Error('Addon-Manifest: „minecraft“ ist ungültig');
  }
  if (access === 'minecraft' && minecraft.length === 0) throw new Error('Addon-Manifest: „minecraft“ fehlt (Pflicht, wenn das Addon in Minecraft eingreift)');
  const loaders = m.loaders === undefined ? (access === 'api' ? [...LOADERS] : ['heldix']) : Array.isArray(m.loaders) ? m.loaders : null;
  if (!loaders || loaders.length === 0 || loaders.some((l) => !LOADERS.includes(l as AddonLoader)) || new Set(loaders).size !== loaders.length) {
    throw new Error('Addon-Manifest: „loaders“ ist ungültig');
  }
  return {
    type: 'heldix-addon',
    id,
    name: text(m.name, 'name', 1, 40),
    version,
    summary: text(m.summary, 'summary', 1, 200),
    description: m.description === undefined ? '' : text(m.description, 'description', 0, 4000),
    authors: authors.map((a) => text(a, 'authors', 1, 40)),
    api: m.api as number,
    icon,
    category: m.category as (typeof CATEGORIES)[number],
    platforms: platforms as AddonPlatform[],
    file: m.file,
    size: m.size as number,
    sha256: m.sha256,
    date: text(m.date, 'date', 1, 40),
    notes: notes.map((n) => text(n, 'notes', 1, 300)),
    official: m.official === true,
    author,
    access,
    minecraft: minecraft as string[],
    loaders: loaders as AddonLoader[],
  };
}

/** Signatur prüfen und das Manifest zurückgeben; wirft bei falscher Signatur oder ungültigem Inhalt. */
export function verifyAddonManifest(manifest: string, signature: string, publicKeyPem: string): AddonManifest {
  if (typeof manifest !== 'string' || typeof signature !== 'string') throw new Error('Addon ohne Signatur');
  let ok = false;
  try {
    ok = verify(null, Buffer.from(ADDON_SIGNATURE_PREFIX + manifest, 'utf8'), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64'));
  } catch {
    ok = false;
  }
  if (!ok) throw new Error('Die Signatur des Addons stimmt nicht');
  return parseAddonManifest(JSON.parse(manifest));
}

export function currentPlatform(): AddonPlatform {
  return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
}

export interface StoreEntry {
  manifest: AddonManifest;
  downloads: number;
  /** Anzeige-Daten vom Dienst (nicht signiert): Bewertung und Screenshots */
  rating: { average: number; count: number };
  screenshots: number;
  /** ändert sich, wenn die Screenshots ersetzt werden (Schlüssel für den Zwischenspeicher) */
  screenshotsVersion: string;
}

const STORE_UNREACHABLE = 'Der Addon-Store ist gerade nicht erreichbar. Bitte später noch einmal versuchen.';

async function request(url: string, accept = 'application/json'): Promise<Response> {
  try {
    return await fetch(url, { headers: { Accept: accept, 'User-Agent': `${LAUNCHER_NAME}/${LAUNCHER_VERSION}` }, signal: AbortSignal.timeout(20_000), redirect: 'error' });
  } catch {
    throw new Error(STORE_UNREACHABLE);
  }
}

function storeBase(serviceUrl: string): string {
  if (!serviceUrl) throw new Error('Kein Heldix-Dienst eingerichtet – der Addon-Store ist aus.');
  return serviceUrl.replace(/\/+$/, '');
}

/** Bewertung vom Dienst prüfen (Durchschnitt 0–5 mit einer Nachkommastelle, Anzahl ≥ 0) */
export function parseRating(raw: unknown): { average: number; count: number } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { average?: unknown; count?: unknown };
  const count = Number.isSafeInteger(r.count) && (r.count as number) > 0 ? (r.count as number) : 0;
  const average = count > 0 && typeof r.average === 'number' && Number.isFinite(r.average) ? Math.round(Math.min(5, Math.max(0, r.average)) * 10) / 10 : 0;
  return { average, count };
}

/** Liste des Stores; Einträge mit ungültiger Signatur fallen heraus. */
export async function fetchStore(serviceUrl: string, publicKey: string | null): Promise<StoreEntry[]> {
  const base = storeBase(serviceUrl);
  if (!publicKey) throw new Error('Dieser Launcher kennt keinen Signatur-Schlüssel – der Addon-Store ist aus.');
  const response = await request(`${base}/v1/addons`);
  if (!response.ok) throw new Error(`Der Addon-Store antwortet nicht richtig (${response.status}).`);
  const data = (await response.json().catch(() => ({}))) as { addons?: unknown };
  const result: StoreEntry[] = [];
  for (const entry of Array.isArray(data.addons) ? data.addons : []) {
    const e = entry as { manifest?: unknown; signature?: unknown; downloads?: unknown; rating?: unknown; screenshots?: unknown; screenshotsVersion?: unknown };
    try {
      const manifest = verifyAddonManifest(String(e.manifest), String(e.signature), publicKey);
      result.push({
        manifest,
        downloads: Number.isFinite(e.downloads) ? Number(e.downloads) : 0,
        rating: parseRating(e.rating),
        screenshots: Number.isInteger(e.screenshots) ? Math.min(4, Math.max(0, e.screenshots as number)) : 0,
        screenshotsVersion: typeof e.screenshotsVersion === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(e.screenshotsVersion) ? e.screenshotsVersion : '',
      });
    } catch (error) {
      console.warn('Addon-Store: Eintrag verworfen –', error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Versionsverlauf eines Addons (GET /v1/addons/<id>), neueste zuerst. Anzeige-Daten, nicht signiert. */
export async function fetchAddonDetails(serviceUrl: string, id: string): Promise<AddonDetails> {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('Ungültige Addon-ID');
  const response = await request(`${storeBase(serviceUrl)}/v1/addons/${encodeURIComponent(id)}`);
  const data = (await response.json().catch(() => ({}))) as { versions?: unknown; error?: unknown };
  if (!response.ok) throw new Error(typeof data.error === 'string' && data.error ? data.error : `Der Addon-Store antwortet nicht richtig (${response.status}).`);
  const versions = (Array.isArray(data.versions) ? (data.versions as Record<string, unknown>[]) : [])
    .filter((v) => v && typeof v.version === 'string' && VERSION_RE.test(v.version))
    .map((v) => ({
      version: String(v.version),
      date: typeof v.date === 'string' ? v.date.slice(0, 40) : '',
      notes: Array.isArray(v.notes) ? v.notes.filter((n): n is string => typeof n === 'string').map((n) => n.slice(0, 300)).slice(0, 20) : [],
    }))
    .sort((a, b) => compareVersions(b.version, a.version));
  return { versions };
}

const MAX_SCREENSHOT = 2 * 1024 * 1024;
const screenshotMemory = new Map<string, string | null>();

function imageType(data: Buffer): 'image/png' | 'image/jpeg' | null {
  if (data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  return null;
}

/**
 * Screenshot 1–4 eines Addons als data:-URL. Zwischengespeichert nach Addon, Nummer und screenshotsVersion
 * (Speicher und cacheDir). Nur PNG und JPEG bis 2 MiB; sonst null.
 */
export async function fetchAddonScreenshot(serviceUrl: string, id: string, index: number, version: string, cacheDir: string | null): Promise<string | null> {
  if (typeof id !== 'string' || !ID_RE.test(id) || !Number.isInteger(index) || index < 1 || index > 4) return null;
  const safeVersion = /^[A-Za-z0-9_-]{1,64}$/.test(version) ? version : 'x';
  const key = `${id}.${index}.${safeVersion}`;
  if (screenshotMemory.has(key)) return screenshotMemory.get(key)!;
  const remember = (value: string | null) => {
    screenshotMemory.set(key, value);
    while (screenshotMemory.size > 64) screenshotMemory.delete(screenshotMemory.keys().next().value!);
    return value;
  };
  const toUrl = (data: Buffer) => {
    const type = imageType(data);
    return type ? `data:${type};base64,${data.toString('base64')}` : null;
  };
  const file = cacheDir ? path.join(cacheDir, `${key}.img`) : null;
  if (file) {
    const cached = await readFile(file).catch(() => null);
    if (cached && cached.length <= MAX_SCREENSHOT && imageType(cached)) return remember(toUrl(cached));
  }
  let response: Response;
  try {
    response = await request(`${storeBase(serviceUrl)}/v1/addons/${encodeURIComponent(id)}/screenshots/${index}`, 'image/png, image/jpeg');
  } catch {
    return null; // offline: beim nächsten Mal noch einmal
  }
  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (!response.ok || (type !== 'image/png' && type !== 'image/jpeg') || declared > MAX_SCREENSHOT) {
    await response.body?.cancel().catch(() => undefined);
    return response.status === 404 || response.ok ? remember(null) : null;
  }
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > MAX_SCREENSHOT || imageType(data) !== type) return remember(null);
  if (file && cacheDir) {
    await mkdir(cacheDir, { recursive: true });
    // ältere Stände desselben Bildes aufräumen
    for (const old of (await readdir(cacheDir).catch(() => [] as string[])).filter((f) => f.startsWith(`${id}.${index}.`) && f !== `${key}.img`)) {
      await rm(path.join(cacheDir, old), { force: true }).catch(() => undefined);
    }
    await writeFile(file, data).catch(() => undefined);
  }
  return remember(toUrl(data));
}

const PLATFORM_LABEL: Record<AddonPlatform, string> = { windows: 'Windows', mac: 'macOS', linux: 'Linux' };

/** Die Instanz, in die ein Addon soll: Minecraft-Version und Loader */
export interface AddonTarget {
  minecraft: string;
  loader: InstanceLoader;
}

type Unsupported = Extract<StoreAddon['state'], `unsupported-${string}`>;

/**
 * Warum das Addon hier nicht läuft (oder null): API-Stufe und System auf diesem PC, mit target zusätzlich Minecraft-Version
 * und Loader der Instanz („Nur für Minecraft 26.3“, „Läuft nur in Heldix-Instanzen“).
 */
export function incompatibility(manifest: AddonManifest, target?: AddonTarget): { state: Unsupported; reason: string } | null {
  if (manifest.api > HELDIX_ADDON_API) return { state: 'unsupported-api', reason: `Braucht einen neueren HeldixClient (Addon-API ${manifest.api})` };
  if (manifest.platforms.length > 0 && !manifest.platforms.includes(currentPlatform())) {
    return { state: 'unsupported-platform', reason: `Nur für ${manifest.platforms.map((p) => PLATFORM_LABEL[p]).join(' und ')}` };
  }
  if (!target) return null;
  if (!fitsMinecraft(target.minecraft, manifest.minecraft)) return { state: 'unsupported-minecraft', reason: minecraftReason(manifest.minecraft) };
  if (!manifest.loaders.includes(target.loader as AddonLoader)) {
    return { state: 'unsupported-loader', reason: manifest.loaders.length === 1 && manifest.loaders[0] === 'heldix' ? 'Läuft nur in Heldix-Instanzen' : 'Läuft nur in Fabric-Instanzen' };
  }
  return null;
}

/** Zustand eines Store-Eintrags in einer Instanz (installierte Addons aus listContent) */
function stateIn(manifest: AddonManifest, installed: ContentItem[], target?: AddonTarget): { state: StoreAddon['state']; present: ContentItem | null; problem: ReturnType<typeof incompatibility> } {
  const present = installed
    .filter((item) => item.id === manifest.id)
    .sort((a, b) => compareVersions(b.version, a.version))[0] ?? null;
  const problem = incompatibility(manifest, target);
  const state: StoreAddon['state'] = present
    ? compareVersions(manifest.version, present.version) > 0 && !problem
      ? 'update'
      : 'installed'
    : (problem?.state ?? 'available');
  return { state, present, problem };
}

async function installedAddons(gameDir: string): Promise<ContentItem[]> {
  return (await listContent(gameDir, 'addons', 'heldix')).filter((item) => item.id);
}

/** Store-Liste mit dem Zustand in einer Instanz (installiert, Update, …); target prüft Minecraft-Version und Loader. */
export async function storeForInstance(gameDir: string, serviceUrl: string, publicKey: string | null, target?: AddonTarget): Promise<StoreAddon[]> {
  const entries = await fetchStore(serviceUrl, publicKey);
  const installed = await installedAddons(gameDir);
  return entries.map(({ manifest, downloads }) => {
    const { state, present, problem } = stateIn(manifest, installed, target);
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      summary: manifest.summary,
      description: manifest.description,
      authors: manifest.authors,
      icon: manifest.icon,
      category: manifest.category,
      platforms: manifest.platforms,
      api: manifest.api,
      size: manifest.size,
      date: manifest.date,
      notes: manifest.notes,
      downloads,
      access: manifest.access,
      minecraft: manifest.minecraft,
      loaders: manifest.loaders,
      state,
      reason: problem?.reason ?? null,
      installedVersion: present?.version ?? null,
      installedEnabled: present ? present.enabled : null,
    };
  });
}

export interface OverviewInstance {
  id: string;
  name: string;
  minecraft: string;
  loader: InstanceLoader;
  /** Spielordner */
  dir: string;
}

/**
 * Addon-Store als eigene Seite: eine Abfrage des Stores, Zustand in jeder Instanz mit HeldixClient.
 * Ist der Store nicht erreichbar, steht die Meldung in error (addons ist dann leer).
 */
export async function storeOverview(
  instances: OverviewInstance[],
  serviceUrl: string,
  publicKey: string | null,
  options: {
    /** eigene Bewertungen (Addon-ID → 1–5 oder null); Fehler zählen als „keine“ */
    myRatings?: (ids: string[]) => Promise<Map<string, number | null>>;
    /** die Liste des Stores, wie sie geladen wurde (für Update-Zähler und Screenshots) */
    onEntries?: (entries: StoreEntry[]) => void;
  } = {},
): Promise<StoreOverview> {
  const list = instances.map(({ id, name, minecraft, loader }) => ({ id, name, minecraft, loader }));
  let entries: StoreEntry[];
  try {
    entries = await fetchStore(serviceUrl, publicKey);
  } catch (error) {
    return { addons: [], instances: list, error: error instanceof Error ? error.message : String(error) };
  }
  options.onEntries?.(entries);
  const [installed, ratings] = await Promise.all([
    Promise.all(instances.map((instance) => installedAddons(instance.dir))),
    options.myRatings ? options.myRatings(entries.map((e) => e.manifest.id)).catch(() => new Map<string, number | null>()) : Promise.resolve(new Map<string, number | null>()),
  ]);
  const addons: StoreListing[] = entries.map(({ manifest, downloads, rating, screenshots }) => ({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    summary: manifest.summary,
    description: manifest.description,
    authors: manifest.authors,
    icon: manifest.icon,
    category: manifest.category,
    platforms: manifest.platforms,
    api: manifest.api,
    size: manifest.size,
    sha256: manifest.sha256,
    date: manifest.date,
    notes: manifest.notes,
    downloads,
    // Offiziell/Community und Autor nur aus dem signierten Manifest, Bewertung und Screenshots vom Dienst
    official: manifest.official,
    author: manifest.author,
    rating,
    myRating: ratings.get(manifest.id) ?? null,
    screenshots,
    problem: incompatibility(manifest)?.reason ?? null,
    access: manifest.access,
    minecraft: manifest.minecraft,
    loaders: manifest.loaders,
    installs: instances.map((instance, i) => {
      const { state, present, problem } = stateIn(manifest, installed[i], instance);
      return { instanceId: instance.id, state, installedVersion: present?.version ?? null, reason: problem?.reason ?? null };
    }),
  }));
  return { addons, instances: list, error: null };
}

export interface PendingUpdate {
  instanceId: string;
  instanceName: string;
  addonId: string;
  name: string;
  /** neue Version im Store */
  version: string;
  installedVersion: string | null;
}

/** Alle installierten Addons (in allen Instanzen), für die der Store eine neuere Version hat. Ohne Netz. */
export async function pendingUpdates(instances: OverviewInstance[], entries: StoreEntry[]): Promise<PendingUpdate[]> {
  const updates: PendingUpdate[] = [];
  for (const instance of instances) {
    const installed = await installedAddons(instance.dir);
    if (installed.length === 0) continue;
    for (const { manifest } of entries) {
      // Updates nur, wenn die neue Version zur Instanz passt (Minecraft-Version, Loader)
      const { state, present } = stateIn(manifest, installed, instance);
      if (state === 'update') {
        updates.push({ instanceId: instance.id, instanceName: instance.name, addonId: manifest.id, name: manifest.name, version: manifest.version, installedVersion: present?.version ?? null });
      }
    }
  }
  return updates;
}

/** Entfernt alle Dateien eines Addons (auch ausgeschaltete .jar.disabled) aus der Instanz. Gibt die Zahl zurück. */
export async function uninstallStoreAddon(gameDir: string, id: string): Promise<number> {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('Ungültige Addon-ID');
  // Ersatz-JARs und vorgemerkte Löschungen aus dem Spiel zuerst erledigen
  await applyPendingRemovals(gameDir);
  const dir = contentDir(gameDir, 'addons');
  let removed = 0;
  for (const item of await listContent(gameDir, 'addons', 'heldix')) {
    if (item.id !== id) continue;
    await rm(path.join(dir, item.file), { force: true });
    await dropPendingRemoval(gameDir, item.file);
    removed++;
  }
  return removed;
}

/**
 * Lädt ein Addon aus dem Store, prüft es und legt es in die Instanz (ältere Versionen werden ersetzt). Gibt den Namen zurück.
 * instance: Minecraft-Version und Loader der Instanz – passt das Addon nicht, wird es nicht installiert.
 */
export async function installStoreAddon(gameDir: string, serviceUrl: string, publicKey: string | null, id: string, entries?: StoreEntry[], instance?: AddonTarget): Promise<string> {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('Ungültige Addon-ID');
  // entries: schon geladene (und geprüfte) Liste, z. B. beim Aktualisieren aller Addons
  const entry = (entries ?? (await fetchStore(serviceUrl, publicKey))).find((e) => e.manifest.id === id);
  if (!entry) throw new Error('Dieses Addon gibt es im Store nicht (mehr).');
  const { manifest } = entry;
  const problem = incompatibility(manifest, instance);
  if (problem) throw new Error(problem.reason);

  const dir = contentDir(gameDir, 'addons');
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, manifest.file);
  const part = `${target}.part`;
  const url = `${serviceUrl.replace(/\/+$/, '')}/v1/addons/${encodeURIComponent(id)}/files/${encodeURIComponent(manifest.file)}`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { 'User-Agent': `${LAUNCHER_NAME}/${LAUNCHER_VERSION}` }, signal: AbortSignal.timeout(120_000) });
  } catch {
    throw new Error('Download fehlgeschlagen – der Addon-Store ist gerade nicht erreichbar.');
  }
  if (!response.ok || !response.body) throw new Error(`Download fehlgeschlagen (${response.status}).`);
  const hash = createHash('sha256');
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > manifest.size) return callback(new Error('Die Datei ist größer als angegeben.'));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), counter, createWriteStream(part));
    if (size !== manifest.size || hash.digest('hex') !== manifest.sha256) throw new Error('Die Datei ist beschädigt oder wurde verändert (Prüfsumme stimmt nicht).');
    const meta = await readAddonMeta(part);
    if (meta.error || meta.id !== manifest.id || meta.version !== manifest.version) {
      throw new Error('Die JAR passt nicht zum Store-Eintrag (ID oder Version weichen ab).');
    }
    // Was der Spieler im Store sieht (signiert), muss zur JAR passen: kein heimlicher Eingriff in Minecraft
    if (meta.access === 'minecraft' && manifest.access !== 'minecraft') {
      throw new Error('Die JAR greift in Minecraft ein, der Store-Eintrag sagt das aber nicht – sie wird nicht installiert.');
    }
    if (!sameList(meta.minecraft, manifest.minecraft)) throw new Error('Die JAR passt nicht zum Store-Eintrag (Minecraft-Versionen weichen ab).');
  } catch (error) {
    await rm(part, { force: true });
    throw error;
  }
  for (const item of await listContent(gameDir, 'addons', 'heldix')) {
    if (item.id === id && item.file !== manifest.file) await rm(path.join(dir, item.file), { force: true });
  }
  await rm(path.join(dir, `${manifest.file}.disabled`), { force: true });
  await rename(part, target);
  await dropPendingRemoval(gameDir, manifest.file);
  return manifest.name;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  const x = new Set(a);
  return x.size === new Set(b).size && b.every((v) => x.has(v));
}

function pendingFile(gameDir: string): string {
  return path.join(contentDir(gameDir, 'addons'), PENDING_REMOVALS);
}

/** Vom Spiel vorgemerkte Löschungen ausführen und Ersatz-JARs (.jar.neu) einsetzen (nur, wenn die Instanz nicht läuft). */
export async function applyPendingRemovals(gameDir: string): Promise<void> {
  const dir = contentDir(gameDir, 'addons');
  // im Spiel ausgeschaltete Addons (heldix-addons/.ausschalten)
  await applyPendingDisable(gameDir).catch(() => undefined);
  try {
    for (const name of (await readdir(dir)).filter((f) => f.endsWith(`.jar${REPLACEMENT}`))) {
      await rename(path.join(dir, name), path.join(dir, name.slice(0, -REPLACEMENT.length))).catch(() => undefined);
    }
  } catch {
    return; // kein Addon-Ordner
  }
  let list: string;
  try {
    list = await readFile(pendingFile(gameDir), 'utf8');
  } catch {
    return;
  }
  for (const name of list.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
    if (path.basename(name) !== name || !/\.jar(\.disabled)?$/.test(name)) continue;
    await rm(path.join(dir, name), { force: true });
  }
  await rm(pendingFile(gameDir), { force: true });
}

async function dropPendingRemoval(gameDir: string, file: string): Promise<void> {
  let list: string;
  try {
    list = await readFile(pendingFile(gameDir), 'utf8');
  } catch {
    return;
  }
  const rest = list.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && line !== file);
  if (rest.length) await writeFile(pendingFile(gameDir), `${rest.join('\n')}\n`);
  else await rm(pendingFile(gameDir), { force: true });
}
