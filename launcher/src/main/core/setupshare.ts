// Setup teilen (Launcher 0.14.1, Heldix-Dienst 1.14.0): Links, das Format „content“ und die Einstellungen aus
// options.txt. Nachbauen, Vorschau und Anfragen an den Dienst stehen in core/setupinstall.ts.
//
// - Links: heldixclient://setup/<code> (gleicher Weg wie einladung/welt, core/invites.ts) und auf der Webseite
//   /setup#<code>; Codes haben 10 Zeichen aus dem Einladungs-Alphabet. Ein bloßer Code zählt nur im Feld „Setup
//   einfügen“ (bareCode) – überall sonst wäre er von einem Einladungscode nicht zu unterscheiden.
// - content (Version 1): Minecraft-Version, Loader, HeldixClient, Listen mit Modrinth-Projekt und -Version bzw.
//   Store-Addon und die Einstellungen. Keine Dateien, keine URLs. parseSetupContent prüft alles, was von außen kommt;
//   ungültige Einträge fallen einzeln weg.
// - Einstellungen: nur die feste Liste GRAPHICS_KEYS aus options.txt und das Heldix-Leistungsprofil
//   (HELDIX_PROFILE_KEYS, config/heldixclient.json), Tasten (key_…) nur auf Wunsch. Beim Nachbauen gilt nur, was in
//   diesen Listen steht – alles andere ignoriert der Launcher.
// - options.txt einer neuen Instanz braucht eine „version:“-Zeile (Datenversion aus version.json der Client-JAR), sonst
//   schickt Minecraft die Werte durch alle Datenkorrekturen seit 2013 (z. B. würde aus key.keyboard.w
//   key.keyboard.keyboard.w). Deshalb merkt sich der Launcher die Werte in PENDING_OPTIONS_FILE und schreibt sie beim
//   ersten Start nach prepareGame (applyPendingOptions), wenn die Client-JAR da ist.

import AdmZip from 'adm-zip';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJson } from './fsutil';

export const SETUP_PROTOCOL = 'heldixclient';
/** 10 Zeichen aus abcdefghjkmnpqrstuvwxyz23456789 – wie Einladungen (isInviteCode im Dienst) */
export const SETUP_CODE_RE = /^[a-hjkmnp-z2-9]{10}$/;
/** Protokoll und „setup“ ohne Rücksicht auf Groß- und Kleinschreibung, der Code genau so wie vergeben */
const LINK_RE = /^heldixclient:\/\/setup\/([^/?#]*)\/?$/i;
const MAX_LINK_LENGTH = 200;

export const SETUP_BAD_CODE = 'Ungültiger Setup-Link.';
export const SETUP_MISSING = 'Dieses Setup gibt es nicht. Prüf den Link oder frag nach einem neuen.';
export const SETUP_GONE = 'Dieses Setup ist abgelaufen oder wurde zurückgezogen. Frag nach einem neuen Link.';
export const SETUP_OFFLINE = 'Setups teilen geht nur mit einem Microsoft-Konto.';

// ---------- Links ----------

/** Code aus heldixclient://setup/<code>, sonst null */
export function parseSetupLink(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_LINK_LENGTH) return null;
  const match = LINK_RE.exec(raw.trim());
  if (!match || !SETUP_CODE_RE.test(match[1])) return null;
  return match[1];
}

/** Erster gültiger Setup-Link in einer Befehlszeile (process.argv bzw. argv aus second-instance), sonst null */
export function findSetupLink(argv: readonly unknown[]): string | null {
  for (const arg of argv) {
    if (typeof arg !== 'string' || arg.slice(0, SETUP_PROTOCOL.length + 1).toLowerCase() !== `${SETUP_PROTOCOL}:`) continue;
    const code = parseSetupLink(arg);
    if (code) return code;
  }
  return null;
}

/** Code aus der Oberfläche prüfen */
export function setupCode(raw: unknown): string {
  if (typeof raw !== 'string' || !SETUP_CODE_RE.test(raw)) throw new Error(SETUP_BAD_CODE);
  return raw;
}

export function setupAppUrl(code: string): string {
  return `${SETUP_PROTOCOL}://setup/${code}`;
}

/** Web-Link /setup#<code> (nur https-Webseiten), sonst null */
export function setupWebUrl(website: string, code: string): string | null {
  const base = website.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+/i.test(base) || !SETUP_CODE_RE.test(code)) return null;
  const url = `${base}/setup#${code}`;
  return url.length <= 512 ? url : null;
}

