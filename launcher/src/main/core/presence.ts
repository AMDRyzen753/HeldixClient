// Was im Discord-Status steht – abhängig von Launcher und Spiel (siehe docs/entwicklung.md, „Discord-Status“).
//
// Die HeldixClient-Mod schreibt „HELDIX-STATUS {…}“ ins Spiel-Log (mod: status/StatusReporter.java): Modus und Server,
// ab 0.13.8 auch geteilte Welt, Dimension, Spielmodus, Spielerzahl, Voice, AFK und die Heldix-Party (party: { size, max,
// leader } – leader = bin ich Leiter; in einer Party zeigt Discord „(2 von 8)“ der Party statt der Spielerzahl des Servers,
// dazu „In einer Party“ bzw. „Leitet eine Party“; nie Party-ID oder Namen). Ältere Mods schicken nur Modus und
// Server, ältere Launcher ignorieren Unbekanntes. Daraus baut buildActivity den Status – rein, ohne Netz, damit alles
// testbar ist (npm run test:presence). Datenschutz: Server nur als öffentliche Domain (nie IPs, localhost, Heimnetz-
// Namen), geteilte Welten nie mit ihrer Adresse, Weltnamen im Einzelspieler nur, wenn eingeschaltet.

import { randomBytes } from 'node:crypto';
import type { DiscordPresenceOptions, DiscordPreview, InstanceLoader, LauncherView } from '../../shared/api';
import type { DiscordActivity } from './discord';
import { normalizeWorldAddress, worldCodeOf } from './worlds';

export type Dimension = 'overworld' | 'nether' | 'end' | 'other';
export type GameMode = 'survival' | 'creative' | 'adventure' | 'spectator';

/** Geteilte Welt in der Statuszeile: Gastgeber (Modus singleplayer) oder Mitspieler (Modus multiplayer) */
export interface SharedWorldStatus {
  /** <code>.welt.<Domain> */
  address: string;
  host: boolean;
  players?: number;
  max?: number;
}

/** Spielzustand, den die HeldixClient-Mod als "HELDIX-STATUS {…}" ins Log schreibt. */
export interface GameStatus {
  mode: 'menu' | 'singleplayer' | 'multiplayer' | 'realms' | 'lan';
  /** Serveradresse, nur bei mode = multiplayer */
  server?: string;
  dimension?: Dimension;
  gameMode?: GameMode;
  /** Spieler auf dem Server (Tab-Liste) bzw. in der Welt */
  players?: number;
  maxPlayers?: number;
  world?: SharedWorldStatus;
  /** im Voice Chat: in einer Gruppe? andere Teilnehmer (ohne einen selbst) */
  voice?: { inGroup: boolean; others: number };
  /** keine Eingabe seit mindestens 5 Minuten */
  afk?: boolean;
  /** Name der Einzelspielerwelt (nur, wenn die Mod ihn meldet; gezeigt nur mit Einstellung „Weltname“) */
  worldName?: string;
  /** Heldix-Party (ab 0.13.8): Größe, höchstens, bin ich Leiter? (leader ist ein Wahrheitswert, kein Name) */
  party?: { size: number; max: number; leader: boolean };
}

/** Öffentliche Infos zur geteilten Welt (GET /v1/public/worlds/<code>, siehe core/worlds.ts) */
export interface PresenceWorld {
  code: string;
  hostName: string;
  online: boolean;
  players: number;
  maxPlayers: number;
  access: 'open' | 'closed';
}

