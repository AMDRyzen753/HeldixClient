// Einladungen: Links mit Code (auf Wunsch mit Server und Voice-Gruppe), Annehmen (Freundschaft und Willkommens-Belohnung),
// Belohnungen für Einladende, sobald Eingeladene 30 Minuten im Spiel waren, und Gast-Sitzungen für den Voice Chat im
// Browser. Gast-Sitzungen liegen nur im Arbeitsspeicher; von der Spielzeit speichert der Dienst nur die Summe, und nur bis
// zur Bestätigung. Codes, Tokens und Namen von Gästen stehen in keinem Log.
import { randomBytes, randomInt } from 'node:crypto';
import { hashToken } from './auth';
import type { InviteRow, Store, UserRow } from './db';
import { HttpError } from './http';
import type { RateLimiter } from './limits';
import type { Realtime } from './realtime';
import { isInviteCode, normalizeServer } from './validate';
import { VOICE_MAX_GUESTS, type Voice } from './voice';
import { VOICE_RULES_REQUIRED } from './voice-moderation';
import { newSecret } from './web';

/** Zeichen der Codes: a–z und 2–9 ohne i, l, o, 0 und 1. */
export const INVITE_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const INVITE_CODE_LENGTH = 10;
/** Belohnungen für Einladende: ab so vielen bestätigten Freunden (über die eigenen Links neu dazugekommen). */
export const INVITE_REWARDS: readonly { cosmetic: string; friends: number }[] = Object.freeze([
  { cosmetic: 'freundesfunken', friends: 1 },
  { cosmetic: 'freundesband', friends: 3 },
]);
/** Belohnung für neue Spieler, sofort beim Annehmen einer Einladung. */
export const WELCOME_REWARD = 'freundesfunken';
/** So lange gilt eine Einladung ohne bzw. mit Voice-Gruppe. */
export const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const VOICE_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
/** „Neu“: Konto beim Dienst höchstens so alt. */
export const NEW_ACCOUNT_MS = 14 * 24 * 60 * 60 * 1000;
/** Höchstens so viele offene Einladungen je Spieler; darüber fallen die ältesten ohne Annahmen weg. */
export const MAX_OPEN_INVITES = 50;
/** Eine Gast-Sitzung gilt höchstens so lange (und nie länger als die Einladung). */
export const GUEST_TTL_MS = 6 * 60 * 60 * 1000;
/** Launcher-Link: `heldixclient://einladung/<code>`. */
export const APP_URL_PREFIX = 'heldixclient://einladung/';
/** Höchstens so viele Gast-Sitzungen je Einladung bzw. insgesamt; darüber fallen die ältesten (nicht verbundenen) weg. */
const MAX_GUEST_SESSIONS_PER_INVITE = 20;
const MAX_GUEST_SESSIONS = 10_000;
/** Gast-Token wie Cookie-Werte: 32 Zufallsbytes als base64url. */
const GUEST_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
/** Gastname: 3–16 Zeichen aus Buchstaben (auch Umlaute und ß), Ziffern, Leerzeichen, `_`, `.` und `-`. */
const GUEST_NAME_RE = /^[A-Za-z0-9ÄÖÜäöüß _.-]{3,16}$/;
const GROUP_RE = /^[0-9a-f]{64}$/;

export const INVITE_GONE = 'Diese Einladung gibt es nicht (mehr). Vielleicht ist sie abgelaufen oder wurde zurückgezogen.';
export const OWN_INVITE = 'Das ist deine eigene Einladung. Schick den Link an Freunde, die HeldixClient noch nicht haben.';
export const NO_VOICE_INVITE = 'Diese Einladung gibt es nicht (mehr), oder sie lädt nicht in den Voice Chat ein.';
export const GUEST_NAME_INVALID = 'Der Name muss 3 bis 16 Zeichen lang sein: Buchstaben, Ziffern, Leerzeichen, _ . und -.';
export const VOICE_OFF = 'Der Voice Chat ist auf diesem Server aus.';
export const GUESTS_FULL = `Die Gruppe ist voll: Höchstens ${VOICE_MAX_GUESTS} Gäste können gleichzeitig mitreden.`;
export const GUEST_EXPIRED = 'Der Gast-Zugang ist abgelaufen. Öffne den Einladungs-Link noch einmal.';

