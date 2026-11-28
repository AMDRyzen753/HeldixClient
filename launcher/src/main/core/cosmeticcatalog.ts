// Cosmetics im Launcher (Seite „Skins & Cosmetics“ und Figur auf der Startseite): Katalog des Heldix-Dienstes laden,
// signierte Umschläge zwischenspeichern und prüfen, eigene Auswahl lesen und ändern (siehe docs/dienst.md,
// „Cosmetics-Katalog“).
//
// Katalog: GET /v1/cosmetics (höchstens einmal pro Minute, mit ETag), je Eintrag der Umschlag über
// GET /v1/cosmetics/<id>?v=<sha256>. Umschläge liegen unter <cache>/cosmetics/envelopes/<sha256>.json; dieselbe
// Version wird also nie zweimal geladen. Jeder Umschlag wird vor der Verwendung geprüft (sha256 der Bytes, Ed25519-
// Signatur mit dem Update-Schlüssel über "heldix-cosmetic\n" + Manifest, alle Regeln aus cosmetics-format.ts, ID und
// Slot wie im Katalog). Was nicht passt, fällt still weg (eine Zeile im Log). Ohne Dienst zeigt der Launcher den zuletzt
// geladenen Katalog aus dem Zwischenspeicher.
//
// Auswahl: GET/PUT /v1/me/cosmetics über die Anmeldung beim Dienst (core/social.ts). Ob das Konto im Team ist, verrät
// der Dienst über das Bearer-Token nicht; der Launcher schließt es aus der Auswahl (trägt es etwas nur fürs Team, ist
// es im Team) bzw. aus der Antwort beim Wählen (403 = nicht im Team). Sonst bleibt es offen (null).
//
// Belohnungen (access „unlock“, z. B. für Einladungen): wählbar nur, wenn ihre ID in `unlocked` aus GET/PUT
// /v1/me/cosmetics steht (ab Dienst 1.11.0; fehlt das Feld, ist nichts freigeschaltet). Die Oberfläche sperrt sie wie
// Team-Einträge, choose() fragt vor dem Ablehnen noch einmal frisch nach.

import { createHash, createPublicKey, type KeyObject } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CosmeticItem, CosmeticMeshData, CosmeticSelection, CosmeticSlotName, CosmeticsState } from '../../shared/api';
import { cosmeticCubeFaces, verifyCosmeticEnvelope } from './cosmetics';
import { BUILTIN_CAPE_IDS, COSMETIC_FORMAT_2, COSMETIC_ID_RE, COSMETIC_MAX_ENVELOPE_BYTES, COSMETIC_SLOTS, type AnyCosmeticManifest, type CosmeticManifest2 } from './cosmetics-format';
import { SERVICE_UNREACHABLE, ServiceError, serviceBase } from './heldixservice';
import { USER_AGENT } from './http';

/** So lange gilt der geladene Katalog (der Dienst schickt max-age=60) */
export const CATALOG_MAX_AGE_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
/** größte Antwort von GET /v1/cosmetics */
const MAX_LIST_BYTES = 1024 * 1024;
const SHA256_RE = /^[0-9a-f]{64}$/;
const OFFLINE_MESSAGE = 'Cosmetics gibt es nur mit einem Microsoft-Konto.';
export const TEAM_ONLY_MESSAGE = 'Dieses Cosmetic gibt es nur für das HeldixClient-Team.';
/** wie der Dienst (403 LOCKED) */
export const UNLOCK_MESSAGE = 'Dieses Cosmetic schaltest du frei, indem du Freunde zu HeldixClient einlädst.';

/** Eintrag aus GET /v1/cosmetics (nicht signiert: Name & Co. kommen aus dem geprüften Manifest) */
export interface CatalogEntry {
  id: string;
  slot: CosmeticSlotName;
  version: number;
  sha256: string;
}

/** Teil von core/social.ts, den die Cosmetics brauchen (angemeldete Anfragen beim Dienst) */
export interface CosmeticAuth {
  authed<T>(route: string, init?: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown }, options?: { offlineMessage?: string; quiet?: boolean }): Promise<T>;
  accountId(): Promise<string | null>;
}

