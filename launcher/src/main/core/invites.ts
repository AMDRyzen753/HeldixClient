// Einladungen und Beitreten-Links über den Heldix-Dienst ab 1.11.0 (siehe docs/dienst.md, „Einladungen“).
//
// - Links: Die fertige App ist für das Protokoll heldixclient:// registriert. Links kommen beim Start über
//   process.argv, bei laufendem Launcher über second-instance (Windows/Linux) bzw. open-url (macOS). Angenommen wird
//   nur heldixclient://einladung/<code> mit genau 10 Zeichen aus a–z und 2–9 ohne i, l, o (INVITE_CODE_RE); alles
//   andere fällt still weg. Nichts passiert ohne Klick: der Link öffnet nur den Dialog. Dazu kommen eingefügte Links
//   (Freunde → Einladen, parsePastedInvite) und die Einladung aus dem Download: Der Windows-Installer heißt dann
//   HeldixClient-Setup-<version>-einladung-<code>.exe und schreibt den Code in download-invite.txt im Datenordner
//   (build/installer.nsh); der Launcher liest die Datei beim Start einmal und löscht sie (takeDownloadInvite).
// - Öffnen: GET /v1/public/invites/<code> (ohne Anmeldung) zeigt, wer einlädt, den Server und die Willkommens-
//   Belohnung. Annehmen: POST /v1/invites/<code>/accept mit der Anmeldung beim Dienst (nur Microsoft-Konto).
// - Freunde einladen: GET /v1/invites (allgemeiner Link, Zähler, Belohnungen, offene Links), POST /v1/invites (Link
//   für einen Server), DELETE /v1/invites/<code> (widerrufen).
// - Discord-Knöpfe: Einladungen je Konto und Server im Speicher (höchstens alle 6 Stunden neu gefragt, Fehler 30
//   Minuten gemerkt). Der Dienst gibt für denselben Server ohnehin die offene Einladung zurück, trotzdem fragt nicht
//   jede Statusänderung beim Dienst nach.
// - Ereignisse: Freischaltungen und angenommene bzw. bestätigte Einladungen erkennt der Launcher am Vergleich mit dem
//   letzten Stand von GET /v1/invites: sofort, wenn über die Echtzeit-Verbindung (core/social.ts, ab Dienst 1.12.0)
//   „unlock“ oder „invite“ kommt, sonst alle 5 Minuten, sofort, wenn ein neuer Freund dazukommt, und beim Öffnen des
//   Bereichs. So kommt jede Meldung genau einmal. Beim ersten Laden (Start, Kontowechsel) gibt es keine Meldung.
// - Dienst ohne Einladungen (404 auf GET /v1/invites): Bereich ausgeblendet, keine Knöpfe, 30 Minuten Ruhe.
//
// Codes sind Zugangsdaten zu einer Einladung: sie stehen nie im Log.

import { readFile, rm, stat } from 'node:fs/promises';
import type {
  InviteEvent,
  InviteFriendResult,
  InviteLink,
  InviteNote,
  InviteReward,
  InviteRewardReason,
  InviteState,
} from '../../shared/api';
import { SERVICE_UNREACHABLE, ServiceError, serviceBase, serviceRequest } from './heldixservice';

