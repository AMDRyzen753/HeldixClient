// Dauerhafte Welten (Heldix-Dienst 1.13.0): Eine geteilte Welt läuft als echter Minecraft-Server (Paper, sonst Vanilla)
// auf dem Heldix-Server, auch wenn ihr Besitzer offline ist. Dieser Teil des Dienstes entscheidet, wer das darf (Team oder
// Freischaltung, je Spieler 1 Welt, Team 2), wie viele gleichzeitig laufen, und führt den Lebenszyklus:
//
//   creating → sleeping ⇄ starting → running → stopping → sleeping   (dazu error mit Meldung; „deleted“ nur als Nachricht)
//
// Leere Welten schlafen nach einer einstellbaren Zeit ohne Spieler ein und wachen beim Beitreten auf (world-relay.ts).
// Betrieben werden die Server über einen HostingRunner (runner.ts): in Produktion der Welten-Wächter mit Docker
// (agent-runner.ts), in der Entwicklung der ProcessRunner. Spielerzahl und Rollen kommen aus den Log-Zeilen
// „<Name> joined/left the game“ (und einem Status-Ping auf den Port). In kein Log des Dienstes kommen Spieler-IPs (der
// Server sieht nur das Relay auf 127.0.0.1), Inhalte von Konsole und Chat oder Befehle.
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Store, UserRow, WorldRow } from '../db';
import { HttpError } from '../http';
import { RateLimiter } from '../limits';
import type { ClientHandle, Realtime } from '../realtime';
import { playerLabel, writeAudit, type Actor } from '../team';
import { checkText, isName } from '../validate';
import type { HostedRelayInfo, Worlds, WorldsHosting } from '../worlds';
import type { HostingGrants } from './grants';
import { worldIcon } from './icon';
import type { Modrinth } from './modrinth';
import { PLUGIN_FILE_RE, PROJECT_RE } from './modrinth';
import { isPluginTextPath, PLUGIN_TEXT_MAX_BYTES } from './paths';
import { ALLOWED_PROPERTIES, HOSTED_WORLD_ID_RE, type BackupInfo, type HostingRunner, type RunnerStats } from './runner';
import { inspectWorldZip, WORLD_ZIP_LIMITS, ZipRejected } from './safe-zip';
import { VERSION_RE, type ServerJars } from './server-jars';
import { statusPing } from './status-ping';
import type { HostedPluginRow, HostedRow, HostedState, HostedWithOwner, HostingStore } from './store';
import type { Uploads, UploadView } from './uploads';

// ---------- Texte ----------

export const HOSTING_OFF = 'Dauerhafte Welten sind auf diesem Heldix-Dienst nicht eingerichtet.';
export const TEXT_BETA = 'Dauerhafte Welten sind gerade in der Beta – bald mit Heldix+.';
export const HOSTED_GONE = 'Diese dauerhafte Welt gibt es nicht (mehr).';
export const OWNER_ONLY = 'Das darf nur der Besitzer der Welt.';
/** Texte für Spieler beim Beitreten (Disconnect) */
export const TEXT_STARTING = 'Die Welt startet gerade – in etwa 30 Sekunden noch einmal beitreten.';
export const TEXT_SLOTS_FULL = 'Gerade sind alle Plätze belegt – versuch es in ein paar Minuten noch einmal.';
export const TEXT_CREATING = 'Die Welt wird gerade eingerichtet. Versuch es später noch einmal.';
export const TEXT_ERROR = 'Die Welt hat gerade ein Problem. Der Besitzer kann sie auf der Webseite neu starten.';
export const TEXT_PAUSED = 'Diese dauerhafte Welt ist gerade pausiert.';
export const PLUGIN_NOTICE = 'Plugins aus dem Katalog können eigene Daten speichern und ins Internet verbinden.';
export const EULA_URL = 'https://www.minecraft.net/eula';

// ---------- Grenzen ----------

export const HOSTED_MAX_PLAYERS = 20;
export const SLEEP_MIN = 5;
export const SLEEP_MAX = 60;
export const COMMAND_MAX = 256;
export const FILE_MAX_BYTES = PLUGIN_TEXT_MAX_BYTES;
export const CONSOLE_LINES = 500;
/** Sicherungen von Hand: höchstens so viele (dann erst eine löschen). */
export const MANUAL_BACKUPS = 5;
/** Anklopfen wie bei Welt teilen: derselbe Name höchstens alle 30 s, je Welt höchstens 10 pro Minute; Ablehnen 10 Minuten. */
const KNOCK_REPEAT_MS = 30_000;
const KNOCKS_PER_MINUTE = 10;
const DENY_MS = 10 * 60_000;
const MAX_KNOCKS = 200;
const MAX_APPLIED_ROLES = 1000;
const MIB = 1024 * 1024;
/** Mehr Log-Zeilen je Sekunde und Welt gehen nicht live hinaus (die Konsole zeigt trotzdem alles). */
const LOG_LINES_PER_SECOND = 200;

/** Name einer Sicherung: Art und Zeitpunkt (UTC), z. B. „2026-11-28_03-00-00“ oder „vor-plugin-2026-11-28_03-00-00“. */
export const BACKUP_NAME_RE = /^(?:(?:hand|vor-plugin|vor-version|vor-import|vor-wiederherstellen)-)?\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;
export type BackupKind = 'daily' | 'manual' | 'before-plugin' | 'before-version' | 'before-import' | 'before-restore';
const BACKUP_PREFIX: Record<BackupKind, string> = {
  daily: '',
  manual: 'hand-',
  'before-plugin': 'vor-plugin-',
  'before-version': 'vor-version-',
  'before-import': 'vor-import-',
  'before-restore': 'vor-wiederherstellen-',
};

export function backupKind(name: string): BackupKind {
  for (const [kind, prefix] of Object.entries(BACKUP_PREFIX) as [BackupKind, string][]) if (prefix !== '' && name.startsWith(prefix)) return kind;
  return 'daily';
}

/** Log-Zeilen „<Name> joined the game“ und „<Name> left the game“ (Paper und Vanilla, ohne Chat-Zeilen). */
const JOIN_RE = /^(?:\[[^\]]*\]\s*)+:\s([A-Za-z0-9_]{1,16}) joined the game$/;
const LEFT_RE = /^(?:\[[^\]]*\]\s*)+:\s([A-Za-z0-9_]{1,16}) left the game$/;
const DONE_RE = /\bDone \(\d+(?:[.,]\d+)?s\)!/;
const STOPPING_RE = /Stopping (?:the )?server/i;
const SAVED_RE = /Saved the game/i;
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** Auswahl aus server.properties: erlaubte Werte je Schlüssel (der Dienst prüft, bevor der Runner schreibt). */
type PropertyRule = { kind: 'enum'; values: readonly string[] } | { kind: 'bool' } | { kind: 'int'; min: number; max: number };
export const PROPERTY_RULES: Record<string, PropertyRule> = {
  difficulty: { kind: 'enum', values: ['peaceful', 'easy', 'normal', 'hard'] },
  gamemode: { kind: 'enum', values: ['survival', 'creative', 'adventure', 'spectator'] },
  pvp: { kind: 'bool' },
  'max-players': { kind: 'int', min: 1, max: HOSTED_MAX_PLAYERS },
  'view-distance': { kind: 'int', min: 4, max: 16 },
  'simulation-distance': { kind: 'int', min: 4, max: 16 },
  'spawn-protection': { kind: 'int', min: 0, max: 64 },
  'allow-flight': { kind: 'bool' },
  'generate-structures': { kind: 'bool' },
  hardcore: { kind: 'bool' },
  'force-gamemode': { kind: 'bool' },
  'spawn-monsters': { kind: 'bool' },
  'allow-nether': { kind: 'bool' },
};
/** Nur beim Anlegen (Neue Welt): Seed und Welttyp. */
const CREATE_ONLY = ['level-seed', 'level-type'];
const LEVEL_TYPES: Record<string, string> = { normal: 'minecraft:normal', flat: 'minecraft:flat' };

const DEFAULT_PROPERTIES: Record<string, string> = {
  difficulty: 'normal',
  gamemode: 'survival',
  pvp: 'true',
  'view-distance': '10',
  'simulation-distance': '10',
  'spawn-protection': '16',
  'allow-flight': 'false',
};

// ---------- Typen ----------

export interface HostingOptions {
  runner: HostingRunner;
  /** Upload-Ordner des Dienstes (`<Daten>/hosting-uploads`, liest auch der Welten-Wächter); Downloads in `downloads/` */
  dataDir: string;
  /** Host der Webseite für die Werbezeile (z. B. heldixclient.com) oder null */
  site: string | null;
  /** Gleichzeitig laufende Welten */
  maxRunning: number;
  memoryMb: number;
  diskMb: number;
  maxPlugins: number;
  worldsPerPlayer: number;
  worldsPerTeam: number;
  sleepDefaultMin: number;
  /** Länge einer „Minute“ fürs Schlafen (Tests stellen sie kürzer) */
  minuteMs: number;
  /** Abstand der Prüfungen (Absturz, Schlafen, Status-Ping, Sicherungen) */
  tickMs: number;
  readyPollMs: number;
  startTimeoutMs: number;
  stopTimeoutMs: number;
  pingIntervalMs: number;
  dailyBackupMs: number;
  keepDaily: number;
  keepAuto: number;
  /** Zeitraum zwischen zwei Prüfungen, ob tägliche Sicherungen fällig sind */
  backupCheckMs: number;
  /** Abstand des regelmäßigen Abgleichs mit dem Runner (Löschungen über heldix-dienst-admin) */
  reconcileMs: number;
  jars: ServerJars;
  modrinth: Modrinth;
  grants: HostingGrants;
  uploads: Uploads;
  log: (line: string) => void;
}

export type HostedRole = 'owner' | 'operator';

export interface HostedWorldView {
  id: string;
  code: string;
  address: string;
  name: string;
  state: HostedState;
  error: string | null;
  version: string;
  software: 'paper' | 'vanilla';
  paperBuild: number | null;
  players: number;
  maxPlayers: number;
  ram: { used: number; limit: number };
  disk: { used: number; limit: number };
  sleepAfterMin: number;
  createdAt: number;
  lastStartedAt: number | null;
  plugins: number;
  maxPlugins: number;
  role: HostedRole;
  owner: { uuid: string; name: string };
  access: string;
  /** Rolle für neue Spieler (wie bei der geteilten Welt) */
  defaultRole: string;
  awaitingUpload: boolean;
  restartNeeded: boolean;
  notice: string | null;
  upload: UploadView | null;
}

interface Live {
  world: string;
  owner: string;
  port: number | null;
  /** online laut Log: Name (klein) → Name */
  players: Map<string, string>;
  /** online laut letztem Status-Ping (null: keine Angabe seit dem letzten Join/Left) */
  pingPlayers: number | null;
  lastPing: number;
  idleSince: number;
  unfollow: (() => void) | null;
  readyTimer?: NodeJS.Timeout;
  startedAt: number;
  stopRequested: boolean;
  sawStopping: boolean;
  wakeAfterStop: boolean;
  crashes: number[];
  knocks: Map<string, number>;
  knockWindow: number;
  knockCount: number;
  denied: Map<string, number>;
  logQueue: string[];
  logTimer?: NodeJS.Timeout;
  logWindow: number;
  logCount: number;
  saveWaiters: (() => void)[];
  stats: RunnerStats | null;
  statsAt: number;
  diskUsedMb: number;
  backups: BackupInfo[];
}