/**
 * Eingefügter Setup-Link: heldixclient://setup/<code>, der Web-Link https://<Webseite>/setup#<code> (auch ohne https://,
 * Code ohne Rücksicht auf Groß- und Kleinschreibung) – auch mitten in einer kopierten Nachricht. bareCode = ein bloßer
 * Code zählt auch (nur im Feld „Setup einfügen“). Sonst null.
 */
export function parsePastedSetup(raw: unknown, options: { bareCode?: boolean } = {}): string | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  const whole = pastedSetup(raw, options.bareCode === true);
  if (whole) return whole;
  for (const word of raw.split(/\s+/).slice(0, 100)) {
    if (!/setup/i.test(word)) continue;
    const code = pastedSetup(word.replace(/^[„"'(<[]+|[“"'),.!?;:>\]]+$/g, ''), false);
    if (code) return code;
  }
  return null;
}

function pastedSetup(raw: string, bareCode: boolean): string | null {
  const text = raw.trim();
  if (!text || text.length > MAX_LINK_LENGTH) return null;
  const app = parseSetupLink(text) ?? parseSetupLink(text.replace(/[^/]*$/, (code) => code.toLowerCase()));
  if (app) return app;
  if (/^heldixclient:/i.test(text)) return null;
  if (bareCode && SETUP_CODE_RE.test(text.toLowerCase())) return text.toLowerCase();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !/^\/setup(?:\.html)?\/?$/i.test(url.pathname)) return null;
  let code: string;
  try {
    code = decodeURIComponent(url.hash.replace(/^#/, '')).trim().toLowerCase();
  } catch {
    return null;
  }
  return SETUP_CODE_RE.test(code) ? code : null;
}

// ---------- Format „content“ ----------

export const SETUP_FORMAT = 1;
export type SetupLoader = 'heldix' | 'fabric' | 'vanilla';
export type SetupListKind = 'mods' | 'resourcepacks' | 'shaderpacks' | 'addons';
export type SetupValue = number | boolean | string;

export interface SetupModrinthEntry {
  /** Modrinth-Projekt-ID (8 Zeichen) */
  project: string;
  /** Modrinth-Versions-ID (8 Zeichen) */
  version: string;
  title: string;
}

export interface SetupAddonEntry {
  /** ID im Addon-Store */
  id: string;
  /** geteilte Version (null = unbekannt); installiert wird die aktuelle Version aus dem Store */
  version: string | null;
  name: string;
}

export interface SetupContent {
  v: 1;
  minecraft: string;
  loader: SetupLoader;
  heldixClient: boolean;
  mods: SetupModrinthEntry[];
  resourcepacks: SetupModrinthEntry[];
  shaderpacks: SetupModrinthEntry[];
  addons: SetupAddonEntry[];
  settings: { graphics: Record<string, SetupValue> | null; keys: Record<string, string> | null };
}

export const MODRINTH_ID_RE = /^[A-Za-z0-9]{8}$/;
export const ADDON_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const ADDON_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
/** Minecraft-Version, wie der Dienst sie prüft */
const MINECRAFT_RE = /^[A-Za-z0-9._+-]{1,32}$/;
export const SETUP_LIST_MAX = 300;
export const SETUP_CONTENT_MAX_BYTES = 64 * 1024;
export const SETUP_GRAPHICS_MAX = 60;
export const SETUP_KEYS_MAX = 200;
export const SETUP_NAME_MAX = 40;
export const SETUP_DESCRIPTION_MAX = 300;
/** Länge der Titel in den Listen (Modrinth erlaubt bis 64) */
const TITLE_MAX = 64;
const GRAPHICS_KEY_RE = /^[A-Za-z0-9_.:]{1,64}$/;
const KEY_NAME_RE = /^key\.[A-Za-z0-9_.]{1,80}$/;
const KEY_VALUE_RE = /^key\.[a-z0-9_.]{1,40}$/;
const LISTS = ['mods', 'resourcepacks', 'shaderpacks'] as const;

const SETUP_BROKEN = 'Das Setup ist beschädigt und lässt sich nicht öffnen.';

/** Eine Zeile Text: ohne Steuerzeichen, Leerraum zusammengefasst, höchstens max Zeichen */
export function cleanLine(raw: unknown, max: number): string {
  const text = (typeof raw === 'string' ? raw : '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max).join('').trim() : text;
}

/** Wert einer Einstellung: Zahl, Ja/Nein oder Text bis 64 Zeichen ohne Steuerzeichen (wie der Dienst prüft) */
export function validSetupValue(value: unknown): value is SetupValue {
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && value.length <= 64 && !/[\u0000-\u001f\u007f]/.test(value);
}

/**
 * Prüft content aus einem Setup (vom Dienst, also von außen). Wirft bei kaputtem Aufbau, einer zu neuen Version oder
 * falscher Minecraft-Version bzw. falschem Loader; einzelne ungültige oder doppelte Einträge fallen weg (dropped).
 */
export function parseSetupContent(raw: unknown): { content: SetupContent; dropped: number } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(SETUP_BROKEN);
  const c = raw as Record<string, unknown>;
  if (typeof c.v !== 'number' || !Number.isInteger(c.v) || c.v < 1) throw new Error(SETUP_BROKEN);
  if (c.v > SETUP_FORMAT) throw new Error('Dieses Setup braucht einen neueren HeldixClient. Bitte aktualisiere den Launcher.');
  if (typeof c.minecraft !== 'string' || !MINECRAFT_RE.test(c.minecraft)) throw new Error(SETUP_BROKEN);
  if (c.loader !== 'heldix' && c.loader !== 'fabric' && c.loader !== 'vanilla') throw new Error(SETUP_BROKEN);
  const loader = c.loader;
  let dropped = 0;

  const modrinthList = (value: unknown): SetupModrinthEntry[] => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error(SETUP_BROKEN);
    const seen = new Set<string>();
    const list: SetupModrinthEntry[] = [];
    for (const item of value) {
      const e = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const project = typeof e.project === 'string' ? e.project : '';
      const version = typeof e.version === 'string' ? e.version : '';
      if (!MODRINTH_ID_RE.test(project) || !MODRINTH_ID_RE.test(version) || seen.has(project) || list.length >= SETUP_LIST_MAX) {
        dropped++;
        continue;
      }
      seen.add(project);
      list.push({ project, version, title: cleanLine(e.title, TITLE_MAX) || project });
    }
    return list;
  };
  const lists = Object.fromEntries(LISTS.map((kind) => [kind, modrinthList(c[kind])])) as Record<(typeof LISTS)[number], SetupModrinthEntry[]>;

  const addons: SetupAddonEntry[] = [];
  if (c.addons !== undefined && c.addons !== null) {
    if (!Array.isArray(c.addons)) throw new Error(SETUP_BROKEN);
    const seen = new Set<string>();
    for (const item of c.addons) {
      const e = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const id = typeof e.id === 'string' ? e.id : '';
      const version = e.version === null || e.version === undefined ? null : typeof e.version === 'string' && ADDON_VERSION_RE.test(e.version) ? e.version : undefined;
      if (!ADDON_ID_RE.test(id) || version === undefined || seen.has(id) || addons.length >= SETUP_LIST_MAX) {
        dropped++;
        continue;
      }
      seen.add(id);
      addons.push({ id, version, name: cleanLine(e.name, SETUP_NAME_MAX) || id });
    }
  }

  const settingsRaw = (c.settings && typeof c.settings === 'object' && !Array.isArray(c.settings) ? c.settings : {}) as Record<string, unknown>;
  let graphics: Record<string, SetupValue> | null = null;
  if (settingsRaw.graphics && typeof settingsRaw.graphics === 'object' && !Array.isArray(settingsRaw.graphics)) {
    graphics = {};
    for (const [key, value] of Object.entries(settingsRaw.graphics as Record<string, unknown>)) {
      if (!GRAPHICS_KEY_RE.test(key) || !validSetupValue(value) || Object.keys(graphics).length >= SETUP_GRAPHICS_MAX) {
        dropped++;
        continue;
      }
      graphics[key] = value;
    }
    if (Object.keys(graphics).length === 0) graphics = null;
  }
  let keys: Record<string, string> | null = null;
  if (settingsRaw.keys && typeof settingsRaw.keys === 'object' && !Array.isArray(settingsRaw.keys)) {
    keys = {};
    for (const [key, value] of Object.entries(settingsRaw.keys as Record<string, unknown>)) {
      if (!KEY_NAME_RE.test(key) || typeof value !== 'string' || !KEY_VALUE_RE.test(value) || Object.keys(keys).length >= SETUP_KEYS_MAX) {
        dropped++;
        continue;
      }
      keys[key] = value;
    }
    if (Object.keys(keys).length === 0) keys = null;
  }

  return {
    content: {
      v: 1,
      minecraft: c.minecraft,
      loader,
      // Heldix-Instanzen haben HeldixClient immer, Vanilla nie; Fabric: fehlt = ja (wie in den Instanzen)
      heldixClient: loader === 'heldix' ? true : loader === 'vanilla' ? false : c.heldixClient !== false,
      ...lists,
      addons,
      settings: { graphics, keys },
    },
    dropped,
  };
}

/** Größe von content, wie der Dienst sie zählt (JSON, UTF-8) */
export function setupContentBytes(content: SetupContent): number {
  return Buffer.byteLength(JSON.stringify(content), 'utf8');
}

// ---------- Einstellungen aus options.txt ----------

export const OPTIONS_FILE = 'options.txt';

/**
 * Grafik-Einstellungen, die der Launcher teilt und beim Nachbauen übernimmt (Schlüssel aus options.txt; was eine
 * Minecraft-Version nicht kennt, steht dort auch nicht und wird nie geteilt). Nichts, was zum PC gehört (Vollbild,
 * Auflösung, Audiogerät).
 */
export const GRAPHICS_KEYS: readonly string[] = [
  'renderDistance',
  'simulationDistance',
  'entityDistanceScaling',
  'graphicsMode',
  'graphicsPreset',
  'improvedTransparency',
  'maxFps',
  'inactivityFpsLimit',
  'enableVsync',
  'entityShadows',
  'particles',
  'guiScale',
  'fov',
  'fovEffectScale',
  'gamma',
  'renderClouds',
  'cloudRange',
  'biomeBlendRadius',
  'mipmapLevels',
  'ao',
  'bobView',
  'chunkSectionFadeInTime',
  'weatherRadius',
  'prioritizeChunkUpdates',
  'menuBackgroundBlurriness',
  'screenEffectScale',
  'textureFiltering',
  'cutoutLeaves',
  'vignette',
];

/**
 * Heldix-Leistungsprofil (config/heldixclient.json der Instanz, nur mit HeldixClient): FPS-Boost, Hintergrund-FPS und
 * Heldix-Shader. Im Setup als graphics-Schlüssel mit „heldix:“ davor.
 */
export const HELDIX_PROFILE_KEYS = ['heldix:fpsBoost', 'heldix:backgroundFps', 'heldix:backgroundFpsLimit', 'heldix:shader'] as const;
export const HELDIX_CONFIG = path.join('config', 'heldixclient.json');
const SHADER_ID_RE = /^[a-z0-9_-]{1,32}$/;

/** Zeilen „schlüssel:wert“ (wie Minecraft: der erste Doppelpunkt trennt) */
export function parseOptions(text: string): Map<string, string> {
  const options = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    options.set(line.slice(0, at), line.slice(at + 1));
  }
  return options;
}

/** Wert aus options.txt fürs Setup: true/false → Ja/Nein, Zahl → Zahl, sonst der Text so, wie er dasteht (auch mit "") */
export function optionValue(raw: string): SetupValue | null {
  const text = raw.trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d{1,12}(?:\.\d{1,12})?$/.test(text)) return Number(text);
  return /^[\x20-\x7e]{0,64}$/.test(text) ? text : null;
}

