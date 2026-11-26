// Kleiner, vorsichtiger ZIP-Leser für eingereichte Addons (JAR): Inhaltsverzeichnis lesen, einzelne Einträge entpacken
// (gespeichert oder Deflate), nichts ausführen. Ohne Bibliothek. Wehrt Zip-Bomben, sehr viele Einträge, überlappende
// Einträge, verschlüsselte Einträge, ZIP64 und Pfade mit „..“ ab; alles andere als ein sauberes Archiv wird abgelehnt.
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import { crc32, inflateRawSync } from 'node:zlib';
import { codePointLength, hasForbiddenChars } from './validate';

/** Höchstens so viele Einträge (auch große Addons haben einige hundert). */
export const MAX_ZIP_ENTRIES = 20_000;
/** Höchstens so viel entpackt, alle Einträge zusammen (sonst gilt das Archiv als Zip-Bombe). */
export const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;
/** Stärker komprimiert darf heldix.addon.json nicht sein (Zip-Bombe). */
export const MAX_METADATA_RATIO = 100;
/** Größte heldix.addon.json (entpackt). */
export const MAX_METADATA_BYTES = 64 * 1024;
/** Größte einzelne Klassendatei (entpackt); echte Klassen sind viel kleiner. */
export const MAX_CLASS_BYTES = 16 * 1024 * 1024;
/** Längster Name eines Eintrags. */
const MAX_NAME_BYTES = 1024;

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const CENTRAL_SIZE = 46;
const LOCAL_SIZE = 30;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/** Fehler mit deutschem Text, warum die Datei keine saubere JAR ist. */
export class ZipProblem extends Error {}

export interface ZipEntry {
  name: string;
  method: typeof METHOD_STORED | typeof METHOD_DEFLATE;
  crc32: number;
  compressedSize: number;
  /** entpackte Größe laut Inhaltsverzeichnis */
  size: number;
  /** Beginn der Daten (nach dem lokalen Kopf) */
  dataStart: number;
  directory: boolean;
}

const decoder = new TextDecoder('utf-8', { fatal: false });

const broken = (detail: string) => new ZipProblem(`Die JAR ist beschädigt (${detail}).`);

/** Prüft einen Namen im Archiv: keine absoluten Pfade, keine Laufwerke, keine Backslashes, kein „..“, kein NUL. */
function checkName(name: string): void {
  const bad =
    name === '' ||
    name.includes('\0') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    /^[A-Za-z]:/.test(name) ||
    name.split('/').some((part) => part === '..');
  if (bad) {
    const shown = name.replace(/[\p{Cc}]/gu, '?').slice(0, 120);
    throw new ZipProblem(`Die JAR enthält einen ungültigen Pfad: „${shown}“ (keine „..“, keine absoluten Pfade, keine Backslashes).`);
  }
}

/** Sucht das Ende des Inhaltsverzeichnisses: genau am Dateiende, höchstens mit Kommentar dahinter. */
function findEnd(buf: Buffer): number {
  const last = buf.length - EOCD_SIZE;
  const first = Math.max(0, last - 0xffff);
  for (let pos = last; pos >= first; pos--) {
    if (buf.readUInt32LE(pos) !== EOCD_SIGNATURE) continue;
    if (pos + EOCD_SIZE + buf.readUInt16LE(pos + 20) === buf.length) return pos;
  }
  throw new ZipProblem('Die Datei ist keine gültige JAR (ZIP-Inhaltsverzeichnis fehlt oder ist beschädigt).');
}

/**
 * Liest das Inhaltsverzeichnis (End of Central Directory → Central Directory → lokale Köpfe) und prüft es streng:
 * ein Datenträger, kein ZIP64, höchstens `MAX_ZIP_ENTRIES` Einträge, nur „stored“ und „deflate“, nichts
 * verschlüsselt, keine doppelten Namen, keine überlappenden Einträge, entpackt höchstens `MAX_UNPACKED_BYTES`.
 */