export interface InvitesOptions {
  /** Adresse der Webseite (für den Web-Link); ohne: `url` null. */
  website: string | null;
  /** So lange muss ein Eingeladener im Spiel gewesen sein (Standard 30 Minuten). */
  confirmMs: number;
  /** Neue Einladungen pro Spieler und Tag. */
  dailyLimiter: RateLimiter;
  /** Höchstzahl der Freunde (wie bei Anfragen). */
  maxFriends: number;
  log: (line: string) => void;
  /** Ab 1.13.0: veröffentlichte Version der Voice-Regeln (null = keine); Gäste müssen sie beim Beitreten annehmen. */
  voiceRules?: () => number | null;
  /** Ab 1.13.0: Ist der Einladende vom Voice Chat gesperrt? Dann lädt seine Einladung nicht in den Voice Chat ein. */
  voiceBlocked?: (inviter: string) => boolean;
}

/** Gast-Sitzung (nur im Arbeitsspeicher). */
export interface GuestSession {
  /** 16 Zufallsbytes (32 Hex-Zeichen), im Voice Chat an der Stelle der UUID */
  id: string;
  name: string;
  /** Code der Einladung */
  invite: string;
  /** UUID des Einladenden (zum Aufräumen, wenn sein Konto gelöscht wird) */
  inviter: string;
  expiresAt: number;
  /** Beim Beitreten angenommene Version der Voice-Regeln (ab 1.13.0; null = keine veröffentlicht) */
  rulesVersion: number | null;
}

export type FriendResult = 'new' | 'already' | 'blocked' | 'limit';
export type RewardReason = 'not-new' | 'already-invited';

/** Ansicht einer Einladung für den Einladenden. */
export interface InviteView {
  code: string;
  url: string | null;
  appUrl: string;
  created: number;
  expires: number;
  server: string | null;
  voice: boolean;
  accepted: number;
}

/** Neuer Code: gleich verteilt aus dem Alphabet (crypto.randomInt). */
export function newInviteCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  return code;
}

/** Geprüfter Gastname (ohne Leerzeichen am Anfang und Ende) oder null. Mindestens ein Buchstabe oder eine Ziffer. */
export function guestName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return GUEST_NAME_RE.test(name) && /[A-Za-z0-9ÄÖÜäöüß]/.test(name) ? name : null;
}

export class Invites {
  /** Gast-Sitzungen nach Hash des Tokens (das Token selbst behält der Dienst nicht). */
  private readonly guests = new Map<string, GuestSession>();
  /** Eingeladene mit offener Bestätigung, die gerade im Spiel sind: seit wann, und der Zeitgeber bis zur Bestätigung. */
  private readonly playing = new Map<string, { since: number; timer: NodeJS.Timeout }>();

  constructor(
    private readonly store: Store,
    private readonly realtime: Realtime,
    private readonly voice: Voice | null,
    private readonly options: InvitesOptions,
  ) {}

  // ---------- Hilfen ----------

  /** Offene Einladung zum Code (gültiger Code, vorhanden, nicht abgelaufen) oder undefined. */
  private openInvite(code: unknown): InviteRow | undefined {
    if (!isInviteCode(code)) return undefined;
    const invite = this.store.getInvite(code);
    return invite && invite.expiresAt > Date.now() ? invite : undefined;
  }

  private view(invite: InviteRow): InviteView {
    return {
      code: invite.code,
      url: this.options.website === null ? null : `${this.options.website}/einladung#${invite.code}`,
      appUrl: `${APP_URL_PREFIX}${invite.code}`,
      created: invite.createdAt,
      expires: invite.expiresAt,
      server: invite.server,
      voice: invite.voiceGroup !== null,
      accepted: invite.accepted,
    };
  }

  /**
   * Offene Einladung mit genau diesem Server und dieser Gruppe wiederverwenden, solange sie noch mindestens die Hälfte
   * ihrer Laufzeit gilt; sonst eine neue anlegen (`counted`: zählt zur Grenze pro Tag). Danach höchstens 50 offene.
   */
  private obtain(inviter: string, server: string | null, voiceGroup: string | null, counted: boolean): InviteRow {
    const now = Date.now();
    const ttl = voiceGroup === null ? INVITE_TTL_MS : VOICE_INVITE_TTL_MS;
    const reusable = this.store.reusableInvite(inviter, server, voiceGroup, now + ttl / 2);
    if (reusable) return reusable;
    if (counted) {
      const rate = this.options.dailyLimiter.take(inviter);
      if (!rate.ok) {
        throw new HttpError(429, 'Höchstens 20 neue Einladungen pro Tag. Nimm einen deiner offenen Links oder versuch es morgen wieder.', {
          'Retry-After': String(rate.retryAfter),
        });
      }
    }
    let code = newInviteCode();
    // Zufällig doppelt (31^10 Möglichkeiten): einfach einen neuen ziehen.
    for (let tries = 0; this.store.getInvite(code) && tries < 5; tries++) code = newInviteCode();
    const invite = { code, inviter, createdAt: now, expiresAt: now + ttl, server, voiceGroup };
    this.store.insertInvite(invite);
    this.dropInvites(this.store.trimInvites(inviter, now, MAX_OPEN_INVITES));
    return { ...invite, accepted: 0 };
  }