/** Wert aus einem Setup für options.txt (null = nicht schreiben) */
export function rawOptionValue(value: SetupValue): string | null {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  // nur druckbare Zeichen: eine Zeile in options.txt kann so nie aufhören oder eine neue anfangen
  return /^[\x20-\x7e]{0,64}$/.test(value) ? value : null;
}

/** Grafik-Werte aus options.txt (nur die feste Liste) */
export function graphicsFromOptions(options: ReadonlyMap<string, string>): Record<string, SetupValue> {
  const graphics: Record<string, SetupValue> = {};
  for (const key of GRAPHICS_KEYS) {
    const raw = options.get(key);
    if (raw === undefined) continue;
    const value = optionValue(raw);
    if (value !== null) graphics[key] = value;
  }
  return graphics;
}

/** Tasten aus options.txt (key_key.forward:key.keyboard.w → { "key.forward": "key.keyboard.w" }), höchstens 200 */
export function keysFromOptions(options: ReadonlyMap<string, string>): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const [name, raw] of options) {
    if (!name.startsWith('key_')) continue;
    const key = name.slice(4);
    const value = raw.trim();
    if (!KEY_NAME_RE.test(key) || !KEY_VALUE_RE.test(value)) continue;
    keys[key] = value;
    if (Object.keys(keys).length >= SETUP_KEYS_MAX) break;
  }
  return keys;
}

