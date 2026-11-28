// Party (ab 1.12.0, Freunde 2.0): bis zu 8 Spieler mit einem Leiter, nur im Arbeitsspeicher (nach einem Neustart weg).
// Der Leiter lädt Freunde ein; Mitglieder sehen untereinander, wo die anderen spielen (Server bzw. geteilte Welt).
// Wechselt der Leiter den Ort, bekommen die anderen `party-follow`. Wer auf demselben Server bzw. in derselben Welt ist
// wie ein anderes Mitglied, bekommt einen Prüfwert für eine gemeinsame Voice-Gruppe. Party-Chat: nur im Speicher.
import { createHmac, randomBytes } from 'node:crypto';
import type { Store, UserRow } from './db';
import { HttpError } from './http';
import type { RateLimiter } from './limits';
import type { Realtime } from './realtime';
import { checkText, type State } from './validate';

/** Wo ein Spieler gerade ist: Server (Adresse) oder geteilte Welt (Code). */
export interface Location {
  kind: 'server' | 'world';
  /** Server-Adresse bzw. Welt-Code */
  target: string;
  /** Adresse zum Beitreten (bei Welten `<code>.<Welt-Domain>`); gleich = am selben Ort */
  address: string;
  /** Server-Adresse bzw. Name der Welt */
  title: string;
}

export interface PartyOptions {
  /** Höchstens so viele Mitglieder (mit dem Leiter, Standard 8). */
  maxMembers: number;
  /** So lange bleibt ein Mitglied ohne Verbindung in der Party (Standard 10 Minuten). */
  graceMs: number;
  /** So lange gilt eine Einladung (Standard 10 Minuten). */
  inviteTtlMs: number;
  /** Party-Chat: Nachrichten pro Spieler und Zeitraum (wie Direktnachrichten). */
  chatLimiter: RateLimiter;
  /** Wo ist der Spieler gerade (Status aus dem Spiel bzw. geöffnete Welt)? */
  locate: (uuid: string) => Location | null;
  log: (line: string) => void;
}

/** Höchstens so viele offene Einladungen je Party und Nachrichten im Party-Chat. */
export const MAX_PARTY_INVITES = 16;
export const PARTY_CHAT_KEEP = 50;
/** Dieselbe Einladung meldet der Dienst höchstens so oft erneut (Toast beim Eingeladenen). */
const REINVITE_MS = 60_000;

export const NO_PARTY = 'Du bist in keiner Party.';
export const INVITE_GONE = 'Diese Party-Einladung gibt es nicht (mehr).';
const ONLY_LEADER = 'Das darf nur der Leiter der Party.';

interface Member {
  uuid: string;
  joined: number;
  /** ohne Verbindung seit (Gnadenfrist), sonst null */
  awaySince: number | null;
  timer?: NodeJS.Timeout;
}

interface Invite {
  uuid: string;
  by: string;
  at: number;
  expires: number;
  lastSent: number;
  timer?: NodeJS.Timeout;
}

export interface PartyChatMessage {
  id: number;
  from: string;
  name: string;
  text: string;
  at: number;
}

interface Party {
  id: string;
  leader: string;
  created: number;
  /** in der Reihenfolge des Beitritts (der Leiter ist ebenfalls Mitglied) */
  members: Map<string, Member>;
  invites: Map<string, Invite>;
  chat: PartyChatMessage[];
  nextChat: number;
  /** steigt, wenn jemand geht: neuer Prüfwert für die Voice-Gruppe (Ehemalige hören nicht mehr mit) */
  epoch: number;
  /** zuletzt gemeldeter Ort des Leiters (Adresse) für `party-follow` */
  leaderAt: string | null;
  /** Stand der letzten `party`-Nachricht (nur bei Änderungen neu senden) */
  signature: string;
}

export interface PartyMemberView {
  uuid: string;
  name: string;
  leader: boolean;
  /** im Spiel verbunden */
  online: boolean;
  /** gar keine Verbindung (Gnadenfrist läuft bis `awayUntil`) */
  away: boolean;
  awayUntil: number | null;
  state: State | null;
  location: Location | null;
  joined: number;
}

export interface PartyInviteView {
  party: string;
  from: { uuid: string; name: string };
  leader: { uuid: string; name: string };
  members: number;
  at: number;
  expires: number;
  /** Eingeladener hat „Nicht stören“ an: Einladung still anzeigen */
  quiet: boolean;
}

