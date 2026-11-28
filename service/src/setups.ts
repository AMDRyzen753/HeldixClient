// Setup teilen (ab 1.14.0): Ein Spieler teilt den Inhalt einer Instanz als Link (Minecraft-Version, Loader, Mods,
// Ressourcen- und Shaderpakete von Modrinth, Addons aus dem Store, auf Wunsch Grafik-Einstellungen und Tasten). Der
// Dienst prüft das Format, speichert es als kanonisches JSON mit SHA-256 und zählt Aufrufe und Installationen (nur
// Zahlen; welche IP schon gezählt wurde, merkt er sich nur kurz im Arbeitsspeicher und nur als Hash). Keine Dateien, keine
// URLs: Der Launcher lädt alles selbst von Modrinth bzw. aus dem Store.
import { createHash, randomBytes } from 'node:crypto';
import type { StatementSync } from 'node:sqlite';
import { ADDON_ID_RE } from './addons';
import type { Store, UserRow } from './db';
import { HttpError } from './http';
import type { Reports } from './reports';
import { textError, writeAudit, type Actor } from './team';
import { isVersion } from './updates';
import { checkText, hasForbiddenChars, isInviteCode } from './validate';
import { checkWords } from './wordfilter';
import { newInviteCode } from './invites';

export const SETUP_FORMAT = 1;
export const SETUP_NAME_MAX = 40;
export const SETUP_DESCRIPTION_MAX = 300;
/** Größe des kanonischen JSON von `content` (UTF-8). */
export const SETUP_CONTENT_MAX_BYTES = 64 * 1024;
/** Anfragekörper von `POST /v1/setups` (Inhalt plus Name und Beschreibung). */
export const SETUP_BODY_LIMIT = 96 * 1024;
export const SETUP_LIST_MAX = 300;
export const SETUP_TITLE_MAX = 100;
export const SETUP_GRAPHICS_MAX = 60;
export const SETUP_GRAPHICS_TEXT_MAX = 64;
export const SETUP_KEYS_MAX = 200;
export const SETUP_EXPIRES_DAYS = [7, 30, 90] as const;
export const SETUP_LOADERS = ['heldix', 'fabric', 'vanilla'] as const;
/** Abgelaufene und widerrufene Setups löscht der Dienst so lange danach. */
export const SETUP_KEEP_MS = 30 * 24 * 60 * 60_000;

const MODRINTH_ID_RE = /^[A-Za-z0-9]{8}$/;
const MINECRAFT_RE = /^[A-Za-z0-9._-]{1,32}$/;
const GRAPHICS_KEY_RE = /^[A-Za-z0-9_.:]{1,64}$/;
const KEY_NAME_RE = /^key\.[A-Za-z0-9_.]{1,80}$/;
const KEY_VALUE_RE = /^key\.[a-z0-9_.]{1,40}$/;
const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;

export const SETUP_UNKNOWN = 'Dieses Setup gibt es nicht.';
export const SETUP_EXPIRED = 'Dieses Setup ist abgelaufen.';
export const SETUP_REVOKED = 'Dieses Setup wurde zurückgezogen.';

export interface SetupsOptions {
  /** Adresse der Webseite (für `url` = `<website>/setup#<code>`), ohne: null */
  website: string | null;
  /** Höchstens so viele aktive Setups je Spieler (Standard 50) und neue je 24 Stunden (Standard 20). */
  maxActive: number;
  dailyLimit: number;
  log: (line: string) => void;
}

interface SetupRow {
  code: string;
  uuid: string;
  name: string;
  description: string;
  content: string;
  hash: string;
  created: number;
  expires: number | null;
  revoked: boolean;
  revokedAt: number | null;
  revokedBy: string | null;
  views: number;
  installs: number;
}

type Row = Record<string, unknown>;

const nullableNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));

