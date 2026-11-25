// Addon-Store: Heldix-Addons (JAR plus signiertes Manifest) für Launcher, Spiel und Webseite.
// Veröffentlichen geht nur im Team-Bereich (Admin) und nur mit einer gültigen Ed25519-Signatur des Update-Schlüssels
// über "heldix-addon\n" + Manifest. So kann auch ein übernommenes Team-Konto kein fremdes Addon ausliefern, und ein
// Launcher-Update (signiert ohne Präfix) ist nie als Addon gültig und umgekehrt. Clients prüfen die Signatur selbst.
import { verify, type KeyObject } from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { AddonRow, AddonVersionRow, Store } from './db';
import { HttpError } from './http';
import { checkUploadLength, compareVersions, hashFile, isVersion, receiveFile, resolveInDir, sendFile } from './updates';
import { codePointLength, hasForbiddenChars } from './validate';

/** Steht vor dem Manifest-Text, wenn signiert wird (Domänentrennung zu den Launcher-Updates). */
export const ADDON_SIGNATURE_PREFIX = 'heldix-addon\n';
/** Größte Addon-Datei (JAR) und damit größter Upload. */
export const MAX_ADDON_SIZE = 50 * 1024 * 1024;
/** Größtes Manifest (UTF-8). Alle Felder voll ausgeschöpft ergeben weniger als die Hälfte. */
export const MAX_ADDON_MANIFEST_BYTES = 64 * 1024;
/** Grenze für den Körper von `PUT /v1/team/addons/manifest` (das Manifest steckt als JSON-Text im JSON). */
export const ADDON_MANIFEST_BODY_LIMIT = 256 * 1024;

export const ADDON_CATEGORIES = ['hud', 'musik', 'chat', 'werkzeuge', 'sonstiges'] as const;
export type AddonCategory = (typeof ADDON_CATEGORIES)[number];
export const ADDON_PLATFORMS = ['windows', 'mac', 'linux'] as const;
export type AddonPlatform = (typeof ADDON_PLATFORMS)[number];

/** ID wie in `heldix.addon.json`. */
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
/** `heldix-addon-<id>-<version>.jar` */
export const ADDON_FILE_RE = /^heldix-addon-[a-z0-9][a-z0-9_-]{0,39}-\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?\.jar$/;
/** Name aus dem Heldix-Icon-Set; unbekannte zeigen die Clients als Puzzleteil. */
const ICON_RE = /^[a-z0-9-]{1,30}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
/** ISO 8601: Datum, auf Wunsch mit Uhrzeit (Sekunden, Bruchteile und Zeitzone freiwillig). */
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))?)?$/;
/** Einzelne Ersatzzeichen (kein gültiges UTF-16): Die signierten Bytes wären nicht eindeutig. */
const LONE_SURROGATE_RE = /\p{Cs}/u;

export const NO_SUCH_ADDON = 'Dieses Addon gibt es nicht.';
export const WRONG_SIGNATURE = 'Die Signatur stimmt nicht.';
const NO_SUCH_FILE = 'Diese Datei gibt es nicht.';
const NO_SUCH_VERSION = 'Diese Version gibt es nicht.';
const INVALID_NAME = 'Ungültiger Dateiname (erwartet: heldix-addon-<id>-<version>.jar).';
const BUSY = 'Mit dieser Datei passiert gerade schon etwas (Hochladen, Veröffentlichen oder Löschen). Bitte kurz warten.';
const CONTENT_TYPE = 'application/java-archive';
/** Eine veröffentlichte Datei ändert sich nie (Name = Addon und Version, ersetzen geht nicht). */
const FILE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

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

/**
 * Prüft den Inhalt eines Addon-Manifests (das geparste JSON). Liefert die bekannten Felder oder einen deutschen
 * Hinweis, was nicht stimmt. Unbekannte Zusatzfelder sind erlaubt und werden ignoriert.
 */