export interface PresenceInput {
  phase: 'launcher' | 'preparing' | 'running';
  /** Seite im Launcher (Phase launcher); null/fehlend = Fenster verborgen */
  view?: LauncherView | null;
  minecraft?: string;
  loader?: InstanceLoader;
  /** HeldixClient läuft in der Instanz (bei Fabric abschaltbar) */
  heldixClient?: boolean;
  /** Startzeit des Spiels in ms */
  startedAt?: number;
  /** Betreten des aktuellen Ziels (Server, Welt, Hauptmenü) in ms – „seit“ im Status (PresenceTracker) */
  since?: number;
  status?: GameStatus | null;
  /** Einstellung „Server anzeigen“ (ältere Aufrufe; options.showServer hat Vorrang) */
  showServer: boolean;
  /** Schalter aus den Einstellungen (fehlende = Standard) */
  options?: Partial<DiscordPresenceOptions>;
  clientVersion: string;
  /** Knöpfe unter dem Status (siehe presenceButtons) */
  buttons?: DiscordButton[];
  /** https-Adresse der Webseite für die Bilder (…/discord/<name>.png); null = Asset-Schlüssel discord-logo */
  imageBase?: string | null;
  /** eigener Spieler für das kleine Bild (Kopf vom Heldix-Dienst, null = Loader-Symbol) */
  player?: { name: string; head: string | null; cape?: string | null } | null;
  /** öffentliche Infos der geteilten Welt (Name des Gastgebers, Zugang) */
  world?: PresenceWorld | null;
  /** zufällige Party-ID je Ziel (PresenceTracker) */
  partyId?: string;
}

export interface DiscordButton {
  label: string;
  url: string;
}

/** Links für die Knöpfe (Links zur Webseite, siehe core/invites.ts und core/worlds.ts) */
export interface PresenceLinks {
  /** allgemeine Einladung („HeldixClient holen“) */
  general: string | null;
  /** Einladung mit dem aktuellen Server („Mitspielen“) */
  server: string | null;
  /** Seite der geteilten Welt …/welt#<code> („Mitspielen“) */
  world?: string | null;
}

export const JOIN_BUTTON = 'Mitspielen';
export const GET_BUTTON = 'HeldixClient holen';
/** Grenzen von Discord: höchstens 2 Knöpfe, Beschriftung bis 32 Zeichen, Link bis 512 Zeichen (nur http/https) */
const MAX_BUTTONS = 2;
const MAX_LABEL = 32;
const MAX_URL = 512;
/** Texte (details, state, Hover) 2–128 Zeichen */
export const MAX_TEXT = 128;
/** Asset-Schlüssel im Discord-Entwicklerportal, wenn es keine https-Webseite für die Bilder gibt */
export const FALLBACK_IMAGE = 'discord-logo';

export const DEFAULT_PRESENCE_OPTIONS: DiscordPresenceOptions = {
  showServer: true,
  showDetails: true,
  showWorldName: false,
  showParty: true,
  showVoice: true,
  showHead: true,
  buttons: true,
  minimal: false,
};

/** Bilder je Lage, als PNG unter <Webseite>/discord/<name>.png (erzeugt von scripts/render-discord-art.mjs) */
export const PRESENCE_IMAGES = {
  launcher: 'launcher',
  menu: 'hauptmenue',
  overworld: 'oberwelt',
  nether: 'nether',
  end: 'end',
  server: 'server',
  world: 'geteilte-welt',
  game: 'spiel',
  loaderHeldix: 'loader-heldix',
  loaderFabric: 'loader-fabric',
  loaderVanilla: 'loader-vanilla',
} as const;
export type PresenceImage = (typeof PRESENCE_IMAGES)[keyof typeof PRESENCE_IMAGES];

// ---------- Statuszeile ----------

const STATUS_LINE = /HELDIX-STATUS (\{.*\})\s*$/;
const MODES: GameStatus['mode'][] = ['menu', 'singleplayer', 'multiplayer', 'realms', 'lan'];
const GAME_MODES: GameMode[] = ['survival', 'creative', 'adventure', 'spectator'];
const DIMENSION_IDS: Record<string, Dimension> = {
  overworld: 'overworld',
  nether: 'nether',
  end: 'end',
  other: 'other',
  'minecraft:overworld': 'overworld',
  'minecraft:the_nether': 'nether',
  'minecraft:the_end': 'end',
};

