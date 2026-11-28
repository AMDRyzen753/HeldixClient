// Dauerhafte Welten (1.13.0): Upload einer Welt als ZIP in Teilen (je 8 MiB, höchstens 2 GiB). Die Teile landen direkt
// an ihrer Stelle in einer Datei im Datenordner des Dienstes (`<Daten>/hosting/uploads/<Welt>/welt.zip`); beim Abschluss
// prüft der Dienst, dass alle Teile da sind und die SHA-256 stimmt. Teile dürfen in beliebiger Reihenfolge und auch
// doppelt kommen (z. B. nach einem Abbruch). Unfertige Uploads verfallen nach einer Weile ohne neue Teile.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { HttpError } from '../http';

export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export interface UploadSession {
  world: string;
  owner: string;
  size: number;
  chunkSize: number;
  chunks: number;
  received: Set<number>;
  /** Teile, die gerade geschrieben werden */
  writing: Set<number>;
  file: string;
  dir: string;
  touchedAt: number;
  finishing: boolean;
}

export interface UploadView {
  chunkSize: number;
  chunks: number;
  size: number;
  received: number[];
  maxBytes: number;
  expiresAt: number;
}

export interface UploadsOptions {
  /** Ordner für unfertige Uploads */
  dir: string;
  chunkBytes?: number;
  maxBytes?: number;
  /** Ohne neues Teil so lange gültig (Standard 2 Stunden) */
  idleMs?: number;
  /** Ein Teil muss innerhalb dieser Zeit ohne Pause ankommen (Standard 60 s ohne Bytes) */
  chunkIdleMs?: number;
  /** Höchstens so viele unfertige Uploads gleichzeitig (Standard 8) */
  maxSessions?: number;
}

export class Uploads {
  private readonly sessions = new Map<string, UploadSession>();
  readonly chunkBytes: number;
  readonly maxBytes: number;
  private readonly idleMs: number;

  constructor(private readonly options: UploadsOptions) {
    this.chunkBytes = options.chunkBytes ?? UPLOAD_CHUNK_BYTES;
    this.maxBytes = options.maxBytes ?? UPLOAD_MAX_BYTES;
    this.idleMs = options.idleMs ?? 2 * 60 * 60_000;
  }

  view(session: UploadSession): UploadView {
    return {
      chunkSize: session.chunkSize,
      chunks: session.chunks,
      size: session.size,
      received: [...session.received].sort((a, b) => a - b),
      maxBytes: this.maxBytes,
      expiresAt: session.touchedAt + this.idleMs,
    };
  }

  get(world: string): UploadSession | undefined {
    return this.sessions.get(world);
  }