export function readZip(buf: Buffer): ZipEntry[] {
  if (buf.length < EOCD_SIZE) throw new ZipProblem('Die Datei ist keine gültige JAR (zu kurz).');
  const end = findEnd(buf);
  const disk = buf.readUInt16LE(end + 4);
  const cdDisk = buf.readUInt16LE(end + 6);
  const onDisk = buf.readUInt16LE(end + 8);
  const total = buf.readUInt16LE(end + 10);
  const cdSize = buf.readUInt32LE(end + 12);
  const cdOffset = buf.readUInt32LE(end + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff || (end >= 20 && buf.readUInt32LE(end - 20) === ZIP64_LOCATOR_SIGNATURE)) {
    throw new ZipProblem('Die JAR nutzt ZIP64; das wird nicht unterstützt.');
  }
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) throw new ZipProblem('Die JAR ist auf mehrere Teile verteilt; das wird nicht unterstützt.');
  if (total > MAX_ZIP_ENTRIES) throw new ZipProblem(`Die JAR hat zu viele Einträge (höchstens ${MAX_ZIP_ENTRIES}).`);
  if (cdOffset + cdSize !== end) throw broken('Inhaltsverzeichnis an falscher Stelle');

  const entries: (ZipEntry & { localOffset: number; dataEnd: number })[] = [];
  const names = new Set<string>();
  let unpacked = 0;
  let pos = cdOffset;
  for (let i = 0; i < total; i++) {
    if (pos + CENTRAL_SIZE > end || buf.readUInt32LE(pos) !== CENTRAL_SIGNATURE) throw broken('Eintrag im Inhaltsverzeichnis');
    const flags = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const crc = buf.readUInt32LE(pos + 16);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const size = buf.readUInt32LE(pos + 24);
    const nameLength = buf.readUInt16LE(pos + 28);
    const extraLength = buf.readUInt16LE(pos + 30);
    const commentLength = buf.readUInt16LE(pos + 32);
    const diskStart = buf.readUInt16LE(pos + 34);
    const localOffset = buf.readUInt32LE(pos + 42);
    const next = pos + CENTRAL_SIZE + nameLength + extraLength + commentLength;
    if (next > end) throw broken('Eintrag im Inhaltsverzeichnis');
    if (nameLength > MAX_NAME_BYTES) throw new ZipProblem('Die JAR enthält einen zu langen Namen.');
    const nameBytes = buf.subarray(pos + CENTRAL_SIZE, pos + CENTRAL_SIZE + nameLength);
    // Java schreibt Namen als UTF-8 (mit oder ohne Kennzeichen); für die Prüfung zählen nur die ASCII-Zeichen.
    const name = decoder.decode(nameBytes);
    checkName(name);
    if (names.has(name)) throw new ZipProblem(`Die JAR enthält „${name.slice(0, 120)}“ doppelt.`);
    names.add(name);
    if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) throw new ZipProblem('Die JAR enthält verschlüsselte Einträge.');
    if (method !== METHOD_STORED && method !== METHOD_DEFLATE) {
      throw new ZipProblem('Die JAR nutzt eine nicht unterstützte Kompression (nur „stored“ und „deflate“).');
    }
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw new ZipProblem('Die JAR nutzt ZIP64; das wird nicht unterstützt.');
    }
    if (diskStart !== 0) throw new ZipProblem('Die JAR ist auf mehrere Teile verteilt; das wird nicht unterstützt.');
    if (method === METHOD_STORED && compressedSize !== size) throw broken(`Größen von „${name.slice(0, 120)}“`);
    const directory = name.endsWith('/');
    if (directory && size !== 0) throw broken(`Ordner „${name.slice(0, 120)}“ mit Inhalt`);
    unpacked += size;
    if (unpacked > MAX_UNPACKED_BYTES) {
      throw new ZipProblem(`Die JAR ist entpackt zu groß (über ${MAX_UNPACKED_BYTES / 1024 / 1024} MiB) – das sieht nach einer Zip-Bombe aus.`);
    }

    // Lokaler Kopf: muss zum Inhaltsverzeichnis passen (gleicher Name, gleiche Kompression).
    if (localOffset + LOCAL_SIZE > cdOffset || buf.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw broken(`lokaler Kopf von „${name.slice(0, 120)}“`);
    const localFlags = buf.readUInt16LE(localOffset + 6);
    const localMethod = buf.readUInt16LE(localOffset + 8);
    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const localExtraLength = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + LOCAL_SIZE + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > cdOffset) throw broken(`Daten von „${name.slice(0, 120)}“ reichen über das Ende`);
    if (localMethod !== method || localFlags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) throw broken(`lokaler Kopf von „${name.slice(0, 120)}“`);
    if (!buf.subarray(localOffset + LOCAL_SIZE, localOffset + LOCAL_SIZE + localNameLength).equals(nameBytes)) {
      throw broken(`Name von „${name.slice(0, 120)}“ passt nicht zum Inhaltsverzeichnis`);
    }
    entries.push({ name, method, crc32: crc, compressedSize, size, dataStart, directory, localOffset, dataEnd });
    pos = next;
  }
  if (pos !== end) throw broken('Inhaltsverzeichnis');

  // Einträge dürfen sich nicht überlappen (sonst lässt sich eine kleine Datei vielfach entpacken).
  const ordered = [...entries].sort((a, b) => a.localOffset - b.localOffset);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i - 1]!.dataEnd > ordered[i]!.localOffset) throw new ZipProblem('Die JAR enthält überlappende Einträge – das sieht nach einer Zip-Bombe aus.');
  }
  return entries.map(({ localOffset: _offset, dataEnd: _end, ...entry }) => entry);
}

