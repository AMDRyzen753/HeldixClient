// Geteilte Welten von Freunden (Heldix-Dienst ab 1.12.0, „Welt teilen“, siehe docs/dienst.md).
//
// - Adressen: Jede geteilte Welt hat eine feste Adresse <code>.welt.<Domain> (Code: 6 Zeichen aus dem Einladungs-
//   Alphabet abcdefghjkmnpqrstuvwxyz23456789). Beitreten = Quick Play auf diese Adresse; der Dienst leitet weiter.
// - Links: heldixclient://welt/<code> (gleicher Weg wie heldixclient://einladung/<code>, core/invites.ts) und auf der
//   Webseite /welt#<code>. Angenommen wird nur genau dieses Format, alles andere fällt still weg.
// - Offene Welten der Freunde: GET /v1/worlds → friends – Abfrage alle 30 s bei sichtbarem Fenster, sonst alle 2 Minuten
//   und sofort, wenn sich bei den Freunden etwas tut; dazu direkt world-open/world-closed über die Echtzeit-Verbindung
//   des Launchers (core/social.ts, handleRealtime). Neue offene Welten melden sich als Ereignis (nie beim ersten Laden).
//   Einladungen in eine Welt (world-invite) meldet main.ts in der Glocke.
// - Öffentliche Welt-Info: GET /v1/public/worlds/<code> (ohne Anmeldung) für den Dialog „Welt von <Name>“ und den
//   Discord-Status (Name des Gastgebers), kurz zwischengespeichert.
// - Dienst ohne Welt teilen (404 bzw. 503 „nicht eingerichtet“): Bereich aus, 30 Minuten Ruhe.

import type { FriendWorld, HostedState, PublicWorldView, WorldsOverview } from '../../shared/api';
import { SERVICE_UNREACHABLE, ServiceError, serviceBase, serviceRequest } from './heldixservice';

export const WORLD_PROTOCOL = 'heldixclient';
/** 6 Zeichen aus abcdefghjkmnpqrstuvwxyz23456789 (ohne i, l, o, 0, 1) – wie im Dienst */
export const WORLD_CODE_RE = /^[a-hjkmnp-z2-9]{6}$/;
/** Adresse einer geteilten Welt: <code>.welt.<Domain>, optional mit Port (wie WorldShare.isWorldAddress in der Mod) */
export const WORLD_ADDRESS_RE = /^([a-hjkmnp-z2-9]{6})\.welt\.((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})(?::(\d{1,5}))?\.?$/i;
const LINK_RE = /^heldixclient:\/\/welt\/([^/?#]*)\/?$/i;
const MAX_LINK_LENGTH = 200;

export const WORLD_POLL_VISIBLE_MS = 30_000;
export const WORLD_POLL_HIDDEN_MS = 2 * 60_000;
/** Dienst ohne Welt teilen: so lange nicht wieder fragen */
const UNSUPPORTED_MS = 30 * 60_000;
/** Öffentliche Welt-Info so lange merken (der Dienst erlaubt 60 Abfragen je Minute) */
export const PUBLIC_WORLD_MS = 60_000;
const PUBLIC_FAILURE_MS = 2 * 60_000;

export const WORLD_BAD_CODE = 'Ungültiger Welt-Link.';
export const WORLD_MISSING = 'Diese Welt gibt es nicht (mehr). Prüf den Link oder frag nach einem neuen.';
export const WORLD_OFFLINE = 'Welt teilen gibt es nur mit einem Microsoft-Konto.';

// ---------- Links und Adressen ----------

/** Code aus heldixclient://welt/<code>, sonst null */
export function parseWorldLink(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_LINK_LENGTH) return null;
  const match = LINK_RE.exec(raw.trim());
  if (!match || !WORLD_CODE_RE.test(match[1])) return null;
  return match[1];
}

/** Erster gültiger Welt-Link in einer Befehlszeile (process.argv bzw. argv aus second-instance), sonst null */
export function findWorldLink(argv: readonly unknown[]): string | null {
  for (const arg of argv) {
    if (typeof arg !== 'string' || arg.slice(0, WORLD_PROTOCOL.length + 1).toLowerCase() !== `${WORLD_PROTOCOL}:`) continue;
    const code = parseWorldLink(arg);
    if (code) return code;
  }
  return null;
}

/** Code aus der Oberfläche prüfen */
export function worldCode(raw: unknown): string {
  if (typeof raw !== 'string' || !WORLD_CODE_RE.test(raw)) throw new Error(WORLD_BAD_CODE);
  return raw;
}

export function worldAppUrl(code: string): string {
  return `${WORLD_PROTOCOL}://welt/${code}`;
}

/** Web-Link /welt#<code> (nur https-Webseiten, für Discord-Knöpfe), sonst null */
export function worldWebUrl(website: string, code: string): string | null {
  const base = website.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+/i.test(base) || !WORLD_CODE_RE.test(code)) return null;
  const url = `${base}/welt#${code}`;
  return url.length <= 512 ? url : null;
}