/** Heldix-Leistungsprofil aus config/heldixclient.json */
export function heldixProfileFrom(config: Record<string, unknown> | null): Record<string, SetupValue> {
  const profile: Record<string, SetupValue> = {};
  if (!config) return profile;
  if ('fpsBoost' in config) profile['heldix:fpsBoost'] = !!config.fpsBoost && typeof config.fpsBoost === 'object';
  if (typeof config.backgroundFps === 'boolean') profile['heldix:backgroundFps'] = config.backgroundFps;
  if (Number.isInteger(config.backgroundFpsLimit)) profile['heldix:backgroundFpsLimit'] = Math.min(240, Math.max(5, config.backgroundFpsLimit as number));
  if (typeof config.shader === 'string' && SHADER_ID_RE.test(config.shader)) profile['heldix:shader'] = config.shader;
  return profile;
}

/**
 * Was beim Nachbauen von graphics übrig bleibt: options = Zeilen für options.txt (nur GRAPHICS_KEYS), heldix = das
 * Leistungsprofil (nur HELDIX_PROFILE_KEYS mit passendem Typ). Alles andere ignoriert der Launcher.
 */
export function acceptedGraphics(graphics: Record<string, SetupValue> | null): { options: Record<string, string>; heldix: Record<string, SetupValue> } {
  const options: Record<string, string> = {};
  const heldix: Record<string, SetupValue> = {};
  for (const [key, value] of Object.entries(graphics ?? {})) {
    if (GRAPHICS_KEYS.includes(key)) {
      const raw = rawOptionValue(value);
      if (raw !== null) options[key] = raw;
      continue;
    }
    if (key === 'heldix:fpsBoost' || key === 'heldix:backgroundFps') {
      if (typeof value === 'boolean') heldix[key] = value;
    } else if (key === 'heldix:backgroundFpsLimit') {
      if (typeof value === 'number' && Number.isInteger(value) && value >= 5 && value <= 240) heldix[key] = value;
    } else if (key === 'heldix:shader') {
      if (typeof value === 'string' && SHADER_ID_RE.test(value)) heldix[key] = value;
    }
  }
  return { options, heldix };
}

