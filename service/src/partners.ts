// Server-Partner-Programm (ab 1.14.0): Spieler beantragen eine Partnerschaft für ihren Server, das Team legt Partner an
// (Name, Beschreibung, Webseite, Server-Adressen, hervorgehoben) und erzeugt den Partner-Schlüssel für das Server-Plugin.
// Mit dem Schlüssel (`Authorization: Partner <key>`) setzt das Plugin Server-Gruppen im Voice Chat
// (voice-server-groups.ts) und vergibt Belohnungs-Cosmetics des Partners. Gespeichert wird vom Schlüssel nur der
// SHA-256-Hash; der Schlüssel selbst steht nur einmal in der Antwort beim Erzeugen.
import { createHash, randomInt } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { StatementSync } from 'node:sqlite';
import type { Store, UserRow } from './db';
import { COSMETIC_ID_RE } from './cosmetics-format';
import { HttpError } from './http';
import type { Realtime } from './realtime';
import { playerLabel, textError, writeAudit, type Actor } from './team';
import { checkText, isUuid, normalizeServer } from './validate';
import type { ServerGroupScope } from './voice-server-groups';

export const PARTNER_ID_RE = /^[a-z0-9-]{3,32}$/;
/** Partner-Schlüssel: `hxp_` und 40 Zeichen Base62. */
export const PARTNER_KEY_RE = /^hxp_[0-9A-Za-z]{40}$/;
export const PARTNER_NAME_MAX = 40;
export const PARTNER_DESCRIPTION_MAX = 300;
export const PARTNER_MAX_SERVERS = 10;
export const PARTNER_WEBSITE_MAX = 200;
export const APPLICATION_CONTACT_MAX = 200;
export const APPLICATION_NOTE_MAX = 300;
export const PARTNER_STATUSES = ['active', 'paused'] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];
export const APPLICATION_STATUSES = ['open', 'accepted', 'declined'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Öffentliche Liste so lange im Speicher (wie Cache-Control). */
export const PUBLIC_PARTNERS_CACHE_MS = 5 * 60_000;

export const NO_SUCH_PARTNER = 'Diesen Partner gibt es nicht.';
export const PARTNER_KEY_INVALID = 'Ungültiger Partner-Schlüssel.';
export const PARTNER_PAUSED = 'Dieser Partner ist gerade pausiert. Bitte melde dich beim HeldixClient-Team.';
const NO_SUCH_APPLICATION = 'Diesen Antrag gibt es nicht.';
const BAD_SERVER = 'Ungültige Server-Adresse: nur öffentliche Domains wie play.example.net (keine IP-Adressen, kein localhost).';

export interface PartnerRow {
  id: string;
  name: string;
  description: string;
  website: string | null;
  servers: string[];
  status: PartnerStatus;
  featured: boolean;
  created: number;
  hasKey: boolean;
  keyCreated: number | null;
  contactUuid: string | null;
}

export interface ApplicationRow {
  id: number;
  uuid: string;
  server: string;
  name: string;
  description: string;
  contact: string;
  created: number;
  status: ApplicationStatus;
  note: string;
  decidedAt: number | null;
  decidedBy: string | null;
}

export interface PartnersOptions {
  log: (line: string) => void;
  /** Partner pausiert, gelöscht oder Server geändert: Server-Gruppen dieses Partners leeren (voice-server-groups.ts). */
  onPartnerChanged?: (id: string) => void;
}

type Row = Record<string, unknown>;

const nullableNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const nullableString = (value: unknown) => (value === null || value === undefined ? null : String(value));

function parseServers(value: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function toPartner(row: Row): PartnerRow {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    website: nullableString(row.website),
    servers: parseServers(row.servers),
    status: row.status === 'paused' ? 'paused' : 'active',
    featured: Number(row.featured) === 1,
    created: Number(row.created),
    hasKey: row.key_hash !== null && row.key_hash !== undefined,
    keyCreated: nullableNumber(row.key_created),
    contactUuid: nullableString(row.contact_uuid),
  };
}

function toApplication(row: Row): ApplicationRow {
  const status = String(row.status);
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    server: String(row.server),
    name: String(row.name),
    description: String(row.description),
    contact: String(row.contact),
    created: Number(row.created),
    status: (APPLICATION_STATUSES as readonly string[]).includes(status) ? (status as ApplicationStatus) : 'open',
    note: String(row.note),
    decidedAt: nullableNumber(row.decided_at),
    decidedBy: nullableString(row.decided_by),
  };
}