/** Ist das die Adresse einer geteilten Welt (<code>.welt.<Domain>)? Dann der Code, sonst null. */
export function worldCodeOf(address: unknown): string | null {
  if (typeof address !== 'string' || address.length > 255) return null;
  const match = WORLD_ADDRESS_RE.exec(address.trim());
  if (!match) return null;
  if (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 65535)) return null;
  return match[1].toLowerCase();
}

/** Adresse klein, ohne Standard-Port und Punkt am Ende (wie die Mod sie meldet); ungültig: null */
export function normalizeWorldAddress(address: unknown): string | null {
  if (!worldCodeOf(address)) return null;
  const clean = (address as string).trim().toLowerCase().replace(/\.$/, '');
  return clean.replace(/:25565$/, '');
}

/**
 * Eingefügter Welt-Link (Freunde → „Link von einem Freund? Hier einfügen“): heldixclient://welt/<code>, der Web-Link
 * https://<Webseite>/welt#<code> (auch ohne https://) oder die Adresse <code>.welt.<Domain> – auch mitten in einem
 * Satz. Ein bloßer Code (6 Zeichen) zählt nicht, er wäre zu leicht mit Wörtern zu verwechseln. Sonst null.
 */
export function parsePastedWorld(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  const whole = pastedWorld(raw);
  if (whole) return whole;
  for (const word of raw.split(/\s+/).slice(0, 100)) {
    if (!/welt/i.test(word)) continue;
    const code = pastedWorld(word.replace(/^[„"'(<\[]+|[“"'),!?;:>\]]+$/g, '').replace(/\.$/, ''));
    if (code) return code;
  }
  return null;
}

function pastedWorld(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > MAX_LINK_LENGTH) return null;
  const app = parseWorldLink(text) ?? parseWorldLink(text.replace(/[^/]*$/, (code) => code.toLowerCase()));
  if (app) return app;
  if (/^heldixclient:/i.test(text)) return null;
  const address = worldCodeOf(text);
  if (address) return address;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !/^\/welt(?:\.html)?\/?$/i.test(url.pathname)) return null;
  let code: string;
  try {
    code = decodeURIComponent(url.hash.replace(/^#/, '')).trim().toLowerCase();
  } catch {
    return null;
  }
  return WORLD_CODE_RE.test(code) ? code : null;
}

// ---------- Antworten des Dienstes ----------

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const count = (value: unknown, max = 1000): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(max, Math.floor(value)) : 0);
/** Minecraft-Version, wie der Dienst sie prüft (^[A-Za-z0-9._+-]{1,32}$) */
const VERSION_RE = /^[A-Za-z0-9._+-]{1,32}$/;

function player(raw: unknown): { uuid: string; name: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const uuid = str(p.uuid).replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(uuid)) return null;
  const name = str(p.name).trim().slice(0, 32);
  return { uuid, name: name || uuid };
}

/** Name einer Welt für die Anzeige (ohne Steuerzeichen, höchstens 32 Zeichen wie im Dienst) */
function worldName(raw: unknown, host: string): string {
  const name = str(raw).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return [...name].slice(0, 32).join('') || `Welt von ${host}`;
}

/** Eintrag aus GET /v1/worlds → friends; ungültig: null */
export function mapFriendWorld(raw: unknown): FriendWorld | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const host = player(r.host);
  const address = normalizeWorldAddress(r.address);
  const code = worldCodeOf(address);
  if (!host || !address || !code || typeof r.id !== 'string' || !/^[0-9a-f]{32}$/.test(r.id)) return null;
  const maxPlayers = Math.max(1, Math.min(20, count(r.maxPlayers, 20) || 8));
  const hosted = mapHosted(r.hosted);
  return {
    id: r.id,
    code,
    name: worldName(r.name, host.name),
    address,
    host,
    players: Math.min(count(r.players), 1000),
    maxPlayers,
    version: typeof r.version === 'string' && VERSION_RE.test(r.version) ? r.version : null,
    ...(hosted ? { hosted } : {}),
  };
}

