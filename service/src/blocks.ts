// Blockieren: Wer blockiert ist, verliert Freundschaft, Anfragen und Unterhaltung und kann keine neue Anfrage schicken.
import type { BlockRow, Store, UserRow } from './db';
import { UNKNOWN_PLAYER } from './friends';
import { HttpError } from './http';
import type { Realtime } from './realtime';
import { isName, isUuid } from './validate';

export interface BlocksPayload {
  blocked: BlockRow[];
}

export class Blocks {
  constructor(
    private readonly store: Store,
    private readonly realtime: Realtime,
    private readonly maxBlocks: number,
  ) {}

  /** `GET /v1/blocks`: neueste zuerst. */
  list(uuid: string): BlocksPayload {
    return { blocked: this.store.listBlocks(uuid) };
  }

  /** `POST /v1/blocks` mit `{ uuid }` oder `{ name }`. */
  block(me: UserRow, input: Record<string, unknown>): BlocksPayload {
    let target: UserRow | undefined;
    if (Object.hasOwn(input, 'uuid')) {
      if (!isUuid(input.uuid)) throw new HttpError(400, 'Ungültige UUID (erwartet: 32 kleine Hex-Zeichen ohne Bindestriche).');
      target = this.store.getUser(input.uuid);
    } else if (Object.hasOwn(input, 'name')) {
      if (!isName(input.name)) throw new HttpError(400, 'Ungültiger Spielername.');
      target = this.store.findUserByName(input.name);
    } else {
      throw new HttpError(400, 'Bitte „uuid“ oder „name“ angeben.');
    }
    if (!target) throw new HttpError(404, UNKNOWN_PLAYER);
    if (target.uuid === me.uuid) throw new HttpError(400, 'Du kannst dich nicht selbst blockieren.');
    // Schon blockiert: nichts zu tun.
    if (this.store.isBlocked(me.uuid, target.uuid)) return this.list(me.uuid);
    if (this.store.countBlocks(me.uuid) >= this.maxBlocks) {
      throw new HttpError(409, `Du hast schon ${this.maxBlocks} Spieler blockiert. Gib zuerst welche frei.`);
    }
    if (this.store.block(me.uuid, target.uuid, Date.now())) {
      // Freundschaft oder Anfragen sind weg: beide Seiten sehen die neue Liste sofort.
      this.realtime.pushFriends(target.uuid);
      this.realtime.pushFriends(me.uuid);
    }
    return this.list(me.uuid);
  }

  /** `DELETE /v1/blocks/<uuid>`: wieder freigeben. Freundschaft und Nachrichten kommen nicht zurück. */
  unblock(me: UserRow, otherUuid: string): BlocksPayload {
    this.store.unblock(me.uuid, otherUuid);
    return this.list(me.uuid);
  }
}