/** Tasten fürs Nachbauen: nur gültige Namen und Werte, als Zeilen key_<name> */
export function acceptedKeys(keys: Record<string, string> | null): Record<string, string> {
  const options: Record<string, string> = {};
  for (const [key, value] of Object.entries(keys ?? {})) {
    if (KEY_NAME_RE.test(key) && typeof value === 'string' && KEY_VALUE_RE.test(value)) options[`key_${key}`] = value;
  }
  return options;
}

/**
 * Setzt Werte in options.txt und lässt alle anderen Zeilen so, wie sie sind. Ohne Datei (text null) entsteht eine neue
 * mit „version:<dataVersion>“ am Anfang – ohne Datenversion keine neue Datei (null).
 */
export function mergeOptionsText(text: string | null, changes: Record<string, string>, dataVersion: number | null): string | null {
  const pending = new Map(Object.entries(changes));
  if (text === null) {
    if (dataVersion === null || !Number.isInteger(dataVersion) || dataVersion <= 0) return null;
    return [`version:${dataVersion}`, ...[...pending].map(([key, value]) => `${key}:${value}`)].join('\n') + '\n';
  }
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const out = lines.map((line) => {
    const at = line.indexOf(':');
    if (at <= 0) return line;
    const key = line.slice(0, at);
    if (!pending.has(key)) return line;
    const value = pending.get(key)!;
    pending.delete(key);
    return `${key}:${value}`;
  });
  for (const [key, value] of pending) out.push(`${key}:${value}`);
  return `${out.join('\n')}\n`;
}