function topicOf(world: string): string {
  return `hosting:${world}`;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function stamp(at: number): string {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}_${two(d.getUTCHours())}-${two(d.getUTCMinutes())}-${two(d.getUTCSeconds())}`;
}

/** Text für Minecraft-Farbcodes unschädlich machen (kein §, keine Zeilenumbrüche). */
function legacySafe(text: string): string {
  return text.replace(/[§\r\n]/g, '').trim();
}

/** Sicherer Pfad einer Plugin-Konfiguration relativ zum Datenordner der Welt (`plugins/…`). */
export function checkPluginPath(value: unknown): string {
  if (!isPluginTextPath(value)) throw new HttpError(400, 'Ungültiger Pfad (nur Textdateien unter plugins/: yml, yaml, json, properties, txt, toml).');
  return value;
}

/** Befehl für die Konsole prüfen: eine Zeile, höchstens 256 Zeichen, ohne führenden „/“. */
export function checkCommand(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, '„command“ muss ein Text sein.');
  const command = value.trim().replace(/^\/+/, '');
  if (command === '' || [...command].length > COMMAND_MAX || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(command)) {
    throw new HttpError(400, `Der Befehl muss eine Zeile mit 1 bis ${COMMAND_MAX} Zeichen sein.`);
  }
  return command;
}

/** Datei als Download senden und danach löschen (oder `keep`). */
export async function sendFileDownload(res: ServerResponse, file: string, downloadName: string, keep = false): Promise<void> {
  const { size } = await fs.stat(file);
  const safe = downloadName.replace(/[^A-Za-z0-9._ -]+/g, '_').slice(0, 80) || 'welt.zip';
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Length': String(size),
    'Content-Disposition': `attachment; filename="${safe}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  await new Promise<void>((resolve) => {
    const stream = createReadStream(file);
    stream.on('error', () => {
      res.destroy();
      resolve();
    });
    res.on('close', () => {
      stream.destroy();
      resolve();
    });
    stream.pipe(res);
  });
  if (!keep) await fs.rm(file, { force: true });
}

export class Hosting implements WorldsHosting {
  private readonly live = new Map<string, Live>();
  /** Welten, deren Server gerade läuft, startet oder anhält (zählen für die Plätze) */
  private readonly active = new Set<string>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly commandLimiter = new RateLimiter(30, 60_000);
  private tickTimer: NodeJS.Timeout | null = null;
  private ticking = false;
  private closed = false;
  private lastBackupCheck = 0;
  private lastReconcile = Date.now();
  /** Welten beim Runner ohne Zeile in der Datenbank, die schon gemeldet wurden */
  private readonly warnedUnknown = new Set<string>();
  private readonly runner: HostingRunner;

  constructor(
    private readonly store: Store,
    readonly hs: HostingStore,
    private readonly realtime: Realtime,
    private readonly worlds: Worlds,
    private readonly options: HostingOptions,
  ) {
    this.runner = options.runner;
    realtime.onClientMessage('hosting-subscribe', (client, msg) => this.subscribe(client, msg));
    realtime.onClientMessage('hosting-unsubscribe', (client, msg) => {
      if (typeof msg.world === 'string' && HOSTED_WORLD_ID_RE.test(msg.world)) client.unsubscribe(topicOf(msg.world));
    });
    options.grants.onRevoked = (uuid) => this.accessChanged(uuid);
  }

  // ---------- Start, Abgleich, Ende ----------

  /** Beim Start des Dienstes: Zustände mit dem Runner abgleichen, dann regelmäßig prüfen. */
  async init(): Promise<void> {
    try {
      await this.reconcile(true);
    } catch (err) {
      this.options.log(`Dauerhafte Welten: Abgleich beim Start fehlgeschlagen (${message(err)}).`);
    }
    if (this.closed) return;
    this.tickTimer = setInterval(() => void this.tick(), this.options.tickMs);
    this.tickTimer.unref();
  }

  /**
   * Abgleich mit dem Runner: Welten mit Grabstein (gelöscht, auch über Fremdschlüssel beim Löschen oder Sperren eines
   * Kontos und über heldix-dienst-admin) werden angehalten und beim Runner gelöscht. Was der Runner sonst noch kennt, die
   * Datenbank aber nicht, meldet der Dienst nur (z. B. falsche Datenbank) – gelöscht wird nichts Fremdes. Beim Start dazu:
   * laufende Server übernehmen, Zustände richten.
   */
  async reconcile(startup = false): Promise<void> {
    const known = this.hs.ids();
    let listed: string[] = [];
    try {
      listed = await this.runner.list();
    } catch (err) {
      this.options.log(`Dauerhafte Welten: Runner nicht erreichbar (${message(err)}).`);
      return;
    }
    const tombstones = this.hs.tombstones();
    for (const id of tombstones) {
      if (!known.has(id)) await this.purge(id);
      this.hs.clearTombstone(id);
    }
    for (const id of [...this.live.keys()]) if (!known.has(id)) await this.purge(id);
    const unknown = listed.filter((id) => HOSTED_WORLD_ID_RE.test(id) && !known.has(id) && !tombstones.has(id) && !this.warnedUnknown.has(id));
    if (unknown.length > 0) {
      for (const id of unknown) this.warnedUnknown.add(id);
      this.options.log(`WARNUNG: Dauerhafte Welten: Der Runner kennt ${unknown.length} Welt(en), die es in der Datenbank nicht gibt. Sie bleiben unangetastet.`);
    }
    if (!startup) return;
    const runnerKnows = new Set(listed);
    for (const row of this.hs.all()) {
      let state;
      try {
        state = runnerKnows.has(row.world) ? await this.runner.state(row.world) : 'missing';
      } catch {
        state = 'missing';
      }
      const live = this.liveOf(row.world, row.owner);
      if (state === 'running' || state === 'starting') {
        this.active.add(row.world);
        live.port = await this.runner.port(row.world).catch(() => null);
        live.idleSince = Date.now();
        this.follow(row.world);
        if (state === 'running') this.setState(row.world, 'running');
        else {
          this.setState(row.world, 'starting');
          this.waitReady(row.world);
        }
        continue;
      }
      if (row.state === 'starting' || row.state === 'running' || row.state === 'stopping') this.setState(row.world, 'sleeping');
      if (row.state === 'creating' && !row.prepared) {
        void this.withLock(row.world, () => this.prepareAndSettle(row.world)).catch(() => undefined);
      }
    }
  }

  /** Beim Herunterfahren: Zeitgeber aus, Logs abmelden; der ProcessRunner hält seine Prozesse an. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    for (const live of this.live.values()) {
      live.unfollow?.();
      live.unfollow = null;
      if (live.readyTimer) clearTimeout(live.readyTimer);
      if (live.logTimer) clearTimeout(live.logTimer);
    }
    const runner = this.runner as { shutdown?: () => Promise<void>; close?: () => void };
    if (typeof runner.shutdown === 'function') {
      try {
        await runner.shutdown();
      } catch (err) {
        this.options.log(`Dauerhafte Welten: Anhalten beim Beenden fehlgeschlagen (${message(err)}).`);
      }
    }
    // AgentRunner: Verbindung zum Wächter schließen (die Container laufen weiter, beim nächsten Start übernommen).
    if (typeof runner.close === 'function') {
      try {
        runner.close();
      } catch {
        // schon zu
      }
    }
  }

  /** Konto gelöscht oder gesperrt: Welten sind schon aus der Datenbank (Fremdschlüssel), Server und Daten folgen. */
  forgetUser(): void {
    void this.reconcile(false).catch((err) => this.options.log(`Dauerhafte Welten: Aufräumen fehlgeschlagen (${message(err)}).`));
  }

  /** Server anhalten und alle Daten einer Welt beim Runner löschen (Welt gibt es nicht mehr). */
  private async purge(id: string): Promise<void> {
    const live = this.live.get(id);
    await this.withLock(id, async () => {
      if (live) {
        live.stopRequested = true;
        this.detach(id);
      }
      try {
        await this.runner.remove(id);
      } catch (err) {
        this.options.log(`Dauerhafte Welten: Löschen beim Runner fehlgeschlagen (${message(err)}).`);
      }
      await this.options.uploads.cancel(id).catch(() => undefined);
    });
    this.active.delete(id);
    this.live.delete(id);
    if (live) this.sendTo([live.owner], { type: 'hosting-state', world: { id, state: 'deleted' } });
  }

  // ---------- Hilfen ----------

  private liveOf(id: string, owner?: string): Live {
    let live = this.live.get(id);
    if (!live) {
      const now = Date.now();
      live = {
        world: id,
        owner: owner ?? this.hs.get(id)?.owner ?? '',
        port: null,
        players: new Map(),
        pingPlayers: null,
        lastPing: 0,
        idleSince: now,
        unfollow: null,
        startedAt: 0,
        stopRequested: false,
        sawStopping: false,
        wakeAfterStop: false,
        crashes: [],
        knocks: new Map(),
        knockWindow: now,
        knockCount: 0,
        denied: new Map(),
        logQueue: [],
        logWindow: now,
        logCount: 0,
        saveWaiters: [],
        stats: null,
        statsAt: 0,
        diskUsedMb: 0,
        backups: [],
      };
      this.live.set(id, live);
    }
    return live;
  }