/** Neuer Partner-Schlüssel: `hxp_` + 40 Zeichen Base62, gleich verteilt (crypto.randomInt). */
export function newPartnerKey(): string {
  let key = 'hxp_';
  for (let i = 0; i < 40; i++) key += BASE62[randomInt(BASE62.length)];
  return key;
}

export function hashPartnerKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Host und Port einer normalisierten Adresse (`<host>` oder `<host>:<port>`; ohne Port = 25565). */
function splitServer(server: string): { host: string; port: string | null } {
  const match = /^(.*):(\d{1,5})$/.exec(server);
  return match ? { host: match[1]!, port: match[2]! } : { host: server, port: null };
}

/**
 * Passt die Adresse eines Spielers zum Server-Eintrag eines Partners? Gleicher Host oder eine Subdomain davon; hat der
 * Eintrag einen Port, muss er gleich sein (ohne Port im Eintrag passt jeder Port).
 */
export function serverMatches(entry: string, server: string): boolean {
  const e = splitServer(entry);
  const s = splitServer(server);
  if (e.port !== null && e.port !== s.port) return false;
  return s.host === e.host || s.host.endsWith(`.${e.host}`);
}

/** Einzeiliger Text mit Grenze; Problem als deutscher Satz (Feldname wie in der Anfrage). */
function text(value: unknown, field: string, max: number, allowEmpty: boolean): string {
  const checked = checkText(value ?? '', max, allowEmpty);
  if ('problem' in checked) throw new HttpError(400, textError(field, max, checked.problem));
  return checked.text;
}

/** Webseite eines Partners: https-Adresse (höchstens 200 Zeichen) oder null. */
function websiteOf(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > PARTNER_WEBSITE_MAX) throw new HttpError(400, `„website“ muss eine https-Adresse sein (höchstens ${PARTNER_WEBSITE_MAX} Zeichen) oder null.`);
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new HttpError(400, '„website“ ist keine gültige Adresse.');
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || !url.hostname.includes('.')) {
    throw new HttpError(400, '„website“ muss mit https:// beginnen (ohne Benutzername und Passwort).');
  }
  return url.href;
}

/** Server-Liste eines Partners: 1–10 normalisierte Adressen ohne Doppelte. */
function serversOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > PARTNER_MAX_SERVERS) {
    throw new HttpError(400, `„servers“ muss eine Liste mit 1 bis ${PARTNER_MAX_SERVERS} Server-Adressen sein.`);
  }
  const out: string[] = [];
  for (const raw of value) {
    const server = normalizeServer(raw);
    if (server === null) throw new HttpError(400, `${BAD_SERVER} (${typeof raw === 'string' ? raw.slice(0, 60) : typeof raw})`);
    if (!out.includes(server)) out.push(server);
  }
  return out;
}

export class Partners {
  private readonly sql: Record<string, StatementSync>;
  /** Aktive Partner (für Voice und Abzeichen), bei jeder Änderung neu gelesen */
  private activeCache: PartnerRow[] | null = null;
  private publicCache: { value: unknown; until: number } | null = null;

