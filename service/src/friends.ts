// Freundesliste, Anfragen und die Sicht auf Freunde (Friend-Objekte der Schnittstelle). Ab 1.12.0 (Freunde 2.0) dazu
// Favorit, Spitzname und Notiz je Freundschaft (nur für einen selbst), Statustext, „Nicht stören“, „zuletzt online“,
// Abzeichen, die Profilkarte und Vorschläge „Freunde von Freunden“.
import type { FriendshipExtras, FriendshipPatch, Store, UserRow } from './db';
import type { Realtime } from './realtime';
import { HttpError } from './http';
import type { PlayerBadge } from './roles';
import { checkText, type State } from './validate';

/** Was Freunde über den Online-Status eines Spielers sehen. */
export interface Presence {
  online: boolean;
  /** Ab 1.14.0: nicht im Spiel, aber im Launcher (bekommt Nachrichten sofort); nur mit sichtbarem Online-Status */
  launcher: boolean;
  state: State | null;
  server: string | null;
  /** Statustext (immer, auch offline) oder null */
  statusText: string | null;
  /** „Nicht stören“ (nur, solange online) */
  dnd: boolean;
  /** gerundeter Zeitpunkt, nur offline, mit presence und showLastOnline */
  lastOnline: number | null;
}

export interface PresenceSource {
  presenceOf(user: UserRow): Presence;
  badgesOf(uuids: readonly string[]): Map<string, Exclude<PlayerBadge, null>>;
}

export interface Friend {
  uuid: string;
  name: string;
  online: boolean;
  /** Ab 1.14.0: „Im Launcher“ (kein Spiel, mindestens ein Launcher verbunden) */
  launcher: boolean;
  state: State | null;
  server: string | null;
  since: number;
  favorite: boolean;
  nickname: string | null;
  note: string | null;
  statusText: string | null;
  dnd: boolean;
  lastOnline: number | null;
  badge: PlayerBadge;
}

export interface FriendRequest {
  uuid: string;
  name: string;
  at: number;
}

export interface FriendsPayload {
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  /** Ungelesene Nachrichten pro Freund (nur Freunde mit mindestens einer). */
  unread: Record<string, number>;
}

export interface FriendLimits {
  maxFriends: number;
  maxOutgoing: number;
}

/** Text für unbekannte Namen. Wer blockiert wurde, bekommt genau denselben (die Blockierung bleibt verborgen). */
export const UNKNOWN_PLAYER = 'Dieser Spieler nutzt HeldixClient nicht (oder war noch nie online).';
export const NOT_A_FRIEND = 'Dieser Spieler ist nicht in deiner Freundesliste.';
/** Spitzname und Notiz je Freundschaft (Unicode-Zeichen). */
export const MAX_NICKNAME = 24;
export const MAX_NOTE = 200;
/** Höchstens so viele Vorschläge. */
export const MAX_SUGGESTIONS = 20;

/** Beziehung aus Sicht des Betrachters: seit wann, eigene Angaben. */
export type FriendRelation = FriendshipExtras & { since: number };

const NO_EXTRAS: FriendshipExtras = Object.freeze({ favorite: false, nickname: '', note: '' });

export function friendView(user: UserRow, relation: FriendRelation | number, presence: Presence, badge: PlayerBadge): Friend {
  const rel = typeof relation === 'number' ? { since: relation, ...NO_EXTRAS } : relation;
  return {
    uuid: user.uuid,
    name: user.name,
    online: presence.online,
    launcher: presence.launcher,
    state: presence.state,
    server: presence.server,
    since: rel.since,
    favorite: rel.favorite,
    nickname: rel.nickname === '' ? null : rel.nickname,
    note: rel.note === '' ? null : rel.note,
    statusText: presence.statusText,
    dnd: presence.dnd,
    lastOnline: presence.lastOnline,
    badge,
  };
}

/** Inhalt von `GET /v1/friends` (und der `friends`-Nachricht) für `uuid`. */
export function friendsPayload(store: Store, presence: PresenceSource, uuid: string): FriendsPayload {
  const rows = store.listFriends(uuid);
  const badges = presence.badgesOf(rows.map((row) => row.user.uuid));
  return {
    friends: rows.map((row) => friendView(row.user, row, presence.presenceOf(row.user), badges.get(row.user.uuid) ?? null)),
    incoming: store.listIncoming(uuid),
    outgoing: store.listOutgoing(uuid),
    unread: store.unreadCounts(uuid),
  };
}

/** Was die Profilkarte über das Aussehen zeigt (wie beim Nachschlagen), oder null bei `visible` aus. */
export type LookSource = (user: UserRow) => { cape: string; cosmetics: Record<string, string | null> } | null;

