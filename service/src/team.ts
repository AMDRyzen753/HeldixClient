// Team-Bereich der Webseite: Meldungen, Sperren, Spieler, Neuigkeiten, Updates, Addons, Mitglieder und Protokoll.
// Zugang (Rolle, 2FA) prüft app.ts mit Web.teamGate; hier stehen nur noch die Aktionen.
import type { KeyObject } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Addons } from './addons';
import type { AuditRow, BanRow, NewsRow, ReportRow, ReportStatus, Store, TeamMemberRow, TeamProfilePatch, TeamRole, UserRow } from './db';
import { UNKNOWN_PLAYER } from './friends';
import { HttpError } from './http';
import type { Realtime } from './realtime';
import type { SnapshotMessage } from './reports';
import type { Updates } from './updates';
import { checkMultilineText, checkText, isName, isUuid, normalizeUuid, type TextProblem } from './validate';

/** Wer etwas tut: Team-Mitglied oder die Server-Konsole (uuid null, Name „CLI“). */
export interface Actor {
  uuid: string | null;
  name: string;
}

export const CLI_ACTOR: Actor = Object.freeze({ uuid: null, name: 'CLI' });

export const TEAM_ROLES: readonly TeamRole[] = ['moderator', 'admin'];
export const LAST_ADMIN = 'Es muss mindestens ein Admin bleiben.';
const NOT_IN_TEAM = 'Dieser Spieler ist nicht im Team.';
const NO_SUCH_PLAYER = 'Diesen Spieler gibt es beim Heldix-Dienst nicht.';
/** Einträge in Listen des Team-Bereichs */
const MAX_PLAYERS = 50;
export const MAX_NEWS_TITLE = 120;
export const MAX_NEWS_TEXT = 5000;
export const MAX_BAN_REASON = 300;
/** Teamprofil: Aufgabe und kurzer Text, jeweils eine Zeile */
export const MAX_PROFILE_TITLE = 40;
export const MAX_PROFILE_ABOUT = 200;

export function isTeamRole(value: unknown): value is TeamRole {
  return value === 'moderator' || value === 'admin';
}

/** Schreibt einen Eintrag ins Protokoll (verfällt nach 365 Tagen). */
export function writeAudit(store: Store, actor: Actor, action: string, target: string | null, detail: string | null = null): void {
  store.insertAudit({ at: Date.now(), actorUuid: actor.uuid, actorName: actor.name, action, target, detail });
}

/** „Name (uuid)“ für Protokoll und Ausgaben. */
export function playerLabel(name: string, uuid: string): string {
  return name === '' ? uuid : `${name} (${uuid})`;
}

export interface TeamOptions {
  /** Öffentlicher Update-Schlüssel (Ed25519); ohne: Veröffentlichen im Browser geht nicht (503). */
  updateKey: KeyObject | null;
  maxUploadBytes: number;
  /** Größter Upload einer Addon-Datei (JAR). */
  maxAddonUploadBytes: number;
  uploadIdleTimeoutMs: number;
}

function textError(field: string, max: number, problem: TextProblem): string {
  switch (problem) {
    case 'type':
      return `„${field}“ muss ein Text sein.`;
    case 'empty':
      return `„${field}“ darf nicht leer sein.`;
    case 'long':
      return `„${field}“ ist zu lang (höchstens ${max} Zeichen).`;
    case 'chars':
      return `„${field}“ enthält Zeichen, die nicht erlaubt sind.`;
  }
}

export class Team {
  constructor(
    private readonly store: Store,
    private readonly realtime: Realtime,
    private readonly updates: Updates,
    private readonly addons: Addons,
    private readonly options: TeamOptions,
  ) {}

  private audit(actor: Actor, action: string, target: string | null, detail: string | null = null): void {
    writeAudit(this.store, actor, action, target, detail);
  }

