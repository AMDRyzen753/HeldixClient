// Dateizugriffe des Welten-Wächters (läuft als root) im Datenordner einer Welt. Den Inhalt dieses Ordners kontrolliert
// der Minecraft-Server im Container (Benutzer 1000): Er kann dort symbolische Links anlegen, die auf beliebige Pfade
// des Servers zeigen. Deshalb gilt:
//   - Schreiben, Löschen und Entpacken nur, während der Container der Welt NICHT läuft (dann ändert niemand sonst
//     etwas). Änderungen bei laufender Welt merkt sich der Wächter und übernimmt sie nach dem Anhalten bzw. vor dem
//     nächsten Start.
//   - Lesen auch bei laufender Welt, aber nur über openVerified: O_NOFOLLOW für die Datei selbst, und danach wird der
//     tatsächliche Pfad der offenen Datei (/proc/self/fd) geprüft – auch ein Ordner, der zwischendurch gegen einen Link
//     getauscht wird, führt so nicht nach draußen.
//   - Neue Dateien entstehen als versteckte Temp-Datei (O_EXCL, O_NOFOLLOW) und werden umbenannt; ein Link am Ziel wird
//     dabei ersetzt, nie verfolgt.
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { Owner } from './config';
import { AgentError, isErrnoCode } from './errors';

/** Unter Windows (nur Tests) gibt es kein O_NOFOLLOW; dort prüft realPathOf den Pfad. */
export const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const { O_RDONLY, O_WRONLY, O_CREAT, O_EXCL } = fs.constants;

export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

export async function lstatOrNull(target: string): Promise<fs.Stats | null> {
  try {
    return await fsp.lstat(target);
  } catch (err) {
    if (isErrnoCode(err, 'ENOENT') || isErrnoCode(err, 'ENOTDIR')) return null;
    throw err;
  }
}

/** Tatsächlicher Pfad einer offenen Datei: unter Linux aus /proc/self/fd (unabhängig vom Pfad), sonst realpath. */
export async function realPathOf(fh: FileHandle, fallback: string): Promise<string> {
  if (process.platform === 'linux') {
    try {
      return await fsp.readlink(`/proc/self/fd/${fh.fd}`);
    } catch {
      // ohne /proc (Container ohne procfs): unten
    }
  }
  return fsp.realpath(fallback);
}

/**
 * Öffnet `full` (muss unter `rootReal` liegen) ohne Links zu folgen und prüft danach, dass die offene Datei wirklich
 * unter `rootReal` liegt. `rootReal` ist ein realpath.
 */
export async function openVerified(rootReal: string, full: string, flags: number, mode = 0o600): Promise<FileHandle> {
  if (!isInside(rootReal, full)) throw new AgentError('Pfad liegt außerhalb des erlaubten Ordners.');
  let fh: FileHandle;
  try {
    fh = await fsp.open(full, flags | O_NOFOLLOW, mode);
  } catch (err) {
    if (isErrnoCode(err, 'ELOOP')) throw new AgentError('Symbolische Links sind nicht erlaubt.');
    if (isErrnoCode(err, 'ENOENT') || isErrnoCode(err, 'ENOTDIR')) throw new AgentError('Datei gibt es nicht.', 'not-found');
    if (isErrnoCode(err, 'EEXIST')) throw new AgentError('Die Datei gibt es schon.', 'exists');
    throw err;
  }
  try {
    const real = await realPathOf(fh, full);
    if (!isInside(rootReal, real)) {
      // Beim Neuanlegen (O_CREAT | O_EXCL) ist dann draußen eine leere Datei von uns entstanden: wieder weg damit.
      // Ohne O_EXCL könnte es eine fremde Datei sein – die bleibt.
      if (flags & O_CREAT && flags & O_EXCL) await fsp.rm(real, { force: true }).catch(() => {});
      throw new AgentError('Pfad führt über einen Link aus dem erlaubten Ordner hinaus.');
    }
    return fh;
  } catch (err) {
    await fh.close().catch(() => {});
    throw err;
  }
}