export class Friends {
  constructor(
    private readonly store: Store,
    private readonly realtime: Realtime,
    private readonly limits: FriendLimits,
    private readonly look: LookSource = () => null,
  ) {}

  list(uuid: string): FriendsPayload {
    return friendsPayload(this.store, this.realtime, uuid);
  }

  /** `POST /v1/friends/requests` mit `{ name }`. */
  request(me: UserRow, name: string): FriendsPayload {
    const target = this.store.findUserByName(name);
    // Hat der andere mich blockiert, sieht es aus wie ein unbekannter Name.
    if (!target || this.store.isBlocked(target.uuid, me.uuid)) throw new HttpError(404, UNKNOWN_PLAYER);
    return this.requestUser(me, target);
  }

  /** Anfrage an einen bekannten Spieler (Name oder Vorschlag). */
  private requestUser(me: UserRow, target: UserRow): FriendsPayload {
    if (target.uuid === me.uuid) throw new HttpError(400, 'Du kannst dir nicht selbst eine Freundschaftsanfrage schicken.');
    if (this.store.isBlocked(me.uuid, target.uuid)) {
      throw new HttpError(409, 'Du hast diesen Spieler blockiert. Gib ihn zuerst frei.');
    }
    if (this.store.friendsSince(me.uuid, target.uuid) !== undefined) {
      throw new HttpError(409, `Du bist schon mit ${target.name} befreundet.`);
    }
    // Anfrage in die Gegenrichtung: beide werden sofort Freunde.
    if (this.store.hasRequest(target.uuid, me.uuid)) {
      this.acceptRequest(me, target);
      return this.list(me.uuid);
    }
    // Schon angefragt: nichts zu tun.
    if (this.store.hasRequest(me.uuid, target.uuid)) return this.list(me.uuid);

    if (this.store.countFriends(me.uuid) >= this.limits.maxFriends) {
      throw new HttpError(409, `Du hast schon ${this.limits.maxFriends} Freunde. Mehr gehen nicht.`);
    }
    if (this.store.countOutgoing(me.uuid) >= this.limits.maxOutgoing) {
      throw new HttpError(
        409,
        `Du hast schon ${this.limits.maxOutgoing} offene Anfragen. Warte, bis welche angenommen werden, oder ziehe welche zurück.`,
      );
    }
    this.store.addRequest(me.uuid, target.uuid, Date.now());
    this.realtime.send(target.uuid, { type: 'request', from: { uuid: me.uuid, name: me.name } });
    this.realtime.pushFriends(target.uuid);
    this.realtime.pushFriends(me.uuid);
    return this.list(me.uuid);
  }

  /** `POST /v1/friends/requests/<uuid>/accept`: Anfrage von `otherUuid` annehmen. */
  accept(me: UserRow, otherUuid: string): FriendsPayload {
    const other = this.store.hasRequest(otherUuid, me.uuid) ? this.store.getUser(otherUuid) : undefined;
    if (!other) throw new HttpError(404, 'Diese Anfrage gibt es nicht mehr.');
    this.acceptRequest(me, other);
    return this.list(me.uuid);
  }

  /** `DELETE /v1/friends/requests/<uuid>`: ablehnen oder eigene Anfrage zurückziehen. */
  removeRequest(me: UserRow, otherUuid: string): FriendsPayload {
    const changed = this.store.transaction(() => {
      const declined = this.store.removeRequest(otherUuid, me.uuid);
      const withdrawn = this.store.removeRequest(me.uuid, otherUuid);
      return declined || withdrawn;
    });
    if (changed) {
      this.realtime.pushFriends(otherUuid);
      this.realtime.pushFriends(me.uuid);
    }
    return this.list(me.uuid);
  }

  /** `DELETE /v1/friends/<uuid>`: Freundschaft beenden (die Unterhaltung wird mit gelöscht). */
  removeFriend(me: UserRow, otherUuid: string): FriendsPayload {
    if (this.store.removeFriendship(me.uuid, otherUuid)) {
      this.realtime.pushFriends(otherUuid);
      this.realtime.pushFriends(me.uuid);
    }
    return this.list(me.uuid);
  }