/** Ressourcenpakete in der Reihenfolge von options.txt (resourcePacks, unterste zuerst): nur eigene Dateien (file/…) */
export function activeResourcePacks(options: ReadonlyMap<string, string>): string[] {
  const raw = options.get('resourcePacks');
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .filter((entry): entry is string => typeof entry === 'string' && entry.startsWith('file/'))
      .map((entry) => entry.slice('file/'.length))
      .filter((name) => name && path.basename(name) === name);
  } catch {
    return [];
  }
}

/** resourcePacks-Zeile mit diesen Paketen obenauf (vorhandene eingebaute wie vanilla bleiben vorn) */
export function resourcePacksValue(existing: string | undefined, files: readonly string[]): string {
  let base: string[] = ['vanilla'];
  if (existing) {
    try {
      const list = JSON.parse(existing) as unknown;
      if (Array.isArray(list)) base = list.filter((e): e is string => typeof e === 'string' && !e.startsWith('file/'));
    } catch {
      // kaputte Zeile: Minecraft-Standard
    }
    if (!base.includes('vanilla')) base.unshift('vanilla');
  }
  return JSON.stringify([...base, ...files.map((f) => `file/${f}`)]);
}

/** Datenversion (world_version aus version.json) der Client-JAR, null = unbekannt */
export function dataVersionOf(clientJar: string): number | null {
  try {
    const entry = new AdmZip(clientJar).getEntry('version.json');
    if (!entry || entry.header.size > 64 * 1024) return null;
    const json = JSON.parse(entry.getData().toString('utf8')) as { world_version?: unknown };
    return Number.isInteger(json.world_version) && (json.world_version as number) > 0 ? (json.world_version as number) : null;
  } catch {
    return null;
  }
}