/**
 * Entpackt einen Eintrag (höchstens `maxBytes`, nie mehr als im Inhaltsverzeichnis steht) und prüft Größe und CRC-32.
 */
export function readEntry(buf: Buffer, entry: ZipEntry, maxBytes: number): Buffer {
  const label = entry.name.slice(0, 120);
  if (entry.size > maxBytes) throw new ZipProblem(`„${label}“ ist entpackt zu groß (höchstens ${Math.floor(maxBytes / 1024)} KB).`);
  const raw = buf.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
  let data: Buffer;
  if (entry.method === METHOD_STORED) {
    data = raw;
  } else {
    try {
      // Nie mehr als die angegebene Größe: Lügt das Inhaltsverzeichnis, bricht zlib ab, statt weiterzumachen.
      data = inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.size) });
    } catch {
      throw broken(`„${label}“ lässt sich nicht entpacken`);
    }
  }
  if (data.length !== entry.size || crc32(data) !== entry.crc32) throw broken(`Prüfsumme von „${label}“`);
  return data;
}

// ---------- Prüfung einer Addon-JAR ----------

/** Grobe Hinweise aus den Klassendateien, in dieser Reihenfolge. */
export const INSPECTION_USES = ['netzwerk', 'dateien', 'prozesse', 'reflection', 'nativ', 'minecraft'] as const;
export type InspectionUse = (typeof INSPECTION_USES)[number];

/** Wonach in den Konstanten der Klassendateien gesucht wird (nicht ausgeführt, nur Bytes verglichen). */
const NEEDLES: readonly [InspectionUse, Buffer][] = (
  [
    ['netzwerk', 'java/net/'],
    ['dateien', 'java/io/File'],
    ['dateien', 'java/nio/file/'],
    ['prozesse', 'java/lang/ProcessBuilder'],
    ['prozesse', 'java/lang/Runtime'],
    ['reflection', 'java/lang/reflect/'],
    ['nativ', 'loadLibrary'],
    ['nativ', 'java/lang/foreign'],
    ['minecraft', 'net/minecraft/'],
  ] as const
).map(([use, text]) => [use, Buffer.from(text, 'latin1')] as [InspectionUse, Buffer]);

/** Native Bibliotheken in der JAR zählen ebenfalls als „nativ“. */
const NATIVE_FILE_RE = /\.(?:dll|so|dylib|jnilib)$/i;

/** Muster wie in heldix.addon.json und im Manifest. */
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
/** Voll qualifizierter Klassenname, z. B. dev.heldixclient.addons.spotify.SpotifyAddon */
const CLASS_NAME_RE = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

export const METADATA_FILE = 'heldix.addon.json';

/** Was die Prüfung einer Addon-JAR ergibt. */
export interface AddonJarInfo {
  id: string;
  version: string;
  api: number;
  entrypoint: string;
  name: string;
  /** Kurzbeschreibung (description aus heldix.addon.json), kann leer sein */
  description: string;
  /** Autoren aus heldix.addon.json (0–5) */
  authors: string[];
  inspection: { classes: number; uses: InspectionUse[] };
}