export function checkAddonManifest(value: unknown): AddonManifest | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'Das Manifest ist kein JSON-Objekt';
  const m = value as Record<string, unknown>;
  if (m.type !== 'heldix-addon') return '„type“ muss „heldix-addon“ sein';
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) {
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

interface Readable {
  row: AddonVersionRow;
  manifest: AddonManifest;
}

export class Addons {
  /** Dateien, mit denen gerade etwas passiert (Hochladen, Veröffentlichen, Löschen): je Datei nur eins gleichzeitig. */
  private readonly busy = new Set<string>();
  /** SHA-256 hochgeladener Dateien, gültig solange Größe und Änderungszeit gleich sind (spart das Lesen beim Veröffentlichen). */
  private readonly hashes = new Map<string, { size: number; mtimeMs: number; sha256: string }>();
  /** Gespeicherte Manifeste, die sich nicht mehr lesen lassen (nur einmal ins Log). */
  private readonly warned = new Set<string>();

  constructor(
    private readonly store: Store,
    private readonly dir: string,
    private readonly log: (line: string) => void,
  ) {}

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
    if (!ID_RE.test(id)) return null;
    const addon = this.store.getAddon(id);
    if (!addon || addon.hidden) return null;
    const versions = this.readable(this.store.addonVersionsOf(id));
    return versions.length > 0 ? { addon, versions } : null;
  }

  /** Eintrag für Liste und Detail: alle Manifest-Felder, Downloads, Zeitpunkt, signierter Text und Signatur. */
  private entry(addon: AddonRow, { row, manifest: m }: Readable) {
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
      downloads: addon.downloads,
      publishedAt: row.publishedAt,
      manifest: row.manifest,
      signature: row.signature,
    };
  }

  // ---------- Öffentlich ----------

  /** `GET /v1/addons`: sichtbare Addons mit ihrer neuesten Version, Downloads absteigend, dann Name. */
  list() {
    const versions = groupById(this.store.allAddonVersions());
    const addons = [];
    for (const addon of this.store.listAddons()) {
      if (addon.hidden) continue;
      const [latest] = this.readable(versions.get(addon.id) ?? []);
      if (latest) addons.push(this.entry(addon, latest));
    }
    addons.sort((a, b) => b.downloads - a.downloads || byName(a, b));
    return { addons };
  }

  /** `GET /v1/addons/<id>`: das Addon (neueste Version) und alle Versionen, neueste zuerst. */
  detail(id: string) {
    const found = this.visible(id);
    if (!found) throw new HttpError(404, NO_SUCH_ADDON);
    return {
      addon: this.entry(found.addon, found.versions[0]!),
      versions: found.versions.map(({ row, manifest }) => ({
        version: row.version,
        date: manifest.date,
        notes: manifest.notes,
        api: manifest.api,
        size: row.size,
        sha256: row.sha256,
        file: row.file,
        publishedAt: row.publishedAt,
      })),
    };
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

  // ---------- Team-Bereich (Admin) ----------

  /** `GET /v1/team/addons`: alle Addons (auch versteckte) mit Versionen, unveröffentlichte Dateien, Schlüssel da? */
  async overview(keyConfigured: boolean) {
    const all = this.store.allAddonVersions();
    const versions = groupById(all);
    const addons = this.store
      .listAddons()
      .map((addon) => {
        const rows = newestFirst(versions.get(addon.id) ?? []);
        const manifests = rows.map((row) => this.manifestOf(row));
        return {
          id: addon.id,
          name: manifests.find((m) => m !== null)?.name ?? addon.id,
          hidden: addon.hidden,
          downloads: addon.downloads,
          latest: rows[0]?.version ?? null,
          versions: rows.map((row, i) => ({
            version: row.version,
            file: row.file,
            size: row.size,
            sha256: row.sha256,
            date: manifests[i]?.date ?? '',
            notes: manifests[i]?.notes ?? [],
            api: manifests[i]?.api ?? null,
            publishedAt: row.publishedAt,
            publishedBy: row.publishedBy,
          })),
        };
      })
      .sort(byName);
    return { addons, pending: await this.pending(new Set(all.map((row) => row.file))), keyConfigured };
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

  /**
   * `PUT /v1/team/addons/manifest` mit `{ manifest, signature }`: prüft Signatur, Felder, Datei (Größe, SHA-256) und
   * dass die Version höher ist als jede vorhandene dieses Addons. Ein neues Addon ist danach sichtbar.
   */
  async publish(input: Record<string, unknown>, key: KeyObject, by: string | null): Promise<AddonVersionRow> {
    const { manifest, signature } = input;
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

    this.lock(checked.file);
    try {
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
      const [highest] = newestFirst(this.store.addonVersionsOf(checked.id));
      if (highest && compareVersions(checked.version, highest.version) <= 0) {
        throw new HttpError(409, `Die Version ${checked.version} ist nicht höher als die vorhandene (${highest.version}).`);
      }
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
      this.store.insertAddonVersion(row);
      this.log(`Addon ${row.id} ${row.version} ist veröffentlicht (${row.file}).`);
      return row;
    } finally {
      this.busy.delete(checked.file);
    }
  }

  /** `PATCH /v1/team/addons/<id>`: aus dem Store nehmen bzw. wieder zeigen. true, wenn sich etwas geändert hat. */
  setHidden(id: string, hidden: boolean): boolean {
    if (!ID_RE.test(id) || !this.store.getAddon(id)) throw new HttpError(404, NO_SUCH_ADDON);
    return this.store.setAddonHidden(id, hidden);
  }

  /** `DELETE /v1/team/addons/<id>/versions/<version>`: Version samt Datei; war es die letzte, ist das Addon ganz weg. */
  async deleteVersion(id: string, version: string): Promise<{ file: string; removed: boolean }> {
    const row = ID_RE.test(id) && isVersion(version) ? this.store.getAddonVersion(id, version) : undefined;
    if (!row) throw new HttpError(404, NO_SUCH_VERSION);
    this.lock(row.file);
    try {
      const removed = this.store.deleteAddonVersion(id, version);
      try {
        await fs.promises.unlink(path.join(await fs.promises.realpath(this.dir), row.file));
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          this.log(`Addon-Datei ${row.file} ließ sich nicht löschen (${code ?? String(err)}); sie steht jetzt bei den unveröffentlichten Dateien.`);
        }
      }
      this.hashes.delete(row.file);
      this.warned.delete(row.file);
      return { file: row.file, removed };
    } finally {
      this.busy.delete(row.file);
    }
  }
}