export class Parties {
  private readonly parties = new Map<string, Party>();
  /** Spieler → ID seiner Party */
  private readonly memberOf = new Map<string, string>();
  /** Eingeladener → IDs der Parties mit offener Einladung */
  private readonly invitedTo = new Map<string, Set<string>>();
  /** Schlüssel für die Prüfwerte der Voice-Gruppen (nur im Arbeitsspeicher, nach einem Neustart neu) */
  private readonly secret = randomBytes(32);

  constructor(
    private readonly store: Store,
    private readonly realtime: Realtime,
    private readonly options: PartyOptions,
  ) {}

  // ---------- Abfragen ----------

  /** Mitglieder der Party von `uuid` (ohne ihn), z. B. für den Zugang zur geteilten Welt. */
  matesOf(uuid: string): Set<string> {
    const party = this.partyOfUser(uuid);
    const mates = new Set<string>(party ? party.members.keys() : []);
    mates.delete(uuid);
    return mates;
  }

  /**
   * Voice-Moderation (ab 1.13.0): Party von `uuid` mit Leiter und Mitgliedern; `inGroup`, wenn `group` (gemeldeter
   * Prüfwert der Voice-Gruppe) die Gruppe dieser Party ist. Ohne Party: null.
   */
  voiceParty(group: string | null, uuid: string): { id: string; leader: string; members: ReadonlySet<string>; inGroup: boolean } | null {
    const party = this.partyOfUser(uuid);
    if (!party) return null;
    return { id: party.id, leader: party.leader, members: new Set(party.members.keys()), inGroup: group !== null && group === this.voiceGroup(party) };
  }

  /** Anzahl Parties (Tests, Übersicht). */
  count(): number {
    return this.parties.size;
  }

  private partyOfUser(uuid: string): Party | undefined {
    const id = this.memberOf.get(uuid);
    return id === undefined ? undefined : this.parties.get(id);
  }

  private name(uuid: string): string {
    return this.store.getUser(uuid)?.name ?? '';
  }

  /** Prüfwert der Voice-Gruppe: HMAC aus Party-ID und Stand (64 Hex-Zeichen). */
  private voiceGroup(party: Party): string {
    return createHmac('sha256', this.secret).update(`heldix-party-voice\n${party.id}\n${party.epoch}`).digest('hex');
  }

  private memberView(party: Party, member: Member, user: UserRow | undefined): PartyMemberView {
    const status = this.realtime.statusOf(member.uuid);
    return {
      uuid: member.uuid,
      name: user?.name ?? '',
      leader: member.uuid === party.leader,
      online: this.realtime.isConnected(member.uuid),
      away: member.awaySince !== null,
      awayUntil: member.awaySince === null ? null : member.awaySince + this.options.graceMs,
      state: status?.state ?? null,
      location: this.options.locate(member.uuid),
      joined: member.joined,
    };
  }

  /** Stand der Party aus Sicht von `viewer` (Mitglied). */
  view(party: Party, viewer: string) {
    const users = new Map(this.store.getUsers([...party.members.keys(), ...party.invites.keys()]).map((u) => [u.uuid, u]));
    const members = [...party.members.values()].map((m) => this.memberView(party, m, users.get(m.uuid)));
    const own = members.find((m) => m.uuid === viewer)?.location ?? null;
    const together = own !== null && members.some((m) => m.uuid !== viewer && m.location?.address === own.address);
    return {
      id: party.id,
      leader: party.leader,
      created: party.created,
      max: this.options.maxMembers,
      members,
      invites: [...party.invites.values()].map((i) => ({ uuid: i.uuid, name: users.get(i.uuid)?.name ?? '', by: i.by, at: i.at, expires: i.expires })),
      target: members.find((m) => m.leader)?.location ?? null,
      voice: together ? { group: this.voiceGroup(party), server: own.address } : null,
    };
  }

  private inviteView(party: Party, invite: Invite, invitee: UserRow | undefined): PartyInviteView {
    return {
      party: party.id,
      from: { uuid: invite.by, name: this.name(invite.by) },
      leader: { uuid: party.leader, name: this.name(party.leader) },
      members: party.members.size,
      at: invite.at,
      expires: invite.expires,
      quiet: invitee?.dnd === true,
    };
  }