  /** Gast-Sitzungen gelöschter oder widerrufener Einladungen beenden und deren Gäste trennen. */
  private dropInvites(codes: string[]): void {
    if (codes.length === 0) return;
    const set = new Set(codes);
    for (const [key, session] of this.guests) if (set.has(session.invite)) this.guests.delete(key);
    for (const code of set) this.voice?.disconnectInvite(code);
  }

  // ---------- Endpunkte (angemeldet) ----------

  /** `POST /v1/invites` mit `{ server?, voice?: { group } }`: neue oder wiederverwendete Einladung. */
  create(user: UserRow, input: Record<string, unknown>): InviteView {
    let server: string | null = null;
    if (input.server !== undefined && input.server !== null) {
      server = normalizeServer(input.server);
      if (server === null) {
        throw new HttpError(400, 'Ungültige Server-Adresse: nur öffentliche Domains wie play.example.net (keine IP-Adressen, kein localhost).');
      }
    }
    let voiceGroup: string | null = null;
    if (input.voice !== undefined && input.voice !== null) {
      const voice = input.voice as Record<string, unknown>;
      if (typeof voice !== 'object' || Array.isArray(voice) || typeof voice.group !== 'string' || !GROUP_RE.test(voice.group)) {
        throw new HttpError(400, '„voice“ muss { "group": "<Prüfwert der Gruppe, 64 Hex-Zeichen>" } sein oder null.');
      }
      if (server === null) throw new HttpError(400, 'Eine Einladung in den Voice Chat geht nur zusammen mit einem Server.');
      if (this.voice === null) throw new HttpError(503, VOICE_OFF);
      voiceGroup = voice.group;
    }
    return this.view(this.obtain(user.uuid, server, voiceGroup, true));
  }

  /** `GET /v1/invites`: allgemeiner Link (bei Bedarf neu), offene Einladungen, Zähler, Belohnungen, Freischaltungen. */
  overview(user: UserRow) {
    const link = this.view(this.obtain(user.uuid, null, null, false));
    const invites = this.store.openInvitesOf(user.uuid, Date.now()).map((invite) => this.view(invite));
    const { invited, confirmed } = this.store.referralCounts(user.uuid);
    // nur Belohnungen fürs Einladen: Launcher bis 0.14.0 melden jede neue Freischaltung hier als „Belohnung für deine
    // Einladungen“ – Partner-Belohnungen (Herkunft partner:<id>, ab 1.14.0) gehören nicht dazu
    const unlocked = this.store.unlocksOf(user.uuid).filter((u) => u.reason === 'invite').map((u) => u.cosmetic);
    return {
      link,
      invites,
      invited,
      confirmed,
      pending: invited - confirmed,
      rewards: INVITE_REWARDS.map((reward) => ({ cosmetic: reward.cosmetic, friends: reward.friends, unlocked: unlocked.includes(reward.cosmetic) })),
      unlocked,
    };
  }

  /** `DELETE /v1/invites/<code>`: eigene Einladung widerrufen; ihre Gäste fliegen sofort aus dem Voice Chat (4004). */
  revoke(user: UserRow, code: string): { ok: true } {
    if (!isInviteCode(code) || !this.store.deleteInvite(code, user.uuid)) throw new HttpError(404, INVITE_GONE);
    this.dropInvites([code]);
    return { ok: true };
  }