  /** Spieler zu `{ uuid }` oder `{ name }`; nur wer sich schon einmal angemeldet hat. */
  private targetUser(input: Record<string, unknown>): UserRow {
    let user: UserRow | undefined;
    if (Object.hasOwn(input, 'uuid')) {
      if (!isUuid(input.uuid)) throw new HttpError(400, 'Ungültige UUID (erwartet: 32 kleine Hex-Zeichen ohne Bindestriche).');
      user = this.store.getUser(input.uuid);
    } else if (Object.hasOwn(input, 'name')) {
      if (!isName(input.name)) throw new HttpError(400, 'Ungültiger Spielername.');
      user = this.store.findUserByName(input.name);
    } else {
      throw new HttpError(400, 'Bitte „uuid“ oder „name“ angeben.');
    }
    if (!user) throw new HttpError(404, UNKNOWN_PLAYER);
    return user;
  }

  // ---------- Meldungen ----------

  reportView(report: ReportRow) {
    let snapshot: SnapshotMessage[] = [];
    try {
      const parsed: unknown = JSON.parse(report.messages);
      if (Array.isArray(parsed)) snapshot = parsed as SnapshotMessage[];
    } catch {
      snapshot = [];
    }
    const names: Record<string, string> = { [report.reporter]: report.reporterName, [report.reported]: report.reportedName };
    return {
      id: report.id,
      at: report.at,
      status: report.status,
      reason: report.reason,
      note: report.note,
      reporter: { uuid: report.reporter, name: report.reporterName },
      reported: { uuid: report.reported, name: report.reportedName, banned: this.store.getBan(report.reported) !== undefined },
      messages: snapshot.map((m) => ({ from: String(m.from), fromName: names[String(m.from)] ?? '', text: String(m.text), at: Number(m.at) })),
      doneAt: report.doneAt,
      doneBy: report.doneBy,
    };
  }

  /** `GET /v1/team/reports?status=…`, neueste zuerst. */
  reports(status: string | null) {
    const filter = status ?? 'open';
    if (filter !== 'open' && filter !== 'done' && filter !== 'all') {
      throw new HttpError(400, '„status“ muss open, done oder all sein.');
    }
    return { reports: this.store.listReports(filter as ReportStatus | 'all').reverse().map((r) => this.reportView(r)) };
  }

  /** `POST /v1/team/reports/<id>/done` */
  markDone(actor: Actor, id: number) {
    if (!this.store.getReport(id)) throw new HttpError(404, 'Diese Meldung gibt es nicht (mehr).');
    if (this.store.markReportDone(id, Date.now(), actor.name)) this.audit(actor, 'report.done', `Meldung ${id}`);
    return { report: this.reportView(this.store.getReport(id)!) };
  }

  // ---------- Sperren ----------

  private banView(ban: BanRow) {
    return { uuid: ban.uuid, name: ban.name, reason: ban.reason, at: ban.at, by: ban.by };
  }

  bans() {
    return { bans: this.store.listBans().map((b) => this.banView(b)) };
  }

  /** `POST /v1/team/bans`: wie `heldix-dienst-admin sperren`, dazu werden offene Verbindungen sofort getrennt (4003). */
  ban(actor: Actor, input: Record<string, unknown>) {
    let uuid: string;
    let name: string;
    if (Object.hasOwn(input, 'uuid') && isUuid(input.uuid) && !this.store.getUser(input.uuid)) {
      // Spieler, die nie online waren (oder schon gesperrt sind), lassen sich per UUID sperren.
      uuid = input.uuid;
      name = this.store.getBan(uuid)?.name ?? '';
    } else {
      const user = this.targetUser(input);
      uuid = user.uuid;
      name = user.name;
    }
    const reason = checkText(input.reason, MAX_BAN_REASON, false);
    if ('problem' in reason) throw new HttpError(400, textError('reason', MAX_BAN_REASON, reason.problem));
    if (uuid === actor.uuid) throw new HttpError(400, 'Du kannst dich nicht selbst sperren.');
    if (this.store.getTeamMember(uuid)) {
      throw new HttpError(409, 'Team-Mitglieder lassen sich nicht sperren. Zuerst aus dem Team entfernen.');
    }
    const related = this.store.ban(uuid, name, reason.text, Date.now(), actor.name);
    this.realtime.disconnectUser(uuid, 4003, 'Gesperrt');
    for (const other of related) this.realtime.pushFriends(other);
    this.audit(actor, 'ban', playerLabel(name, uuid), reason.text);
    return this.bans();
  }

