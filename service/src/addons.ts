// Addon-Store: Heldix-Addons (JAR plus signiertes Manifest) für Launcher, Spiel und Webseite.
// Veröffentlicht wird nur mit einer gültigen Ed25519-Signatur des Update-Schlüssels über "heldix-addon\n" + Manifest:
// offizielle Addons des Teams direkt im Team-Bereich (Admin), Addons von Spielern nach der Prüfung (Freigabe = ein Admin
// signiert im Browser das Manifest, das der Dienst für die Einreichung erzeugt hat). So kann auch ein übernommenes
// Team-Konto kein fremdes Addon ausliefern, und ein Launcher-Update (signiert ohne Präfix) ist nie als Addon gültig und
// umgekehrt. Clients prüfen die Signatur selbst.
import { createHash, randomBytes, verify, type KeyObject } from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { DELETED_OWNER, type AddonRow, type AddonScreenshot, type AddonVersionRow, type Store } from './db';
import { HttpError } from './http';
import { IMAGE_CONTENT_TYPES, IMAGE_EXTENSIONS } from './images';
import { checkUploadLength, compareVersions, hashFile, isVersion, receiveFile, resolveInDir, sendFile } from './updates';
import { codePointLength, hasForbiddenChars, isName, isUuid } from './validate';

/** Steht vor dem Manifest-Text, wenn signiert wird (Domänentrennung zu den Launcher-Updates). */
export const ADDON_SIGNATURE_PREFIX = 'heldix-addon\n';
/** Größte Addon-Datei (JAR) und damit größter Upload. */
export const MAX_ADDON_SIZE = 50 * 1024 * 1024;
/** Größtes Manifest (UTF-8). Alle Felder voll ausgeschöpft ergeben weniger als die Hälfte. */
export const MAX_ADDON_MANIFEST_BYTES = 64 * 1024;
/** Grenze für den Körper von `PUT /v1/team/addons/manifest` (das Manifest steckt als JSON-Text im JSON). */
export const ADDON_MANIFEST_BODY_LIMIT = 256 * 1024;
/** Höchstens so viele Screenshots je Addon. */
export const MAX_SCREENSHOTS = 4;

export const ADDON_CATEGORIES = ['hud', 'musik', 'chat', 'werkzeuge', 'sonstiges'] as const;
export type AddonCategory = (typeof ADDON_CATEGORIES)[number];
export const ADDON_PLATFORMS = ['windows', 'mac', 'linux'] as const;
export type AddonPlatform = (typeof ADDON_PLATFORMS)[number];
/** Zugriff: nur die Heldix-API, oder (mit clientEntrypoint/transformers) direkt in Minecraft. */
export const ADDON_ACCESS = ['api', 'minecraft'] as const;
export type AddonAccess = (typeof ADDON_ACCESS)[number];
/** Wo ein Addon läuft: Heldix-Instanzen (Heldix Loader) und/oder Fabric-Instanzen. */
export const ADDON_LOADERS = ['heldix', 'fabric'] as const;
export type AddonLoader = (typeof ADDON_LOADERS)[number];
/** Eine Minecraft-Version im Manifest, z. B. 26.3, 1.21.11 oder 26.x (wie im Launcher). */
export const MINECRAFT_VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._+*-]{0,31}$/;
/** Höchstens so viele Minecraft-Versionen in „minecraft“ (wie im Launcher). */
export const MAX_MINECRAFT_VERSIONS = 50;

/** Loader, wenn das Manifest (oder heldix.addon.json) keine nennt: API-Addons überall, Eingriffe in Minecraft nur im Heldix Loader. */
export function defaultLoaders(access: AddonAccess): AddonLoader[] {
  return access === 'api' ? [...ADDON_LOADERS] : ['heldix'];
}

/** „minecraft“: Liste aus 0–16 Versionen nach MINECRAFT_VERSION_RE, ohne Doppelte. */
export function isMinecraftList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_MINECRAFT_VERSIONS &&
    value.every((v) => typeof v === 'string' && MINECRAFT_VERSION_RE.test(v)) &&
    new Set(value).size === value.length
  );
}

/** „loaders“: nicht leere Liste aus heldix und fabric, ohne Doppelte. */
export function isLoaderList(value: unknown): value is AddonLoader[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((v) => typeof v === 'string' && (ADDON_LOADERS as readonly string[]).includes(v)) &&
    new Set(value).size === value.length
  );
}

export const MINECRAFT_LIST_PROBLEM = `„minecraft“ muss eine Liste mit höchstens ${MAX_MINECRAFT_VERSIONS} Minecraft-Versionen sein (z. B. 26.3, 1.21.11 oder 26.x; ohne Doppelte)`;
export const MINECRAFT_MISSING = '„minecraft“ darf nicht leer sein, wenn das Addon in Minecraft eingreift („access“: minecraft)';
export const LOADERS_PROBLEM = '„loaders“ muss eine nicht leere Liste aus heldix und fabric sein (ohne Doppelte)';

/** ID wie in `heldix.addon.json`. */
export const ADDON_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
/** `heldix-addon-<id>-<version>.jar` */
export const ADDON_FILE_RE = /^heldix-addon-[a-z0-9][a-z0-9_-]{0,39}-\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?\.jar$/;
/** Name aus dem Heldix-Icon-Set; unbekannte zeigen die Clients als Puzzleteil. */
export const ICON_RE = /^[a-z0-9-]{1,30}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
/** ISO 8601: Datum, auf Wunsch mit Uhrzeit (Sekunden, Bruchteile und Zeitzone freiwillig). */
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))?)?$/;
/** Einzelne Ersatzzeichen (kein gültiges UTF-16): Die signierten Bytes wären nicht eindeutig. */
const LONE_SURROGATE_RE = /\p{Cs}/u;
/** Dateien im Ordner der Screenshots: `<id>-<16 Hex>.<png|jpg>` */
const SCREENSHOT_FILE_RE = /^[a-z0-9][a-z0-9_-]{0,39}-[0-9a-f]{16}\.(?:png|jpg)$/;