/** Öffnet root/parts…: jeder Ordner auf dem Weg muss ein echter Ordner sein (kein Link), dann openVerified. */
export async function openInside(rootReal: string, parts: string[], flags: number, mode = 0o600): Promise<FileHandle> {
  let dir = rootReal;
  for (const part of parts.slice(0, -1)) {
    dir = path.join(dir, part);
    const st = await lstatOrNull(dir);
    if (!st) throw new AgentError('Ordner gibt es nicht.', 'not-found');
    if (!st.isDirectory()) throw new AgentError('Pfad führt über einen Link oder eine Datei.');
  }
  return openVerified(rootReal, path.join(rootReal, ...parts), flags, mode);
}

/** Kleine Datei lesen (höchstens maxBytes), sicher wie openInside. */
export async function readInside(rootReal: string, parts: string[], maxBytes: number): Promise<Buffer> {
  const fh = await openInside(rootReal, parts, O_RDONLY);
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw new AgentError('Keine normale Datei.');
    if (st.size > maxBytes) throw new AgentError(`Datei zu groß (höchstens ${Math.round(maxBytes / 1024)} KB).`, 'too-large');
    const buf = Buffer.alloc(st.size);
    let done = 0;
    while (done < st.size) {
      const { bytesRead } = await fh.read(buf, done, st.size - done, done);
      if (bytesRead === 0) break;
      done += bytesRead;
    }
    return buf.subarray(0, done);
  } finally {
    await fh.close();
  }
}

export interface WriteOptions {
  owner: Owner | null;
  mode: number;
}

function tempName(): string {
  return `.heldix-${randomBytes(8).toString('hex')}.tmp`;
}

/**
 * Schreibt `name` in den Ordner `dir` atomar (Temp-Datei, dann umbenennen). Nur für Ordner, die gerade niemand sonst
 * ändern kann (Welt gestoppt bzw. Ordner des Wächters).
 */
