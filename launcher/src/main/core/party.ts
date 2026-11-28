// Party im Launcher (Heldix-Dienst ab 1.12.0, siehe docs/dienst.md, „Party“): bis zu 8 Freunde mit einem Leiter, nur im
// Speicher des Dienstes. Der Launcher zeigt die Party oben auf der Freunde-Seite (Mitglieder mit Ort, Einladungen,
// Party-Chat) und meldet Einladungen und „Folgen“.
//
// - Stand: GET /v1/party beim Start, nach dem (Neu-)Verbinden der Echtzeit und nach jeder Aktion; danach Echtzeit
//   (core/social.ts reicht sie über onRealtime durch): party (neuer Stand bzw. null mit reason), party-invite (offene
//   Einladungen, invite = neue → Hinweis, quiet bei „Nicht stören“), party-chat (neue Nachricht) und party-follow (der
//   Leiter ist woanders). Ohne Echtzeit-Verbindung fragt der Launcher alle 30 s ab, solange die Freunde-Seite offen
//   ist (siehe main.ts) – Party und Party-Chat liegen nie auf der Platte.
// - Folgen: „<Leiter> ist auf <Ziel> – Beitreten“ (Hinweis bzw. Benachrichtigung). Mit „Automatisch folgen“ (Einstellung
//   partyAutoFollow) tritt der Launcher selbst bei, aber nur, wenn gerade kein Spiel läuft – nie mitten aus einer Welt.
// - Dienst ohne Party (404 auf GET /v1/party): Bereich aus, 30 Minuten Ruhe.

import type { FriendActivity, Party, PartyChatMessage, PartyInvite, PartyLocation, PartyMember, PartyState } from '../../shared/api';
import { ServiceError, type ServiceMethod } from './heldixservice';

const UNSUPPORTED_MS = 30 * 60_000;
const ACTIVITIES: readonly FriendActivity[] = ['menu', 'singleplayer', 'multiplayer', 'realms', 'lan'];
const UUID_RE = /^[0-9a-f]{32}$/;
const PARTY_ID_RE = /^[0-9a-f]{32}$/;
const WORLD_CODE_RE = /^[a-hjkmnp-z2-9]{6}$/;
const CHAT_KEEP = 50;
export const PARTY_CHAT_MAX = 500;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const time = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
const message = (error: unknown) => (error instanceof Error && error.message ? error.message : 'Unbekannter Fehler beim Heldix-Dienst.');

function player(raw: unknown): { uuid: string; name: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const uuid = str(p.uuid).toLowerCase();
  if (!UUID_RE.test(uuid)) return null;
  return { uuid, name: str(p.name).trim().slice(0, 32) || uuid };
}

/** Ort eines Mitglieds (ungültig: null). Server-Adressen und Welt-Codes klein; title höchstens 64 Zeichen. */
export function mapLocation(raw: unknown): PartyLocation | null {
  if (!raw || typeof raw !== 'object') return null;
  const l = raw as Record<string, unknown>;
  const address = str(l.address).trim().toLowerCase();
  if (!address || address.length > 260 || !/^[a-z0-9.-]+(:\d{1,5})?$/.test(address)) return null;
  const title = str(l.title).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (l.kind === 'world') {
    const code = str(l.target).toLowerCase();
    if (!WORLD_CODE_RE.test(code)) return null;
    return { kind: 'world', target: code, address, title: [...title].slice(0, 64).join('') || 'Geteilte Welt' };
  }
  if (l.kind === 'server') {
    const target = str(l.target).trim().toLowerCase() || address;
    if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(target)) return null;
    return { kind: 'server', target, address, title: [...title].slice(0, 64).join('') || target };
  }
  return null;
}

export function mapPartyMember(raw: unknown): PartyMember | null {
  const p = player(raw);
  if (!p) return null;
  const m = raw as Record<string, unknown>;
  return {
    ...p,
    leader: m.leader === true,
    online: m.online === true,
    away: m.away === true,
    awayUntil: m.away === true && time(m.awayUntil) ? time(m.awayUntil) : null,
    state: ACTIVITIES.includes(m.state as FriendActivity) ? (m.state as FriendActivity) : null,
    location: mapLocation(m.location),
    joined: time(m.joined),
  };
}

export function mapPartyChat(raw: unknown, me: string | null): PartyChatMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const from = str(m.from).toLowerCase();
  if (!Number.isSafeInteger(m.id) || (m.id as number) < 1 || !UUID_RE.test(from) || typeof m.text !== 'string') return null;
  return { id: m.id as number, from, name: str(m.name).slice(0, 32) || from, text: m.text, at: time(m.at), mine: me !== null && from === me };
}

