// Downloads des Welten-Wächters: Server-Jars (Paper, Vanilla) und Plugins (Modrinth). Die Adresse ist vorher geprüft
// (checks.ts: nur feste Hosts, nur https). Hier: keine Weiterleitungen, Größengrenze, Zeitgrenze, Prüfsumme; erst
// wenn alles stimmt, liefert die Funktion die Datei (sonst ist sie weg).
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { AgentError } from './errors';

export interface DownloadOptions {
  /** geprüfte Adresse */
  url: string;
  /** nur Tests: tatsächlich abgefragte Adresse */
  fetchUrl?: (url: string) => string;
  algorithm: 'sha1' | 'sha256' | 'sha512';
  expected: string;
  maxBytes: number;
  timeoutMs: number;
  /** Ordner des Wächters für Temp-Dateien (gleiches Dateisystem wie das Ziel, damit Umbenennen atomar ist) */
  tmpDir: string;
  userAgent: string;
}

/** Lädt die Datei nach tmpDir und prüft sie; liefert den Pfad der Temp-Datei (Aufrufer benennt um oder löscht). */
export async function downloadVerified(options: DownloadOptions): Promise<string> {
  const host = new URL(options.url).host;
  const href = options.fetchUrl ? options.fetchUrl(options.url) : options.url;
  let response: Response;
  try {
    response = await fetch(href, {
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs),
      headers: { 'user-agent': options.userAgent, accept: 'application/java-archive, application/octet-stream' },
    });
  } catch {
    throw new AgentError(`Download von ${host} fehlgeschlagen (keine Verbindung, Weiterleitung oder Zeitüberschreitung).`, 'download');
  }
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new AgentError(`Download von ${host} fehlgeschlagen (HTTP ${response.status}).`, 'download');
  }
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > options.maxBytes) {
    await response.body.cancel().catch(() => {});
    throw new AgentError(`Datei von ${host} ist zu groß (höchstens ${Math.round(options.maxBytes / 1048576)} MB).`, 'too-large');
  }
  const target = path.join(options.tmpDir, `download-${randomBytes(8).toString('hex')}.part`);
  const hash = createHash(options.algorithm);
  let size = 0;
  const limit = options.maxBytes;
  try {
    await pipeline(
      Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>),
      async function* (input: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
        for await (const chunk of input) {
          size += chunk.length;
          if (size > limit) throw new AgentError(`Datei von ${host} ist zu groß (höchstens ${Math.round(limit / 1048576)} MB).`, 'too-large');
          hash.update(chunk);
          yield chunk;
        }
      },
      fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }),
    );
  } catch (err) {
    await fsp.rm(target, { force: true });
    if (err instanceof AgentError) throw err;
    throw new AgentError(`Download von ${host} abgebrochen.`, 'download');
  }
  if (hash.digest('hex') !== options.expected) {
    await fsp.rm(target, { force: true });
    throw new AgentError(`Prüfsumme der Datei von ${host} stimmt nicht – Datei verworfen.`, 'download');
  }
  return target;
}
