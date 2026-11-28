// Dauerhafte Welten im Launcher (Heldix-Dienst ab 1.13.0, siehe docs/dienst.md):
//
// - Stand: GET /v1/hosting (angemeldet, leise) → eigene dauerhafte Welten und solche, in denen man Operator ist. Neu
//   geholt beim Start der Echtzeit-Verbindung und alle 5 Minuten; dazwischen hält hosting-state den Stand aktuell.
// - Glocke: hosting-granted („Du kannst jetzt dauerhafte Welten anlegen“), Zustandswechsel eigener Welten zu einem
//   Fehler bzw. Absturz (state „error“ oder neue Fehlermeldung, nie beim ersten Laden) und Anklopfen an der eigenen
//   dauerhaften Welt, wenn kein Spiel läuft (im Spiel zeigt die Mod die Einblendung mit H/N). Klick → Webseite.
// - „Offene Welten deiner Freunde“: dauerhafte Welten, in denen man Operator ist, mit ihrem Zustand.
// - Dienst ohne dauerhafte Welten (404 bzw. reason „off“): nichts davon, 30 Minuten Ruhe.

import type { FriendWorld, HostedState } from '../../shared/api';
import { ServiceError } from './heldixservice';
import { normalizeWorldAddress, worldCodeOf, type WorldAuth } from './worlds';

const STATES: readonly HostedState[] = ['creating', 'sleeping', 'starting', 'running', 'stopping', 'error'];
export const HOSTING_POLL_MS = 5 * 60_000;
const UNSUPPORTED_MS = 30 * 60_000;

export interface HostedWorldInfo {
  id: string;
  code: string;
  name: string;
  address: string;
  state: HostedState;
  error: string | null;
  players: number;
  maxPlayers: number;
  version: string | null;
  role: 'owner' | 'operator';
  owner: { uuid: string; name: string };
}

export type HostingEvent =
  | { kind: 'granted'; text: string; pending: boolean }
  | { kind: 'problem'; world: HostedWorldInfo; error: string }
  | { kind: 'knock'; world: { id: string; name: string; address: string | null }; name: string };

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function text(raw: unknown, max: number): string {
  const clean = str(raw).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return [...clean].slice(0, max).join('');
}

/** HostedWorld aus GET /v1/hosting bzw. hosting-state; ungültig: null */
export function mapHostedWorld(raw: unknown): HostedWorldInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !/^[0-9a-f]{32}$/.test(r.id)) return null;
  const address = normalizeWorldAddress(r.address);
  const code = worldCodeOf(address);
  if (!address || !code) return null;
  const owner = r.owner && typeof r.owner === 'object' ? (r.owner as Record<string, unknown>) : {};
  const uuid = str(owner.uuid).replace(/-/g, '').toLowerCase();
  const state = (STATES as readonly string[]).includes(str(r.state)) ? (r.state as HostedState) : 'error';
  const ownerName = text(owner.name, 16) || 'Unbekannt';
  return {
    id: r.id,
    code,
    name: text(r.name, 32) || `Welt von ${ownerName}`,
    address,
    state,
    error: text(r.error, 200) || null,
    players: typeof r.players === 'number' && r.players > 0 ? Math.min(1000, Math.floor(r.players)) : 0,
    maxPlayers: typeof r.maxPlayers === 'number' && r.maxPlayers > 0 ? Math.min(100, Math.floor(r.maxPlayers)) : 8,
    version: typeof r.version === 'string' && /^[A-Za-z0-9._+-]{1,32}$/.test(r.version) ? r.version : null,
    role: r.role === 'operator' ? 'operator' : 'owner',
    owner: { uuid: /^[0-9a-f]{32}$/.test(uuid) ? uuid : '0'.repeat(32), name: ownerName },
  };
}

/** Dauerhafte Welt als Eintrag für „Offene Welten deiner Freunde“ */
export function hostedAsFriendWorld(world: HostedWorldInfo): FriendWorld {
  return {
    id: world.id,
    code: world.code,
    name: world.name,
    address: world.address,
    host: world.owner,
    players: world.players,
    maxPlayers: world.maxPlayers,
    version: world.version,
    hosted: { state: world.state },
  };
}

/** Zeile zum Zustand einer dauerhaften Welt (Startseite, Glocke) */
export function hostedStateText(state: HostedState, players = 0, maxPlayers = 0): string {
  switch (state) {
    case 'running':
      return maxPlayers > 0 ? `läuft · ${players}/${maxPlayers} Spieler` : 'läuft';
    case 'sleeping':
    case 'stopping':
      return 'schläft – Beitreten weckt sie';
    case 'starting':
      return 'startet gerade';
    case 'creating':
      return 'wird eingerichtet';
    default:
      return 'hat gerade ein Problem';
  }
}

export interface HostingOptions {
  auth: WorldAuth | null;
  /** Einstellung „Freunde & Nachrichten“ */
  enabled(): Promise<boolean>;
  onChange?(): void;
  onEvent?(event: HostingEvent): void;
  log?(line: string): void;
}