function toSetup(row: Row): SetupRow {
  return {
    code: String(row.code),
    uuid: String(row.uuid),
    name: String(row.name),
    description: String(row.description),
    content: String(row.content),
    hash: String(row.hash),
    created: Number(row.created),
    expires: nullableNumber(row.expires),
    revoked: Number(row.revoked) === 1,
    revokedAt: nullableNumber(row.revoked_at),
    revokedBy: row.revoked_by === null || row.revoked_by === undefined ? null : String(row.revoked_by),
    views: Number(row.views),
    installs: Number(row.installs),
  };
}

/** Kanonisches JSON: Schlüssel von Objekten sortiert (rekursiv), Listen in ihrer Reihenfolge, ohne Leerzeichen. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fail(message: string): never {
  throw new HttpError(400, `Ungültiges Setup: ${message}`, {}, 'SETUP_INVALID');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Titel bzw. Name eines Eintrags: 1–100 Zeichen, eine Zeile. */
function itemText(value: unknown, field: string): string {
  const checked = checkText(value, SETUP_TITLE_MAX, false);
  if ('problem' in checked) fail(`„${field}“ muss ein Text mit 1 bis ${SETUP_TITLE_MAX} Zeichen sein (eine Zeile).`);
  return checked.text;
}

function modrinthList(value: unknown, list: string): { project: string; version: string; title: string }[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > SETUP_LIST_MAX) fail(`„${list}“ muss eine Liste mit höchstens ${SETUP_LIST_MAX} Einträgen sein.`);
  const seen = new Set<string>();
  const out: { project: string; version: string; title: string }[] = [];
  value.forEach((item, i) => {
    if (!isObject(item)) fail(`„${list}[${i}]“ muss ein Objekt sein.`);
    if (typeof item.project !== 'string' || !MODRINTH_ID_RE.test(item.project)) fail(`„${list}[${i}].project“ ist keine Modrinth-ID (8 Zeichen aus A–Z, a–z, 0–9).`);
    if (typeof item.version !== 'string' || !MODRINTH_ID_RE.test(item.version)) fail(`„${list}[${i}].version“ ist keine Modrinth-Versions-ID (8 Zeichen aus A–Z, a–z, 0–9).`);
    const title = itemText(item.title, `${list}[${i}].title`);
    if (seen.has(item.project)) return;
    seen.add(item.project);
    out.push({ project: item.project, version: item.version, title });
  });
  return out;
}

function addonList(value: unknown): { id: string; version: string | null; name: string }[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > SETUP_LIST_MAX) fail(`„addons“ muss eine Liste mit höchstens ${SETUP_LIST_MAX} Einträgen sein.`);
  const seen = new Set<string>();
  const out: { id: string; version: string | null; name: string }[] = [];
  value.forEach((item, i) => {
    if (!isObject(item)) fail(`„addons[${i}]“ muss ein Objekt sein.`);
    if (typeof item.id !== 'string' || !ADDON_ID_RE.test(item.id)) fail(`„addons[${i}].id“ ist keine ID aus dem Addon-Store.`);
    const version = item.version ?? null;
    if (version !== null && !isVersion(version)) fail(`„addons[${i}].version“ muss eine Version wie 1.2.0 sein oder null.`);
    const name = itemText(item.name, `addons[${i}].name`);
    if (seen.has(item.id)) return;
    seen.add(item.id);
    out.push({ id: item.id, version: version as string | null, name });
  });
  return out;
}

function graphicsOf(value: unknown): Record<string, number | boolean | string> | null {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) fail('„settings.graphics“ muss ein Objekt sein oder null.');
  const entries = Object.entries(value);
  if (entries.length > SETUP_GRAPHICS_MAX) fail(`„settings.graphics“ hat höchstens ${SETUP_GRAPHICS_MAX} Einträge.`);
  for (const [key, entry] of entries) {
    if (!GRAPHICS_KEY_RE.test(key)) fail(`„settings.graphics“: ungültiger Schlüssel „${key.slice(0, 64)}“.`);
    const ok =
      (typeof entry === 'number' && Number.isFinite(entry)) ||
      typeof entry === 'boolean' ||
      (typeof entry === 'string' && entry.length <= SETUP_GRAPHICS_TEXT_MAX && !hasForbiddenChars(entry, false));
    if (!ok) fail(`„settings.graphics.${key}“ muss eine Zahl, true/false oder ein Text bis ${SETUP_GRAPHICS_TEXT_MAX} Zeichen sein.`);
  }
  // Object.fromEntries legt auch einen Schlüssel „__proto__“ als eigenes Feld an (kein Umweg über den Prototyp).
  return Object.fromEntries(entries) as Record<string, number | boolean | string>;
}