  /** Neuen Upload beginnen (ein unfertiger derselben Welt wird verworfen). */
  async start(world: string, owner: string, size: unknown): Promise<UploadView> {
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 22 || size > this.maxBytes) {
      throw new HttpError(400, `„size“ muss die Größe der ZIP-Datei in Byte sein (höchstens ${Math.round(this.maxBytes / 1024 ** 3)} GB).`);
    }
    await this.cancel(world);
    if (this.sessions.size >= (this.options.maxSessions ?? 8)) {
      throw new HttpError(503, 'Gerade laden zu viele Welten gleichzeitig hoch. Bitte in ein paar Minuten noch einmal.');
    }
    const dir = path.join(this.options.dir, world);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'welt.zip');
    const handle = await fs.open(file, 'w');
    try {
      await handle.truncate(size);
    } finally {
      await handle.close();
    }
    const session: UploadSession = {
      world,
      owner,
      size,
      chunkSize: this.chunkBytes,
      chunks: Math.ceil(size / this.chunkBytes),
      received: new Set(),
      writing: new Set(),
      file,
      dir,
      touchedAt: Date.now(),
      finishing: false,
    };
    this.sessions.set(world, session);
    return this.view(session);
  }

  private session(world: string, owner: string): UploadSession {
    const session = this.sessions.get(world);
    if (!session || session.owner !== owner) throw new HttpError(404, 'Es läuft gerade kein Upload für diese Welt. Bitte neu beginnen.');
    return session;
  }

  /** Ein Teil (Nummer ab 0) aus dem Anfragekörper an seine Stelle schreiben. */
  async chunk(world: string, owner: string, rawIndex: string | undefined, req: IncomingMessage): Promise<UploadView> {
    const session = this.session(world, owner);
    const index = rawIndex !== undefined && /^\d{1,6}$/.test(rawIndex) ? Number(rawIndex) : -1;
    if (index < 0 || index >= session.chunks) throw new HttpError(400, `Teil ${rawIndex ?? ''} gibt es nicht (0 bis ${session.chunks - 1}).`);
    if (session.finishing) throw new HttpError(409, 'Der Upload wird gerade abgeschlossen.');
    if (session.writing.has(index)) throw new HttpError(409, 'Dieses Teil kommt gerade schon an.');
    const expected = index === session.chunks - 1 ? session.size - index * session.chunkSize : session.chunkSize;
    const declared = req.headers['content-length'];
    if (declared !== undefined && Number(declared) !== expected) {
      req.resume();
      throw new HttpError(400, `Teil ${index} muss genau ${expected} Byte groß sein.`, { Connection: 'close' });
    }
    session.writing.add(index);
    session.touchedAt = Date.now();
    const handle = await fs.open(session.file, 'r+');
    try {
      await new Promise<void>((resolve, reject) => {
        let position = index * session.chunkSize;
        let got = 0;
        let failed = false;
        let pending = Promise.resolve();
        const fail = (err: HttpError) => {
          if (failed) return;
          failed = true;
          clearTimeout(timer);
          req.removeAllListeners('data');
          req.resume();
          reject(err);
        };
        let timer = setTimeout(() => fail(new HttpError(408, 'Das Teil kam zu langsam an.', { Connection: 'close' })), this.options.chunkIdleMs ?? 60_000);
        req.on('data', (data: Buffer) => {
          if (failed) return;
          got += data.length;
          if (got > expected) {
            fail(new HttpError(413, `Teil ${index} ist größer als ${expected} Byte.`, { Connection: 'close' }));
            return;
          }
          clearTimeout(timer);
          timer = setTimeout(() => fail(new HttpError(408, 'Das Teil kam zu langsam an.', { Connection: 'close' })), this.options.chunkIdleMs ?? 60_000);
          const at = position;
          position += data.length;
          req.pause();
          pending = pending
            .then(() => handle.write(data, 0, data.length, at))
            .then(
              () => {
                if (!failed) req.resume();
              },
              () => fail(new HttpError(500, 'Das Teil konnte nicht gespeichert werden.')),
            );
        });
        req.on('error', () => fail(new HttpError(400, 'Die Anfrage wurde abgebrochen.')));
        req.on('end', () => {
          void pending.then(() => {
            if (failed) return;
            clearTimeout(timer);
            if (got !== expected) {
              failed = true;
              reject(new HttpError(400, `Teil ${index} muss genau ${expected} Byte groß sein (angekommen: ${got}).`));
              return;
            }
            resolve();
          });
        });
      });
    } finally {
      await handle.close();
      session.writing.delete(index);
    }
    if (this.sessions.get(world) === session) {
      session.received.add(index);
      session.touchedAt = Date.now();
    }
    return this.view(session);
  }

  /**
   * Abschluss: alle Teile da und SHA-256 gleich? Liefert den Pfad der ZIP; danach gehört sie dem Aufrufer, bis er
   * `done` aufruft (oder sie bei `cancel` mit wegfällt).
   */
  async finish(world: string, owner: string, sha256: unknown): Promise<UploadSession> {
    const session = this.session(world, owner);
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(sha256)) throw new HttpError(400, '„sha256“ muss die SHA-256 der ganzen ZIP-Datei sein (64 Hex-Zeichen).');
    if (session.finishing) throw new HttpError(409, 'Der Upload wird gerade abgeschlossen.');
    if (session.writing.size > 0) throw new HttpError(409, 'Es kommen noch Teile an.');
    const missing: number[] = [];
    for (let i = 0; i < session.chunks && missing.length < 20; i++) if (!session.received.has(i)) missing.push(i);
    if (missing.length > 0) throw new HttpError(409, `Es fehlen noch Teile: ${missing.join(', ')}.`, {}, 'missing-chunks', { missing });
    session.finishing = true;
    try {
      const hash = createHash('sha256');
      for await (const data of createReadStream(session.file)) hash.update(data as Buffer);
      if (hash.digest('hex') !== sha256.toLowerCase()) {
        throw new HttpError(400, 'Die Prüfsumme (SHA-256) passt nicht. Bitte die Welt noch einmal hochladen.', {}, 'checksum');
      }
    } catch (err) {
      session.finishing = false;
      throw err;
    }
    session.touchedAt = Date.now();
    return session;
  }

  /** Nach dem Übernehmen (oder einem endgültigen Fehler) aufräumen. */
  async done(world: string): Promise<void> {
    const session = this.sessions.get(world);
    this.sessions.delete(world);
    await fs.rm(session?.dir ?? path.join(this.options.dir, world), { recursive: true, force: true });
  }

  /** Abschluss gescheitert, aber der Upload darf bleiben (z. B. Welt gerade beschäftigt). */
  release(world: string): void {
    const session = this.sessions.get(world);
    if (session) session.finishing = false;
  }

  async cancel(world: string): Promise<void> {
    if (!this.sessions.has(world)) {
      await fs.rm(path.join(this.options.dir, world), { recursive: true, force: true }).catch(() => undefined);
      return;
    }
    await this.done(world);
  }

  /** Verfallene Uploads und übrig gebliebene Ordner (nach einem Neustart) löschen. */
  async sweep(now = Date.now()): Promise<void> {
    for (const session of [...this.sessions.values()]) {
      if (!session.finishing && session.writing.size === 0 && now - session.touchedAt > this.idleMs) await this.done(session.world);
    }
    let names: string[] = [];
    try {
      names = await fs.readdir(this.options.dir);
    } catch {
      return;
    }
    for (const name of names) if (!this.sessions.has(name)) await fs.rm(path.join(this.options.dir, name), { recursive: true, force: true });
  }
}
