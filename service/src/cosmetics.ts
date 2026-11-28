// Cosmetics-Katalog: Das Team veröffentlicht signierte Cosmetics (Modell und Textur, reine Daten), Spieler wählen sie je
// Slot wie Capes, alle HeldixClient-Spieler sehen sie beim Nachschlagen. Veröffentlicht wird nur mit einer gültigen
// Ed25519-Signatur des Update-Schlüssels über "heldix-cosmetic\n" + Manifest; Format und Grenzen prüft
// cosmetics-format.ts (dieselben Regeln wie in Spiel, Launcher und Webseite). Clients prüfen die Signatur selbst.
import { createHash, verify, type KeyObject } from 'node:crypto';
import type { CosmeticInfoRow, Store, UserRow, WornSlot } from './db';
import { WORN_SLOTS } from './db';
import { HttpError } from './http';
import {
  checkCosmeticEnvelope,
  COSMETIC_FORMAT,
  COSMETIC_ID_RE,
  COSMETIC_SLOTS,
  cosmeticEnvelopeText,
  cosmeticSignedText,
  parseCosmeticManifest,
  type CosmeticSlot,
} from './cosmetics-format';
import { TEAM_CAPES } from './validate';

export const NO_SUCH_COSMETIC = 'Dieses Cosmetic gibt es nicht.';
export const TEAM_ONLY = 'Dieses Cosmetic gibt es nur für das HeldixClient-Team.';
/** `access: unlock` ohne Freischaltung (403 mit code LOCKED). */
export const LOCKED = 'Dieses Cosmetic schaltest du frei, indem du Freunde zu HeldixClient einlädst.';
const UNKNOWN_CAPE = 'Unbekanntes Cape.';
const WRONG_SIGNATURE = 'Die Signatur stimmt nicht.';
/** Liste: kurz im Cache (ETag spart die Übertragung). */
export const LIST_CACHE_CONTROL = 'public, max-age=60';
/** Umschlag ohne passendes `?v=`: jedes Mal nachfragen (ETag). */
export const ENVELOPE_CACHE_CONTROL = 'public, no-cache';
/** Umschlag mit `?v=<sha256>` der aktuellen Version: ändert sich unter dieser Adresse nie. */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Gewählte Cosmetics je Slot; null = nichts (auch: ausgeblendet, gelöscht, nur fürs Team oder nicht freigeschaltet). */
export type CosmeticChoice = Record<CosmeticSlot, string | null>;

/** `MyCosmetics`: die Auswahl, ob der Spieler Team-Cosmetics wählen darf, und seine Freischaltungen (`access: unlock`). */
export type MyCosmetics = CosmeticChoice & { team: boolean; unlocked: string[] };

/** Was ein Spieler wählen bzw. tragen darf: Team-Mitglied? Cosmetic freigeschaltet? (erst bei Bedarf gefragt) */
interface Access {
  team: () => boolean;
  unlocked: (id: string) => boolean;
}

/** Beim Nachschlagen: alle Slots außer dem Cape (das steht wie bisher in `cape`). */
export type WornChoice = Record<WornSlot, string | null>;

const collator = new Intl.Collator('de', { sensitivity: 'base' });