function keysOf(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) fail('„settings.keys“ muss ein Objekt sein oder null.');
  const entries = Object.entries(value);
  if (entries.length > SETUP_KEYS_MAX) fail(`„settings.keys“ hat höchstens ${SETUP_KEYS_MAX} Einträge.`);
  for (const [key, entry] of entries) {
    if (!KEY_NAME_RE.test(key)) fail(`„settings.keys“: ungültiger Schlüssel „${key.slice(0, 90)}“ (erwartet key.…).`);
    if (typeof entry !== 'string' || !KEY_VALUE_RE.test(entry)) fail(`„settings.keys.${key}“ muss eine Taste wie key.keyboard.r sein.`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * Prüft `content` eines Setups (Format 1) und liefert die bereinigte Form, ihr kanonisches JSON und dessen SHA-256.
 * Unbekannte Felder fallen weg; doppelte Einträge (gleiches Projekt bzw. Addon) zählen einmal.
 */
export function checkSetupContent(value: unknown): { content: Record<string, unknown>; json: string; hash: string } {
  if (!isObject(value)) fail('„content“ muss ein Objekt sein.');
  if (value.v !== SETUP_FORMAT) fail(`„content.v“ muss ${SETUP_FORMAT} sein.`);
  if (typeof value.minecraft !== 'string' || !MINECRAFT_RE.test(value.minecraft)) fail('„content.minecraft“ muss eine Minecraft-Version wie 26.3 sein.');
  if (!(SETUP_LOADERS as readonly unknown[]).includes(value.loader)) fail(`„content.loader“ muss ${SETUP_LOADERS.map((l) => `"${l}"`).join(', ')} sein.`);
  if (typeof value.heldixClient !== 'boolean') fail('„content.heldixClient“ muss true oder false sein.');
  const settings = value.settings ?? null;
  if (settings !== null && !isObject(settings)) fail('„content.settings“ muss ein Objekt sein oder null.');
  const content: Record<string, unknown> = {
    v: SETUP_FORMAT,
    minecraft: value.minecraft,
    loader: value.loader,
    heldixClient: value.heldixClient,
    mods: modrinthList(value.mods, 'mods'),
    resourcepacks: modrinthList(value.resourcepacks, 'resourcepacks'),
    shaderpacks: modrinthList(value.shaderpacks, 'shaderpacks'),
    addons: addonList(value.addons),
    settings: { graphics: graphicsOf(settings?.graphics), keys: keysOf(settings?.keys) },
  };
  const json = canonicalJson(content);
  if (Buffer.byteLength(json, 'utf8') > SETUP_CONTENT_MAX_BYTES) fail(`„content“ ist zu groß (höchstens ${SETUP_CONTENT_MAX_BYTES / 1024} KiB).`);
  return { content, json, hash: createHash('sha256').update(json, 'utf8').digest('hex') };
}

/** Einzeiliger Text mit Wortfilter (wie in Entdecken: keine Beleidigungen, keine Links). */
function publicText(value: unknown, field: string, max: number, allowEmpty: boolean): string {
  const checked = checkText(value ?? '', max, allowEmpty);
  if ('problem' in checked) throw new HttpError(400, textError(field, max, checked.problem));
  const problem = checkWords(checked.text);
  if (problem === 'link') throw new HttpError(400, `„${field}“: Links und Werbung für andere Dienste sind hier nicht erlaubt.`, {}, 'words-link');
  if (problem === 'word') throw new HttpError(400, `„${field}“ enthält Wörter, die hier nicht erlaubt sind.`, {}, 'words-word');
  return checked.text;
}

/** Merkt sich kurz, welche IP (als Hash) für welches Setup schon gezählt wurde (nur im Arbeitsspeicher). */
class SeenOnce {
  private readonly entries = new Map<string, number>();
  constructor(private readonly ttlMs: number) {}

  /** true beim ersten Mal im Zeitraum. */
  first(key: string, now: number): boolean {
    const until = this.entries.get(key);
    if (until !== undefined && until > now) return false;
    if (this.entries.size >= 100_000) this.sweep(now);
    if (this.entries.size >= 100_000) this.entries.clear();
    this.entries.set(key, now + this.ttlMs);
    return true;
  }

  sweep(now: number): void {
    for (const [key, until] of this.entries) if (until <= now) this.entries.delete(key);
  }
}

export class Setups {
  private readonly sql: Record<string, StatementSync>;
  /** Zufälliges Salz je Prozess: IP-Adressen stehen nicht einmal im Arbeitsspeicher im Klartext. */
  private readonly salt = randomBytes(16);
  private readonly viewed = new SeenOnce(HOUR_MS);
  private readonly installed = new SeenOnce(DAY_MS);

  constructor(
    private readonly store: Store,
    private readonly reports: Reports,
    private readonly options: SetupsOptions,
  ) {
    const p = (sql: string) => store.prepare(sql);
    const COLUMNS = 'code, uuid, name, description, content, hash, created, expires, revoked, revoked_at, revoked_by, views, installs';
    this.sql = {
      insert: p(`INSERT INTO setups (code, uuid, name, description, content, hash, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
      get: p(`SELECT ${COLUMNS} FROM setups WHERE code = ?`),
      mine: p(`SELECT ${COLUMNS} FROM setups WHERE uuid = ? ORDER BY created DESC`),
      countActive: p('SELECT count(*) AS n FROM setups WHERE uuid = ? AND revoked = 0 AND (expires IS NULL OR expires > ?)'),
      countSince: p('SELECT count(*) AS n, min(created) AS oldest FROM setups WHERE uuid = ? AND created > ?'),
      revoke: p('UPDATE setups SET revoked = 1, revoked_at = ?, revoked_by = ? WHERE code = ? AND revoked = 0'),
      view: p('UPDATE setups SET views = views + 1 WHERE code = ?'),
      install: p('UPDATE setups SET installs = installs + 1 WHERE code = ?'),
      sweep: p('DELETE FROM setups WHERE (revoked = 1 AND revoked_at < ?) OR (expires IS NOT NULL AND expires < ?)'),
    };
  }

  private url(code: string): string | null {
    return this.options.website === null ? null : `${this.options.website}/setup#${code}`;
  }

  private find(code: string | undefined): SetupRow | undefined {
    if (!isInviteCode(code)) return undefined;
    const row = this.sql.get!.get(code) as Row | undefined;
    return row ? toSetup(row) : undefined;
  }

  private status(setup: SetupRow, now = Date.now()): 'active' | 'expired' | 'revoked' {
    if (setup.revoked) return 'revoked';
    if (setup.expires !== null && setup.expires <= now) return 'expired';
    return 'active';
  }

  /** Setup, das öffentlich gilt: unbekannt 404, abgelaufen oder widerrufen 410 (mit code). */
  private live(code: string | undefined): SetupRow {
    const setup = this.find(code);
    if (!setup) throw new HttpError(404, SETUP_UNKNOWN, {}, 'SETUP_UNKNOWN');
    const status = this.status(setup);
    if (status === 'revoked') throw new HttpError(410, SETUP_REVOKED, {}, 'SETUP_REVOKED');
    if (status === 'expired') throw new HttpError(410, SETUP_EXPIRED, {}, 'SETUP_EXPIRED');
    return setup;
  }

  private ipKey(code: string, ip: string): string {
    return `${code}:${createHash('sha256').update(this.salt).update(ip).digest('base64url').slice(0, 22)}`;
  }

  /** Kurzfassung für Listen (ohne den ganzen Inhalt). */
  private summary(setup: SetupRow) {
    let content: Record<string, unknown> = {};
    try {
      content = JSON.parse(setup.content) as Record<string, unknown>;
    } catch {
      content = {};
    }
    const count = (key: string) => (Array.isArray(content[key]) ? (content[key] as unknown[]).length : 0);
    const settings = isObject(content.settings) ? content.settings : {};
    return {
      minecraft: typeof content.minecraft === 'string' ? content.minecraft : null,
      loader: typeof content.loader === 'string' ? content.loader : null,
      heldixClient: content.heldixClient === true,
      counts: { mods: count('mods'), resourcepacks: count('resourcepacks'), shaderpacks: count('shaderpacks'), addons: count('addons') },
      graphics: settings.graphics !== null && settings.graphics !== undefined,
      keys: settings.keys !== null && settings.keys !== undefined,
    };
  }

  private ownView(setup: SetupRow) {
    const status = this.status(setup);
    return {
      code: setup.code,
      url: this.url(setup.code),
      name: setup.name,
      description: setup.description,
      created: setup.created,
      expires: setup.expires,
      status,
      revoked: setup.revoked,
      expired: status === 'expired',
      views: setup.views,
      installs: setup.installs,
      hash: setup.hash,
      ...this.summary(setup),
    };
  }

  // ---------- Angemeldet ----------

  /** `POST /v1/setups { name, description, content, expiresDays: 7 | 30 | 90 | null }` → `{ code, url, expires }` */
  create(user: UserRow, input: Record<string, unknown>): { code: string; url: string | null; expires: number | null } {
    const name = publicText(input.name, 'name', SETUP_NAME_MAX, false);
    const description = publicText(input.description, 'description', SETUP_DESCRIPTION_MAX, true);
    const days = input.expiresDays ?? null;
    if (days !== null && !(SETUP_EXPIRES_DAYS as readonly unknown[]).includes(days)) throw new HttpError(400, '„expiresDays“ muss 7, 30, 90 oder null (nie) sein.');
    const { json, hash } = checkSetupContent(input.content);
    const now = Date.now();
    const active = Number((this.sql.countActive!.get(user.uuid, now) as Row).n);
    if (active >= this.options.maxActive) {
      throw new HttpError(409, `Du hast schon ${this.options.maxActive} aktive Setups. Widerrufe ältere, bevor du ein neues teilst.`, {}, 'SETUP_LIMIT');
    }
    const recent = this.sql.countSince!.get(user.uuid, now - DAY_MS) as Row;
    if (Number(recent.n) >= this.options.dailyLimit) {
      const retry = Math.max(1, Math.ceil((Number(recent.oldest ?? now) + DAY_MS - now) / 1000));
      throw new HttpError(429, `Höchstens ${this.options.dailyLimit} neue Setups pro Tag. Versuch es morgen wieder.`, { 'Retry-After': String(retry) }, 'SETUP_DAILY');
    }
    let code = newInviteCode();
    for (let tries = 0; this.sql.get!.get(code) !== undefined && tries < 5; tries++) code = newInviteCode();
    const expires = days === null ? null : now + (days as number) * DAY_MS;
    this.sql.insert!.run(code, user.uuid, name, description, json, hash, now, expires);
    return { code, url: this.url(code), expires };
  }

  /** `GET /v1/setups`: eigene Setups (auch abgelaufene und widerrufene, bis sie gelöscht werden), neueste zuerst. */
  mine(user: UserRow) {
    return {
      setups: (this.sql.mine!.all(user.uuid) as Row[]).map(toSetup).map((s) => this.ownView(s)),
      limits: { active: this.options.maxActive, daily: this.options.dailyLimit },
    };
  }

  private own(user: UserRow, code: string | undefined): SetupRow {
    const setup = this.find(code);
    if (!setup || setup.uuid !== user.uuid) throw new HttpError(404, SETUP_UNKNOWN, {}, 'SETUP_UNKNOWN');
    return setup;
  }

  /** `GET /v1/setups/<code>`: eigenes Setup mit Inhalt (auch abgelaufen oder widerrufen; zählt keinen Aufruf). */
  getOwn(user: UserRow, code: string | undefined) {
    const setup = this.own(user, code);
    return { ...this.ownView(setup), content: JSON.parse(setup.content) as unknown };
  }

  /** `DELETE /v1/setups/<code>`: widerrufen (nur der Ersteller; noch einmal widerrufen ändert nichts). */
  revoke(user: UserRow, code: string | undefined) {
    const setup = this.own(user, code);
    this.sql.revoke!.run(Date.now(), null, setup.code);
    return { ok: true, setup: this.ownView(this.find(setup.code)!) };
  }

  /** `POST /v1/setups/<code>/report { reason, note? }`: in die Meldungen des Teams. */
  report(user: UserRow, code: string | undefined, input: Record<string, unknown>) {
    const setup = this.live(code);
    const owner = this.store.getUser(setup.uuid);
    return this.reports.reportSubject(
      user,
      { kind: 'setup', subject: setup.code, owner: { uuid: setup.uuid, name: owner?.name ?? '' }, snapshot: { code: setup.code, name: setup.name, description: setup.description } },
      input,
    );
  }

  // ---------- Öffentlich ----------

  /** `GET /v1/public/setups/<code>`: Setup mit Inhalt; zählt einen Aufruf (höchstens einmal je IP und Stunde). */
  publicGet(code: string | undefined, ip: string) {
    const setup = this.live(code);
    const now = Date.now();
    let views = setup.views;
    if (this.viewed.first(this.ipKey(setup.code, ip), now)) {
      this.sql.view!.run(setup.code);
      views++;
    }
    const creator = this.store.getUser(setup.uuid);
    return {
      code: setup.code,
      name: setup.name,
      description: setup.description,
      creator: { name: creator?.name ?? '', uuid: setup.uuid },
      content: JSON.parse(setup.content) as unknown,
      hash: setup.hash,
      created: setup.created,
      expires: setup.expires,
      views,
      installs: setup.installs,
    };
  }

  /** `POST /v1/public/setups/<code>/installed`: zählt eine Installation (höchstens einmal je IP und Tag). */
  markInstalled(code: string | undefined, ip: string) {
    const setup = this.live(code);
    const counted = this.installed.first(this.ipKey(setup.code, ip), Date.now());
    if (counted) this.sql.install!.run(setup.code);
    return { ok: true, counted, installs: setup.installs + (counted ? 1 : 0) };
  }

  // ---------- Team ----------

  /** `DELETE /v1/team/setups/<code>` (Moderation): Setup für alle zurückziehen. */
  teamRevoke(actor: Actor, code: string | undefined) {
    const setup = this.find(code);
    if (!setup) throw new HttpError(404, SETUP_UNKNOWN, {}, 'SETUP_UNKNOWN');
    if (Number(this.sql.revoke!.run(Date.now(), actor.name, setup.code).changes) > 0) {
      writeAudit(this.store, actor, 'setup.revoke', `${setup.name} (${setup.code})`);
    }
    return { ok: true, code: setup.code, revoked: true };
  }

  // ---------- Datenschutz, Aufräumen ----------

  /** Datenauskunft: eigene Setups mit Inhalt. */
  exportFor(user: UserRow) {
    return (this.sql.mine!.all(user.uuid) as Row[]).map(toSetup).map((s) => ({ ...this.ownView(s), content: JSON.parse(s.content) as unknown }));
  }

  /** Abgelaufene und widerrufene Setups nach 30 Tagen löschen; gemerkte IP-Hashes aufräumen. */
  sweep(now: number): void {
    this.sql.sweep!.run(now - SETUP_KEEP_MS, now - SETUP_KEEP_MS);
    this.viewed.sweep(now);
    this.installed.sweep(now);
  }
}