export interface CosmeticCatalogOptions {
  serviceUrl: string;
  /** öffentlicher Update-Schlüssel (PEM oder KeyObject); null = keine Cosmetics */
  publicKey: string | KeyObject | null;
  /** Ordner für Katalog und Umschläge (Datenordner/cache/cosmetics) */
  cacheDir: string;
  auth: CosmeticAuth | null;
  /** IDs der eingebauten Heldix-Capes (für den Slot cape); Standard: die IDs aus dem Format */
  builtinCapes?(): Promise<string[]>;
  log?(line: string): void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

function parseEntry(raw: unknown): CatalogEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== 'string' || !COSMETIC_ID_RE.test(e.id)) return null;
  if (typeof e.slot !== 'string' || !(COSMETIC_SLOTS as readonly string[]).includes(e.slot)) return null;
  if (typeof e.sha256 !== 'string' || !SHA256_RE.test(e.sha256)) return null;
  const version = Number.isSafeInteger(e.version) && (e.version as number) >= 1 ? (e.version as number) : 0;
  return { id: e.id, slot: e.slot as CosmeticSlotName, version, sha256: e.sha256 };
}

function parseEntries(raw: unknown): CatalogEntry[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { cosmetics?: unknown }).cosmetics) ? (raw as { cosmetics: unknown[] }).cosmetics : null;
  if (!list) throw new Error('Der Heldix-Dienst hat eine ungültige Antwort geschickt.');
  const seen = new Set<string>();
  const entries: CatalogEntry[] = [];
  for (const item of list) {
    const entry = parseEntry(item);
    if (entry && !seen.has(entry.id)) {
      seen.add(entry.id);
      entries.push(entry);
    }
  }
  return entries;
}

/** Freigeschaltete Belohnungen (access „unlock“) aus GET/PUT /v1/me/cosmetics; fehlt das Feld (älterer Dienst): keine */
export function parseUnlocked(raw: unknown): string[] {
  const list = raw && typeof raw === 'object' ? (raw as { unlocked?: unknown }).unlocked : undefined;
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((id): id is string => typeof id === 'string' && COSMETIC_ID_RE.test(id)))];
}

/** Auswahl aus GET/PUT /v1/me/cosmetics (unbekannte oder ungültige Werte = nichts) */
export function parseSelection(raw: unknown): CosmeticSelection {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pick = (value: unknown) => (typeof value === 'string' && value && /^[a-z0-9_-]{1,40}$/.test(value) ? value : null);
  return { head: pick(r.head), back: pick(r.back), aura: pick(r.aura), companion: pick(r.companion), cape: pick(r.cape) };
}

/**
 * Format 2: Mesh, Knochen und Animationen für die Vorschau (Zahlenlisten bleiben Base64 wie im signierten Manifest,
 * entpackt wird in der Oberfläche, siehe renderer/cosmetic-mesh.ts)
 */