/** Echtzeit-Nachricht world-invite: { world: { id, name, address, host } } → Einladung in eine Welt; ungültig: null */
export function mapWorldInvite(raw: unknown): { id: string; code: string; name: string; address: string; host: { uuid: string; name: string } } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const host = player(r.host);
  const address = normalizeWorldAddress(r.address);
  const code = worldCodeOf(address);
  if (!host || !address || !code || typeof r.id !== 'string' || !/^[0-9a-f]{32}$/.test(r.id)) return null;
  return { id: r.id, code, name: worldName(r.name, host.name), address, host };
}

/** Eigene Welt aus GET /v1/worlds → mine (für „Welt teilen“ im Chat); ungültig: null */
export function mapOwnWorld(raw: unknown): OwnWorld | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const code = typeof r.code === 'string' && WORLD_CODE_RE.test(r.code) ? r.code : worldCodeOf(r.address);
  if (!code) return null;
  const address = normalizeWorldAddress(r.address);
  return { code, name: worldName(r.name, 'dir'), address: address && worldCodeOf(address) === code ? address : null, online: r.online === true };
}

export interface OwnWorld {
  code: string;
  name: string;
  address: string | null;
  online: boolean;
}

const HOSTED_STATES: readonly HostedState[] = ['creating', 'sleeping', 'starting', 'running', 'stopping', 'error'];

/** `hosted: { state }` (ab Dienst 1.13.0, nur bei dauerhaften Welten), sonst null */
export function mapHosted(raw: unknown): { state: HostedState } | null {
  if (!raw || typeof raw !== 'object') return null;
  const state = (raw as { state?: unknown }).state;
  return { state: typeof state === 'string' && (HOSTED_STATES as readonly string[]).includes(state) ? (state as HostedState) : 'error' };
}

/** Antwort von GET /v1/public/worlds/<code> */
export function mapPublicWorld(raw: unknown, code: string): PublicWorldView {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const host = player(r.host);
  if (!host) throw new ServiceError('Der Heldix-Dienst hat eine ungültige Antwort geschickt.', 200);
  const address = normalizeWorldAddress(r.address);
  const hosted = mapHosted(r.hosted);
  return {
    ...(hosted ? { hosted } : {}),
    code,
    name: worldName(r.name, host.name),
    // ältere Antworten ohne Adresse: nur der Code ist bekannt (Adresse kommt dann aus GET /v1/worlds bzw. bleibt leer)
    address: address && worldCodeOf(address) === code ? address : null,
    host,
    online: r.online === true,
    players: count(r.players),
    maxPlayers: Math.max(1, Math.min(20, count(r.maxPlayers, 20) || 8)),
    version: typeof r.version === 'string' && VERSION_RE.test(r.version) ? r.version : null,
    access: r.access === 'open' ? 'open' : 'closed',
  };
}

// ---------- Beitreten: welche Instanz? ----------

export interface WorldInstance {
  id: string;
  name: string;
  minecraft: string;
  lastPlayed: number | null;
}

export interface WorldJoinPlan<T> {
  instance: T | null;
  /** warum Beitreten gerade nicht geht (deutsch), sonst null */
  problem: string | null;
}

/**
 * Instanz zum Beitreten: eine mit HeldixClient und derselben Minecraft-Version wie die Welt (die zuletzt gespielte,
 * sonst die bevorzugte bzw. erste). Kennt der Dienst die Version nicht, die zuletzt gespielte mit HeldixClient.
 * Keine passende: Hinweis. Läuft schon ein Spiel oder ist die Welt zu: Hinweis.
 *
 * Dauerhafte Welten (ab Dienst 1.13.0, {@code hosted}): Beitreten geht auch, wenn sie schläft (der Beitritt weckt sie,
 * die Mod versucht es nach etwa 30 Sekunden von selbst erneut) – auch bei der eigenen Welt; nicht beim Einrichten und
 * bei einem Fehler.
 */