/** Stand einer Party; chat = vorhandener Chat (bleibt bei derselben Party erhalten) */
export function mapParty(raw: unknown, me: string | null, chat: PartyChatMessage[] = []): Party | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const id = str(p.id);
  if (!PARTY_ID_RE.test(id)) return null;
  const members = (Array.isArray(p.members) ? p.members : []).map(mapPartyMember).filter((m): m is PartyMember => m !== null);
  if (members.length === 0) return null;
  const leader = UUID_RE.test(str(p.leader)) ? str(p.leader) : members.find((m) => m.leader)?.uuid ?? members[0].uuid;
  for (const member of members) member.leader = member.uuid === leader;
  const invites = (Array.isArray(p.invites) ? p.invites : [])
    .map((raw) => {
      const i = player(raw);
      if (!i) return null;
      const r = raw as Record<string, unknown>;
      return { ...i, by: UUID_RE.test(str(r.by)) ? str(r.by) : leader, at: time(r.at), expires: time(r.expires) };
    })
    .filter((i): i is Party['invites'][number] => i !== null);
  const serverChat = Array.isArray(p.chat) ? p.chat.map((m) => mapPartyChat(m, me)).filter((m): m is PartyChatMessage => m !== null) : null;
  return {
    id,
    leader,
    created: time(p.created),
    max: typeof p.max === 'number' && Number.isInteger(p.max) && p.max >= 2 && p.max <= 32 ? p.max : 8,
    members,
    invites,
    target: mapLocation(p.target),
    voice: !!p.voice && typeof p.voice === 'object',
    chat: mergeChat(serverChat ?? chat, []),
  };
}

export function mapPartyInvite(raw: unknown): PartyInvite | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const party = str(r.party);
  const from = player(r.from);
  if (!PARTY_ID_RE.test(party) || !from) return null;
  return {
    party,
    from,
    leader: player(r.leader) ?? from,
    members: typeof r.members === 'number' && r.members > 0 ? Math.floor(r.members) : 1,
    at: time(r.at),
    expires: time(r.expires),
    quiet: r.quiet === true,
  };
}

/** Chat zusammenführen: nach ID, ohne Doppelte, die letzten 50 */
export function mergeChat(existing: readonly PartyChatMessage[], incoming: readonly PartyChatMessage[]): PartyChatMessage[] {
  const byId = new Map<number, PartyChatMessage>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-CHAT_KEEP);
}

/** „Auf mc.example.de“ bzw. „In „Insel““ */
export function locationText(location: PartyLocation | null): string {
  if (!location) return 'Gerade nicht auf einem Server';
  return location.kind === 'world' ? `In „${location.title}“` : `Auf ${location.title}`;
}

/**
 * Was beim Folgen passiert: join = gleich beitreten (Automatisch folgen an, kein Spiel läuft, nicht schon dort),
 * notify = Hinweis mit „Beitreten“, none = schon am selben Ort.
 */
export function followAction(input: { autoFollow: boolean; gameRunning: boolean; here: string | null; target: PartyLocation }): 'join' | 'notify' | 'none' {
  if (input.here && input.here === input.target.address) return 'none';
  return input.autoFollow && !input.gameRunning ? 'join' : 'notify';
}

export function emptyParty(status: PartyState['status'], error: string | null = null, me: string | null = null): PartyState {
  return { status, error, party: null, invites: [], me, ended: null };
}

/** Teil von core/social.ts, den die Party braucht */
export interface PartyAuth {
  authed<T>(route: string, init?: { method?: ServiceMethod; body?: unknown }, options?: { offlineMessage?: string; quiet?: boolean }): Promise<T>;
  accountId(): Promise<string | null>;
  canAuthenticate(): Promise<boolean>;
  myServiceUuid(): Promise<string>;
}

export type PartyEvent =
  | { kind: 'invite'; invite: PartyInvite }
  | { kind: 'follow'; party: string; leader: { uuid: string; name: string }; target: PartyLocation }
  | { kind: 'ended'; reason: 'left' | 'removed' | 'dissolved' }
  | { kind: 'chat'; message: PartyChatMessage };

export interface PartyOptions {
  auth: PartyAuth | null;
  /** Einstellung „Freunde & Nachrichten“ */
  enabled(): Promise<boolean>;
  onUpdate?(state: PartyState): void;
  onEvent?(event: PartyEvent): void;
  log?(line: string): void;
}

