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
import type { StoreAddon } from '../../shared/api';
import { LAUNCHER_NAME, LAUNCHER_VERSION } from '../config';
import { compareVersions, contentDir, listContent, readAddonMeta } from './content';

export const ADDON_SIGNATURE_PREFIX = 'heldix-addon\n';
/** Höchste Heldix-API-Stufe, die die mitgelieferte HeldixClient-Mod kann (HeldixApi.API_VERSION, geprüft beim Bauen) */
export const HELDIX_ADDON_API = 2;
/** Dateien, die das Spiel beim nächsten Start entfernen soll (gesperrte JARs unter Windows), eine pro Zeile */
export const PENDING_REMOVALS = '.entfernen';
/** Ersatz für eine im Spiel gesperrte JAR gleichen Namens (legt das Spiel an) */
const REPLACEMENT = '.neu';

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const CATEGORIES = ['hud', 'musik', 'chat', 'werkzeuge', 'sonstiges'] as const;
const PLATFORMS = ['windows', 'mac', 'linux'] as const;
const MAX_SIZE = 50 * 1024 * 1024;

export type AddonPlatform = (typeof PLATFORMS)[number];

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
}

async function request(url: string): Promise<Response> {
  try {
    return await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': `${LAUNCHER_NAME}/${LAUNCHER_VERSION}` }, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new Error('Der Addon-Store ist gerade nicht erreichbar. Bitte später noch einmal versuchen.');
  }
}

/** Liste des Stores; Einträge mit ungültiger Signatur fallen heraus. */
export async function fetchStore(serviceUrl: string, publicKey: string | null): Promise<StoreEntry[]> {
  if (!serviceUrl) throw new Error('Kein Heldix-Dienst eingerichtet – der Addon-Store ist aus.');
  if (!publicKey) throw new Error('Dieser Launcher kennt keinen Signatur-Schlüssel – der Addon-Store ist aus.');
  const response = await request(`${serviceUrl.replace(/\/+$/, '')}/v1/addons`);
  if (!response.ok) throw new Error(`Der Addon-Store antwortet nicht richtig (${response.status}).`);
  const data = (await response.json()) as { addons?: unknown };
  const result: StoreEntry[] = [];
  for (const entry of Array.isArray(data.addons) ? data.addons : []) {
    const e = entry as { manifest?: unknown; signature?: unknown; downloads?: unknown };
    try {
      const manifest = verifyAddonManifest(String(e.manifest), String(e.signature), publicKey);
      result.push({ manifest, downloads: Number.isFinite(e.downloads) ? Number(e.downloads) : 0 });
    } catch (error) {
      console.warn('Addon-Store: Eintrag verworfen –', error instanceof Error ? error.message : error);
    }
  }
  return result;
}

const PLATFORM_LABEL: Record<AddonPlatform, string> = { windows: 'Windows', mac: 'macOS', linux: 'Linux' };

/** Warum das Addon hier nicht läuft (oder null) */
function incompatibility(manifest: AddonManifest): { state: 'unsupported-api' | 'unsupported-platform'; reason: string } | null {
  if (manifest.api > HELDIX_ADDON_API) return { state: 'unsupported-api', reason: `Braucht einen neueren HeldixClient (Addon-API ${manifest.api})` };
  if (manifest.platforms.length > 0 && !manifest.platforms.includes(currentPlatform())) {
    return { state: 'unsupported-platform', reason: `Nur für ${manifest.platforms.map((p) => PLATFORM_LABEL[p]).join(' und ')}` };
  }
  return null;
}

/** Store-Liste mit dem Zustand in einer Instanz (installiert, Update, …). */
export async function storeForInstance(gameDir: string, serviceUrl: string, publicKey: string | null): Promise<StoreAddon[]> {
  const entries = await fetchStore(serviceUrl, publicKey);
  const installed = (await listContent(gameDir, 'addons', 'heldix')).filter((item) => item.id);
  return entries.map(({ manifest, downloads }) => {
    const present = installed
      .filter((item) => item.id === manifest.id)
      .sort((a, b) => compareVersions(b.version, a.version))[0];
    const problem = incompatibility(manifest);
    const state: StoreAddon['state'] = present
      ? compareVersions(manifest.version, present.version) > 0 && !problem
        ? 'update'
        : 'installed'
      : (problem?.state ?? 'available');
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
      state,
      reason: problem?.reason ?? null,
      installedVersion: present?.version ?? null,
      installedEnabled: present ? present.enabled : null,
    };
  });
}

/** Lädt ein Addon aus dem Store, prüft es und legt es in die Instanz (ältere Versionen werden ersetzt). Gibt den Namen zurück. */
export async function installStoreAddon(gameDir: string, serviceUrl: string, publicKey: string | null, id: string): Promise<string> {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('Ungültige Addon-ID');
  const entry = (await fetchStore(serviceUrl, publicKey)).find((e) => e.manifest.id === id);
  if (!entry) throw new Error('Dieses Addon gibt es im Store nicht (mehr).');
  const { manifest } = entry;
  const problem = incompatibility(manifest);
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

function pendingFile(gameDir: string): string {
  return path.join(contentDir(gameDir, 'addons'), PENDING_REMOVALS);
}

/** Vom Spiel vorgemerkte Löschungen ausführen und Ersatz-JARs (.jar.neu) einsetzen (nur, wenn die Instanz nicht läuft). */
export async function applyPendingRemovals(gameDir: string): Promise<void> {
  const dir = contentDir(gameDir, 'addons');
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