  unban(actor: Actor, uuid: string) {
    const ban = this.store.getBan(uuid);
    if (ban && this.store.unban(uuid)) this.audit(actor, 'unban', playerLabel(ban.name, uuid));
    return this.bans();
  }

  // ---------- Spieler ----------

  private role(uuid: string): TeamRole | null {
    return this.store.getTeamMember(uuid)?.role ?? null;
  }

  /** `GET /v1/team/players?q=`: Namensanfang oder UUID; ohne q die zuletzt gesehenen. Gesperrte stehen mit drin. */
  players(q: string | null) {
    const query = (q ?? '').trim();
    let users: UserRow[] = [];
    let bans: BanRow[] = [];
    if (query === '') {
      users = this.store.recentUsers(MAX_PLAYERS);
    } else {
      const uuid = normalizeUuid(query);
      if (uuid !== null) {
        const user = this.store.getUser(uuid);
        const ban = this.store.getBan(uuid);
        users = user ? [user] : [];
        bans = ban ? [ban] : [];
      } else if (/^[A-Za-z0-9_]{1,16}$/.test(query)) {
        users = this.store.searchUsers(query, MAX_PLAYERS);
        bans = this.store.searchBans(query, MAX_PLAYERS);
      } else {
        throw new HttpError(400, 'Bitte einen Namensanfang oder eine UUID eingeben.');
      }
    }
    const known = new Set(users.map((u) => u.uuid));
    const players = [
      ...users.map((u) => ({
        uuid: u.uuid,
        name: u.name,
        lastSeen: u.lastSeen as number | null,
        online: this.realtime.isConnected(u.uuid),
        banned: this.store.getBan(u.uuid) !== undefined,
        role: this.role(u.uuid),
      })),
      // Gesperrte haben beim Dienst kein Konto mehr, nur den Eintrag der Sperre.
      ...bans
        .filter((b) => !known.has(b.uuid))
        .map((b) => ({ uuid: b.uuid, name: b.name, lastSeen: null, online: false, banned: true, role: null })),
    ];
    return { players: players.slice(0, MAX_PLAYERS) };
  }

  /** `GET /v1/team/players/<uuid>` – ohne Nachrichteninhalte. */
  player(uuid: string) {
    const user = this.store.getUser(uuid);
    const ban = this.store.getBan(uuid);
    if (!user && !ban) throw new HttpError(404, NO_SUCH_PLAYER);
    const reports = { reportsAbout: this.store.reportIdsAbout(uuid), reportsBy: this.store.reportIdsBy(uuid) };
    if (!user) {
      // Gesperrt: Konto ist gelöscht, nur die Sperre und Meldungen sind noch da.
      return {
        uuid,
        name: ban!.name,
        cape: '',
        visible: false,
        presence: false,
        showServer: false,
        messages: false,
        createdAt: null,
        lastSeen: null,
        online: false,
        friends: 0,
        blocks: 0,
        ...reports,
        ban: this.banView(ban!),
        role: null,
      };
    }
    return {
      uuid: user.uuid,
      name: user.name,
      cape: user.cape,
      visible: user.visible,
      presence: user.presence,
      showServer: user.showServer,
      messages: user.messages,
      createdAt: user.createdAt as number | null,
      lastSeen: user.lastSeen as number | null,
      online: this.realtime.isConnected(user.uuid),
      friends: this.store.countFriends(user.uuid),
      blocks: this.store.countBlocks(user.uuid),
      ...reports,
      ban: ban ? this.banView(ban) : null,
      role: this.role(user.uuid),
    };
  }

  /** `POST /v1/team/players/<uuid>/reset-cape` (admin) */
  resetCape(actor: Actor, uuid: string) {
    const user = this.store.getUser(uuid);
    if (!user) throw new HttpError(404, NO_SUCH_PLAYER);
    if (user.cape !== '' && this.store.resetCape(uuid)) this.audit(actor, 'player.reset-cape', playerLabel(user.name, uuid), user.cape);
    return this.player(uuid);
  }