  /** Offene Einladungen an `uuid`, neueste zuerst. */
  invitesFor(uuid: string): PartyInviteView[] {
    const user = this.store.getUser(uuid);
    const views: PartyInviteView[] = [];
    for (const id of this.invitedTo.get(uuid) ?? []) {
      const party = this.parties.get(id);
      const invite = party?.invites.get(uuid);
      if (party && invite) views.push(this.inviteView(party, invite, user));
    }
    return views.sort((a, b) => b.at - a.at);
  }

  // ---------- Endpunkte ----------

  /** `GET /v1/party`: eigene Party (mit Chat) und offene Einladungen. */
  get(me: UserRow) {
    const party = this.partyOfUser(me.uuid);
    return { party: party ? { ...this.view(party, me.uuid), chat: party.chat } : null, invites: this.invitesFor(me.uuid) };
  }

  /** `POST /v1/party/invite` mit `{ uuid }`: Freund einladen; ohne Party entsteht eine mit dir als Leiter. */
  invite(me: UserRow, target: unknown) {
    if (typeof target !== 'string' || !/^[0-9a-f]{32}$/.test(target)) throw new HttpError(400, 'Ungültige UUID (erwartet: 32 kleine Hex-Zeichen ohne Bindestriche).');
    if (target === me.uuid) throw new HttpError(400, 'Du kannst dich nicht selbst einladen.');
    const friend = this.store.friendsSince(me.uuid, target) === undefined ? undefined : this.store.getUser(target);
    if (!friend) throw new HttpError(403, 'In die Party einladen kannst du nur Freunde.');
    let party = this.partyOfUser(me.uuid);
    if (party && party.leader !== me.uuid) throw new HttpError(403, 'Einladen kann nur der Leiter der Party.');
    if (party?.members.has(target)) throw new HttpError(409, `${friend.name} ist schon in deiner Party.`);
    if (party && party.members.size >= this.options.maxMembers) throw new HttpError(409, `Die Party ist voll (höchstens ${this.options.maxMembers}).`);
    if (party && this.blockedWithMembers(party, target)) throw new HttpError(409, `${friend.name} kann dieser Party gerade nicht beitreten.`);
    if (party && !party.invites.has(target) && party.invites.size >= MAX_PARTY_INVITES) {
      throw new HttpError(409, `Höchstens ${MAX_PARTY_INVITES} offene Einladungen. Warte, bis welche angenommen oder abgelehnt sind.`);
    }
    party ??= this.create(me.uuid);
    const now = Date.now();
    let invite = party.invites.get(target);
    const fresh = invite === undefined;
    if (!invite) {
      invite = { uuid: target, by: me.uuid, at: now, expires: now + this.options.inviteTtlMs, lastSent: 0 };
      party.invites.set(target, invite);
      let set = this.invitedTo.get(target);
      if (!set) {
        set = new Set();
        this.invitedTo.set(target, set);
      }
      set.add(party.id);
    } else {
      invite.by = me.uuid;
      invite.expires = now + this.options.inviteTtlMs;
    }
    this.armInvite(party, invite);
    // Eine erneute Einladung meldet der Dienst höchstens einmal pro Minute (kein Spam an Toasts).
    if (fresh || now - invite.lastSent >= REINVITE_MS) {
      invite.lastSent = now;
      this.realtime.send(target, { type: 'party-invite', invite: this.inviteView(party, invite, friend), invites: this.invitesFor(target) });
    } else {
      this.sendInvites(target);
    }
    this.push(party, true);
    return { party: this.view(party, me.uuid) };
  }

  /** `DELETE /v1/party/invites/<uuid>` (Leiter): Einladung zurückziehen. */
  cancelInvite(me: UserRow, target: string) {
    const party = this.requireParty(me);
    if (party.leader !== me.uuid) throw new HttpError(403, ONLY_LEADER);
    if (party.invites.has(target)) {
      this.dropInvite(party, target);
      if (!this.dissolveIfLonely(party)) this.push(party, true);
    }
    const still = this.parties.get(party.id);
    return { party: still ? this.view(still, me.uuid) : null };
  }

