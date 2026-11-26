// Konto-Wechsel im Spiel: Die HeldixClient-Mod spricht über stdin/stdout mit dem Launcher, der sie gestartet hat.
// Protokoll: docs/konto-wechsel.md. Kein Netzwerk-Port, kein Geheimnis in Argumenten oder Umgebung – nur der
// Elternprozess hält das Schreib-Ende von stdin des Spiels.
//
//   Spiel → Launcher: eine Zeile auf stdout  "\u0001heldix-ipc {json}\n"  (der Launcher schneidet sie aus der Ausgabe,
//                     sie erscheint nie in der Konsole, in der Absturz-Hilfe oder in Support-Anfragen)
//   Launcher → Spiel: eine JSON-Zeile auf stdin

import type { AccountInfo, LogLevel } from '../../shared/api';
import type { GameAccount } from './launch';

export const IPC_MARKER = '\u0001heldix-ipc ';
export const IPC_PROTOCOL = 1;
/** längste erlaubte Anfrage (JSON ohne Marker); echte Anfragen sind unter 200 Zeichen */
export const IPC_MAX_LINE = 4096;
/** Schalter für die Client-Mod: Ihr Launcher beantwortet Anfragen auf stdin (ohne ihn bleibt der Konto-Wechsel aus) */
export const IPC_JVM_FLAG = `-Dheldixclient.ipc=${IPC_PROTOCOL}`;

// ---------- Marker-Zeilen aus der Spielausgabe schneiden ----------

const MARK = IPC_MARKER[0];

/**
 * Schneidet Marker-Zeilen aus dem Text der Spielausgabe – auch wenn sie über mehrere Blöcke verteilt ankommen oder
 * mitten in einem Log-Ereignis landen (zwei Threads schreiben auf dieselbe Ausgabe). Alles andere geht unverändert
 * weiter. Zu lange Marker-Zeilen werden verworfen, ohne sie zu puffern.
 */
export class IpcLineFilter {
  /** zurückgehalten: Anfang eines Markers oder eine Marker-Zeile ohne Zeilenende */
  private carry = '';
  /** in einer zu langen Marker-Zeile: alles bis zum Zeilenende verwerfen */
  private skipping = false;

  constructor(
    private readonly onMessage: (json: string) => void,
    private readonly onOversized: () => void = () => undefined,
    private readonly maxLine = IPC_MAX_LINE,
  ) {}

  /** Text ohne Marker-Zeilen */
  push(chunk: string): string {
    let data = this.carry + chunk;
    this.carry = '';
    let out = '';
    for (;;) {
      if (this.skipping) {
        const newline = data.indexOf('\n');
        if (newline === -1) return out;
        data = data.slice(newline + 1);
        this.skipping = false;
      }
      const start = data.indexOf(MARK);
      if (start === -1) return out + data;
      const tail = data.slice(start, start + IPC_MARKER.length);
      if (tail.length < IPC_MARKER.length && IPC_MARKER.startsWith(tail)) {
        // vielleicht der Anfang eines Markers: auf den nächsten Block warten
        this.carry = data.slice(start);
        return out + data.slice(0, start);
      }
      if (tail !== IPC_MARKER) {
        out += data.slice(0, start + 1);
        data = data.slice(start + 1);
        continue;
      }
      out += data.slice(0, start);
      const rest = data.slice(start + IPC_MARKER.length);
      const newline = rest.indexOf('\n');
      if (newline === -1) {
        if (rest.length > this.maxLine) {
          this.skipping = true;
          this.onOversized();
        } else {
          this.carry = data.slice(start);
        }
        return out;
      }
      const line = rest.slice(0, newline).replace(/\r$/, '');
      if (line.length > this.maxLine) this.onOversized();
      else this.onMessage(line);
      data = rest.slice(newline + 1);
    }
  }

  /** Ende der Ausgabe: angefangene Marker-Zeilen verwerfen, angefangene Nicht-Marker zurückgeben */
  flush(): string {
    const rest = this.carry;
    this.carry = '';
    this.skipping = false;
    return rest.startsWith(IPC_MARKER) ? '' : rest;
  }
}

// ---------- Anfragen des Spiels beantworten ----------

export type IpcErrorCode =
  | 'bad_request'
  | 'unknown_op'
  | 'not_found'
  | 'rate_limited'
  | 'busy'
  | 'cancelled'
  | 'not_allowed'
  | 'session_failed'
  | 'sign_in_failed'
  | 'unavailable'
  | 'internal';

const NOT_ALLOWED = 'Kontowechsel im Spiel ist im Launcher ausgeschaltet (Einstellungen → Spiel).';

