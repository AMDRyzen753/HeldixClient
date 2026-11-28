// Entdecken (ab 1.13.0): öffentliches Weltenverzeichnis. Besitzer listen ihre Welt freiwillig (nur mit Zugang „Jeder mit
// der Adresse“, Regeln bestätigt). Dauerhafte Welten stehen immer drin (auch schlafend), normal geteilte nur, solange sie
// geöffnet sind. Öffentlich sind nur, was der Besitzer listet, Name und Kopf des Gastgebers und die Zahl der „Gefällt
// mir“. Spieler melden Einträge; das Team blendet aus und sperrt Besitzer fürs Verzeichnis. Gesperrte Spieler und
// Welten gesperrter Besitzer erscheinen nie. Ein einfacher Wortfilter (wordfilter.ts) prüft Name und Beschreibung.
import type { StatementSync } from 'node:sqlite';
import type { Store, UserRow, WorldRow } from './db';
import type { Hosting } from './hosting/hosting';
import { HttpError } from './http';
import { playerLabel, writeAudit, type Actor } from './team';
import { checkText, isUuid } from './validate';
import { checkWords, WORD_PROBLEM_TEXT } from './wordfilter';
import { WORLD_CODE_RE, type Worlds } from './worlds';

export const DISCOVER_TAGS = ['survival', 'kreativ', 'minispiele', 'rollenspiel', 'bauen', 'parkour', 'technik', 'entspannt', 'hardcore'] as const;
export type DiscoverTag = (typeof DISCOVER_TAGS)[number];
export const DISCOVER_TAG_LABELS: Record<DiscoverTag, string> = {
  survival: 'Survival',
  kreativ: 'Kreativ',
  minispiele: 'Minispiele',
  rollenspiel: 'Rollenspiel',
  bauen: 'Bauen',
  parkour: 'Parkour',
  technik: 'Technik',
  entspannt: 'Entspannt',
  hardcore: 'Hardcore',
};
export const DISCOVER_LANGS = ['de', 'en'] as const;
export const DISCOVER_SORTS = ['popular', 'new', 'active'] as const;
export type DiscoverSort = (typeof DISCOVER_SORTS)[number];
export const DISCOVER_REPORT_REASONS = ['harassment', 'advertising', 'inappropriate', 'spam', 'other'] as const;
export const DISCOVER_RULES = [
  'Keine Beleidigungen oder Hetze.',
  'Keine Werbung für fremde Dienste.',
  'Nichts Jugendgefährdendes.',
];
export const DESCRIPTION_MAX = 160;
export const MAX_TAGS = 3;
export const PAGE_SIZE = 24;
const NOTE_MAX = 300;
/** „Beliebt“ zählt Gefällt-mir der letzten 30 Tage. */
const RECENT_LIKES_MS = 30 * 24 * 60 * 60_000;

export interface DiscoverOptions {
  /** Öffentliche Liste so lange zwischenspeichern (Standard 30 s; Tests 0) */
  cacheMs: number;
  /** Meldungen je Meldendem und Zeitraum */
  reportLimit: number;
  reportWindowMs: number;
  log: (line: string) => void;
}

export interface DiscoverEntry {
  code: string;
  name: string;
  description: string;
  tags: DiscoverTag[];
  lang: string;
  version: string | null;
  players: number;
  maxPlayers: number;
  /** online (geteilte Welt geöffnet) bzw. Zustand der dauerhaften Welt */
  state: 'online' | 'sleeping' | 'starting' | 'running' | 'stopping';
  persistent: boolean;
  host: { uuid: string; name: string; head: string };
  icon: string | null;
  likes: number;
  address: string;
  listedAt: number;
  lastActive: number | null;
}

type Row = Record<string, unknown>;

/** Eintrag mit den Gefällt-mir der letzten 30 Tage (nur zum Sortieren, nicht öffentlich). */
interface Candidate {
  entry: DiscoverEntry;
  recentLikes: number;
}