  constructor(
    private readonly store: Store,
    private readonly realtime: Realtime,
    private readonly options: PartnersOptions,
  ) {
    const p = (sql: string) => store.prepare(sql);
    const COLUMNS = 'id, name, description, website, servers, status, featured, created, key_hash, key_created, contact_uuid';
    const APP_COLUMNS = 'id, uuid, server, name, description, contact, created, status, note, decided_at, decided_by';
    this.sql = {
      all: p(`SELECT ${COLUMNS} FROM partners ORDER BY featured DESC, name COLLATE NOCASE, id`),
      get: p(`SELECT ${COLUMNS} FROM partners WHERE id = ?`),
      byKey: p(`SELECT ${COLUMNS} FROM partners WHERE key_hash = ?`),
      insert: p(`INSERT INTO partners (id, name, description, website, servers, status, featured, created, contact_uuid)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`),
      update: p('UPDATE partners SET name = ?, description = ?, website = ?, servers = ?, status = ?, featured = ?, contact_uuid = ? WHERE id = ?'),
      setKey: p('UPDATE partners SET key_hash = ?, key_created = ? WHERE id = ?'),
      delete: p('DELETE FROM partners WHERE id = ?'),
      insertApp: p(`INSERT INTO partner_applications (uuid, server, name, description, contact, created) VALUES (?, ?, ?, ?, ?, ?)`),
      openAppOf: p("SELECT id FROM partner_applications WHERE uuid = ? AND status = 'open' LIMIT 1"),
      appsOf: p(`SELECT ${APP_COLUMNS} FROM partner_applications WHERE uuid = ? ORDER BY id DESC`),
      app: p(`SELECT ${APP_COLUMNS} FROM partner_applications WHERE id = ?`),
      apps: p(`SELECT ${APP_COLUMNS} FROM partner_applications ORDER BY id DESC LIMIT 500`),
      appsByStatus: p(`SELECT ${APP_COLUMNS} FROM partner_applications WHERE status = ? ORDER BY id DESC LIMIT 500`),
      decideApp: p('UPDATE partner_applications SET status = ?, note = ?, decided_at = ?, decided_by = ? WHERE id = ?'),
      cosmeticsOf: p('SELECT cosmetic FROM partner_cosmetics WHERE partner = ? ORDER BY cosmetic'),
      allCosmetics: p('SELECT c.cosmetic, c.partner, p.name FROM partner_cosmetics c JOIN partners p ON p.id = c.partner'),
      cosmeticPartner: p('SELECT partner FROM partner_cosmetics WHERE cosmetic = ?'),
      assign: p('INSERT INTO partner_cosmetics (cosmetic, partner) VALUES (?, ?) ON CONFLICT (cosmetic) DO UPDATE SET partner = excluded.partner'),
      unassign: p('DELETE FROM partner_cosmetics WHERE cosmetic = ?'),
    };
  }

  private changed(id: string, voice: boolean): void {
    this.activeCache = null;
    this.publicCache = null;
    if (voice) this.options.onPartnerChanged?.(id);
  }

  private all(): PartnerRow[] {
    return (this.sql.all!.all() as Row[]).map(toPartner);
  }

  get(id: string | undefined): PartnerRow | undefined {
    if (id === undefined || !PARTNER_ID_RE.test(id)) return undefined;
    const row = this.sql.get!.get(id) as Row | undefined;
    return row ? toPartner(row) : undefined;
  }

  private require(id: string | undefined): PartnerRow {
    const partner = this.get(id);
    if (!partner) throw new HttpError(404, NO_SUCH_PARTNER);
    return partner;
  }

  private active(): PartnerRow[] {
    this.activeCache ??= this.all().filter((p) => p.status === 'active');
    return this.activeCache;
  }

  private cosmeticsOf(id: string): string[] {
    return (this.sql.cosmeticsOf!.all(id) as Row[]).map((row) => String(row.cosmetic));
  }

  // ---------- Öffentlich ----------

  /** `GET /v1/public/partners`: aktive Partner, hervorgehobene zuerst (5 Minuten im Speicher). */
  publicList() {
    const now = Date.now();
    if (this.publicCache && this.publicCache.until > now) return this.publicCache.value;
    const value = {
      partners: this.active().map((p) => ({ id: p.id, name: p.name, description: p.description, website: p.website, servers: p.servers, featured: p.featured })),
    };
    this.publicCache = { value, until: now + PUBLIC_PARTNERS_CACHE_MS };
    return value;
  }

  /**
   * Bereich für Server-Gruppen zu einer normalisierten Adresse: der längste passende Server-Eintrag eines aktiven
   * Partners (eine Domain deckt ihre Subdomains ab), sonst null.
   */
  scopeFor(server: string): ServerGroupScope | null {
    let best: ServerGroupScope | null = null;
    for (const partner of this.active()) {
      for (const entry of partner.servers) {
        if (!serverMatches(entry, server)) continue;
        if (best === null || entry.length > best.entry.length) best = { key: `${partner.id} ${entry}`, partner: partner.id, partnerName: partner.name, entry };
      }
    }
    return best;
  }