function int(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

/** Text ohne Steuerzeichen und Minecraft-Farbcodes, Leerraum zusammengefasst */
function cleanText(raw: string): string {
  return raw.replace(/§./g, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Liest eine Statuszeile aus dem Spiel-Log, sonst null. Unbekannte oder ungültige Felder fallen still weg. */
export function parseStatusLine(text: string): GameStatus | null {
  const match = STATUS_LINE.exec(text);
  if (!match) return null;
  let value: Record<string, unknown>;
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    value = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof value.mode !== 'string' || !MODES.includes(value.mode as GameStatus['mode'])) return null;
  const status: GameStatus = { mode: value.mode as GameStatus['mode'] };
  if (typeof value.server === 'string' && value.server.length <= 255) status.server = value.server;
  if (typeof value.dimension === 'string') status.dimension = DIMENSION_IDS[value.dimension.toLowerCase()] ?? 'other';
  if (typeof value.gameMode === 'string' && GAME_MODES.includes(value.gameMode.toLowerCase() as GameMode)) status.gameMode = value.gameMode.toLowerCase() as GameMode;
  const players = int(value.players, 0, 1_000_000);
  const maxPlayers = int(value.maxPlayers, 1, 1_000_000);
  if (players !== undefined) status.players = players;
  if (maxPlayers !== undefined) status.maxPlayers = maxPlayers;
  const world = value.world && typeof value.world === 'object' ? (value.world as Record<string, unknown>) : null;
  const address = world ? normalizeWorldAddress(world.address) : null;
  if (world && address) {
    status.world = { address, host: world.host === true };
    const worldPlayers = int(world.players, 0, 1000);
    const worldMax = int(world.max, 1, 1000);
    if (worldPlayers !== undefined) status.world.players = worldPlayers;
    if (worldMax !== undefined) status.world.max = worldMax;
  }
  const voice = value.voice && typeof value.voice === 'object' ? (value.voice as Record<string, unknown>) : null;
  if (voice) status.voice = { inGroup: voice.inGroup === true, others: int(voice.others, 0, 10_000) ?? 0 };
  if (value.afk === true) status.afk = true;
  // Heldix-Party: { size, max, leader } – leader = bin ich Leiter (Wahrheitswert); Unsinn fällt weg
  const party = value.party && typeof value.party === 'object' && !Array.isArray(value.party) ? (value.party as Record<string, unknown>) : null;
  if (party) {
    const size = int(party.size, 1, 64);
    const max = int(party.max, 1, 64);
    if (size !== undefined && max !== undefined && size <= max) status.party = { size, max, leader: party.leader === true };
  }
  if (typeof value.worldName === 'string') {
    const name = [...cleanText(value.worldName)].slice(0, 40).join('');
    if (name) status.worldName = name;
  }
  return status;
}

/** Adresse der geteilten Welt, in der der Spieler gerade ist (als Gastgeber oder Mitspieler), sonst null */
export function sharedWorldAddress(status: GameStatus | null | undefined): string | null {
  if (!status) return null;
  if (status.world) return status.world.address;
  // ältere Mods ohne Feld world: Mitspieler auf einer Welt-Adresse erkennt der Launcher selbst
  if (status.mode === 'multiplayer') return normalizeWorldAddress(status.server);
  return null;
}

// ---------- Datenschutz ----------

/**
 * Servername für Discord: nur echte Domains (z. B. "hypixel.net"). IP-Adressen, localhost und
 * Heimnetz-Namen werden nicht gezeigt, damit keine privaten Adressen öffentlich sichtbar werden.
 * Adressen geteilter Welten (<code>.welt.<Domain>) auch nicht – die stehen nur als „In der Welt von …“ da.
 */
export function publicServerName(address: string | undefined): string | null {
  if (!address) return null;
  if (worldCodeOf(address)) return null;
  let host = address.trim().toLowerCase();
  if (host.startsWith('[')) return null; // IPv6 mit Port
  host = host.replace(/:\d+$/, '').replace(/\.$/, '');
  if (!host || host.includes(':')) return null; // IPv6
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null; // IPv4
  if (host === 'localhost' || !host.includes('.')) return null;
  if (/\.(local|lan|home|internal|localdomain|intranet|corp|private|home\.arpa)$/.test(host)) return null;
  if (/(^|\.)(localhost|fritz\.box|speedport\.ip)$/.test(host)) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  return host.length > 60 ? `${host.slice(0, 57)}…` : host;
}

// ---------- Texte ----------

/**
 * Text für Discord: ohne Steuerzeichen, 2–max Zeichen (UTF-16, wie Discord zählt), zu lang = mit „…“ gekürzt.
 * Zu kurz oder leer: undefined (Feld fällt weg).
 */
export function clampText(raw: string | null | undefined, max = MAX_TEXT): string | undefined {
  if (!raw) return undefined;
  const text = cleanText(raw);
  if (text.length < 2) return undefined;
  if (text.length <= max) return text;
  let out = '';
  for (const char of text) {
    if (out.length + char.length > max - 1) break;
    out += char;
  }
  return `${out.trimEnd()}…`;
}

const LOADER_TEXT: Record<InstanceLoader, string> = { heldix: 'HeldixClient', fabric: 'Fabric', vanilla: 'Vanilla' };
const VIEW_TEXT: Record<LauncherView, string> = {
  home: 'Sucht sich eine Instanz aus',
  instances: 'Verwaltet seine Instanzen',
  store: 'Stöbert im Addon-Store',
  friends: 'Schaut bei seinen Freunden vorbei',
  profile: 'Richtet Cosmetics ein',
  settings: 'Stellt den Launcher ein',
  console: 'Schaut in die Konsole',
  setup: 'Richtet HeldixClient ein',
};
const DIMENSION_TEXT: Record<Dimension, string> = {
  overworld: 'In der Oberwelt',
  nether: 'Im Nether',
  end: 'Im End',
  other: 'In einer anderen Dimension',
};
const GAME_MODE_TEXT: Record<GameMode, string> = { survival: 'Überleben', creative: 'Kreativ', adventure: 'Abenteuer', spectator: 'Zuschauer' };

function loaderText(input: Pick<PresenceInput, 'loader' | 'heldixClient'>): string {
  if (!input.loader) return 'HeldixClient';
  if (input.loader === 'fabric' && input.heldixClient) return 'Fabric + HeldixClient';
  return LOADER_TEXT[input.loader];
}

/** „Im Voice mit 3 anderen“ bzw. in einer Gruppe „In der Voice-Gruppe …“ */
export function voiceText(voice: { inGroup: boolean; others: number }): string {
  const where = voice.inGroup ? 'In der Voice-Gruppe' : 'Im Voice';
  if (voice.others <= 0) return where;
  if (voice.others === 1) return `${where} zu zweit`;
  return `${where} mit ${voice.others.toLocaleString('de-DE')} anderen`;
}

/** Einstellungen mit Standardwerten (showServer aus dem älteren Feld) */
export function presenceOptions(input: Pick<PresenceInput, 'showServer' | 'options'>): DiscordPresenceOptions {
  const options = { ...DEFAULT_PRESENCE_OPTIONS, showServer: input.showServer };
  for (const [key, value] of Object.entries(input.options ?? {})) {
    if (typeof value === 'boolean' && key in options) (options as Record<string, boolean>)[key] = value;
  }
  return options;
}

/** Bild-Link …/discord/<name>.png (nur https), sonst null */
export function presenceImageUrl(base: string | null | undefined, name: PresenceImage): string | null {
  if (!base) return null;
  const clean = base.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+[^\s]*$/i.test(clean)) return null;
  const url = `${clean}/discord/${name}.png`;
  return url.length <= 256 ? url : null;
}

function buttonUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.length <= MAX_URL && /^https:\/\/[^\s]+$/i.test(url);
}