interface ListingRow {
  world: string;
  listed: boolean;
  description: string;
  tags: DiscoverTag[];
  lang: string;
  listedAt: number;
  updatedAt: number;
  rulesAcceptedAt: number;
  hidden: boolean;
  hiddenAt: number | null;
  hiddenBy: string | null;
  code: string;
  name: string;
  owner: string;
  ownerName: string;
  access: string;
  maxPlayers: number;
  version: string | null;
  lastOnline: number | null;
  likes: number;
  recentLikes: number;
}

function parseTags(value: unknown): DiscoverTag[] {
  try {
    const parsed: unknown = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter((t): t is DiscoverTag => (DISCOVER_TAGS as readonly unknown[]).includes(t)) : [];
  } catch {
    return [];
  }
}

const nullableNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));

function toListing(row: Row): ListingRow {
  return {
    world: String(row.world),
    listed: Number(row.listed) === 1,
    description: String(row.description),
    tags: parseTags(row.tags),
    lang: String(row.lang),
    listedAt: Number(row.listed_at),
    updatedAt: Number(row.updated_at),
    rulesAcceptedAt: Number(row.rules_accepted_at),
    hidden: Number(row.hidden) === 1,
    hiddenAt: nullableNumber(row.hidden_at),
    hiddenBy: row.hidden_by === null || row.hidden_by === undefined ? null : String(row.hidden_by),
    code: String(row.code),
    name: String(row.name),
    owner: String(row.owner),
    ownerName: String(row.owner_name),
    access: String(row.access),
    maxPlayers: Number(row.max_players),
    version: row.version === null || row.version === undefined ? null : String(row.version),
    lastOnline: nullableNumber(row.last_online),
    likes: Number(row.likes ?? 0),
    recentLikes: Number(row.recent_likes ?? 0),
  };
}

const LISTING_SELECT = `
  SELECT l.world, l.listed, l.description, l.tags, l.lang, l.listed_at, l.updated_at, l.rules_accepted_at, l.hidden, l.hidden_at,
    l.hidden_by, w.code, w.name, w.owner, u.name AS owner_name, w.access, w.max_players, w.version, w.last_online,
    (SELECT count(*) FROM discover_likes k WHERE k.world = l.world) AS likes,
    (SELECT count(*) FROM discover_likes k WHERE k.world = l.world AND k.at >= ?) AS recent_likes
  FROM discover_listings l JOIN worlds w ON w.id = l.world JOIN users u ON u.uuid = w.owner`;

const REPORT_COLUMNS = 'id, world, code, world_name, owner, owner_name, description, reporter, reporter_name, reason, note, at, status, done_at, done_by';

function toReport(row: Row) {
  return {
    id: Number(row.id),
    world: String(row.world),
    code: String(row.code),
    worldName: String(row.world_name),
    owner: { uuid: String(row.owner), name: String(row.owner_name) },
    description: String(row.description),
    reporter: { uuid: String(row.reporter), name: String(row.reporter_name) },
    reason: String(row.reason),
    note: String(row.note),
    at: Number(row.at),
    status: row.status === 'done' ? 'done' : 'open',
    doneAt: nullableNumber(row.done_at),
    doneBy: row.done_by === null || row.done_by === undefined ? null : String(row.done_by),
  };
}

export class Discover {
  private readonly sql: Record<string, StatementSync>;
  private readonly cache = new Map<string, { value: unknown; until: number }>();