function toMeshData(manifest: CosmeticManifest2): CosmeticMeshData {
  const { blendSeconds, ...states } = manifest.states;
  const keys = (k: { keys: string; values: string } | null) => (k ? { keys: k.keys, values: k.values } : null);
  return {
    vertexCount: manifest.mesh.vertexCount,
    triangleCount: manifest.mesh.triangleCount,
    positions: manifest.mesh.positions,
    normals: manifest.mesh.normals,
    uvs: manifest.mesh.uvs,
    bones: manifest.mesh.bones,
    triangles: manifest.mesh.triangles,
    joints: manifest.mesh.joints,
    weights: manifest.mesh.weights,
    skeleton: manifest.bones.map((b) => ({ name: b.name, parent: b.parent, pivot: [...b.pivot], tail: [...b.tail] })),
    animations: Object.entries(manifest.animations).map(([name, clip]) => ({
      name,
      fps: clip.fps,
      frames: clip.frames,
      loop: clip.loop,
      tracks: clip.tracks.map((t) => ({ bone: t.bone, rot: keys(t.rot), move: keys(t.move), scale: keys(t.scale) })),
    })),
    states: Object.fromEntries(Object.entries(states).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    blendSeconds,
    emissive: manifest.emissive ? { frames: manifest.emissive.frames, frametimeTicks: manifest.emissive.frametimeTicks, pulse: { ...manifest.emissive.pulse } } : null,
    attach: { origin: manifest.attach ? [...manifest.attach.origin] : null, side: manifest.attach?.side ?? 'left' },
    particles: manifest.particles.map((p) => ({ ...p, states: p.states ? [...p.states] : null })),
  };
}

/** Geprüftes Manifest in die Form für die Oberfläche (Würfelflächen schon ausgerechnet, siehe core/cosmetics.ts) */
export function toCosmeticItem(manifest: AnyCosmeticManifest, envelopeSha: string): CosmeticItem {
  if (manifest.format === COSMETIC_FORMAT_2) {
    // Format 2: alles Weitere steht in mesh; die Felder von Format 1 bleiben leer
    return {
      id: manifest.id,
      slot: manifest.slot,
      format: manifest.format,
      version: manifest.version,
      name: manifest.name,
      description: manifest.description,
      teamOnly: manifest.access === 'team',
      unlockOnly: manifest.access === 'unlock',
      sha256: envelopeSha,
      texture: manifest.texture,
      glow: manifest.glow,
      textureSize: [manifest.image.width, manifest.image.height],
      bones: [],
      modelScale: 1,
      animations: [],
      particles: null,
      cape: null,
      companion: null,
      mesh: toMeshData(manifest),
    };
  }
  return {
    id: manifest.id,
    slot: manifest.slot,
    format: manifest.format,
    version: manifest.version,
    name: manifest.name,
    description: manifest.description,
    teamOnly: manifest.access === 'team',
    // ältere Formate kennen „unlock“ nicht: als Text vergleichen
    unlockOnly: (manifest.access as string) === 'unlock',
    sha256: envelopeSha,
    texture: manifest.texture,
    glow: manifest.glow,
    textureSize: manifest.model ? manifest.model.textureSize : [manifest.image.width, manifest.image.height],
    bones: (manifest.model?.bones ?? []).map((bone) => ({
      name: bone.name,
      parent: bone.parent,
      pivot: bone.pivot,
      rotation: bone.rotation,
      faces: bone.cubes.flatMap((cube) => cosmeticCubeFaces(cube).map(({ corners, uvs, normal }) => ({ corners, uvs, normal }))),
    })),
    modelScale: manifest.model ? manifest.model.scale : 1,
    animations: manifest.animations.map((a) => ({ ...a })),
    particles: manifest.particles ? { ...manifest.particles } : null,
    cape: manifest.cape ? { ...manifest.cape } : null,
    companion: manifest.companion ? { offset: manifest.companion.offset, scale: manifest.companion.scale } : null,
    mesh: null,
  };
}

export class CosmeticCatalog {
  private readonly base: string;
  private readonly key: KeyObject | null;
  /** geprüfte Umschläge nach sha256 */
  private readonly verified = new Map<string, CosmeticItem>();
  /** verworfene Umschläge nach sha256 (Grund), damit sie nicht immer wieder geladen werden */
  private readonly rejected = new Map<string, string>();
  private loaded: { at: number; items: CosmeticItem[]; error: string | null } | null = null;
  private loading: Promise<{ items: CosmeticItem[]; error: string | null }> | null = null;
  private etag: string | null = null;
  private entries: CatalogEntry[] | null = null;
  /** bekannte Team-Mitgliedschaft je Konto (siehe oben) */
  private readonly team = new Map<string, boolean>();
  /** zuletzt gemeldete Freischaltungen je Konto (GET/PUT /v1/me/cosmetics) */
  private readonly unlocked = new Map<string, string[]>();

  constructor(private readonly options: CosmeticCatalogOptions) {
    this.base = serviceBase(options.serviceUrl);
    let key: KeyObject | null = null;
    try {
      key = options.publicKey ? (typeof options.publicKey === 'string' ? createPublicKey(options.publicKey) : options.publicKey) : null;
    } catch {
      key = null;
    }
    this.key = key;
  }

  private get catalogFile(): string {
    return path.join(this.options.cacheDir, 'catalog.json');
  }

  private envelopeFile(sha: string): string {
    return path.join(this.options.cacheDir, 'envelopes', `${sha}.json`);
  }

  private log(line: string): void {
    this.options.log?.(line);
  }

  private async get(route: string, headers: Record<string, string> = {}): Promise<Response> {
    try {
      return await fetch(`${this.base}${route}`, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...headers },
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ServiceError(SERVICE_UNREACHABLE, 0);
    }
  }

  /** Antwort lesen, aber höchstens limit Byte */
  private static async body(response: Response, limit: number): Promise<Buffer> {
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > limit) throw new Error('Antwort zu groß');
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > limit) throw new Error('Antwort zu groß');
    return data;
  }

  // ---------- Katalog ----------

  /** GET /v1/cosmetics (mit ETag); bei Erfolg auch auf die Platte. Wirft ServiceError, wenn der Dienst nicht antwortet. */
  private async fetchEntries(): Promise<CatalogEntry[]> {
    const response = await this.get('/v1/cosmetics', this.etag && this.entries ? { 'if-none-match': this.etag } : {});
    if (response.status === 304 && this.entries) return this.entries;
    if (response.status === 502 || response.status === 503 || response.status === 504) throw new ServiceError(SERVICE_UNREACHABLE, response.status);
    if (!response.ok) throw new ServiceError(`Der Heldix-Dienst antwortet mit ${response.status}.`, response.status);
    let raw: unknown;
    try {
      raw = JSON.parse((await CosmeticCatalog.body(response, MAX_LIST_BYTES)).toString('utf8'));
    } catch {
      throw new ServiceError('Der Heldix-Dienst hat eine ungültige Antwort geschickt.', response.status);
    }
    const entries = parseEntries(raw);
    this.entries = entries;
    this.etag = response.headers.get('etag');
    await this.saveCatalog(entries).catch(() => undefined);
    return entries;
  }

  private async saveCatalog(entries: CatalogEntry[]): Promise<void> {
    await mkdir(this.options.cacheDir, { recursive: true });
    const tmp = `${this.catalogFile}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ cosmetics: entries }), 'utf8');
    await rename(tmp, this.catalogFile);
  }

  private async cachedEntries(): Promise<CatalogEntry[] | null> {
    try {
      return parseEntries(JSON.parse(await readFile(this.catalogFile, 'utf8')));
    } catch {
      return null;
    }
  }

  /** Umschläge, die der Katalog nicht mehr nennt, aus dem Zwischenspeicher löschen */
  private async prune(entries: CatalogEntry[]): Promise<void> {
    const keep = new Set(entries.map((e) => `${e.sha256}.json`));
    const dir = path.join(this.options.cacheDir, 'envelopes');
    for (const file of await readdir(dir).catch(() => [] as string[])) {
      if (!keep.has(file)) await rm(path.join(dir, file), { force: true }).catch(() => undefined);
    }
  }

  // ---------- Umschläge ----------

  /** Prüft einen Umschlag (Bytes) gegen den Katalogeintrag. Wirft mit deutscher Meldung. */
  private verify(entry: CatalogEntry, bytes: Buffer): CosmeticItem {
    if (!this.key) throw new Error('Dieser Launcher kennt keinen Signatur-Schlüssel');
    if (bytes.length > COSMETIC_MAX_ENVELOPE_BYTES) throw new Error('Cosmetic ungültig: Der Umschlag ist zu groß');
    if (sha256(bytes) !== entry.sha256) throw new Error('Cosmetic ungültig: Prüfsumme passt nicht zum Katalog');
    const manifest = verifyCosmeticEnvelope(bytes, this.key);
    if (manifest.id !== entry.id) throw new Error(`Cosmetic ungültig: ID „${manifest.id}“ statt „${entry.id}“`);
    if (manifest.slot !== entry.slot) throw new Error(`Cosmetic ungültig: Slot ${manifest.slot} statt ${entry.slot}`);
    return toCosmeticItem(manifest, entry.sha256);
  }

  /** Umschlag aus dem Zwischenspeicher oder vom Dienst, geprüft; null = verworfen oder nicht ladbar. */
  private async item(entry: CatalogEntry, online: boolean): Promise<CosmeticItem | null> {
    const known = this.verified.get(entry.sha256);
    if (known) return known.id === entry.id && known.slot === entry.slot ? known : null;
    if (this.rejected.has(entry.sha256)) return null;
    const file = this.envelopeFile(entry.sha256);
    const cached = await readFile(file).catch(() => null);
    if (cached) {
      try {
        const item = this.verify(entry, cached);
        this.verified.set(entry.sha256, item);
        return item;
      } catch (error) {
        // beschädigt oder verändert: löschen und (online) neu laden
        this.log(`Cosmetic „${entry.id}“ im Zwischenspeicher verworfen: ${message(error)}`);
        await rm(file, { force: true }).catch(() => undefined);
      }
    }
    if (!online) return null;
    let bytes: Buffer;
    try {
      const response = await this.get(`/v1/cosmetics/${encodeURIComponent(entry.id)}?v=${entry.sha256}`);
      if (!response.ok) throw new Error(`Der Heldix-Dienst antwortet mit ${response.status}`);
      // größte Grenze aller Formate (Format 2 bis 544 KB); die des Formats prüft verify()
      bytes = await CosmeticCatalog.body(response, COSMETIC_MAX_ENVELOPE_BYTES);
    } catch (error) {
      // vorübergehend (Netz, 404 während einer Änderung): beim nächsten Laden noch einmal
      this.log(`Cosmetic „${entry.id}“ nicht geladen: ${message(error)}`);
      return null;
    }
    try {
      const item = this.verify(entry, bytes);
      this.verified.set(entry.sha256, item);
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, file);
      return item;
    } catch (error) {
      if (!this.verified.has(entry.sha256)) {
        this.rejected.set(entry.sha256, message(error));
        this.log(`Cosmetic „${entry.id}“ verworfen: ${message(error)}`);
      }
      return this.verified.get(entry.sha256) ?? null;
    }
  }

  private async load(): Promise<{ items: CosmeticItem[]; error: string | null }> {
    if (!this.base) return { items: [], error: 'Kein Heldix-Dienst eingerichtet.' };
    if (!this.key) return { items: [], error: 'Dieser Launcher kennt keinen Signatur-Schlüssel – Cosmetics sind aus.' };
    let entries: CatalogEntry[] | null = null;
    let online = true;
    let error: string | null = null;
    try {
      entries = await this.fetchEntries();
    } catch (failure) {
      online = false;
      error = message(failure);
      entries = this.entries ?? (await this.cachedEntries());
    }
    if (!entries) return { items: [], error };
    const items: (CosmeticItem | null)[] = new Array(entries.length).fill(null);
    let next = 0;
    // höchstens vier Umschläge gleichzeitig
    await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
      while (next < entries!.length) {
        const index = next++;
        items[index] = await this.item(entries![index], online);
      }
    }));
    if (online) await this.prune(entries).catch(() => undefined);
    return { items: items.filter((i): i is CosmeticItem => i !== null), error };
  }

  /** Geprüfte Cosmetics des Katalogs (Reihenfolge wie beim Dienst). error = Katalog gerade nicht vom Dienst. */
  async catalog(refresh = false): Promise<{ items: CosmeticItem[]; error: string | null }> {
    if (!refresh && this.loaded && Date.now() - this.loaded.at < CATALOG_MAX_AGE_MS) return this.loaded;
    this.loading ??= this.load()
      .then((result) => {
        // ohne Dienst nicht eine Minute lang festhalten: beim nächsten Mal wieder fragen
        this.loaded = { at: result.error ? 0 : Date.now(), ...result };
        return result;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  // ---------- Auswahl ----------

  private async teamFor(selection: CosmeticSelection | null, items: CosmeticItem[], reported: unknown): Promise<boolean | null> {
    const account = (await this.options.auth?.accountId().catch(() => null)) ?? null;
    if (typeof reported === 'boolean') {
      if (account) this.team.set(account, reported);
      return reported;
    }
    const wornTeam = !!selection && Object.values(selection).some((id) => id !== null && items.some((i) => i.id === id && i.teamOnly));
    if (wornTeam && account) this.team.set(account, true);
    if (wornTeam) return true;
    return account ? this.team.get(account) ?? null : null;
  }

  private async build(items: CosmeticItem[], catalogError: string | null, mine: { raw: unknown } | { error: string }): Promise<CosmeticsState> {
    const errors = [catalogError, 'error' in mine ? mine.error : null].filter((e): e is string => !!e);
    const selection = 'raw' in mine ? parseSelection(mine.raw) : null;
    const reported = 'raw' in mine && mine.raw && typeof mine.raw === 'object' ? (mine.raw as { team?: unknown }).team : undefined;
    const unlocked = 'raw' in mine ? parseUnlocked(mine.raw) : null;
    const account = (await this.options.auth?.accountId().catch(() => null)) ?? null;
    if (account && unlocked) this.unlocked.set(account, unlocked);
    return {
      items,
      selection,
      canChoose: selection !== null,
      team: await this.teamFor(selection, items, reported),
      unlocked,
      error: errors.length ? [...new Set(errors)].join(' ') : null,
    };
  }

  /** Katalog und eigene Auswahl. Fehler einzelner Teile stehen in error, der Rest bleibt nutzbar. */
  async state(refresh = false): Promise<CosmeticsState> {
    const [catalog, mine] = await Promise.all([
      this.catalog(refresh),
      this.options.auth
        ? this.options.auth
            .authed<unknown>('/v1/me/cosmetics', {}, { offlineMessage: OFFLINE_MESSAGE, quiet: !refresh })
            .then((raw) => ({ raw }), (error: unknown) => ({ error: message(error) }))
        : Promise.resolve({ error: 'Kein Heldix-Dienst eingerichtet.' }),
    ]);
    return this.build(catalog.items, catalog.error, mine);
  }

  /** Anlegen (id) oder ablegen (null) über PUT /v1/me/cosmetics. Wirft mit deutscher Meldung. */
  async choose(rawSlot: unknown, rawId: unknown): Promise<CosmeticsState> {
    const auth = this.options.auth;
    if (!auth) throw new Error('Kein Heldix-Dienst eingerichtet.');
    if (typeof rawSlot !== 'string' || !(COSMETIC_SLOTS as readonly string[]).includes(rawSlot)) throw new Error('Unbekannter Slot.');
    const slot = rawSlot as CosmeticSlotName;
    if (rawId !== null && rawId !== undefined && typeof rawId !== 'string') throw new Error('Dieses Cosmetic gibt es nicht (mehr).');
    const id = rawId ? rawId : null;
    const catalog = await this.catalog();
    const item = id ? catalog.items.find((i) => i.id === id) : undefined;
    if (id) {
      const builtin = slot === 'cape' && (await (this.options.builtinCapes?.() ?? Promise.resolve([...BUILTIN_CAPE_IDS])).catch(() => [...BUILTIN_CAPE_IDS])).includes(id);
      if (!builtin) {
        if (!item) throw new Error('Dieses Cosmetic gibt es nicht (mehr).');
        if (item.slot !== slot) throw new Error('Dieses Cosmetic passt nicht in diesen Slot.');
        if (item.teamOnly) {
          const account = await auth.accountId().catch(() => null);
          if (account && this.team.get(account) === false) throw new Error(TEAM_ONLY_MESSAGE);
        }
        if (item.unlockOnly) {
          // laut letzter Antwort noch nicht freigeschaltet: frisch nachsehen (vielleicht gerade erst), sonst gar nicht
          // erst versuchen; ohne bekannten Stand entscheidet der Dienst (403)
          const account = await auth.accountId().catch(() => null);
          const known = account ? this.unlocked.get(account) : undefined;
          if (known && !known.includes(item.id)) {
            const fresh = parseUnlocked(await auth.authed<unknown>('/v1/me/cosmetics', {}, { offlineMessage: OFFLINE_MESSAGE }));
            if (account) this.unlocked.set(account, fresh);
            if (!fresh.includes(item.id)) throw new Error(UNLOCK_MESSAGE);
          }
        }
      }
    }
    let raw: unknown;
    try {
      raw = await auth.authed<unknown>('/v1/me/cosmetics', { method: 'PUT', body: { slot, id } }, { offlineMessage: OFFLINE_MESSAGE });
    } catch (error) {
      if (item?.teamOnly && error instanceof ServiceError && error.status === 403) {
        const account = await auth.accountId().catch(() => null);
        if (account) this.team.set(account, false);
      }
      throw error;
    }
    if (item?.teamOnly) {
      const account = await auth.accountId().catch(() => null);
      if (account) this.team.set(account, true);
    }
    return this.build(catalog.items, catalog.error, { raw });
  }
}