// ---------- Einstellungen beim ersten Start schreiben ----------

/** Werte aus einem Setup, die beim ersten Start in options.txt kommen (die Instanz hat dann noch keine) */
export const PENDING_OPTIONS_FILE = 'heldix-setup-optionen.json';

export interface PendingOptions {
  v: 1;
  /** Zeilen für options.txt (schon gefiltert: GRAPHICS_KEYS und key_…) */
  options: Record<string, string>;
  /** Ressourcenpakete aus resourcepacks/, die eingeschaltet werden (unterste zuerst) */
  resourcePacks: string[];
}

export async function writePendingOptions(gameDir: string, pending: PendingOptions): Promise<void> {
  await writeJson(path.join(gameDir, PENDING_OPTIONS_FILE), pending);
}

/**
 * Beim Spielstart nach prepareGame: Werte aus einem Setup in options.txt schreiben (neue Datei mit der Datenversion der
 * Client-JAR) und die Merkdatei löschen. Gibt eine Zeile fürs Log zurück (null = nichts zu tun).
 */
export async function applyPendingOptions(gameDir: string, clientJar: string): Promise<string | null> {
  const file = path.join(gameDir, PENDING_OPTIONS_FILE);
  const pending = await readJson<Partial<PendingOptions>>(file);
  if (!pending) return null;
  const changes: Record<string, string> = {};
  for (const [key, value] of Object.entries(pending.options && typeof pending.options === 'object' ? pending.options : {})) {
    // noch einmal prüfen: die Datei liegt im Spielordner
    const accepted = GRAPHICS_KEYS.includes(key) ? rawOptionValue(String(value)) : key.startsWith('key_') && KEY_NAME_RE.test(key.slice(4)) && KEY_VALUE_RE.test(String(value)) ? String(value) : null;
    if (accepted !== null) changes[key] = accepted;
  }
  const packs = Array.isArray(pending.resourcePacks)
    ? pending.resourcePacks.filter((name): name is string => typeof name === 'string' && path.basename(name) === name && /\.zip$/i.test(name))
    : [];
  const optionsFile = path.join(gameDir, OPTIONS_FILE);
  const text = await readFile(optionsFile, 'utf8').catch(() => null);
  if (packs.length) changes.resourcePacks = resourcePacksValue(text === null ? undefined : parseOptions(text).get('resourcePacks'), packs);
  if (Object.keys(changes).length === 0) {
    await rm(file, { force: true });
    return null;
  }
  const merged = mergeOptionsText(text, changes, text === null ? dataVersionOf(clientJar) : null);
  if (merged === null) {
    // ohne Datenversion lieber nichts schreiben; die Merkdatei bleibt für den nächsten Start
    return 'Einstellungen aus dem Setup: Datenversion von Minecraft unbekannt – sie werden beim nächsten Start übernommen.';
  }
  await mkdir(gameDir, { recursive: true });
  await writeFile(optionsFile, merged, 'utf8');
  await rm(file, { force: true });
  return `Einstellungen aus dem Setup übernommen (${Object.keys(changes).length} Werte in options.txt).`;
}

/** Leistungsprofil in config/heldixclient.json der Instanz schreiben (andere Felder bleiben) */
export async function applyHeldixProfile(gameDir: string, profile: Record<string, SetupValue>): Promise<number> {
  const entries = Object.entries(profile);
  if (entries.length === 0) return 0;
  const file = path.join(gameDir, HELDIX_CONFIG);
  const current = await readJson<unknown>(file);
  const config = (current && typeof current === 'object' && !Array.isArray(current) ? current : {}) as Record<string, unknown>;
  let changed = 0;
  for (const [key, value] of entries) {
    if (key === 'heldix:backgroundFps' && typeof value === 'boolean') config.backgroundFps = value;
    else if (key === 'heldix:backgroundFpsLimit' && typeof value === 'number') config.backgroundFpsLimit = value;
    else if (key === 'heldix:shader' && typeof value === 'string') config.shader = value;
    else if (key === 'heldix:fpsBoost' && typeof value === 'boolean') {
      // FPS-Boost merkt sich die vorherigen Werte; eine neue Instanz hat keine – die schnellen Werte kommen aus options.txt
      if (value && !(config.fpsBoost && typeof config.fpsBoost === 'object')) config.fpsBoost = {};
      if (!value) config.fpsBoost = null;
    } else continue;
    changed++;
  }
  if (changed) await writeJson(file, config);
  return changed;
}

