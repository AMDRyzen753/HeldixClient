// Dauerhafte Welten (1.13.0): Status-Abfrage wie die Serverliste von Minecraft an einen Server auf diesem Rechner
// (127.0.0.1:<Port>). Damit merkt der Dienst, wann ein gestarteter Server bereit ist, und gleicht die Spielerzahl ab.
import net from 'node:net';
import { readPacket, readVarInt, writePacket, writeString, writeVarInt } from '../minecraft-protocol';

export interface PingResult {
  online: number;
  max: number;
  version: string;
  protocol: number;
  /** ganze Antwort des Servers (für Tests) */
  raw: Record<string, unknown>;
}

function handshake(host: string, port: number): Buffer {
  const portBytes = Buffer.alloc(2);
  portBytes.writeUInt16BE(port);
  // Protokoll -1: „irgendeine Version“, genügt für eine Status-Abfrage
  return writePacket(0x00, writeVarInt(0xffffffff), writeString(host), portBytes, writeVarInt(1));
}

/** Status abfragen; null bei Fehler oder Zeitüberschreitung. */
export function statusPing(port: number, options: { host?: string; timeoutMs?: number } = {}): Promise<PingResult | null> {
  const host = options.host ?? '127.0.0.1';
  return new Promise((resolve) => {
    let buffer = Buffer.alloc(0);
    let done = false;
    const socket = net.connect({ host, port, noDelay: true });
    const finish = (result: PingResult | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), options.timeoutMs ?? 3000);
    timer.unref();
    socket.on('error', () => finish(null));
    socket.on('close', () => finish(null));
    socket.on('connect', () => socket.write(Buffer.concat([handshake(host, port), writePacket(0x00)])));
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 256 * 1024) return finish(null);
      try {
        const packet = readPacket(buffer, 0, 256 * 1024);
        if (packet === null) return;
        if (packet.id !== 0x00) return finish(null);
        // Text: VarInt-Länge, dann UTF-8
        const length = readVarInt(packet.data, 0);
        if (length === null) return finish(null);
        const json = JSON.parse(packet.data.toString('utf8', length.next, length.next + length.value)) as Record<string, unknown>;
        const players = (json.players ?? {}) as { online?: unknown; max?: unknown };
        const version = (json.version ?? {}) as { name?: unknown; protocol?: unknown };
        finish({
          online: typeof players.online === 'number' ? players.online : 0,
          max: typeof players.max === 'number' ? players.max : 0,
          version: typeof version.name === 'string' ? version.name : '',
          protocol: typeof version.protocol === 'number' ? version.protocol : 0,
          raw: json,
        });
      } catch {
        finish(null);
      }
    });
  });
}
