import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { ProgressEvent } from '../../shared/api';

export const USER_AGENT = `HeldixClient/0.10.0`;

export type ProgressFn = (event: ProgressEvent) => void;

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`HTTP ${status} bei ${new URL(url).host}${body ? `: ${body.slice(0, 300)}` : ''}`);
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** fetch mit User-Agent und Wiederholung bei Netzwerkfehlern, 429 und 5xx. */
export async function request(url: string, init: RequestInit = {}, attempts = 3): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('User-Agent')) headers.set('User-Agent', USER_AGENT);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers });
      if ((res.status === 429 || res.status >= 500) && attempt < attempts) {
        lastError = new HttpError(url, res.status, '');
        await delay(600 * attempt);
        continue;
      }
      return res;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(600 * attempt);
    }
  }
  throw lastError;
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await request(url, init);
  if (!res.ok) throw new HttpError(url, res.status, await res.text().catch(() => ''));
  return (await res.json()) as T;
}

export interface DownloadSpec {
  url: string;
  dest: string;
  sha1?: string;
  size?: number;
}

export async function sha1File(file: string): Promise<string> {
  const hash = createHash('sha1');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/**
 * Prüft, ob eine Datei schon korrekt vorhanden ist.
 * 'size' ist schnell (für tausende Assets), 'sha1' prüft den Inhalt vollständig.
 */
export async function isFileValid(spec: DownloadSpec, mode: 'size' | 'sha1' = 'size'): Promise<boolean> {
  try {
    const info = await stat(spec.dest);
    if (!info.isFile()) return false;
    if (spec.size != null && info.size !== spec.size) return false;
    if (mode === 'sha1' && spec.sha1) return (await sha1File(spec.dest)) === spec.sha1.toLowerCase();
    return true;
  } catch {
    return false;
  }
}

/** Lädt eine Datei herunter, prüft SHA-1 und Größe und schreibt sie atomar. */
export async function downloadFile(spec: DownloadSpec): Promise<void> {
  if (!spec.url) throw new Error(`Datei fehlt und hat keine Download-Adresse: ${spec.dest}`);
  await mkdir(path.dirname(spec.dest), { recursive: true });
  const tmp = `${spec.dest}.${process.pid}.part`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await request(spec.url);
      if (!res.ok || !res.body) throw new HttpError(spec.url, res.status, '');
      const hash = createHash('sha1');
      let bytes = 0;
      const tap = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          bytes += chunk.length;
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), tap, createWriteStream(tmp));
      const digest = hash.digest('hex');
      if (spec.sha1 && digest !== spec.sha1.toLowerCase()) {
        throw new Error(`Prüfsumme stimmt nicht: ${spec.url}`);
      }
      if (spec.size != null && bytes !== spec.size) {
        throw new Error(`Dateigröße stimmt nicht (${bytes} statt ${spec.size}): ${spec.url}`);
      }
      await rename(tmp, spec.dest);
      return;
    } catch (error) {
      await rm(tmp, { force: true });
      if (attempt >= 3) throw error;
      await delay(800 * attempt);
    }
  }
}

/** Führt worker für alle Einträge mit begrenzter Parallelität aus. Bricht beim ersten Fehler ab. */
export async function runPool<T>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | null = null;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length && !failure) {
      const item = items[next++];
      try {
        await worker(item);
      } catch (error) {
        failure ??= { error };
      }
    }
  });
  await Promise.all(runners);
  if (failure) throw (failure as { error: unknown }).error;
}

export interface SyncOptions {
  stage: string;
  onProgress?: ProgressFn;
  concurrency?: number;
  verify?: 'size' | 'sha1';
}

/** Stellt sicher, dass alle Dateien vorhanden sind, und lädt fehlende parallel herunter. */
export async function syncFiles(specs: readonly DownloadSpec[], options: SyncOptions): Promise<void> {
  const unique = new Map<string, DownloadSpec>();
  for (const spec of specs) unique.set(path.resolve(spec.dest).toLowerCase(), spec);
  const all = [...unique.values()];

  const missing: DownloadSpec[] = [];
  await runPool(all, 32, async (spec) => {
    if (!(await isFileValid(spec, options.verify))) missing.push(spec);
  });

  let done = 0;
  options.onProgress?.({ stage: options.stage, done, total: missing.length });
  await runPool(missing, options.concurrency ?? 16, async (spec) => {
    await downloadFile(spec);
    done++;
    options.onProgress?.({ stage: options.stage, done, total: missing.length });
  });
}