// ---------- Anzeige der Einstellungen ----------

/** Beschriftung bekannter Grafik-Werte als ganze Sätze mit Platzhalter {wert} (für Phase 2: Englisch) */
const GRAPHICS_LABELS: Record<string, string> = {
  renderDistance: 'Sichtweite: {wert} Chunks',
  simulationDistance: 'Simulationsdistanz: {wert} Chunks',
  maxFps: 'FPS-Grenze: {wert}',
  enableVsync: 'VSync: {wert}',
  guiScale: 'GUI-Größe: {wert}',
  fov: 'Sichtfeld: {wert}',
  gamma: 'Helligkeit: {wert}',
  graphicsMode: 'Grafik: {wert}',
  graphicsPreset: 'Grafik-Voreinstellung: {wert}',
  particles: 'Partikel: {wert}',
  entityShadows: 'Schatten unter Kreaturen: {wert}',
  renderClouds: 'Wolken: {wert}',
  biomeBlendRadius: 'Biom-Übergang: {wert}',
  mipmapLevels: 'Mipmap-Stufen: {wert}',
  improvedTransparency: 'Verbesserte Transparenz: {wert}',
  'heldix:fpsBoost': 'FPS-Boost: {wert}',
  'heldix:backgroundFps': 'Hintergrund-FPS begrenzen: {wert}',
  'heldix:backgroundFpsLimit': 'Hintergrund-FPS: höchstens {wert}',
  'heldix:shader': 'Heldix-Shader: {wert}',
};
const GENERIC_LABEL = '{schluessel}: {wert}';

function shownValue(key: string, value: SetupValue): string {
  if (typeof value === 'boolean') return value ? 'an' : 'aus';
  const text = typeof value === 'string' ? value.replace(/^"(.*)"$/, '$1') : value;
  if (key === 'fov' && typeof value === 'number') {
    const degrees = Math.round(70 + value * 40);
    return degrees >= 30 && degrees <= 110 ? String(degrees) : String(value);
  }
  if (key === 'maxFps' && typeof value === 'number' && value >= 260) return 'unbegrenzt';
  if (key === 'guiScale' && value === 0) return 'automatisch';
  if (key === 'graphicsMode' && typeof value === 'number') return ['schnell', 'schön', 'fabelhaft'][value] ?? String(value);
  if (key === 'particles' && typeof value === 'number') return ['alle', 'weniger', 'minimal'][value] ?? String(value);
  if (key === 'renderClouds') return ({ true: 'schön', fast: 'schnell', false: 'aus' } as Record<string, string>)[String(text)] ?? String(text);
  return String(text);
}

/** Lesbare Zeilen für die Vorschau (bekannte zuerst, in der Reihenfolge der Liste) */
export function graphicsSummary(graphics: Record<string, SetupValue> | null): string[] {
  if (!graphics) return [];
  const order = [...GRAPHICS_KEYS, ...HELDIX_PROFILE_KEYS];
  const { options, heldix } = acceptedGraphics(graphics);
  const keys = [...Object.keys(options), ...Object.keys(heldix)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return keys.map((key) => (GRAPHICS_LABELS[key] ?? GENERIC_LABEL).replace('{schluessel}', key).replace('{wert}', shownValue(key, graphics[key])));
}