export const INVITE_PROTOCOL = 'heldixclient';
/** 10 Zeichen aus abcdefghjkmnpqrstuvwxyz23456789 (ohne i, l, o, 0, 1) */
export const INVITE_CODE_RE = /^[a-hjkmnp-z2-9]{10}$/;
/** Protokoll und „einladung“ ohne Rücksicht auf Groß- und Kleinschreibung, der Code genau so wie vergeben */
const LINK_RE = /^heldixclient:\/\/einladung\/([^/?#]*)\/?$/i;
const MAX_LINK_LENGTH = 200;
const COSMETIC_ID_RE = /^[a-z0-9_-]{1,40}$/;

export const INVITE_MISSING = 'Diese Einladung gibt es nicht (mehr). Vielleicht ist sie abgelaufen oder wurde zurückgenommen – bitte um einen neuen Link.';
export const INVITE_OFFLINE = 'Einladungen gibt es nur mit einem Microsoft-Konto.';
export const INVITE_BAD_CODE = 'Ungültiger Einladungslink.';

/** Namen der Belohnungen, solange der Katalog sie (noch) nicht kennt */
const REWARD_NAMES: Record<string, string> = { freundesfunken: 'Freundesfunken', freundesband: 'Freundesband' };

/** So lange gilt eine Einladung für die Discord-Knöpfe, bevor sie neu geholt wird */
export const PRESENCE_LINK_MS = 6 * 60 * 60_000;
/** Fehler beim Anlegen (z. B. Server nicht öffentlich, Tagesgrenze) so lange merken */
const PRESENCE_FAILURE_MS = 30 * 60_000;
/** Dienst ohne Einladungen: so lange nicht wieder fragen */
const UNSUPPORTED_MS = 30 * 60_000;
export const INVITE_POLL_MS = 5 * 60_000;

// ---------- Links ----------

/** Code aus heldixclient://einladung/<code>, sonst null */
export function parseInviteLink(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_LINK_LENGTH) return null;
  const match = LINK_RE.exec(raw.trim());
  if (!match || !INVITE_CODE_RE.test(match[1])) return null;
  return match[1];
}

/** Erster gültiger Einladungslink in einer Befehlszeile (process.argv bzw. argv aus second-instance), sonst null */
export function findInviteLink(argv: readonly unknown[]): string | null {
  for (const arg of argv) {
    if (typeof arg !== 'string' || arg.slice(0, INVITE_PROTOCOL.length + 1).toLowerCase() !== `${INVITE_PROTOCOL}:`) continue;
    const code = parseInviteLink(arg);
    if (code) return code;
  }
  return null;
}

/**
 * Eingefügter Link aus „Link von einem Freund? Hier einfügen“: heldixclient://einladung/<code>, der Web-Link
 * https://<Webseite>/einladung#<code> (auch ohne https://, wie die Webseite ohne Rücksicht auf Groß- und Kleinschreibung
 * des Codes) oder nur der Code – auch mitten in einer kopierten Nachricht („Komm spielen: https://…“). Sonst null.
 */
export function parsePastedInvite(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  const whole = pastedLink(raw);
  if (whole) return whole;
  // der Link steht in einem Satz: jedes Wort einzeln (Satzzeichen am Rand weg)
  for (const word of raw.split(/\s+/).slice(0, 100)) {
    if (!/einladung/i.test(word)) continue;
    const code = pastedLink(word.replace(/^[„"'(<\[]+|[“"'),.!?;:>\]]+$/g, ''));
    if (code) return code;
  }
  return null;
}

function pastedLink(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > MAX_LINK_LENGTH) return null;
  const app = parseInviteLink(text) ?? parseInviteLink(text.replace(/[^/]*$/, (code) => code.toLowerCase()));
  if (app) return app;
  if (/^heldixclient:/i.test(text)) return null;
  const bare = text.toLowerCase();
  if (INVITE_CODE_RE.test(bare)) return bare;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !/^\/einladung(?:\.html)?\/?$/i.test(url.pathname)) return null;
  let code: string;
  try {
    code = decodeURIComponent(url.hash.replace(/^#/, '')).trim().toLowerCase();
  } catch {
    return null;
  }
  return INVITE_CODE_RE.test(code) ? code : null;
}

// ---------- Einladung aus dem Download (Windows-Installer) ----------

/**
 * Datei im Datenordner, in die der Installer den Code aus seinem Dateinamen schreibt
 * (HeldixClient-Setup-<version>-einladung-<code>.exe, siehe build/installer.nsh)
 */
export const DOWNLOAD_INVITE_FILE = 'download-invite.txt';
/** Ältere Dateien gelten nicht mehr (Einladungen laufen ohnehin nach 30 Tagen ab) */
export const DOWNLOAD_INVITE_MAX_MS = 7 * 24 * 60 * 60_000;

export interface InviteFileAccess {
  read(file: string): Promise<{ text: string; mtimeMs: number } | null>;
  remove(file: string): Promise<void>;
}

const fileAccess: InviteFileAccess = {
  async read(file) {
    try {
      const info = await stat(file);
      // nur eine kleine Datei (Code mit Zeilenumbruch)
      if (!info.isFile() || info.size > 256) return { text: '', mtimeMs: info.mtimeMs };
      return { text: await readFile(file, 'utf8'), mtimeMs: info.mtimeMs };
    } catch {
      return null;
    }
  },
  async remove(file) {
    await rm(file, { force: true }).catch(() => undefined);
  },
};

/**
 * Beim Start: Code aus der Datei des Installers lesen (nur jünger als 7 Tage und gültig). Ein gültiger Code bleibt in der
 * Datei, bis die Einladung gezeigt wurde (finishDownloadInvite) – wird der Launcher vorher geschlossen, z. B. mitten im
 * Einrichtungs-Assistenten, kommt sie beim nächsten Start wieder. Alte oder ungültige Dateien werden gleich gelöscht.
 * Keine Datei, alt oder ungültig: null.
 */
export async function readDownloadInvite(file: string, now = Date.now(), access: InviteFileAccess = fileAccess): Promise<string | null> {
  const found = await access.read(file);
  if (!found) return null;
  const code = found.text.replace(/^﻿/, '').trim();
  const fresh = found.mtimeMs <= now + 60_000 && now - found.mtimeMs <= DOWNLOAD_INVITE_MAX_MS;
  if (fresh && INVITE_CODE_RE.test(code)) return code;
  await access.remove(file);
  return null;
}

/** Einladung aus dem Download wurde gezeigt (oder von einem neueren Link ersetzt): Datei weg, sie öffnet sich nur einmal */
export async function finishDownloadInvite(file: string, access: InviteFileAccess = fileAccess): Promise<void> {
  await access.remove(file);
}

/** Lesen und gleich löschen (für Aufrufer, die die Einladung sofort zeigen) */
export async function takeDownloadInvite(file: string, now = Date.now(), access: InviteFileAccess = fileAccess): Promise<string | null> {
  const code = await readDownloadInvite(file, now, access);
  if (code) await finishDownloadInvite(file, access);
  return code;
}

/** Code aus der Oberfläche prüfen */
export function inviteCode(raw: unknown): string {
  if (typeof raw !== 'string' || !INVITE_CODE_RE.test(raw)) throw new Error(INVITE_BAD_CODE);
  return raw;
}

export function inviteAppUrl(code: string): string {
  return `${INVITE_PROTOCOL}://einladung/${code}`;
}

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD_RE = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * Serveradresse einer Einladung für den Direktbeitritt: öffentliche Domain (ASCII, mindestens zwei Teile, Endung aus
 * Buchstaben – also keine IP-Adressen und kein localhost), Port 1–65535 nur, wenn er nicht 25565 ist. Wie normalizeServer
 * im Dienst; der Launcher prüft trotzdem selbst, bevor die Adresse an Minecraft geht. Ungültig: null.
 */
export function inviteServer(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let host = raw.trim().toLowerCase();
  if (!host || host.length > 260) return null;
  let port: number | null = null;
  const withPort = /^([^:]+):(\d{1,5})$/.exec(host);
  if (withPort) {
    host = withPort[1];
    port = Number(withPort[2]);
    if (port < 1 || port > 65535) return null;
  }
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host.length > 253) return null;
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((label) => LABEL_RE.test(label)) || !TLD_RE.test(labels[labels.length - 1])) return null;
  return port === null || port === 25565 ? host : `${host}:${port}`;
}

/**
 * Instanz für „Annehmen und beitreten“: die zuletzt gespielte mit HeldixClient; hat noch keine gespielt, die bevorzugte
 * (ausgewählte) bzw. die erste mit HeldixClient. Keine mit HeldixClient: null.
 */
export function pickInviteInstance<T extends { lastPlayed: number | null }>(list: readonly T[], preferred: T | null, hasClient: (instance: T) => boolean): T | null {
  const candidates = list.filter(hasClient);
  const played = candidates.filter((i) => typeof i.lastPlayed === 'number' && i.lastPlayed > 0);
  if (played.length) return played.reduce((best, i) => (i.lastPlayed! > best.lastPlayed! ? i : best));
  if (preferred && hasClient(preferred)) return preferred;
  return candidates[0] ?? null;
}

// ---------- Antworten des Dienstes ----------

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

function time(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Link zur Webseite: nur http(s), ohne Leerzeichen, höchstens 512 Zeichen (Grenze von Discord für Knöpfe) */
function webUrl(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 512 && /^https?:\/\/[^\s]+$/i.test(value) ? value : null;
}

function player(raw: unknown): { uuid: string; name: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const uuid = str(p.uuid).replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(uuid)) return null;
  const name = str(p.name).trim().slice(0, 32);
  return { uuid, name: name || uuid };
}

function cosmeticId(value: unknown): string | null {
  return typeof value === 'string' && COSMETIC_ID_RE.test(value) ? value : null;
}

/** Name eines Cosmetics für Texte (Katalog, sonst bekannte Belohnung, sonst die ID) */
export function rewardName(id: string, catalogName?: string | null): string {
  return catalogName?.trim() || REWARD_NAMES[id] || id.charAt(0).toUpperCase() + id.slice(1);
}

export function mapInviteLink(raw: unknown): InviteLink | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.code !== 'string' || !INVITE_CODE_RE.test(r.code)) return null;
  return {
    code: r.code,
    url: webUrl(r.url),
    // nicht aus der Antwort übernehmen: immer genau der eigene Link
    appUrl: inviteAppUrl(r.code),
    created: time(r.created),
    expires: time(r.expires),
    server: inviteServer(r.server),
    voice: r.voice === true || (!!r.voice && typeof r.voice === 'object'),
    accepted: count(r.accepted),
  };
}