export const NO_SUCH_ADDON = 'Dieses Addon gibt es nicht.';
export const WRONG_SIGNATURE = 'Die Signatur stimmt nicht.';
export const ID_TAKEN = 'Diese Addon-ID gehört schon jemand anderem.';
/** So heißt der Autor eines Addons, dessen Konto gelöscht wurde. */
export const DELETED_AUTHOR = 'Gelöschter Spieler';
const NO_SUCH_FILE = 'Diese Datei gibt es nicht.';
const NO_SUCH_VERSION = 'Diese Version gibt es nicht.';
const NO_SUCH_AUTHOR = 'Diesen Entwickler gibt es im Addon-Store nicht.';
const NO_SUCH_SCREENSHOT = 'Diesen Screenshot gibt es nicht.';
const INVALID_NAME = 'Ungültiger Dateiname (erwartet: heldix-addon-<id>-<version>.jar).';
const BUSY = 'Mit dieser Datei passiert gerade schon etwas (Hochladen, Veröffentlichen oder Löschen). Bitte kurz warten.';
const CONTENT_TYPE = 'application/java-archive';
/** Eine veröffentlichte Datei ändert sich nie (Name = Addon und Version, ersetzen geht nicht). */
const FILE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
/** Screenshots tauschen ihren Dateinamen bei jeder Änderung; `screenshotsVersion` hilft dem Cache der Clients. */
const SCREENSHOT_CACHE_CONTROL = 'public, max-age=86400';
/** Verwaiste Screenshots erst löschen, wenn sie so alt sind (eine Freigabe könnte sie gerade eintragen). */
const ORPHAN_GRACE_MS = 10 * 60_000;

export interface AddonAuthor {
  uuid: string;
  name: string;
}

/** Das geprüfte Manifest (bekannte Felder; unbekannte Zusatzfelder bleiben nur im signierten Text). */
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
  category: AddonCategory;
  platforms: AddonPlatform[];
  file: string;
  size: number;
  sha256: string;
  date: string;
  notes: string[];
  /** vom Team (`npm run addon`); fehlt es (ältere Manifeste), gilt false */
  official: boolean;
  /** Einreicher bei Community-Addons, null bei offiziellen (und älteren Manifesten) */
  author: AddonAuthor | null;
  /** fehlt es (Manifeste vor Version 1.6.1), gilt api */
  access: AddonAccess;
  /** Minecraft-Versionen; leer = jede (nur bei api). Fehlt es, gilt [] */
  minecraft: string[];
  /** fehlt es, gilt defaultLoaders(access) */
  loaders: AddonLoader[];
}

/** Die Bytes, über die die Signatur läuft: UTF-8 von `"heldix-addon\n" + manifest`. */
export function addonSignedBytes(manifest: string): Buffer {
  return Buffer.from(ADDON_SIGNATURE_PREFIX + manifest, 'utf8');
}

/** Prüft die Signatur (Ed25519, Base64) eines Addon-Manifests mit dem öffentlichen Update-Schlüssel. */
export function verifyAddonSignature(manifest: string, signature: string, key: KeyObject): boolean {
  const bytes = Buffer.from(signature, 'base64');
  if (bytes.length !== 64) return false;
  try {
    return verify(null, addonSignedBytes(manifest), key, bytes);
  } catch {
    return false;
  }
}

/** Ein Text des Manifests, genau wie signiert (ohne Trimmen): Fehlertext oder null. */
function textProblem(value: unknown, label: string, min: number, max: number, multiline = false): string | null {
  if (typeof value !== 'string') return `${label} fehlt oder ist kein Text`;
  if (hasForbiddenChars(value, multiline)) {
    return multiline
      ? `${label} enthält Zeichen, die nicht erlaubt sind (Zeilenumbrüche nur als \\n, keine Tabs oder Steuerzeichen)`
      : `${label} enthält Zeichen, die nicht erlaubt sind (auch keine Zeilenumbrüche)`;
  }
  if (min > 0 && value.trim() === '') return `${label} darf nicht leer sein`;
  if (codePointLength(value) > max) return `${label} ist zu lang (höchstens ${max} Zeichen)`;
  return null;
}

function listProblem(value: unknown, field: string, min: number, max: number, itemMax: number): string | null {
  if (!Array.isArray(value)) return `„${field}“ fehlt oder ist keine Liste`;
  if (value.length < min || value.length > max) return `„${field}“ muss ${min} bis ${max} Einträge haben`;
  for (let i = 0; i < value.length; i++) {
    const problem = textProblem(value[i], `„${field}“ (Eintrag ${i + 1})`, 1, itemMax);
    if (problem) return problem;
  }
  return null;
}

/** Datum nach ISO 8601, das es wirklich gibt (kein 30. Februar). */
function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [, y, mo, d, h = '0', mi = '0', s = '0', oh = '0', om = '0'] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  return Number(h) <= 23 && Number(mi) <= 59 && Number(s) <= 59 && Number(oh) <= 23 && Number(om) <= 59;
}

/** `author`: null (oder fehlt) oder `{ uuid, name }` eines Spielers. Fehlertext oder das Ergebnis. */
function checkAuthor(value: unknown): AddonAuthor | null | string {
  if (value === undefined || value === null) return null;
  const a = value as Record<string, unknown>;
  if (typeof value !== 'object' || Array.isArray(value) || !isUuid(a.uuid) || !isName(a.name)) {
    return '„author“ muss null oder { "uuid": "<32 kleine Hex-Zeichen>", "name": "<Spielername>" } sein';
  }
  return { uuid: a.uuid, name: a.name };
}