// ---------- Knöpfe ----------

/**
 * Server für „Mitspielen“: nur im laufenden Spiel im Mehrspieler und nur, wenn der Status den Server ohnehin zeigt
 * (Einstellung „Server anzeigen“ und öffentliche Domain laut publicServerName). Geteilte Welten nie. Sonst null.
 */
export function presenceJoinServer(input: Pick<PresenceInput, 'phase' | 'status' | 'showServer' | 'options'>): string | null {
  if (input.phase !== 'running' || input.status?.mode !== 'multiplayer' || !presenceOptions(input).showServer) return null;
  if (sharedWorldAddress(input.status)) return null;
  const address = input.status.server?.trim();
  return address && publicServerName(address) ? address : null;
}

/**
 * Geteilte Welt für „Mitspielen“ (Code): nur im laufenden Spiel in einer Welt, die gerade offen ist und laut Dienst
 * jeder mit der Adresse betreten darf (Zugang „offen“) – sonst würden Fremde aus Discord beim Gastgeber anklopfen.
 */
export function presenceJoinWorld(input: Pick<PresenceInput, 'phase' | 'status' | 'world' | 'showServer' | 'options'>): string | null {
  if (input.phase !== 'running' || !presenceOptions(input).showServer) return null;
  const code = worldCodeOf(sharedWorldAddress(input.status));
  const world = input.world;
  if (!code || !world || world.code !== code || !world.online || world.access !== 'open') return null;
  return code;
}