export function emptyInviteState(available: boolean, error: string | null = null): InviteState {
  return { available, error, link: null, invites: [], invited: 0, confirmed: 0, pending: 0, rewards: [], unlocked: [] };
}

/** Antwort von GET /v1/invites; names = Namen der Cosmetics aus dem Katalog */
export function mapInviteState(raw: unknown, names: Record<string, string> = {}): InviteState {
  if (!raw || typeof raw !== 'object') throw new ServiceError('Der Heldix-Dienst hat eine ungültige Antwort geschickt.', 200);
  const r = raw as Record<string, unknown>;
  const unlocked = [...new Set((Array.isArray(r.unlocked) ? r.unlocked : []).map(cosmeticId).filter((id): id is string => id !== null))];
  const rewards: InviteReward[] = (Array.isArray(r.rewards) ? r.rewards : [])
    .map((item): InviteReward | null => {
      const reward = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const id = cosmeticId(reward.cosmetic);
      if (!id) return null;
      return { cosmetic: id, name: rewardName(id, names[id]), friends: Math.max(1, count(reward.friends)), unlocked: reward.unlocked === true || unlocked.includes(id) };
    })
    .filter((reward): reward is InviteReward => reward !== null)
    .sort((a, b) => a.friends - b.friends);
  const invites = (Array.isArray(r.invites) ? r.invites : []).map(mapInviteLink).filter((link): link is InviteLink => link !== null);
  const invited = count(r.invited);
  const confirmed = count(r.confirmed);
  return {
    available: true,
    error: null,
    link: mapInviteLink(r.link),
    invites,
    invited,
    confirmed,
    pending: typeof r.pending === 'number' ? count(r.pending) : Math.max(0, invited - confirmed),
    rewards,
    unlocked,
  };
}