  /** `POST /v1/party/<id>/accept`: Einladung annehmen; eine andere Party verlässt man dabei. */
  accept(me: UserRow, partyId: string) {
    const party = this.parties.get(partyId);
    const invite = party?.invites.get(me.uuid);
    if (!party || !invite || invite.expires <= Date.now()) throw new HttpError(404, INVITE_GONE);
    // Wer eingeladen hat, muss noch dabei und befreundet sein.
    if (!party.members.has(invite.by) || this.store.friendsSince(invite.by, me.uuid) === undefined) {
      this.dropInvite(party, me.uuid);
      if (!this.dissolveIfLonely(party)) this.push(party, true);
      throw new HttpError(404, INVITE_GONE);
    }
    if (party.members.size >= this.options.maxMembers) throw new HttpError(409, `Die Party ist voll (höchstens ${this.options.maxMembers}).`);
    if (this.blockedWithMembers(party, me.uuid)) throw new HttpError(409, 'Du kannst dieser Party gerade nicht beitreten.');
    const current = this.partyOfUser(me.uuid);
    if (current && current !== party) this.removeMember(current, me.uuid, 'left');
    this.dropInvite(party, me.uuid);
    const member: Member = { uuid: me.uuid, joined: Date.now(), awaySince: null };
    party.members.set(me.uuid, member);
    this.memberOf.set(me.uuid, party.id);
    if (!this.realtime.hasConnection(me.uuid)) this.startGrace(party, member);
    this.push(party, true);
    return { party: this.view(party, me.uuid) };
  }

  /** `POST /v1/party/<id>/decline`: Einladung ablehnen (der Leiter sieht, dass sie weg ist). */
  decline(me: UserRow, partyId: string) {
    const party = this.parties.get(partyId);
    if (party?.invites.has(me.uuid)) {
      this.dropInvite(party, me.uuid);
      if (!this.dissolveIfLonely(party)) this.push(party, true);
    }
    return { invites: this.invitesFor(me.uuid) };
  }

  /** `POST /v1/party/leave`: Party verlassen. Geht der Leiter, übernimmt das Mitglied, das am längsten dabei ist. */
  leave(me: UserRow) {
    const party = this.requireParty(me);
    this.removeMember(party, me.uuid, 'left');
    return { party: null };
  }

  /** `DELETE /v1/party/members/<uuid>` (Leiter): Mitglied entfernen. */
  kick(me: UserRow, target: string) {
    const party = this.requireParty(me);
    if (party.leader !== me.uuid) throw new HttpError(403, ONLY_LEADER);
    if (target === me.uuid) throw new HttpError(400, 'Zum Gehen „Party verlassen“ nehmen.');
    if (!party.members.has(target)) throw new HttpError(404, 'Dieser Spieler ist nicht in deiner Party.');
    this.removeMember(party, target, 'removed');
    const still = this.parties.get(party.id);
    return { party: still ? this.view(still, me.uuid) : null };
  }

  /** `POST /v1/party/leader` mit `{ uuid }` (Leiter): Leitung übergeben. */
  transfer(me: UserRow, target: unknown) {
    const party = this.requireParty(me);
    if (party.leader !== me.uuid) throw new HttpError(403, ONLY_LEADER);
    if (typeof target !== 'string' || !party.members.has(target)) throw new HttpError(404, 'Dieser Spieler ist nicht in deiner Party.');
    if (target !== me.uuid) {
      party.leader = target;
      party.leaderAt = this.options.locate(target)?.address ?? null;
      this.push(party, true);
    }
    return { party: this.view(party, me.uuid) };
  }

  /** `POST /v1/party/chat` mit `{ text }`: an alle Mitglieder (nur im Speicher, die letzten 50). */
  chat(me: UserRow, input: unknown) {
    const party = this.requireParty(me);
    const checked = checkText(input, 500, false);
    if ('problem' in checked) {
      throw new HttpError(
        400,
        checked.problem === 'empty'
          ? 'Die Nachricht ist leer.'
          : checked.problem === 'long'
            ? 'Die Nachricht ist zu lang (höchstens 500 Zeichen).'
            : checked.problem === 'chars'
              ? 'Die Nachricht enthält Zeichen, die nicht erlaubt sind (z. B. Zeilenumbrüche).'
              : '„text“ muss ein Text sein.',
      );
    }
    const rate = this.options.chatLimiter.take(me.uuid);
    if (!rate.ok) throw new HttpError(429, 'Zu viele Nachrichten. Warte kurz.', { 'Retry-After': String(rate.retryAfter) });
    const message: PartyChatMessage = { id: ++party.nextChat, from: me.uuid, name: me.name, text: checked.text, at: Date.now() };
    party.chat.push(message);
    if (party.chat.length > PARTY_CHAT_KEEP) party.chat.splice(0, party.chat.length - PARTY_CHAT_KEEP);
    for (const uuid of party.members.keys()) this.realtime.send(uuid, { type: 'party-chat', party: party.id, message });
    return { message };
  }