/**
 * Prüft den Inhalt eines Addon-Manifests (das geparste JSON). Liefert die bekannten Felder oder einen deutschen
 * Hinweis, was nicht stimmt. Unbekannte Zusatzfelder sind erlaubt und werden ignoriert.
 */
export function checkAddonManifest(value: unknown): AddonManifest | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'Das Manifest ist kein JSON-Objekt';
  const m = value as Record<string, unknown>;
  if (m.type !== 'heldix-addon') return '„type“ muss „heldix-addon“ sein';
  if (typeof m.id !== 'string' || !ADDON_ID_RE.test(m.id)) {
    return '„id“ ist ungültig (1–40 Zeichen aus a–z, 0–9, _ und -, am Anfang a–z oder 0–9)';
  }
  const problem =
    textProblem(m.name, '„name“', 1, 40) ??
    (isVersion(m.version) ? null : '„version“ ist ungültig (erwartet z. B. 1.2.0 oder 1.2.0-beta.1)') ??
    textProblem(m.summary, '„summary“', 1, 200) ??
    textProblem(m.description, '„description“', 0, 4000, true) ??
    listProblem(m.authors, 'authors', 1, 5, 40);
  if (problem) return problem;
  if (typeof m.api !== 'number' || !Number.isInteger(m.api) || m.api < 1 || m.api > 99) return '„api“ muss eine ganze Zahl von 1 bis 99 sein';
  if (typeof m.icon !== 'string' || !ICON_RE.test(m.icon)) return '„icon“ ist ungültig (1–30 Zeichen aus a–z, 0–9 und -)';
  if (typeof m.category !== 'string' || !(ADDON_CATEGORIES as readonly string[]).includes(m.category)) {
    return `„category“ muss eins von ${ADDON_CATEGORIES.join(', ')} sein`;
  }
  const platforms = m.platforms;
  if (
    !Array.isArray(platforms) ||
    !platforms.every((p) => typeof p === 'string' && (ADDON_PLATFORMS as readonly string[]).includes(p)) ||
    new Set(platforms).size !== platforms.length
  ) {
    return '„platforms“ muss eine Liste aus windows, mac und linux sein (ohne Doppelte; leer = alle Systeme)';
  }
  const file = `heldix-addon-${m.id}-${m.version as string}.jar`;
  if (m.file !== file) return `„file“ muss genau ${file} heißen`;
  if (typeof m.size !== 'number' || !Number.isSafeInteger(m.size) || m.size < 1 || m.size > MAX_ADDON_SIZE) {
    return `„size“ muss eine ganze Zahl von 1 bis ${MAX_ADDON_SIZE} sein (höchstens 50 MiB)`;
  }
  if (typeof m.sha256 !== 'string' || !SHA256_RE.test(m.sha256)) return '„sha256“ muss aus 64 kleinen Hex-Zeichen bestehen';
  if (!isIsoDate(m.date)) return '„date“ ist kein gültiges Datum nach ISO 8601 (z. B. 2026-11-25)';
  const notes = listProblem(m.notes, 'notes', 0, 20, 300);
  if (notes) return notes;
  if (m.official !== undefined && typeof m.official !== 'boolean') return '„official“ muss true oder false sein';
  const author = checkAuthor(m.author);
  if (typeof author === 'string') return author;
  const official = m.official === true;
  if (official && author !== null) return 'Offizielle Addons haben keinen „author“ (null)';
  // Manifest v2 (ab 1.6.1): Zugriff, Minecraft-Versionen und Loader; ältere Manifeste: api, [], heldix und fabric
  if (m.access !== undefined && !(ADDON_ACCESS as readonly unknown[]).includes(m.access)) return '„access“ muss api oder minecraft sein';
  const access: AddonAccess = m.access === 'minecraft' ? 'minecraft' : 'api';
  if (m.minecraft !== undefined && !isMinecraftList(m.minecraft)) return MINECRAFT_LIST_PROBLEM;
  const minecraft = m.minecraft === undefined ? [] : [...(m.minecraft as string[])];
  if (access === 'minecraft' && minecraft.length === 0) return MINECRAFT_MISSING;
  if (m.loaders !== undefined && !isLoaderList(m.loaders)) return LOADERS_PROBLEM;
  const loaders = m.loaders === undefined ? defaultLoaders(access) : [...(m.loaders as AddonLoader[])];
  return {
    type: 'heldix-addon',
    id: m.id,
    name: m.name as string,
    version: m.version as string,
    summary: m.summary as string,
    description: m.description as string,
    authors: [...(m.authors as string[])],
    api: m.api,
    icon: m.icon,
    category: m.category as AddonCategory,
    platforms: [...(platforms as AddonPlatform[])],
    file,
    size: m.size,
    sha256: m.sha256,
    date: m.date,
    notes: [...(m.notes as string[])],
    official,
    author,
    access,
    minecraft,
    loaders,
  };
}

/** Neueste Version zuerst (Vergleich wie bei Launcher-Updates: Vorabversion < fertige Version). */
function newestFirst(rows: AddonVersionRow[]): AddonVersionRow[] {
  return [...rows].sort((a, b) => compareVersions(b.version, a.version));
}

function groupById(rows: AddonVersionRow[]): Map<string, AddonVersionRow[]> {
  const map = new Map<string, AddonVersionRow[]>();
  for (const row of rows) {
    const list = map.get(row.id);
    if (list) list.push(row);
    else map.set(row.id, [row]);
  }
  return map;
}

const collator = new Intl.Collator('de', { sensitivity: 'base' });