/** Knöpfe: „Mitspielen“ (geteilte Welt bzw. Einladung mit Server) und „HeldixClient holen“ (allgemeine Einladung) */
export function presenceButtons(input: Pick<PresenceInput, 'phase' | 'status' | 'showServer' | 'options' | 'world'>, links: PresenceLinks): DiscordButton[] {
  const options = presenceOptions(input);
  if (!options.buttons || options.minimal) return [];
  const buttons: DiscordButton[] = [];
  if (presenceJoinWorld(input) && buttonUrl(links.world)) buttons.push({ label: JOIN_BUTTON, url: links.world });
  else if (presenceJoinServer(input) && buttonUrl(links.server)) buttons.push({ label: JOIN_BUTTON, url: links.server });
  if (buttonUrl(links.general) && !buttons.some((b) => b.url === links.general)) buttons.push({ label: GET_BUTTON, url: links.general });
  return buttons.filter((b) => b.label.length <= MAX_LABEL).slice(0, MAX_BUTTONS);
}

// ---------- Status bauen ----------

/** Teile des Status: Dimension, Spielmodus, Voice, Party (je nach Schalter) */
function stateParts(status: GameStatus, options: DiscordPresenceOptions): string[] {
  const parts: string[] = [];
  if (options.showDetails && status.dimension) parts.push(DIMENSION_TEXT[status.dimension]);
  if (options.showDetails && status.gameMode) parts.push(GAME_MODE_TEXT[status.gameMode]);
  if (options.showVoice && status.voice) parts.push(voiceText(status.voice));
  const party = partyText(status, options);
  if (party) parts.push(party);
  return parts;
}

/** „In einer Party“ bzw. „Leitet eine Party“ (nur mit Schalter Spielerzahl und mindestens 2 in der Party) */
function partyText(status: GameStatus, options: DiscordPresenceOptions): string | null {
  if (!options.showParty || !status.party || status.party.size < 2) return null;
  return status.party.leader ? 'Leitet eine Party' : 'In einer Party';
}

/** Heldix-Party vor der Spielerzahl des Servers bzw. der Welt: „(2 von 8)“ (allein in der Party: nichts) */
function heldixParty(status: GameStatus, options: DiscordPresenceOptions): [number, number] | null {
  if (!options.showParty || !status.party || status.party.size < 2) return null;
  return partySize(status.party.size, status.party.max);
}

/** Spielerzahl für die Party-Anzeige („(3 von 8)“), sonst null */
function partySize(players: number | undefined, max: number | undefined): [number, number] | null {
  if (players === undefined || max === undefined) return null;
  if (!Number.isInteger(players) || !Number.isInteger(max) || players < 1 || max < 1 || players > max) return null;
  return [players, max];
}

function dimensionImage(status: GameStatus, options: DiscordPresenceOptions): PresenceImage {
  if (!options.showDetails || !status.dimension) return PRESENCE_IMAGES.game;
  return status.dimension === 'overworld' ? PRESENCE_IMAGES.overworld
    : status.dimension === 'nether' ? PRESENCE_IMAGES.nether
      : status.dimension === 'end' ? PRESENCE_IMAGES.end : PRESENCE_IMAGES.game;
}

function loaderImage(input: Pick<PresenceInput, 'loader' | 'heldixClient'>): PresenceImage {
  if (input.loader === 'vanilla') return PRESENCE_IMAGES.loaderVanilla;
  if (input.loader === 'fabric' && !input.heldixClient) return PRESENCE_IMAGES.loaderFabric;
  return PRESENCE_IMAGES.loaderHeldix;
}

interface Built {
  details?: string;
  state?: string;
  image: PresenceImage;
  party?: [number, number] | null;
  timestamps?: { start: number };
}

