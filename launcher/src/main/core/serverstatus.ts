// Status eines Minecraft-Servers (Server List Ping wie in Minecrafts Serverliste): online, Spielerzahl, Ping, Version, MOTD.
// Für „Weiterspielen“ auf der Startseite; gefragt werden nur Server aus der eigenen Serverliste einer Instanz.
import { promises as dns } from 'node:dns';
import net from 'node:net';
import type { ServerStatus } from '../../shared/api';

const DEFAULT_PORT = 25565;
const TIMEOUT_MS = 4500;
/** Antworten mit großem Favicon sind ~60 KB; mehr nehmen wir nicht an */
const MAX_RESPONSE_BYTES = 256 * 1024;
const CACHE_MS = 60_000;
/** so lange nach der Statusantwort auf den Pong warten */
const PONG_WAIT_MS = 1500;
const HOST_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)*$/i;

const cache = new Map<string, { at: number; status: Promise<ServerStatus> }>();

/** „host“, „host:port“ oder „[ipv6]:port“ → Host und Port (Port null = Standard bzw. SRV-Eintrag) */
export function parseServerAddress(raw: string): { host: string; port: number | null } | null {
  const text = raw.trim().toLowerCase();
  if (!text || text.length > 260) return null;
  let host = text;
  let port: number | null = null;
  const v6 = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/.exec(text);
  if (v6) {
    host = v6[1];
    port = v6[2] ? Number(v6[2]) : null;
    if (net.isIPv6(host) === false) return null;
  } else {
    const match = /^([^:]+)(?::(\d{1,5}))?$/.exec(text);
    if (!match) return null;
    host = match[1].replace(/\.$/, '');
    port = match[2] ? Number(match[2]) : null;
    if (!net.isIPv4(host) && !HOST_RE.test(host)) return null;
  }
  if (port !== null && (port < 1 || port > 65535)) return null;
  return { host, port };
}

function varInt(value: number): Buffer {
  const bytes: number[] = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return Buffer.from(bytes);
}

function mcString(text: string): Buffer {
  const data = Buffer.from(text, 'utf8');
  return Buffer.concat([varInt(data.length), data]);
}

function packet(id: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat([varInt(id), ...parts]);
  return Buffer.concat([varInt(body.length), body]);
}

/** VarInt ab offset lesen; null = noch nicht vollständig */
function readVarInt(buf: Buffer, offset: number): { value: number; size: number } | null {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (offset + i >= buf.length) return null;
    const byte = buf[offset + i];
    value |= (byte & 0x7f) << (7 * i);
    if ((byte & 0x80) === 0) return { value, size: i + 1 };
  }
  throw new Error('Ungültige Antwort');
}

/** Chat-Komponente (Text, extra, Formatcodes) zu Klartext */
function plainText(component: unknown, depth = 0): string {
  if (depth > 8 || component == null) return '';
  if (typeof component === 'string') return component;
  if (Array.isArray(component)) return component.map((c) => plainText(c, depth + 1)).join('');
  if (typeof component === 'object') {
    const c = component as { text?: unknown; extra?: unknown; translate?: unknown };
    return `${typeof c.text === 'string' ? c.text : typeof c.translate === 'string' ? c.translate : ''}${plainText(c.extra, depth + 1)}`;
  }
  return '';
}

export function cleanMotd(component: unknown): string | null {
  const text = plainText(component)
    .replace(/§./g, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' · ')
    // keine Steuerzeichen
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 160);
  return text || null;
}

async function resolve(host: string, port: number | null): Promise<{ host: string; port: number }> {
  if (port !== null || net.isIP(host)) return { host, port: port ?? DEFAULT_PORT };
  try {
    const records = await dns.resolveSrv(`_minecraft._tcp.${host}`);
    const best = records.sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0];
    if (best && HOST_RE.test(best.name.replace(/\.$/, ''))) return { host: best.name.replace(/\.$/, ''), port: best.port };
  } catch {
    // kein SRV-Eintrag: Standard-Port
  }
  return { host, port: DEFAULT_PORT };
}

function ping(address: string): Promise<ServerStatus> {
  const parsed = parseServerAddress(address);
  if (!parsed) return Promise.resolve({ online: false, players: null, latencyMs: null, version: null, motd: null });
  return resolve(parsed.host, parsed.port).then(({ host, port }) => new Promise<ServerStatus>((done) => {
    const offline: ServerStatus = { online: false, players: null, latencyMs: null, version: null, motd: null };
    let buffer = Buffer.alloc(0);
    let status: ServerStatus | null = null;
    let pingSent = 0;
    let finished = false;
    const socket = net.connect({ host, port });
    const finish = (result: ServerStatus) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      done(result);
    };
    // Manche Server antworten nicht auf den Ping: dann Zeit bis zur Statusantwort
    let timer = setTimeout(() => finish(status ?? offline), TIMEOUT_MS);
    socket.setNoDelay(true);
    socket.on('error', () => finish(status ?? offline));
    socket.on('close', () => finish(status ?? offline));
    let connectedAt = 0;
    socket.on('connect', () => {
      connectedAt = Date.now();
      // Handshake (Protokoll -1 = „nur Status“, nächster Zustand 1) und Statusanfrage
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port);
      socket.write(Buffer.concat([
        packet(0x00, varInt(-1), mcString(parsed.host), portBuf, varInt(1)),
        packet(0x00),
      ]));
    });
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_RESPONSE_BYTES) return finish(status ?? offline);
      try {
        for (;;) {
          const length = readVarInt(buffer, 0);
          if (!length || buffer.length < length.size + length.value) return;
          const body = buffer.subarray(length.size, length.size + length.value);
          buffer = buffer.subarray(length.size + length.value);
          const id = readVarInt(body, 0);
          if (!id) return finish(status ?? offline);
          if (id.value === 0x00 && !status) {
            const strLen = readVarInt(body, id.size);
            if (!strLen) return finish(offline);
            const json = JSON.parse(body.subarray(id.size + strLen.size, id.size + strLen.size + strLen.value).toString('utf8')) as {
              players?: { online?: unknown; max?: unknown };
              version?: { name?: unknown };
              description?: unknown;
            };
            const online = Number(json.players?.online);
            const max = Number(json.players?.max);
            status = {
              online: true,
              players: Number.isFinite(online) && Number.isFinite(max) && online >= 0 && max >= 0 ? { online: Math.floor(online), max: Math.floor(max) } : null,
              latencyMs: Date.now() - connectedAt,
              version: typeof json.version?.name === 'string' ? json.version.name.replace(/§./g, '').slice(0, 60) : null,
              motd: cleanMotd(json.description),
            };
            // Ping für die echte Antwortzeit
            const payload = Buffer.alloc(8);
            payload.writeBigInt64BE(BigInt(Date.now()));
            pingSent = Date.now();
            socket.write(packet(0x01, payload));
            // auf den Pong nicht lange warten: der Status steht schon fest
            clearTimeout(timer);
            timer = setTimeout(() => finish(status ?? offline), PONG_WAIT_MS);
          } else if (id.value === 0x01 && status) {
            return finish({ ...status, latencyMs: Math.max(1, Date.now() - pingSent) });
          }
        }
      } catch {
        finish(status ?? offline);
      }
    });
  }));
}

/** Status mit kurzem Zwischenspeicher (eine Minute je Adresse) */
export function serverStatus(address: string): Promise<ServerStatus> {
  const key = address.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.status;
  const status = ping(key).catch((): ServerStatus => ({ online: false, players: null, latencyMs: null, version: null, motd: null }));
  cache.set(key, { at: Date.now(), status });
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return status;
}
