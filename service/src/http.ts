// Kleine HTTP-Helfer: Fehler, JSON-Antworten und Lesen des Anfragekörpers.
import { STATUS_CODES, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

/** Fehler mit HTTP-Status und deutschem Text für den Spieler. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

const BASE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent || res.destroyed) return;
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...BASE_HEADERS,
    ...headers,
    'Content-Length': String(Buffer.byteLength(text)),
  });
  res.end(text);
}

export function sendError(res: ServerResponse, err: HttpError): void {
  sendJson(res, err.status, { error: err.message }, err.headers);
}

/** Antwort auf eine abgelehnte WebSocket-Anfrage direkt auf den Socket schreiben. */
export function rejectUpgrade(socket: Duplex, err: HttpError): void {
  if (socket.destroyed) return;
  const text = JSON.stringify({ error: err.message });
  const headers = {
    ...BASE_HEADERS,
    ...err.headers,
    Connection: 'close',
    'Content-Length': String(Buffer.byteLength(text)),
  };
  const head = Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\r\n');
  socket.end(`HTTP/1.1 ${err.status} ${STATUS_CODES[err.status] ?? ''}\r\n${head}\r\n\r\n${text}`);
}

/**
 * Liest den Anfragekörper als JSON-Objekt. Höchstens `limit` Byte, sonst 413.
 * Ein leerer Körper ergibt `{}`.
 */
export function readJsonObject(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  const tooLarge = () =>
    new HttpError(413, `Die Anfrage ist zu groß (höchstens ${Math.floor(limit / 1024)} KB).`, { Connection: 'close' });
  const declared = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    return Promise.reject(tooLarge());
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (err: HttpError | null, value?: Record<string, unknown>) => {
      if (done) return;
      done = true;
      if (err) reject(err);
      else resolve(value!);
    };
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        finish(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => finish(new HttpError(400, 'Die Anfrage wurde abgebrochen.')));
    req.on('end', () => {
      if (done) return;
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text === '') return finish(null, {});
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return finish(new HttpError(400, 'Ungültige Anfrage: kein gültiges JSON.'));
      }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return finish(new HttpError(400, 'Ungültige Anfrage: Es wird ein JSON-Objekt erwartet.'));
      }
      finish(null, value as Record<string, unknown>);
    });
  });
}