  // ---------- Anträge (Spieler) ----------

  private applicationView(app: ApplicationRow) {
    return {
      id: app.id,
      server: app.server,
      name: app.name,
      description: app.description,
      contact: app.contact,
      created: app.created,
      status: app.status,
      note: app.note === '' ? null : app.note,
      decidedAt: app.decidedAt,
    };
  }

  /** `POST /v1/partner-applications { server, name, description, contact }`: höchstens ein offener Antrag je Spieler. */
  apply(user: UserRow, input: Record<string, unknown>): { id: number } {
    const server = normalizeServer(input.server);
    if (server === null) throw new HttpError(400, BAD_SERVER);
    const name = text(input.name, 'name', PARTNER_NAME_MAX, false);
    const description = text(input.description, 'description', PARTNER_DESCRIPTION_MAX, true);
    const contact = text(input.contact, 'contact', APPLICATION_CONTACT_MAX, true);
    if (this.sql.openAppOf!.get(user.uuid) !== undefined) {
      throw new HttpError(409, 'Du hast schon einen offenen Antrag. Das Team meldet sich, sobald es ihn geprüft hat.', {}, 'APPLICATION_OPEN');
    }
    const result = this.sql.insertApp!.run(user.uuid, server, name, description, contact, Date.now());
    const id = Number(result.lastInsertRowid);
    this.options.log(`Neuer Antrag auf das Partner-Programm (#${id}).`);
    return { id };
  }

  /** `GET /v1/account/partner-applications`: eigene Anträge, neueste zuerst. */
  mine(user: UserRow) {
    return { applications: (this.sql.appsOf!.all(user.uuid) as Row[]).map(toApplication).map((a) => this.applicationView(a)) };
  }

  // ---------- Team ----------

  private teamView(partner: PartnerRow) {
    const contact = partner.contactUuid === null ? undefined : this.store.getUser(partner.contactUuid);
    return {
      id: partner.id,
      name: partner.name,
      description: partner.description,
      website: partner.website,
      servers: partner.servers,
      status: partner.status,
      featured: partner.featured,
      created: partner.created,
      hasKey: partner.hasKey,
      keyCreated: partner.keyCreated,
      contact: partner.contactUuid === null ? null : { uuid: partner.contactUuid, name: contact?.name ?? '' },
      cosmetics: this.cosmeticsOf(partner.id),
    };
  }

  /** `GET /v1/team/partners` */
  teamList() {
    return { partners: this.all().map((p) => this.teamView(p)) };
  }

  /** Eine Adresse darf nur zu einem Partner gehören (gleicher Eintrag). */
  private checkServersFree(servers: string[], except: string | null): void {
    for (const other of this.all()) {
      if (other.id === except) continue;
      const taken = servers.find((s) => other.servers.includes(s));
      if (taken !== undefined) throw new HttpError(409, `Die Adresse „${taken}“ gehört schon zum Partner „${other.name}“.`, {}, 'SERVER_TAKEN');
    }
  }

  private contactOf(input: Record<string, unknown>, current: string | null): string | null {
    if (Object.hasOwn(input, 'application') && input.application !== null && input.application !== undefined) {
      const id = input.application;
      const app = typeof id === 'number' && Number.isInteger(id) ? (this.sql.app!.get(id) as Row | undefined) : undefined;
      if (!app) throw new HttpError(404, NO_SUCH_APPLICATION);
      return String(app.uuid);
    }
    if (!Object.hasOwn(input, 'contactUuid')) return current;
    if (input.contactUuid === null) return null;
    if (!isUuid(input.contactUuid)) throw new HttpError(400, '„contactUuid“ muss eine UUID (32 kleine Hex-Zeichen) oder null sein.');
    if (!this.store.getUser(input.contactUuid)) throw new HttpError(404, 'Diesen Spieler kennt der Heldix-Dienst nicht.');
    return input.contactUuid;
  }