  // ---------- Ereignisse von außen ----------

  /** Status, Server oder geöffnete Welt eines Spielers geändert: Ort neu, Leiter → `party-follow`. */
  changed(uuid: string): void {
    const party = this.partyOfUser(uuid);
    if (!party) return;
    if (uuid === party.leader) {
      const location = this.options.locate(uuid);
      const address = location?.address ?? null;
      if (address !== party.leaderAt) {
        party.leaderAt = address;
        if (location) {
          const leader = { uuid, name: this.name(uuid) };
          for (const other of party.members.keys()) {
            if (other === uuid || this.options.locate(other)?.address === address) continue;
            this.realtime.send(other, { type: 'party-follow', party: party.id, leader, target: location });
          }
        }
      }
    }
    this.push(party, false);
  }

  /** Erste Verbindung bzw. letzte zu: Gnadenfrist starten oder beenden. */
  connection(uuid: string, connected: boolean): void {
    const party = this.partyOfUser(uuid);
    const member = party?.members.get(uuid);
    if (!party || !member) {
      // Eingeladene bekommen ihre Einladungen beim Verbinden.
      if (connected && this.invitedTo.has(uuid)) this.sendInvites(uuid);
      return;
    }
    if (connected) {
      if (member.timer) clearTimeout(member.timer);
      member.timer = undefined;
      member.awaySince = null;
      this.push(party, true);
      if (this.invitedTo.has(uuid)) this.sendInvites(uuid);
    } else {
      this.startGrace(party, member);
      this.push(party, false);
    }
  }

  /** Konto gelöscht oder gesperrt: aus Party und Einladungen nehmen. */
  forgetUser(uuid: string): void {
    const party = this.partyOfUser(uuid);
    if (party) this.removeMember(party, uuid, 'left');
    for (const id of [...(this.invitedTo.get(uuid) ?? [])]) {
      const invited = this.parties.get(id);
      if (invited) {
        this.dropInvite(invited, uuid);
        if (!this.dissolveIfLonely(invited)) this.push(invited, true);
      }
    }
  }

  /** `blocker` hat `blocked` blockiert: gemeinsame Party ohne den Blockierten, Einladungen zwischen beiden fallen weg. */
  blocked(blocker: string, blocked: string): void {
    const party = this.partyOfUser(blocker);
    if (party && party.members.has(blocked)) this.removeMember(party, blocked, 'removed');
    this.unfriended(blocker, blocked);
  }

  /** Freundschaft beendet: Einladungen zwischen beiden gelten nicht mehr. */
  unfriended(a: string, b: string): void {
    for (const [inviter, invitee] of [
      [a, b],
      [b, a],
    ] as const) {
      const party = this.partyOfUser(inviter);
      if (party && party.invites.get(invitee)?.by === inviter) {
        this.dropInvite(party, invitee);
        if (!this.dissolveIfLonely(party)) this.push(party, true);
      }
    }
  }

  /** Beim Herunterfahren: alle Zeitgeber anhalten. */
  closeAll(): void {
    for (const party of this.parties.values()) {
      for (const member of party.members.values()) if (member.timer) clearTimeout(member.timer);
      for (const invite of party.invites.values()) if (invite.timer) clearTimeout(invite.timer);
    }
    this.parties.clear();
    this.memberOf.clear();
    this.invitedTo.clear();
  }

  // ---------- Intern ----------

  private requireParty(me: UserRow): Party {
    const party = this.partyOfUser(me.uuid);
    if (!party) throw new HttpError(404, NO_PARTY);
    return party;
  }

  private create(leader: string): Party {
    const now = Date.now();
    const party: Party = {
      id: randomBytes(16).toString('hex'),
      leader,
      created: now,
      members: new Map([[leader, { uuid: leader, joined: now, awaySince: null }]]),
      invites: new Map(),
      chat: [],
      nextChat: 0,
      epoch: 0,
      leaderAt: this.options.locate(leader)?.address ?? null,
      signature: '',
    };
    this.parties.set(party.id, party);
    this.memberOf.set(leader, party.id);
    if (!this.realtime.hasConnection(leader)) this.startGrace(party, party.members.get(leader)!);
    return party;
  }