/** Antwort von GET /v1/public/invites/<code> */
export interface PublicInvite {
  code: string;
  inviter: { uuid: string; name: string };
  server: string | null;
  voice: { members: number; guests: number; maxGuests: number } | null;
  expires: number;
  /** Willkommens-Belohnung (Cosmetic-ID) */
  welcome: string | null;
}

export function mapPublicInvite(raw: unknown, code: string): PublicInvite {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const inviter = player(r.inviter);
  if (!inviter || (typeof r.code === 'string' && r.code !== code)) throw new ServiceError('Der Heldix-Dienst hat eine ungültige Antwort geschickt.', 200);
  const voice = r.voice && typeof r.voice === 'object' ? (r.voice as Record<string, unknown>) : null;
  return {
    code,
    inviter,
    server: inviteServer(r.server),
    voice: voice ? { members: count(voice.members), guests: count(voice.guests), maxGuests: count(voice.maxGuests) || 4 } : null,
    expires: time(r.expires),
    welcome: cosmeticId(r.welcome),
  };
}

const FRIEND_RESULTS: readonly InviteFriendResult[] = ['new', 'already', 'blocked', 'limit', 'self'];
const REWARD_REASONS: readonly InviteRewardReason[] = ['not-new', 'already-invited', 'self'];

/** Antwort von POST /v1/invites/<code>/accept */
export interface AcceptResult {
  inviter: { uuid: string; name: string };
  server: string | null;
  friend: InviteFriendResult;
  reward: string | null;
  rewardReason: InviteRewardReason | null;
}