export function planWorldJoin<T extends WorldInstance>(input: {
  world: Pick<PublicWorldView, 'online' | 'version' | 'host'> & { address: string | null; hosted?: { state: HostedState } | null };
  instances: readonly T[];
  preferred: T | null;
  hasClient: (instance: T) => boolean;
  gameRunning: boolean;
  /** eigene UUID (ohne Bindestriche) – die eigene Welt betritt man über das Spiel */
  self?: string | null;
}): WorldJoinPlan<T> {
  const { world } = input;
  const candidates = input.instances.filter(input.hasClient);
  const matching = world.version ? candidates.filter((i) => i.minecraft === world.version) : candidates;
  const played = matching.filter((i) => typeof i.lastPlayed === 'number' && i.lastPlayed > 0);
  let instance: T | null = null;
  if (played.length) instance = played.reduce((best, i) => (i.lastPlayed! > best.lastPlayed! ? i : best));
  else instance = (input.preferred && matching.find((i) => i.id === input.preferred!.id)) || matching[0] || null;

  const hosted = world.hosted ?? null;
  if (!hosted && input.self && world.host.uuid === input.self) return { instance, problem: 'Das ist deine eigene Welt – teilen und spielen geht im Spiel über das Pausenmenü.' };
  if (!world.address) return { instance, problem: 'Die Adresse dieser Welt ist unbekannt – bitte den Link noch einmal öffnen.' };
  if (hosted?.state === 'creating') return { instance, problem: 'Die Welt wird gerade auf dem Heldix-Server eingerichtet. Versuch es später noch einmal.' };
  if (hosted?.state === 'error') return { instance, problem: 'Die Welt hat gerade ein Problem. Der Besitzer kann sie auf der Webseite neu starten.' };
  if (!hosted && !world.online) return { instance, problem: `Die Welt ist gerade nicht geöffnet. Sobald ${world.host.name} sie teilt, kannst du beitreten.` };
  if (!instance) {
    return {
      instance: null,
      problem: world.version
        ? `Für Minecraft ${world.version} hast du keine Instanz mit HeldixClient. Leg unter „Instanzen“ eine an – danach klappt das Beitreten.`
        : 'Zum Beitreten brauchst du eine Instanz mit HeldixClient. Leg unter „Instanzen“ eine an.',
    };
  }
  if (input.gameRunning) return { instance, problem: 'Es läuft schon ein Spiel. Beende es oder tritt im Spiel über „Heldix-Welten“ bei.' };
  return { instance, problem: null };
}

// ---------- Client ----------

/** Teil von core/social.ts, den die Welten brauchen */
export interface WorldAuth {
  authed<T>(route: string, init?: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown }, options?: { offlineMessage?: string; quiet?: boolean }): Promise<T>;
  accountId(): Promise<string | null>;
  canAuthenticate(): Promise<boolean>;
}

/** Neue offene Welt eines Freundes (seit der letzten Abfrage) */
export interface WorldEvent {
  kind: 'open';
  world: FriendWorld;
}

export interface WorldOptions {
  serviceUrl: string;
  auth: WorldAuth | null;
  /** Einstellung „Freunde & Nachrichten“ */
  enabled(): Promise<boolean>;
  /** Ist ein Fenster sichtbar? (30 s statt 2 Minuten) */
  visible?(): boolean;
  onUpdate?(overview: WorldsOverview): void;
  onEvent?(event: WorldEvent): void;
  /**
   * Weitere Welten für die Liste (ab Dienst 1.13.0: dauerhafte Welten von Freunden bzw. als Operator, mit
   * {@code hosted}); geöffnete Welten mit demselben Code gehen vor. Ändert sich etwas: {@link WorldClient.extrasChanged}.
   */
  extraWorlds?(): FriendWorld[];
  log?(line: string): void;
}

const message = (error: unknown) => (error instanceof Error && error.message ? error.message : 'Unbekannter Fehler beim Heldix-Dienst.');

export function emptyWorlds(status: WorldsOverview['status'], error: string | null = null): WorldsOverview {
  return { status, error, friends: [] };
}

function sortWorlds(worlds: FriendWorld[]): FriendWorld[] {
  return worlds.sort((a, b) => a.host.name.localeCompare(b.host.name, 'de', { sensitivity: 'base' }) || a.name.localeCompare(b.name, 'de'));
}

export class WorldClient {
  private readonly base: string;
  private overview: WorldsOverview = emptyWorlds('off');
  private lastSent = '';
  private unsupportedUntil = 0;
  private baseline: { account: string; ids: Set<string> } | null = null;
  private running: Promise<WorldsOverview> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private readonly publicCache = new Map<string, { until: number; value: PublicWorldView | null; error?: ServiceError }>();
  private readonly publicLoads = new Map<string, Promise<PublicWorldView>>();
  private mine: OwnWorld[] = [];
  /** geöffnete Welten laut Dienst und Echtzeit (ohne die weiteren aus extraWorlds) */
  private open: FriendWorld[] = [];