export class HostingClient {
  private own = new Map<string, HostedWorldInfo>();
  private operated = new Map<string, HostedWorldInfo>();
  private allowedFlag = false;
  private available = false;
  private loadedFor: string | null = null;
  private unsupportedUntil = 0;
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: HostingOptions) {}

  /** darf dauerhafte Welten anlegen (Team oder Freischaltung) */
  get allowed(): boolean {
    return this.allowedFlag;
  }

  get supported(): boolean {
    return this.available;
  }

  ownWorlds(): HostedWorldInfo[] {
    return [...this.own.values()];
  }

  operatedWorlds(): HostedWorldInfo[] {
    return [...this.operated.values()];
  }

  /** alle 5 Minuten neu holen (erste Abfrage nach kurzer Zeit) */
  start(firstDelayMs = 5000): void {
    if (this.timer) clearInterval(this.timer);
    setTimeout(() => void this.refresh().catch(() => undefined), firstDelayMs).unref?.();
    this.timer = setInterval(() => void this.refresh().catch(() => undefined), HOSTING_POLL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** GET /v1/hosting; läuft schon eine Abfrage, deren Ende */
  refresh(): Promise<void> {
    this.running ??= this.load().finally(() => (this.running = null));
    return this.running;
  }

  private clear(): void {
    const had = this.own.size + this.operated.size > 0 || this.available;
    this.own.clear();
    this.operated.clear();
    this.allowedFlag = false;
    this.available = false;
    this.loadedFor = null;
    if (had) this.options.onChange?.();
  }

  private async load(): Promise<void> {
    const auth = this.options.auth;
    if (!auth || Date.now() < this.unsupportedUntil) return this.clear();
    try {
      if (!(await this.options.enabled()) || !(await auth.canAuthenticate())) return this.clear();
    } catch {
      return this.clear();
    }
    let raw: unknown;
    try {
      raw = await auth.authed<unknown>('/v1/hosting', {}, { quiet: true });
    } catch (error) {
      if (error instanceof ServiceError && error.status === 404) {
        this.unsupportedUntil = Date.now() + UNSUPPORTED_MS;
        this.clear();
      }
      return;
    }
    const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    if (r.reason === 'off') {
      this.unsupportedUntil = Date.now() + UNSUPPORTED_MS;
      return this.clear();
    }
    const account = await auth.accountId().catch(() => null);
    const first = this.loadedFor !== account;
    const own = (Array.isArray(r.worlds) ? r.worlds : []).map(mapHostedWorld).filter((w): w is HostedWorldInfo => w !== null);
    const operated = (Array.isArray(r.operated) ? r.operated : []).map(mapHostedWorld).filter((w): w is HostedWorldInfo => w !== null);
    // Fehler, die seit der letzten Abfrage dazukamen (nie beim ersten Laden bzw. nach einem Kontowechsel)
    if (!first) for (const world of own) this.compare(this.own.get(world.id) ?? null, { ...world, role: 'owner' });
    this.own = new Map(own.map((w) => [w.id, { ...w, role: 'owner' as const }]));
    this.operated = new Map(operated.map((w) => [w.id, { ...w, role: 'operator' as const }]));
    this.allowedFlag = r.allowed === true;
    this.available = true;
    this.loadedFor = account;
    this.options.onChange?.();
  }

  /** Echtzeit (Begleiter-Verbindung): true = war für die dauerhaften Welten */
  handleRealtime(message: Record<string, unknown>): boolean {
    switch (message.type) {
      case 'hosting-state': {
        const raw = message.world && typeof message.world === 'object' ? (message.world as Record<string, unknown>) : null;
        if (!raw || typeof raw.id !== 'string') return true;
        if (raw.state === 'deleted') {
          const removed = this.own.delete(raw.id) || this.operated.delete(raw.id);
          if (removed) this.options.onChange?.();
          return true;
        }
        const world = mapHostedWorld(raw);
        if (!world) return true;
        if (world.role === 'owner') {
          this.compare(this.own.get(world.id) ?? null, world);
          this.own.set(world.id, world);
          this.operated.delete(world.id);
        } else {
          this.operated.set(world.id, world);
          this.own.delete(world.id);
        }
        this.available = true;
        this.options.onChange?.();
        return true;
      }
      case 'hosting-knock': {
        const raw = message.world && typeof message.world === 'object' ? (message.world as Record<string, unknown>) : null;
        const name = str(message.name);
        if (!raw || typeof raw.id !== 'string' || !/^[0-9a-f]{32}$/.test(raw.id) || !/^[A-Za-z0-9_]{1,16}$/.test(name)) return true;
        this.options.onEvent?.({ kind: 'knock', world: { id: raw.id, name: text(raw.name, 32) || 'Welt', address: normalizeWorldAddress(raw.address) }, name });
        return true;
      }
      case 'hosting-granted':
        this.options.onEvent?.({ kind: 'granted', text: text(message.text, 240), pending: message.pending === true });
        // jetzt mit Berechtigung: Stand neu holen
        void this.refresh().catch(() => undefined);
        return true;
      case 'hosting-log':
      case 'hosting-subscribed':
      case 'hosting-error':
        return true;
      default:
        return false;
    }
  }

  /** eigene Welt: neuer Fehler (Zustand „error“ bzw. neue Meldung, z. B. Absturz) → Ereignis */
  private compare(before: HostedWorldInfo | null, after: HostedWorldInfo): void {
    if (after.role !== 'owner' || !before) return;
    const newError = after.error !== null && after.error !== before.error;
    const becameError = after.state === 'error' && before.state !== 'error';
    if (!newError && !becameError) return;
    this.options.onEvent?.({ kind: 'problem', world: after, error: after.error ?? 'Die Welt hat gerade ein Problem.' });
  }
}