  constructor(
    private readonly store: Store,
    private readonly worlds: Worlds | null,
    private readonly hosting: () => Hosting | null,
    private readonly options: DiscoverOptions,
  ) {
    const p = (sql: string) => store.prepare(sql);
    this.sql = {
      visible: p(`${LISTING_SELECT}
        WHERE l.listed = 1 AND l.hidden = 0 AND w.access = 'open'
          AND NOT EXISTS (SELECT 1 FROM discover_bans b WHERE b.uuid = w.owner)
          AND NOT EXISTS (SELECT 1 FROM bans x WHERE x.uuid = w.owner)`),
      all: p(`${LISTING_SELECT} ORDER BY l.listed_at DESC`),
      byWorld: p(`${LISTING_SELECT} WHERE l.world = ?`),
      upsert: p(`
        INSERT INTO discover_listings (world, listed, description, tags, lang, listed_at, updated_at, rules_accepted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (world) DO UPDATE SET listed = excluded.listed, description = excluded.description, tags = excluded.tags,
          lang = excluded.lang, updated_at = excluded.updated_at, rules_accepted_at = excluded.rules_accepted_at,
          listed_at = CASE WHEN discover_listings.listed = 0 AND excluded.listed = 1 THEN excluded.listed_at ELSE discover_listings.listed_at END`),
      delete: p('DELETE FROM discover_listings WHERE world = ?'),
      deleteLikes: p('DELETE FROM discover_likes WHERE world = ?'),
      setHidden: p('UPDATE discover_listings SET hidden = ?, hidden_at = ?, hidden_by = ? WHERE world = ?'),
      like: p('INSERT OR IGNORE INTO discover_likes (world, uuid, at) VALUES (?, ?, ?)'),
      unlike: p('DELETE FROM discover_likes WHERE world = ? AND uuid = ?'),
      liked: p('SELECT 1 AS x FROM discover_likes WHERE world = ? AND uuid = ?'),
      likeCount: p('SELECT count(*) AS n FROM discover_likes WHERE world = ?'),
      likesBy: p(`SELECT k.world, w.code, w.name, k.at FROM discover_likes k JOIN worlds w ON w.id = k.world WHERE k.uuid = ? ORDER BY k.at`),
      insertReport: p(`
        INSERT INTO discover_reports (world, code, world_name, owner, owner_name, description, reporter, reporter_name, reason, note, at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      openReportPair: p("SELECT 1 AS x FROM discover_reports WHERE reporter = ? AND world = ? AND status = 'open' LIMIT 1"),
      reportsSince: p('SELECT count(*) AS n, min(at) AS oldest FROM discover_reports WHERE reporter = ? AND at >= ?'),
      reports: p(`SELECT ${REPORT_COLUMNS} FROM discover_reports ORDER BY id DESC LIMIT 500`),
      reportsByStatus: p(`SELECT ${REPORT_COLUMNS} FROM discover_reports WHERE status = ? ORDER BY id DESC LIMIT 500`),
      reportsBy: p(`SELECT ${REPORT_COLUMNS} FROM discover_reports WHERE reporter = ? ORDER BY id`),
      markDone: p("UPDATE discover_reports SET status = 'done', done_at = ?, done_by = ? WHERE id = ? AND status = 'open'"),
      openReportsFor: p("SELECT world, count(*) AS n FROM discover_reports WHERE status = 'open' GROUP BY world"),
      deleteOldReports: p('DELETE FROM discover_reports WHERE at < ?'),
      getBan: p('SELECT uuid, name, reason, at, by_name FROM discover_bans WHERE uuid = ?'),
      bans: p('SELECT uuid, name, reason, at, by_name FROM discover_bans ORDER BY at DESC'),
      putBan: p('INSERT INTO discover_bans (uuid, name, reason, at, by_name) VALUES (?, ?, ?, ?, ?) ON CONFLICT (uuid) DO UPDATE SET reason = excluded.reason, at = excluded.at, by_name = excluded.by_name'),
      deleteBan: p('DELETE FROM discover_bans WHERE uuid = ?'),
    };
  }

  private requireWorlds(): Worlds {
    if (this.worlds === null || !this.worlds.available) throw new HttpError(503, 'Welt teilen ist auf diesem Heldix-Dienst nicht eingerichtet.');
    return this.worlds;
  }

  private changed(): void {
    this.cache.clear();
  }

  private listingOf(world: string): ListingRow | undefined {
    const row = this.sql.byWorld!.get(Date.now() - RECENT_LIKES_MS, world) as Row | undefined;
    return row ? toListing(row) : undefined;
  }

  private isBanned(uuid: string): boolean {
    return this.sql.getBan!.get(uuid) !== undefined;
  }

  // ---------- Besitzer ----------

  private ownView(listing: ListingRow | undefined, world: WorldRow) {
    const words = checkWords(world.name);
    return {
      listed: listing?.listed ?? false,
      description: listing?.description ?? '',
      tags: listing?.tags ?? [],
      lang: listing?.lang ?? 'de',
      listedAt: listing?.listed ? listing.listedAt : null,
      hidden: listing?.hidden ?? false,
      likes: listing?.likes ?? 0,
      access: world.access,
      // Warum die Welt gerade nicht im Verzeichnis steht (null: steht drin bzw. würde drinstehen)
      problem:
        world.access !== 'open'
          ? 'access'
          : this.isBanned(world.owner)
            ? 'banned'
            : listing?.hidden
              ? 'hidden'
              : words !== null
                ? 'words'
                : null,
      rules: DISCOVER_RULES,
    };
  }

  /** `GET /v1/worlds/<id>/listing` */
  getListing(user: UserRow, id: string | undefined) {
    const world = this.requireWorlds().ownWorld(user, id);
    return this.ownView(this.listingOf(world.id), world);
  }

  /** `PUT /v1/worlds/<id>/listing { listed, description, tags, lang, rulesAccepted }` */
  putListing(user: UserRow, id: string | undefined, input: Record<string, unknown>) {
    const world = this.requireWorlds().ownWorld(user, id);
    const listed = input.listed === undefined ? true : input.listed;
    if (typeof listed !== 'boolean') throw new HttpError(400, '„listed“ muss true oder false sein.');
    if (input.rulesAccepted !== true) throw new HttpError(400, `Bitte die Regeln bestätigen: ${DISCOVER_RULES.join(' ')}`, {}, 'rules');
    if (listed && world.access !== 'open') {
      throw new HttpError(409, 'Ins Verzeichnis kommen nur Welten mit Zugang „Jeder mit der Adresse“.', {}, 'access');
    }
    if (this.isBanned(user.uuid)) throw new HttpError(403, 'Du bist für das Weltenverzeichnis gesperrt.', {}, 'banned');
    const description = checkText(input.description ?? '', DESCRIPTION_MAX, true);
    if ('problem' in description) throw new HttpError(400, `Die Beschreibung darf höchstens ${DESCRIPTION_MAX} Zeichen lang sein (eine Zeile).`);
    const rawTags = input.tags ?? [];
    if (!Array.isArray(rawTags) || rawTags.length > MAX_TAGS || !rawTags.every((t) => (DISCOVER_TAGS as readonly unknown[]).includes(t))) {
      throw new HttpError(400, `„tags“: höchstens ${MAX_TAGS} aus ${DISCOVER_TAGS.join(', ')}.`);
    }
    const tags = [...new Set(rawTags as DiscoverTag[])];
    const lang = input.lang ?? 'de';
    if (!(DISCOVER_LANGS as readonly unknown[]).includes(lang)) throw new HttpError(400, '„lang“ muss "de" oder "en" sein.');
    for (const text of [world.name, description.text]) {
      const problem = checkWords(text);
      if (problem !== null) throw new HttpError(400, WORD_PROBLEM_TEXT[problem], {}, `words-${problem}`);
    }
    const now = Date.now();
    this.sql.upsert!.run(world.id, listed ? 1 : 0, description.text, JSON.stringify(tags), lang as string, now, now, now);
    this.changed();
    return this.ownView(this.listingOf(world.id), world);
  }

  /** `DELETE /v1/worlds/<id>/listing` (mit den Gefällt-mir) */
  deleteListing(user: UserRow, id: string | undefined) {
    const world = this.requireWorlds().ownWorld(user, id);
    this.store.transaction(() => {
      this.sql.delete!.run(world.id);
      this.sql.deleteLikes!.run(world.id);
    });
    this.changed();
    return { ok: true };
  }

  // ---------- Öffentlich ----------

  /** Sichtbare Einträge (nur offene Welten, die gerade online sind bzw. dauerhaft, ohne gesperrte, durch den Wortfilter). */
  private entries(): Candidate[] {
    const worlds = this.worlds;
    if (worlds === null || !worlds.available) return [];
    const hosting = this.hosting();
    const out: Candidate[] = [];
    const now = Date.now();
    for (const raw of this.sql.visible!.all(now - RECENT_LIKES_MS) as Row[]) {
      const listing = toListing(raw);
      if (checkWords(listing.name) !== null || checkWords(listing.description) !== null) continue;
      const hosted = hosting?.relayInfo(listing.world) ?? null;
      let state: DiscoverEntry['state'];
      let players = 0;
      let version = listing.version;
      let lastActive = listing.lastOnline;
      if (hosted) {
        if (hosted.state === 'creating' || hosted.state === 'error') continue;
        state = hosted.state;
        players = hosted.players;
        version = hosted.version;
        const row = hosting?.hs.get(listing.world);
        lastActive = players > 0 ? now : (row?.lastActiveAt ?? row?.lastStartedAt ?? null);
      } else {
        const tunnel = worlds.tunnelInfo(listing.world);
        if (!tunnel) continue;
        state = 'online';
        players = tunnel.players;
        version = tunnel.version;
        lastActive = now;
      }
      const icon = hosted && hosting?.hs.get(listing.world)?.icon ? `/v1/public/discover/${listing.code}/icon.png` : null;
      const entry: DiscoverEntry = {
        code: listing.code,
        name: listing.name,
        description: listing.description,
        tags: listing.tags,
        lang: listing.lang,
        version,
        players,
        maxPlayers: listing.maxPlayers,
        state,
        persistent: hosted !== null,
        host: { uuid: listing.owner, name: listing.ownerName, head: `/v1/public/heads/${listing.owner}.png` },
        icon,
        likes: listing.likes,
        address: worlds.address(listing.code),
        listedAt: listing.listedAt,
        lastActive,
      };
      out.push({ entry, recentLikes: listing.recentLikes });
    }
    return out;
  }

  /** `GET /v1/public/discover?sort=&tag=&lang=&version=&q=&page=` (30 s im Speicher) */
  list(query: URLSearchParams) {
    const sortRaw = query.get('sort') ?? 'popular';
    if (!(DISCOVER_SORTS as readonly string[]).includes(sortRaw)) throw new HttpError(400, '„sort“ muss "popular", "new" oder "active" sein.');
    const sort = sortRaw as DiscoverSort;
    const tag = query.get('tag');
    if (tag !== null && tag !== '' && !(DISCOVER_TAGS as readonly string[]).includes(tag)) throw new HttpError(400, `„tag“ muss einer von ${DISCOVER_TAGS.join(', ')} sein.`);
    const lang = query.get('lang');
    if (lang !== null && lang !== '' && !(DISCOVER_LANGS as readonly string[]).includes(lang)) throw new HttpError(400, '„lang“ muss "de" oder "en" sein.');
    const version = query.get('version');
    if (version !== null && version !== '' && !/^[A-Za-z0-9._-]{1,32}$/.test(version)) throw new HttpError(400, 'Ungültige Minecraft-Version.');
    const q = (query.get('q') ?? '').trim().toLowerCase();
    if (q.length > 64) throw new HttpError(400, 'Die Suche darf höchstens 64 Zeichen lang sein.');
    const pageRaw = query.get('page') ?? '1';
    const page = /^\d{1,3}$/.test(pageRaw) ? Number(pageRaw) : NaN;
    if (!(page >= 1 && page <= 500)) throw new HttpError(400, '„page“ muss eine Zahl ab 1 sein.');
    const key = JSON.stringify([sort, tag, lang, version, q, page]);
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.until > now) return hit.value;
    let candidates = this.entries();
    if (tag) candidates = candidates.filter(({ entry }) => entry.tags.includes(tag as DiscoverTag));
    if (lang) candidates = candidates.filter(({ entry }) => entry.lang === lang);
    if (version) candidates = candidates.filter(({ entry }) => entry.version === version);
    if (q !== '') candidates = candidates.filter(({ entry }) => entry.name.toLowerCase().includes(q) || entry.description.toLowerCase().includes(q));
    candidates.sort((x, y) => {
      const a = x.entry;
      const b = y.entry;
      if (sort === 'new') return b.listedAt - a.listedAt;
      if (sort === 'active') return b.players - a.players || (b.lastActive ?? 0) - (a.lastActive ?? 0) || b.listedAt - a.listedAt;
      return b.players - a.players || y.recentLikes - x.recentLikes || b.likes - a.likes || b.listedAt - a.listedAt;
    });
    const total = candidates.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const value = {
      sort,
      page,
      pages,
      total,
      entries: candidates.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(({ entry }) => entry),
    };
    if (this.options.cacheMs > 0) {
      if (this.cache.size > 500) this.cache.clear();
      this.cache.set(key, { value, until: now + this.options.cacheMs });
    }
    return value;
  }

  /** `GET /v1/public/discover/meta`: Tags, Sprachen, Sortierungen und Regeln für die Oberflächen. */
  meta() {
    return {
      tags: DISCOVER_TAGS.map((id) => ({ id, label: DISCOVER_TAG_LABELS[id] })),
      langs: [...DISCOVER_LANGS],
      sorts: [...DISCOVER_SORTS],
      rules: DISCOVER_RULES,
      reportReasons: [...DISCOVER_REPORT_REASONS],
      descriptionMax: DESCRIPTION_MAX,
      maxTags: MAX_TAGS,
      pageSize: PAGE_SIZE,
    };
  }

  private visibleEntry(code: string | undefined): DiscoverEntry {
    if (code === undefined || !WORLD_CODE_RE.test(code)) throw new HttpError(404, 'Diesen Eintrag gibt es nicht.');
    const found = this.entries().find(({ entry }) => entry.code === code);
    if (!found) throw new HttpError(404, 'Diesen Eintrag gibt es nicht.');
    return found.entry;
  }

  /** `GET /v1/public/discover/<code>` */
  entry(code: string | undefined): DiscoverEntry {
    return this.visibleEntry(code);
  }

  /** `GET /v1/public/discover/<code>/icon.png`: Symbol einer dauerhaften Welt (mit Heldix-Plakette). */
  icon(code: string | undefined): Buffer {
    const entry = this.visibleEntry(code);
    const world = this.store.getWorldByCode(entry.code);
    const icon = world ? this.hosting()?.hs.get(world.id)?.icon : null;
    if (!icon) throw new HttpError(404, 'Für diese Welt gibt es kein Symbol.');
    return icon;
  }

  // ---------- Gefällt mir, Melden ----------

  private worldOfEntry(code: string | undefined): { entry: DiscoverEntry; world: WorldRow } {
    const entry = this.visibleEntry(code);
    const world = this.store.getWorldByCode(entry.code);
    if (!world) throw new HttpError(404, 'Diesen Eintrag gibt es nicht.');
    return { entry, world };
  }

  private likeState(world: string, uuid: string) {
    return { liked: this.sql.liked!.get(world, uuid) !== undefined, likes: Number((this.sql.likeCount!.get(world) as Row).n) };
  }

  /** `GET /v1/discover/<code>/like` */
  getLike(user: UserRow, code: string | undefined) {
    const { world } = this.worldOfEntry(code);
    return this.likeState(world.id, user.uuid);
  }

  /** `PUT /v1/discover/<code>/like` (eins je Spieler; nicht die eigene Welt) */
  like(user: UserRow, code: string | undefined) {
    const { world } = this.worldOfEntry(code);
    if (world.owner === user.uuid) throw new HttpError(409, 'Die eigene Welt kannst du nicht mit „Gefällt mir“ markieren.');
    this.sql.like!.run(world.id, user.uuid, Date.now());
    this.changed();
    return this.likeState(world.id, user.uuid);
  }

  /** `DELETE /v1/discover/<code>/like` (auch, wenn der Eintrag gerade nicht sichtbar ist) */
  unlike(user: UserRow, code: string | undefined) {
    const world = code !== undefined && WORLD_CODE_RE.test(code) ? this.store.getWorldByCode(code) : undefined;
    if (!world) throw new HttpError(404, 'Diesen Eintrag gibt es nicht.');
    this.sql.unlike!.run(world.id, user.uuid);
    this.changed();
    return this.likeState(world.id, user.uuid);
  }

  /** `POST /v1/discover/<code>/report { reason, note? }` */
  report(user: UserRow, code: string | undefined, input: Record<string, unknown>) {
    const { entry, world } = this.worldOfEntry(code);
    const { reason } = input;
    if (!(DISCOVER_REPORT_REASONS as readonly unknown[]).includes(reason)) throw new HttpError(400, `Ungültiger Grund (erlaubt: ${DISCOVER_REPORT_REASONS.join(', ')}).`);
    let note = '';
    if (input.note !== undefined && input.note !== null) {
      const checked = checkText(input.note, NOTE_MAX, true);
      if ('problem' in checked) throw new HttpError(400, `Die Notiz darf höchstens ${NOTE_MAX} Zeichen lang sein (eine Zeile).`);
      note = checked.text;
    }
    if (world.owner === user.uuid) throw new HttpError(400, 'Die eigene Welt kannst du nicht melden.');
    if (this.sql.openReportPair!.get(user.uuid, world.id) !== undefined) throw new HttpError(429, 'Du hast diesen Eintrag schon gemeldet. Das Team schaut ihn sich an.');
    const now = Date.now();
    const recent = this.sql.reportsSince!.get(user.uuid, now - this.options.reportWindowMs) as Row;
    if (Number(recent.n) >= this.options.reportLimit) {
      const retry = Math.max(1, Math.ceil((Number(recent.oldest ?? now) + this.options.reportWindowMs - now) / 1000));
      throw new HttpError(429, `Du hast in den letzten 24 Stunden schon ${this.options.reportLimit} Einträge gemeldet.`, { 'Retry-After': String(retry) });
    }
    const result = this.sql.insertReport!.run(world.id, entry.code, entry.name, entry.host.uuid, entry.host.name, entry.description, user.uuid, user.name, reason as string, note, now);
    this.options.log(`Neue Meldung zu einem Eintrag in Entdecken (#${Number(result.lastInsertRowid)}, Grund: ${String(reason)}).`);
    return { reported: true };
  }

  // ---------- Team ----------

  /** `GET /v1/team/discover?status=open|done|all` */
  teamOverview(status: string | null) {
    const filter = status ?? 'open';
    if (!['open', 'done', 'all'].includes(filter)) throw new HttpError(400, '„status“ muss "open", "done" oder "all" sein.');
    const open = new Map<string, number>();
    for (const row of this.sql.openReportsFor!.all() as Row[]) open.set(String(row.world), Number(row.n));
    const bans = new Set((this.sql.bans!.all() as Row[]).map((row) => String(row.uuid)));
    const listings = (this.sql.all!.all(Date.now() - RECENT_LIKES_MS) as Row[]).map(toListing).map((l) => ({
      code: l.code,
      world: l.world,
      name: l.name,
      description: l.description,
      tags: l.tags,
      lang: l.lang,
      listed: l.listed,
      access: l.access,
      hidden: l.hidden,
      hiddenAt: l.hiddenAt,
      hiddenBy: l.hiddenBy,
      owner: { uuid: l.owner, name: l.ownerName },
      ownerBanned: bans.has(l.owner),
      likes: l.likes,
      openReports: open.get(l.world) ?? 0,
      listedAt: l.listedAt,
      updatedAt: l.updatedAt,
      wordFilter: checkWords(l.name) ?? checkWords(l.description),
    }));
    const reports = ((filter === 'all' ? this.sql.reports!.all() : this.sql.reportsByStatus!.all(filter)) as Row[]).map(toReport);
    return { listings, reports, bans: this.bans() };
  }

  private bans() {
    return (this.sql.bans!.all() as Row[]).map((row) => ({
      uuid: String(row.uuid),
      name: String(row.name),
      reason: String(row.reason),
      at: Number(row.at),
      by: row.by_name === null || row.by_name === undefined ? null : String(row.by_name),
    }));
  }

  /** `PATCH /v1/team/discover/<code> { hidden }` */
  teamSetHidden(actor: Actor, code: string | undefined, input: Record<string, unknown>) {
    if (typeof input.hidden !== 'boolean') throw new HttpError(400, '„hidden“ muss true oder false sein.');
    const world = code !== undefined && WORLD_CODE_RE.test(code) ? this.store.getWorldByCode(code) : undefined;
    const listing = world ? this.listingOf(world.id) : undefined;
    if (!world || !listing) throw new HttpError(404, 'Diesen Eintrag gibt es nicht.');
    this.sql.setHidden!.run(input.hidden ? 1 : 0, input.hidden ? Date.now() : null, input.hidden ? actor.name : null, world.id);
    writeAudit(this.store, actor, input.hidden ? 'discover.hide' : 'discover.show', `${world.name} (${world.code})`);
    this.changed();
    return { ok: true, hidden: input.hidden };
  }

  /** `POST /v1/team/discover/reports/<id>/done` */
  teamReportDone(actor: Actor, id: number) {
    if (Number(this.sql.markDone!.run(Date.now(), actor.name, id).changes) === 0) throw new HttpError(404, 'Diese Meldung gibt es nicht (oder sie ist schon erledigt).');
    writeAudit(this.store, actor, 'discover.report-done', `#${id}`);
    return { ok: true };
  }

  /** `PUT /v1/team/discover/bans/<uuid> { reason }`: Besitzer fürs Verzeichnis sperren (seine Einträge verschwinden). */
  teamBan(actor: Actor, uuid: string, input: Record<string, unknown>) {
    if (!isUuid(uuid)) throw new HttpError(400, 'Ungültige UUID.');
    const reason = checkText(input.reason ?? '', 200, true);
    if ('problem' in reason) throw new HttpError(400, 'Der Grund darf höchstens 200 Zeichen lang sein.');
    const user = this.store.getUser(uuid);
    if (!user) throw new HttpError(404, 'Diesen Spieler kennt der Heldix-Dienst nicht.');
    this.sql.putBan!.run(uuid, user.name, reason.text, Date.now(), actor.name);
    writeAudit(this.store, actor, 'discover.ban', playerLabel(user.name, uuid), reason.text || null);
    this.changed();
    return { bans: this.bans() };
  }

  /** `DELETE /v1/team/discover/bans/<uuid>` */
  teamUnban(actor: Actor, uuid: string) {
    if (Number(this.sql.deleteBan!.run(uuid).changes) === 0) throw new HttpError(404, 'Dieser Spieler ist nicht fürs Verzeichnis gesperrt.');
    writeAudit(this.store, actor, 'discover.unban', uuid);
    this.changed();
    return { bans: this.bans() };
  }

  // ---------- Datenschutz, Aufräumen ----------

  /** Datenauskunft: eigene Einträge, Gefällt-mir und Meldungen. */
  exportFor(user: UserRow) {
    const listings = this.store.worldsOf(user.uuid).flatMap((world) => {
      const listing = this.listingOf(world.id);
      return listing
        ? [{ world: world.id, code: world.code, listed: listing.listed, description: listing.description, tags: listing.tags, lang: listing.lang, listedAt: listing.listedAt, hidden: listing.hidden, likes: listing.likes }]
        : [];
    });
    const likes = (this.sql.likesBy!.all(user.uuid) as Row[]).map((row) => ({ world: String(row.world), code: String(row.code), name: String(row.name), at: Number(row.at) }));
    const reports = (this.sql.reportsBy!.all(user.uuid) as Row[]).map(toReport).map((r) => ({ code: r.code, worldName: r.worldName, reason: r.reason, note: r.note, at: r.at, status: r.status }));
    const ban = this.sql.getBan!.get(user.uuid) as Row | undefined;
    return { listings, likes, reports, bannedFromDirectory: ban ? { reason: String(ban.reason), at: Number(ban.at) } : null };
  }

  /** Alte Meldungen löschen (wie Spielermeldungen nach 90 Tagen). */
  sweep(cutoff: number): void {
    this.sql.deleteOldReports!.run(cutoff);
  }
}
