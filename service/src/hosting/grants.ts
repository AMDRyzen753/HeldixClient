// Dauerhafte Welten (1.13.0): wer sie nutzen darf. Alle Team-Mitglieder (jede Rolle) und Spieler mit einer Freischaltung
// („Beta: Dauerhafte Welten“ vom Team, Recht hosting:grant; später zusätzlich Heldix+ als weitere Quelle). Eine neue
// Freischaltung meldet der Dienst sofort über /v1/ws (`hosting-granted`); wer gerade nicht verbunden ist, bekommt den
// Hinweis bei der nächsten Verbindung, bis er ihn gesehen hat (`POST /v1/plus/seen`).
import type { Store } from '../db';
import { HttpError } from '../http';
import type { Realtime } from '../realtime';
import { playerLabel, writeAudit, type Actor } from '../team';
import type { GrantRow, GrantSource, HostingStore } from './store';

export const GRANT_LABELS: Record<GrantSource, string> = {
  beta: 'Beta: Dauerhafte Welten',
  plus: 'Heldix+',
};

export const GRANTED_TEXT = 'Du bist für die Beta „Dauerhafte Welten“ freigeschaltet. Stell eine deiner Welten dauerhaft online!';

export interface GrantView {
  uuid: string;
  name: string;
  source: GrantSource;
  label: string;
  grantedAt: number;
  grantedBy: string | null;
  expiresAt: number | null;
  seen: boolean;
}

export function grantView(row: GrantRow): GrantView {
  return {
    uuid: row.uuid,
    name: row.name,
    source: row.source,
    label: GRANT_LABELS[row.source],
    grantedAt: row.grantedAt,
    grantedBy: row.grantedBy,
    expiresAt: row.expiresAt,
    seen: row.seenAt !== null,
  };
}

export class HostingGrants {
  /** Freischaltung entzogen (Hosting hält dann laufende Welten an). */
  onRevoked: ((uuid: string) => void) | null = null;

  constructor(
    private readonly store: Store,
    private readonly hosting: HostingStore,
    private readonly realtime: Realtime,
  ) {}

  isTeam(uuid: string): boolean {
    return this.store.getTeamMember(uuid) !== undefined;
  }

  /** Team-Mitglied oder gültige Freischaltung. */
  allowed(uuid: string, now = Date.now()): boolean {
    return this.isTeam(uuid) || this.hosting.hasActiveGrant(uuid, now);
  }

  hasGrant(uuid: string, now = Date.now()): boolean {
    return this.hosting.hasActiveGrant(uuid, now);
  }

  private message(row: GrantRow, pending: boolean) {
    return { type: 'hosting-granted', source: row.source, label: GRANT_LABELS[row.source], at: row.grantedAt, text: GRANTED_TEXT, pending };
  }

  /**
   * Freischalten (Team oder Warteliste). Neu: `hosting-granted` an alle Verbindungen des Spielers, Eintrag im Protokoll.
   * Unbekannter Spieler: 404.
   */
  grant(actor: Actor & { uuid: string | null }, uuid: string, source: GrantSource = 'beta'): { added: boolean; grant: GrantView } {
    const user = this.store.getUser(uuid);
    if (!user) throw new HttpError(404, 'Diesen Spieler kennt der Heldix-Dienst nicht.');
    const now = Date.now();
    const added = this.hosting.grant(uuid, source, now, actor.name, null);
    const row = this.hosting.grantsOf(uuid).find((g) => g.source === source)!;
    if (added) {
      writeAudit(this.store, actor, 'hosting.grant', playerLabel(user.name, user.uuid), GRANT_LABELS[source]);
      this.realtime.send(uuid, this.message(row, false));
    }
    return { added, grant: grantView(row) };
  }

  revoke(actor: Actor & { uuid: string | null }, uuid: string, source: GrantSource = 'beta'): { removed: boolean } {
    const before = this.hosting.grantsOf(uuid);
    const removed = this.hosting.revoke(uuid, source);
    if (removed) {
      writeAudit(this.store, actor, 'hosting.revoke', playerLabel(before[0]?.name ?? '', uuid), GRANT_LABELS[source]);
      this.onRevoked?.(uuid);
    }
    return { removed };
  }

  list(): GrantView[] {
    return this.hosting.allGrants().map(grantView);
  }

  of(uuid: string): GrantView[] {
    return this.hosting.grantsOf(uuid).map(grantView);
  }

  /** Erste Verbindung eines Spielers: noch nicht gesehene Freischaltung melden. */
  connected(uuid: string): void {
    const row = this.hosting.unseenGrant(uuid, Date.now());
    if (row) this.realtime.send(uuid, this.message(row, true));
  }

  markSeen(uuid: string): void {
    this.hosting.markGrantsSeen(uuid, Date.now());
  }
}
