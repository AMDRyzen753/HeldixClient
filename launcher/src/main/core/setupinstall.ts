// Setup teilen (Launcher 0.14.1, Heldix-Dienst 1.14.0): Setup aus einer Instanz bauen, Vorschau eines geteilten Setups,
// Nachbauen als neue Instanz und die Routen des Dienstes. Links, Format und options.txt: core/setupshare.ts.
//
// - Teilen (buildSetup): Mods, Ressourcenpakete und Shaderpacks nur mit bekannter Modrinth-Version – aus
//   .heldix-modrinth.json bzw. .heldix-shaderpacks.json, sonst über die SHA-1 der Datei bei Modrinth
//   (POST /v2/version_files). Addons nur, wenn es sie im Addon-Store gibt (Signatur geprüft). Ausgeschaltetes, Ordner und
//   unbekannte Dateien gehen nicht mit und stehen mit Grund in notShared. Ressourcenpakete: die eingeschalteten in der
//   Reihenfolge aus options.txt; Shaderpacks: das aktive zuerst (es wird beim Nachbauen eingeschaltet).
// - Vorschau und Nachbauen (resolveModrinth, resolveAddons): Versionen und Projekte holt der Launcher selbst von
//   Modrinth (GET /v2/versions, /v2/projects) und prüft Projekt, Art, Loader und Datei. Heruntergeladen wird nur von
//   https://cdn.modrinth.com/ (SHA-1 und Größe wie überall) bzw. aus dem Addon-Store (Signatur, SHA-256) – nie von
//   anderen Adressen, auch wenn ein Setup sie nennen würde (content hat ohnehin keine URLs).
// - Nachbauen (installSetup): neue Instanz mit Minecraft-Version und Loader des Setups, Mods samt fehlender
//   Pflicht-Abhängigkeiten, Konflikte wie beim Start lösen, Shaderpacks (Iris bei Bedarf), Ressourcenpakete, Addons, das
//   Leistungsprofil sofort und options.txt beim ersten Start (PENDING_OPTIONS_FILE). Einzelne Fehler brechen nicht ab.
// - Dienst (SetupService): POST/GET/DELETE /v1/setups (angemeldet), GET /v1/public/setups/<code> (404 = gibt es nicht,
//   410 = abgelaufen/widerrufen), POST /v1/public/setups/<code>/installed.
//
// Codes sind Zugangsdaten zu einem Setup: sie stehen nie im Log.

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  InstanceLoader,
  OwnSharedSetup,
  OwnSharedSetups,
  SharedSetupCreated,
  SharedSetupDraftItem,
  SharedSetupKind,
  SharedSetupPreview,
  SharedSetupPreviewItem,
  SharedSetupResult,
  SharedSetupSkipped,
} from '../../shared/api';
import { fetchStore, incompatibility, installStoreAddon, type AddonManifest, type StoreEntry } from './addonstore';
import { contentDir, listContent, MODRINTH_INDEX, type ModrinthIndex } from './content';
import { readJson, writeJson } from './fsutil';
import { SERVICE_UNREACHABLE, ServiceError, serviceBase, serviceRequest } from './heldixservice';
import { fetchJson, sha1File, syncFiles, type ProgressFn } from './http';
import { INSTANCE_COLORS, type InstanceStore, usesHeldixClient } from './instances';
import { fixFabricConflicts } from './modrinth';
import { IRIS_PROJECT, SHADERPACK_DIR, SHADERPACK_INDEX, ensureIris, listShaderpacks, setActiveShaderpack } from './shaderpacks';
import {
  ADDON_ID_RE,
  HELDIX_CONFIG,
  MODRINTH_ID_RE,
  OPTIONS_FILE,
  SETUP_CONTENT_MAX_BYTES,
  SETUP_DESCRIPTION_MAX,
  SETUP_GONE,
  SETUP_LIST_MAX,
  SETUP_MISSING,
  SETUP_NAME_MAX,
  SETUP_OFFLINE,
  acceptedGraphics,
  acceptedKeys,
  activeResourcePacks,
  applyHeldixProfile,
  cleanLine,
  graphicsFromOptions,
  graphicsSummary,
  heldixProfileFrom,
  keysFromOptions,
  parseOptions,
  parseSetupContent,
  setupAppUrl,
  setupCode,
  setupContentBytes,
  setupWebUrl,
  writePendingOptions,
  type SetupAddonEntry,
  type SetupContent,
  type SetupLoader,
  type SetupModrinthEntry,
  type SetupValue,
} from './setupshare';

export const MODRINTH_API = 'https://api.modrinth.com/v2';
/** Nur von hier lädt „Setup teilen“ Dateien (Modrinth-CDN) */
export const MODRINTH_CDN = 'https://cdn.modrinth.com/';
/** Fabric API verwaltet der Launcher selbst */
export const FABRIC_API_PROJECT = 'P7dR8mSH';
export const RESOURCEPACK_DIR = 'resourcepacks';
const MAX_FILE_SIZE = 512 * 1024 * 1024;

type ModrinthKind = Exclude<SharedSetupKind, 'addons'>;
const MODRINTH_KINDS: readonly ModrinthKind[] = ['mods', 'shaderpacks', 'resourcepacks'];

/** Projektart auf Modrinth, nötige Loader der Version und Dateiendung je Liste */
const KIND: Record<ModrinthKind, { type: string; loaders: string[]; ext: RegExp }> = {
  mods: { type: 'mod', loaders: ['fabric'], ext: /\.jar$/i },
  shaderpacks: { type: 'shader', loaders: ['iris', 'optifine'], ext: /\.zip$/i },
  resourcepacks: { type: 'resourcepack', loaders: ['minecraft'], ext: /\.zip$/i },
};