  /** `DELETE /v1/team/players/<uuid>` (admin): wie dessen `DELETE /v1/me`, ohne Sperre. */
  deletePlayer(actor: Actor, uuid: string) {
    const user = this.store.getUser(uuid);
    if (!user) throw new HttpError(404, NO_SUCH_PLAYER);
    if (this.store.getTeamMember(uuid)?.role === 'admin' && this.store.countAdmins() <= 1) throw new HttpError(409, LAST_ADMIN);
    const related = this.store.deleteUser(uuid);
    this.realtime.disconnectUser(uuid, 4001, 'Konto gelöscht');
    for (const other of related) this.realtime.pushFriends(other);
    this.audit(actor, 'player.delete', playerLabel(user.name, uuid));
    return { deleted: true };
  }

  // ---------- Neuigkeiten ----------

  newsView(news: NewsRow) {
    return {
      id: news.id,
      title: news.title,
      text: news.text,
      at: news.publishedAt ?? news.createdAt,
      updatedAt: news.updatedAt,
      author: news.author,
      published: news.published,
    };
  }

  /** `GET /v1/news`: nur veröffentlichte, neueste zuerst; mit `before` die älteren (Archiv). `more`: Es gibt noch ältere. */
  publicNews(limit: number, before?: number) {
    const rows = before === undefined ? this.store.listPublishedNews(limit + 1) : this.store.listPublishedNewsBefore(before, limit + 1);
    return {
      news: rows
        .slice(0, limit)
        .map((n) => ({ id: n.id, title: n.title, text: n.text, at: n.publishedAt ?? n.createdAt, author: n.author })),
      more: rows.length > limit,
    };
  }

  news() {
    return { news: this.store.listNews().map((n) => this.newsView(n)) };
  }

  private newsFields(input: Record<string, unknown>, required: boolean): { title?: string; text?: string; published?: boolean } {
    const patch: { title?: string; text?: string; published?: boolean } = {};
    if (required || Object.hasOwn(input, 'title')) {
      const title = checkText(input.title, MAX_NEWS_TITLE, false);
      if ('problem' in title) throw new HttpError(400, textError('title', MAX_NEWS_TITLE, title.problem));
      patch.title = title.text;
    }
    if (required || Object.hasOwn(input, 'text')) {
      const text = checkMultilineText(input.text, MAX_NEWS_TEXT);
      if ('problem' in text) throw new HttpError(400, textError('text', MAX_NEWS_TEXT, text.problem));
      patch.text = text.text;
    }
    if (Object.hasOwn(input, 'published')) {
      if (typeof input.published !== 'boolean') throw new HttpError(400, '„published“ muss true oder false sein.');
      patch.published = input.published;
    }
    return patch;
  }

  createNews(actor: Actor & { uuid: string }, input: Record<string, unknown>) {
    const fields = this.newsFields(input, true);
    const news = this.store.insertNews(fields.title!, fields.text!, actor, fields.published ?? false, Date.now());
    this.audit(actor, 'news.create', `Neuigkeit ${news.id}: ${news.title}`, news.published ? 'veröffentlicht' : 'Entwurf');
    return { news: this.newsView(news) };
  }

  updateNews(actor: Actor, id: number, input: Record<string, unknown>) {
    const fields = this.newsFields(input, false);
    const before = this.store.getNews(id);
    if (!before) throw new HttpError(404, 'Diese Neuigkeit gibt es nicht (mehr).');
    const news = this.store.updateNews(id, fields, Date.now())!;
    const detail = before.published === news.published ? null : news.published ? 'veröffentlicht' : 'zurückgezogen';
    this.audit(actor, 'news.update', `Neuigkeit ${id}: ${news.title}`, detail);
    return { news: this.newsView(news) };
  }

  deleteNews(actor: Actor, id: number) {
    const news = this.store.getNews(id);
    if (!news || !this.store.deleteNews(id)) throw new HttpError(404, 'Diese Neuigkeit gibt es nicht (mehr).');
    this.audit(actor, 'news.delete', `Neuigkeit ${id}: ${news.title}`);
    return { deleted: true };
  }