export function mapAcceptResult(raw: unknown, fallbackInviter?: { uuid: string; name: string }): AcceptResult {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const inviter = player(r.inviter) ?? fallbackInviter;
  const friend = FRIEND_RESULTS.includes(r.friend as InviteFriendResult) ? (r.friend as InviteFriendResult) : null;
  if (!inviter || !friend) throw new ServiceError('Der Heldix-Dienst hat eine ungültige Antwort geschickt.', 200);
  return {
    inviter,
    server: inviteServer(r.server),
    friend,
    reward: cosmeticId(r.reward),
    rewardReason: REWARD_REASONS.includes(r.rewardReason as InviteRewardReason) ? (r.rewardReason as InviteRewardReason) : null,
  };
}

/** Sätze für das Ergebnis im Dialog (Freundschaft, Belohnung) */
export function acceptNotes(result: AcceptResult, reward: string | null = result.reward ? rewardName(result.reward) : null): InviteNote[] {
  const name = result.inviter.name;
  const notes: InviteNote[] = [];
  switch (result.friend) {
    case 'new':
      notes.push({ tone: 'success', text: `Du und ${name} seid jetzt Freunde.` });
      break;
    case 'already':
      notes.push({ tone: 'info', text: `Du und ${name} seid schon befreundet.` });
      break;
    case 'blocked':
      notes.push({ tone: 'warn', text: `Eine Freundschaft mit ${name} ist nicht möglich.` });
      break;
    case 'limit':
      notes.push({ tone: 'warn', text: `Eine Freundesliste ist voll – ihr konntet nicht befreundet werden. Entferne einen Freund und öffne den Link noch einmal.` });
      break;
    case 'self':
      notes.push({ tone: 'info', text: 'Das ist deine eigene Einladung – schick den Link an deine Freunde.' });
      break;
  }
  if (result.reward && reward) notes.push({ tone: 'success', text: `Belohnung freigeschaltet: ${reward}. Du findest es unter Skins & Cosmetics.` });
  else if (result.rewardReason === 'not-new') notes.push({ tone: 'info', text: 'Die Willkommens-Belohnung gibt es nur für neue Spieler.' });
  else if (result.rewardReason === 'already-invited') notes.push({ tone: 'info', text: 'Die Willkommens-Belohnung gibt es nur einmal – du hast schon eine Einladung angenommen.' });
  return notes;
}