function byName(a: { name: string; id: string }, b: { name: string; id: string }): number {
  return collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Kurzer Hash über die Dateinamen der Screenshots: ändert sich mit jedem neuen Satz Bilder. */
function screenshotsVersion(screenshots: AddonScreenshot[]): string {
  return createHash('sha256')
    .update(screenshots.map((s) => s.file).join('\n'))
    .digest('hex')
    .slice(0, 12);
}

/** Durchschnitt mit einer Nachkommastelle (0 ohne Bewertungen). */
export function ratingView(summary: { average: number; count: number } | undefined): { average: number; count: number } {
  if (!summary || summary.count === 0) return { average: 0, count: 0 };
  return { average: Math.round(summary.average * 10) / 10, count: summary.count };
}

interface Readable {
  row: AddonVersionRow;
  manifest: AddonManifest;
}

/** Datei einer Einreichung, die beim Freigeben mit ins Addon wandert. */
export interface SubmittedScreenshot {
  /** echter Pfad im Ordner der Einreichungen */
  path: string;
  shot: AddonScreenshot;
}

export class Addons {
  /** Dateien, mit denen gerade etwas passiert (Hochladen, Veröffentlichen, Löschen): je Datei nur eins gleichzeitig. */
  private readonly busy = new Set<string>();
  /** SHA-256 hochgeladener Dateien, gültig solange Größe und Änderungszeit gleich sind (spart das Lesen beim Veröffentlichen). */
  private readonly hashes = new Map<string, { size: number; mtimeMs: number; sha256: string }>();
  /** Gespeicherte Manifeste, die sich nicht mehr lesen lassen (nur einmal ins Log). */
  private readonly warned = new Set<string>();
  /** Ordner der veröffentlichten Screenshots (Unterordner des Addon-Ordners). */
  readonly screenshotsDir: string;

  constructor(
    private readonly store: Store,
    readonly dir: string,
    private readonly log: (line: string) => void,
  ) {
    this.screenshotsDir = path.join(dir, 'screenshots');
  }

  private manifestOf(row: AddonVersionRow): AddonManifest | null {
    let checked: AddonManifest | string;
    try {
      checked = checkAddonManifest(JSON.parse(row.manifest));
    } catch {
      checked = 'kein gültiges JSON';
    }
    if (typeof checked !== 'string') return checked;
    if (!this.warned.has(row.file)) {
      this.warned.add(row.file);
      this.log(`Addon ${row.id} ${row.version}: gespeichertes Manifest ist ungültig (${checked}); die Version bleibt aus dem Store.`);
    }
    return null;
  }

  /** Lesbare Versionen, neueste zuerst. */
  private readable(rows: AddonVersionRow[]): Readable[] {
    const result: Readable[] = [];
    for (const row of newestFirst(rows)) {
      const manifest = this.manifestOf(row);
      if (manifest) result.push({ row, manifest });
    }
    return result;
  }

  /** Sichtbares Addon mit mindestens einer lesbaren Version, oder null. */
  private visible(id: string): { addon: AddonRow; versions: Readable[] } | null {
    if (!ADDON_ID_RE.test(id)) return null;
    const addon = this.store.getAddon(id);
    if (!addon || addon.hidden) return null;
    const versions = this.readable(this.store.addonVersionsOf(id));
    return versions.length > 0 ? { addon, versions } : null;
  }

  /**
   * Addon-Entwickler unter `uuids` (Heldix-Symbol beim Nachschlagen): wer mindestens ein sichtbares, veröffentlichtes
   * Community-Addon hat – dieselbe Bedingung wie für eine Entwicklerseite.
   */
  developersAmong(uuids: string[]): Set<string> {
    const developers = new Set<string>();
    for (const owner of this.store.visibleAddonOwnersIn(uuids)) {
      if (this.store.addonsOwnedBy(owner).some((addon) => !addon.hidden && this.visible(addon.id) !== null)) developers.add(owner);
    }
    return developers;
  }

  /** Sichtbares Addon (für Bewertungen und Meldungen), sonst 404. */
  requireVisible(id: string): AddonRow {
    const found = this.visible(id);
    if (!found) throw new HttpError(404, NO_SUCH_ADDON);
    return found.addon;
  }

  /** Autor für die Anzeige: aus dem signierten Manifest; ist das Konto gelöscht, „Gelöschter Spieler“. */
  private authorOf(addon: AddonRow, manifest: AddonManifest): AddonAuthor | null {
    if (manifest.author === null) return null;
    return addon.owner === DELETED_OWNER ? { uuid: manifest.author.uuid, name: DELETED_AUTHOR } : manifest.author;
  }

  /**
   * Eintrag für Liste und Detail: alle Manifest-Felder, Downloads, Zeitpunkt, signierter Text und Signatur, dazu
   * Bewertung und Screenshots.
   */
  private entry(addon: AddonRow, { row, manifest: m }: Readable, rating: { average: number; count: number } | undefined) {
    return {
      id: m.id,
      name: m.name,
      version: m.version,
      summary: m.summary,
      description: m.description,
      authors: m.authors,
      api: m.api,
      icon: m.icon,
      category: m.category,
      platforms: m.platforms,
      file: m.file,
      size: m.size,
      sha256: m.sha256,
      date: m.date,
      notes: m.notes,
      official: m.official,
      author: this.authorOf(addon, m),
      access: m.access,
      minecraft: m.minecraft,
      loaders: m.loaders,
      downloads: addon.downloads,
      publishedAt: row.publishedAt,
      rating: ratingView(rating),
      screenshots: addon.screenshots.length,
      screenshotsVersion: screenshotsVersion(addon.screenshots),
      manifest: row.manifest,
      signature: row.signature,
    };
  }

  // ---------- Öffentlich ----------

  /** `GET /v1/addons` (auf Wunsch nur die eines Autors): sichtbare Addons mit ihrer neuesten Version, Downloads absteigend, dann Name. */
  list(author?: string) {
    const versions = groupById(this.store.allAddonVersions());
    const ratings = this.store.allAddonRatings();
    const addons = [];
    for (const addon of this.store.listAddons()) {
      if (addon.hidden || (author !== undefined && addon.owner !== author)) continue;
      const [latest] = this.readable(versions.get(addon.id) ?? []);
      if (latest) addons.push(this.entry(addon, latest, ratings.get(addon.id)));
    }
    addons.sort((a, b) => b.downloads - a.downloads || byName(a, b));
    return { addons };
  }

  /** `GET /v1/addons/<id>`: das Addon (neueste Version) und alle Versionen, neueste zuerst. */
  detail(id: string) {
    const found = this.visible(id);
    if (!found) throw new HttpError(404, NO_SUCH_ADDON);
    return {
      addon: this.entry(found.addon, found.versions[0]!, this.store.addonRatingSummary(id)),
      versions: found.versions.map(({ row, manifest }) => ({
        version: row.version,
        date: manifest.date,
        notes: manifest.notes,
        api: manifest.api,
        access: manifest.access,
        minecraft: manifest.minecraft,
        loaders: manifest.loaders,
        size: row.size,
        sha256: row.sha256,
        file: row.file,
        publishedAt: row.publishedAt,
      })),
    };
  }

  /** `GET /v1/addon-authors/<uuid>`: Entwicklerseite mit allen sichtbaren Addons; keine sichtbaren: 404. */
  authorPage(uuid: string) {
    if (!isUuid(uuid)) throw new HttpError(404, NO_SUCH_AUTHOR);
    const { addons } = this.list(uuid);
    if (addons.length === 0) throw new HttpError(404, NO_SUCH_AUTHOR);
    // Aktueller Name beim Dienst; sonst der aus dem neuesten Manifest.
    const name = this.store.getUser(uuid)?.name ?? [...addons].sort((a, b) => b.publishedAt - a.publishedAt)[0]!.author?.name ?? '';
    return { author: { uuid, name }, addons };
  }

  /** Eigene Addons eines Spielers für „Meine Addons“ (auch versteckte): Eintrag plus `hidden`. */
  ownedBy(uuid: string) {
    const ratings = this.store.allAddonRatings();
    const result = [];
    for (const addon of this.store.addonsOwnedBy(uuid)) {
      const [latest] = this.readable(this.store.addonVersionsOf(addon.id));
      if (latest) result.push({ ...this.entry(addon, latest, ratings.get(addon.id)), hidden: addon.hidden });
    }
    return result.sort(byName);
  }

  /** Datei der neuesten Version für `/v1/addons/<id>/download`; unbekannt oder versteckt: 404. */
  latestFile(id: string): string {
    const found = this.visible(id);
    if (!found) throw new HttpError(404, NO_SUCH_ADDON);
    return found.versions[0]!.row.file;
  }

  /** Für `/v1/status`: sichtbare Addons. */
  visibleCount(): number {
    return this.store.countVisibleAddons();
  }

  /**
   * `GET`/`HEAD /v1/addons/<id>/files/<file>`: die JAR einer veröffentlichten Version eines sichtbaren Addons. Ein
   * vollständig ausgeliefertes GET der ganzen Datei zählt einen Download (nur die Zahl, sonst nichts).
   */
  async serve(req: IncomingMessage, res: ServerResponse, id: string, file: string, idleTimeoutMs: number): Promise<void> {
    const row = ADDON_FILE_RE.test(file) ? this.store.addonVersionByFile(file) : undefined;
    const addon = row !== undefined && row.id === id ? this.store.getAddon(id) : undefined;
    if (!addon || addon.hidden) throw new HttpError(404, NO_SUCH_FILE);
    const real = await resolveInDir(this.dir, file);
    if (real === null) throw new HttpError(404, NO_SUCH_FILE);
    await sendFile(req, res, real, {
      name: file,
      contentType: CONTENT_TYPE,
      cacheControl: FILE_CACHE_CONTROL,
      idleTimeoutMs,
      onComplete: () => {
        try {
          this.store.countAddonDownload(id);
        } catch (err) {
          this.log(`Download von ${file} nicht gezählt (${(err as Error).message}).`);
        }
      },
    });
  }

  /** `GET`/`HEAD /v1/addons/<id>/screenshots/<n>` (1–4): Bild eines sichtbaren Addons, sonst 404. */
  async serveScreenshot(req: IncomingMessage, res: ServerResponse, id: string, n: string, idleTimeoutMs: number): Promise<void> {
    const found = this.visible(id);
    const index = /^[1-4]$/.test(n) ? Number(n) - 1 : -1;
    const shot = found && index >= 0 ? found.addon.screenshots[index] : undefined;
    const real = shot && SCREENSHOT_FILE_RE.test(shot.file) ? await resolveInDir(this.screenshotsDir, shot.file) : null;
    if (!shot || real === null) throw new HttpError(404, NO_SUCH_SCREENSHOT);
    await sendFile(req, res, real, {
      name: `${id}-${index + 1}.${IMAGE_EXTENSIONS[shot.type]}`,
      contentType: IMAGE_CONTENT_TYPES[shot.type],
      cacheControl: SCREENSHOT_CACHE_CONTROL,
      idleTimeoutMs,
      disposition: 'inline',
    });
  }

  // ---------- Team-Bereich ----------

  /** Besitzer für das Team: null = offiziell; gelöschtes Konto: `{ uuid: null, name: "Gelöschter Spieler" }`. */
  private ownerView(addon: AddonRow, manifest: AddonManifest | null): { uuid: string | null; name: string } | null {
    if (addon.owner === null) return null;
    if (addon.owner === DELETED_OWNER) return { uuid: null, name: DELETED_AUTHOR };
    return { uuid: addon.owner, name: this.store.getUser(addon.owner)?.name ?? manifest?.author?.name ?? '' };
  }

  /**
   * `GET /v1/team/addons`: alle Addons (auch versteckte) mit Versionen, Offiziell/Community und Besitzer,
   * unveröffentlichte Dateien, Schlüssel (öffentlich, PEM) und was auf das Team wartet.
   */
  async overview(key: KeyObject | null) {
    const all = this.store.allAddonVersions();
    const versions = groupById(all);
    const addons = this.store
      .listAddons()
      .map((addon) => {
        const rows = newestFirst(versions.get(addon.id) ?? []);
        const manifests = rows.map((row) => this.manifestOf(row));
        const latest = manifests.find((m) => m !== null) ?? null;
        return {
          id: addon.id,
          name: latest?.name ?? addon.id,
          hidden: addon.hidden,
          downloads: addon.downloads,
          latest: rows[0]?.version ?? null,
          official: addon.owner === null,
          owner: this.ownerView(addon, latest),
          access: latest?.access ?? 'api',
          minecraft: latest?.minecraft ?? [],
          loaders: latest?.loaders ?? defaultLoaders('api'),
          screenshots: addon.screenshots.length,
          versions: rows.map((row, i) => ({
            version: row.version,
            file: row.file,
            size: row.size,
            sha256: row.sha256,
            date: manifests[i]?.date ?? '',
            notes: manifests[i]?.notes ?? [],
            api: manifests[i]?.api ?? null,
            access: manifests[i]?.access ?? null,
            minecraft: manifests[i]?.minecraft ?? [],
            loaders: manifests[i]?.loaders ?? [],
            publishedAt: row.publishedAt,
            publishedBy: row.publishedBy,
          })),
        };
      })
      .sort(byName);
    return {
      addons,
      pending: await this.pending(new Set(all.map((row) => row.file))),
      keyConfigured: key !== null,
      publicKey: key === null ? null : String(key.export({ type: 'spki', format: 'pem' })),
      pendingSubmissions: this.store.countPendingSubmissions(),
      openReports: this.store.countOpenAddonReports(),
    };
  }

  /** Hochgeladene JARs ohne veröffentlichtes Manifest, zuletzt hochgeladene zuerst. */
  private async pending(published: Set<string>) {
    let names: string[];
    try {
      names = await fs.promises.readdir(this.dir);
    } catch {
      return [];
    }
    const files: { file: string; size: number; uploadedAt: number }[] = [];
    for (const name of names) {
      if (!ADDON_FILE_RE.test(name) || published.has(name)) continue;
      const real = await resolveInDir(this.dir, name);
      const info = real === null ? null : await fs.promises.stat(real).catch(() => null);
      if (info?.isFile()) files.push({ file: name, size: info.size, uploadedAt: Math.floor(info.mtimeMs) });
    }
    return files.sort((a, b) => b.uploadedAt - a.uploadedAt || (a.file < b.file ? -1 : 1));
  }

  private lock(file: string): void {
    if (this.busy.has(file)) throw new HttpError(409, BUSY);
    this.busy.add(file);
  }

  /** `PUT /v1/team/addons/files/<file>`: gestreamt in `<file>.part`, am Ende umbenannt. */
  async receive(req: IncomingMessage, file: string, maxBytes: number, idleTimeoutMs: number): Promise<{ file: string; size: number; sha256: string }> {
    if (!ADDON_FILE_RE.test(file)) throw new HttpError(400, INVALID_NAME);
    checkUploadLength(req, maxBytes);
    if (this.store.addonVersionByFile(file)) {
      throw new HttpError(409, 'Diese Datei gehört zu einer veröffentlichten Version. Sie lässt sich nicht ersetzen.');
    }
    this.lock(file);
    try {
      const received = await receiveFile(req, this.dir, file, maxBytes, idleTimeoutMs);
      this.hashes.set(file, { size: received.size, mtimeMs: received.mtimeMs, sha256: received.sha256 });
      return { file, size: received.size, sha256: received.sha256 };
    } finally {
      this.busy.delete(file);
    }
  }

  /** `DELETE /v1/team/addons/files/<file>`: nur Dateien ohne veröffentlichte Version (sonst 409). */
  async deleteFile(file: string): Promise<void> {
    if (!ADDON_FILE_RE.test(file)) throw new HttpError(404, NO_SUCH_FILE);
    if (this.store.addonVersionByFile(file)) {
      throw new HttpError(409, 'Diese Datei gehört zu einer veröffentlichten Version. Zum Löschen die Version löschen.');
    }
    this.lock(file);
    try {
      if ((await resolveInDir(this.dir, file)) === null) throw new HttpError(404, NO_SUCH_FILE);
      // Den Eintrag im Ordner löschen (bei einem Link den Link, nie sein Ziel).
      await fs.promises.unlink(path.join(await fs.promises.realpath(this.dir), file)).catch(() => {
        throw new HttpError(404, NO_SUCH_FILE);
      });
      this.hashes.delete(file);
    } finally {
      this.busy.delete(file);
    }
  }

  private async sha256(file: string, real: string, info: fs.Stats): Promise<string> {
    const cached = this.hashes.get(file);
    if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached.sha256;
    const sha256 = await hashFile(real, 'sha256', 'hex');
    this.hashes.set(file, { size: info.size, mtimeMs: info.mtimeMs, sha256 });
    return sha256;
  }

  /** Form, Signatur und Felder eines Manifests (gemeinsam für Team-Upload und Freigabe). */
  private checkSigned(manifest: unknown, signature: unknown, key: KeyObject): AddonManifest {
    if (typeof manifest !== 'string' || manifest === '') throw new HttpError(400, 'Ungültiges Addon-Manifest: „manifest“ fehlt oder ist kein Text.');
    if (typeof signature !== 'string' || signature === '') throw new HttpError(400, 'Ungültiges Addon-Manifest: „signature“ fehlt oder ist kein Text.');
    if (Buffer.byteLength(manifest, 'utf8') > MAX_ADDON_MANIFEST_BYTES) {
      throw new HttpError(400, `Ungültiges Addon-Manifest: „manifest“ ist zu groß (höchstens ${MAX_ADDON_MANIFEST_BYTES / 1024} KB).`);
    }
    if (LONE_SURROGATE_RE.test(manifest)) throw new HttpError(400, 'Ungültiges Addon-Manifest: „manifest“ enthält ungültige Zeichen.');
    if (!verifyAddonSignature(manifest, signature, key)) throw new HttpError(400, WRONG_SIGNATURE);
    let parsed: unknown;
    try {
      parsed = JSON.parse(manifest);
    } catch {
      throw new HttpError(400, 'Ungültiges Addon-Manifest: „manifest“ ist kein gültiges JSON.');
    }
    const checked = checkAddonManifest(parsed);
    if (typeof checked === 'string') throw new HttpError(400, `Ungültiges Addon-Manifest: ${checked}.`);
    return checked;
  }

  /** Die Addon-ID muss frei sein oder schon diesem Besitzer gehören (null = Team), sonst 409. */
  private checkOwner(id: string, owner: string | null): void {
    const addon = this.store.getAddon(id);
    if (addon && addon.owner !== owner) throw new HttpError(409, ID_TAKEN);
  }

  /** Die Version muss höher sein als jede vorhandene dieses Addons, sonst 409. */
  checkHigherVersion(id: string, version: string): void {
    const [highest] = newestFirst(this.store.addonVersionsOf(id));
    if (highest && compareVersions(version, highest.version) <= 0) {
      throw new HttpError(409, `Die Version ${version} ist nicht höher als die vorhandene (${highest.version}).`);
    }
  }

  /** Höchste veröffentlichte Version eines Addons (oder null). */
  highestVersion(id: string): string | null {
    return newestFirst(this.store.addonVersionsOf(id))[0]?.version ?? null;
  }

  /**
   * Gemeinsamer Schluss beider Wege: Datei im Addon-Ordner mit passender Größe und SHA-256, Version höher, dann in
   * einer Transaktion eintragen (mit Besitzer; bei einer Freigabe auch Screenshots und Status der Einreichung).
   * Der Aufrufer hält die Sperre für die Datei.
   */
  private async commit(
    manifest: string,
    signature: string,
    checked: AddonManifest,
    by: string | null,
    owner: string | null,
    extra: { screenshots?: AddonScreenshot[]; inTransaction?: () => void } = {},
  ): Promise<AddonVersionRow> {
    const real = await resolveInDir(this.dir, checked.file);
    const info = real === null ? null : await fs.promises.stat(real).catch(() => null);
    if (real === null || !info || !info.isFile()) {
      throw new HttpError(409, `Erst die JAR hochladen: ${checked.file} liegt noch nicht im Addon-Ordner.`);
    }
    if (info.size !== checked.size) {
      throw new HttpError(400, `${checked.file} ist ${info.size} Byte groß, das Manifest nennt ${checked.size}.`);
    }
    if ((await this.sha256(checked.file, real, info)) !== checked.sha256) {
      throw new HttpError(400, `Die Prüfsumme (SHA-256) von ${checked.file} passt nicht zum Manifest.`);
    }
    // Ab hier synchron bis zum Eintragen: Kein anderes Veröffentlichen kommt dazwischen.
    this.checkOwner(checked.id, owner);
    this.checkHigherVersion(checked.id, checked.version);
    const row: AddonVersionRow = {
      id: checked.id,
      version: checked.version,
      manifest,
      // Einheitlich als Standard-Base64 (dieselben 64 Byte), damit auch strenge Decoder sie lesen.
      signature: Buffer.from(signature, 'base64').toString('base64'),
      file: checked.file,
      size: checked.size,
      sha256: checked.sha256,
      publishedAt: Date.now(),
      publishedBy: by,
    };
    this.store.transaction(() => {
      this.store.insertAddonVersion(row, owner);
      if (extra.screenshots) this.store.setAddonScreenshots(row.id, extra.screenshots);
      extra.inTransaction?.();
    });
    this.log(`Addon ${row.id} ${row.version} ist veröffentlicht (${row.file}).`);
    return row;
  }

  /**
   * `PUT /v1/team/addons/manifest` mit `{ manifest, signature }`: prüft Signatur, Felder (offiziell: `official: true`,
   * `author: null`), Datei (Größe, SHA-256), dass die ID nicht einem Spieler gehört und dass die Version höher ist als
   * jede vorhandene dieses Addons. Ein neues Addon ist danach sichtbar.
   */
  async publish(input: Record<string, unknown>, key: KeyObject, by: string | null): Promise<AddonVersionRow> {
    const checked = this.checkSigned(input.manifest, input.signature, key);
    const raw = JSON.parse(input.manifest as string) as Record<string, unknown>;
    if (raw.official !== true || raw.author !== null) {
      throw new HttpError(400, 'Ungültiges Addon-Manifest: Team-Addons brauchen „official“: true und „author“: null (mit npm run addon neu bauen).');
    }
    this.lock(checked.file);
    try {
      return await this.commit(input.manifest as string, input.signature as string, checked, by, null);
    } finally {
      this.busy.delete(checked.file);
    }
  }

  /**
   * Freigabe einer Einreichung: Signatur über genau das Manifest, das der Dienst erzeugt hat; die JAR der Einreichung
   * wandert in den Addon-Ordner, die Screenshots in den Ordner der Screenshots (sie ersetzen die bisherigen), dann wird
   * eingetragen wie beim Team-Upload, mit dem Einreicher als Besitzer. Geht etwas schief, liegt alles wieder bei der
   * Einreichung. `inTransaction` speichert den neuen Status der Einreichung in derselben Transaktion.
   */
  async publishSubmission(input: {
    manifest: string;
    signature: unknown;
    key: KeyObject;
    owner: string;
    by: string;
    jar: string;
    screenshots: SubmittedScreenshot[];
    inTransaction: () => void;
  }): Promise<AddonVersionRow> {
    const checked = this.checkSigned(input.manifest, input.signature, input.key);
    if (checked.official || checked.author?.uuid !== input.owner) throw new HttpError(400, 'Das Manifest passt nicht zur Einreichung.');
    this.lock(checked.file);
    const moved: { from: string; to: string }[] = [];
    try {
      this.checkOwner(checked.id, input.owner);
      this.checkHigherVersion(checked.id, checked.version);
      const info = await fs.promises.stat(input.jar).catch(() => null);
      if (!info?.isFile()) throw new HttpError(409, 'Die JAR der Einreichung fehlt.');
      const sha256 = await hashFile(input.jar, 'sha256', 'hex');
      if (info.size !== checked.size || sha256 !== checked.sha256) throw new HttpError(409, 'Die JAR der Einreichung passt nicht mehr zum Manifest.');
      await fs.promises.mkdir(this.dir, { recursive: true });
      const realDir = await fs.promises.realpath(this.dir);
      const target = path.join(realDir, checked.file);
      if (await fs.promises.lstat(target).then(() => true, () => false)) {
        throw new HttpError(409, `Im Addon-Ordner liegt schon eine Datei ${checked.file}. Bitte erst im Team-Bereich löschen.`);
      }
      await fs.promises.rename(input.jar, target);
      moved.push({ from: input.jar, to: target });
      this.hashes.set(checked.file, { size: info.size, mtimeMs: info.mtimeMs, sha256 });

      let screenshots: AddonScreenshot[] | undefined;
      if (input.screenshots.length > 0) {
        await fs.promises.mkdir(this.screenshotsDir, { recursive: true });
        const shotsDir = await fs.promises.realpath(this.screenshotsDir);
        screenshots = [];
        for (const { path: from, shot } of input.screenshots) {
          const file = `${checked.id}-${randomBytes(8).toString('hex')}.${IMAGE_EXTENSIONS[shot.type]}`;
          const to = path.join(shotsDir, file);
          await fs.promises.rename(from, to);
          moved.push({ from, to });
          screenshots.push({ ...shot, file });
        }
      }
      const before = this.store.getAddon(checked.id)?.screenshots ?? [];
      const row = await this.commit(input.manifest, input.signature as string, checked, input.by, input.owner, {
        screenshots,
        inTransaction: input.inTransaction,
      });
      moved.length = 0;
      // Ersetzte Screenshots löschen (was nicht klappt, räumt das Aufräumen später weg).
      if (screenshots) await this.removeScreenshotFiles(before);
      return row;
    } finally {
      // Fehlgeschlagen: alles zurück zur Einreichung.
      for (const { from, to } of moved.reverse()) {
        await fs.promises.rename(to, from).catch((err: NodeJS.ErrnoException) => this.log(`Zurücklegen von ${to} fehlgeschlagen (${err.code ?? err.message}).`));
      }
      if (moved.length > 0) this.hashes.delete(checked.file);
      this.busy.delete(checked.file);
    }
  }

  private async removeScreenshotFiles(screenshots: AddonScreenshot[]): Promise<void> {
    for (const shot of screenshots) {
      if (!SCREENSHOT_FILE_RE.test(shot.file)) continue;
      await fs.promises.unlink(path.join(this.screenshotsDir, shot.file)).catch(() => {});
    }
  }

  /** `PATCH /v1/team/addons/<id>`: aus dem Store nehmen bzw. wieder zeigen. true, wenn sich etwas geändert hat. */
  setHidden(id: string, hidden: boolean): boolean {
    if (!ADDON_ID_RE.test(id) || !this.store.getAddon(id)) throw new HttpError(404, NO_SUCH_ADDON);
    return this.store.setAddonHidden(id, hidden);
  }

  /** `DELETE /v1/team/addons/<id>/versions/<version>`: Version samt Datei; war es die letzte, ist das Addon ganz weg. */
  async deleteVersion(id: string, version: string): Promise<{ file: string; removed: boolean }> {
    const row = ADDON_ID_RE.test(id) && isVersion(version) ? this.store.getAddonVersion(id, version) : undefined;
    if (!row) throw new HttpError(404, NO_SUCH_VERSION);
    this.lock(row.file);
    try {
      const screenshots = this.store.getAddon(id)?.screenshots ?? [];
      const removed = this.store.deleteAddonVersion(id, version);
      try {
        await fs.promises.unlink(path.join(await fs.promises.realpath(this.dir), row.file));
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          this.log(`Addon-Datei ${row.file} ließ sich nicht löschen (${code ?? String(err)}); sie steht jetzt bei den unveröffentlichten Dateien.`);
        }
      }
      // Das Addon ist ganz weg (mit Bewertungen): seine Screenshots auch.
      if (removed) await this.removeScreenshotFiles(screenshots);
      this.hashes.delete(row.file);
      this.warned.delete(row.file);
      return { file: row.file, removed };
    } finally {
      this.busy.delete(row.file);
    }
  }

  /** Aufräumen: Screenshots, die zu keinem Addon (mehr) gehören und älter als ein paar Minuten sind. */
  async sweepScreenshots(now = Date.now()): Promise<number> {
    let names: string[];
    try {
      names = await fs.promises.readdir(this.screenshotsDir);
    } catch {
      return 0;
    }
    const used = new Set(this.store.listAddons().flatMap((addon) => addon.screenshots.map((s) => s.file)));
    let removed = 0;
    for (const name of names) {
      if (used.has(name) || !SCREENSHOT_FILE_RE.test(name)) continue;
      const file = path.join(this.screenshotsDir, name);
      const info = await fs.promises.lstat(file).catch(() => null);
      if (!info || now - info.mtimeMs < ORPHAN_GRACE_MS) continue;
      if (await fs.promises.unlink(file).then(() => true, () => false)) removed++;
    }
    return removed;
  }
}