  // ---------- Teamprofil und öffentliche Teamseite ----------

  profile(member: TeamMemberRow) {
    return { public: member.public, title: member.title, about: member.about };
  }

  /** `PUT /v1/team/me/profile`: Teil von `{ public, title, about }`. Ins Protokoll kommt nur „öffentlich an/aus“. */
  updateProfile(actor: Actor & { uuid: string }, member: TeamMemberRow, input: Record<string, unknown>) {
    const patch: TeamProfilePatch = {};
    if (Object.hasOwn(input, 'public')) {
      if (typeof input.public !== 'boolean') throw new HttpError(400, '„public“ muss true oder false sein.');
      patch.public = input.public;
    }
    for (const [key, max] of [
      ['title', MAX_PROFILE_TITLE],
      ['about', MAX_PROFILE_ABOUT],
    ] as const) {
      if (!Object.hasOwn(input, key)) continue;
      const text = checkText(input[key], max, true);
      if ('problem' in text) throw new HttpError(400, textError(key, max, text.problem));
      patch[key] = text.text;
    }
    this.store.setTeamProfile(member.uuid, patch);
    if (patch.public !== undefined && patch.public !== member.public) {
      this.audit(actor, 'team.profile', playerLabel(member.name, member.uuid), patch.public ? 'öffentlich an' : 'öffentlich aus');
    }
    return this.profile(this.store.getTeamMember(member.uuid)!);
  }

  /** `GET /v1/public/team`: nur wer zugestimmt hat (`public`), Admins zuerst, dann nach Name. */
  publicTeam() {
    return {
      members: this.store.listPublicTeam().map((m) => ({
        uuid: m.uuid,
        name: m.name,
        role: m.role,
        title: m.title,
        about: m.about,
        since: m.addedAt,
      })),
    };
  }

  // ---------- Mitglieder ----------

  members() {
    return {
      members: this.store.listTeam().map((m: TeamMemberRow) => ({
        uuid: m.uuid,
        name: m.name,
        role: m.role,
        addedAt: m.addedAt,
        addedBy: m.addedBy,
        twoFactor: m.totpSecret !== null,
      })),
    };
  }

  private requireRole(value: unknown): TeamRole {
    if (!isTeamRole(value)) throw new HttpError(400, '„role“ muss moderator oder admin sein.');
    return value;
  }

  /** Ein Admin darf nicht der letzte sein, der wegfällt. */
  private guardLastAdmin(uuid: string, newRole: TeamRole | null): void {
    const member = this.store.getTeamMember(uuid);
    if (member?.role === 'admin' && newRole !== 'admin' && this.store.countAdmins() <= 1) throw new HttpError(409, LAST_ADMIN);
  }

  /** `POST /v1/team/members`: aufnehmen (oder Rolle ändern, wenn schon im Team). */
  addMember(actor: Actor, input: Record<string, unknown>) {
    const user = this.targetUser(input);
    const role = this.requireRole(input.role);
    this.guardLastAdmin(user.uuid, role);
    const result = this.store.setTeamMember(user.uuid, role, Date.now(), actor.name);
    if (result === 'added') this.audit(actor, 'team.add', playerLabel(user.name, user.uuid), role);
    if (result === 'changed') this.audit(actor, 'team.role', playerLabel(user.name, user.uuid), role);
    return this.members();
  }

  private requireMember(uuid: string): TeamMemberRow {
    const member = this.store.getTeamMember(uuid);
    if (!member) throw new HttpError(404, NOT_IN_TEAM);
    return member;
  }

  setRole(actor: Actor, uuid: string, input: Record<string, unknown>) {
    const member = this.requireMember(uuid);
    const role = this.requireRole(input.role);
    this.guardLastAdmin(uuid, role);
    if (this.store.setTeamMember(uuid, role, Date.now(), actor.name) === 'changed') {
      this.audit(actor, 'team.role', playerLabel(member.name, uuid), role);
    }
    return this.members();
  }

  removeMember(actor: Actor, uuid: string) {
    const member = this.requireMember(uuid);
    this.guardLastAdmin(uuid, null);
    this.store.removeTeamMember(uuid);
    this.audit(actor, 'team.remove', playerLabel(member.name, uuid), member.role);
    return this.members();
  }