  /** `POST /v1/team/partners { id, name, description, website, servers, featured, contactUuid?, application? }` */
  create(actor: Actor, input: Record<string, unknown>) {
    const { id } = input;
    if (typeof id !== 'string' || !PARTNER_ID_RE.test(id)) throw new HttpError(400, '„id“ muss 3 bis 32 Zeichen aus a–z, 0–9 und - haben.');
    if (this.get(id)) throw new HttpError(409, `Den Partner „${id}“ gibt es schon.`, {}, 'PARTNER_EXISTS');
    const name = text(input.name, 'name', PARTNER_NAME_MAX, false);
    const description = text(input.description, 'description', PARTNER_DESCRIPTION_MAX, true);
    const website = websiteOf(input.website);
    const servers = serversOf(input.servers);
    const featured = input.featured ?? false;
    if (typeof featured !== 'boolean') throw new HttpError(400, '„featured“ muss true oder false sein.');
    this.checkServersFree(servers, null);
    const contact = this.contactOf(input, null);
    this.sql.insert!.run(id, name, description, website, JSON.stringify(servers), featured ? 1 : 0, Date.now(), contact);
    writeAudit(this.store, actor, 'partner.create', `${name} (${id})`, servers.join(', '));
    this.changed(id, false);
    return { partner: this.teamView(this.require(id)) };
  }

  /** `PUT /v1/team/partners/<id>`: Teilfelder (name, description, website, servers, featured, status, contactUuid). */
  update(actor: Actor, id: string | undefined, input: Record<string, unknown>) {
    const partner = this.require(id);
    const name = Object.hasOwn(input, 'name') ? text(input.name, 'name', PARTNER_NAME_MAX, false) : partner.name;
    const description = Object.hasOwn(input, 'description') ? text(input.description, 'description', PARTNER_DESCRIPTION_MAX, true) : partner.description;
    const website = Object.hasOwn(input, 'website') ? websiteOf(input.website) : partner.website;
    const servers = Object.hasOwn(input, 'servers') ? serversOf(input.servers) : partner.servers;
    let featured = partner.featured;
    if (Object.hasOwn(input, 'featured')) {
      if (typeof input.featured !== 'boolean') throw new HttpError(400, '„featured“ muss true oder false sein.');
      featured = input.featured;
    }
    let status = partner.status;
    if (Object.hasOwn(input, 'status')) {
      if (!(PARTNER_STATUSES as readonly unknown[]).includes(input.status)) throw new HttpError(400, '„status“ muss "active" oder "paused" sein.');
      status = input.status as PartnerStatus;
    }
    this.checkServersFree(servers, partner.id);
    const contact = this.contactOf(input, partner.contactUuid);
    this.sql.update!.run(name, description, website, JSON.stringify(servers), status, featured ? 1 : 0, contact, partner.id);
    const detail = [status !== partner.status ? `Status ${status}` : '', JSON.stringify(servers) !== JSON.stringify(partner.servers) ? `Server ${servers.join(', ')}` : '']
      .filter(Boolean)
      .join('; ');
    writeAudit(this.store, actor, 'partner.update', `${name} (${partner.id})`, detail || null);
    // Pausiert oder andere Server: Server-Gruppen im Voice gelten nicht mehr (das Plugin schickt sie neu).
    this.changed(partner.id, status === 'paused' || JSON.stringify(servers) !== JSON.stringify(partner.servers));
    return { partner: this.teamView(this.require(partner.id)) };
  }

  /** `POST /v1/team/partners/<id>/key`: neuer Schlüssel (der alte gilt ab sofort nicht mehr); nur hier im Klartext. */
  newKey(actor: Actor, id: string | undefined) {
    const partner = this.require(id);
    const key = newPartnerKey();
    const now = Date.now();
    this.sql.setKey!.run(hashPartnerKey(key), now, partner.id);
    writeAudit(this.store, actor, 'partner.key', `${partner.name} (${partner.id})`, partner.hasKey ? 'ersetzt' : 'neu');
    this.changed(partner.id, false);
    return { key, keyCreated: now };
  }

  /** `DELETE /v1/team/partners/<id>`: mit Zuordnung der Cosmetics; vergebene Freischaltungen bleiben. */
  remove(actor: Actor, id: string | undefined) {
    const partner = this.require(id);
    this.sql.delete!.run(partner.id);
    writeAudit(this.store, actor, 'partner.delete', `${partner.name} (${partner.id})`);
    this.changed(partner.id, true);
    return { ok: true };
  }