const OFFLINE = 'Party gibt es nur mit einem Microsoft-Konto.';

export class PartyClient {
  private state: PartyState = emptyParty('off');
  private lastSent = '';
  private account: string | null = null;
  private unsupportedUntil = 0;
  private loading: Promise<PartyState> | null = null;

  constructor(private readonly options: PartyOptions) {}

  get current(): PartyState {
    return this.state;
  }

  private publish(next: PartyState): PartyState {
    this.state = next;
    const json = JSON.stringify(next);
    if (json !== this.lastSent) {
      this.lastSent = json;
      this.options.onUpdate?.(next);
    }
    return next;
  }

  /** Kontowechsel: alten Stand verwerfen */
  reset(): void {
    this.account = null;
    this.publish(emptyParty('off'));
  }

  /** GET /v1/party (läuft schon eine Abfrage, gibt es deren Ergebnis) */
  refresh(): Promise<PartyState> {
    this.loading ??= this.load().finally(() => (this.loading = null));
    return this.loading;
  }

  private async load(): Promise<PartyState> {
    const auth = this.options.auth;
    if (!auth) return this.publish(emptyParty('off'));
    if (Date.now() < this.unsupportedUntil) return this.publish(emptyParty('unsupported'));
    try {
      if (!(await this.options.enabled()) || !(await auth.canAuthenticate())) {
        this.account = null;
        return this.publish(emptyParty('off'));
      }
    } catch {
      return this.publish(emptyParty('off'));
    }
    const account = await auth.accountId().catch(() => null);
    if (account !== this.account) {
      this.account = account;
      this.publish(emptyParty('off'));
    }
    let raw: unknown;
    let me: string | null;
    try {
      me = await auth.myServiceUuid();
      raw = await auth.authed<unknown>('/v1/party', {}, { offlineMessage: OFFLINE, quiet: true });
    } catch (error) {
      if (error instanceof ServiceError && error.status === 404) {
        this.unsupportedUntil = Date.now() + UNSUPPORTED_MS;
        return this.publish(emptyParty('unsupported'));
      }
      return this.publish({ ...this.state, status: 'error', error: message(error) });
    }
    return this.publish(this.fromResponse(raw, me));
  }

  private fromResponse(raw: unknown, me: string | null): PartyState {
    const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const keep = this.state.party && this.state.party.id === (r.party as { id?: unknown } | null)?.id ? this.state.party.chat : [];
    const invites = Array.isArray(r.invites) ? r.invites.map(mapPartyInvite).filter((i): i is PartyInvite => i !== null) : this.state.invites;
    const party = mapParty(r.party, me, keep);
    return { status: 'ok', error: null, party, invites, me, ended: party ? null : this.state.ended };
  }

  /** Echtzeit-Nachricht (party, party-invite, party-chat, party-follow); true = war für die Party */
  handle(raw: Record<string, unknown>): boolean {
    const me = this.state.me;
    switch (raw.type) {
      case 'party': {
        if (raw.party === null || raw.party === undefined) {
          const had = this.state.party !== null;
          const reason = raw.reason === 'removed' || raw.reason === 'dissolved' ? raw.reason : 'left';
          this.publish({ ...this.state, status: 'ok', party: null, ended: had ? reason : this.state.ended });
          if (had) this.options.onEvent?.({ kind: 'ended', reason });
          return true;
        }
        const keep = this.state.party && this.state.party.id === (raw.party as { id?: unknown }).id ? this.state.party.chat : [];
        const party = mapParty(raw.party, me, keep);
        if (party) this.publish({ ...this.state, status: 'ok', party, ended: null });
        return true;
      }
      case 'party-invite': {
        const invites = Array.isArray(raw.invites) ? raw.invites.map(mapPartyInvite).filter((i): i is PartyInvite => i !== null) : this.state.invites;
        this.publish({ ...this.state, status: 'ok', invites });
        const invite = mapPartyInvite(raw.invite);
        if (invite) this.options.onEvent?.({ kind: 'invite', invite });
        return true;
      }
      case 'party-chat': {
        const party = this.state.party;
        const chat = mapPartyChat(raw.message, me);
        if (!party || !chat || raw.party !== party.id) return true;
        this.publish({ ...this.state, party: { ...party, chat: mergeChat(party.chat, [chat]) } });
        if (!chat.mine) this.options.onEvent?.({ kind: 'chat', message: chat });
        return true;
      }
      case 'party-follow': {
        const target = mapLocation(raw.target);
        const leader = player(raw.leader);
        if (!target || !leader || typeof raw.party !== 'string') return true;
        this.options.onEvent?.({ kind: 'follow', party: raw.party, leader, target });
        return true;
      }
      default:
        return false;
    }
  }

