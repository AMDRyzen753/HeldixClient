// Die wenigen Teile des Minecraft-Protokolls (Java Edition), die das Welt-Relay selbst liest oder schreibt: Pakete vor
// Verschlüsselung und Kompression (Handshake, Status, Ping, Login Start, Disconnect beim Login). Alles danach reicht das
// Relay ungelesen durch. Jedes Paket ist `[VarInt Länge][VarInt Paket-ID][Daten]`; die Länge zählt ID und Daten.

/** Zu wenige Bytes für ein ganzes Paket: auf weitere warten. */
export const NEED_MORE = null;

/** Ungültige oder zu große Daten (das Relay schließt dann die Verbindung). */
export class ProtocolError extends Error {}

/** Höchstlänge der Server-Adresse im Handshake (in Byte, UTF-8). */
export const MAX_ADDRESS_BYTES = 255;
/** Handshake: Paket-ID, Protokoll (≤ 5), Adresse (≤ 2 + 255), Port (2), Zustand (≤ 5). */
export const MAX_HANDSHAKE_PACKET = 300;
/** Login Start (ältere Versionen schicken einen Schlüssel mit): großzügig, aber begrenzt. */
export const MAX_LOGIN_PACKET = 2048;
/** Status-Anfrage (leer) und Ping (8 Byte). */
export const MAX_STATUS_PACKET = 16;
/** Erstes Byte eines Server-Listen-Pings von Minecraft vor 1.7 (Legacy-Ping). */
export const LEGACY_PING = 0xfe;

export type NextState = 1 | 2 | 3;

export interface Handshake {
  protocol: number;
  /** Adresse wie vom Client geschickt, bereinigt: bis `\0`, ohne Punkt und Port am Ende, klein geschrieben */
  address: string;
  port: number;
  /** 1 Status, 2 Login, 3 Transfer (ab 1.20.5, für das Relay wie Login) */
  next: NextState;
}

export interface Packet {
  id: number;
  data: Buffer;
  /** Position direkt hinter dem Paket */
  end: number;
}

/** VarInt ab `offset`: Wert und Position dahinter, NEED_MORE (zu kurz) oder ProtocolError (mehr als 5 Byte). */
export function readVarInt(buf: Buffer, offset: number): { value: number; next: number } | null {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (offset + i >= buf.length) return NEED_MORE;
    const byte = buf[offset + i]!;
    value |= (byte & 0x7f) << (7 * i);
    if ((byte & 0x80) === 0) return { value, next: offset + i + 1 };
  }
  throw new ProtocolError('VarInt zu lang');
}

/** Ganzes Paket ab `offset` (höchstens `maxLength` Byte ohne die Längenangabe) oder NEED_MORE. */
export function readPacket(buf: Buffer, offset: number, maxLength: number): Packet | null {
  const length = readVarInt(buf, offset);
  if (length === NEED_MORE) return NEED_MORE;
  if (length.value < 1 || length.value > maxLength) throw new ProtocolError('Paketlänge ungültig');
  const end = length.next + length.value;
  if (end > buf.length) return NEED_MORE;
  const body = buf.subarray(length.next, end);
  const id = readVarInt(body, 0);
  if (id === NEED_MORE) throw new ProtocolError('Paket ohne ID');
  return { id: id.value, data: body.subarray(id.next), end };
}

/** Liest Felder nacheinander aus den Daten eines vollständigen Pakets; zu kurz ist hier ein Fehler. */
class FieldReader {
  private offset = 0;

  constructor(private readonly buf: Buffer) {}

  varInt(): number {
    const result = readVarInt(this.buf, this.offset);
    if (result === NEED_MORE) throw new ProtocolError('Paket zu kurz');
    this.offset = result.next;
    return result.value;
  }