  /** `GET /v1/team/partner-applications?status=open|accepted|declined|all` (Standard open) */
  teamApplications(status: string | null) {
    const filter = status ?? 'open';
    if (filter !== 'all' && !(APPLICATION_STATUSES as readonly string[]).includes(filter)) {
      throw new HttpError(400, '„status“ muss open, accepted, declined oder all sein.');
    }
    const rows = (filter === 'all' ? this.sql.apps!.all() : this.sql.appsByStatus!.all(filter)) as Row[];
    return {
      applications: rows.map(toApplication).map((app) => ({
        ...this.applicationView(app),
        uuid: app.uuid,
        player: { uuid: app.uuid, name: this.store.getUser(app.uuid)?.name ?? '' },
        decidedBy: app.decidedBy,
      })),
    };
  }

  /** `PUT /v1/team/partner-applications/<id> { status, note? }`: Annehmen legt keinen Partner an (das macht das Formular). */
  decide(actor: Actor, id: number, input: Record<string, unknown>) {
    const row = this.sql.app!.get(id) as Row | undefined;
    if (!row) throw new HttpError(404, NO_SUCH_APPLICATION);
    const app = toApplication(row);
    if (!(APPLICATION_STATUSES as readonly unknown[]).includes(input.status)) throw new HttpError(400, '„status“ muss "open", "accepted" oder "declined" sein.');
    const status = input.status as ApplicationStatus;
    const note = Object.hasOwn(input, 'note') && input.note !== null ? text(input.note, 'note', APPLICATION_NOTE_MAX, true) : app.note;
    const decided = status === 'open' ? null : Date.now();
    this.sql.decideApp!.run(status, note, decided, status === 'open' ? null : actor.name, id);
    const user = this.store.getUser(app.uuid);
    writeAudit(this.store, actor, 'partner-application.decide', `#${id} ${playerLabel(user?.name ?? '', app.uuid)}`, status);
    const updated = toApplication(this.sql.app!.get(id) as Row);
    return { application: { ...this.applicationView(updated), player: { uuid: updated.uuid, name: user?.name ?? '' }, decidedBy: updated.decidedBy } };
  }

  // ---------- Belohnungs-Cosmetics ----------

  /** Zuordnung Cosmetic → Partner (für Katalog und Team-Bereich, cosmetics.ts). */
  cosmeticPartners(): Map<string, { id: string; name: string }> {
    const out = new Map<string, { id: string; name: string }>();
    for (const row of this.sql.allCosmetics!.all() as Row[]) out.set(String(row.cosmetic), { id: String(row.partner), name: String(row.name) });
    return out;
  }

  /**
   * Cosmetic einem Partner zuordnen (`partner` = ID) bzw. die Zuordnung lösen (`null`). Nur Cosmetics, deren signiertes
   * Manifest `access: "unlock"` sagt (tragen nur mit Freischaltung); im Katalog stehen sie dann mit `access: "partner"`.
   */
  assignCosmetic(actor: Actor, cosmetic: string, partnerId: unknown): void {
    const info = COSMETIC_ID_RE.test(cosmetic) ? this.store.getCosmeticInfo(cosmetic) : undefined;
    if (!info) throw new HttpError(404, 'Dieses Cosmetic gibt es nicht.');
    if (partnerId === null) {
      if (Number(this.sql.unassign!.run(cosmetic).changes) > 0) writeAudit(this.store, actor, 'partner.cosmetic', cosmetic, 'keinem Partner mehr zugeordnet');
      return;
    }
    if (typeof partnerId !== 'string') throw new HttpError(400, '„partner“ muss die ID eines Partners sein oder null.');
    const partner = this.require(partnerId);
    if (info.access !== 'unlock') {
      throw new HttpError(409, 'Einem Partner lassen sich nur Belohnungen zuordnen (im signierten Manifest access: "unlock").', {}, 'NOT_UNLOCK');
    }
    this.sql.assign!.run(cosmetic, partner.id);
    writeAudit(this.store, actor, 'partner.cosmetic', cosmetic, `Belohnung von ${partner.name} (${partner.id})`);
  }