  private blockedWithMembers(party: Party, uuid: string): boolean {
    for (const member of party.members.keys()) {
      if (this.store.isBlocked(member, uuid) || this.store.isBlocked(uuid, member)) return true;
    }
    return false;
  }

  private armInvite(party: Party, invite: Invite): void {
    if (invite.timer) clearTimeout(invite.timer);
    invite.timer = setTimeout(() => {
      if (party.invites.get(invite.uuid) !== invite) return;
      this.dropInvite(party, invite.uuid);
      if (!this.dissolveIfLonely(party)) this.push(party, true);
    }, Math.max(0, invite.expires - Date.now()));
    invite.timer.unref();
  }

  /** Einladung entfernen; der Eingeladene bekommt seine neue Liste. */
  private dropInvite(party: Party, uuid: string): void {
    const invite = party.invites.get(uuid);
    if (!invite) return;
    if (invite.timer) clearTimeout(invite.timer);
    party.invites.delete(uuid);
    const set = this.invitedTo.get(uuid);
    set?.delete(party.id);
    if (set?.size === 0) this.invitedTo.delete(uuid);
    this.sendInvites(uuid);
  }

  private sendInvites(uuid: string): void {
    this.realtime.send(uuid, { type: 'party-invite', invite: null, invites: this.invitesFor(uuid) });
  }

  private startGrace(party: Party, member: Member): void {
    if (member.timer) clearTimeout(member.timer);
    member.awaySince = Date.now();
    member.timer = setTimeout(() => {
      if (party.members.get(member.uuid) === member && !this.realtime.hasConnection(member.uuid)) this.removeMember(party, member.uuid, 'left');
    }, this.options.graceMs);
    member.timer.unref();
  }

  /**
   * Mitglied entfernen (`left`: gegangen oder Gnadenfrist vorbei, `removed`: vom Leiter entfernt bzw. blockiert). Neuer
   * Prüfwert für die Voice-Gruppe. Bleibt nur einer ohne offene Einladung übrig (oder keiner), löst sich die Party auf.
   */
  private removeMember(party: Party, uuid: string, reason: 'left' | 'removed'): void {
    const member = party.members.get(uuid);
    if (!member) return;
    if (member.timer) clearTimeout(member.timer);
    party.members.delete(uuid);
    this.memberOf.delete(uuid);
    party.epoch++;
    // Wer selbst eingeladen hat und geht, dessen Einladungen gelten nicht mehr.
    for (const invite of [...party.invites.values()]) if (invite.by === uuid) this.dropInvite(party, invite.uuid);
    this.realtime.send(uuid, { type: 'party', party: null, reason });
    if (party.leader === uuid) {
      const next = party.members.keys().next();
      if (!next.done) {
        party.leader = next.value;
        party.leaderAt = this.options.locate(next.value)?.address ?? null;
      }
    }
    if (!this.dissolveIfLonely(party)) this.push(party, true);
  }

  /** Keiner oder nur noch einer ohne offene Einladung: Party auflösen. Liefert true, wenn aufgelöst. */
  private dissolveIfLonely(party: Party): boolean {
    if (!this.parties.has(party.id)) return true;
    if (party.members.size > 1 || (party.members.size === 1 && party.invites.size > 0)) return false;
    this.parties.delete(party.id);
    for (const uuid of [...party.invites.keys()]) this.dropInvite(party, uuid);
    for (const member of party.members.values()) {
      if (member.timer) clearTimeout(member.timer);
      this.memberOf.delete(member.uuid);
      this.realtime.send(member.uuid, { type: 'party', party: null, reason: 'dissolved' });
    }
    party.members.clear();
    return true;
  }

  /** `party` an alle Mitglieder (je mit eigener Sicht); ohne `force` nur, wenn sich etwas geändert hat. */
  private push(party: Party, force: boolean): void {
    if (!this.parties.has(party.id)) return;
    const base = this.view(party, party.leader);
    const signature = JSON.stringify([base.leader, base.members, base.invites, party.epoch]);
    if (!force && signature === party.signature) return;
    party.signature = signature;
    for (const uuid of party.members.keys()) this.realtime.send(uuid, { type: 'party', party: this.view(party, uuid) });
  }
}