  /**
   * `POST /v1/invites/<code>/accept`: Freundschaft mit dem Einladenden (Grenzen und Blockieren beachtet) und, für neue
   * Spieler, die Willkommens-Belohnung. Die eigene Einladung: 400 mit `friend: 'self'`.
   */
  accept(user: UserRow, code: string) {
    const invite = this.openInvite(code);
    const inviter = invite ? this.store.getUser(invite.inviter) : undefined;
    if (!invite || !inviter) throw new HttpError(404, INVITE_GONE);
    if (inviter.uuid === user.uuid) throw new HttpError(400, OWN_INVITE, {}, 'SELF', { friend: 'self', reward: null, rewardReason: 'self' });
    const now = Date.now();
    const blocked = this.store.isBlocked(user.uuid, inviter.uuid) || this.store.isBlocked(inviter.uuid, user.uuid);

    let friend: FriendResult;
    if (blocked) friend = 'blocked';
    else if (this.store.friendsSince(user.uuid, inviter.uuid) !== undefined) friend = 'already';
    else if (this.store.countFriends(user.uuid) >= this.options.maxFriends || this.store.countFriends(inviter.uuid) >= this.options.maxFriends) {
      friend = 'limit';
    } else {
      this.store.befriend(user.uuid, inviter.uuid, now);
      friend = 'new';
    }

    // Belohnung nur für neue Spieler, die noch nie eingeladen wurden. Ist einer vom anderen blockiert, zählt der Neue für
    // niemanden (der Einladende erfährt nichts), bekommt die Willkommens-Belohnung aber trotzdem.
    let reward: string | null = null;
    let rewardReason: RewardReason | null = null;
    let welcome = { referred: false, unlockedNow: false };
    if (this.store.getReferral(user.uuid)) {
      rewardReason = 'already-invited';
    } else if (user.createdAt < now - NEW_ACCOUNT_MS) {
      rewardReason = 'not-new';
    } else {
      welcome = this.store.transaction(() => ({
        referred: this.store.insertReferral(user.uuid, blocked ? null : inviter.uuid, blocked ? null : invite.code, now) && !blocked,
        unlockedNow: this.store.addUnlock(user.uuid, WELCOME_REWARD, 'invite', now),
      }));
      reward = WELCOME_REWARD;
    }
    const { referred, unlockedNow } = welcome;
    if (friend === 'new' || referred) this.store.countInviteAccept(invite.code);

    if (friend === 'new') {
      this.realtime.pushFriends(inviter.uuid);
      this.realtime.pushFriends(user.uuid);
    }
    if (unlockedNow) this.realtime.send(user.uuid, { type: 'unlock', cosmetic: WELCOME_REWARD, reason: 'invite' });
    if (!blocked && (friend === 'new' || referred)) this.realtime.send(inviter.uuid, { type: 'invite', event: 'accepted', name: user.name });
    // Schon im Spiel (z. B. angenommen im Launcher, während das Spiel läuft): ab jetzt zählt die Zeit.
    if (referred && this.realtime.isPlaying(user.uuid)) this.track(user.uuid);
    return { inviter: { uuid: inviter.uuid, name: inviter.name }, server: invite.server, friend, reward, rewardReason };
  }

  // ---------- Öffentlich ----------

  /** `GET /v1/public/invites/<code>`: wer einlädt, wohin, und ob gerade jemand in der Voice-Gruppe ist. */
  publicInfo(code: string) {
    const invite = this.openInvite(code);
    const inviter = invite ? this.store.getUser(invite.inviter) : undefined;
    if (!invite || !inviter) throw new HttpError(404, INVITE_GONE);
    const group = this.groupOf(invite);
    return {
      code: invite.code,
      inviter: { uuid: inviter.uuid, name: inviter.name },
      server: invite.server,
      voice: group === null || this.voice === null ? null : { ...this.voice.inviteInfo(invite.code, group), maxGuests: VOICE_MAX_GUESTS },
      expires: invite.expiresAt,
      welcome: WELCOME_REWARD,
    };
  }

