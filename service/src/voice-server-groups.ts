// Server-Gruppen im Voice Chat (ab 1.14.0): Ein Partner-Server teilt seine Spieler über die Partner-Schnittstelle in
// Gruppen ein (z. B. die Teams eines Minispiels). Wer auf diesem Server eine Server-Gruppe hat, hört in der Nähe nur
// Spieler derselben Server-Gruppe, und sein Gruppenkanal ist die Server-Gruppe (siehe voice.ts). Wie der übrige Voice
// Chat nur im Arbeitsspeicher: Der Dienst speichert und protokolliert dabei nichts (keine Gruppen, keine Spieler). Jeder
// Eintrag verfällt ohne Erneuerung nach 10 Minuten; das Plugin schickt alle 2 Minuten den ganzen Stand.

/** Name einer Server-Gruppe (vom Plugin vergeben). */
export const SERVER_GROUP_RE = /^[a-z0-9_-]{1,24}$/;
/** Höchstens so viele Einträge je Anfrage (`PUT /v1/partner/voice/groups`). */
export const SERVER_GROUP_MAX_PER_REQUEST = 500;
/** Höchstens so viele Spieler mit Server-Gruppe je Partner (alle seine Server zusammen). */
export const SERVER_GROUP_MAX_PER_PARTNER = 5000;
/** Ohne Erneuerung verfällt ein Eintrag nach dieser Zeit (Standard). */
export const SERVER_GROUP_TTL_MS = 10 * 60_000;

/** Bereich der Server-Gruppen: ein Server-Eintrag eines Partners (eine Domain deckt ihre Subdomains ab). */
export interface ServerGroupScope {
  /** `<partner-id> <server-eintrag>` */
  key: string;
  partner: string;
  partnerName: string;
  /** Server-Eintrag des Partners, zu dem die Adresse gehört */
  entry: string;
}

/** Server-Gruppe eines Spielers auf einem Server. */
export interface ServerGroupOf extends ServerGroupScope {
  group: string;
}

export interface ServerGroupOptions {
  ttlMs: number;
  /** Abgelaufene Einträge so oft entfernen und Betroffene benachrichtigen (Standard 30 s) */
  sweepMs: number;
  now: () => number;
  /** Bereich zu einer (normalisierten) Server-Adresse: der passende Eintrag eines aktiven Partners, sonst null */
  resolve: (server: string) => ServerGroupScope | null;
}

interface Scope {
  partner: string;
  members: Map<string, { group: string; expiresAt: number }>;
}

export class VoiceServerGroups {
  private readonly scopes = new Map<string, Scope>();
  private readonly timer: NodeJS.Timeout;
  /** Server-Gruppen dieser Spieler haben sich (vielleicht) geändert; null = alle prüfen (voice.ts). */
  listener: ((uuids: ReadonlySet<string> | null) => void) | null = null;

  constructor(private readonly options: ServerGroupOptions) {
    this.timer = setInterval(() => this.sweep(), options.sweepMs);
    this.timer.unref();
  }

  /** Spieler mit Server-Gruppe je Partner (alle Bereiche zusammen). */
  private countFor(partner: string, except?: string): number {
    let count = 0;
    for (const [key, scope] of this.scopes) if (scope.partner === partner && key !== except) count += scope.members.size;
    return count;
  }

  /**
   * Einträge setzen bzw. erneuern (`group`) oder entfernen (`null`); nicht genannte Spieler bleiben bis zu ihrem Ablauf.
   * Liefert die Zahl der Spieler mit Server-Gruppe in diesem Bereich; null, wenn die Grenze je Partner überschritten wäre
   * (dann ändert sich nichts).
   */
  set(scope: ServerGroupScope, entries: ReadonlyArray<readonly [string, string | null]>): { players: number } | null {
    const now = this.options.now();
    const existing = this.scopes.get(scope.key);
    const next = new Map(existing?.members ?? []);
    for (const [uuid, group] of entries) {
      if (group === null) next.delete(uuid);
      else next.set(uuid, { group, expiresAt: now + this.options.ttlMs });
    }
    for (const [uuid, entry] of next) if (entry.expiresAt <= now) next.delete(uuid);
    if (this.countFor(scope.partner, scope.key) + next.size > SERVER_GROUP_MAX_PER_PARTNER) return null;
    if (next.size === 0) this.scopes.delete(scope.key);
    else this.scopes.set(scope.key, { partner: scope.partner, members: next });
    this.listener?.(new Set(entries.map(([uuid]) => uuid)));
    return { players: next.size };
  }

  /** Alle Einträge eines Bereichs (`DELETE /v1/partner/voice/groups?server=…`) bzw. eines Partners (pausiert, gelöscht). */
  clear(partner: string, scopeKey?: string): void {
    const affected = new Set<string>();
    for (const [key, scope] of [...this.scopes]) {
      if (scope.partner !== partner || (scopeKey !== undefined && key !== scopeKey)) continue;
      for (const uuid of scope.members.keys()) affected.add(uuid);
      this.scopes.delete(key);
    }
    if (affected.size > 0) this.listener?.(affected);
  }

  /** Server-Gruppe eines Spielers auf einem Server (abgelaufene zählen nicht), sonst null. */
  of(server: string, uuid: string): ServerGroupOf | null {
    if (this.scopes.size === 0) return null;
    const scope = this.options.resolve(server);
    if (scope === null) return null;
    const entry = this.scopes.get(scope.key)?.members.get(uuid);
    if (!entry || entry.expiresAt <= this.options.now()) return null;
    return { ...scope, group: entry.group };
  }

  /** Spieler mit Server-Gruppe in einem Bereich (für die Antwort an das Plugin). */
  count(scopeKey: string): number {
    return this.scopes.get(scopeKey)?.members.size ?? 0;
  }

  /** Abgelaufene Einträge entfernen; Betroffene verlieren ihre Server-Gruppe sofort. */
  sweep(): void {
    const now = this.options.now();
    const expired = new Set<string>();
    for (const [key, scope] of this.scopes) {
      for (const [uuid, entry] of scope.members) {
        if (entry.expiresAt > now) continue;
        scope.members.delete(uuid);
        expired.add(uuid);
      }
      if (scope.members.size === 0) this.scopes.delete(key);
    }
    if (expired.size > 0) this.listener?.(expired);
  }

  close(): void {
    clearInterval(this.timer);
    this.scopes.clear();
  }
}