  // ---------- Partner-Schnittstelle (Server-Plugin) ----------

  /**
   * `Authorization: Partner <key>`: Partner zum Schlüssel. Kein bzw. ungültiger Schlüssel: 401; pausiert: 403. `failed`
   * wird bei einem ungültigen Schlüssel aufgerufen (Begrenzung je IP in app.ts).
   */
  authenticate(req: IncomingMessage, failed: () => void): PartnerRow {
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Partner\s+(\S+)$/.exec(header.trim()) : null;
    const key = match?.[1];
    const row = key !== undefined && PARTNER_KEY_RE.test(key) ? (this.sql.byKey!.get(hashPartnerKey(key)) as Row | undefined) : undefined;
    if (!row) {
      failed();
      throw new HttpError(401, PARTNER_KEY_INVALID, {}, 'PARTNER_KEY_INVALID');
    }
    const partner = toPartner(row);
    if (partner.status !== 'active') throw new HttpError(403, PARTNER_PAUSED, {}, 'PARTNER_PAUSED');
    return partner;
  }

  /** `GET /v1/partner/me`: zum Prüfen des Schlüssels im Plugin. */
  me(partner: PartnerRow) {
    const visible = new Set(this.store.cosmeticInfos().filter((info) => !info.hidden && info.access === 'unlock').map((info) => info.id));
    return { id: partner.id, name: partner.name, servers: partner.servers, cosmetics: this.cosmeticsOf(partner.id).filter((id) => visible.has(id)) };
  }

  /** Bereich für `PUT`/`DELETE /v1/partner/voice/groups`: `server` muss zu den Servern dieses Partners passen. */
  scopeOf(partner: PartnerRow, value: unknown): ServerGroupScope {
    const server = normalizeServer(value);
    if (server === null) throw new HttpError(400, `„server“: ${BAD_SERVER}`);
    const scope = this.scopeFor(server);
    if (scope === null || scope.partner !== partner.id) {
      throw new HttpError(403, `Die Adresse „${server}“ gehört nicht zu den Servern dieses Partners.`, {}, 'SERVER_NOT_PARTNER');
    }
    return scope;
  }

  /**
   * `POST /v1/partner/rewards { uuid, cosmetic }`: Freischaltung eines Belohnungs-Cosmetics dieses Partners (Herkunft
   * `partner:<id>`). Neu freigeschaltet: Echtzeit-Nachricht `unlock` mit `reason: "partner"` an den Spieler.
   */
  reward(partner: PartnerRow, input: Record<string, unknown>): { granted: true; already: boolean } {
    const { uuid, cosmetic } = input;
    if (!isUuid(uuid)) throw new HttpError(400, '„uuid“ muss eine UUID sein (32 kleine Hex-Zeichen ohne Bindestriche).');
    if (typeof cosmetic !== 'string' || !COSMETIC_ID_RE.test(cosmetic)) throw new HttpError(400, '„cosmetic“ muss die ID eines Cosmetics sein.');
    const info = this.store.getCosmeticInfo(cosmetic);
    if (!info || info.hidden) throw new HttpError(404, 'Dieses Cosmetic gibt es nicht.', {}, 'UNKNOWN_COSMETIC');
    const owner = this.sql.cosmeticPartner!.get(cosmetic) as Row | undefined;
    if (info.access !== 'unlock' || !owner || String(owner.partner) !== partner.id) {
      throw new HttpError(403, 'Dieses Cosmetic ist keine Belohnung dieses Partners.', {}, 'NOT_PARTNER_COSMETIC');
    }
    if (!this.store.getUser(uuid)) throw new HttpError(404, 'Diesen Spieler kennt der Heldix-Dienst nicht (noch nie mit HeldixClient angemeldet).', {}, 'UNKNOWN_PLAYER');
    const granted = this.store.addUnlock(uuid, cosmetic, `partner:${partner.id}`, Date.now());
    if (granted) this.realtime.send(uuid, { type: 'unlock', cosmetic, reason: 'partner', partner: partner.name });
    return { granted: true, already: !granted };
  }

  // ---------- Datenschutz ----------

  /** Datenauskunft: eigene Anträge. */
  exportFor(user: UserRow) {
    return this.mine(user).applications;
  }
}
