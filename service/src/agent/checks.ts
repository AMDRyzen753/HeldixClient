// Strenge Prüfung aller Eingaben des Welten-Wächters. Nichts geht ungeprüft an Docker, das Dateisystem oder eine
// Download-Adresse: Welt-IDs, Namen und Pfade nur nach festen Mustern, Adressen nur von festen Hosts, Werte der
// server.properties nur aus der erlaubten Auswahl. Es gibt keine frei wählbaren Pfade, Images oder Befehle.
import path from 'node:path';
import {
  ALLOWED_PROPERTIES,
  HOSTED_WORLD_ID_RE,
  type PluginFile,
  type PrepareOptions,
  type ServerJar,
} from '../hosting/runner';
import { AgentError } from './errors';

export type AllowedProperty = (typeof ALLOWED_PROPERTIES)[number];

/** Steuerzeichen (C0, DEL, C1) und die Unicode-Zeilentrenner */
export const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export const MAX_CONSOLE_LINE = 256;
export const MAX_PLUGINS = 30;
export const TEXT_EXTENSIONS = ['yml', 'yaml', 'json', 'properties', 'txt', 'toml'] as const;
export const MAX_TEXT_FILE_BYTES = 256 * 1024;
export const MIN_MEMORY_MB = 1024;
export const MAX_MEMORY_MB = 16384;

const PLUGIN_NAME_RE = /^[A-Za-z0-9_+-][A-Za-z0-9._+-]{0,95}\.jar$/;
const BACKUP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const FILE_PART_RE = /^[A-Za-z0-9_+@()[\]-][A-Za-z0-9 ._+@()[\]-]{0,99}$/;
const UPLOAD_PART_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/;
const HEX = (length: number) => new RegExp(`^[0-9a-f]{${length}}$`);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Buffer.isBuffer(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Objekt mit höchstens diesen Feldern (alles andere ist ein Fehler, damit nichts Unbekanntes durchrutscht). */
export function checkKeys(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw new AgentError(`${label}: Objekt erwartet.`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new AgentError(`${label}: unbekanntes Feld „${key.slice(0, 40)}“.`);
  }
  return value;
}

export function checkInt(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new AgentError(`${label}: ganze Zahl von ${min} bis ${max} erwartet.`);
  }
  return value;
}

export function checkWorld(value: unknown): string {
  if (typeof value !== 'string' || !HOSTED_WORLD_ID_RE.test(value)) {
    throw new AgentError('Ungültige Welt-ID (erwartet 32 Zeichen 0–9 und a–f).');
  }
  return value;
}

/** Eine Zeile für die Server-Konsole: 1–256 Zeichen, keine Steuerzeichen, keine Zeilenumbrüche. */
export function checkConsoleLine(value: unknown): string {
  if (typeof value !== 'string') throw new AgentError('Befehl: Text erwartet.');
  if (value.length === 0 || value.length > MAX_CONSOLE_LINE) throw new AgentError(`Befehl: 1 bis ${MAX_CONSOLE_LINE} Zeichen.`);
  if (CONTROL_RE.test(value)) throw new AgentError('Befehl: keine Steuerzeichen oder Zeilenumbrüche.');
  if (value.trim() === '') throw new AgentError('Befehl: leer.');
  return value;
}

export function checkPluginName(value: unknown): string {
  if (typeof value !== 'string' || !PLUGIN_NAME_RE.test(value)) {
    throw new AgentError('Ungültiger Plugin-Dateiname (erlaubt: Buchstaben, Ziffern, . _ + -, Endung .jar, bis 100 Zeichen).');
  }
  return value;
}

export function checkBackupName(value: unknown): string {
  if (typeof value !== 'string' || !BACKUP_NAME_RE.test(value) || value.includes('..') || value.endsWith('.')) {
    throw new AgentError('Ungültiger Name der Sicherung (erlaubt: Buchstaben, Ziffern, . _ -, bis 96 Zeichen).');
  }
  return value;
}

export function checkSha(value: unknown, length: 40 | 64 | 128, label: string): string {
  if (typeof value !== 'string' || !HEX(length).test(value)) throw new AgentError(`${label}: ${length} Hex-Zeichen (klein) erwartet.`);
  return value;
}