function describeRunning(input: PresenceInput, options: DiscordPresenceOptions): Built {
  const status = input.status;
  const minecraft = input.minecraft ? `Minecraft ${input.minecraft}` : 'Minecraft';
  const start = input.since ?? input.startedAt;
  const timestamps = start ? { start } : undefined;
  if (!status) return { details: `Spielt ${minecraft}`, state: `Mit ${loaderText(input)}`, image: PRESENCE_IMAGES.game, timestamps };

  const parts = stateParts(status, options);
  const state = status.afk ? 'Abwesend' : parts.length ? parts.join(' · ') : undefined;
  // in einer Heldix-Party zählt die Party („(2 von 8)“), sonst die Spieler auf dem Server bzw. in der Welt
  const inParty = heldixParty(status, options);
  const worldAddress = sharedWorldAddress(status);
  if (worldAddress && (status.mode === 'singleplayer' || status.mode === 'multiplayer')) {
    const host = status.mode === 'singleplayer' || status.world?.host === true;
    const world = input.world && input.world.code === worldCodeOf(worldAddress) ? input.world : null;
    const details = host ? 'Teilt seine Welt'
      : options.showServer && world?.hostName ? `In der Welt von ${world.hostName}` : 'In einer geteilten Welt';
    const party = inParty ?? (options.showParty
      ? host ? partySize(status.world?.players, status.world?.max)
        : partySize(status.players ?? world?.players, status.maxPlayers ?? world?.maxPlayers)
      : null);
    return { details, state: state ?? minecraft, image: PRESENCE_IMAGES.world, party, timestamps };
  }
  const players = () => inParty ?? (options.showParty ? partySize(status.players, status.maxPlayers) : null);
  switch (status.mode) {
    case 'menu': {
      const menuParts = [options.showVoice && status.voice ? voiceText(status.voice) : null, partyText(status, options)].filter((p): p is string => !!p);
      return {
        details: 'Im Hauptmenü',
        state: status.afk ? 'Abwesend' : menuParts.length ? menuParts.join(' · ') : `${minecraft} · ${loaderText(input)}`,
        image: PRESENCE_IMAGES.menu,
        party: inParty,
        timestamps,
      };
    }
    case 'singleplayer': {
      const name = options.showWorldName && status.worldName ? status.worldName : null;
      return { details: name ? `Spielt in „${name}“` : 'Spielt Einzelspieler', state: state ?? minecraft, image: dimensionImage(status, options), party: inParty, timestamps };
    }
    case 'multiplayer': {
      const server = options.showServer ? publicServerName(status.server) : null;
      return {
        details: server ? `Spielt auf ${server}` : 'Spielt Mehrspieler',
        state: state ?? minecraft,
        image: PRESENCE_IMAGES.server,
        party: players(),
        timestamps,
      };
    }
    case 'realms':
      return { details: 'Spielt auf Realms', state: state ?? minecraft, image: PRESENCE_IMAGES.server, party: players(), timestamps };
    case 'lan':
      return { details: 'Spielt im LAN', state: state ?? minecraft, image: PRESENCE_IMAGES.world, party: players(), timestamps };
    default:
      return { details: `Spielt ${minecraft}`, state: state ?? `Mit ${loaderText(input)}`, image: PRESENCE_IMAGES.game, party: inParty, timestamps };
  }
}