  /**
   * `POST /v1/public/invites/<code>/guest` mit `{ name, rulesVersion? }`: Gast-Sitzung für den Voice Chat im Browser. Ab
   * 1.13.0 muss `rulesVersion` die veröffentlichte Version der Voice-Regeln sein, wenn es eine gibt (sonst 409 `voice-rules`).
   */
  createGuest(code: string, input: Record<string, unknown>) {
    if (this.voice === null) throw new HttpError(503, VOICE_OFF);
    const invite = this.openInvite(code);
    if (!invite || this.groupOf(invite) === null) throw new HttpError(404, NO_VOICE_INVITE);
    const name = guestName(input.name);
    if (name === null) throw new HttpError(400, GUEST_NAME_INVALID);
    const rulesVersion = this.options.voiceRules?.() ?? null;
    if (rulesVersion !== null && input.rulesVersion !== rulesVersion) {
      throw new HttpError(409, VOICE_RULES_REQUIRED, {}, 'voice-rules', { version: rulesVersion });
    }
    if (this.voice.guestCount(invite.code) >= VOICE_MAX_GUESTS) throw new HttpError(409, GUESTS_FULL);
    this.trimGuests(invite.code);
    const now = Date.now();
    const token = newSecret();
    const session: GuestSession = {
      id: randomBytes(16).toString('hex'),
      name,
      invite: invite.code,
      inviter: invite.inviter,
      expiresAt: Math.min(invite.expiresAt, now + GUEST_TTL_MS),
      rulesVersion,
    };
    this.guests.set(hashToken(token), session);
    return { token, id: session.id, name, expires: session.expiresAt };
  }

  /** Platz für eine neue Gast-Sitzung: je Einladung und insgesamt die ältesten nicht verbundenen entfernen. */
  private trimGuests(invite: string): void {
    const now = Date.now();
    for (const [key, session] of this.guests) if (session.expiresAt <= now) this.guests.delete(key);
    const removeOldest = (match: (s: GuestSession) => boolean, max: number) => {
      const keys = [...this.guests].filter(([, s]) => match(s)).map(([key, s]) => ({ key, connected: this.voice?.isConnected(s.id) === true }));
      let excess = keys.length - max + 1;
      for (const pass of [false, true]) {
        for (const entry of keys) {
          if (excess <= 0) return;
          if (entry.connected !== pass || !this.guests.has(entry.key)) continue;
          this.guests.delete(entry.key);
          excess--;
        }
      }
    };
    removeOldest((s) => s.invite === invite, MAX_GUEST_SESSIONS_PER_INVITE);
    removeOldest(() => true, MAX_GUEST_SESSIONS);
  }

  // ---------- Voice Chat ----------

  private groupOf(invite: InviteRow): string | null {
    if (invite.voiceGroup === null || invite.server === null) return null;
    // Ab 1.13.0: Links eines vom Voice Chat gesperrten Spielers laden nicht in den Voice Chat ein.
    if (this.options.voiceBlocked?.(invite.inviter)) return null;
    return `${invite.server} ${invite.voiceGroup}`;
  }

  /** Gruppe einer offenen Einladung mit Voice (`<server> <prüfwert>`) oder null. */
  voiceGroupOf(code: string): string | null {
    const invite = this.openInvite(code);
    return invite ? this.groupOf(invite) : null;
  }

  /** Gast-Sitzung zum Token (gültig, nicht abgelaufen, Einladung offen) oder null. */
  guestSession(token: string): GuestSession | null {
    if (!GUEST_TOKEN_RE.test(token)) return null;
    const key = hashToken(token);
    const session = this.guests.get(key);
    if (!session) return null;
    if (session.expiresAt <= Date.now() || this.voiceGroupOf(session.invite) === null) {
      this.guests.delete(key);
      return null;
    }
    return session;
  }

  /** Gast aus der Gruppe entfernt (`kick`): Sein Token gilt nicht mehr. */
  removeGuest(id: string): void {
    for (const [key, session] of this.guests) if (session.id === id) this.guests.delete(key);
  }

  // ---------- Spielzeit bis zur Bestätigung ----------

  /** Meldung aus dem Realtime-Teil: Spieler kommt ins Spiel bzw. verlässt es. */
  onPlaying(uuid: string, playing: boolean): void {
    if (playing) this.track(uuid);
    else this.untrack(uuid, true);
  }

  /** Zeit zählen, wenn der Spieler eine offene Bestätigung hat (sonst nichts). */
  private track(uuid: string): void {
    if (this.playing.has(uuid)) return;
    const played = this.store.pendingPlayTime(uuid);
    if (played === undefined) return;
    const timer = setTimeout(() => this.onTimer(uuid), Math.max(0, this.options.confirmMs - played));
    timer.unref();
    this.playing.set(uuid, { since: Date.now(), timer });
  }

  /** Zählen beenden; mit `save` die Zeit bis jetzt dazurechnen (und bei genug Zeit bestätigen). */
  private untrack(uuid: string, save: boolean): void {
    const entry = this.playing.get(uuid);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.playing.delete(uuid);
    if (save) this.addTime(uuid, Date.now() - entry.since);
  }