function parseHttps(value: unknown, label: string): URL {
  if (typeof value !== 'string' || value.length > 512 || CONTROL_RE.test(value)) throw new AgentError(`${label}: ungültige Adresse.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AgentError(`${label}: ungültige Adresse.`);
  }
  if (url.href !== value) throw new AgentError(`${label}: Adresse nicht in Normalform.`);
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new AgentError(`${label}: nur https-Adressen ohne Port, Anmeldung und Parameter.`);
  }
  return url;
}

/** Plugins nur von https://cdn.modrinth.com/data/<projekt>/versions/<version>/<datei> */
export function checkModrinthUrl(value: unknown): string {
  const url = parseHttps(value, 'Plugin');
  if (url.hostname !== 'cdn.modrinth.com') throw new AgentError('Plugins nur von https://cdn.modrinth.com/.');
  if (!/^\/data\/[A-Za-z0-9]{1,32}\/versions\/[A-Za-z0-9]{1,32}\/[A-Za-z0-9._%+()!~'-]{1,200}$/.test(url.pathname) || url.pathname.includes('..')) {
    throw new AgentError('Plugin: unerwarteter Pfad auf cdn.modrinth.com.');
  }
  return url.href;
}

export function checkPluginFile(value: unknown): PluginFile {
  const v = checkKeys(value, ['name', 'url', 'sha512'], 'Plugin');
  return { name: checkPluginName(v.name), url: checkModrinthUrl(v.url), sha512: checkSha(v.sha512, 128, 'SHA-512') };
}

/** Server-Jar: Paper nur von fill-data.papermc.io (SHA-256), Vanilla nur von piston-data.mojang.com (SHA-1). */
export function checkServerJar(value: unknown): ServerJar {
  const v = checkKeys(value, ['software', 'version', 'url', 'sha256', 'sha1', 'build'], 'Server-Jar');
  if (v.software !== 'paper' && v.software !== 'vanilla') throw new AgentError('Server-Jar: Software „paper“ oder „vanilla“.');
  if (typeof v.version !== 'string' || !VERSION_RE.test(v.version)) throw new AgentError('Server-Jar: ungültige Minecraft-Version.');
  const url = parseHttps(v.url, 'Server-Jar');
  if (v.software === 'paper') {
    if (url.hostname !== 'fill-data.papermc.io' || !/^\/v1\/objects\/[0-9a-f]{64}\/[A-Za-z0-9._+-]{1,128}\.jar$/.test(url.pathname)) {
      throw new AgentError('Paper nur von https://fill-data.papermc.io/v1/objects/….');
    }
    if (v.sha1 !== undefined && v.sha1 !== null) throw new AgentError('Server-Jar: Paper wird mit SHA-256 geprüft, nicht mit SHA-1.');
    return {
      software: 'paper',
      version: v.version,
      url: url.href,
      sha256: checkSha(v.sha256, 64, 'SHA-256'),
      build: checkInt(v.build, 0, 1_000_000, 'Paper-Build'),
    };
  }
  if (url.hostname !== 'piston-data.mojang.com' || !/^\/v1\/objects\/[0-9a-f]{40}\/server\.jar$/.test(url.pathname)) {
    throw new AgentError('Vanilla nur von https://piston-data.mojang.com/v1/objects/…/server.jar.');
  }
  if (v.sha256 !== undefined && v.sha256 !== null) throw new AgentError('Server-Jar: Vanilla wird mit SHA-1 aus dem Versions-Manifest geprüft.');
  if (v.build !== null && v.build !== undefined) throw new AgentError('Server-Jar: Vanilla hat keinen Build.');
  return { software: 'vanilla', version: v.version, url: url.href, sha1: checkSha(v.sha1, 40, 'SHA-1'), build: null };
}

const BOOL = (v: string) => v === 'true' || v === 'false';
const RANGE = (min: number, max: number) => (v: string) => /^\d{1,4}$/.test(v) && Number(v) >= min && Number(v) <= max;

const PROPERTY_RULES: Record<AllowedProperty, (v: string) => boolean> = {
  difficulty: (v) => ['peaceful', 'easy', 'normal', 'hard'].includes(v),
  gamemode: (v) => ['survival', 'creative', 'adventure', 'spectator'].includes(v),
  pvp: BOOL,
  'max-players': RANGE(1, 100),
  'view-distance': RANGE(2, 32),
  'simulation-distance': RANGE(2, 32),
  'spawn-protection': RANGE(0, 1000),
  'allow-flight': BOOL,
  'level-seed': (v) => v.length <= 64 && !CONTROL_RE.test(v),
  'level-type': (v) => /^[a-z0-9_.:-]{1,64}$/.test(v),
  'generate-structures': BOOL,
  hardcore: BOOL,
  'force-gamemode': BOOL,
  'spawn-monsters': BOOL,
  'allow-nether': BOOL,
};

/** Nur die erlaubten Schlüssel (ALLOWED_PROPERTIES) mit passenden Werten; motd und Ports setzt der Wächter selbst. */
export function checkProperties(value: unknown): Record<string, string> {
  const v = checkKeys(value, ALLOWED_PROPERTIES, 'Einstellungen');
  const result: Record<string, string> = {};
  for (const key of ALLOWED_PROPERTIES) {
    const raw = v[key];
    if (raw === undefined) continue;
    if (typeof raw !== 'string' || !PROPERTY_RULES[key](raw)) throw new AgentError(`Einstellung ${key}: ungültiger Wert.`);
    result[key] = raw;
  }
  return result;
}

/** Beschreibung für die Serverliste: bis 256 Zeichen, höchstens ein Zeilenumbruch, sonst keine Steuerzeichen. */
export function checkMotd(value: unknown): string {
  if (typeof value !== 'string' || value.length > 256) throw new AgentError('MOTD: Text bis 256 Zeichen erwartet.');
  const lines = value.split('\n');
  if (lines.length > 2 || lines.some((line) => CONTROL_RE.test(line))) throw new AgentError('MOTD: höchstens zwei Zeilen, keine Steuerzeichen.');
  return value;
}

/** Symbol für die Serverliste: PNG mit 64×64 Pixeln, höchstens 64 KB. */
export function checkIcon(value: unknown): Buffer {
  if (!Buffer.isBuffer(value) || value.length < 33 || value.length > 64 * 1024) throw new AgentError('Symbol: PNG bis 64 KB erwartet.');
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!value.subarray(0, 8).equals(signature) || value.toString('latin1', 12, 16) !== 'IHDR') throw new AgentError('Symbol: kein PNG.');
  if (value.readUInt32BE(16) !== 64 || value.readUInt32BE(20) !== 64) throw new AgentError('Symbol: muss 64×64 Pixel groß sein.');
  return value;
}

export function checkMemory(value: unknown): number {
  return checkInt(value, MIN_MEMORY_MB, MAX_MEMORY_MB, 'Arbeitsspeicher (MB)');
}

export function checkPrepare(value: unknown): PrepareOptions {
  const v = checkKeys(value, ['jar', 'memoryMb', 'properties', 'motd', 'iconPng'], 'Vorbereiten');
  return {
    jar: checkServerJar(v.jar),
    memoryMb: checkMemory(v.memoryMb),
    properties: checkProperties(v.properties ?? {}),
    motd: checkMotd(v.motd),
    ...(v.iconPng === undefined ? {} : { iconPng: checkIcon(v.iconPng) }),
  };
}

/**
 * Pfad einer Textdatei unter plugins/ (Plugin-Konfiguration). Angenommen wird „plugins/<…>“ oder ohne „plugins/“;
 * zurück kommt immer „plugins/<…>“ (relativ zum Datenordner der Welt). Keine absoluten Pfade, kein „..“, keine
 * versteckten Ordner, nur yml, yaml, json, properties, txt und toml.
 */
export function checkPluginFilePath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 400 || CONTROL_RE.test(value) || value.includes('\\')) {
    throw new AgentError('Ungültiger Dateipfad.');
  }
  const rel = value.startsWith('plugins/') ? value.slice('plugins/'.length) : value;
  if (rel.startsWith('/')) throw new AgentError('Dateipfad muss relativ sein (unter plugins/).');
  const parts = rel.split('/');
  if (parts.length > 8) throw new AgentError('Dateipfad zu tief verschachtelt.');
  for (const part of parts) {
    if (part === '.' || part === '..' || !FILE_PART_RE.test(part) || part.endsWith(' ') || part.endsWith('.')) {
      throw new AgentError(`Ungültiger Teil im Dateipfad: „${part.slice(0, 40)}“.`);
    }
  }
  const last = parts[parts.length - 1]!;
  const dot = last.lastIndexOf('.');
  const extension = dot > 0 ? last.slice(dot + 1).toLowerCase() : '';
  if (!(TEXT_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new AgentError(`Nur Textdateien (${TEXT_EXTENSIONS.join(', ')}) unter plugins/.`);
  }
  return ['plugins', ...parts].join('/');
}

/** Inhalt einer Textdatei: höchstens 256 KB (UTF-8), keine NUL-Zeichen. */
export function checkTextContent(value: unknown): Buffer {
  if (typeof value !== 'string') throw new AgentError('Dateiinhalt: Text erwartet.');
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > MAX_TEXT_FILE_BYTES) throw new AgentError('Datei zu groß (höchstens 256 KB).', 'too-large');
  if (value.includes('\0')) throw new AgentError('Dateiinhalt: keine NUL-Zeichen.');
  return bytes;
}

/**
 * Pfad im Upload-Ordner des Dienstes (Import und Export). Absolut, normalisiert, darunter höchstens vier Ebenen aus
 * Buchstaben, Ziffern, . _ - (kein „..“). Liefert die Teile relativ zum Upload-Ordner.
 */
export function checkUploadPath(value: unknown, uploadsDir: string): string[] {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024 || CONTROL_RE.test(value)) {
    throw new AgentError('Ungültiger Pfad für Upload/Download.');
  }
  if (!path.isAbsolute(value) || path.normalize(value) !== value) {
    throw new AgentError('Pfad für Upload/Download muss absolut und normalisiert sein.');
  }
  const rel = path.relative(uploadsDir, value);
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new AgentError('Pfad liegt nicht im Upload-Ordner des Dienstes.');
  }
  const parts = rel.split(path.sep);
  if (parts.length > 4) throw new AgentError('Pfad im Upload-Ordner zu tief verschachtelt.');
  for (const part of parts) {
    if (!UPLOAD_PART_RE.test(part) || part.includes('..')) throw new AgentError(`Ungültiger Name im Upload-Ordner: „${part.slice(0, 40)}“.`);
  }
  return parts;
}