export class IpcError extends Error {
  constructor(readonly code: IpcErrorCode, message: string) {
    super(message);
  }
}

export interface AccountBridgeDeps {
  /** Konten, die diese App nutzen darf (fertige App: ohne Offline-Konten) */
  listAccounts(): Promise<AccountInfo[]>;
  /** gültige Sitzung für ein Konto (bei Bedarf erneuert) */
  session(accountId: string): Promise<GameAccount>;
  /** normale Microsoft-Anmeldung des Launchers; das neue Konto wird nicht aktiv (das entscheidet das Spiel) */
  signIn(): Promise<AccountInfo>;
  /** Konto im Launcher aktiv machen (der nächste Start nutzt es) */
  setActive(accountId: string): Promise<void>;
  /** Einstellung „Kontowechsel im Spiel erlauben“ (bei jeder Anfrage neu gelesen) */
  allowed(): Promise<boolean>;
  /**
   * Fenster im Launcher „Im Spiel zu <Name> wechseln?“ (über allem, mit Fokus): true = Wechseln. Gefragt wird beim
   * ersten Wechsel zu einem Konto in diesem Spiel – nicht für das Startkonto und nicht für Konten, die im Spiel gerade
   * angemeldet wurden (das Anmeldefenster ist die Bestätigung).
   */
  confirmSwitch(account: AccountInfo): Promise<boolean>;
  /** Konto, mit dem dieses Spiel gestartet wurde (braucht keine Bestätigung) */
  launchedAccountId: string | null;
  offlineAllowed(): boolean;
  launcherVersion: string;
  /** Protokoll-Zeile für die Konsole des Launchers – nie mit Tokens */
  log(text: string, level?: LogLevel): void;
  now?(): number;
}

interface Window {
  max: number;
  ms: number;
}

export interface BridgeLimits {
  /** alle Anfragen zusammen */
  requests: Window;
  /** Sitzungen (Zugangs-Tokens): jede Grenze muss passen */
  sessions: Window[];
  /** Anmeldungen (Microsoft-Fenster) */
  signIns: Window;
  /** Bestätigungsfenster (ein Spiel soll den Launcher nicht mit Fenstern zuschütten) */
  confirms: Window;
  /** gleichzeitig offene Anfragen */
  inFlight: number;
}

export const DEFAULT_LIMITS: BridgeLimits = {
  requests: { max: 30, ms: 10_000 },
  sessions: [{ max: 4, ms: 60_000 }, { max: 20, ms: 60 * 60_000 }],
  signIns: { max: 3, ms: 10 * 60_000 },
  confirms: { max: 3, ms: 10 * 60_000 },
  inFlight: 4,
};

const OPS = ['hello', 'accounts.list', 'accounts.session', 'accounts.add', 'accounts.setActive'] as const;
type Op = (typeof OPS)[number];
const PARAMS: Record<Op, readonly string[]> = {
  hello: [],
  'accounts.list': [],
  'accounts.session': ['account'],
  'accounts.add': [],
  'accounts.setActive': ['account'],
};
const REQUEST_KEYS = new Set(['v', 'id', 'op', 'params']);
const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ID = 2_147_483_647;

interface Request {
  id: number;
  op: Op;
  account?: string;
}

type Parsed = { ok: true; request: Request } | { ok: false; id: number | null; error: IpcError };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** Prüft eine Anfrage streng: nur bekannte Felder, ganze IDs, bekannte Operationen, Konto-IDs im UUID-Format. */
export function parseRequest(raw: string): Parsed {
  const bad = (id: number | null, message: string): Parsed => ({ ok: false, id, error: new IpcError('bad_request', message) });
  if (raw.length > IPC_MAX_LINE) return bad(null, 'Anfrage zu lang');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return bad(null, 'kein gültiges JSON');
  }
  if (!isPlainObject(value)) return bad(null, 'Anfrage ist kein Objekt');
  const rawId = value.id;
  const id = typeof rawId === 'number' && Number.isInteger(rawId) && rawId >= 1 && rawId <= MAX_ID ? rawId : null;
  if (id === null) return bad(null, 'ungültige Anfrage-ID');
  if (value.v !== IPC_PROTOCOL) return bad(id, `Protokoll ${String(value.v)} wird nicht unterstützt (Launcher: ${IPC_PROTOCOL})`);
  for (const key of Object.keys(value)) if (!REQUEST_KEYS.has(key)) return bad(id, `unbekanntes Feld „${key.slice(0, 40)}“`);
  const op = value.op;
  if (typeof op !== 'string' || !(OPS as readonly string[]).includes(op)) {
    return { ok: false, id, error: new IpcError('unknown_op', `unbekannte Operation „${String(op).slice(0, 40)}“`) };
  }
  const params = value.params ?? {};
  if (!isPlainObject(params)) return bad(id, 'params ist kein Objekt');
  const allowed = PARAMS[op as Op];
  for (const key of Object.keys(params)) if (!allowed.includes(key)) return bad(id, `unbekannter Parameter „${key.slice(0, 40)}“`);
  const request: Request = { id, op: op as Op };
  if (allowed.includes('account')) {
    const account = params.account;
    if (typeof account !== 'string' || !ACCOUNT_ID.test(account)) return bad(id, 'ungültige Konto-ID');
    request.account = account.toLowerCase();
  }
  return { ok: true, request };
}