/** Hinweise als ganze Sätze mit Platzhaltern (für Phase 2: Englisch) */
export const SETUP_TEXT = {
  modsFabricOnly: 'Mods von Modrinth laufen nur in Fabric-Instanzen.',
  shadersFabricOnly: 'Shaderpacks laufen nur in Fabric-Instanzen (über Iris).',
  versionGone: 'Diese Version gibt es auf Modrinth nicht mehr.',
  wrongProject: 'Die Version gehört auf Modrinth zu einem anderen Projekt.',
  wrongType: {
    mods: 'Auf Modrinth ist das keine Mod.',
    shaderpacks: 'Auf Modrinth ist das kein Shaderpack.',
    resourcepacks: 'Auf Modrinth ist das kein Ressourcenpaket.',
  } satisfies Record<ModrinthKind, string>,
  wrongLoader: {
    mods: 'Diese Version ist nicht für Fabric.',
    shaderpacks: 'Diese Version ist nicht für Iris.',
    resourcepacks: 'Diese Version ist kein Ressourcenpaket für Minecraft.',
  } satisfies Record<ModrinthKind, string>,
  badFile: 'Die Datei auf Modrinth ist ungültig.',
  otherMinecraft: 'Laut Modrinth nicht für Minecraft {version} – läuft vielleicht nicht.',
  builtin: 'Bringt der Launcher selbst mit.',
  modrinthLater: 'Modrinth ist gerade nicht erreichbar – wird beim Anlegen geprüft.',
  modrinthDown: 'Modrinth ist gerade nicht erreichbar.',
  addonsNeedClient: 'Addons laufen nur in Instanzen mit HeldixClient.',
  addonMissing: 'Gibt es im Addon-Store nicht (mehr).',
  addonNewer: 'Im Store gibt es jetzt Version {neu} (geteilt wurde {alt}).',
  storeLater: 'Der Addon-Store ist gerade nicht erreichbar – wird beim Anlegen geprüft.',
  storeDown: 'Der Addon-Store ist gerade nicht erreichbar.',
  dropped: 'Im Setup waren {anzahl} ungültige Einträge – sie wurden übersprungen.',
  sameFile: 'Eine andere Datei aus dem Setup heißt genauso.',
  dependency: 'Dazu installiert, weil {mod} es braucht: {abhaengigkeit}',
  dependencyFailed: 'Abhängigkeit nicht installiert ({abhaengigkeit}): {grund}',
  irisAdded: 'Für die Shaderpacks dazu installiert: {mods}',
  irisFailed: 'Iris für die Shaderpacks ließ sich nicht installieren: {grund}',
  // beim Teilen
  disabled: 'ausgeschaltet',
  notActive: 'nicht eingeschaltet',
  folder: 'Ordner – nur .zip-Dateien von Modrinth lassen sich teilen',
  unknownFile: 'keine Modrinth-Datei',
  lookupDown: 'Modrinth gerade nicht erreichbar',
  notInStore: 'nicht im Addon-Store',
  storeUnreachable: 'Addon-Store gerade nicht erreichbar',
  brokenAddon: 'kein gültiges Addon',
  tooMany: 'mehr als 300 Einträge',
  heldixMod: 'keine Modrinth-Datei (Heldix-Instanzen laden keine Fabric-Mods)',
};

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

const message = (error: unknown) => (error instanceof Error && error.message ? error.message : String(error));

// ---------- Modrinth ----------

export interface ModrinthFile {
  url: string;
  filename: string;
  size: number;
  sha1: string;
}

export interface ModrinthVersion {
  id: string;
  project: string;
  number: string;
  loaders: string[];
  gameVersions: string[];
  files: (ModrinthFile & { primary: boolean })[];
  dependencies: { project: string | null; version: string | null; type: string }[];
}

export interface ModrinthProject {
  id: string;
  title: string;
  type: string;
  iconUrl: string | null;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

/** Version aus der Antwort von Modrinth (ungültig: null). Dateien behalten nur die nötigen Felder. */
export function mapModrinthVersion(raw: unknown): ModrinthVersion | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== 'string' || !MODRINTH_ID_RE.test(v.id) || typeof v.project_id !== 'string' || !MODRINTH_ID_RE.test(v.project_id)) return null;
  const files = (Array.isArray(v.files) ? v.files : []).flatMap((f) => {
    const file = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
    const hashes = (file.hashes && typeof file.hashes === 'object' ? file.hashes : {}) as Record<string, unknown>;
    if (typeof file.url !== 'string' || typeof file.filename !== 'string' || typeof hashes.sha1 !== 'string') return [];
    return [{ url: file.url, filename: file.filename, size: Number(file.size), sha1: hashes.sha1.toLowerCase(), primary: file.primary === true }];
  });
  const dependencies = (Array.isArray(v.dependencies) ? v.dependencies : []).flatMap((d) => {
    const dep = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
    const project = typeof dep.project_id === 'string' && MODRINTH_ID_RE.test(dep.project_id) ? dep.project_id : null;
    const version = typeof dep.version_id === 'string' && MODRINTH_ID_RE.test(dep.version_id) ? dep.version_id : null;
    return project || version ? [{ project, version, type: typeof dep.dependency_type === 'string' ? dep.dependency_type : 'optional' }] : [];
  });
  return {
    id: v.id,
    project: v.project_id,
    number: cleanLine(v.version_number, 40) || v.id,
    loaders: strings(v.loaders),
    gameVersions: strings(v.game_versions),
    files,
    dependencies,
  };
}

export function mapModrinthProject(raw: unknown): ModrinthProject | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== 'string' || !MODRINTH_ID_RE.test(p.id)) return null;
  const icon = typeof p.icon_url === 'string' && p.icon_url.startsWith(MODRINTH_CDN) && p.icon_url.length <= 512 && !/\s/.test(p.icon_url) ? p.icon_url : null;
  return { id: p.id, title: cleanLine(p.title, 64) || p.id, type: typeof p.project_type === 'string' ? p.project_type : '', iconUrl: icon };
}

/**
 * Datei einer Version, die „Setup teilen“ laden darf: die Hauptdatei (sonst die erste), nur von https://cdn.modrinth.com/,
 * ein reiner Dateiname mit passender Endung, SHA-1 und Größe. Sonst null.
 */