/** Fehler des Dienstes beim Öffnen oder Annehmen: 404 = Einladung weg (oder Dienst ohne Einladungen) */
export function isMissing(error: unknown): boolean {
  return error instanceof ServiceError && (error.status === 404 || error.status === 410);
}

// ---------- Ereignisse (statt Realtime) ----------

interface Snapshot {
  account: string;
  unlocked: Set<string>;
  invited: number;
  confirmed: number;
  /** angenommen je Einladung */
  accepted: Map<string, number>;
}

function snapshot(account: string, state: InviteState): Snapshot {
  return {
    account,
    unlocked: new Set(state.unlocked),
    invited: state.invited,
    confirmed: state.confirmed,
    accepted: new Map(state.invites.map((i) => [i.code, i.accepted])),
  };
}

/**
 * Was sich seit dem letzten Stand getan hat. newFriends = Namen der Freunde, die seitdem dazugekommen sind (für „<Name>
 * hat deine Einladung angenommen“, nur wenn es genau einer ist).
 */
export function inviteEvents(before: Snapshot | null, state: InviteState, account: string, newFriends: readonly string[], names: Record<string, string> = {}): InviteEvent[] {
  if (!before || before.account !== account) return [];
  const events: InviteEvent[] = [];
  for (const id of state.unlocked) {
    if (!before.unlocked.has(id)) events.push({ kind: 'unlock', cosmetic: id, name: rewardName(id, names[id]) });
  }
  let acceptedDelta = 0;
  for (const invite of state.invites) {
    const previous = before.accepted.get(invite.code);
    acceptedDelta += Math.max(0, invite.accepted - (previous ?? 0));
  }
  const accepted = Math.max(state.invited - before.invited, acceptedDelta);
  if (accepted > 0) events.push({ kind: 'accepted', name: accepted === 1 && newFriends.length === 1 ? newFriends[0] : null, count: accepted });
  const confirmed = state.confirmed - before.confirmed;
  if (confirmed > 0) events.push({ kind: 'confirmed', count: confirmed });
  return events;
}

// ---------- Client ----------

/** Teil von core/social.ts, den die Einladungen brauchen */
export interface InviteAuth {
  authed<T>(route: string, init?: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown }, options?: { offlineMessage?: string; quiet?: boolean }): Promise<T>;
  accountId(): Promise<string | null>;
  canAuthenticate(): Promise<boolean>;
}

export interface InviteOptions {
  serviceUrl: string;
  auth: InviteAuth | null;
  /** Einstellung „Freunde & Nachrichten“: aus = keine Abfragen im Hintergrund und keine Discord-Knöpfe */
  enabled(): Promise<boolean>;
  /** Namen der Cosmetics aus dem Katalog (für Texte) */
  cosmeticNames?(): Promise<Record<string, string>>;
  onEvent?(event: InviteEvent): void;
  /** Neue Links für die Discord-Knöpfe sind da: Status neu setzen */
  onLinks?(): void;
  log?(line: string): void;
}

interface CachedLink {
  url: string | null;
  until: number;
}

const message = (error: unknown) => (error instanceof Error && error.message ? error.message : 'Unbekannter Fehler beim Heldix-Dienst.');

export class InviteService {
  private readonly base: string;
  private unsupportedUntil = 0;
  private baseline: Snapshot | null = null;
  private newFriends: string[] = [];
  private polling: Promise<void> | null = null;
  private pollAgain = false;
  private readonly links = new Map<string, CachedLink>();
  private readonly linkLoads = new Map<string, Promise<void>>();

  constructor(private readonly options: InviteOptions) {
    this.base = serviceBase(options.serviceUrl ?? '');
  }

  /** false, solange der Dienst gerade „keine Einladungen“ gemeldet hat */
  get supported(): boolean {
    return Date.now() >= this.unsupportedUntil;
  }

  private auth(): InviteAuth {
    if (!this.base || !this.options.auth) throw new Error('Kein Heldix-Dienst eingerichtet.');
    return this.options.auth;
  }

  private async names(): Promise<Record<string, string>> {
    return (await this.options.cosmeticNames?.().catch(() => ({}))) ?? {};
  }

