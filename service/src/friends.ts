// Freundesliste, Anfragen und die Sicht auf Freunde (Friend-Objekte der Schnittstelle).
import type { Store, UserRow } from './db';
import type { Realtime } from './realtime';
import { HttpError } from './http';
import type { State } from './validate';

/** Was Freunde über den Online-Status eines Spielers sehen. */
export interface Presence {
  online: boolean;
  state: State | null;
  server: string | null;
}

export interface PresenceSource {
  presenceOf(user: UserRow): Presence;
}

export interface Friend {
  uuid: string;
  name: string;
  online: boolean;
  state: State | null;
  server: string | null;
  since: number;
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

export function friendView(user: UserRow, since: number, presence: Presence): Friend {
  return {
    uuid: user.uuid,
    name: user.name,
    online: presence.online,
    state: presence.state,
    server: presence.server,
    since,
  };
}

/** Inhalt von `GET /v1/friends` (und der `friends`-Nachricht) für `uuid`. */
export function friendsPayload(store: Store, presence: PresenceSource, uuid: string): FriendsPayload {
  return {
    friends: store.listFriends(uuid).map(({ user, since }) => friendView(user, since, presence.presenceOf(user))),
    incoming: store.listIncoming(uuid),
    outgoing: store.listOutgoing(uuid),
    unread: store.unreadCounts(uuid),
  };
}

export class Friends {
  constructor(
    private readonly store: Store,
    private readonly realtime: Realtime,
    private readonly limits: FriendLimits,
  ) {}

  list(uuid: string): FriendsPayload {
    return friendsPayload(this.store, this.realtime, uuid);
  }

  /** `POST /v1/friends/requests` mit `{ name }`. */
  request(me: UserRow, name: string): FriendsPayload {
    const target = this.store.findUserByName(name);
    // Hat der andere mich blockiert, sieht es aus wie ein unbekannter Name.
    if (!target || this.store.isBlocked(target.uuid, me.uuid)) throw new HttpError(404, UNKNOWN_PLAYER);
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
    this.realtime.send(requester.uuid, {
      type: 'accepted',
      friend: friendView(accepter, since, this.realtime.presenceOf(accepter)),
    });
    this.realtime.pushFriends(requester.uuid);
    this.realtime.pushFriends(accepter.uuid);
  }
}