export async function writeAtomic(dir: string, name: string, data: Buffer | string, options: WriteOptions): Promise<void> {
  const tmp = path.join(dir, tempName());
  const fh = await fsp.open(tmp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, options.mode);
  try {
    await fh.writeFile(data);
    if (options.owner) await fh.chown(options.owner.uid, options.owner.gid);
    await fh.chmod(options.mode);
  } catch (err) {
    await fh.close().catch(() => {});
    await fsp.rm(tmp, { force: true });
    throw err;
  }
  await fh.close();
  try {
    await fsp.rename(tmp, path.join(dir, name));
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Liest eine offene Datei stückweise von `start` bis `end` (ohne Streams des FileHandle: deren autoClose: false hält
 * den Handle fest, sodass close() nie fertig wird).
 */
export async function* readChunks(fh: FileHandle, start = 0, end = Number.POSITIVE_INFINITY, chunkSize = 1 << 20): AsyncGenerator<Buffer> {
  let position = start;
  while (position < end) {
    const length = Math.min(chunkSize, end - position);
    const buf = Buffer.allocUnsafe(length);
    const { bytesRead } = await fh.read(buf, 0, length, position);
    if (bytesRead === 0) return;
    position += bytesRead;
    yield bytesRead === length ? buf : buf.subarray(0, bytesRead);
  }
}

/** Kopiert eine Datei des Wächters atomar nach dir/name. */
export async function copyAtomic(source: string, dir: string, name: string, options: WriteOptions): Promise<void> {
  const tmp = path.join(dir, tempName());
  const input = await fsp.open(source, O_RDONLY | O_NOFOLLOW);
  try {
    const out = await fsp.open(tmp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, options.mode);
    try {
      let position = 0;
      for await (const chunk of readChunks(input)) {
        await writeAllAt(out, chunk, position);
        position += chunk.length;
      }
      if (options.owner) await out.chown(options.owner.uid, options.owner.gid);
      await out.chmod(options.mode);
    } catch (err) {
      await out.close().catch(() => {});
      await fsp.rm(tmp, { force: true });
      throw err;
    }
    await out.close();
  } finally {
    await input.close();
  }
  try {
    await fsp.rename(tmp, path.join(dir, name));
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Sorgt dafür, dass parent/name ein echter Ordner ist. Mit `replace` wird ein Link oder eine Datei an der Stelle
 * entfernt (nur bei gestoppter Welt), sonst ist das ein Fehler.
 */
export async function ensureDir(parent: string, name: string, owner: Owner | null, mode: number, replace = false): Promise<string> {
  const target = path.join(parent, name);
  const st = await lstatOrNull(target);
  if (st?.isDirectory()) return target;
  if (st) {
    if (!replace) throw new AgentError(`${name} ist kein Ordner.`);
    await fsp.rm(target, { recursive: true, force: true });
  }
  try {
    await fsp.mkdir(target, { mode });
  } catch (err) {
    if (!isErrnoCode(err, 'EEXIST')) throw err;
  }
  if (owner) await fsp.lchown(target, owner.uid, owner.gid);
  await fsp.chmod(target, mode);
  return target;
}

export interface WalkOptions {
  maxEntries: number;
  maxDepth: number;
  /** true: Eintrag (Datei oder Ordner) überspringen; parts relativ zur Wurzel */
  skip?: (parts: string[], entry: fs.Dirent) => boolean;
}

/**
 * Geht alle normalen Dateien unter rootReal/startParts durch, folgt keinen Links. Vor jedem Ordner wird geprüft, dass
 * sein realpath genau der erwartete Pfad ist (sonst wird er übersprungen). Wirft bei mehr als maxEntries Einträgen.
 */
export async function walkFiles(
  rootReal: string,
  startParts: string[],
  options: WalkOptions,
  visit: (parts: string[], stats: fs.Stats) => Promise<void> | void,
): Promise<void> {
  let count = 0;
  const walk = async (parts: string[], depth: number): Promise<void> => {
    const dir = path.join(rootReal, ...parts);
    const real = await fsp.realpath(dir).catch(() => null);
    if (real === null || real !== dir) return;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      count += 1;
      if (count > options.maxEntries) throw new AgentError(`Zu viele Dateien (mehr als ${options.maxEntries}).`, 'too-large');
      const childParts = [...parts, entry.name];
      if (options.skip?.(childParts, entry)) continue;
      if (entry.isDirectory()) {
        if (depth + 1 <= options.maxDepth) await walk(childParts, depth + 1);
      } else if (entry.isFile()) {
        const st = await lstatOrNull(path.join(dir, entry.name));
        if (st?.isFile()) await visit(childParts, st);
      }
      // Links, Sockets, FIFOs, Geräte: nie
    }
  };
  await walk(startParts, 0);
}

/** SHA-Prüfsumme einer Datei (ohne Links zu folgen). */
export async function hashFile(file: string, algorithm: 'sha256' | 'sha512'): Promise<string> {
  const fh = await fsp.open(file, O_RDONLY | O_NOFOLLOW);
  try {
    const hash = createHash(algorithm);
    for await (const chunk of readChunks(fh)) hash.update(chunk);
    return hash.digest('hex');
  } finally {
    await fh.close();
  }
}

/** Schreibt einen Buffer vollständig an eine Position. */
export async function writeAllAt(fh: FileHandle, data: Buffer, position: number): Promise<void> {
  let done = 0;
  while (done < data.length) {
    const { bytesWritten } = await fh.write(data, done, data.length - done, position + done);
    done += bytesWritten;
  }
}

export async function readJsonOrNull<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as T;
  } catch (err) {
    if (isErrnoCode(err, 'ENOENT')) return null;
    throw err;
  }
}

export const FLAGS = { O_RDONLY, O_WRONLY, O_CREAT, O_EXCL };