  // ---------- Öffnen und Annehmen ----------

  /** GET /v1/public/invites/<code>; wirft ServiceError (404 = weg, siehe isMissing) */
  async publicInvite(rawCode: unknown): Promise<PublicInvite> {
    const code = inviteCode(rawCode);
    if (!this.base) throw new Error('Kein Heldix-Dienst eingerichtet.');
    const raw = await serviceRequest<unknown>(this.base, `/v1/public/invites/${code}`, { timeoutMs: 10_000 });
    return mapPublicInvite(raw, code);
  }

  /** POST /v1/invites/<code>/accept; die Belohnung kommt gleich in den Vergleichsstand (keine zweite Meldung) */
  async accept(rawCode: unknown, inviter?: { uuid: string; name: string }): Promise<AcceptResult> {
    const code = inviteCode(rawCode);
    const auth = this.auth();
    let raw: unknown;
    try {
      raw = await auth.authed<unknown>(`/v1/invites/${code}/accept`, { method: 'POST' }, { offlineMessage: INVITE_OFFLINE });
    } catch (error) {
      if (isMissing(error)) throw new ServiceError(INVITE_MISSING, 404);
      throw error;
    }
    const result = mapAcceptResult(raw, inviter);
    const account = await auth.accountId().catch(() => null);
    if (result.reward && this.baseline && this.baseline.account === account) this.baseline.unlocked.add(result.reward);
    return result;
  }

  // ---------- Freunde einladen ----------

  /** GET /v1/invites; available = false bei einem Dienst ohne Einladungen. Meldet Neues (siehe oben). */
  async state(quiet = false): Promise<InviteState> {
    const auth = this.auth();
    let raw: unknown;
    try {
      raw = await auth.authed<unknown>('/v1/invites', {}, { offlineMessage: INVITE_OFFLINE, quiet });
    } catch (error) {
      if (error instanceof ServiceError && error.status === 404) {
        this.unsupportedUntil = Date.now() + UNSUPPORTED_MS;
        return emptyInviteState(false);
      }
      throw error;
    }
    this.unsupportedUntil = 0;
    const names = await this.names();
    const state = mapInviteState(raw, names);
    const account = await auth.accountId().catch(() => null);
    if (account) {
      const events = inviteEvents(this.baseline, state, account, this.newFriends, names);
      this.baseline = snapshot(account, state);
      this.newFriends = [];
      for (const event of events) this.options.onEvent?.(event);
    }
    // allgemeiner Link für die Discord-Knöpfe
    if (account && state.link) this.links.set(`${account}\n`, { url: state.link.url, until: Math.min(Date.now() + PRESENCE_LINK_MS, state.link.expires || Infinity) });
    return state;
  }

  /** POST /v1/invites: Link für einen Server (null = allgemein); der Dienst gibt eine offene gleiche zurück */
  async create(rawServer: unknown): Promise<InviteLink> {
    const auth = this.auth();
    let server: string | null = null;
    if (rawServer !== null && rawServer !== undefined && rawServer !== '') {
      server = inviteServer(rawServer);
      if (!server) throw new Error('Bitte eine öffentliche Serveradresse angeben, z. B. play.example.de oder play.example.de:25570 – keine IP-Adressen.');
    }
    let raw: unknown;
    try {
      raw = await auth.authed<unknown>('/v1/invites', { method: 'POST', body: { server } }, { offlineMessage: INVITE_OFFLINE });
    } catch (error) {
      if (error instanceof ServiceError && error.status === 404) {
        this.unsupportedUntil = Date.now() + UNSUPPORTED_MS;
        throw new Error('Der Heldix-Dienst kennt noch keine Einladungen.');
      }
      throw error;
    }
    const link = mapInviteLink(raw);
    if (!link) throw new ServiceError('Der Heldix-Dienst hat eine ungültige Antwort geschickt.', 200);
    return link;
  }