/** Ein Byte-Order-Mark am Anfang (manche Editoren) stört JSON.parse. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function metaText(value: unknown, field: string, min: number, max: number): string {
  if (value === undefined && min === 0) return '';
  if (typeof value !== 'string') throw new ZipProblem(`„${field}“ in ${METADATA_FILE} fehlt oder ist kein Text.`);
  const text = value.trim();
  if (hasForbiddenChars(text, false)) throw new ZipProblem(`„${field}“ in ${METADATA_FILE} enthält Zeichen, die nicht erlaubt sind.`);
  if (codePointLength(text) < min) throw new ZipProblem(`„${field}“ in ${METADATA_FILE} darf nicht leer sein.`);
  if (codePointLength(text) > max) throw new ZipProblem(`„${field}“ in ${METADATA_FILE} ist zu lang (höchstens ${max} Zeichen).`);
  return text;
}

/** Prüft den Inhalt von heldix.addon.json (wie der Store ihn braucht). */
function checkMetadata(data: Buffer): Omit<AddonJarInfo, 'inspection'> {
  let meta: unknown;
  try {
    meta = JSON.parse(stripBom(data.toString('utf8')));
  } catch {
    throw new ZipProblem(`${METADATA_FILE} ist kein gültiges JSON.`);
  }
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) throw new ZipProblem(`${METADATA_FILE} ist kein JSON-Objekt.`);
  const m = meta as Record<string, unknown>;
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) {
    throw new ZipProblem(`„id“ in ${METADATA_FILE} ist ungültig (1–40 Zeichen aus a–z, 0–9, _ und -, am Anfang a–z oder 0–9).`);
  }
  if (typeof m.version !== 'string' || !VERSION_RE.test(m.version)) {
    throw new ZipProblem(`„version“ in ${METADATA_FILE} ist ungültig (erwartet z. B. 1.2.0 oder 1.2.0-beta.1).`);
  }
  if (typeof m.api !== 'number' || !Number.isInteger(m.api) || m.api < 1 || m.api > 99) {
    throw new ZipProblem(`„api“ in ${METADATA_FILE} muss eine ganze Zahl von 1 bis 99 sein.`);
  }
  if (typeof m.entrypoint !== 'string' || m.entrypoint.length > 300 || !CLASS_NAME_RE.test(m.entrypoint)) {
    throw new ZipProblem(`„entrypoint“ in ${METADATA_FILE} fehlt oder ist kein Klassenname (z. B. dev.beispiel.MeinAddon).`);
  }
  const name = metaText(m.name, 'name', 1, 40);
  const description = metaText(m.description, 'description', 0, 200);
  let authors: string[] = [];
  if (m.authors !== undefined) {
    if (!Array.isArray(m.authors) || m.authors.length > 5) throw new ZipProblem(`„authors“ in ${METADATA_FILE} muss eine Liste mit höchstens 5 Namen sein.`);
    authors = m.authors.map((author, i) => metaText(author, `authors (Eintrag ${i + 1})`, 1, 40));
  }
  return { id: m.id, version: m.version, api: m.api, entrypoint: m.entrypoint, name, description, authors };
}

/**
 * Prüft eine Addon-JAR: ZIP-Struktur, heldix.addon.json (id, version, api, entrypoint, name, description, authors),
 * die Einstiegsklasse ist vorhanden, und zählt die Klassendateien samt groben Hinweisen (Bytes nach Konstanten
 * durchsucht, nichts ausgeführt). Gibt zwischendurch die Ereignisschleife frei. Wirft `ZipProblem`.
 */
export async function inspectAddonJar(buf: Buffer): Promise<AddonJarInfo> {
  const entries = readZip(buf);
  const metaEntry = entries.find((e) => e.name === METADATA_FILE);
  if (!metaEntry || metaEntry.directory) throw new ZipProblem(`In der JAR fehlt ${METADATA_FILE}.`);
  if (metaEntry.size > MAX_METADATA_BYTES) throw new ZipProblem(`${METADATA_FILE} ist zu groß (höchstens ${MAX_METADATA_BYTES / 1024} KB).`);
  if (metaEntry.size > MAX_METADATA_RATIO * Math.max(1, metaEntry.compressedSize)) {
    throw new ZipProblem(`${METADATA_FILE} ist verdächtig stark komprimiert (über ${MAX_METADATA_RATIO}:1) – das sieht nach einer Zip-Bombe aus.`);
  }
  const meta = checkMetadata(readEntry(buf, metaEntry, MAX_METADATA_BYTES));
  const entrypointFile = `${meta.entrypoint.replace(/\./g, '/')}.class`;
  if (!entries.some((e) => e.name === entrypointFile)) {
    throw new ZipProblem(`Die Einstiegsklasse ${meta.entrypoint} (aus ${METADATA_FILE}) fehlt in der JAR.`);
  }

  const found = new Set<InspectionUse>();
  let classes = 0;
  let sinceYield = 0;
  for (const entry of entries) {
    if (entry.directory) continue;
    if (NATIVE_FILE_RE.test(entry.name)) found.add('nativ');
    if (!entry.name.endsWith('.class')) continue;
    classes++;
    const data = readEntry(buf, entry, MAX_CLASS_BYTES);
    for (const [use, needle] of NEEDLES) if (!found.has(use) && data.includes(needle)) found.add(use);
    sinceYield += data.length + entry.compressedSize;
    if (sinceYield > 4 * 1024 * 1024) {
      sinceYield = 0;
      await yieldToLoop();
    }
  }
  return { ...meta, inspection: { classes, uses: INSPECTION_USES.filter((use) => found.has(use)) } };
}