  private onTimer(uuid: string): void {
    try {
      this.untrack(uuid, true);
      // Noch nicht ganz genug (Uhr knapp daneben): weiterzählen.
      if (this.realtime.isPlaying(uuid)) this.track(uuid);
    } catch (err) {
      this.options.log(`Fehler beim Bestätigen einer Einladung: ${(err as Error).message}`);
    }
  }

  /** Zeit dazurechnen; true, wenn die Einladung damit bestätigt ist (oder schon nicht mehr offen). */
  private addTime(uuid: string, ms: number): boolean {
    const total = this.store.addPlayTime(uuid, ms);
    if (total === undefined) return true;
    if (total < this.options.confirmMs) return false;
    this.confirm(uuid);
    return true;
  }

  /** Bestätigt: Der Einladende erfährt es und bekommt erreichte Belohnungen. */
  private confirm(invitee: string): void {
    const referral = this.store.getReferral(invitee);
    if (!referral || referral.inviter === null || !this.store.confirmReferral(invitee, Date.now())) return;
    this.realtime.send(referral.inviter, { type: 'invite', event: 'confirmed', name: this.store.getUser(invitee)?.name ?? '' });
    this.grantRewards(referral.inviter);
  }

  /** Alle Belohnungen freischalten, die der Einladende mit seinen bestätigten Freunden erreicht hat. */
  private grantRewards(inviter: string): void {
    const { confirmed } = this.store.referralCounts(inviter);
    const now = Date.now();
    for (const reward of INVITE_REWARDS) {
      if (confirmed >= reward.friends && this.store.addUnlock(inviter, reward.cosmetic, 'invite', now)) {
        this.realtime.send(inviter, { type: 'unlock', cosmetic: reward.cosmetic, reason: 'invite' });
      }
    }
  }

  /** Gezählte Zeit speichern, ohne das Zählen zu beenden (Aufräumen, Datenauskunft, Herunterfahren). */
  flush(only?: string): void {
    const now = Date.now();
    for (const [uuid, entry] of [...this.playing]) {
      if (only !== undefined && uuid !== only) continue;
      const ms = now - entry.since;
      entry.since = now;
      if (this.addTime(uuid, ms)) this.untrack(uuid, false);
    }
  }

  // ---------- Aufräumen ----------

  /** Konto gelöscht oder gesperrt (die Zeilen löscht die Datenbank): nicht mehr zählen, Gäste seiner Einladungen trennen. */
  forgetUser(uuid: string): void {
    this.untrack(uuid, false);
    const codes = new Set<string>();
    for (const [key, session] of this.guests) {
      if (session.inviter === uuid) {
        codes.add(session.invite);
        this.guests.delete(key);
      }
    }
    this.dropInvites([...codes]);
  }

  /** Abgelaufene Gast-Sitzungen entfernen und die gezählte Spielzeit speichern. */
  sweep(now = Date.now()): void {
    for (const [key, session] of this.guests) if (session.expiresAt <= now) this.guests.delete(key);
    this.flush();
  }

  /** Beim Herunterfahren: Spielzeit speichern, Zeitgeber anhalten. */
  close(): void {
    try {
      this.flush();
    } catch (err) {
      this.options.log(`Spielzeit beim Herunterfahren nicht gespeichert: ${(err as Error).message}`);
    }
    for (const entry of this.playing.values()) clearTimeout(entry.timer);
    this.playing.clear();
    this.guests.clear();
  }

  /** Datenauskunft: eigene Einladungen, wie man selbst eingeladen wurde, wer über einen dazukam (nur Zeitpunkte), Freischaltungen. */
  exportFor(user: UserRow) {
    this.flush(user.uuid);
    const referral = this.store.getReferral(user.uuid);
    const inviter = referral?.inviter ? this.store.getUser(referral.inviter) : undefined;
    return {
      links: this.store.allInvitesOf(user.uuid).map((invite) => ({
        code: invite.code,
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt,
        server: invite.server,
        voiceGroup: invite.voiceGroup,
        accepted: invite.accepted,
      })),
      invitedBy: referral
        ? {
            uuid: referral.inviter,
            name: inviter?.name ?? null,
            code: referral.code,
            at: referral.at,
            playedMs: referral.playedMs,
            confirmed: referral.confirmed,
          }
        : null,
      invited: this.store.referralsBy(user.uuid),
      unlocks: this.store.unlocksOf(user.uuid),
    };
  }
}