  /** Nacheinander je Welt (Start, Stopp, Sicherung, Import, Plugins …). */
  private withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(id, tail);
    void tail.then(() => {
      if (this.locks.get(id) === tail) this.locks.delete(id);
    });
    return run;
  }

  private setState(id: string, state: HostedState, error: string | null = null): void {
    this.hs.setState(id, state, error);
    // RAM und CPU ändern sich mit dem Zustand: beim nächsten Abruf neu fragen
    const live = this.live.get(id);
    if (live) live.statsAt = 0;
    this.broadcast(id);
  }

  private sendTo(uuids: readonly string[], payload: unknown): void {
    for (const uuid of new Set(uuids)) this.realtime.send(uuid, payload);
  }

  /** Operatoren einer Welt mit Heldix-Konto (UUID), ohne den Besitzer. */
  private operatorUuids(world: WorldRow): string[] {
    const out = new Set<string>();
    for (const member of this.store.worldMembers(world.id)) {
      if (member.role !== 'operator') continue;
      const uuid = member.uuid ?? this.store.findUserByName(member.name)?.uuid ?? null;
      if (uuid && uuid !== world.owner) out.add(uuid);
    }
    return [...out];
  }

  /** Rolle eines Heldix-Spielers in einer dauerhaften Welt: Besitzer, Operator oder keine. */
  private roleFor(user: UserRow, world: WorldRow): HostedRole | null {
    if (world.owner === user.uuid) return 'owner';
    const lower = user.name.toLowerCase();
    for (const member of this.store.worldMembers(world.id)) {
      if (member.role === 'operator' && (member.uuid === user.uuid || (member.uuid === null && member.name.toLowerCase() === lower))) return 'operator';
    }
    return null;
  }

  /** Neuer Zustand an Besitzer und Operatoren (`hosting-state`, jeweils mit ihrer Rolle). */
  private broadcast(id: string): void {
    const row = this.hs.get(id);
    const world = row ? this.store.getWorld(id) : undefined;
    if (!row || !world) return;
    this.realtime.send(world.owner, { type: 'hosting-state', world: this.view(row, world, 'owner') });
    const operatorView = this.operatorUuids(world);
    if (operatorView.length > 0) {
      const view = this.view(row, world, 'operator');
      for (const uuid of operatorView) this.realtime.send(uuid, { type: 'hosting-state', world: view });
    }
  }

  private playerCount(id: string): number {
    const live = this.live.get(id);
    if (!live || live.port === null) return 0;
    return Math.max(live.players.size, live.pingPlayers ?? 0);
  }

  private motd(world: WorldRow): string {
    const site = this.options.site ? ` §8· §7${legacySafe(this.options.site)}` : '';
    return `§7${legacySafe(world.name)}\n§3Geteilt mit §bHeldixClient${site}`;
  }

  /** server.properties für den Runner: gespeicherte Auswahl plus Höchstzahl aus der Welt. */
  private runnerProperties(row: HostedRow, world: WorldRow): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of ALLOWED_PROPERTIES) if (row.properties[key] !== undefined) out[key] = row.properties[key]!;
    out['max-players'] = String(Math.min(world.maxPlayers, HOSTED_MAX_PLAYERS));
    return out;
  }

  view(row: HostedWithOwner, world: WorldRow, role: HostedRole): HostedWorldView {
    const live = this.live.get(row.world);
    const owner = this.store.getUser(row.owner);
    const running = row.state === 'running' || row.state === 'starting' || row.state === 'stopping';
    const upload = role === 'owner' ? this.options.uploads.get(row.world) : undefined;
    return {
      id: row.world,
      code: world.code,
      address: this.worlds.address(world.code),
      name: world.name,
      state: row.state,
      error: row.error,
      version: row.jar.version,
      software: row.jar.software,
      paperBuild: row.jar.build,
      players: this.playerCount(row.world),
      maxPlayers: world.maxPlayers,
      ram: { used: running ? Math.round(live?.stats?.memoryMb ?? 0) : 0, limit: row.memoryMb },
      disk: { used: Math.round(live?.diskUsedMb ?? 0), limit: row.diskMb },
      sleepAfterMin: row.sleepAfterMin,
      createdAt: row.createdAt,
      lastStartedAt: row.lastStartedAt,
      plugins: this.hs.countPlugins(row.world),
      maxPlugins: row.maxPlugins,
      role,
      owner: { uuid: row.owner, name: owner?.name ?? '' },
      access: world.access,
      defaultRole: world.defaultRole,
      awaitingUpload: row.awaitingUpload,
      restartNeeded: row.restartNeeded,
      notice:
        row.jar.software === 'vanilla' ? `Für Minecraft ${row.jar.version} gibt es kein Paper – die Welt läuft mit Vanilla (ohne Plugins).` : null,
      upload: upload ? this.options.uploads.view(upload) : null,
    };
  }

  /** Speicher und RAM beim Runner nachfragen (höchstens alle maxAgeMs). */
  private async refreshStats(id: string, maxAgeMs: number): Promise<void> {
    const live = this.liveOf(id);
    if (Date.now() - live.statsAt < maxAgeMs) return;
    live.statsAt = Date.now();
    try {
      const [stats, backups] = await Promise.all([this.runner.stats(id), this.runner.listBackups(id)]);
      live.stats = stats;
      live.backups = backups;
      // Die täglichen Sicherungen zählen nicht zum Speicher der Welt.
      const daily = backups.filter((b) => backupKind(b.name) === 'daily').reduce((sum, b) => sum + b.sizeBytes, 0) / MIB;
      live.diskUsedMb = Math.max(0, stats.diskMb - daily);
    } catch {
      // Runner gerade nicht erreichbar: alte Werte bleiben
    }
  }

  private requireOn(): void {
    if (this.closed) throw new HttpError(503, HOSTING_OFF);
  }

  /** Dauerhafte Welt zur ID, für die `user` Besitzer (oder bei `operator` auch Operator) ist; sonst 404 bzw. 403. */
  private find(user: UserRow, id: string | undefined, need: HostedRole): { row: HostedWithOwner; world: WorldRow; role: HostedRole } {
    this.requireOn();
    const row = id !== undefined && HOSTED_WORLD_ID_RE.test(id) ? this.hs.get(id) : undefined;
    const world = row ? this.store.getWorld(row.world) : undefined;
    const role = world ? this.roleFor(user, world) : null;
    if (!row || !world || role === null) throw new HttpError(404, HOSTED_GONE);
    if (need === 'owner' && role !== 'owner') throw new HttpError(403, OWNER_ONLY);
    return { row, world, role };
  }

  /** Zugang: aus, Team, Freischaltung oder (noch) nicht. */
  access(user: UserRow): { allowed: boolean; reason: 'beta' | null; team: boolean; limit: number } {
    const team = this.options.grants.isTeam(user.uuid);
    const allowed = team || this.options.grants.hasGrant(user.uuid);
    return { allowed, reason: allowed ? null : 'beta', team, limit: team ? this.options.worldsPerTeam : this.options.worldsPerPlayer };
  }

  private limits(user: UserRow, used: number) {
    const { limit } = this.access(user);
    return {
      worlds: limit,
      used,
      memoryMb: this.options.memoryMb,
      diskMb: this.options.diskMb,
      maxPlugins: this.options.maxPlugins,
      maxPlayers: HOSTED_MAX_PLAYERS,
      sleepAfterMin: { min: SLEEP_MIN, max: SLEEP_MAX, default: this.options.sleepDefaultMin },
      upload: { chunkBytes: this.options.uploads.chunkBytes, maxBytes: this.options.uploads.maxBytes },
      slots: { max: this.options.maxRunning, used: this.active.size },
      eula: EULA_URL,
    };
  }

  /** Laufende dauerhafte Welten (für /v1/status). */
  runningCount(): number {
    let count = 0;
    for (const row of this.hs.all()) if (row.state === 'running') count++;
    return count;
  }

  // ---------- Für Welt teilen und das Relay (WorldsHosting) ----------

  relayInfo(world: string): HostedRelayInfo | null {
    const row = this.hs.get(world);
    if (!row) return null;
    return { state: row.state, port: row.state === 'running' ? (this.live.get(world)?.port ?? null) : null, players: this.playerCount(world), version: row.jar.version };
  }

  ownedBy(owners: readonly string[]): { world: string; owner: string }[] {
    return this.hs.ownedBy(owners);
  }

  knock(world: WorldRow, name: string): void {
    const live = this.liveOf(world.id, world.owner);
    const lower = name.toLowerCase();
    const now = Date.now();
    const last = live.knocks.get(lower);
    if (last !== undefined && now - last < KNOCK_REPEAT_MS) return;
    if (now - live.knockWindow >= 60_000) {
      live.knockWindow = now;
      live.knockCount = 0;
    }
    if (++live.knockCount > KNOCKS_PER_MINUTE) return;
    if (live.knocks.size >= MAX_KNOCKS) for (const [key, at] of live.knocks) if (now - at >= DENY_MS) live.knocks.delete(key);
    live.knocks.set(lower, now);
    const payload = { type: 'hosting-knock', world: { id: world.id, name: world.name, address: this.worlds.address(world.code) }, name };
    this.sendTo([world.owner, ...this.operatorUuids(world)], payload);
  }

  isDenied(world: string, name: string): boolean {
    const until = this.live.get(world)?.denied.get(name.toLowerCase());
    return until !== undefined && until > Date.now();
  }

  wake(world: WorldRow): string {
    const row = this.hs.get(world.id);
    if (!row) return TEXT_ERROR;
    switch (row.state) {
      case 'running':
      case 'starting':
        return TEXT_STARTING;
      case 'stopping':
        this.liveOf(world.id, world.owner).wakeAfterStop = true;
        return TEXT_STARTING;
      case 'creating':
        return TEXT_CREATING;
      case 'error':
        return TEXT_ERROR;
      case 'sleeping':
        break;
    }
    if (!this.options.grants.allowed(world.owner)) return TEXT_PAUSED;
    if (this.active.size >= this.options.maxRunning) return TEXT_SLOTS_FULL;
    void this.startInternal(world.id).catch((err) => this.options.log(`Dauerhafte Welten: Aufwecken fehlgeschlagen (${message(err)}).`));
    return TEXT_STARTING;
  }

  membersChanged(world: string): void {
    const row = this.hs.get(world);
    const worldRow = row ? this.store.getWorld(world) : undefined;
    if (!row || !worldRow) return;
    const live = this.live.get(world);
    if (live && row.state === 'running') for (const name of live.players.values()) this.applyRole(world, name);
    // Wer kein Besitzer oder Operator mehr ist, bekommt das Live-Log nicht mehr.
    this.realtime.unsubscribeWhere(topicOf(world), (uuid) => {
      const user = this.store.getUser(uuid);
      return user !== undefined && this.roleFor(user, worldRow) !== null;
    });
    this.broadcast(world);
  }

  worldChanged(world: string): void {
    const row = this.hs.get(world);
    const worldRow = row ? this.store.getWorld(world) : undefined;
    if (!row || !worldRow) return;
    if (row.prepared) {
      void this.withLock(world, () => this.runner.setProperties(world, this.runnerProperties(row, worldRow), this.motd(worldRow))).catch((err) =>
        this.options.log(`Dauerhafte Welten: Einstellungen nicht übernommen (${message(err)}).`),
      );
    }
    if (row.state === 'running' || row.state === 'starting') this.hs.update(world, { restartNeeded: true });
    this.broadcast(world);
  }

  worldDeleted(world: string): void {
    if (!this.live.has(world)) this.liveOf(world);
    void this.purge(world);
  }

  // ---------- Lebenszyklus ----------

  /** Start anstoßen (Plätze frei, Welt bereit); kehrt nach dem Start des Prozesses zurück, „running“ folgt. */
  private async startInternal(id: string): Promise<void> {
    const row = this.hs.get(id);
    if (!row) throw new HttpError(404, HOSTED_GONE);
    if (row.state === 'running' || row.state === 'starting') return;
    if (row.state === 'stopping') {
      this.liveOf(id).wakeAfterStop = true;
      return;
    }
    if (row.state === 'creating') throw new HttpError(409, row.awaitingUpload ? 'Die Welt wartet noch auf den Upload.' : TEXT_CREATING);
    if (!this.active.has(id) && this.active.size >= this.options.maxRunning) throw new HttpError(503, TEXT_SLOTS_FULL, { 'Retry-After': '120' });
    this.active.add(id);
    const live = this.liveOf(id, row.owner);
    live.stopRequested = false;
    live.sawStopping = false;
    this.setState(id, 'starting', row.error);
    await this.withLock(id, async () => {
      try {
        const current = this.hs.get(id);
        const world = this.store.getWorld(id);
        if (!current || !world) throw new HttpError(404, HOSTED_GONE);
        if (!current.prepared) await this.prepare(id);
        else await this.runner.setProperties(id, this.runnerProperties(current, world), this.motd(world));
        const { port } = await this.runner.start(id);
        const now = Date.now();
        live.port = port;
        live.players.clear();
        live.pingPlayers = null;
        live.startedAt = now;
        live.idleSince = now;
        live.lastPing = now;
        this.follow(id);
        this.hs.update(id, { lastStartedAt: now, restartNeeded: false });
        this.waitReady(id);
      } catch (err) {
        this.detach(id);
        this.active.delete(id);
        this.setState(id, 'error', `Start fehlgeschlagen: ${message(err)}`);
        throw err instanceof HttpError ? err : new HttpError(502, `Die Welt ließ sich nicht starten: ${message(err)}`);
      }
    });
  }

  /** Bereit, sobald der Server auf die Status-Abfrage antwortet (oder „Done (…)!“ im Log steht); sonst Zeitüberschreitung. */
  private waitReady(id: string): void {
    const live = this.liveOf(id);
    if (live.readyTimer) clearTimeout(live.readyTimer);
    const deadline = Date.now() + this.options.startTimeoutMs;
    const poll = async () => {
      live.readyTimer = undefined;
      const row = this.hs.get(id);
      if (this.closed || !row || row.state !== 'starting' || live.port === null) return;
      const ping = await statusPing(live.port, { timeoutMs: Math.min(2000, this.options.readyPollMs * 2) });
      if (this.hs.get(id)?.state !== 'starting') return;
      if (ping) {
        this.markRunning(id);
        return;
      }
      if (Date.now() >= deadline) {
        this.options.log('Dauerhafte Welten: Eine Welt ist nicht rechtzeitig gestartet.');
        live.stopRequested = true;
        await this.withLock(id, async () => {
          await this.runner.stop(id, { timeoutMs: this.options.stopTimeoutMs }).catch(() => undefined);
          this.detach(id);
          this.active.delete(id);
        });
        this.setState(id, 'error', 'Die Welt ist nicht rechtzeitig gestartet.');
        return;
      }
      live.readyTimer = setTimeout(() => void poll(), this.options.readyPollMs);
      live.readyTimer.unref();
    };
    live.readyTimer = setTimeout(() => void poll(), this.options.readyPollMs);
    live.readyTimer.unref();
  }

  private markRunning(id: string): void {
    const row = this.hs.get(id);
    if (!row || row.state !== 'starting') return;
    const live = this.liveOf(id);
    if (live.readyTimer) clearTimeout(live.readyTimer);
    live.readyTimer = undefined;
    live.idleSince = Date.now();
    this.hs.update(id, { lastActiveAt: Date.now() });
    // Ein Absturz von vorher ist mit dem erfolgreichen Start erledigt.
    this.setState(id, 'running', null);
  }

  /** Logs abmelden, Port und Spieler vergessen. */
  private detach(id: string): void {
    const live = this.live.get(id);
    if (!live) return;
    live.unfollow?.();
    live.unfollow = null;
    if (live.readyTimer) clearTimeout(live.readyTimer);
    live.readyTimer = undefined;
    live.port = null;
    live.players.clear();
    live.pingPlayers = null;
    for (const wake of live.saveWaiters.splice(0)) wake();
  }

  /** Anhalten (Besitzer, Team, Schlafen); kehrt zurück, wenn der Server aus ist. */
  private async stopInternal(id: string, reason: 'user' | 'sleep' | 'team' | 'access'): Promise<void> {
    const row = this.hs.get(id);
    if (!row) throw new HttpError(404, HOSTED_GONE);
    if (row.state !== 'running' && row.state !== 'starting') return;
    const live = this.liveOf(id, row.owner);
    live.stopRequested = true;
    live.wakeAfterStop = false;
    if (reason === 'sleep') this.options.log('Dauerhafte Welten: Eine Welt schläft (keine Spieler).');
    this.setState(id, 'stopping');
    await this.withLock(id, async () => {
      try {
        await this.runner.stop(id, { timeoutMs: this.options.stopTimeoutMs });
      } catch (err) {
        this.options.log(`Dauerhafte Welten: Anhalten fehlgeschlagen (${message(err)}).`);
      }
      this.detach(id);
      this.active.delete(id);
      if (this.hs.get(id)) this.setState(id, 'sleeping');
    });
    if (live.wakeAfterStop && this.hs.get(id)?.state === 'sleeping') {
      live.wakeAfterStop = false;
      if (this.active.size < this.options.maxRunning && this.options.grants.allowed(row.owner)) {
        void this.startInternal(id).catch((err) => this.options.log(`Dauerhafte Welten: Aufwecken fehlgeschlagen (${message(err)}).`));
      }
    }
  }

  /** Server ohne Auftrag beendet: „stop“ von der Konsole → schläft; sonst Absturz (nach drei in 30 Minuten: error). */
  private crashed(id: string): void {
    const live = this.liveOf(id);
    const byCommand = live.sawStopping;
    this.detach(id);
    this.active.delete(id);
    if (byCommand) {
      this.setState(id, 'sleeping');
      return;
    }
    const now = Date.now();
    live.crashes = live.crashes.filter((at) => now - at < 30 * 60_000);
    live.crashes.push(now);
    this.options.log('Dauerhafte Welten: Ein Server wurde unerwartet beendet.');
    if (live.crashes.length >= 3) this.setState(id, 'error', 'Der Server ist mehrmals hintereinander abgestürzt. Bitte Plugins und Einstellungen prüfen.');
    else this.setState(id, 'sleeping', 'Der Server wurde unerwartet beendet. Beim nächsten Beitreten startet er neu.');
  }

  /** Datenordner, Server-Jar, server.properties, EULA und Symbol beim Runner anlegen bzw. auffrischen. */
  private async prepare(id: string): Promise<void> {
    const row = this.hs.get(id);
    const world = this.store.getWorld(id);
    if (!row || !world) throw new HttpError(404, HOSTED_GONE);
    await this.runner.prepare(id, {
      jar: row.jar,
      memoryMb: row.memoryMb,
      properties: this.runnerProperties(row, world),
      motd: this.motd(world),
      iconPng: row.icon ?? worldIcon(null),
    });
    this.hs.update(id, { prepared: true });
  }

  /** Nach dem Anlegen: vorbereiten; ohne ausstehenden Upload danach schlafen. */
  private async prepareAndSettle(id: string): Promise<void> {
    try {
      await this.prepare(id);
      const row = this.hs.get(id);
      if (row && row.state === 'creating' && !row.awaitingUpload) this.setState(id, 'sleeping');
      else this.broadcast(id);
    } catch (err) {
      if (this.hs.get(id)) this.setState(id, 'error', `Einrichten fehlgeschlagen: ${message(err)}`);
    }
  }

  // ---------- Logs, Spieler, Rollen ----------

  private follow(id: string): void {
    const live = this.liveOf(id);
    live.unfollow?.();
    try {
      live.unfollow = this.runner.followLogs(id, (line) => this.onLog(id, line));
    } catch (err) {
      live.unfollow = null;
      this.options.log(`Dauerhafte Welten: Log nicht lesbar (${message(err)}).`);
    }
  }

  private onLog(id: string, raw: string): void {
    const live = this.live.get(id);
    if (!live) return;
    const line = raw.replace(ANSI_RE, '').replace(/[\r\n]+$/, '').slice(0, 2000);
    this.queueLog(live, line);
    if (DONE_RE.test(line)) this.markRunning(id);
    if (STOPPING_RE.test(line)) live.sawStopping = true;
    if (SAVED_RE.test(line)) for (const wake of live.saveWaiters.splice(0)) wake();
    const joined = JOIN_RE.exec(line);
    if (joined && isName(joined[1])) {
      const name = joined[1];
      live.players.set(name.toLowerCase(), name);
      live.pingPlayers = null;
      live.idleSince = Date.now();
      this.hs.update(id, { lastActiveAt: Date.now() });
      this.applyRole(id, name);
      this.broadcast(id);
      return;
    }
    const left = LEFT_RE.exec(line);
    if (left && isName(left[1])) {
      live.players.delete(left[1].toLowerCase());
      live.pingPlayers = null;
      live.idleSince = Date.now();
      this.hs.update(id, { lastActiveAt: Date.now() });
      this.broadcast(id);
    }
  }

  /** Live-Log gebündelt an Abonnenten (höchstens alle 250 ms, höchstens LOG_LINES_PER_SECOND Zeilen je Sekunde). */
  private queueLog(live: Live, line: string): void {
    const topic = topicOf(live.world);
    if (!this.realtime.hasSubscribers(topic)) return;
    const now = Date.now();
    if (now - live.logWindow >= 1000) {
      live.logWindow = now;
      live.logCount = 0;
    }
    if (++live.logCount > LOG_LINES_PER_SECOND) return;
    live.logQueue.push(line);
    if (live.logTimer) return;
    live.logTimer = setTimeout(() => {
      live.logTimer = undefined;
      const lines = live.logQueue.splice(0);
      if (lines.length > 0) this.realtime.publish(topic, { type: 'hosting-log', world: live.world, lines });
    }, 250);
    live.logTimer.unref();
  }

  /** Rolle in der Welt für einen Namen: Besitzer und Operatoren → operator, Mitglieder → ihre Rolle, sonst Standardrolle. */
  private roleOfName(world: WorldRow, name: string): 'operator' | 'player' | 'visitor' {
    const lower = name.toLowerCase();
    if (this.store.getUser(world.owner)?.name.toLowerCase() === lower) return 'operator';
    for (const member of this.store.worldMembers(world.id)) {
      if (member.name.toLowerCase() === lower) return member.role;
      if (member.uuid !== null && this.store.getUser(member.uuid)?.name.toLowerCase() === lower) return member.role;
    }
    return world.defaultRole;
  }

  /**
   * Rolle beim Beitreten per Konsole setzen: Besucher `gamemode adventure`, Operatoren `op`, wer vorher Operator war
   * `deop`, wer vorher Besucher war, wieder den Spielmodus der Welt. Der Name ist geprüft (nur A–Z, 0–9, _).
   */
  private applyRole(id: string, name: string): void {
    const row = this.hs.get(id);
    const world = this.store.getWorld(id);
    if (!row || !world || !isName(name)) return;
    const role = this.roleOfName(world, name);
    const lower = name.toLowerCase();
    const previous = row.appliedRoles[lower];
    const commands: string[] = [];
    if (role === 'operator') {
      commands.push(`op ${name}`);
      if (previous === 'visitor') commands.push(`gamemode ${row.properties.gamemode ?? 'survival'} ${name}`);
    } else {
      if (previous === 'operator') commands.push(`deop ${name}`);
      if (role === 'visitor') commands.push(`gamemode adventure ${name}`);
      else if (previous === 'visitor') commands.push(`gamemode ${row.properties.gamemode ?? 'survival'} ${name}`);
    }
    for (const command of commands) {
      this.runner.command(id, command).catch((err) => this.options.log(`Dauerhafte Welten: Rolle nicht gesetzt (${message(err)}).`));
    }
    if (previous !== role) {
      const applied = { ...row.appliedRoles, [lower]: role };
      const keys = Object.keys(applied);
      if (keys.length > MAX_APPLIED_ROLES) for (const key of keys.slice(0, keys.length - MAX_APPLIED_ROLES)) delete applied[key];
      this.hs.update(id, { appliedRoles: applied });
    }
  }

  /** Vor Sicherung oder Download einer laufenden Welt: alles speichern und Speichern kurz anhalten. */
  private async saveAll(id: string): Promise<boolean> {
    const live = this.live.get(id);
    if (!live || live.port === null) return false;
    const saved = new Promise<void>((resolve) => {
      live.saveWaiters.push(resolve);
      setTimeout(resolve, 15_000).unref();
    });
    await this.runner.command(id, 'save-off');
    await this.runner.command(id, 'save-all flush');
    await saved;
    return true;
  }

  // ---------- Wachhund ----------

  private async tick(): Promise<void> {
    if (this.ticking || this.closed) return;
    this.ticking = true;
    try {
      const now = Date.now();
      for (const id of [...this.active]) await this.check(id, now);
      if (now - this.lastBackupCheck >= this.options.backupCheckMs) {
        this.lastBackupCheck = now;
        await this.dailyBackups(now);
      }
      if (now - this.lastReconcile >= this.options.reconcileMs) {
        this.lastReconcile = now;
        await this.reconcile(false);
      }
    } catch (err) {
      this.options.log(`Dauerhafte Welten: Prüfung fehlgeschlagen (${message(err)}).`);
    } finally {
      this.ticking = false;
    }
  }

  private async check(id: string, now: number): Promise<void> {
    const row = this.hs.get(id);
    if (!row) {
      this.active.delete(id);
      return;
    }
    if (this.locks.has(id)) return;
    const live = this.liveOf(id, row.owner);
    let state;
    try {
      state = await this.runner.state(id);
    } catch {
      return;
    }
    if (this.locks.has(id)) return;
    if ((row.state === 'running' || row.state === 'starting') && (state === 'stopped' || state === 'missing') && !live.stopRequested) {
      this.crashed(id);
      return;
    }
    if (row.state !== 'running' || live.port === null) return;
    if (now - live.lastPing >= this.options.pingIntervalMs) {
      live.lastPing = now;
      const ping = await statusPing(live.port, { timeoutMs: 3000 });
      if (ping) {
        live.pingPlayers = ping.online;
        if (ping.online === 0 && live.players.size > 0) {
          live.players.clear();
          live.idleSince = now;
        }
      }
    }
    void this.refreshStats(id, 30_000);
    if (this.playerCount(id) > 0) {
      live.idleSince = now;
      return;
    }
    if (row.sleepAfterMin > 0 && now - live.idleSince >= row.sleepAfterMin * this.options.minuteMs) {
      await this.stopInternal(id, 'sleep').catch((err) => this.options.log(`Dauerhafte Welten: Schlafen fehlgeschlagen (${message(err)}).`));
    }
  }

  /** Tägliche Sicherung für Welten, die seit der letzten gelaufen sind (die letzten 7 bleiben). */
  private async dailyBackups(now: number): Promise<void> {
    for (const row of this.hs.all()) {
      if (row.state === 'creating' || row.state === 'error' || row.awaitingUpload || !row.prepared) continue;
      if (row.lastDailyBackupAt !== null && now - row.lastDailyBackupAt < this.options.dailyBackupMs) continue;
      const used = row.state === 'running' || (row.lastStartedAt !== null && (row.lastDailyBackupAt === null || row.lastStartedAt > row.lastDailyBackupAt));
      if (!used || this.locks.has(row.world)) continue;
      try {
        await this.withLock(row.world, () => this.backupNow(row.world, 'daily'));
        this.hs.update(row.world, { lastDailyBackupAt: now });
      } catch (err) {
        this.options.log(`Dauerhafte Welten: Tägliche Sicherung fehlgeschlagen (${message(err)}).`);
      }
    }
  }

  // ---------- Sicherungen ----------

  /** Sicherung anlegen (im Lock aufrufen); läuft die Welt, wird vorher gespeichert. Alte automatische fallen weg. */
  private async backupNow(id: string, kind: BackupKind): Promise<BackupInfo> {
    const existing = await this.runner.listBackups(id);
    const names = new Set(existing.map((b) => b.name));
    let at = Date.now();
    let name = `${BACKUP_PREFIX[kind]}${stamp(at)}`;
    while (names.has(name)) {
      at += 1000;
      name = `${BACKUP_PREFIX[kind]}${stamp(at)}`;
    }
    const running = await this.saveAll(id).catch(() => false);
    let info: BackupInfo;
    try {
      info = await this.runner.backup(id, name);
    } finally {
      if (running) await this.runner.command(id, 'save-on').catch(() => undefined);
    }
    this.hs.saveSnapshot(id, name);
    // Aufräumen: täglich die letzten keepDaily, automatische „vor-…“ die letzten keepAuto
    const all = [...existing, info].sort((a, b) => b.createdAt - a.createdAt);
    const daily = all.filter((b) => backupKind(b.name) === 'daily');
    const auto = all.filter((b) => !['daily', 'manual'].includes(backupKind(b.name)));
    for (const old of [...daily.slice(this.options.keepDaily), ...auto.slice(this.options.keepAuto)]) {
      await this.runner.deleteBackup(id, old.name).catch(() => undefined);
      this.hs.deleteSnapshot(id, old.name);
    }
    this.liveOf(id).statsAt = 0;
    return info;
  }

  private backupView(info: BackupInfo) {
    return { name: info.name, kind: backupKind(info.name), sizeBytes: info.sizeBytes, createdAt: info.createdAt };
  }

  /** Speicher frei? Sonst 409 (Speicher je Welt ohne die täglichen Sicherungen). */
  private async requireDisk(row: HostedRow, extraMb = 0): Promise<void> {
    await this.refreshStats(row.world, 0);
    const used = this.liveOf(row.world).diskUsedMb;
    if (used + extraMb >= row.diskMb) {
      throw new HttpError(409, `Der Speicher der Welt ist voll (${Math.round(row.diskMb / 1024)} GB). Lösch Sicherungen oder Plugins.`, {}, 'disk-full');
    }
  }

  // ---------- Endpunkte für Spieler ----------

  /** `GET /v1/hosting` */
  async overview(user: UserRow) {
    this.requireOn();
    const access = this.access(user);
    const own = this.hs.ofOwner(user.uuid);
    const operated: { row: HostedWithOwner; world: WorldRow }[] = [];
    for (const row of this.hs.all()) {
      if (row.owner === user.uuid) continue;
      const world = this.store.getWorld(row.world);
      if (world && this.roleFor(user, world) === 'operator') operated.push({ row, world });
    }
    await Promise.all([...own.map((r) => this.refreshStats(r.world, 15_000)), ...operated.map((o) => this.refreshStats(o.row.world, 15_000))]);
    return {
      allowed: access.allowed,
      reason: access.reason,
      team: access.team,
      limits: this.limits(user, own.length),
      worlds: own.flatMap((row) => {
        const world = this.store.getWorld(row.world);
        return world ? [this.view(this.hs.get(row.world) ?? row, world, 'owner')] : [];
      }),
      operated: operated.map(({ row, world }) => this.view(this.hs.get(row.world) ?? row, world, 'operator')),
    };
  }

  /** `POST /v1/hosting/worlds { world | null, name, seed?, gameMode?, difficulty?, type?, version? }` */
  async create(user: UserRow, input: Record<string, unknown>): Promise<HostedWorldView> {
    this.requireOn();
    const access = this.access(user);
    if (!access.allowed) throw new HttpError(403, TEXT_BETA, {}, 'beta');
    const used = this.hs.countOf(user.uuid);
    if (used >= access.limit) {
      throw new HttpError(409, access.limit === 1 ? 'Du hast schon eine dauerhafte Welt.' : `Du hast schon ${access.limit} dauerhafte Welten.`, {}, 'limit');
    }
    const fromWorld = input.world !== undefined && input.world !== null;
    let world: WorldRow | null = null;
    if (fromWorld) {
      world = this.worlds.ownWorld(user, typeof input.world === 'string' ? input.world : undefined);
      if (this.hs.get(world.id)) throw new HttpError(409, 'Diese Welt ist schon dauerhaft.');
    }
    let name: string | null = null;
    if (input.name !== undefined && input.name !== null) {
      const checked = checkText(input.name, 32, false);
      if ('problem' in checked) throw new HttpError(400, 'Der Name der Welt muss 1 bis 32 Zeichen lang sein (ohne Steuerzeichen).');
      name = checked.text;
    }
    const properties: Record<string, string> = { ...DEFAULT_PROPERTIES };
    if (!fromWorld) {
      if (input.seed !== undefined && input.seed !== null && input.seed !== '') {
        if (typeof input.seed !== 'string' && typeof input.seed !== 'number') throw new HttpError(400, '„seed“ muss ein Text oder eine Zahl sein.');
        const seed = String(input.seed);
        if (seed.length > 64 || /[\u0000-\u001f\u007f\\]/.test(seed)) throw new HttpError(400, 'Der Seed darf höchstens 64 Zeichen lang sein.');
        properties['level-seed'] = seed;
      }
      if (input.type !== undefined && input.type !== null) {
        if (typeof input.type !== 'string' || !LEVEL_TYPES[input.type]) throw new HttpError(400, '„type“ muss "normal" oder "flat" sein.');
        properties['level-type'] = LEVEL_TYPES[input.type]!;
        if (input.type === 'flat') properties['generate-structures'] = 'false';
      }
    }
    if (input.gameMode !== undefined && input.gameMode !== null) properties.gamemode = this.checkProperty('gamemode', input.gameMode);
    if (input.difficulty !== undefined && input.difficulty !== null) properties.difficulty = this.checkProperty('difficulty', input.difficulty);
    let version: string | null = null;
    if (input.version !== undefined && input.version !== null) {
      if (typeof input.version !== 'string' || !VERSION_RE.test(input.version)) throw new HttpError(400, 'Ungültige Minecraft-Version.');
      version = input.version;
    } else if (world?.version) {
      version = world.version;
    }
    const jar = await this.options.jars.resolve(version ?? (await this.options.jars.latestVersion()));
    if (world === null) {
      const created = this.worlds.create(user, { name: name ?? `Welt von ${user.name}` });
      world = this.store.getWorld(created.id)!;
    } else if (name !== null && name !== world.name) {
      this.store.updateWorld(world.id, { name });
      world = this.store.getWorld(world.id)!;
    }
    if (world.maxPlayers > HOSTED_MAX_PLAYERS) this.store.updateWorld(world.id, { maxPlayers: HOSTED_MAX_PLAYERS });
    const id = world.id;
    this.hs.insert({
      world: id,
      state: 'creating',
      jar,
      memoryMb: this.options.memoryMb,
      diskMb: this.options.diskMb,
      maxPlugins: this.options.maxPlugins,
      sleepAfterMin: this.options.sleepDefaultMin,
      properties,
      icon: null,
      awaitingUpload: fromWorld,
      createdAt: Date.now(),
    });
    // Ab jetzt läuft sie auf dem Heldix-Server: eine offene Tunnel-Sitzung derselben Welt schließen.
    this.worlds.closeTunnel(id);
    this.liveOf(id, user.uuid);
    this.broadcast(id);
    void this.withLock(id, () => this.prepareAndSettle(id));
    return this.view(this.hs.get(id)!, this.store.getWorld(id)!, 'owner');
  }

  /** `GET /v1/hosting/worlds/<id>` (mit Anklopfenden der letzten 10 Minuten) */
  async get(user: UserRow, id: string | undefined) {
    const { row, world, role } = this.find(user, id, 'operator');
    await this.refreshStats(row.world, 10_000);
    const live = this.live.get(row.world);
    const now = Date.now();
    const knocks = live ? [...live.knocks.entries()].filter(([, at]) => now - at < DENY_MS).map(([name, at]) => ({ name, at })) : [];
    return { ...this.view(this.hs.get(row.world)!, world, role), knocks, members: this.worlds.memberViews(world.id) };
  }

  /** `PATCH /v1/hosting/worlds/<id> { name?, sleepAfterMin?, version? }` (Besitzer) */
  async patch(user: UserRow, id: string | undefined, input: Record<string, unknown>): Promise<HostedWorldView> {
    const { row, world } = this.find(user, id, 'owner');
    if (Object.hasOwn(input, 'sleepAfterMin')) {
      const value = input.sleepAfterMin;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < SLEEP_MIN || value > SLEEP_MAX) {
        throw new HttpError(400, `„sleepAfterMin“ muss eine ganze Zahl von ${SLEEP_MIN} bis ${SLEEP_MAX} sein.`);
      }
      this.hs.update(row.world, { sleepAfterMin: value });
    }
    if (Object.hasOwn(input, 'name')) {
      const checked = checkText(input.name, 32, false);
      if ('problem' in checked) throw new HttpError(400, 'Der Name der Welt muss 1 bis 32 Zeichen lang sein (ohne Steuerzeichen).');
      this.worlds.update(user, world.id, { name: checked.text });
    }
    if (Object.hasOwn(input, 'version') && input.version !== row.jar.version) {
      if (typeof input.version !== 'string' || !VERSION_RE.test(input.version)) throw new HttpError(400, 'Ungültige Minecraft-Version.');
      const current = this.hs.get(row.world)!;
      if (current.state !== 'sleeping' && current.state !== 'error') throw new HttpError(409, 'Die Version lässt sich nur ändern, wenn die Welt schläft.');
      const jar = await this.options.jars.resolve(input.version);
      await this.withLock(row.world, async () => {
        if (current.prepared && !current.awaitingUpload) await this.backupNow(row.world, 'before-version');
        this.hs.update(row.world, { jar, prepared: false });
        await this.prepare(row.world);
      });
      if (this.hs.get(row.world)?.state === 'error') this.setState(row.world, 'sleeping');
    }
    this.broadcast(row.world);
    return this.view(this.hs.get(row.world)!, this.store.getWorld(row.world)!, 'owner');
  }

  /** `DELETE /v1/hosting/worlds/<id>`: dauerhaft beenden (die geteilte Welt bleibt). */
  async remove(user: UserRow, id: string | undefined): Promise<{ ok: true }> {
    const { row } = this.find(user, id, 'owner');
    const live = this.liveOf(row.world, row.owner);
    live.stopRequested = true;
    await this.withLock(row.world, async () => {
      this.detach(row.world);
      try {
        await this.runner.remove(row.world);
      } catch (err) {
        // Nicht schlimm: Der nächste Abgleich löscht, was beim Runner übrig ist.
        this.options.log(`Dauerhafte Welten: Löschen beim Runner fehlgeschlagen (${message(err)}).`);
      }
      this.hs.delete(row.world);
      await this.options.uploads.cancel(row.world);
    });
    this.active.delete(row.world);
    this.live.delete(row.world);
    this.sendTo([row.owner], { type: 'hosting-state', world: { id: row.world, state: 'deleted' } });
    return { ok: true };
  }

  /** `POST …/start` (Besitzer und Operatoren) */
  async start(user: UserRow, id: string | undefined): Promise<HostedWorldView> {
    const { row, world, role } = this.find(user, id, 'operator');
    if (!this.options.grants.allowed(row.owner)) throw new HttpError(403, TEXT_PAUSED, {}, 'paused');
    if (row.state === 'error') this.hs.setState(row.world, 'sleeping', null);
    await this.startInternal(row.world);
    return this.view(this.hs.get(row.world)!, world, role);
  }

  /** `POST …/stop` (Besitzer und Operatoren); kehrt sofort zurück, `hosting-state` folgt. */
  stop(user: UserRow, id: string | undefined): HostedWorldView {
    const { row, world, role } = this.find(user, id, 'operator');
    void this.stopInternal(row.world, 'user').catch((err) => this.options.log(`Dauerhafte Welten: Anhalten fehlgeschlagen (${message(err)}).`));
    return this.view(this.hs.get(row.world)!, world, role);
  }

  /** `POST …/restart`: anhalten und gleich wieder starten. */
  restart(user: UserRow, id: string | undefined): HostedWorldView {
    const { row, world, role } = this.find(user, id, 'operator');
    if (!this.options.grants.allowed(row.owner)) throw new HttpError(403, TEXT_PAUSED, {}, 'paused');
    const live = this.liveOf(row.world, row.owner);
    if (row.state === 'running' || row.state === 'starting') {
      void this.stopInternal(row.world, 'user')
        .then(() => {
          live.wakeAfterStop = false;
          return this.startInternal(row.world);
        })
        .catch((err) => this.options.log(`Dauerhafte Welten: Neustart fehlgeschlagen (${message(err)}).`));
    } else if (row.state === 'sleeping' || row.state === 'error') {
      if (row.state === 'error') this.hs.setState(row.world, 'sleeping', null);
      void this.startInternal(row.world).catch((err) => this.options.log(`Dauerhafte Welten: Start fehlgeschlagen (${message(err)}).`));
    }
    return this.view(this.hs.get(row.world)!, world, role);
  }

  /** `GET …/console?lines=` (Besitzer und Operatoren) */
  async console(user: UserRow, id: string | undefined, lines: number | undefined) {
    const { row } = this.find(user, id, 'operator');
    const count = Math.min(Math.max(lines ?? CONSOLE_LINES, 1), CONSOLE_LINES);
    let recent: string[] = [];
    try {
      recent = (await this.runner.recentLogs(row.world, count)).map((line) => line.replace(ANSI_RE, '').slice(0, 2000));
    } catch {
      recent = [];
    }
    return { state: row.state, lines: recent.slice(-count) };
  }

  /** `POST …/command { command }` (Besitzer und Operatoren, nur wenn sie läuft) */
  async command(user: UserRow, id: string | undefined, input: Record<string, unknown>): Promise<{ ok: true }> {
    const { row } = this.find(user, id, 'operator');
    const command = checkCommand(input.command);
    if (row.state !== 'running') throw new HttpError(409, 'Befehle gehen nur, wenn die Welt läuft.');
    const rate = this.commandLimiter.take(user.uuid);
    if (!rate.ok) throw new HttpError(429, 'Zu viele Befehle. Bitte kurz warten.', { 'Retry-After': String(rate.retryAfter) });
    await this.runner.command(row.world, command);
    return { ok: true };
  }

  /** `POST …/knocks/<name> { allow }`: angeklopften Spieler zulassen (wird Mitglied) oder 10 Minuten ablehnen. */
  answerKnock(user: UserRow, id: string | undefined, rawName: string | undefined, input: Record<string, unknown>) {
    const { row, world } = this.find(user, id, 'operator');
    if (!isName(rawName)) throw new HttpError(400, 'Ungültiger Spielername.');
    if (typeof input.allow !== 'boolean') throw new HttpError(400, '„allow“ muss true oder false sein.');
    const live = this.liveOf(row.world, row.owner);
    const lower = rawName.toLowerCase();
    live.knocks.delete(lower);
    if (input.allow) {
      live.denied.delete(lower);
      return { allowed: true, members: this.worlds.admitName(world, rawName) };
    }
    if (live.denied.size >= 500) for (const [key, until] of live.denied) if (until <= Date.now()) live.denied.delete(key);
    live.denied.set(lower, Date.now() + DENY_MS);
    return { allowed: false, members: this.worlds.memberViews(world.id) };
  }

  // ---------- server.properties ----------

  private checkProperty(key: string, value: unknown): string {
    const rule = PROPERTY_RULES[key];
    if (!rule) throw new HttpError(400, `„${key}“ lässt sich nicht ändern.`);
    if (rule.kind === 'bool') {
      if (typeof value !== 'boolean') throw new HttpError(400, `„${key}“ muss true oder false sein.`);
      return String(value);
    }
    if (rule.kind === 'int') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < rule.min || value > rule.max) {
        throw new HttpError(400, `„${key}“ muss eine ganze Zahl von ${rule.min} bis ${rule.max} sein.`);
      }
      return String(value);
    }
    if (typeof value !== 'string' || !rule.values.includes(value)) throw new HttpError(400, `„${key}“ muss einer dieser Werte sein: ${rule.values.join(', ')}.`);
    return value;
  }

  private propertiesView(row: HostedRow, world: WorldRow) {
    const properties: Record<string, string | number | boolean> = {};
    for (const [key, rule] of Object.entries(PROPERTY_RULES)) {
      const raw = key === 'max-players' ? String(world.maxPlayers) : row.properties[key];
      if (raw === undefined) continue;
      properties[key] = rule.kind === 'bool' ? raw === 'true' : rule.kind === 'int' ? Number(raw) : raw;
    }
    for (const key of CREATE_ONLY) if (row.properties[key] !== undefined) properties[key] = row.properties[key]!;
    return { properties, motd: this.motd(world), rules: PROPERTY_RULES, restartNeeded: row.restartNeeded };
  }

  /** `GET …/properties` (Besitzer und Operatoren) */
  properties(user: UserRow, id: string | undefined) {
    const { row, world } = this.find(user, id, 'operator');
    return this.propertiesView(row, world);
  }

  /** `PATCH …/properties { <Schlüssel>: Wert }` (Besitzer); wirkt nach einem Neustart. */
  async patchProperties(user: UserRow, id: string | undefined, input: Record<string, unknown>) {
    const { row, world } = this.find(user, id, 'owner');
    const next = { ...row.properties };
    let maxPlayers: number | null = null;
    for (const [key, value] of Object.entries(input)) {
      if (CREATE_ONLY.includes(key)) throw new HttpError(400, `„${key}“ lässt sich nur beim Anlegen einer neuen Welt festlegen.`);
      if (key === 'motd') throw new HttpError(400, 'Die Beschreibung (MOTD) ist fest: Name der Welt und „Geteilt mit HeldixClient“.');
      const checked = this.checkProperty(key, value);
      if (key === 'max-players') maxPlayers = Number(checked);
      else next[key] = checked;
    }
    this.hs.update(row.world, { properties: next });
    if (maxPlayers !== null && maxPlayers !== world.maxPlayers) this.store.updateWorld(world.id, { maxPlayers });
    const updated = this.hs.get(row.world)!;
    const updatedWorld = this.store.getWorld(world.id)!;
    if (updated.prepared) {
      await this.withLock(row.world, () => this.runner.setProperties(row.world, this.runnerProperties(updated, updatedWorld), this.motd(updatedWorld)));
    }
    if (updated.state === 'running' || updated.state === 'starting') this.hs.update(row.world, { restartNeeded: true });
    this.broadcast(row.world);
    return this.propertiesView(this.hs.get(row.world)!, updatedWorld);
  }

  // ---------- Plugins ----------

  private pluginView(plugin: HostedPluginRow) {
    return {
      project: plugin.project,
      slug: plugin.slug,
      title: plugin.title,
      icon: plugin.icon,
      version: plugin.versionNumber,
      versionId: plugin.versionId,
      file: plugin.file,
      installedAt: plugin.installedAt,
      url: `https://modrinth.com/plugin/${plugin.slug}`,
    };
  }

  /** `GET …/plugins[?updates=1]` (Besitzer und Operatoren) */
  async plugins(user: UserRow, id: string | undefined, checkUpdates: boolean) {
    const { row } = this.find(user, id, 'operator');
    const rows = this.hs.plugins(row.world);
    const plugins = await Promise.all(
      rows.map(async (plugin) => {
        let update: { versionId: string; version: string } | null = null;
        if (checkUpdates && row.jar.software === 'paper') {
          try {
            const chosen = await this.options.modrinth.choose(plugin.project, row.jar.version);
            if (chosen.versionId !== plugin.versionId) update = { versionId: chosen.versionId, version: chosen.versionNumber };
          } catch {
            update = null;
          }
        }
        return { ...this.pluginView(plugin), update };
      }),
    );
    return { plugins, max: row.maxPlugins, software: row.jar.software, version: row.jar.version, restartNeeded: row.restartNeeded, notice: PLUGIN_NOTICE };
  }

  private requirePaper(row: HostedRow): void {
    if (row.jar.software !== 'paper') {
      throw new HttpError(409, `Diese Welt läuft mit Vanilla (für Minecraft ${row.jar.version} gibt es kein Paper) – Plugins gehen hier nicht.`, {}, 'vanilla');
    }
  }

  /** Datei installieren und merken (im Lock): vorher Sicherung, danach „Neustart nötig“, wenn sie läuft. */
  private async putPlugin(row: HostedRow, chosen: Awaited<ReturnType<Modrinth['choose']>>, replacing: HostedPluginRow | null): Promise<void> {
    const others = this.hs.plugins(row.world).filter((p) => p.project !== chosen.project);
    let file = chosen.file;
    if (others.some((p) => p.file.toLowerCase() === file.name.toLowerCase())) file = { ...file, name: `${chosen.slug}-${file.name}`.slice(0, 96) };
    if (!PLUGIN_FILE_RE.test(file.name)) throw new HttpError(502, 'Der Dateiname des Plugins ist ungültig.');
    if (!row.awaitingUpload && row.prepared) await this.backupNow(row.world, 'before-plugin');
    if (replacing && replacing.file !== file.name) await this.runner.removePlugin(row.world, replacing.file).catch(() => undefined);
    await this.runner.installPlugin(row.world, file);
    this.hs.putPlugin(row.world, {
      project: chosen.project,
      slug: chosen.slug,
      title: chosen.title,
      icon: chosen.icon,
      versionId: chosen.versionId,
      versionNumber: chosen.versionNumber,
      file: file.name,
      sha512: file.sha512,
      installedAt: Date.now(),
    });
    const state = this.hs.get(row.world)?.state;
    if (state === 'running' || state === 'starting') this.hs.update(row.world, { restartNeeded: true });
  }

  /** `POST …/plugins { project, version? }` (Besitzer) */
  async installPlugin(user: UserRow, id: string | undefined, input: Record<string, unknown>) {
    const { row } = this.find(user, id, 'owner');
    this.requirePaper(row);
    const { project } = input;
    if (typeof project !== 'string' || !PROJECT_RE.test(project)) throw new HttpError(400, '„project“ muss die ID oder der Slug eines Plugins bei Modrinth sein.');
    if (input.version !== undefined && (typeof input.version !== 'string' || !PROJECT_RE.test(input.version))) throw new HttpError(400, 'Ungültige Versions-ID.');
    const chosen = await this.options.modrinth.choose(project, row.jar.version, input.version as string | undefined);
    if (this.hs.plugin(row.world, chosen.project)) throw new HttpError(409, `„${chosen.title}“ ist schon installiert. Zum Aktualisieren „Aktualisieren“ nehmen.`);
    if (this.hs.countPlugins(row.world) >= row.maxPlugins) throw new HttpError(409, `Eine Welt hat höchstens ${row.maxPlugins} Plugins.`, {}, 'plugin-limit');
    await this.requireDisk(row);
    await this.withLock(row.world, () => this.putPlugin(this.hs.get(row.world)!, chosen, null));
    const plugin = this.hs.plugin(row.world, chosen.project)!;
    this.broadcast(row.world);
    return { plugin: this.pluginView(plugin), restartNeeded: this.hs.get(row.world)!.restartNeeded, notice: PLUGIN_NOTICE };
  }

  /** `POST …/plugins/<project>/update` (Besitzer) */
  async updatePlugin(user: UserRow, id: string | undefined, project: string | undefined) {
    const { row } = this.find(user, id, 'owner');
    this.requirePaper(row);
    const plugin = project !== undefined ? this.hs.plugin(row.world, project) : undefined;
    if (!plugin) throw new HttpError(404, 'Dieses Plugin ist in der Welt nicht installiert.');
    const chosen = await this.options.modrinth.choose(plugin.project, row.jar.version);
    if (chosen.versionId === plugin.versionId) return { updated: false, plugin: this.pluginView(plugin), restartNeeded: row.restartNeeded };
    await this.withLock(row.world, () => this.putPlugin(this.hs.get(row.world)!, chosen, plugin));
    this.broadcast(row.world);
    return { updated: true, plugin: this.pluginView(this.hs.plugin(row.world, plugin.project)!), restartNeeded: this.hs.get(row.world)!.restartNeeded };
  }

  /** `DELETE …/plugins/<project>` (Besitzer) */
  async removePlugin(user: UserRow, id: string | undefined, project: string | undefined) {
    const { row } = this.find(user, id, 'owner');
    const plugin = project !== undefined ? this.hs.plugin(row.world, project) : undefined;
    if (!plugin) throw new HttpError(404, 'Dieses Plugin ist in der Welt nicht installiert.');
    await this.withLock(row.world, async () => {
      if (!row.awaitingUpload && row.prepared) await this.backupNow(row.world, 'before-plugin');
      await this.runner.removePlugin(row.world, plugin.file);
      this.hs.deletePlugin(row.world, plugin.project);
      const state = this.hs.get(row.world)?.state;
      if (state === 'running' || state === 'starting') this.hs.update(row.world, { restartNeeded: true });
    });
    this.broadcast(row.world);
    return { ok: true, restartNeeded: this.hs.get(row.world)!.restartNeeded };
  }

  // ---------- Plugin-Konfiguration ----------

  /** `GET …/files` (Liste) bzw. `GET …/files?path=` (Inhalt), Besitzer und Operatoren */
  async files(user: UserRow, id: string | undefined, rawPath: string | null) {
    const { row } = this.find(user, id, 'operator');
    if (!row.prepared) return rawPath === null ? { files: [] } : Promise.reject(new HttpError(404, 'Diese Datei gibt es nicht.'));
    if (rawPath === null) return { files: (await this.runner.listFiles(row.world)).filter((f) => !f.split('/').includes('..')).sort() };
    const filePath = checkPluginPath(rawPath);
    try {
      return { path: filePath, content: await this.runner.readFile(row.world, filePath) };
    } catch (err) {
      throw new HttpError(404, `Diese Datei gibt es nicht (${message(err)}).`);
    }
  }

  /** `PUT …/files?path= { content }` (Besitzer); wirkt nach einem Neustart (oder Neuladen im Plugin). */
  async writeFile(user: UserRow, id: string | undefined, rawPath: string | null, input: Record<string, unknown>) {
    const { row } = this.find(user, id, 'owner');
    const filePath = checkPluginPath(rawPath);
    if (typeof input.content !== 'string') throw new HttpError(400, '„content“ muss ein Text sein.');
    if (Buffer.byteLength(input.content) > FILE_MAX_BYTES) throw new HttpError(413, `Die Datei ist zu groß (höchstens ${FILE_MAX_BYTES / 1024} KB).`);
    if (input.content.includes('\u0000')) throw new HttpError(400, 'Die Datei enthält ungültige Zeichen.');
    if (!row.prepared) throw new HttpError(409, TEXT_CREATING);
    await this.withLock(row.world, () => this.runner.writeFile(row.world, filePath, input.content as string));
    if (row.state === 'running' || row.state === 'starting') this.hs.update(row.world, { restartNeeded: true });
    return { ok: true, path: filePath, restartNeeded: this.hs.get(row.world)!.restartNeeded };
  }

  // ---------- Sicherungen (Endpunkte) ----------

  /** `GET …/backups` (Besitzer) */
  async backups(user: UserRow, id: string | undefined) {
    const { row } = this.find(user, id, 'owner');
    const list = row.prepared ? await this.runner.listBackups(row.world) : [];
    return {
      backups: list.sort((a, b) => b.createdAt - a.createdAt).map((b) => this.backupView(b)),
      keepDaily: this.options.keepDaily,
      maxManual: MANUAL_BACKUPS,
    };
  }

  /** `POST …/backups` (Besitzer): Sicherung von Hand */
  async createBackup(user: UserRow, id: string | undefined) {
    const { row } = this.find(user, id, 'owner');
    if (!row.prepared || row.awaitingUpload || row.state === 'creating') throw new HttpError(409, 'Die Welt ist noch nicht eingerichtet.');
    const existing = await this.runner.listBackups(row.world);
    if (existing.filter((b) => backupKind(b.name) === 'manual').length >= MANUAL_BACKUPS) {
      throw new HttpError(409, `Höchstens ${MANUAL_BACKUPS} Sicherungen von Hand. Lösch zuerst eine.`, {}, 'backup-limit');
    }
    await this.requireDisk(row);
    const info = await this.withLock(row.world, () => this.backupNow(row.world, 'manual'));
    return { backup: this.backupView(info) };
  }

  private backupName(raw: string | undefined): string {
    if (raw === undefined || !BACKUP_NAME_RE.test(raw)) throw new HttpError(404, 'Diese Sicherung gibt es nicht.');
    return raw;
  }

  /** `POST …/backups/<name>/restore` (Besitzer, nur wenn sie schläft) */
  async restoreBackup(user: UserRow, id: string | undefined, raw: string | undefined) {
    const { row, world } = this.find(user, id, 'owner');
    const name = this.backupName(raw);
    await this.withLock(row.world, async () => {
      const current = this.hs.get(row.world)!;
      if (current.state !== 'sleeping' && current.state !== 'error') throw new HttpError(409, 'Wiederherstellen geht nur, wenn die Welt schläft.', {}, 'not-sleeping');
      const list = await this.runner.listBackups(row.world);
      if (!list.some((b) => b.name === name)) throw new HttpError(404, 'Diese Sicherung gibt es nicht.');
      await this.backupNow(row.world, 'before-restore');
      await this.runner.restoreBackup(row.world, name);
      if (!this.hs.restoreSnapshot(row.world, name)) {
        // Kein gemerkter Stand: nur Plugins behalten, deren Datei es nach dem Wiederherstellen gibt.
        const files = new Set(await this.runner.listPlugins(row.world).catch(() => [] as string[]));
        for (const plugin of this.hs.plugins(row.world)) if (!files.has(plugin.file)) this.hs.deletePlugin(row.world, plugin.project);
      }
    });
    if (this.hs.get(row.world)?.state === 'error') this.setState(row.world, 'sleeping');
    else this.broadcast(row.world);
    return { ok: true, world: this.view(this.hs.get(row.world)!, world, 'owner') };
  }

  /** `DELETE …/backups/<name>` (Besitzer) */
  async deleteBackup(user: UserRow, id: string | undefined, raw: string | undefined) {
    const { row } = this.find(user, id, 'owner');
    const name = this.backupName(raw);
    await this.withLock(row.world, async () => {
      const list = await this.runner.listBackups(row.world);
      if (!list.some((b) => b.name === name)) throw new HttpError(404, 'Diese Sicherung gibt es nicht.');
      await this.runner.deleteBackup(row.world, name);
      this.hs.deleteSnapshot(row.world, name);
    });
    this.liveOf(row.world).statsAt = 0;
    return { ok: true };
  }

  /** Übrig gebliebene Downloads (z. B. nach einem Abbruch) nach einer Stunde löschen. */
  async sweepDownloads(now = Date.now()): Promise<void> {
    const dir = path.join(this.options.dataDir, 'downloads');
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      const stat = await fs.lstat(file).catch(() => null);
      if (stat && now - stat.mtimeMs > 60 * 60_000) await fs.rm(file, { recursive: true, force: true });
    }
  }

  private tempZip(): string {
    return path.join(this.options.dataDir, 'downloads', `${randomBytes(12).toString('hex')}.zip`);
  }

  /** `GET …/backups/<name>/download` (Besitzer): Datei bereitstellen; der Aufrufer sendet und löscht sie. */
  async backupFile(user: UserRow, id: string | undefined, raw: string | undefined): Promise<{ file: string; name: string }> {
    const { row, world } = this.find(user, id, 'owner');
    const name = this.backupName(raw);
    const file = this.tempZip();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await this.withLock(row.world, async () => {
      const list = await this.runner.listBackups(row.world);
      if (!list.some((b) => b.name === name)) throw new HttpError(404, 'Diese Sicherung gibt es nicht.');
      await this.runner.exportBackup(row.world, name, file);
    });
    return { file, name: `${world.name}-${name}.zip` };
  }

  /** `GET …/download` (Besitzer): Welt im Einzelspieler-Format als ZIP bereitstellen. */
  async worldFile(user: UserRow, id: string | undefined): Promise<{ file: string; name: string }> {
    const { row, world } = this.find(user, id, 'owner');
    if (row.awaitingUpload || !row.prepared) throw new HttpError(409, 'Für diese Welt gibt es noch nichts herunterzuladen.');
    const file = this.tempZip();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await this.withLock(row.world, async () => {
      const running = await this.saveAll(row.world).catch(() => false);
      try {
        await this.runner.exportWorld(row.world, file);
      } finally {
        if (running) await this.runner.command(row.world, 'save-on').catch(() => undefined);
      }
    });
    return { file, name: `${world.name}.zip` };
  }

  // ---------- Upload ----------

  private requireUploadable(row: HostedRow): void {
    if (row.state !== 'creating' && row.state !== 'sleeping' && row.state !== 'error') {
      throw new HttpError(409, 'Zum Hochladen muss die Welt schlafen.', {}, 'not-sleeping');
    }
  }

  /** `POST …/upload { size }` (Besitzer) */
  async uploadStart(user: UserRow, id: string | undefined, input: Record<string, unknown>): Promise<UploadView> {
    const { row } = this.find(user, id, 'owner');
    this.requireUploadable(row);
    return this.options.uploads.start(row.world, user.uuid, input.size);
  }

  /** `PUT …/upload/<n>` (Besitzer): ein Teil als roher Körper */
  async uploadChunk(user: UserRow, id: string | undefined, index: string | undefined, req: IncomingMessage): Promise<UploadView> {
    const { row } = this.find(user, id, 'owner');
    return this.options.uploads.chunk(row.world, user.uuid, index, req);
  }

  /** `DELETE …/upload` (Besitzer) */
  async uploadCancel(user: UserRow, id: string | undefined): Promise<{ ok: true }> {
    const { row } = this.find(user, id, 'owner');
    await this.options.uploads.cancel(row.world);
    return { ok: true };
  }

  /** `POST …/upload/finish { sha256 }` (Besitzer): prüfen, sicher übernehmen, danach schläft die Welt. */
  async uploadFinish(user: UserRow, id: string | undefined, input: Record<string, unknown>): Promise<HostedWorldView> {
    const { row, world } = this.find(user, id, 'owner');
    this.requireUploadable(row);
    const session = await this.options.uploads.finish(row.world, user.uuid, input.sha256);
    let keepUpload = false;
    try {
      const info = await inspectWorldZip(session.file, { ...WORLD_ZIP_LIMITS, maxTotalBytes: row.diskMb * MIB });
      await this.withLock(row.world, async () => {
        const current = this.hs.get(row.world);
        if (!current) throw new HttpError(404, HOSTED_GONE);
        if (current.state !== 'creating' && current.state !== 'sleeping' && current.state !== 'error') {
          keepUpload = true;
          throw new HttpError(409, 'Zum Hochladen muss die Welt schlafen.', {}, 'not-sleeping');
        }
        if (!current.awaitingUpload && current.prepared) await this.backupNow(row.world, 'before-import');
        this.setState(row.world, 'creating');
        try {
          const icon = worldIcon(info.icon);
          this.hs.update(row.world, { icon });
          await this.prepare(row.world);
          await this.runner.importWorld(row.world, session.file);
          this.hs.update(row.world, { awaitingUpload: false });
          this.setState(row.world, 'sleeping');
        } catch (err) {
          // Neue Welt wartet weiter auf einen Upload; eine bestehende bleibt, wie sie war (Sicherung „vor-import“).
          const after = this.hs.get(row.world);
          if (after) this.setState(row.world, after.awaitingUpload ? 'creating' : 'sleeping', `Übernehmen fehlgeschlagen: ${message(err)}`);
          throw err;
        }
      });
    } catch (err) {
      if (err instanceof ZipRejected) throw new HttpError(400, err.message, {}, 'zip-rejected');
      throw err;
    } finally {
      if (keepUpload) this.options.uploads.release(row.world);
      else await this.options.uploads.done(row.world);
    }
    return this.view(this.hs.get(row.world)!, world, 'owner');
  }

  // ---------- Echtzeit ----------

  private subscribe(client: ClientHandle, msg: Record<string, unknown>): void {
    const id = typeof msg.world === 'string' && HOSTED_WORLD_ID_RE.test(msg.world) ? msg.world : null;
    const user = this.store.getUser(client.uuid);
    const row = id ? this.hs.get(id) : undefined;
    const world = row ? this.store.getWorld(row.world) : undefined;
    if (!id || !user || !row || !world || this.roleFor(user, world) === null) {
      client.send({ type: 'hosting-error', world: id, error: HOSTED_GONE });
      return;
    }
    if (!client.subscribe(topicOf(id))) {
      client.send({ type: 'hosting-error', world: id, error: 'Zu viele Abos auf dieser Verbindung.' });
      return;
    }
    client.send({ type: 'hosting-subscribed', world: id, state: row.state });
  }

  /** Freischaltung entzogen oder aus dem Team: laufende Welten des Besitzers anhalten, wenn er nicht mehr darf. */
  accessChanged(uuid: string): void {
    if (this.options.grants.allowed(uuid)) return;
    for (const row of this.hs.ofOwner(uuid)) {
      if (row.state === 'running' || row.state === 'starting') void this.stopInternal(row.world, 'access').catch(() => undefined);
    }
  }

  // ---------- Team ----------

  /** `GET /v1/team/hosting`: alle dauerhaften Welten mit RAM/CPU/Speicher und die Plätze. */
  async teamOverview() {
    this.requireOn();
    const rows = this.hs.all();
    await Promise.all(rows.map((row) => this.refreshStats(row.world, 10_000)));
    return {
      slots: { max: this.options.maxRunning, used: this.active.size },
      memory: { totalMb: Math.round(os.totalmem() / MIB), freeMb: Math.round(os.freemem() / MIB) },
      defaults: { memoryMb: this.options.memoryMb, diskMb: this.options.diskMb, maxPlugins: this.options.maxPlugins, sleepAfterMin: this.options.sleepDefaultMin },
      worlds: rows.flatMap((row) => {
        const world = this.store.getWorld(row.world);
        if (!world) return [];
        const live = this.live.get(row.world);
        return [{ ...this.view(this.hs.get(row.world) ?? row, world, 'owner'), cpuPercent: live?.stats?.cpuPercent ?? 0 }];
      }),
    };
  }

  private teamRow(id: string | undefined): HostedWithOwner {
    this.requireOn();
    const row = id !== undefined && HOSTED_WORLD_ID_RE.test(id) ? this.hs.get(id) : undefined;
    if (!row) throw new HttpError(404, HOSTED_GONE);
    return row;
  }

  /** `POST /v1/team/hosting/worlds/<id>/stop` */
  teamStop(actor: Actor, id: string | undefined) {
    const row = this.teamRow(id);
    const world = this.store.getWorld(row.world)!;
    writeAudit(this.store, actor, 'hosting.stop', `${world.name} (${world.code})`, playerLabel(this.store.getUser(row.owner)?.name ?? '', row.owner));
    void this.stopInternal(row.world, 'team').catch((err) => this.options.log(`Dauerhafte Welten: Anhalten fehlgeschlagen (${message(err)}).`));
    return { ok: true };
  }

  /** `PATCH /v1/team/hosting/worlds/<id> { memoryMb?, diskMb?, maxPlugins?, sleepAfterMin? (0 = nie) }` */
  teamPatch(actor: Actor, id: string | undefined, input: Record<string, unknown>) {
    const row = this.teamRow(id);
    const int = (key: string, min: number, max: number): number | undefined => {
      if (!Object.hasOwn(input, key)) return undefined;
      const value = input[key];
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new HttpError(400, `„${key}“ muss eine ganze Zahl von ${min} bis ${max} sein.`);
      return value;
    };
    const memoryMb = int('memoryMb', 1024, 16_384);
    const diskMb = int('diskMb', 1024, 65_536);
    const maxPlugins = int('maxPlugins', 0, 100);
    const sleepAfterMin = int('sleepAfterMin', 0, 24 * 60);
    this.hs.update(row.world, {
      memoryMb,
      diskMb,
      maxPlugins,
      sleepAfterMin,
      // Mehr oder weniger RAM braucht ein neues Vorbereiten beim nächsten Start.
      ...(memoryMb !== undefined && memoryMb !== row.memoryMb ? { prepared: false, restartNeeded: row.state === 'running' } : {}),
    });
    const world = this.store.getWorld(row.world)!;
    const changes = Object.entries({ memoryMb, diskMb, maxPlugins, sleepAfterMin })
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    writeAudit(this.store, actor, 'hosting.limits', `${world.name} (${world.code})`, changes || null);
    this.broadcast(row.world);
    return this.view(this.hs.get(row.world)!, world, 'owner');
  }
}

/** Datenauskunft: eigene dauerhafte Welten mit Plugins und die Freischaltungen (geht auch, wenn Hosting gerade aus ist). */
export function exportHosting(hs: HostingStore, user: UserRow) {
  return {
    worlds: hs.ofOwner(user.uuid).map((row) => ({
      id: row.world,
      state: row.state,
      software: row.jar.software,
      version: row.jar.version,
      paperBuild: row.jar.build,
      memoryMb: row.memoryMb,
      diskMb: row.diskMb,
      sleepAfterMin: row.sleepAfterMin,
      properties: row.properties,
      createdAt: row.createdAt,
      lastStartedAt: row.lastStartedAt,
      lastActiveAt: row.lastActiveAt,
      plugins: hs.plugins(row.world).map((p) => ({ project: p.project, title: p.title, version: p.versionNumber, file: p.file, installedAt: p.installedAt })),
    })),
    grants: hs.grantsOf(user.uuid).map((g) => ({ source: g.source, grantedAt: g.grantedAt, expiresAt: g.expiresAt, seenAt: g.seenAt })),
  };
}