  /**
   * `PATCH /v1/friends/<uuid>` mit einem Teil von `{ favorite, nickname, note }`: eigene Angaben zu einem Freund. Der
   * Freund erfährt davon nichts; die eigenen anderen Verbindungen bekommen `friend`.
   */
  update(me: UserRow, friendUuid: string, input: Record<string, unknown>): { friend: Friend } {
    const friend = this.store.friendsSince(me.uuid, friendUuid) === undefined ? undefined : this.store.getUser(friendUuid);
    if (!friend) throw new HttpError(404, NOT_A_FRIEND);
    const patch: FriendshipPatch = {};
    if (Object.hasOwn(input, 'favorite')) {
      if (typeof input.favorite !== 'boolean') throw new HttpError(400, '„favorite“ muss true oder false sein.');
      patch.favorite = input.favorite;
    }
    for (const [key, max, label] of [
      ['nickname', MAX_NICKNAME, 'Der Spitzname'],
      ['note', MAX_NOTE, 'Die Notiz'],
    ] as const) {
      if (!Object.hasOwn(input, key)) continue;
      const value = input[key] === null ? '' : input[key];
      const checked = checkText(value, max, true);
      if ('problem' in checked) {
        throw new HttpError(
          400,
          checked.problem === 'long'
            ? `${label} ist zu lang (höchstens ${max} Zeichen).`
            : checked.problem === 'chars'
              ? `${label} enthält Zeichen, die nicht erlaubt sind (z. B. Zeilenumbrüche).`
              : `„${key}“ muss ein Text oder null sein.`,
        );
      }
      patch[key] = checked.text;
    }
    this.store.updateFriendship(me.uuid, friendUuid, patch);
    const relation = this.store.friendship(me.uuid, friendUuid)!;
    const badge = this.realtime.badgesOf([friend.uuid]).get(friend.uuid) ?? null;
    const view = friendView(friend, relation, this.realtime.presenceOf(friend), badge);
    this.realtime.send(me.uuid, { type: 'friend', friend: view });
    return { friend: view };
  }

  /**
   * `GET /v1/friends/<uuid>/profile`: Profilkarte eines Freundes (sonst 404): wie in der Freundesliste, dazu gemeinsame
   * Freunde (nur die gemeinsamen) und das Aussehen wie beim Nachschlagen (bei `visible` aus: kein Cape, keine Cosmetics).
   */
  profile(me: UserRow, friendUuid: string) {
    const relation = this.store.friendship(me.uuid, friendUuid);
    const friend = relation === undefined ? undefined : this.store.getUser(friendUuid);
    if (!relation || !friend) throw new HttpError(404, NOT_A_FRIEND);
    const badge = this.realtime.badgesOf([friend.uuid]).get(friend.uuid) ?? null;
    const look = this.look(friend);
    return {
      friend: friendView(friend, relation, this.realtime.presenceOf(friend), badge),
      mutual: this.store.mutualFriends(me.uuid, friend.uuid),
      cape: look?.cape ?? '',
      cosmetics: look?.cosmetics ?? { head: null, back: null, aura: null, companion: null },
    };
  }

  /**
   * `GET /v1/friends/suggestions`: Freunde von Freunden, die „In Vorschlägen erscheinen“ eingeschaltet haben (Standard
   * aus). Nur die Zahl gemeinsamer Freunde, nicht wer (das verriete fremde Freundschaften). Mit „Vorschläge zeigen“ aus:
   * leer und `enabled: false`.
   */
  suggestions(me: UserRow) {
    if (!me.showSuggestions) return { enabled: false, suggestions: [] };
    return { enabled: true, suggestions: this.store.suggestions(me.uuid, MAX_SUGGESTIONS) };
  }

  /** `POST /v1/friends/suggestions/<uuid>/request`: Anfrage an einen Vorschlag (geht auch ohne Namen). */
  requestSuggestion(me: UserRow, uuid: string): FriendsPayload {
    if (!me.showSuggestions || !this.store.suggestions(me.uuid, 1000).some((s) => s.uuid === uuid)) {
      throw new HttpError(404, 'Diesen Vorschlag gibt es nicht (mehr).');
    }
    return this.requestUser(me, this.store.getUser(uuid)!);
  }

  /** `accepter` nimmt die Anfrage von `requester` an. */
  private acceptRequest(accepter: UserRow, requester: UserRow): void {
    const { maxFriends } = this.limits;
    if (this.store.countFriends(accepter.uuid) >= maxFriends) {
      throw new HttpError(409, `Du hast schon ${maxFriends} Freunde. Mehr gehen nicht.`);
    }
    if (this.store.countFriends(requester.uuid) >= maxFriends) {
      throw new HttpError(409, `${requester.name} hat schon ${maxFriends} Freunde.`);
    }
    const since = Date.now();
    this.store.befriend(accepter.uuid, requester.uuid, since);
    const badge = this.realtime.badgesOf([accepter.uuid]).get(accepter.uuid) ?? null;
    this.realtime.send(requester.uuid, {
      type: 'accepted',
      friend: friendView(accepter, since, this.realtime.presenceOf(accepter), badge),
    });
    this.realtime.pushFriends(requester.uuid);
    this.realtime.pushFriends(accepter.uuid);
  }
}