  /** DELETE /v1/invites/<code>, danach der neue Stand */
  async revoke(rawCode: unknown): Promise<InviteState> {
    const code = inviteCode(rawCode);
    await this.auth().authed(`/v1/invites/${code}`, { method: 'DELETE' }, { offlineMessage: INVITE_OFFLINE });
    // zurückgenommene Links nicht mehr in Discord zeigen: alle neu holen
    this.links.clear();
    this.options.onLinks?.();
    return this.state();
  }

  // ---------- im Hintergrund ----------

  /** Neue Freunde (aus der Freundesliste): Namen merken und gleich nachsehen, ob es Einladungen waren */
  friendsAdded(names: readonly string[]): void {
    if (!names.length) return;
    this.newFriends.push(...names);
    void this.poll();
  }

  /** Regelmäßige Abfrage (still): nur mit Freunden an, Anmeldung möglich und Dienst mit Einladungen */
  poll(): Promise<void> {
    this.polling ??= (async () => {
      try {
        if (!this.base || !this.options.auth || !this.supported) return;
        if (!(await this.options.enabled()) || !(await this.options.auth.canAuthenticate())) return;
        await this.state(true);
      } catch (error) {
        this.options.log?.(`Einladungen nicht geladen: ${message(error)}`);
      }
    })().finally(() => {
      this.polling = null;
      if (this.pollAgain) {
        this.pollAgain = false;
        void this.poll();
      }
    });
    return this.polling;
  }

  /** Echtzeit „unlock“ bzw. „invite“: gleich nachsehen – läuft schon eine Abfrage, danach noch einmal */
  pollNow(): void {
    if (this.polling) this.pollAgain = true;
    else void this.poll();
  }

  // ---------- Discord ----------

  /**
   * Links für die Discord-Knöpfe aus dem Speicher (ohne zu warten). Fehlt einer oder ist er alt, wird er im
   * Hintergrund geholt und danach onLinks() gerufen. server = Server für „Mitspielen“ (null = keiner).
   */
  async presenceLinks(server: string | null): Promise<{ general: string | null; server: string | null }> {
    const none = { general: null, server: null };
    const auth = this.options.auth;
    if (!this.base || !auth || !this.supported) return none;
    if (!(await this.options.enabled().catch(() => false)) || !(await auth.canAuthenticate().catch(() => false))) return none;
    const account = await auth.accountId().catch(() => null);
    if (!account) return none;
    const serverKey = server ? inviteServer(server) : null;
    return {
      general: this.cachedLink(account, null),
      server: serverKey ? this.cachedLink(account, serverKey) : null,
    };
  }

  private cachedLink(account: string, server: string | null): string | null {
    const key = `${account}\n${server ?? ''}`;
    const entry = this.links.get(key);
    if (entry && entry.until > Date.now()) return entry.url;
    if (!this.linkLoads.has(key)) {
      const load = this.loadLink(key, account, server).finally(() => this.linkLoads.delete(key));
      this.linkLoads.set(key, load);
    }
    return null;
  }

  private async loadLink(key: string, account: string, server: string | null): Promise<void> {
    let entry: CachedLink;
    try {
      const link = await this.create(server);
      // nur Links zur Webseite: Discord nimmt in Knöpfen keine eigenen Protokolle
      entry = { url: link.url && /^https:\/\//i.test(link.url) ? link.url : null, until: Math.min(Date.now() + PRESENCE_LINK_MS, link.expires || Infinity) };
    } catch (error) {
      if (!(error instanceof ServiceError && error.status === 0 && error.message === SERVICE_UNREACHABLE)) {
        this.options.log?.(`Einladung für den Discord-Status nicht angelegt: ${message(error)}`);
      }
      entry = { url: null, until: Date.now() + PRESENCE_FAILURE_MS };
    }
    if ((await this.options.auth?.accountId().catch(() => null)) !== account) return;
    const before = this.links.get(key)?.url ?? null;
    this.links.set(key, entry);
    if (entry.url !== before) this.options.onLinks?.();
  }
}