  constructor(private readonly options: WorldOptions) {
    this.base = serviceBase(options.serviceUrl ?? '');
  }

  get current(): WorldsOverview {
    return this.overview;
  }

  /** Regelmäßig abfragen (erste Abfrage nach kurzer Zeit, damit der Start nicht wartet). */
  start(firstDelayMs = 3000): void {
    this.started = true;
    this.schedule(firstDelayMs);
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delay?: number): void {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    const ms = delay ?? (this.options.visible?.() === false ? WORLD_POLL_HIDDEN_MS : WORLD_POLL_VISIBLE_MS);
    this.timer = setTimeout(() => void this.refresh().catch(() => undefined), ms);
    this.timer.unref?.();
  }

  /** geöffnete Welten plus die weiteren (dauerhafte Welten), ohne doppelte Codes */
  private merged(open: FriendWorld[]): FriendWorld[] {
    let extra: FriendWorld[] = [];
    try {
      extra = this.options.extraWorlds?.() ?? [];
    } catch {
      extra = [];
    }
    if (extra.length === 0) return open;
    const codes = new Set(open.map((w) => w.code));
    const list = [...open];
    for (const world of extra) {
      if (codes.has(world.code)) continue;
      codes.add(world.code);
      list.push(world);
    }
    return sortWorlds(list);
  }

  /** dauerhafte Welten haben sich geändert (hosting-state, Entdecken): Liste neu zusammensetzen */
  extrasChanged(): void {
    if (this.overview.status !== 'ok') return;
    this.publish({ ...this.overview, friends: this.merged(this.open) });
  }

  private publish(next: WorldsOverview): WorldsOverview {
    this.overview = next;
    const json = JSON.stringify(next);
    if (json !== this.lastSent) {
      this.lastSent = json;
      this.options.onUpdate?.(next);
    }
    return next;
  }

  /** Neu laden; läuft schon eine Abfrage, gibt es deren Ergebnis. */
  refresh(): Promise<WorldsOverview> {
    this.running ??= this.load().finally(() => {
      this.running = null;
      this.schedule();
    });
    return this.running;
  }

  private async load(): Promise<WorldsOverview> {
    const auth = this.options.auth;
    if (!this.base || !auth) return this.publish(emptyWorlds('off'));
    if (Date.now() < this.unsupportedUntil) return this.publish(emptyWorlds('unsupported'));
    try {
      if (!(await this.options.enabled()) || !(await auth.canAuthenticate())) {
        this.baseline = null;
        return this.publish(emptyWorlds('off'));
      }
    } catch {
      return this.publish(emptyWorlds('off'));
    }
    let raw: unknown;
    try {
      raw = await auth.authed<unknown>('/v1/worlds', {}, { offlineMessage: WORLD_OFFLINE, quiet: true });
    } catch (error) {
      // 404 = Dienst vor 1.12.0, 503 = Welt teilen auf dem Dienst nicht eingerichtet
      if (error instanceof ServiceError && (error.status === 404 || (error.status === 503 && error.message !== SERVICE_UNREACHABLE))) {
        this.unsupportedUntil = Date.now() + UNSUPPORTED_MS;
        this.baseline = null;
        return this.publish(emptyWorlds('unsupported'));
      }
      // letzter Stand bleibt sichtbar, mit Fehler
      return this.publish({ ...this.overview, status: 'error', error: message(error) });
    }
    const list = raw && typeof raw === 'object' && Array.isArray((raw as { friends?: unknown }).friends) ? (raw as { friends: unknown[] }).friends : [];
    const friends = sortWorlds(list.map(mapFriendWorld).filter((w): w is FriendWorld => w !== null));
    const mine = raw && typeof raw === 'object' && Array.isArray((raw as { mine?: unknown }).mine) ? (raw as { mine: unknown[] }).mine : [];
    this.mine = mine.map(mapOwnWorld).filter((w): w is OwnWorld => w !== null);
    const account = await auth.accountId().catch(() => null);
    this.events(account, friends);
    this.open = friends;
    return this.publish({ status: 'ok', error: null, friends: this.merged(friends) });
  }

  /** eigene Welten aus der letzten Abfrage (für „Welt teilen“ im Chat) */
  ownWorlds(): OwnWorld[] {
    return this.mine;
  }

