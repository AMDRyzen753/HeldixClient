// Brücke zum offiziellen Minecraft Launcher – die Seite im HeldixClient-Launcher.
//
// Der offizielle Launcher startet die Installation „HeldixClient“: ein kleines Java-Programm (mod/launcher-bridge),
// das die Anmeldung des Spielers vom offiziellen Launcher bekommt und sie hierher weiterreicht. HeldixClient startet
// Minecraft dann selbst. So klappt die Anmeldung, ohne dass HeldixClient selbst bei Microsoft anmeldet.
//
// Verbindung: TCP nur auf 127.0.0.1, Port und Geheimnis stehen in bridge.json im Datenordner (nur für den Benutzer
// lesbar). Ablauf, je eine JSON-Zeile:
//   Brücke → hello { nonce }             HeldixClient → challenge { proof = HMAC(geheim, "server|" + nonce), nonce }
//   Brücke → session { proof = HMAC(geheim, "client|" + nonce), name, uuid, accessToken, xuid, userType }
//   HeldixClient → ok { name, hold } oder error { message }
// Bei hold bleibt die Verbindung offen, bis das Spiel endet (der offizielle Launcher zeigt es so lange als laufend).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import net from 'node:net';
import { readJson, writeJson } from './fsutil';

export const BRIDGE_PROTOCOL = 1;

/** Was die Brücke vom offiziellen Launcher bekommen hat */
export interface BridgeSession {
  name: string;
  uuid: string;
  accessToken: string;
  xuid?: string;
  userType?: string;
}

export interface BridgeReply {
  /** Name des angemeldeten Spielers (für die Meldung in der Brücke) */
  name: string;
  /** Verbindung offen halten, bis dieses Versprechen erfüllt ist (das Spiel endet) */
  hold?: Promise<void>;
}

export type BridgeHandler = (session: BridgeSession) => Promise<BridgeReply>;

/** Inhalt von bridge.json */
export interface BridgeFile {
  version: number;
  /** 0 = HeldixClient läuft nicht */
  port: number;
  pid: number;
  secret: string;
  /** So startet die Brücke HeldixClient, wenn es nicht läuft */
  command: string[];
}

const LINE_LIMIT = 64 * 1024;
const HANDSHAKE_TIMEOUT_MS = 15_000;

export function bridgeProof(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

function sameProof(expected: string, actual: unknown): boolean {
  if (typeof actual !== 'string' || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(actual, 'utf8'));
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined);

export class BridgeServer {
  private server: net.Server | null = null;
  private readonly secret = randomBytes(32).toString('hex');
  private port = 0;

  constructor(
    private readonly file: string,
    private readonly command: string[],
    private readonly handler: BridgeHandler,
    private readonly log: (message: string) => void = () => undefined,
  ) {}

  /** Lauscht auf einem freien Port und trägt ihn mit neuem Geheimnis in bridge.json ein. */
  async start(): Promise<void> {
    const server = net.createServer((socket) => this.handle(socket));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    server.on('error', (error) => this.log(`Brücke: ${error.message}`));
    this.server = server;
    this.port = (server.address() as net.AddressInfo).port;
    await writeJson(this.file, this.contents(this.port));
    // Das Geheimnis gehört nur dem Benutzer (unter Windows sorgen die Rechte von %APPDATA% dafür)
    if (process.platform !== 'win32') await chmod(this.file, 0o600);
  }

  /** Beim Beenden: Port austragen (synchron, läuft in before-quit). Gehört die Datei inzwischen einem anderen Launcher, bleibt sie. */
  stopSync(current: BridgeFile | null): void {
    this.server?.close();
    this.server = null;
    if (current && current.pid !== process.pid) return;
    try {
      writeFileSync(this.file, JSON.stringify(this.contents(0), null, 2), 'utf8');
    } catch {
      // egal, die Brücke merkt einen toten Port selbst
    }
  }

  static read(file: string): Promise<BridgeFile | null> {
    return readJson<BridgeFile>(file);
  }

  private contents(port: number): BridgeFile {
    return { version: BRIDGE_PROTOCOL, port, pid: process.pid, secret: this.secret, command: this.command };
  }

  private handle(socket: net.Socket): void {
    socket.setEncoding('utf8');
    socket.setTimeout(HANDSHAKE_TIMEOUT_MS, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    let buffer = '';
    let step: 'hello' | 'session' | 'done' = 'hello';
    let serverNonce = '';

    const reply = (message: Record<string, unknown>) => {
      if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
    };

    const onLine = async (line: string) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        socket.destroy();
        return;
      }
      if (step === 'hello') {
        const nonce = text(message.nonce);
        if (message.type !== 'hello' || !nonce || !/^[0-9a-f]{32,256}$/.test(nonce)) {
          socket.destroy();
          return;
        }
        serverNonce = randomBytes(32).toString('hex');
        step = 'session';
        reply({ type: 'challenge', version: BRIDGE_PROTOCOL, proof: bridgeProof(this.secret, `server|${nonce}`), nonce: serverNonce });
        return;
      }
      if (step !== 'session') return;
      step = 'done';
      if (message.type !== 'session' || !sameProof(bridgeProof(this.secret, `client|${serverNonce}`), message.proof)) {
        this.log('Brücke: Verbindung ohne gültigen Nachweis abgelehnt');
        socket.destroy();
        return;
      }
      const session: BridgeSession = {
        name: text(message.name) ?? '',
        uuid: (text(message.uuid) ?? '').replace(/-/g, ''),
        accessToken: text(message.accessToken) ?? '',
        xuid: text(message.xuid),
        userType: text(message.userType),
      };
      // Ab hier entscheidet der Handler (Prüfung bei Mojang dauert etwas)
      socket.setTimeout(0);
      try {
        const result = await this.handler(session);
        reply({ type: 'ok', name: result.name, hold: Boolean(result.hold) });
        if (result.hold) await result.hold.catch(() => undefined);
      } catch (error) {
        reply({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
      socket.end();
    };

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > LINE_LIMIT) {
        socket.destroy();
        return;
      }
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) void onLine(line);
      }
    });
  }
}