export function buildActivity(input: PresenceInput): DiscordActivity {
  const options = presenceOptions(input);
  const image = (name: PresenceImage) => presenceImageUrl(input.imageBase, name);
  const version = `HeldixClient ${input.clientVersion}`;
  const largeText = clampText(input.minecraft && input.phase !== 'launcher' ? `Minecraft ${input.minecraft} · ${version}` : version);

  // Nur „Spielt HeldixClient“: Name der Discord-App, Logo und die Zeit seit Spielstart – sonst nichts
  if (options.minimal) {
    const activity: DiscordActivity = { assets: { large_image: image(PRESENCE_IMAGES.launcher) ?? FALLBACK_IMAGE, large_text: 'HeldixClient' } };
    if (input.phase === 'running' && input.startedAt) activity.timestamps = { start: input.startedAt };
    return activity;
  }

  let built: Built;
  if (input.phase === 'launcher' || !input.minecraft || !input.loader) {
    built = { details: 'Im Launcher', state: VIEW_TEXT[input.view ?? 'home'] ?? VIEW_TEXT.home, image: PRESENCE_IMAGES.launcher };
  } else if (input.phase === 'preparing') {
    built = { details: `Startet Minecraft ${input.minecraft} …`, state: `Mit ${loaderText(input)}`, image: PRESENCE_IMAGES.launcher };
  } else {
    built = describeRunning(input, options);
  }

  const assets: NonNullable<DiscordActivity['assets']> = { large_image: image(built.image) ?? FALLBACK_IMAGE, large_text: largeText };
  // kleines Bild: eigener Kopf (Hover: Name und Cape) oder im Spiel das Loader-Symbol
  if (options.showHead && input.player?.head && buttonUrl(input.player.head)) {
    assets.small_image = input.player.head;
    assets.small_text = clampText(input.player.cape ? `${input.player.name} · Cape: ${input.player.cape}` : input.player.name);
  } else if (input.phase !== 'launcher') {
    const loader = image(loaderImage(input));
    if (loader) {
      assets.small_image = loader;
      assets.small_text = clampText(input.loader === 'heldix' ? 'Heldix Loader' : loaderText(input));
    }
  }
  if (!assets.small_text) delete assets.small_text;
  if (!assets.small_image) delete assets.small_image;
  if (!assets.large_text) delete assets.large_text;

  const activity: DiscordActivity = {};
  const details = clampText(built.details);
  const state = clampText(built.state);
  if (details) activity.details = details;
  if (state) activity.state = state;
  if (built.timestamps) activity.timestamps = built.timestamps;
  activity.assets = assets;
  if (built.party) activity.party = { id: input.partyId && input.partyId.length >= 2 ? input.partyId.slice(0, 128) : 'heldix-party', size: built.party };
  const buttons = (input.buttons ?? []).filter((b) => b.label.length <= MAX_LABEL && buttonUrl(b.url)).slice(0, MAX_BUTTONS);
  if (buttons.length) activity.buttons = buttons;
  return activity;
}

/** Name des Bildes aus einem Link …/discord/<name>.png, „head“ für den Kopf vom Dienst, sonst null (Logo) */
function previewImage(url: string | undefined): string | null {
  if (!url || url === FALLBACK_IMAGE) return null;
  if (/\/v1\/public\/heads\/[0-9a-f]{32}\.png/.test(url)) return 'head';
  return /\/discord\/([a-z0-9-]{1,40})\.png$/.exec(url)?.[1] ?? null;
}

/** Vorschau für die Einstellungen: genau der gebaute Status, Bilder als Namen (die Oberfläche hat sie selbst) */
export function previewOf(activity: DiscordActivity, enabled: boolean, player: { uuid: string; name: string } | null): DiscordPreview {
  return {
    enabled,
    details: activity.details ?? null,
    state: activity.state ?? null,
    largeImage: previewImage(activity.assets?.large_image),
    largeText: activity.assets?.large_text ?? null,
    smallImage: previewImage(activity.assets?.small_image),
    smallText: activity.assets?.small_text ?? null,
    since: activity.timestamps?.start ?? null,
    party: activity.party?.size ?? null,
    buttons: (activity.buttons ?? []).map((b) => b.label),
    player,
  };
}

// ---------- Ziel, Zeit und Party ----------

/** Wohin der Spieler gerade gehört: wechselt das, beginnt die Zeit „seit“ neu und es gibt eine neue Party-ID */
export function presenceTargetKey(phase: PresenceInput['phase'], status: GameStatus | null | undefined): string {
  if (phase !== 'running') return phase;
  if (!status) return 'running';
  const world = sharedWorldAddress(status);
  if (world && (status.mode === 'singleplayer' || status.mode === 'multiplayer')) return `world:${world}`;
  if (status.mode === 'multiplayer') return `server:${(status.server ?? '').trim().toLowerCase().replace(/:25565$/, '')}`;
  return status.mode;
}

export class PresenceTracker {
  private key: string | null = null;
  private since = 0;
  private party = '';

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly random: () => string = () => randomBytes(12).toString('hex'),
  ) {}

  /** Zeit seit Betreten des aktuellen Ziels und zufällige Party-ID (bleiben gleich, solange das Ziel gleich bleibt) */
  next(phase: PresenceInput['phase'], status: GameStatus | null | undefined): { since: number; partyId: string } {
    const key = presenceTargetKey(phase, status);
    if (key !== this.key) {
      this.key = key;
      this.since = this.now();
      this.party = this.random();
    }
    return { since: this.since, partyId: this.party };
  }
}