  /**
   * Echtzeit (über die Begleiter-Verbindung): world-open = Welt eines Freundes geöffnet bzw. geändert, world-closed = zu
   * bzw. nicht mehr sichtbar. Neue Welten melden sich als Ereignis wie bei der Abfrage. true = war für die Welten.
   */
  handleRealtime(message: Record<string, unknown>): boolean {
    if (message.type === 'world-open') {
      const world = mapFriendWorld(message.world);
      if (!world || this.overview.status !== 'ok') return true;
      const known = this.open.some((w) => w.id === world.id);
      this.open = sortWorlds([...this.open.filter((w) => w.id !== world.id), world]);
      this.publish({ ...this.overview, friends: this.merged(this.open) });
      if (!known && this.baseline && !this.baseline.ids.has(world.id)) {
        this.baseline.ids.add(world.id);
        this.options.onEvent?.({ kind: 'open', world });
      }
      return true;
    }
    if (message.type === 'world-closed') {
      const id = message.world && typeof message.world === 'object' ? (message.world as { id?: unknown }).id : null;
      if (typeof id !== 'string') return true;
      this.baseline?.ids.delete(id);
      if (this.open.some((w) => w.id === id)) {
        this.open = this.open.filter((w) => w.id !== id);
        this.publish({ ...this.overview, friends: this.merged(this.open) });
      }
      return true;
    }
    return false;
  }

  private events(account: string | null, friends: FriendWorld[]): void {
    const before = this.baseline;
    this.baseline = account ? { account, ids: new Set(friends.map((w) => w.id)) } : null;
    // nie beim ersten Laden (nach dem Start oder Kontowechsel)
    if (!before || !account || before.account !== account) return;
    for (const world of friends) if (!before.ids.has(world.id)) this.options.onEvent?.({ kind: 'open', world });
  }

  /** Offene Welt eines Freundes (Gastgeber-UUID ohne Bindestriche), aus dem letzten Stand */
  worldOf(hostUuid: string): FriendWorld | null {
    return this.overview.friends.find((w) => w.host.uuid === hostUuid) ?? null;
  }

  // ---------- öffentliche Welt-Info ----------

  /** GET /v1/public/worlds/<code>; wirft ServiceError (404 = unbekannt). fresh = am Speicher vorbei. */
  async publicWorld(rawCode: unknown, fresh = false): Promise<PublicWorldView> {
    const code = worldCode(rawCode);
    if (!this.base) throw new Error('Kein Heldix-Dienst eingerichtet.');
    const hit = this.publicCache.get(code);
    if (!fresh && hit && hit.until > Date.now()) {
      if (hit.value) return hit.value;
      if (hit.error) throw hit.error;
    }
    let load = this.publicLoads.get(code);
    if (!load) {
      load = (async () => {
        try {
          const raw = await serviceRequest<unknown>(this.base, `/v1/public/worlds/${code}`, { timeoutMs: 10_000 });
          const value = mapPublicWorld(raw, code);
          // Adresse aus der Liste der Freunde, falls die Antwort keine hat
          if (!value.address) value.address = this.overview.friends.find((w) => w.code === code)?.address ?? null;
          this.remember(code, { until: Date.now() + PUBLIC_WORLD_MS, value });
          return value;
        } catch (error) {
          const failure = error instanceof ServiceError ? error : new ServiceError(message(error), 0);
          this.remember(code, { until: Date.now() + PUBLIC_FAILURE_MS, value: null, error: failure });
          throw failure;
        }
      })().finally(() => this.publicLoads.delete(code));
      this.publicLoads.set(code, load);
    }
    return load;
  }

  /** Welt-Info aus dem Speicher (ohne zu warten); fehlt sie, wird sie im Hintergrund geholt und onReady gerufen. */
  cachedPublicWorld(code: string, onReady?: () => void): PublicWorldView | null {
    if (!WORLD_CODE_RE.test(code) || !this.base) return null;
    const hit = this.publicCache.get(code);
    if (hit && hit.until > Date.now()) return hit.value;
    if (!this.publicLoads.has(code)) {
      void this.publicWorld(code).then(() => onReady?.(), () => onReady?.());
    }
    return hit?.value ?? null;
  }

  private remember(code: string, entry: { until: number; value: PublicWorldView | null; error?: ServiceError }): void {
    this.publicCache.delete(code);
    this.publicCache.set(code, entry);
    while (this.publicCache.size > 100) this.publicCache.delete(this.publicCache.keys().next().value!);
  }
}

/** Fehler beim Laden der öffentlichen Welt-Info: 404 = Welt gibt es nicht (oder Dienst ohne Welt teilen) */
export function isWorldMissing(error: unknown): boolean {
  return error instanceof ServiceError && (error.status === 404 || error.status === 410);
}
