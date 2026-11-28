// Echtzeit-Begleiter des Launchers: WebSocket /v1/ws?client=launcher beim Heldix-Dienst ab 1.12.0 (siehe docs/dienst.md,
// „Echtzeit“). Der Dienst zählt Begleiter NICHT als „online im Spiel“ – online bleibt nur, wer im Spiel ist; der Launcher
// bekommt trotzdem alle Nachrichten (Freunde, Nachrichten, Party, Einladungen, Freischaltungen, Welten) und hält eine
// Party über die Gnadenfrist hinaus am Leben.
//
// - Anmeldung mit dem Token des Dienstes im Header (Authorization: Bearer …), nie in der Adresse und nie im Log.
// - Lebenszeichen: { type: 'ping' } alle 30 s (der Dienst schließt nach 90 s Stille mit 4000).
// - Neu verbinden mit Backoff 1, 2, 5, 10, 30, 60 s (+ bis zu 20 % Zufall, damit nicht alle Launcher gleichzeitig
//   kommen); nach 4001 (Konto gelöscht) und 4003 (gesperrt) erst nach 10 Minuten. Kam die Verbindung gar nicht erst
//   zustande, prüft der Aufrufer vor dem nächsten Versuch das Token (token(true), z. B. 401 → neu anmelden).
// - Solange keine Verbindung steht, fragt core/social.ts wie bisher ab (Rückfall).

export type CompanionState = 'off' | 'connecting' | 'live';

/** Das Nötigste von WebSocket (im Launcher der eingebaute von Node, in Tests eine Attrappe) */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type SocketFactory = (url: string, headers: Record<string, string>) => SocketLike;

/** WebSocket von Node (undici) – nimmt Header als zweites Argument */
export const nodeSocket: SocketFactory = (url, headers) =>
  new WebSocket(url, { headers } as unknown as string[]) as unknown as SocketLike;

export const BACKOFF_MS: readonly number[] = [1000, 2000, 5000, 10_000, 30_000, 60_000];
export const PING_MS = 30_000;
/** nach „Konto gelöscht“ (4001) bzw. „Gesperrt“ (4003) so lange nicht wieder verbinden */
export const BLOCKED_RETRY_MS = 10 * 60_000;
const OPEN = 1;

/** Wartezeit vor dem n-ten erneuten Versuch (0 = erster), mit bis zu 20 % Zufall obendrauf */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = BACKOFF_MS[Math.min(Math.max(0, Math.floor(attempt)), BACKOFF_MS.length - 1)];
  return Math.round(base * (1 + Math.min(1, Math.max(0, random())) * 0.2));
}

/** Adresse des Begleiters: http(s) → ws(s) */
export function companionUrl(base: string): string {
  return `${base.replace(/^http/i, 'ws').replace(/\/+$/, '')}/v1/ws?client=launcher`;
}

export interface CompanionOptions {
  /** Basis-Adresse des Dienstes (http/https) */
  base: string;
  /** Token des Dienstes; retry = der letzte Versuch kam nicht zustande (Token prüfen). Wirft = später noch einmal. */
  token(retry: boolean): Promise<string>;
  onMessage(message: Record<string, unknown>): void;
  onState?(state: CompanionState): void;
  /** Verbindung steht (auch nach jedem Neuverbinden) */
  onOpen?(): void;
  socket?: SocketFactory;
  pingMs?: number;
  random?: () => number;
  log?(line: string): void;
}

export class CompanionSocket {
  private ws: SocketLike | null = null;
  private running = false;
  /** je Start/Stop neu: späte Ereignisse alter Verbindungen fallen weg */
  private generation = 0;
  private attempt = 0;
  private failedBefore = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private current: CompanionState = 'off';

  constructor(private readonly options: CompanionOptions) {}

  get state(): CompanionState {
    return this.current;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    this.failedBefore = false;
    void this.connect(++this.generation);
  }

  stop(): void {
    this.running = false;
    this.generation++;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close(1000, 'Launcher');
    } catch {
      // schon zu
    }
    this.setState('off');
  }

  /** Nachricht an den Dienst (nur bei stehender Verbindung); false = nicht gesendet */
  send(message: Record<string, unknown>): boolean {
    if (!this.ws || this.current !== 'live' || this.ws.readyState !== OPEN) return false;
    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  private setState(state: CompanionState): void {
    if (state === this.current) return;
    this.current = state;
    this.options.onState?.(state);
  }

  private retry(generation: number, delay: number): void {
    if (!this.running || generation !== this.generation) return;
    this.setState('connecting');
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect(generation);
    }, delay);
    this.retryTimer.unref?.();
  }

  private async connect(generation: number): Promise<void> {
    if (!this.running || generation !== this.generation) return;
    this.setState('connecting');
    let token: string;
    try {
      token = await this.options.token(this.failedBefore);
    } catch {
      this.retry(generation, backoffDelay(this.attempt++, this.options.random));
      return;
    }
    if (!this.running || generation !== this.generation) return;
    let ws: SocketLike;
    try {
      ws = (this.options.socket ?? nodeSocket)(companionUrl(this.options.base), { authorization: `Bearer ${token}` });
    } catch {
      this.failedBefore = true;
      this.retry(generation, backoffDelay(this.attempt++, this.options.random));
      return;
    }
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      if (!this.running || generation !== this.generation || this.ws !== ws) {
        try {
          ws.close(1000, 'Launcher');
        } catch {
          // egal
        }
        return;
      }
      opened = true;
      this.attempt = 0;
      this.failedBefore = false;
      this.setState('live');
      this.startPing(ws);
      try {
        this.options.onOpen?.();
      } catch (error) {
        this.options.log?.(`Echtzeit: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    ws.onmessage = (event) => {
      if (generation !== this.generation || this.ws !== ws) return;
      const message = parseMessage(event.data);
      if (!message || message.type === 'pong') return;
      try {
        this.options.onMessage(message);
      } catch (error) {
        this.options.log?.(`Echtzeit-Nachricht „${String(message.type)}“: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    ws.onerror = () => {
      // danach kommt close
    };
    ws.onclose = (event) => {
      if (this.ws === ws) this.ws = null;
      this.stopPing();
      if (!this.running || generation !== this.generation) return;
      if (!opened) this.failedBefore = true;
      const code = typeof event?.code === 'number' ? event.code : 1006;
      if (code === 4001 || code === 4003) {
        this.options.log?.(code === 4001 ? 'Echtzeit: Konto beim Heldix-Dienst gelöscht' : 'Echtzeit: beim Heldix-Dienst gesperrt');
        this.retry(generation, BLOCKED_RETRY_MS);
        return;
      }
      this.retry(generation, backoffDelay(this.attempt++, this.options.random));
    };
  }

  private startPing(ws: SocketLike): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws !== ws || ws.readyState !== OPEN) return;
      try {
        ws.send(JSON.stringify({ type: 'ping' }));
      } catch {
        // close folgt
      }
    }, this.options.pingMs ?? PING_MS);
    this.pingTimer.unref?.();
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
}

/** JSON-Objekt aus einer Textnachricht, sonst null (Binärdaten, Unsinn, zu groß) */
export function parseMessage(data: unknown): Record<string, unknown> | null {
  const text = typeof data === 'string' ? data : data instanceof Buffer ? data.toString('utf8') : null;
  if (text === null || text.length > 1024 * 1024) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { type?: unknown }).type === 'string' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