  string(maxBytes: number): string {
    const length = this.varInt();
    if (length < 0 || length > maxBytes) throw new ProtocolError('Text zu lang');
    if (this.offset + length > this.buf.length) throw new ProtocolError('Paket zu kurz');
    const text = this.buf.toString('utf8', this.offset, this.offset + length);
    this.offset += length;
    return text;
  }

  ushort(): number {
    if (this.offset + 2 > this.buf.length) throw new ProtocolError('Paket zu kurz');
    const value = this.buf.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  done(): boolean {
    return this.offset === this.buf.length;
  }
}

/**
 * Bereinigt die Adresse aus dem Handshake: Mod-Loader hängen nach `\0` eigene Kennungen an, manche Clients einen Punkt
 * (aus dem DNS-Eintrag) oder `:<port>`. Ergebnis klein geschrieben.
 */
export function normalizeAddress(raw: string): string {
  let address = raw;
  const zero = address.indexOf('\0');
  if (zero >= 0) address = address.slice(0, zero);
  address = address.trim().toLowerCase();
  address = address.replace(/:\d{1,5}$/, '');
  if (address.endsWith('.')) address = address.slice(0, -1);
  return address;
}

/** Handshake (Paket 0x00) aus einem gelesenen Paket. */
export function parseHandshake(packet: Packet): Handshake {
  if (packet.id !== 0x00) throw new ProtocolError('kein Handshake');
  const reader = new FieldReader(packet.data);
  const protocol = reader.varInt();
  const address = normalizeAddress(reader.string(MAX_ADDRESS_BYTES));
  const port = reader.ushort();
  const next = reader.varInt();
  if (!reader.done()) throw new ProtocolError('Handshake zu lang');
  if (next !== 1 && next !== 2 && next !== 3) throw new ProtocolError('unbekannter Zustand');
  return { protocol, address, port, next };
}

/** Name aus Login Start (Paket 0x00); was danach kommt (UUID, ältere Felder), liest das Relay nicht. */
export function parseLoginStart(packet: Packet): string {
  if (packet.id !== 0x00) throw new ProtocolError('kein Login Start');
  // 16 Zeichen, in UTF-8 höchstens 64 Byte
  return new FieldReader(packet.data).string(64);
}

export function writeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let rest = value >>> 0;
  do {
    let byte = rest & 0x7f;
    rest >>>= 7;
    if (rest !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (rest !== 0);
  return Buffer.from(bytes);
}

export function writeString(text: string): Buffer {
  const bytes = Buffer.from(text, 'utf8');
  return Buffer.concat([writeVarInt(bytes.length), bytes]);
}

/** Ganzes Paket: Länge, ID, Daten. */
export function writePacket(id: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat([writeVarInt(id), ...parts]);
  return Buffer.concat([writeVarInt(body.length), body]);
}

/** Text-Komponente als JSON (für MOTD und Trennen); grau wie die Hinweise von Minecraft selbst. */
export function textComponent(text: string, color?: string): Record<string, string> {
  return color === undefined ? { text } : { text, color };
}

export interface StatusInfo {
  versionName: string;
  protocol: number;
  online: number;
  max: number;
  description: Record<string, string>;
}

/** Status-Antwort (Paket 0x00 im Zustand Status). */
export function statusResponse(info: StatusInfo): Buffer {
  const json = {
    version: { name: info.versionName, protocol: info.protocol },
    players: { max: info.max, online: info.online },
    description: info.description,
  };
  return writePacket(0x00, writeString(JSON.stringify(json)));
}

/** Pong (Paket 0x01 im Zustand Status) mit denselben 8 Byte wie im Ping. */
export function pongResponse(payload: Buffer): Buffer {
  return writePacket(0x01, payload);
}

/** Disconnect beim Login (Paket 0x00 im Zustand Login): Text-Komponente als JSON, auch in neuen Versionen. */
export function loginDisconnect(text: string): Buffer {
  return writePacket(0x00, writeString(JSON.stringify(textComponent(text))));
}