  reset2fa(actor: Actor, uuid: string) {
    const member = this.requireMember(uuid);
    this.store.resetTotp(uuid);
    this.audit(actor, 'team.reset-2fa', playerLabel(member.name, uuid));
    return this.members();
  }

  // ---------- Protokoll ----------

  auditEntries(limit: number) {
    return {
      entries: this.store.listAudit(limit).map((e: AuditRow) => ({
        id: e.id,
        at: e.at,
        actor: { uuid: e.actorUuid, name: e.actorName },
        action: e.action,
        target: e.target,
        detail: e.detail,
      })),
    };
  }

  // ---------- Updates ----------

  async updatesOverview() {
    const published = await this.updates.published();
    let current: Record<string, unknown> | null = null;
    if (published) {
      try {
        current = JSON.parse(published.manifest) as Record<string, unknown>;
      } catch {
        current = null;
      }
    }
    return { current, files: await this.updates.files() };
  }

  async upload(actor: Actor, req: IncomingMessage, file: string) {
    const result = await this.updates.receive(req, file, this.options.maxUploadBytes, this.options.uploadIdleTimeoutMs);
    this.audit(actor, 'update.upload', result.file, `${result.size} Byte, SHA-512 ${result.sha512}`);
    return result;
  }

  async publish(actor: Actor, input: Record<string, unknown>) {
    if (!this.options.updateKey) {
      throw new HttpError(503, 'Auf diesem Server ist kein Update-Schlüssel eingerichtet. Updates lassen sich hier nicht im Browser veröffentlichen.');
    }
    const result = await this.updates.publish(input, this.options.updateKey);
    this.audit(actor, 'update.publish', result.file, `Version ${result.version}`);
    return { current: result.manifest };
  }

  async deleteFile(actor: Actor, file: string) {
    await this.updates.deleteFile(file);
    this.audit(actor, 'update.delete', file);
    return this.updatesOverview();
  }

  // ---------- Addons ----------

  addonsOverview() {
    return this.addons.overview(this.options.updateKey !== null);
  }

  async uploadAddon(actor: Actor, req: IncomingMessage, file: string) {
    const result = await this.addons.receive(req, file, this.options.maxAddonUploadBytes, this.options.uploadIdleTimeoutMs);
    this.audit(actor, 'addon.upload', result.file, `${result.size} Byte, SHA-256 ${result.sha256}`);
    return result;
  }

  async deleteAddonFile(actor: Actor, file: string) {
    await this.addons.deleteFile(file);
    this.audit(actor, 'addon.delete', file);
    return this.addonsOverview();
  }

  /** Signiert mit dem Update-Schlüssel (über "heldix-addon\n" + Manifest); ohne Schlüssel 503. */
  async publishAddon(actor: Actor, input: Record<string, unknown>) {
    if (!this.options.updateKey) {
      throw new HttpError(503, 'Auf diesem Server ist kein Update-Schlüssel eingerichtet. Addons lassen sich hier nicht veröffentlichen.');
    }
    const row = await this.addons.publish(input, this.options.updateKey, actor.name);
    this.audit(actor, 'addon.publish', `${row.id} ${row.version}`, row.file);
    return this.addonsOverview();
  }

  /** `{ "hidden": true | false }`: aus dem Store nehmen bzw. wieder zeigen (Dateien bleiben). */
  async setAddonHidden(actor: Actor, id: string, input: Record<string, unknown>) {
    if (typeof input.hidden !== 'boolean') throw new HttpError(400, '„hidden“ muss true oder false sein.');
    if (this.addons.setHidden(id, input.hidden)) this.audit(actor, input.hidden ? 'addon.hide' : 'addon.show', id);
    return this.addonsOverview();
  }

  async deleteAddonVersion(actor: Actor, id: string, version: string) {
    const result = await this.addons.deleteVersion(id, version);
    this.audit(actor, 'addon.delete', `${id} ${version}`, result.removed ? `${result.file} (letzte Version, Addon entfernt)` : result.file);
    return this.addonsOverview();
  }
}
