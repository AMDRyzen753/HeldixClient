// Heldix+-Warteliste (ab 1.13.0): Heldix+ ist geplant (dauerhafte Welten, mehr Plätze und Speicher, Vorrang beim Start);
// Preise und Inhalte stehen noch nicht fest, bezahlt wird nichts. Spieler tragen sich mit ihrem Konto ein (nur UUID und
// seit wann), das Team schaltet von dort Beta-Tester frei („Beta: Dauerhafte Welten“, hosting-granted). Die Zahl der
// Einträge ist öffentlich erst ab einer Schwelle (Standard 50, wie die Live-Zahlen).
import type { StatementSync } from 'node:sqlite';
import type { Store, UserRow } from './db';
import type { HostingGrants } from './hosting/grants';
import type { HostingStore } from './hosting/store';
import { HttpError } from './http';
import { isUuid } from './validate';
import type { Actor } from './team';

/** Höchstens so viele auf einmal freischalten (`first`) bzw. in einer Liste (`uuids`). */
export const MAX_GRANT_BATCH = 200;

type Row = Record<string, unknown>;

export class Plus {
  private readonly sql: Record<string, StatementSync>;

  constructor(
    private readonly store: Store,
    private readonly hostingStore: HostingStore,
    private readonly grants: HostingGrants,
    private readonly options: { countMin: number },
  ) {
    const p = (sql: string) => store.prepare(sql);
    this.sql = {
      get: p('SELECT since FROM plus_waitlist WHERE uuid = ?'),
      join: p('INSERT OR IGNORE INTO plus_waitlist (uuid, since) VALUES (?, ?)'),
      leave: p('DELETE FROM plus_waitlist WHERE uuid = ?'),
      count: p('SELECT count(*) AS n FROM plus_waitlist'),
      list: p(`
        SELECT p.uuid, u.name, p.since, u.created_at, u.last_online, r.played_ms,
          EXISTS (SELECT 1 FROM team t WHERE t.uuid = p.uuid) AS team
        FROM plus_waitlist p JOIN users u ON u.uuid = p.uuid LEFT JOIN referrals r ON r.invitee = p.uuid
        ORDER BY p.since, p.uuid`),
    };
  }

  /** Zahl der Einträge, oder null unter der Schwelle (kleine Zahlen bleiben privat). */
  publicCount(): number | null {
    const n = Number((this.sql.count!.get() as Row).n);
    return n >= this.options.countMin ? n : null;
  }

  private state(user: UserRow) {
    const row = this.sql.get!.get(user.uuid) as Row | undefined;
    const grant = this.hostingStore.grantsOf(user.uuid).find((g) => g.expiresAt === null || g.expiresAt > Date.now());
    return {
      waitlist: row ? { since: Number(row.since) } : null,
      granted: this.grants.allowed(user.uuid),
      grantedAt: grant?.grantedAt ?? null,
      team: this.grants.isTeam(user.uuid),
      unseen: grant !== undefined && grant.seenAt === null,
      count: this.publicCount(),
    };
  }

  /** `GET /v1/plus` */
  get(user: UserRow) {
    return this.state(user);
  }

  /** `PUT /v1/plus/waitlist` (einmal; ein zweites Mal ändert nichts) */
  join(user: UserRow) {
    this.sql.join!.run(user.uuid, Date.now());
    return this.state(user);
  }

  /** `DELETE /v1/plus/waitlist` */
  leave(user: UserRow) {
    this.sql.leave!.run(user.uuid);
    return this.state(user);
  }

  /** `POST /v1/plus/seen`: Hinweis zur Freischaltung gesehen (Glocke, Webseite, Spiel). */
  seen(user: UserRow) {
    this.grants.markSeen(user.uuid);
    return this.state(user);
  }

  private entries() {
    const granted = this.hostingStore.grantedAmong(
      (this.sql.list!.all() as Row[]).map((row) => String(row.uuid)),
      Date.now(),
    );
    return (this.sql.list!.all() as Row[]).map((row) => ({
      uuid: String(row.uuid),
      name: String(row.name),
      since: Number(row.since),
      memberSince: Number(row.created_at),
      lastOnline: row.last_online === null || row.last_online === undefined ? null : Number(row.last_online),
      // Spielzeit nur, wenn der Dienst sie kennt (über eine Einladung dazugekommen, bis zur Bestätigung gezählt)
      playedMs: row.played_ms === null || row.played_ms === undefined ? null : Number(row.played_ms),
      team: Number(row.team) === 1,
      granted: granted.has(String(row.uuid)),
    }));
  }

  /** `GET /v1/team/plus/waitlist` */
  teamList() {
    const entries = this.entries();
    return { entries, count: entries.length, waiting: entries.filter((e) => !e.granted && !e.team).length };
  }

  /**
   * `POST /v1/team/plus/grant { uuids: [...] }` oder `{ first: N }`: Freischaltung „Beta: Dauerhafte Welten“ setzen und
   * `hosting-granted` schicken. `first` nimmt die ältesten Einträge ohne Freischaltung (Team-Mitglieder brauchen keine).
   */
  teamGrant(actor: Actor, input: Record<string, unknown>) {
    let targets: string[];
    if (input.first !== undefined) {
      const first = input.first;
      if (typeof first !== 'number' || !Number.isInteger(first) || first < 1 || first > MAX_GRANT_BATCH) {
        throw new HttpError(400, `„first“ muss eine ganze Zahl von 1 bis ${MAX_GRANT_BATCH} sein.`);
      }
      targets = this.entries()
        .filter((e) => !e.granted && !e.team)
        .slice(0, first)
        .map((e) => e.uuid);
    } else if (Array.isArray(input.uuids) && input.uuids.length >= 1 && input.uuids.length <= MAX_GRANT_BATCH && input.uuids.every((u) => isUuid(u))) {
      targets = [...new Set(input.uuids as string[])];
    } else {
      throw new HttpError(400, `Erwartet { "uuids": [1 bis ${MAX_GRANT_BATCH} UUIDs] } oder { "first": N }.`);
    }
    const granted: { uuid: string; name: string }[] = [];
    let skipped = 0;
    for (const uuid of targets) {
      if (!this.store.getUser(uuid)) {
        skipped++;
        continue;
      }
      const result = this.grants.grant(actor, uuid, 'beta');
      if (result.added) granted.push({ uuid, name: result.grant.name });
      else skipped++;
    }
    return { granted, skipped, ...this.teamList() };
  }

  /** Datenauskunft */
  exportFor(user: UserRow) {
    const row = this.sql.get!.get(user.uuid) as Row | undefined;
    return { waitlist: row ? { since: Number(row.since) } : null };
  }
}