  // ---------- Aktionen ----------

  private auth(): PartyAuth {
    if (!this.options.auth) throw new Error('Kein Heldix-Dienst eingerichtet.');
    return this.options.auth;
  }

  private async act(route: string, method: ServiceMethod, body?: unknown): Promise<PartyState> {
    const auth = this.auth();
    const me = await auth.myServiceUuid();
    let raw: unknown;
    try {
      raw = await auth.authed<unknown>(route, { method, body }, { offlineMessage: OFFLINE });
    } catch (error) {
      // unbekannte Route (Dienst vor 1.12.0) – die Party-Routen selbst haben eigene 404-Meldungen
      if (error instanceof ServiceError && error.status === 404 && /^Nicht gefunden\.$|antwortet mit 404/.test(error.message)) {
        throw new Error('Der Heldix-Dienst kennt noch keine Party.');
      }
      throw error;
    }
    const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    let next: PartyState = { ...this.state, status: 'ok', error: null, me };
    if ('party' in r) {
      const keep = this.state.party && r.party && this.state.party.id === (r.party as { id?: unknown }).id ? this.state.party.chat : [];
      const party = mapParty(r.party, me, keep);
      // selbst verlassen: „left“ (die Oberfläche zeigt dann keinen Hinweis wie bei „entfernt“)
      next = { ...next, party, ended: party ? null : this.state.party ? 'left' : next.ended };
    }
    if (Array.isArray(r.invites)) next = { ...next, invites: r.invites.map(mapPartyInvite).filter((i): i is PartyInvite => i !== null) };
    this.publish(next);
    return next;
  }

  invite(uuid: string): Promise<PartyState> {
    return this.act('/v1/party/invite', 'POST', { uuid: checkUuid(uuid) });
  }

  cancelInvite(uuid: string): Promise<PartyState> {
    return this.act(`/v1/party/invites/${checkUuid(uuid)}`, 'DELETE');
  }

  async accept(id: string): Promise<PartyState> {
    const state = await this.act(`/v1/party/${checkPartyId(id)}/accept`, 'POST');
    // die Einladung ist weg, der Chat der neuen Party kommt mit GET /v1/party
    return this.refresh().catch(() => state);
  }

  decline(id: string): Promise<PartyState> {
    return this.act(`/v1/party/${checkPartyId(id)}/decline`, 'POST');
  }

  leave(): Promise<PartyState> {
    return this.act('/v1/party/leave', 'POST');
  }

  kick(uuid: string): Promise<PartyState> {
    return this.act(`/v1/party/members/${checkUuid(uuid)}`, 'DELETE');
  }

  transfer(uuid: string): Promise<PartyState> {
    return this.act('/v1/party/leader', 'POST', { uuid: checkUuid(uuid) });
  }

  async chat(rawText: unknown): Promise<PartyState> {
    const text = typeof rawText === 'string' ? rawText.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
    if (!text) throw new Error('Die Nachricht ist leer.');
    if ([...text].length > PARTY_CHAT_MAX) throw new Error(`Nachrichten haben höchstens ${PARTY_CHAT_MAX} Zeichen.`);
    const auth = this.auth();
    const me = await auth.myServiceUuid();
    const data = await auth.authed<{ message?: unknown }>('/v1/party/chat', { method: 'POST', body: { text } }, { offlineMessage: OFFLINE });
    const chat = mapPartyChat(data.message, me);
    const party = this.state.party;
    if (chat && party) return this.publish({ ...this.state, party: { ...party, chat: mergeChat(party.chat, [chat]) } });
    return this.state;
  }

  /** eigener Ort laut Party (für „schon dort?“) */
  myLocation(): PartyLocation | null {
    const me = this.state.me;
    return this.state.party?.members.find((m) => m.uuid === me)?.location ?? null;
  }
}

function checkUuid(raw: unknown): string {
  const uuid = typeof raw === 'string' ? raw.replace(/-/g, '').toLowerCase() : '';
  if (!UUID_RE.test(uuid)) throw new Error('Ungültige Spieler-ID.');
  return uuid;
}

function checkPartyId(raw: unknown): string {
  if (typeof raw !== 'string' || !PARTY_ID_RE.test(raw)) throw new Error('Ungültige Party.');
  return raw;
}