export function pickModrinthFile(version: ModrinthVersion, kind: ModrinthKind): ModrinthFile | null {
  const file = version.files.find((f) => f.primary) ?? version.files[0];
  if (!file) return null;
  let url: URL;
  try {
    url = new URL(file.url);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.host !== 'cdn.modrinth.com' || !file.url.startsWith(MODRINTH_CDN)) return null;
  const name = file.filename;
  if (!name || name.length > 200 || path.basename(name) !== name || name.startsWith('.') || /[\\/:*?"<>|\u0000-\u001f]/.test(name) || !KIND[kind].ext.test(name)) return null;
  if (!/^[0-9a-f]{40}$/.test(file.sha1) || !Number.isInteger(file.size) || file.size < 1 || file.size > MAX_FILE_SIZE) return null;
  return { url: file.url, filename: name, size: file.size, sha1: file.sha1 };
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Versionen nach ID (GET /v2/versions?ids=…, je 100) */
export async function modrinthVersions(ids: readonly string[]): Promise<Map<string, ModrinthVersion>> {
  const result = new Map<string, ModrinthVersion>();
  for (const chunk of chunks([...new Set(ids.filter((id) => MODRINTH_ID_RE.test(id)))], 100)) {
    const raw = await fetchJson<unknown>(`${MODRINTH_API}/versions?ids=${encodeURIComponent(JSON.stringify(chunk))}`);
    for (const entry of Array.isArray(raw) ? raw : []) {
      const version = mapModrinthVersion(entry);
      if (version) result.set(version.id, version);
    }
  }
  return result;
}

/** Projekte nach ID (GET /v2/projects?ids=…, je 100) */
export async function modrinthProjects(ids: readonly string[]): Promise<Map<string, ModrinthProject>> {
  const result = new Map<string, ModrinthProject>();
  for (const chunk of chunks([...new Set(ids.filter((id) => MODRINTH_ID_RE.test(id)))], 100)) {
    const raw = await fetchJson<unknown>(`${MODRINTH_API}/projects?ids=${encodeURIComponent(JSON.stringify(chunk))}`);
    for (const entry of Array.isArray(raw) ? raw : []) {
      const project = mapModrinthProject(entry);
      if (project) result.set(project.id, project);
    }
  }
  return result;
}

/** Versionen zu SHA-1-Prüfsummen (POST /v2/version_files) – so erkennt der Launcher Dateien, die er nicht selbst geladen hat */
export async function modrinthByHashes(hashes: readonly string[]): Promise<Map<string, ModrinthVersion>> {
  const result = new Map<string, ModrinthVersion>();
  for (const chunk of chunks([...new Set(hashes.filter((h) => /^[0-9a-f]{40}$/.test(h)))], 300)) {
    const raw = await fetchJson<unknown>(`${MODRINTH_API}/version_files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hashes: chunk, algorithm: 'sha1' }),
    });
    if (!raw || typeof raw !== 'object') continue;
    for (const [hash, entry] of Object.entries(raw as Record<string, unknown>)) {
      const version = mapModrinthVersion(entry);
      if (version && chunk.includes(hash.toLowerCase())) result.set(hash.toLowerCase(), version);
    }
  }
  return result;
}

/** Neueste Fabric-Version eines Projekts für diese Minecraft-Version (Vollversion bevorzugt) – für fehlende Abhängigkeiten */
async function latestFabricVersion(project: string, minecraft: string): Promise<ModrinthVersion | null> {
  const query = new URLSearchParams({ loaders: JSON.stringify(['fabric']), game_versions: JSON.stringify([minecraft]) });
  const raw = await fetchJson<unknown>(`${MODRINTH_API}/project/${project}/version?${query}`);
  const list = (Array.isArray(raw) ? raw : []) as { version_type?: unknown }[];
  const pick = list.find((v) => v && v.version_type === 'release') ?? list[0];
  return pick ? mapModrinthVersion(pick) : null;
}

// ---------- Inhalte eines Setups prüfen ----------

export interface ResolvedModrinth {
  kind: ModrinthKind;
  entry: SetupModrinthEntry;
  title: string;
  iconUrl: string | null;
  version: ModrinthVersion | null;
  file: ModrinthFile | null;
  state: 'ok' | 'warn' | 'skip';
  note: string | null;
}

/**
 * Prüft die Modrinth-Listen eines Setups gegen Modrinth: gibt es die Version, gehört sie zum Projekt, passt Art und Loader,
 * ist die Datei in Ordnung? error = Modrinth nicht erreichbar (dann haben die Einträge keine Version).
 */
export async function resolveModrinth(content: SetupContent): Promise<{ items: ResolvedModrinth[]; error: string | null }> {
  const entries = MODRINTH_KINDS.flatMap((kind) => content[kind].map((entry) => ({ kind, entry })));
  let versions = new Map<string, ModrinthVersion>();
  let projects = new Map<string, ModrinthProject>();
  let error: string | null = null;
  if (entries.length) {
    try {
      [versions, projects] = await Promise.all([modrinthVersions(entries.map((e) => e.entry.version)), modrinthProjects(entries.map((e) => e.entry.project))]);
    } catch {
      error = SETUP_TEXT.modrinthDown;
    }
  }
  const items = entries.map(({ kind, entry }): ResolvedModrinth => {
    const project = projects.get(entry.project) ?? null;
    const base: ResolvedModrinth = { kind, entry, title: project?.title ?? entry.title, iconUrl: project?.iconUrl ?? null, version: null, file: null, state: 'skip', note: null };
    const skip = (note: string): ResolvedModrinth => ({ ...base, state: 'skip', note });
    if (kind === 'mods' && content.loader !== 'fabric') return skip(SETUP_TEXT.modsFabricOnly);
    if (kind === 'shaderpacks' && content.loader !== 'fabric') return skip(SETUP_TEXT.shadersFabricOnly);
    if (kind === 'mods' && entry.project === FABRIC_API_PROJECT) return skip(SETUP_TEXT.builtin);
    if (error) return { ...base, state: 'warn', note: SETUP_TEXT.modrinthLater };
    const version = versions.get(entry.version);
    if (!version) return skip(SETUP_TEXT.versionGone);
    if (version.project !== entry.project) return skip(SETUP_TEXT.wrongProject);
    if (project && project.type && project.type !== KIND[kind].type) return skip(SETUP_TEXT.wrongType[kind]);
    if (version.loaders.length > 0 && !version.loaders.some((l) => KIND[kind].loaders.includes(l))) return skip(SETUP_TEXT.wrongLoader[kind]);
    const file = pickModrinthFile(version, kind);
    if (!file) return skip(SETUP_TEXT.badFile);
    const resolved: ResolvedModrinth = { ...base, version, file, state: 'ok' };
    if (kind === 'mods' && version.gameVersions.length > 0 && !version.gameVersions.includes(content.minecraft)) {
      return { ...resolved, state: 'warn', note: fill(SETUP_TEXT.otherMinecraft, { version: content.minecraft }) };
    }
    return resolved;
  });
  return { items, error };
}

export interface ResolvedAddon {
  entry: SetupAddonEntry;
  title: string;
  icon: string | null;
  manifest: AddonManifest | null;
  state: 'ok' | 'warn' | 'skip';
  note: string | null;
}

/** Prüft die Addons gegen den Store (entries null = Store nicht erreichbar) */
export function resolveAddons(content: SetupContent, entries: StoreEntry[] | null): ResolvedAddon[] {
  return content.addons.map((entry): ResolvedAddon => {
    const store = entries?.find((e) => e.manifest.id === entry.id)?.manifest ?? null;
    const base: ResolvedAddon = { entry, title: store?.name ?? entry.name, icon: store?.icon ?? null, manifest: store, state: 'skip', note: null };
    if (!content.heldixClient) return { ...base, note: SETUP_TEXT.addonsNeedClient };
    if (!entries) return { ...base, state: 'warn', note: SETUP_TEXT.storeLater };
    if (!store) return { ...base, note: SETUP_TEXT.addonMissing };
    const problem = incompatibility(store, { minecraft: content.minecraft, loader: content.loader });
    if (problem) return { ...base, note: problem.reason };
    if (entry.version && entry.version !== store.version) return { ...base, state: 'warn', note: fill(SETUP_TEXT.addonNewer, { neu: store.version, alt: entry.version }) };
    return { ...base, state: 'ok' };
  });
}

// ---------- Geteiltes Setup vom Dienst ----------

export interface PublicSetup {
  code: string;
  name: string;
  description: string;
  creator: { uuid: string; name: string } | null;
  content: SetupContent;
  /** ungültige Einträge, die beim Prüfen weggefallen sind */
  dropped: number;
  created: number;
  expires: number | null;
  views: number;
  installs: number;
}

function time(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** Antwort von GET /v1/public/setups/<code>; wirft, wenn content kaputt ist */
export function mapPublicSetup(raw: unknown, code: string): PublicSetup {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const { content, dropped } = parseSetupContent(r.content);
  const creatorRaw = (r.creator && typeof r.creator === 'object' ? r.creator : {}) as Record<string, unknown>;
  const uuid = (typeof creatorRaw.uuid === 'string' ? creatorRaw.uuid : '').replace(/-/g, '').toLowerCase();
  return {
    code,
    name: cleanLine(r.name, SETUP_NAME_MAX) || `Minecraft ${content.minecraft}`,
    description: cleanLine(r.description, SETUP_DESCRIPTION_MAX),
    creator: /^[0-9a-f]{32}$/.test(uuid) ? { uuid, name: cleanLine(creatorRaw.name, 16) || 'Unbekannt' } : null,
    content,
    dropped,
    created: time(r.created),
    expires: r.expires === null || r.expires === undefined ? null : time(r.expires) || null,
    views: count(r.views),
    installs: count(r.installs),
  };
}

/** Teil von core/social.ts, den „Setup teilen“ braucht (angemeldete Anfragen) */
export interface SetupAuth {
  authed<T>(route: string, init?: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown }, options?: { offlineMessage?: string; quiet?: boolean }): Promise<T>;
}

/** Fehler: Setup gibt es nicht (404) bzw. abgelaufen oder widerrufen (410) */
export function setupMissing(error: unknown): 'missing' | 'gone' | null {
  if (!(error instanceof ServiceError)) return null;
  return error.status === 404 ? 'missing' : error.status === 410 ? 'gone' : null;
}

export function mapOwnSetup(raw: unknown, website: string): OwnSharedSetup | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const code = typeof r.code === 'string' && /^[a-hjkmnp-z2-9]{10}$/.test(r.code) ? r.code : null;
  if (!code) return null;
  const expires = r.expires === null || r.expires === undefined ? null : time(r.expires) || null;
  // Dienst 1.14.0: revoked, expired und status ('active' | 'expired' | 'revoked')
  const revoked = r.revoked === true || r.expired === true || (typeof r.status === 'string' && r.status !== 'active');
  return {
    code,
    name: cleanLine(r.name, SETUP_NAME_MAX) || code,
    description: cleanLine(r.description, SETUP_DESCRIPTION_MAX),
    created: time(r.created),
    expires,
    views: count(r.views),
    installs: count(r.installs),
    active: !revoked && (expires === null || expires > Date.now()),
    url: setupWebUrl(website, code),
  };
}

const PUBLIC_CACHE_MS = 5 * 60_000;
const SETUP_EXPIRIES = [7, 30, 90, null] as const;

export interface SetupServiceOptions {
  serviceUrl: string;
  website: string;
  auth: SetupAuth | null;
}

export class SetupService {
  private readonly base: string;
  private readonly cache = new Map<string, { at: number; setup: PublicSetup }>();

  constructor(private readonly options: SetupServiceOptions) {
    this.base = serviceBase(options.serviceUrl ?? '');
  }

  get available(): boolean {
    return this.base !== '';
  }

  private auth(): SetupAuth {
    if (!this.base || !this.options.auth) throw new Error('Kein Heldix-Dienst eingerichtet.');
    return this.options.auth;
  }

  /** GET /v1/public/setups/<code> (kurz zwischengespeichert: Vorschau und Anlegen sehen dasselbe Setup) */
  async publicSetup(rawCode: unknown, fresh = false): Promise<PublicSetup> {
    const code = setupCode(rawCode);
    if (!this.base) throw new Error('Kein Heldix-Dienst eingerichtet.');
    const hit = this.cache.get(code);
    if (!fresh && hit && Date.now() - hit.at < PUBLIC_CACHE_MS) return hit.setup;
    let raw: unknown;
    try {
      raw = await serviceRequest<unknown>(this.base, `/v1/public/setups/${code}`, { timeoutMs: 10_000 });
    } catch (error) {
      this.cache.delete(code);
      const missing = setupMissing(error);
      if (missing) throw new ServiceError(missing === 'missing' ? SETUP_MISSING : SETUP_GONE, missing === 'missing' ? 404 : 410);
      throw error;
    }
    const setup = mapPublicSetup(raw, code);
    this.cache.set(code, { at: Date.now(), setup });
    while (this.cache.size > 20) this.cache.delete(this.cache.keys().next().value!);
    return setup;
  }

  /** POST /v1/public/setups/<code>/installed (Fehler egal: zählt nur) */
  async markInstalled(rawCode: unknown): Promise<void> {
    const code = setupCode(rawCode);
    if (!this.base) return;
    await serviceRequest<unknown>(this.base, `/v1/public/setups/${code}/installed`, { method: 'POST', timeoutMs: 10_000 }).catch(() => undefined);
  }

  /** POST /v1/setups → { code, url, expires } */
  async create(content: SetupContent, meta: { name: string; description: string; expiresDays: unknown }): Promise<{ code: string; url: string; expires: number | null }> {
    const expiresDays = SETUP_EXPIRIES.includes(meta.expiresDays as never) ? (meta.expiresDays as (typeof SETUP_EXPIRIES)[number]) : 30;
    if (setupContentBytes(content) > SETUP_CONTENT_MAX_BYTES) throw new Error('Das Setup ist zu groß zum Teilen (höchstens 64 KiB). Nimm die Tastenbelegung heraus oder teile weniger Inhalte.');
    const raw = await this.auth().authed<Record<string, unknown>>('/v1/setups', {
      method: 'POST',
      body: { name: meta.name, description: meta.description, content, expiresDays },
    }, { offlineMessage: SETUP_OFFLINE });
    const code = setupCode(raw?.code);
    const url = typeof raw.url === 'string' && /^https:\/\/[^\s]+#[a-hjkmnp-z2-9]{10}$/.test(raw.url) && raw.url.endsWith(`#${code}`) ? raw.url : setupWebUrl(this.options.website, code);
    if (!url) throw new Error('Der Heldix-Dienst hat keinen gültigen Link geschickt.');
    return { code, url, expires: raw.expires === null || raw.expires === undefined ? null : time(raw.expires) || null };
  }

  /** GET /v1/setups: eigene Setups mit Zählern (neueste zuerst) */
  async mine(): Promise<OwnSharedSetups> {
    if (!this.base || !this.options.auth) return { status: 'off', error: null, setups: [] };
    let raw: unknown;
    try {
      raw = await this.options.auth.authed<unknown>('/v1/setups', {}, { offlineMessage: SETUP_OFFLINE });
    } catch (error) {
      if (error instanceof ServiceError && error.status === 404) return { status: 'unsupported', error: null, setups: [] };
      if (!(error instanceof ServiceError) && /Microsoft-Konto|Konto hinzufügen|Kein Heldix-Dienst/.test(message(error))) return { status: 'off', error: message(error), setups: [] };
      return { status: 'error', error: message(error) || SERVICE_UNREACHABLE, setups: [] };
    }
    const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { setups?: unknown }).setups) ? (raw as { setups: unknown[] }).setups : [];
    const setups = list.map((entry) => mapOwnSetup(entry, this.options.website)).filter((s): s is OwnSharedSetup => s !== null);
    setups.sort((a, b) => Number(b.active) - Number(a.active) || b.created - a.created);
    return { status: 'ok', error: null, setups };
  }

  /** DELETE /v1/setups/<code> (widerrufen), danach die neue Liste */
  async revoke(rawCode: unknown): Promise<OwnSharedSetups> {
    const code = setupCode(rawCode);
    await this.auth().authed<unknown>(`/v1/setups/${code}`, { method: 'DELETE' }, { offlineMessage: SETUP_OFFLINE });
    this.cache.delete(code);
    return this.mine();
  }
}

// ---------- Setup aus einer Instanz bauen ----------

export interface BuildInstance {
  name: string;
  minecraft: string;
  loader: InstanceLoader;
  heldixClient: boolean;
}

export interface BuildOptions {
  graphics: boolean;
  keys: boolean;
  /** geprüfte Liste des Addon-Stores (wirft, wenn er nicht erreichbar ist) */
  store(): Promise<StoreEntry[]>;
}

export interface BuiltSetup {
  content: SetupContent;
  items: SharedSetupDraftItem[];
  notShared: SharedSetupSkipped[];
  graphics: number;
  keys: number;
}

interface HashCandidate {
  kind: ModrinthKind;
  file: string;
  name: string;
  /** aktives Shaderpack (kommt im Setup zuerst) */
  active?: boolean;
}

type ShaderIndex = Record<string, { projectId?: unknown; versionId?: unknown; title?: unknown }>;

const validIds = (project: unknown, version: unknown): boolean => typeof project === 'string' && MODRINTH_ID_RE.test(project) && typeof version === 'string' && MODRINTH_ID_RE.test(version);

/**
 * Baut content aus einer Instanz (nur lesen). Mods/Packs mit bekannter Modrinth-Version, Store-Addons, Grafik und
 * Tasten auf Wunsch; alles andere steht mit Grund in notShared.
 */
export async function buildSetup(gameDir: string, instance: BuildInstance, options: BuildOptions): Promise<BuiltSetup> {
  const lists: Record<ModrinthKind, SetupModrinthEntry[]> = { mods: [], resourcepacks: [], shaderpacks: [] };
  const notShared: SharedSetupSkipped[] = [];
  const candidates: HashCandidate[] = [];
  const fabric = instance.loader === 'fabric';
  let activeShader: string | null = null;
  const add = (kind: ModrinthKind, entry: SetupModrinthEntry): void => {
    if (lists[kind].some((e) => e.project === entry.project)) return;
    if (lists[kind].length >= SETUP_LIST_MAX) {
      notShared.push({ kind, name: entry.title, reason: SETUP_TEXT.tooMany });
      return;
    }
    lists[kind].push({ project: entry.project, version: entry.version, title: cleanLine(entry.title, 64) || entry.project });
  };

  // Mods (nur Fabric-Instanzen haben Mods von Modrinth)
  if (instance.loader !== 'vanilla') {
    const modsDir = contentDir(gameDir, 'mods');
    const index = (await readJson<ModrinthIndex>(path.join(modsDir, MODRINTH_INDEX))) ?? {};
    for (const item of await listContent(gameDir, 'mods', instance.loader)) {
      if (item.managed) continue;
      const base = item.file.replace(/\.disabled$/, '');
      const entry = index[base];
      if (entry?.projectId === FABRIC_API_PROJECT) continue;
      if (!item.enabled) {
        notShared.push({ kind: 'mods', name: entry?.title ?? item.name, reason: SETUP_TEXT.disabled });
        continue;
      }
      if (!fabric) {
        notShared.push({ kind: 'mods', name: item.name, reason: SETUP_TEXT.heldixMod });
        continue;
      }
      if (entry && validIds(entry.projectId, entry.versionId)) add('mods', { project: entry.projectId, version: entry.versionId, title: entry.title || item.name });
      else candidates.push({ kind: 'mods', file: path.join(modsDir, item.file), name: item.name });
    }
  }

  // Shaderpacks (Iris, nur Fabric): das aktive zuerst
  if (fabric) {
    const dir = path.join(gameDir, SHADERPACK_DIR);
    const index = (await readJson<ShaderIndex>(path.join(dir, SHADERPACK_INDEX))) ?? {};
    const shaders = await listShaderpacks(gameDir);
    const packs = [...shaders.packs].sort((a, b) => Number(b.active) - Number(a.active));
    for (const pack of packs) {
      const entry = index[pack.file];
      if (pack.sizeBytes === null) {
        notShared.push({ kind: 'shaderpacks', name: pack.name, reason: SETUP_TEXT.folder });
        continue;
      }
      if (entry && validIds(entry.projectId, entry.versionId)) {
        add('shaderpacks', { project: entry.projectId as string, version: entry.versionId as string, title: typeof entry.title === 'string' ? entry.title : pack.name });
        if (pack.active) activeShader = entry.projectId as string;
      } else candidates.push({ kind: 'shaderpacks', file: path.join(dir, pack.file), name: pack.name, active: pack.active });
    }
  }

  // Ressourcenpakete: die eingeschalteten, in der Reihenfolge aus options.txt
  const optionsText = await readFile(path.join(gameDir, OPTIONS_FILE), 'utf8').catch(() => '');
  const optionMap = parseOptions(optionsText);
  const active = activeResourcePacks(optionMap);
  const packDir = path.join(gameDir, RESOURCEPACK_DIR);
  const packFiles = await readdir(packDir).catch(() => [] as string[]);
  for (const name of packFiles) {
    if (name.startsWith('.')) continue;
    const info = await stat(path.join(packDir, name)).catch(() => null);
    if (!info) continue;
    const label = name.replace(/\.zip$/i, '');
    if (!active.includes(name)) {
      if (info.isDirectory() || /\.zip$/i.test(name)) notShared.push({ kind: 'resourcepacks', name: label, reason: SETUP_TEXT.notActive });
      continue;
    }
    if (info.isDirectory() || !/\.zip$/i.test(name)) notShared.push({ kind: 'resourcepacks', name: label, reason: SETUP_TEXT.folder });
  }
  for (const name of active) {
    if (!/\.zip$/i.test(name) || !packFiles.includes(name)) continue;
    const info = await stat(path.join(packDir, name)).catch(() => null);
    if (info?.isFile()) candidates.push({ kind: 'resourcepacks', file: path.join(packDir, name), name: name.replace(/\.zip$/i, '') });
  }

  // Dateien ohne Eintrag im Index: über die SHA-1 bei Modrinth nachsehen
  if (candidates.length) {
    try {
      const hashes = new Map<HashCandidate, string>();
      for (const candidate of candidates) hashes.set(candidate, await sha1File(candidate.file));
      const found = await modrinthByHashes([...hashes.values()]);
      const projects = await modrinthProjects([...found.values()].map((v) => v.project));
      for (const candidate of candidates) {
        const version = found.get(hashes.get(candidate)!);
        const project = version ? projects.get(version.project) : undefined;
        const fits = version && (!project?.type || project.type === KIND[candidate.kind].type)
          && (version.loaders.length === 0 || version.loaders.some((l) => KIND[candidate.kind].loaders.includes(l)));
        if (!version || !fits || (candidate.kind === 'mods' && version.project === FABRIC_API_PROJECT)) {
          notShared.push({ kind: candidate.kind, name: candidate.name, reason: SETUP_TEXT.unknownFile });
          continue;
        }
        add(candidate.kind, { project: version.project, version: version.id, title: project?.title ?? candidate.name });
        if (candidate.active) activeShader = version.project;
      }
    } catch {
      for (const candidate of candidates) notShared.push({ kind: candidate.kind, name: candidate.name, reason: SETUP_TEXT.lookupDown });
    }
  }
  // das aktive Shaderpack zuerst (es wird beim Nachbauen eingeschaltet); Ressourcenpakete stehen schon in der Reihenfolge
  // aus options.txt, weil sie nur über die Nachschau hinzukommen
  if (activeShader) lists.shaderpacks.sort((a, b) => Number(b.project === activeShader) - Number(a.project === activeShader));

  // Addons aus dem Store
  const addons: SetupAddonEntry[] = [];
  if (instance.heldixClient) {
    const installed = await listContent(gameDir, 'addons', 'heldix');
    let entries: StoreEntry[] | null = null;
    if (installed.length) entries = await options.store().catch(() => null);
    for (const item of installed) {
      if (!item.id || !ADDON_ID_RE.test(item.id)) {
        notShared.push({ kind: 'addons', name: item.name, reason: SETUP_TEXT.brokenAddon });
        continue;
      }
      if (!item.enabled) {
        notShared.push({ kind: 'addons', name: item.name, reason: SETUP_TEXT.disabled });
        continue;
      }
      if (!entries) {
        notShared.push({ kind: 'addons', name: item.name, reason: SETUP_TEXT.storeUnreachable });
        continue;
      }
      const store = entries.find((e) => e.manifest.id === item.id)?.manifest;
      if (!store) {
        notShared.push({ kind: 'addons', name: item.name, reason: SETUP_TEXT.notInStore });
        continue;
      }
      if (addons.some((a) => a.id === store.id)) continue;
      const version = item.version && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(item.version) ? item.version : null;
      addons.push({ id: store.id, version, name: store.name });
    }
  }

  // Einstellungen
  let graphics: Record<string, SetupValue> | null = null;
  if (options.graphics) {
    graphics = graphicsFromOptions(optionMap);
    if (instance.heldixClient) Object.assign(graphics, heldixProfileFrom(await readJson<Record<string, unknown>>(path.join(gameDir, HELDIX_CONFIG))));
    if (Object.keys(graphics).length === 0) graphics = null;
  }
  let keys: Record<string, string> | null = null;
  if (options.keys) {
    keys = keysFromOptions(optionMap);
    if (Object.keys(keys).length === 0) keys = null;
  }

  const content: SetupContent = {
    v: 1,
    minecraft: instance.minecraft,
    loader: instance.loader,
    heldixClient: instance.heldixClient,
    mods: lists.mods,
    resourcepacks: lists.resourcepacks,
    shaderpacks: lists.shaderpacks,
    addons,
    settings: { graphics, keys },
  };
  const items: SharedSetupDraftItem[] = [
    ...MODRINTH_KINDS.flatMap((kind) => lists[kind].map((e) => ({ kind, title: e.title }))),
    ...addons.map((a) => ({ kind: 'addons' as const, title: a.name })),
  ];
  return { content, items, notShared, graphics: graphics ? Object.keys(graphics).length : 0, keys: keys ? Object.keys(keys).length : 0 };
}

// ---------- Vorschau ----------

/** Vorschau ohne Inhalt: gibt es nicht, abgelaufen/widerrufen oder Fehler */
export function emptySetupPreview(code: string, status: 'missing' | 'gone' | 'error', error: string | null): SharedSetupPreview {
  return {
    code, status, error, name: '', description: '', creator: null, created: 0, expires: null, views: 0, installs: 0,
    minecraft: '', loader: 'vanilla', heldixClient: false, items: [], graphics: [], keys: 0, problem: null, notes: [],
  };
}

/** Vorschau für den Dialog; checkTarget = warum eine Instanz mit Minecraft-Version und Loader hier nicht geht */
export async function previewSetup(
  setup: PublicSetup,
  deps: { serviceUrl: string; publicKey: string | null; checkTarget(minecraft: string, loader: SetupLoader): Promise<string | null> },
): Promise<SharedSetupPreview> {
  const { content } = setup;
  const [modrinth, store, problem] = await Promise.all([
    resolveModrinth(content),
    content.addons.length && content.heldixClient ? fetchStore(deps.serviceUrl, deps.publicKey).catch(() => null) : Promise.resolve([] as StoreEntry[]),
    deps.checkTarget(content.minecraft, content.loader).catch((error: unknown) => message(error)),
  ]);
  const notes: string[] = [];
  if (setup.dropped) notes.push(fill(SETUP_TEXT.dropped, { anzahl: setup.dropped }));
  if (modrinth.error) notes.push(SETUP_TEXT.modrinthLater);
  if (store === null) notes.push(SETUP_TEXT.storeLater);
  const items: SharedSetupPreviewItem[] = [
    ...modrinth.items.map((item) => ({ kind: item.kind, title: item.title, version: item.version?.number ?? null, iconUrl: item.iconUrl, icon: null, state: item.state, note: item.note })),
    ...resolveAddons(content, store).map((item) => ({
      kind: 'addons' as const,
      title: item.title,
      version: item.manifest?.version ?? item.entry.version,
      iconUrl: null,
      icon: item.icon,
      state: item.state,
      note: item.note,
    })),
  ];
  return {
    code: setup.code,
    status: 'ok',
    error: null,
    name: setup.name,
    description: setup.description,
    creator: setup.creator,
    created: setup.created,
    expires: setup.expires,
    views: setup.views,
    installs: setup.installs,
    minecraft: content.minecraft,
    loader: content.loader,
    heldixClient: content.heldixClient,
    items,
    graphics: graphicsSummary(content.settings.graphics),
    keys: Object.keys(content.settings.keys ?? {}).length,
    problem,
    notes,
  };
}

// ---------- Nachbauen ----------

export interface InstallDeps {
  instances: InstanceStore;
  serviceUrl: string;
  publicKey: string | null;
  /** warum eine Instanz mit Minecraft-Version und Loader hier nicht geht (null = geht) */
  checkTarget(minecraft: string, loader: SetupLoader): Promise<string | null>;
  /** Gesamtfortschritt (ein Schritt je Datei bzw. Addon) */
  onProgress?: ProgressFn;
  /** „installiert“ beim Dienst melden */
  markInstalled?(code: string): Promise<void>;
  log?(line: string): void;
}

/** Farbe der neuen Instanz (fest je Code, damit dasselbe Setup gleich aussieht) */
function colorFor(code: string): string {
  let sum = 0;
  for (const char of code) sum = (sum * 31 + char.charCodeAt(0)) >>> 0;
  return INSTANCE_COLORS[sum % INSTANCE_COLORS.length];
}

/**
 * „Als neue Instanz anlegen“: Instanz anlegen, alles laden (Modrinth: SHA-1 und Größe; Store: Signatur und SHA-256),
 * Einstellungen übernehmen, beim Dienst „installiert“ melden. Wirft nur, wenn die Instanz gar nicht angelegt werden kann.
 */
export async function installSetup(setup: PublicSetup, options: { name?: unknown; graphics?: unknown; keys?: unknown }, deps: InstallDeps): Promise<SharedSetupResult> {
  const { content } = setup;
  const problem = await deps.checkTarget(content.minecraft, content.loader);
  if (problem) throw new Error(problem);
  const name = cleanLine(options.name, SETUP_NAME_MAX) || setup.name;
  let config = await deps.instances.create({ name, minecraft: content.minecraft, loader: content.loader, color: colorFor(setup.code) });
  if (content.loader === 'fabric' && !content.heldixClient) config = await deps.instances.update(config.id, { heldixClient: false });
  const gameDir = deps.instances.dir(config.id);
  const result: SharedSetupResult = { instanceId: config.id, instanceName: config.name, installed: [], skipped: [], notes: [], graphics: 0, keys: 0 };
  if (setup.dropped) result.notes.push(fill(SETUP_TEXT.dropped, { anzahl: setup.dropped }));
  deps.log?.(`Setup „${setup.name}“ wird als Instanz „${config.name}“ angelegt`);

  const modrinth = await resolveModrinth(content);
  const withClient = usesHeldixClient(config);
  const storeEntries = content.addons.length && withClient ? await fetchStore(deps.serviceUrl, deps.publicKey).catch(() => null) : null;
  const addons = content.addons.length ? resolveAddons(content, withClient ? storeEntries : []) : [];
  const total = modrinth.items.length + addons.length;
  let done = 0;
  const step = (stage: string) => deps.onProgress?.({ stage, done: done++, total: Math.max(total, 1) });
  const skip = (kind: SharedSetupKind, title: string, reason: string) => result.skipped.push({ kind, title, reason });

  // ---- Dateien von Modrinth ----
  const modsDir = contentDir(gameDir, 'mods');
  const modIndexFile = path.join(modsDir, MODRINTH_INDEX);
  const modIndex = (await readJson<ModrinthIndex>(modIndexFile)) ?? {};
  const shaderDir = path.join(gameDir, SHADERPACK_DIR);
  const shaderIndexFile = path.join(shaderDir, SHADERPACK_INDEX);
  const shaderIndex = (await readJson<Record<string, { projectId: string; versionId: string; title: string }>>(shaderIndexFile)) ?? {};
  const packDir = path.join(gameDir, RESOURCEPACK_DIR);
  const taken = new Set<string>();
  const installedMods: ModrinthVersion[] = [];
  const installedShaders: string[] = [];
  const installedPacks: string[] = [];
  const dirOf: Record<ModrinthKind, string> = { mods: modsDir, shaderpacks: shaderDir, resourcepacks: packDir };

  const download = async (kind: ModrinthKind, file: ModrinthFile, title: string) => {
    await syncFiles([{ url: file.url, dest: path.join(dirOf[kind], file.filename), sha1: file.sha1, size: file.size }], { stage: title, verify: 'sha1' });
  };

  for (const item of modrinth.items) {
    step(item.title);
    if (!item.version || !item.file || item.state === 'skip') {
      skip(item.kind, item.title, item.note ?? (modrinth.error ? SETUP_TEXT.modrinthDown : SETUP_TEXT.versionGone));
      continue;
    }
    const key = `${item.kind}/${item.file.filename.toLowerCase()}`;
    if (taken.has(key)) {
      skip(item.kind, item.title, SETUP_TEXT.sameFile);
      continue;
    }
    try {
      await download(item.kind, item.file, item.title);
    } catch (error) {
      skip(item.kind, item.title, message(error));
      continue;
    }
    taken.add(key);
    if (item.kind === 'mods') {
      modIndex[item.file.filename] = { projectId: item.entry.project, versionId: item.version.id, title: item.title };
      installedMods.push(item.version);
    } else if (item.kind === 'shaderpacks') {
      shaderIndex[item.file.filename] = { projectId: item.entry.project, versionId: item.version.id, title: item.title };
      installedShaders.push(item.file.filename);
    } else installedPacks.push(item.file.filename);
    result.installed.push({ kind: item.kind, title: item.title });
    if (item.state === 'warn' && item.note) result.notes.push(`${item.title}: ${item.note}`);
  }

  // fehlende Pflicht-Abhängigkeiten der Mods (z. B. ein Setup von Hand gebaut), höchstens drei Runden
  if (installedMods.length) {
    const present = new Set(Object.values(modIndex).map((e) => e.projectId));
    let pending = installedMods;
    for (let round = 0; round < 3 && pending.length; round++) {
      const missing = new Map<string, { version: string | null; by: string }>();
      for (const version of pending) {
        const by = Object.values(modIndex).find((e) => e.versionId === version.id)?.title ?? version.project;
        for (const dep of version.dependencies) {
          if (dep.type !== 'required' || !dep.project || dep.project === FABRIC_API_PROJECT || present.has(dep.project) || missing.has(dep.project)) continue;
          missing.set(dep.project, { version: dep.version, by });
        }
      }
      pending = [];
      if (missing.size === 0) break;
      const titles = await modrinthProjects([...missing.keys()]).catch(() => new Map<string, ModrinthProject>());
      for (const [project, { version: wanted, by }] of missing) {
        present.add(project);
        const title = titles.get(project)?.title ?? project;
        try {
          const version = wanted ? (await modrinthVersions([wanted])).get(wanted) ?? null : await latestFabricVersion(project, content.minecraft);
          if (!version || version.project !== project) throw new Error(SETUP_TEXT.versionGone);
          if (version.loaders.length > 0 && !version.loaders.includes('fabric')) throw new Error(SETUP_TEXT.wrongLoader.mods);
          const file = pickModrinthFile(version, 'mods');
          if (!file) throw new Error(SETUP_TEXT.badFile);
          if (taken.has(`mods/${file.filename.toLowerCase()}`)) continue;
          await download('mods', file, title);
          taken.add(`mods/${file.filename.toLowerCase()}`);
          modIndex[file.filename] = { projectId: project, versionId: version.id, title };
          pending.push(version);
          result.installed.push({ kind: 'mods', title });
          result.notes.push(fill(SETUP_TEXT.dependency, { mod: by, abhaengigkeit: title }));
        } catch (error) {
          result.notes.push(fill(SETUP_TEXT.dependencyFailed, { abhaengigkeit: title, grund: message(error) }));
        }
      }
    }
  }
  if (Object.keys(modIndex).length) await writeJson(modIndexFile, modIndex);
  if (installedMods.length) result.notes.push(...(await fixFabricConflicts(gameDir).catch(() => [] as string[])));

  // Shaderpacks: Iris bei Bedarf, das erste Pack einschalten
  if (installedShaders.length) {
    await writeJson(shaderIndexFile, shaderIndex);
    if (!Object.values(modIndex).some((e) => e.projectId === IRIS_PROJECT)) {
      try {
        const mods = await ensureIris(gameDir, content.minecraft);
        if (mods.length) result.notes.push(fill(SETUP_TEXT.irisAdded, { mods: mods.join(', ') }));
      } catch (error) {
        result.notes.push(fill(SETUP_TEXT.irisFailed, { grund: message(error) }));
      }
    }
    await setActiveShaderpack(gameDir, installedShaders[0]).catch(() => undefined);
  }

  // ---- Addons aus dem Store ----
  if (addons.length) {
    const entries = storeEntries;
    for (const item of addons) {
      step(item.title);
      if (item.state === 'skip' || !withClient) {
        skip('addons', item.title, item.note ?? SETUP_TEXT.addonsNeedClient);
        continue;
      }
      if (!entries) {
        skip('addons', item.title, SETUP_TEXT.storeDown);
        continue;
      }
      try {
        const installed = await installStoreAddon(gameDir, deps.serviceUrl, deps.publicKey, item.entry.id, entries, { minecraft: content.minecraft, loader: content.loader });
        result.installed.push({ kind: 'addons', title: installed });
        if (item.state === 'warn' && item.note) result.notes.push(`${installed}: ${item.note}`);
      } catch (error) {
        skip('addons', item.title, message(error));
      }
    }
  }
  deps.onProgress?.({ stage: 'Fertig', done: Math.max(total, 1), total: Math.max(total, 1) });

  // ---- Einstellungen ----
  const accepted = acceptedGraphics(options.graphics === true ? content.settings.graphics : null);
  const keyLines = acceptedKeys(options.keys === true ? content.settings.keys : null);
  const lines = { ...accepted.options, ...keyLines };
  if (Object.keys(lines).length || installedPacks.length) await writePendingOptions(gameDir, { v: 1, options: lines, resourcePacks: installedPacks });
  const profile = withClient ? await applyHeldixProfile(gameDir, accepted.heldix).catch(() => 0) : 0;
  result.graphics = Object.keys(accepted.options).length + profile;
  result.keys = Object.keys(keyLines).length;

  await deps.markInstalled?.(setup.code).catch(() => undefined);
  deps.log?.(`Setup angelegt: ${result.installed.length} installiert, ${result.skipped.length} übersprungen`);
  return result;
}

// ---------- Teilen ----------

/** Name und Beschreibung aus dem Dialog prüfen */
export function shareMeta(raw: { name?: unknown; description?: unknown }, fallback: string): { name: string; description: string } {
  return { name: cleanLine(raw.name, SETUP_NAME_MAX) || cleanLine(fallback, SETUP_NAME_MAX) || 'Mein Setup', description: cleanLine(raw.description, SETUP_DESCRIPTION_MAX) };
}

/** Ergebnis für die Oberfläche nach POST /v1/setups */
export function sharedResult(created: { code: string; url: string; expires: number | null }, built: BuiltSetup): SharedSetupCreated {
  return { code: created.code, url: created.url, appUrl: setupAppUrl(created.code), expires: created.expires, items: built.items.length, notShared: built.notShared };
}
