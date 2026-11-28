// Welt-Relay (ab 1.12.0): eigener TCP-Listener für Minecraft-Verbindungen auf `<code>.<Welt-Domain>` (Standard-Port
// 25565, nicht über Caddy). Liest nur Handshake und Login Start bzw. beantwortet Serverlisten-Abfragen für Welten, die
// gerade zu sind, selbst; alles andere reicht worlds.ts über einen Datenstrom zum Gastgeber durch. IP-Adressen zählen nur
// im Arbeitsspeicher für die Grenzen, sie gehen weder an den Gastgeber noch in die Datenbank oder ein Log.
import { createServer, type Server, type Socket } from 'node:net';
import { RateLimiter } from './limits';
import {
  LEGACY_PING,
  loginDisconnect,
  MAX_HANDSHAKE_PACKET,
  MAX_LOGIN_PACKET,
  MAX_STATUS_PACKET,
  parseHandshake,
  parseLoginStart,
  pongResponse,
  ProtocolError,
  readPacket,
  statusResponse,
  textComponent,
  type Handshake,
  type StatusInfo,
} from './minecraft-protocol';
import { isName } from './validate';
import { STATUS_UNKNOWN, statusOffline, TEXT_BAD_NAME, TEXT_UNKNOWN, WORLD_CODE_RE, type RelayTarget, type Worlds } from './worlds';

export interface RelayOptions {
  /** Welt-Domain (wie bei Worlds). */
  domain: string;
  /** Webseite für die Werbezeile in der Serverliste (z. B. „heldixclient.com“), null = ohne. */
  site?: string | null;
  /** Handshake (und Login Start bzw. Status-Abfrage und Ping) müssen so schnell ankommen (Standard 5 s). */
  handshakeTimeoutMs: number;
  /** Neue Verbindungen je IP und Minute (Standard 20). */
  connectionsPerMinute: number;
  /** Gleichzeitige Verbindungen je IP (Standard 16) und insgesamt (Standard 2000). */
  maxConnectionsPerIp: number;
  maxConnections: number;
  log: (line: string) => void;
}

/**
 * Eigene Beschreibung in der Serverliste (Welt zu oder unbekannt): der Hinweis grau, darunter als Werbung
 * „Geteilt mit HeldixClient · <Webseite>“ – sieht jeder, der die Adresse gespeichert hat, auch ohne HeldixClient.
 */
export function brandedDescription(text: string, site: string | null): Record<string, unknown> {
  const extra: Record<string, string>[] = [
    { text: '\n' },
    { text: 'Geteilt mit ', color: 'dark_aqua' },
    { text: 'HeldixClient', color: 'aqua' },
  ];
  if (site) extra.push({ text: ' · ', color: 'dark_gray' }, { text: site, color: 'gray' });
  return { text, color: 'gray', extra };
}

/** Mehr Bytes vor dem Durchreichen braucht kein Client (Handshake + Login Start). */
const MAX_PRE_RELAY_BYTES = 4096;

/**
 * Schlüssel für die Grenzen je IP: IPv4 (auch als `::ffff:` geschrieben) ganz, IPv6 nur die ersten 64 Bit (ein
 * Anschluss bekommt meist ein ganzes /64).
 */