/** Fehlertext für Spiel und Konsole: ohne Steuerzeichen, gekürzt, ohne alles, was nach einem Token aussieht */
export function safeMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .replace(/eyJ[\w-]*(\.[\w-]*){0,2}/g, '[…]')
    .replace(/[A-Za-z0-9+/_=-]{40,}/g, '[…]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 300);
}

/** Konto für das Spiel: ohne Tokens, nur was die Liste braucht */
function publicAccount(account: AccountInfo): Record<string, unknown> {
  const out: Record<string, unknown> = { id: account.id, name: account.name, uuid: account.uuid, type: account.type, active: account.active };
  if (typeof account.skinUrl === 'string' && /^https?:\/\/[^\s"]{1,300}$/.test(account.skinUrl)) out.skinUrl = account.skinUrl;
  return out;
}

class SlidingWindow {
  private readonly times: number[] = [];

  constructor(private readonly window: Window) {}

  /** Platz frei? (ohne zu zählen) */
  free(now: number): boolean {
    while (this.times.length && this.times[0] <= now - this.window.ms) this.times.shift();
    return this.times.length < this.window.max;
  }

  take(now: number): void {
    this.times.push(now);
  }
}

/**
 * Beantwortet die Anfragen eines laufenden Spiels. Eine Brücke gehört zu genau einem Spielprozess (write schreibt auf
 * dessen stdin) und wird beim Spielende verworfen. Zugangs-Tokens gehen nur in der Antwort auf accounts.session an
 * das Spiel, nie in die Konsole; Refresh-Tokens verlassen den Launcher nie.
 */
export class AccountBridge {
  private readonly requests: SlidingWindow;
  private readonly sessions: SlidingWindow[];
  private readonly signIns: SlidingWindow;
  private readonly confirms: SlidingWindow;
  private readonly inFlight = new Set<number>();
  /**
   * Konten, deren Sitzung das Spiel ohne Nachfrage bekommt (nur für diesen Spielprozess): das Startkonto, bestätigte
   * und im Spiel angemeldete Konten
   */
  private readonly trusted = new Set<string>();
  /** offene Bestätigung (höchstens eine; weitere Anfragen für dasselbe Konto warten mit) */
  private confirming: { id: string; answer: Promise<boolean> } | null = null;
  private signingIn = false;
  private helloSeen = false;
  private disposed = false;
  private changeTimer: NodeJS.Timeout | null = null;
  /** Warnungen in der Konsole begrenzen (ein Spiel, das Anfragen flutet, soll die Konsole nicht fluten) */
  private readonly warnings = new SlidingWindow({ max: 10, ms: 60_000 });
  private suppressed = 0;

  constructor(
    private readonly deps: AccountBridgeDeps,
    private readonly write: (line: string) => boolean | void,
    private readonly limits: BridgeLimits = DEFAULT_LIMITS,
  ) {
    this.requests = new SlidingWindow(limits.requests);
    this.sessions = limits.sessions.map((w) => new SlidingWindow(w));
    this.signIns = new SlidingWindow(limits.signIns);
    this.confirms = new SlidingWindow(limits.confirms);
    if (deps.launchedAccountId) this.trusted.add(deps.launchedAccountId.toLowerCase());
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Eine Marker-Zeile (ohne Marker) vom Spiel */
  handle(raw: string): void {
    if (this.disposed) return;
    const parsed = parseRequest(raw);
    // jede Zeile zählt (auch ungültige); darüber hinaus nur noch kurze Absagen für gültige IDs
    const now = this.now();
    if (!this.requests.free(now)) {
      this.warn('zu viele Anfragen – abgelehnt');
      if (parsed.ok) this.reply(parsed.request.id, new IpcError('rate_limited', 'Zu viele Anfragen – bitte kurz warten.'));
      return;
    }
    this.requests.take(now);
    if (!parsed.ok) {
      this.warn(`ungültige Anfrage verworfen (${parsed.error.message})`);
      this.reply(parsed.id, parsed.error);
      return;
    }
    const { request } = parsed;
    if (this.inFlight.has(request.id)) {
      this.reply(request.id, new IpcError('bad_request', 'Diese Anfrage-ID ist schon in Arbeit.'));
      return;
    }
    if (this.inFlight.size >= this.limits.inFlight) {
      this.reply(request.id, new IpcError('busy', 'Der Launcher ist noch mit anderen Anfragen beschäftigt.'));
      return;
    }
    this.inFlight.add(request.id);
    this.dispatch(request)
      .then(
        (result) => this.reply(request.id, null, result),
        (error: unknown) => this.reply(request.id, error instanceof IpcError ? error : new IpcError('internal', safeMessage(error))),
      )
      .finally(() => this.inFlight.delete(request.id));
  }

  /** Zeile verworfen, bevor sie hier ankam (zu lang oder auf stderr) */
  rejected(reason: 'oversized' | 'stderr'): void {
    if (this.disposed) return;
    this.warn(reason === 'oversized' ? 'zu lange Anfrage verworfen' : 'Anfrage auf stderr ignoriert');
  }

  /** Konten haben sich im Launcher geändert: dem Spiel Bescheid sagen (gebündelt, erst nach hello) */
  notifyChanged(): void {
    if (this.disposed || !this.helloSeen || this.changeTimer) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      if (!this.disposed) this.send({ v: IPC_PROTOCOL, event: 'accounts.changed' });
    }, 150);
  }

  /** Spiel beendet: nichts mehr schreiben */
  dispose(): void {
    this.disposed = true;
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.changeTimer = null;
  }

  private async dispatch(request: Request): Promise<unknown> {
    const { deps } = this;
    switch (request.op) {
      case 'hello':
        this.helloSeen = true;
        return { protocol: IPC_PROTOCOL, launcher: deps.launcherVersion, offline: deps.offlineAllowed(), allowed: await deps.allowed() };
      case 'accounts.list':
        return { accounts: (await this.usable()).map(publicAccount), allowed: await deps.allowed() };
      case 'accounts.session':
        await this.requireAllowed();
        return this.session(request.account!);
      case 'accounts.add':
        await this.requireAllowed();
        return this.signIn();
      case 'accounts.setActive': {
        await this.requireAllowed();
        const account = await this.find(request.account!);
        // nur Konten, zu denen in diesem Spiel schon gewechselt werden durfte (sonst ginge es an der Bestätigung vorbei)
        if (!this.trusted.has(account.id.toLowerCase())) {
          this.warn(`„${account.name}“ nicht aktiv gesetzt: im Spiel noch nicht gewechselt`);
          throw new IpcError('not_allowed', 'Wechsle zuerst im Spiel zu diesem Konto.');
        }
        await deps.setActive(account.id);
        deps.log(`„${account.name}“ ist jetzt das aktive Konto (Wechsel im Spiel)`);
        return { accounts: (await this.usable()).map(publicAccount) };
      }
    }
  }

  private async requireAllowed(): Promise<void> {
    if (!(await this.deps.allowed())) throw new IpcError('not_allowed', NOT_ALLOWED);
  }

  /** Erster Wechsel zu einem Konto in diesem Spiel: im Launcher bestätigen lassen */
  private async ensureConfirmed(account: AccountInfo): Promise<void> {
    const id = account.id.toLowerCase();
    if (this.trusted.has(id)) return;
    let pending = this.confirming;
    if (pending && pending.id !== id) throw new IpcError('busy', 'Im Launcher wartet schon eine Bestätigung.');
    if (!pending) {
      const now = this.now();
      if (!this.confirms.free(now)) {
        this.warn(`Wechsel zu „${account.name}“ abgelehnt: zu viele Nachfragen in kurzer Zeit`);
        throw new IpcError('rate_limited', 'Zu viele Kontowechsel in kurzer Zeit – bitte kurz warten.');
      }
      this.confirms.take(now);
      this.deps.log(`Bestätigung für den Wechsel zu „${account.name}“ angefragt`);
      const answer = this.deps.confirmSwitch(account).catch(() => false);
      pending = { id, answer };
      this.confirming = pending;
      void answer.finally(() => {
        if (this.confirming === pending) this.confirming = null;
      });
      const ok = await answer;
      if (ok) this.trusted.add(id);
      this.deps.log(ok ? `Wechsel zu „${account.name}“ bestätigt` : `Wechsel zu „${account.name}“ abgelehnt`, ok ? 'INFO' : 'WARN');
    }
    if (!(await pending.answer)) throw new IpcError('cancelled', 'Wechsel im Launcher abgebrochen.');
  }

  private async usable(): Promise<AccountInfo[]> {
    const list = await this.deps.listAccounts();
    return this.deps.offlineAllowed() ? list : list.filter((a) => a.type !== 'offline');
  }

  private async find(id: string): Promise<AccountInfo> {
    const account = (await this.usable()).find((a) => a.id.toLowerCase() === id);
    if (!account) throw new IpcError('not_found', 'Dieses Konto gibt es im Launcher nicht (mehr).');
    return account;
  }

  private async session(id: string): Promise<unknown> {
    const account = await this.find(id);
    const now = this.now();
    if (!this.sessions.every((w) => w.free(now))) {
      this.warn(`Sitzung für „${account.name}“ abgelehnt: zu viele Kontowechsel in kurzer Zeit`);
      throw new IpcError('rate_limited', 'Zu viele Kontowechsel in kurzer Zeit – bitte kurz warten.');
    }
    for (const w of this.sessions) w.take(now);
    this.deps.log(`Kontowechsel zu „${account.name}“ angefordert`);
    await this.ensureConfirmed(account);
    let session: GameAccount;
    try {
      session = await this.deps.session(account.id);
    } catch (error) {
      const message = safeMessage(error);
      this.deps.log(`Sitzung für „${account.name}“ nicht verfügbar: ${message}`, 'WARN');
      throw new IpcError('session_failed', message);
    }
    if (session.uuid.replace(/-/g, '').toLowerCase() !== account.uuid.replace(/-/g, '').toLowerCase()) {
      throw new IpcError('session_failed', 'Die Sitzung passt nicht zu diesem Konto.');
    }
    this.deps.log(`Sitzung für „${session.name}“ an das Spiel übergeben`);
    const result: Record<string, unknown> = {
      name: session.name,
      uuid: session.uuid.replace(/-/g, '').toLowerCase(),
      accessToken: session.accessToken,
      userType: session.userType,
    };
    if (session.xuid && /^\d{1,20}$/.test(session.xuid)) result.xuid = session.xuid;
    return result;
  }

  private async signIn(): Promise<unknown> {
    if (this.signingIn) throw new IpcError('busy', 'Die Anmeldung läuft schon.');
    const now = this.now();
    if (!this.signIns.free(now)) throw new IpcError('rate_limited', 'Zu viele Anmeldungen in kurzer Zeit – bitte kurz warten.');
    this.signIns.take(now);
    this.signingIn = true;
    this.deps.log('Microsoft-Anmeldung aus dem Spiel gestartet');
    try {
      const account = await this.deps.signIn();
      // gerade im Anmeldefenster bestätigt: Wechsel dorthin ohne weitere Nachfrage
      this.trusted.add(account.id.toLowerCase());
      this.deps.log(`„${account.name}“ im Spiel hinzugefügt`);
      return { account: publicAccount(account), accounts: (await this.usable()).map(publicAccount) };
    } catch (error) {
      if (error instanceof IpcError) throw error;
      const message = safeMessage(error);
      if (/abgebrochen/i.test(message)) {
        this.deps.log('Microsoft-Anmeldung aus dem Spiel abgebrochen');
        throw new IpcError('cancelled', 'Anmeldung abgebrochen.');
      }
      this.deps.log(`Microsoft-Anmeldung aus dem Spiel fehlgeschlagen: ${message}`, 'WARN');
      throw new IpcError('sign_in_failed', message);
    } finally {
      this.signingIn = false;
    }
  }

  private reply(id: number | null, error: IpcError | null, result?: unknown): void {
    if (this.disposed) return;
    if (error) this.send({ v: IPC_PROTOCOL, id, ok: false, error: { code: error.code, message: safeMessage(error) } });
    else this.send({ v: IPC_PROTOCOL, id, ok: true, result: result ?? {} });
  }

  private send(message: unknown): void {
    try {
      this.write(JSON.stringify(message));
    } catch {
      // Spiel schon beendet
    }
  }

  private warn(text: string): void {
    const now = this.now();
    if (this.warnings.free(now)) {
      this.warnings.take(now);
      const more = this.suppressed ? ` (dazu ${this.suppressed} weitere seit der letzten Meldung)` : '';
      this.suppressed = 0;
      this.deps.log(`${text}${more}`, 'WARN');
    } else {
      this.suppressed++;
    }
  }
}