function byCatalogOrder(a: CosmeticInfoRow, b: CosmeticInfoRow): number {
  return (
    COSMETIC_SLOTS.indexOf(a.slot as CosmeticSlot) - COSMETIC_SLOTS.indexOf(b.slot as CosmeticSlot) ||
    collator.compare(a.name, b.name) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Prüft die Signatur (Ed25519, Base64) eines Cosmetic-Manifests mit dem öffentlichen Update-Schlüssel. */
export function verifyCosmeticSignature(manifest: string, signature: string, key: KeyObject): boolean {
  const bytes = Buffer.from(signature, 'base64');
  if (bytes.length !== 64) return false;
  try {
    return verify(null, Buffer.from(cosmeticSignedText(manifest), 'utf8'), key, bytes);
  } catch {
    return false;
  }
}

/** Antwort mit ETag (für `If-None-Match`). */
export interface CachedText {
  text: string;
  etag: string;
}

export class Cosmetics {
  /**
   * Format je Umschlag (sha256) für Liste und Team-Übersicht. Steht nicht in der Datenbank: beim ersten Bedarf aus dem
   * gespeicherten (beim Veröffentlichen geprüften) Manifest gelesen, danach aus dem Speicher.
   */
  private readonly formats = new Map<string, number>();

  constructor(
    private readonly store: Store,
    /** eingebaute Cape-IDs (HELDIX_DIENST_CAPES) */
    private readonly capes: ReadonlySet<string>,
    private readonly log: (line: string) => void,
  ) {}

  private infoMap(): Map<string, CosmeticInfoRow> {
    return new Map(this.store.cosmeticInfos().map((info) => [info.id, info]));
  }

  /** Format des Cosmetics (1 = Quader, 2 = Mesh mit Keyframes); ältere Clients kennen nur 1. */
  private formatOf(info: CosmeticInfoRow): number {
    let format = this.formats.get(info.sha256);
    if (format === undefined) {
      format = COSMETIC_FORMAT;
      try {
        const parsed = JSON.parse(this.store.getCosmetic(info.id)?.manifest ?? '{}') as { format?: unknown };
        if (typeof parsed.format === 'number' && Number.isInteger(parsed.format)) format = parsed.format;
      } catch {
        // geprüft gespeichert: kommt nicht vor; dann bleibt es bei Format 1
      }
      this.formats.set(info.sha256, format);
    }
    return format;
  }

  /**
   * Was ein Spieler in einem Slot gerade trägt: die gespeicherte ID, wenn es das Cosmetic gibt, es sichtbar ist, zum
   * Slot passt, (bei `access: team`) der Spieler im Team ist und (bei `access: unlock`) er es freigeschaltet hat. Sonst
   * null; die Auswahl bleibt trotzdem gespeichert. Eingebaute Capes gelten immer, Team-Capes (TEAM_CAPES) wie
   * `access: team` nur, solange der Spieler im Team ist.
   */
  private resolve(id: string, slot: CosmeticSlot, infos: Map<string, CosmeticInfoRow>, access: Access): string | null {
    if (id === '') return null;
    if (slot === 'cape' && this.capes.has(id)) return TEAM_CAPES.has(id) && !access.team() ? null : id;
    const info = infos.get(id);
    if (!info || info.hidden || info.slot !== slot) return null;
    if (info.access === 'team' && !access.team()) return null;
    if (info.access === 'unlock' && !access.unlocked(id)) return null;
    return id;
  }

  private choiceOf(user: UserRow, infos: Map<string, CosmeticInfoRow>, access: Access): CosmeticChoice {
    return {
      head: this.resolve(user.worn.head, 'head', infos, access),
      back: this.resolve(user.worn.back, 'back', infos, access),
      aura: this.resolve(user.worn.aura, 'aura', infos, access),
      companion: this.resolve(user.worn.companion, 'companion', infos, access),
      cape: this.resolve(user.cape, 'cape', infos, access),
    };
  }

  private isTeamMember(uuid: string): boolean {
    return this.store.getTeamMember(uuid) !== undefined;
  }

  /** Zugriff eines Spielers, aus der Datenbank erst bei Bedarf gelesen. */
  private accessOf(uuid: string): Access {
    return { team: () => this.isTeamMember(uuid), unlocked: (id) => this.store.hasUnlock(uuid, id) };
  }

  /** Nur fürs Team (`access: team` oder ein eingebautes Team-Cape) und der Spieler ist nicht im Team: 403. */
  private requireTeam(user: UserRow, teamOnly: boolean): void {
    if (teamOnly && !this.isTeamMember(user.uuid)) throw new HttpError(403, TEAM_ONLY);
  }

  /** Katalog-Cosmetic wählen: `access: team` nur im Team, `access: unlock` nur freigeschaltet (403 LOCKED). */
  private requireAccess(user: UserRow, info: CosmeticInfoRow): void {
    this.requireTeam(user, info.access === 'team');
    if (info.access === 'unlock' && !this.store.hasUnlock(user.uuid, info.id)) throw new HttpError(403, LOCKED, {}, 'LOCKED');
  }

  // ---------- Öffentlich ----------

  /** `GET /v1/cosmetics`: sichtbare Cosmetics nach Slot, dann Name; `format` sagt, ob ein Client es lesen kann. */
  list(): CachedText {
    const cosmetics = this.store
      .cosmeticInfos()
      .filter((info) => !info.hidden)
      .sort(byCatalogOrder)
      .map((info) => ({
        id: info.id,
        slot: info.slot,
        format: this.formatOf(info),
        version: info.version,
        name: info.name,
        description: info.description,
        access: info.access,
        sha256: info.sha256,
        size: info.size,
        date: info.date,
      }));
    const text = JSON.stringify({ cosmetics });
    return { text, etag: `"${sha256(text).slice(0, 32)}"` };
  }

  /** `GET /v1/cosmetics/<id>`: der Umschlag der aktuellen Version (genau die Bytes hinter `sha256`). */
  envelope(id: string): CachedText & { sha256: string } {
    const row = COSMETIC_ID_RE.test(id) ? this.store.getCosmetic(id) : undefined;
    if (!row || row.hidden) throw new HttpError(404, NO_SUCH_COSMETIC);
    return { text: cosmeticEnvelopeText(row), etag: `"${row.sha256}"`, sha256: row.sha256 };
  }

  /** Für `/v1/status`: sichtbare Cosmetics. */
  visibleCount(): number {
    return this.store.countVisibleCosmetics();
  }

  // ---------- Spieler ----------

  /**
   * `GET /v1/me/cosmetics`: was der Spieler gerade trägt (null = nichts), `team` (darf Team-Cosmetics wählen) und
   * `unlocked` (freigeschaltete Cosmetics für `access: unlock`, auch solche, die es im Katalog noch nicht gibt) –
   * Launcher und Spiel kennen Rolle und Freischaltungen sonst nicht.
   */
  mine(user: UserRow): MyCosmetics {
    const team = this.isTeamMember(user.uuid);
    const unlocked = this.store.unlocksOf(user.uuid).map((u) => u.cosmetic);
    return { ...this.choiceOf(user, this.infoMap(), { team: () => team, unlocked: (id) => unlocked.includes(id) }), team, unlocked };
  }

  /** Das Cape für `Me` und das Nachschlagen: eingebaut (Team-Capes nur im Team) oder sichtbares Katalog-Cape, sonst ''. */
  effectiveCape(user: UserRow): string {
    if (user.cape === '') return '';
    // Eingebaute Capes brauchen den Katalog nicht.
    const infos = this.capes.has(user.cape) ? new Map<string, CosmeticInfoRow>() : this.infoMap();
    return this.resolve(user.cape, 'cape', infos, this.accessOf(user.uuid)) ?? '';
  }

  /** Prüft `cape` aus `PUT /v1/me`: '' (keins), ein eingebautes Cape (Team-Capes nur im Team) oder ein wählbares Katalog-Cape. */
  checkCape(user: UserRow, cape: unknown): string {
    if (typeof cape !== 'string') throw new HttpError(400, UNKNOWN_CAPE);
    if (cape === '') return cape;
    if (this.capes.has(cape)) {
      this.requireTeam(user, TEAM_CAPES.has(cape));
      return cape;
    }
    const info = COSMETIC_ID_RE.test(cape) ? this.store.getCosmeticInfo(cape) : undefined;
    if (!info || info.hidden || info.slot !== 'cape') throw new HttpError(400, UNKNOWN_CAPE);
    this.requireAccess(user, info);
    return cape;
  }

  /**
   * `PUT /v1/me/cosmetics` mit `{ slot, id }`: anlegen (`id` = Cosmetic dieses Slots; beim Cape auch eingebaute Capes)
   * oder ablegen (`id` null oder ""). Antwort wie `GET /v1/me/cosmetics`.
   */
  choose(user: UserRow, input: Record<string, unknown>): MyCosmetics {
    const { slot, id } = input;
    if (typeof slot !== 'string' || !(COSMETIC_SLOTS as readonly string[]).includes(slot)) {
      throw new HttpError(400, `„slot“ muss eins von ${COSMETIC_SLOTS.join(', ')} sein.`);
    }
    const target = slot as CosmeticSlot;
    if (!Object.hasOwn(input, 'id') || (id !== null && typeof id !== 'string')) {
      throw new HttpError(400, '„id“ muss die ID eines Cosmetics sein oder null (ablegen).');
    }
    const value = id ?? '';
    if (value !== '' && target === 'cape' && this.capes.has(value)) {
      this.requireTeam(user, TEAM_CAPES.has(value));
    } else if (value !== '') {
      const info = COSMETIC_ID_RE.test(value) ? this.store.getCosmeticInfo(value) : undefined;
      if (!info || info.hidden) throw new HttpError(404, NO_SUCH_COSMETIC);
      if (info.slot !== target) throw new HttpError(400, `„${value}“ ist kein Cosmetic für den Slot ${target} (sondern für ${info.slot}).`);
      this.requireAccess(user, info);
    }
    this.store.setWorn(user.uuid, target, value);
    return this.mine(this.store.getUser(user.uuid)!);
  }

  /**
   * Für `POST /v1/players/lookup`: je Spieler das Cape und die übrigen Slots, wie sie andere sehen (null = nichts).
   * Team-Mitgliedschaft und Freischaltungen werden gebündelt und nur für Spieler abgefragt, die etwas nur fürs Team bzw.
   * etwas Freizuschaltendes tragen.
   */
  forLookup(users: UserRow[]): Map<string, { cape: string; cosmetics: WornChoice }> {
    if (users.length === 0) return new Map();
    const infos = this.infoMap();
    const accessIs = (id: string, access: string) => id !== '' && infos.get(id)?.access === access;
    // Beim Cape auch die eingebauten Team-Capes (wie in resolve: eingebaut geht vor Katalog).
    const teamCape = (id: string) => (this.capes.has(id) ? TEAM_CAPES.has(id) : accessIs(id, 'team'));
    const unlockCape = (id: string) => !this.capes.has(id) && accessIs(id, 'unlock');
    const needsTeam = users.filter((u) => teamCape(u.cape) || WORN_SLOTS.some((slot) => accessIs(u.worn[slot], 'team'))).map((u) => u.uuid);
    const needsUnlock = users.filter((u) => unlockCape(u.cape) || WORN_SLOTS.some((slot) => accessIs(u.worn[slot], 'unlock'))).map((u) => u.uuid);
    const team = this.store.teamMembersIn(needsTeam);
    const unlocks = this.store.unlocksIn(needsUnlock);
    const result = new Map<string, { cape: string; cosmetics: WornChoice }>();
    for (const user of users) {
      const choice = this.choiceOf(user, infos, {
        team: () => team.has(user.uuid),
        unlocked: (id) => unlocks.get(user.uuid)?.has(id) === true,
      });
      result.set(user.uuid, {
        cape: choice.cape ?? '',
        cosmetics: { head: choice.head, back: choice.back, aura: choice.aura, companion: choice.companion },
      });
    }
    return result;
  }

  /** Datenauskunft: die gespeicherte Auswahl je Slot (auch ausgeblendete), null = nichts. */
  exportFor(user: UserRow): CosmeticChoice {
    const stored = (id: string) => (id === '' ? null : id);
    return {
      head: stored(user.worn.head),
      back: stored(user.worn.back),
      aura: stored(user.worn.aura),
      companion: stored(user.worn.companion),
      cape: stored(user.cape),
    };
  }

  // ---------- Team-Bereich ----------

  private teamEntry(info: CosmeticInfoRow, wearers: Map<string, number>) {
    return {
      id: info.id,
      slot: info.slot,
      format: this.formatOf(info),
      version: info.version,
      name: info.name,
      description: info.description,
      access: info.access,
      date: info.date,
      sha256: info.sha256,
      size: info.size,
      hidden: info.hidden,
      wearers: wearers.get(`${info.slot}:${info.id}`) ?? 0,
      createdAt: info.createdAt,
      publishedAt: info.publishedAt,
      publishedBy: info.publishedBy,
    };
  }

  /** `GET /v1/team/cosmetics`: alle Cosmetics (auch ausgeblendete) mit Zahl der Träger, dazu der Schlüssel. */
  overview(key: KeyObject | null) {
    const wearers = this.store.cosmeticWearers();
    return {
      cosmetics: this.store
        .cosmeticInfos()
        .sort(byCatalogOrder)
        .map((info) => this.teamEntry(info, wearers)),
      keyConfigured: key !== null,
      publicKey: key === null ? null : String(key.export({ type: 'spki', format: 'pem' })),
    };
  }

  /** `GET /v1/team/cosmetics/<id>`: Eintrag wie in der Übersicht plus Umschlag (auch ausgeblendete, für die Vorschau). */
  teamDetail(id: string) {
    const row = COSMETIC_ID_RE.test(id) ? this.store.getCosmetic(id) : undefined;
    if (!row) throw new HttpError(404, NO_SUCH_COSMETIC);
    return { cosmetic: this.teamEntry(row, this.store.cosmeticWearers()), manifest: row.manifest, signature: row.signature };
  }

  /**
   * `PUT /v1/team/cosmetics` mit dem Umschlag `{ manifest, signature }`: Form und Größe, Signatur über
   * "heldix-cosmetic\n" + Manifest, alle Regeln des Formats, ID kein eingebautes Cape, bei vorhandener ID derselbe Slot
   * und eine höhere Version. Danach ist das Cosmetic (bzw. die neue Version) im Katalog; `hidden` bleibt, wie es war.
   */
  publish(input: Record<string, unknown>, key: KeyObject, by: string | null): { id: string; version: number; slot: string; previous: number | null } {
    const envelope = checkCosmeticEnvelope(input);
    if (typeof envelope === 'string') throw new HttpError(400, `Ungültiger Cosmetic-Umschlag: ${envelope}.`);
    if (!verifyCosmeticSignature(envelope.manifest, envelope.signature, key)) throw new HttpError(400, WRONG_SIGNATURE);
    const manifest = parseCosmeticManifest(envelope.manifest);
    if (typeof manifest === 'string') throw new HttpError(400, `Ungültiges Cosmetic-Manifest: ${manifest}.`);
    if (this.capes.has(manifest.id)) throw new HttpError(409, `Die ID „${manifest.id}“ gehört schon einem eingebauten Cape.`);
    // Ab hier synchron bis zum Eintragen: Kein anderes Veröffentlichen kommt dazwischen.
    const existing = this.store.getCosmeticInfo(manifest.id);
    if (existing && existing.slot !== manifest.slot) {
      throw new HttpError(409, `„${manifest.id}“ gehört zum Slot ${existing.slot}; der Slot lässt sich nicht ändern (neue ID nehmen).`);
    }
    if (existing && manifest.version <= existing.version) {
      throw new HttpError(409, `Die Version ${manifest.version} ist nicht höher als die vorhandene (${existing.version}).`);
    }
    const text = cosmeticEnvelopeText(envelope);
    const now = Date.now();
    this.formats.set(sha256(text), manifest.format);
    this.store.upsertCosmetic({
      id: manifest.id,
      slot: manifest.slot,
      version: manifest.version,
      access: manifest.access,
      name: manifest.name,
      description: manifest.description,
      date: manifest.date,
      size: Buffer.byteLength(text, 'utf8'),
      sha256: sha256(text),
      createdAt: existing?.createdAt ?? now,
      publishedAt: now,
      publishedBy: by,
      signature: envelope.signature,
      manifest: envelope.manifest,
    });
    this.log(`Cosmetic ${manifest.id} (${manifest.slot}) Version ${manifest.version} ist veröffentlicht.`);
    return { id: manifest.id, version: manifest.version, slot: manifest.slot, previous: existing?.version ?? null };
  }

  /** `PATCH /v1/team/cosmetics/<id>`: ausblenden bzw. wieder zeigen. true, wenn sich etwas geändert hat. */
  setHidden(id: string, hidden: boolean): boolean {
    if (!COSMETIC_ID_RE.test(id) || !this.store.getCosmeticInfo(id)) throw new HttpError(404, NO_SUCH_COSMETIC);
    return this.store.setCosmeticHidden(id, hidden);
  }

  /** `DELETE /v1/team/cosmetics/<id>`: löschen; die Auswahl aller Träger wird zurückgesetzt. */
  remove(id: string): { info: CosmeticInfoRow; reset: number } {
    const info = COSMETIC_ID_RE.test(id) ? this.store.getCosmeticInfo(id) : undefined;
    if (!info) throw new HttpError(404, NO_SUCH_COSMETIC);
    const reset = this.store.deleteCosmetic(id, !this.capes.has(id));
    if (reset === null) throw new HttpError(404, NO_SUCH_COSMETIC);
    this.log(`Cosmetic ${id} ist gelöscht (${reset} Träger zurückgesetzt).`);
    return { info, reset };
  }
}