export function ipKey(address: string | undefined): string {
  if (!address) return 'unbekannt';
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (v4) return v4[1]!;
  const [head = '', tail = ''] = address.toLowerCase().split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === '' ? [] : tail.split(':');
  const groups = address.includes('::') ? [...left, ...new Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

export class WorldRelay {
  readonly server: Server;
  private readonly limiter: RateLimiter;
  private readonly perIp = new Map<string, number>();
  private readonly sockets = new Set<Socket>();
  private closing = false;
  private readonly suffix: string;

  constructor(
    private readonly worlds: Worlds,
    private readonly options: RelayOptions,
  ) {
    this.limiter = new RateLimiter(options.connectionsPerMinute, 60_000);
    this.suffix = `.${options.domain}`;
    this.server = createServer({ noDelay: true }, (socket) => this.onConnection(socket));
  }

  /** Code aus der Adresse `<code>.<Welt-Domain>` oder null. */
  codeOf(address: string): string | null {
    if (!address.endsWith(this.suffix)) return null;
    const code = address.slice(0, -this.suffix.length);
    return WORLD_CODE_RE.test(code) ? code : null;
  }

  private onConnection(socket: Socket): void {
    const key = ipKey(socket.remoteAddress);
    const open = this.perIp.get(key) ?? 0;
    if (this.closing || this.sockets.size >= this.options.maxConnections || open >= this.options.maxConnectionsPerIp || !this.limiter.take(key).ok) {
      socket.destroy();
      return;
    }
    this.perIp.set(key, open + 1);
    this.sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      this.sockets.delete(socket);
      const left = (this.perIp.get(key) ?? 1) - 1;
      if (left <= 0) this.perIp.delete(key);
      else this.perIp.set(key, left);
    });
    this.handshake(socket);
  }

  /**
   * Bis zum Durchreichen: Handshake lesen, dann je nach Zustand Login Start lesen (prüfen, ablehnen oder durchreichen)
   * oder die Serverliste bedienen (an den Gastgeber oder selbst antworten). Teilpakete werden gesammelt, Müll schließt.
   */
  private handshake(socket: Socket): void {
    let buffer: Buffer = Buffer.alloc(0);
    let offset = 0;
    let phase: 'handshake' | 'login' | 'status' = 'handshake';
    let hello: Handshake | null = null;
    let target: RelayTarget | null = null;
    let answered = false;
    const deadline = setTimeout(() => socket.destroy(), this.options.handshakeTimeoutMs);
    deadline.unref();

    const finish = () => {
      clearTimeout(deadline);
      socket.removeListener('data', onData);
      socket.removeListener('end', onEnd);
    };
    const refuse = (text: string) => {
      finish();
      socket.end(loginDisconnect(text));
      setTimeout(() => socket.destroy(), 1000).unref();
    };
    const step = () => {
      for (;;) {
        if (phase === 'handshake') {
          // Server-Listen-Ping von Minecraft vor 1.7: nicht unterstützt
          if (buffer[0] === LEGACY_PING) {
            finish();
            socket.destroy();
            return;
          }
          const packet = readPacket(buffer, offset, MAX_HANDSHAKE_PACKET);
          if (packet === null) return;
          hello = parseHandshake(packet);
          offset = packet.end;
          target = this.worlds.resolve(this.codeOf(hello.address));
          if (hello.next === 1) {
            const session = target?.session ?? null;
            if (session !== null && this.worlds.canStreamStatus(session)) {
              finish();
              this.worlds.openStream(session, socket, buffer, 'status', null);
              return;
            }
            phase = 'status';
          } else {
            phase = 'login';
          }
          continue;
        }
        if (phase === 'login') {
          const packet = readPacket(buffer, offset, MAX_LOGIN_PACKET);
          if (packet === null) return;
          const name = parseLoginStart(packet);
          offset = packet.end;
          if (!isName(name)) return refuse(TEXT_BAD_NAME);
          if (target === null) return refuse(TEXT_UNKNOWN);
          const refused = this.worlds.admit(target, name);
          if (refused !== null) return refuse(refused);
          finish();
          this.worlds.openStream(target.session!, socket, buffer, 'login', name);
          return;
        }
        // Serverliste selbst beantworten: Status-Anfrage (leer), dann Ping mit 8 Byte → Pong und schließen.
        const packet = readPacket(buffer, offset, MAX_STATUS_PACKET);
        if (packet === null) return;
        offset = packet.end;
        if (packet.id === 0x00 && packet.data.length === 0 && !answered) {
          answered = true;
          socket.write(statusResponse(this.statusFor(target, hello!.protocol)));
          continue;
        }
        if (packet.id === 0x01 && packet.data.length === 8) {
          finish();
          socket.end(pongResponse(packet.data));
          setTimeout(() => socket.destroy(), 1000).unref();
          return;
        }
        throw new ProtocolError('unerwartetes Paket');
      }
    };
    const onData = (chunk: Buffer) => {
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_PRE_RELAY_BYTES) {
        finish();
        socket.destroy();
        return;
      }
      try {
        step();
      } catch (err) {
        finish();
        socket.destroy();
        // Ungültige Daten sind normal (Scanner); nur echte Fehler ins Log, ohne Inhalte und ohne IP.
        if (!(err instanceof ProtocolError)) this.options.log(`Welt-Relay: interner Fehler (${(err as Error)?.message ?? String(err)}).`);
      }
    };
    const onEnd = () => {
      finish();
      socket.destroy();
    };
    socket.on('data', onData);
    socket.on('end', onEnd);
  }

  /** Eigene Status-Antwort: unbekannte Welt, Welt zu, oder geöffnet bei zu vielen Abfragen (dann wie beim Gastgeber). */
  private statusFor(target: RelayTarget | null, protocol: number): StatusInfo {
    const online = target === null ? null : this.worlds.onlineStatus(target);
    if (online !== null) {
      return { versionName: online.version, protocol: online.protocol, online: online.players, max: online.maxPlayers, description: textComponent(online.motd) };
    }
    const text = target === null ? STATUS_UNKNOWN : statusOffline(target.ownerName);
    return { versionName: 'HeldixClient', protocol, online: 0, max: 0, description: brandedDescription(text, this.options.site ?? null) };
  }

  /** Abgelaufene Zähler je IP vergessen. */
  sweep(now = Date.now()): void {
    this.limiter.sweep(now);
  }

  /** Beim Herunterfahren: keine neuen Verbindungen, alle offenen sofort trennen. */
  close(): Promise<void> {
    this.closing = true;
    return new Promise((resolve) => {
      if (!this.server.listening) {
        resolve();
      } else {
        this.server.close(() => resolve());
      }
      for (const socket of this.sockets) socket.destroy();
    });
  }
}
