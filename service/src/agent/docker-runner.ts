// Welten-Wächter: betreibt die Server der dauerhaften Welten mit Docker – eine Welt, ein Container
// (heldix-welt-<id>). Implementiert HostingRunner; der Socket-Server (server.ts) reicht die Anfragen des Dienstes
// hierher durch.
//
// Ordner (dataDir, Standard /var/lib/heldix-welten; alles gehört root außer data/ je Welt):
//   jars/                       Server-Jars (paper-<sha256>.jar, vanilla-<sha1>.jar), in jedem Container nur lesbar (/jars)
//   tmp/                        Downloads und Zwischendateien des Wächters
//   worlds/<id>/world.json      Einstellungen der Welt (Jar, RAM, erlaubte server.properties, MOTD)
//   worlds/<id>/icon.png        Symbol für die Serverliste
//   worlds/<id>/data/           Datenordner (1000:1000, 0700) → /data im Container: world/, plugins/, server.properties …
//   worlds/<id>/plugin-store/   geprüfte Plugin-Jars + plugins.json; nur diese liegen beim Start in data/plugins
//   worlds/<id>/pending/        Änderungen an Plugin-Dateien, solange die Welt läuft (übernommen nach dem Anhalten)
//   worlds/<id>/backups/        Sicherungen (<name>.zip), im Container nicht sichtbar
//
// Konsole: Der Container läuft mit offenem stdin (--interactive, ohne TTY). Je laufender Welt hält der Wächter einen
// `docker attach --sig-proxy=false`-Prozess: Zeilen an dessen stdin landen in der Server-Konsole, stdout/stderr sind
// das Live-Log. Endet der Wächter, läuft die Welt weiter; der neue Wächter hängt sich wieder an.
//
// In den Datenordner schreibt der Wächter nur, solange der Container nicht läuft (siehe files.ts).
import type { ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import fsp, { type FileHandle } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {
  HOSTED_WORLD_ID_RE,
  type BackupInfo,
  type HostingRunner,
  type PluginFile,
  type PrepareOptions,
  type RunnerState,
  type RunnerStats,
  type ServerJar,
} from '../hosting/runner';
import {
  checkBackupName,
  checkConsoleLine,
  checkInt,
  checkModrinthUrl,
  checkMotd,
  checkPluginFile,
  checkPluginFilePath,
  checkPluginName,
  checkPrepare,
  checkProperties,
  checkSha,
  checkTextContent,
  checkUploadPath,
  checkWorld,
  MAX_PLUGINS,
  MAX_TEXT_FILE_BYTES,
} from './checks';
import { checkConfig, type AgentConfig } from './config';
import { containerName, CONTAINER_PREFIX, Docker, DockerFailure, LABEL_WORLD, networkCreateArgs, NETWORK_NAME, runArgs } from './docker';
import { downloadVerified } from './download';
import { AgentError, isErrnoCode } from './errors';
import {
  copyAtomic,
  ensureDir,
  FLAGS,
  hashFile,
  isInside,
  lstatOrNull,
  O_NOFOLLOW as FLAGS_NOFOLLOW,
  openInside,
  openVerified,
  readInside,
  readChunks,
  readJsonOrNull,
  walkFiles,
  writeAllAt,
  writeAtomic,
} from './files';
import { WORLD_IMAGE } from './image';
import { disableConnectionThrottle, formatProperties, mergeProperties, parseProperties } from './properties';
import { PROTOCOL_VERSION, type HelloResult } from './protocol';
import { ZipReader, ZipWriter, type ZipItem, type ZipLimits } from './zipio';

const { O_RDONLY, O_WRONLY, O_CREAT, O_EXCL } = FLAGS;

const WORLDS = 'worlds';
const JARS = 'jars';
const TMP = 'tmp';
const DATA = 'data';
const WORLD_FILE = 'world.json';
const ICON = 'icon.png';
const STORE = 'plugin-store';
const STORE_INDEX = 'plugins.json';
const PENDING = 'pending';
const PENDING_INDEX = 'pending.json';
const BACKUPS = 'backups';
const MANIFEST_ENTRY = '.heldix/plugins.json';

/** Legen Paper bzw. der Mojang-Bundler beim Start selbst an (Bibliotheken, gepatchte Jar): nicht in Sicherungen, nicht im Speicher gezählt */
const SERVER_FILES = new Set(['libraries', 'versions', 'cache']);
const NOT_IN_BACKUP = new Set([...SERVER_FILES, 'logs', 'crash-reports', 'debug', '.heldix']);
const KEEP_ON_RESTORE = new Set([...SERVER_FILES, 'logs']);
const RUNNING_STATES = new Set(['running', 'restarting', 'paused']);

const READY_RE = /\bDone \(\d+(?:[.,]\d+)?s\)!/;
const SAVED_RE = /Saved the (game|world)/i;
const LOG_DAYS = 7;
const MAX_LOG_LINE = 4096;
const MAX_JAR_BYTES = 256 * 1024 * 1024;
const MAX_PLUGIN_BYTES = 100 * 1024 * 1024;

const EULA_TEXT =
  '# Der Betreiber des Heldix-Dienstes hat der Minecraft-EULA zugestimmt (Installer mit --accept-minecraft-eula):\n' +
  '# https://aka.ms/MinecraftEULA\neula=true\n';
const EULA_MISSING =
  'Der Betreiber hat der Minecraft-EULA nicht zugestimmt – ohne das laufen keine dauerhaften Welten ' +
  '(Installer mit --accept-minecraft-eula, EULA: https://aka.ms/MinecraftEULA).';

interface WorldConfig {
  version: 1;
  jar: { file: string; software: 'paper' | 'vanilla'; version: string; build: number | null };
  memoryMb: number;
  properties: Record<string, string>;
  motd: string;
  createdAt: number;
  updatedAt: number;
}

interface StoredPlugin {
  name: string;
  url: string;
  sha512: string;
  installedAt: number;
}

interface LiveWorld {
  attach: ChildProcess | null;
  ready: boolean;
  stopping: boolean;
  waiters: Set<{ pattern: RegExp; resolve: () => void }>;
  failures: number;
  reattach: NodeJS.Timeout | null;
  recovered: Promise<void>;
}

/** Entfernt ANSI-Farben und Steuerzeichen, kürzt sehr lange Zeilen. */
export function cleanLogLine(raw: string): string {
  return raw
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .slice(0, MAX_LOG_LINE);
}

/** Zeilen aus einem Prozess-Strom; zu lange Zeilen werden gekürzt statt den Speicher zu füllen. */
class LogSplitter {
  private rest = '';
  private skipping = false;

  push(chunk: Buffer): string[] {
    const text = this.rest + chunk.toString('utf8');
    const parts = text.split('\n');
    this.rest = parts.pop() ?? '';
    const lines: string[] = [];
    for (const part of parts) {
      if (this.skipping) {
        this.skipping = false;
        continue;
      }
      lines.push(part.endsWith('\r') ? part.slice(0, -1) : part);
    }
    if (this.rest.length > MAX_LOG_LINE * 4) {
      if (!this.skipping) lines.push(this.rest.slice(0, MAX_LOG_LINE));
      this.rest = '';
      this.skipping = true;
    }
    return lines;
  }

  flush(): string[] {
    const rest = this.rest;
    this.rest = '';
    return rest === '' || this.skipping ? [] : [rest];
  }
}

/** Höchstens `size` Aufgaben gleichzeitig; ein frei werdender Platz geht direkt an die nächste. */
class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly size: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active < this.size) this.active += 1;
    else await new Promise<void>((resolve) => this.queue.push(resolve));
    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRoot(): boolean {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1e3,
  kib: 1024,
  mb: 1e6,
  mib: 1024 ** 2,
  gb: 1e9,
  gib: 1024 ** 3,
  tb: 1e12,
  tib: 1024 ** 4,
};

/** „812.5MiB“ → Bytes (Ausgabe von docker stats). */
export function parseDockerSize(text: string): number {
  const match = /^([\d.]+)\s*([kmgt]?i?b)$/i.exec(text.trim());
  if (!match) return 0;
  return Number.parseFloat(match[1]!) * (SIZE_UNITS[match[2]!.toLowerCase()] ?? 0);
}

/**
 * Wurzel der Welt im ZIP: level.dat ganz oben, sonst in genau einem Ordner (z. B. „Meine Welt/level.dat“ – dann ist
 * dieser Ordner die Welt). Mehrere Ordner mit level.dat oder keiner: Fehler.
 */
export function worldPrefix(entries: ZipItem[]): string {
  if (entries.some((e) => e.name === 'level.dat')) return '';
  const candidates = entries.filter((e) => /^[^/]+\/level\.dat$/.test(e.name) && !e.name.startsWith('__MACOSX/'));
  if (candidates.length === 1) return candidates[0]!.name.slice(0, -'level.dat'.length);
  if (candidates.length > 1) {
    throw new AgentError('Im ZIP liegen mehrere Welten (mehrere Ordner mit level.dat) – bitte nur eine Welt hochladen.', 'invalid');
  }
  throw new AgentError('Im ZIP fehlt level.dat (ganz oben oder in einem Ordner) – ist das eine Minecraft-Welt?', 'invalid');
}

export class DockerRunner implements HostingRunner {
  readonly docker: Docker;
  private dataReal = '';
  private readonly live = new Map<string, LiveWorld>();
  private readonly subscribers = new Map<string, Set<(line: string) => void>>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly jarJobs = new Map<string, Promise<string>>();
  /** Entpacken, Packen, Sichern: höchstens zwei gleichzeitig (Platte) */
  private readonly heavy = new Semaphore(2);
  /** Starten nacheinander, damit die Zahl der Plätze stimmt */
  private readonly startGate = new Semaphore(1);
  private networkReady = false;
  private closed = false;
  /** Welten, deren Start gerade läuft (Dateien vorbereiten, docker run): state() meldet dann „starting“ */
  private readonly starting = new Set<string>();

  constructor(
    readonly config: AgentConfig,
    readonly version = 'dev',
  ) {
    checkConfig(config);
    this.docker = new Docker(config.docker);
  }

  private log(line: string): void {
    if (this.config.log) this.config.log(line);
    else console.log(`[welten] ${line}`);
  }

  private get userAgent(): string {
    return `heldix-welten-agent/${this.version}`;
  }

  private get worldsDir(): string {
    return path.join(this.dataReal, WORLDS);
  }

  private get jarsDir(): string {
    return path.join(this.dataReal, JARS);
  }

  private get tmpDir(): string {
    return path.join(this.dataReal, TMP);
  }

  private worldDir(id: string): string {
    return path.join(this.worldsDir, id);
  }

  private dataDir(id: string): string {
    return path.join(this.worldDir(id), DATA);
  }

  private get importLimits(): ZipLimits {
    return {
      maxEntries: 250_000,
      maxTotalBytes: this.config.diskLimitBytes,
      maxEntryBytes: this.config.diskLimitBytes,
      ...this.config.importLimits,
    };
  }

  // ------------------------------------------------------------------------------------------
  // Start und Ende des Wächters
  // ------------------------------------------------------------------------------------------

  async init(): Promise<void> {
    await fsp.mkdir(this.config.dataDir, { recursive: true, mode: 0o711 });
    this.dataReal = await fsp.realpath(this.config.dataDir);
    await fsp.chmod(this.dataReal, 0o711);
    await ensureDir(this.dataReal, WORLDS, null, 0o700);
    await ensureDir(this.dataReal, JARS, null, 0o755);
    await ensureDir(this.dataReal, TMP, null, 0o700);
    for (const name of await fsp.readdir(this.tmpDir)) await fsp.rm(path.join(this.tmpDir, name), { recursive: true, force: true });
    try {
      await this.ensureNetwork();
      void this.ensureImage();
      for (const id of (await this.containers(false)).keys()) this.recover(id);
    } catch (err) {
      this.log(`Docker beim Start nicht erreichbar: ${message(err)} – neuer Versuch bei der nächsten Anfrage.`);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const id of [...this.live.keys()]) this.dropLive(id);
  }

  hello(): HelloResult {
    return { protocol: PROTOCOL_VERSION, version: this.version, maxRunning: this.config.maxRunning, eula: this.config.acceptEula, image: WORLD_IMAGE };
  }

  private async ensureNetwork(): Promise<void> {
    if (this.networkReady) return;
    try {
      await this.docker.run(['network', 'inspect', '--format', '{{.Name}}', NETWORK_NAME], 30_000);
    } catch (err) {
      // Docker meldet ein fehlendes Netz je nach Version verschieden („No such network“, „network … not found“)
      if (!(err instanceof DockerFailure) || err.message.startsWith('Docker läuft nicht') || err.message.startsWith('Docker ist nicht')) throw err;
      try {
        await this.docker.run(networkCreateArgs(), 60_000);
        this.log(`Docker-Netz ${NETWORK_NAME} angelegt`);
      } catch (createError) {
        if (!(createError instanceof DockerFailure && /already exists/i.test(createError.stderr))) throw createError;
      }
    }
    this.networkReady = true;
  }

  private async ensureImage(): Promise<void> {
    try {
      await this.docker.run(['image', 'inspect', '--format', '{{.Id}}', WORLD_IMAGE], 30_000);
    } catch (err) {
      if (!(err instanceof DockerFailure && err.notFound)) return;
      this.log(`Image ${WORLD_IMAGE} fehlt – lade es …`);
      try {
        await this.docker.run(['pull', WORLD_IMAGE], 30 * 60_000);
        this.log('Image geladen');
      } catch (pullError) {
        this.log(`Image ließ sich nicht laden: ${message(pullError)}`);
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // Hilfen: Sperren, Docker-Zustand, Ordner
  // ------------------------------------------------------------------------------------------

  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => (release = resolve));
    const chain = previous.then(() => current);
    this.locks.set(id, chain);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(id) === chain) this.locks.delete(id);
    }
  }

  private requireEula(): void {
    if (!this.config.acceptEula) throw new AgentError(EULA_MISSING, 'eula');
  }

  private async inspect(id: string): Promise<{ status: string; port: number | null } | null> {
    try {
      const { stdout } = await this.docker.run(['inspect', '--type', 'container', '--format', '{{.State.Status}}|{{.Config.Labels}}', containerName(id)], 30_000);
      const [status = '', labels = ''] = stdout.trim().split('|');
      if (/heldix\.world:([0-9a-f]{32})/.exec(labels)?.[1] !== id) {
        throw new AgentError(`Ein fremder Container heißt ${containerName(id)} – bitte von Hand prüfen.`, 'docker');
      }
      const port = /heldix\.port:(\d+)/.exec(labels)?.[1];
      return { status, port: port === undefined ? null : Number(port) };
    } catch (err) {
      if (err instanceof DockerFailure && err.notFound) return null;
      throw err;
    }
  }

  private async isRunning(id: string): Promise<boolean> {
    const info = await this.inspect(id);
    return info !== null && RUNNING_STATES.has(info.status);
  }

  private async requireStopped(id: string): Promise<void> {
    if (await this.isRunning(id)) throw new AgentError('Die Welt läuft gerade – erst anhalten.', 'running');
  }

  /** Welten-Container: laufende (all = false) bzw. alle, mit Port aus dem Label. */
  private async containers(all: boolean): Promise<Map<string, number | null>> {
    const { stdout } = await this.docker.run(
      ['ps', ...(all ? ['--all'] : []), '--filter', `label=${LABEL_WORLD}`, '--format', '{{.Names}}|{{.Labels}}'],
      30_000,
    );
    const result = new Map<string, number | null>();
    for (const line of stdout.split('\n')) {
      const [name = '', labels = ''] = line.trim().split('|');
      if (!name.startsWith(CONTAINER_PREFIX)) continue;
      const id = name.slice(CONTAINER_PREFIX.length);
      if (!HOSTED_WORLD_ID_RE.test(id)) continue;
      const port = /(?:^|,)heldix\.port=(\d+)/.exec(labels)?.[1];
      result.set(id, port === undefined ? null : Number(port));
    }
    return result;
  }

  private async removeContainer(id: string): Promise<void> {
    try {
      await this.docker.run(['rm', '--force', containerName(id)], 60_000);
    } catch (err) {
      if (!(err instanceof DockerFailure && err.notFound)) throw err;
    }
  }

  private async worldExists(id: string): Promise<boolean> {
    return (await lstatOrNull(this.dataDir(id)))?.isDirectory() ?? false;
  }

  private async requireWorld(id: string): Promise<void> {
    if (!(await this.worldExists(id))) throw new AgentError('Diese Welt gibt es beim Welten-Wächter nicht.', 'not-found');
  }

  private async ensureWorldDirs(id: string): Promise<string> {
    await ensureDir(this.worldsDir, id, null, 0o700);
    return ensureDir(this.worldDir(id), DATA, this.config.owner, 0o700);
  }

  private async readWorldConfig(id: string): Promise<WorldConfig | null> {
    const cfg = await readJsonOrNull<WorldConfig>(path.join(this.worldDir(id), WORLD_FILE));
    if (cfg === null) return null;
    if (cfg.version !== 1 || !/^(paper|vanilla)-[0-9a-f]{40,64}\.jar$/.test(cfg.jar?.file ?? '') || !Number.isInteger(cfg.memoryMb)) {
      throw new AgentError('world.json der Welt ist beschädigt.', 'internal');
    }
    return cfg;
  }

  private async requireConfig(id: string): Promise<WorldConfig> {
    const cfg = await this.readWorldConfig(id);
    if (!cfg) throw new AgentError('Die Welt ist beim Welten-Wächter noch nicht vorbereitet.', 'not-found');
    return cfg;
  }

  private async writeWorldConfig(id: string, cfg: WorldConfig): Promise<void> {
    await writeAtomic(this.worldDir(id), WORLD_FILE, `${JSON.stringify(cfg, null, 2)}\n`, { owner: null, mode: 0o600 });
  }

  // ------------------------------------------------------------------------------------------
  // Konsole und Log (docker attach)
  // ------------------------------------------------------------------------------------------

  private freshLive(id: string): LiveWorld {
    this.dropLive(id);
    const live: LiveWorld = { attach: null, ready: false, stopping: false, waiters: new Set(), failures: 0, reattach: null, recovered: Promise.resolve() };
    this.live.set(id, live);
    return live;
  }

  private dropLive(id: string): void {
    const live = this.live.get(id);
    if (!live) return;
    this.live.delete(id);
    if (live.reattach) clearTimeout(live.reattach);
    live.attach?.kill();
    live.attach = null;
    live.waiters.clear();
  }

  /** Laufende Welt, die der Wächter (noch) nicht kennt, z. B. nach seinem Neustart: wieder anhängen. */
  private recover(id: string): LiveWorld {
    const existing = this.live.get(id);
    if (existing) {
      if (!existing.attach && !existing.stopping) this.attach(id, existing);
      return existing;
    }
    const live = this.freshLive(id);
    live.recovered = (async () => {
      try {
        const { stdout, stderr } = await this.docker.run(['logs', '--tail', '5000', containerName(id)], 30_000, 64 * 1024 * 1024);
        if (READY_RE.test(stdout) || READY_RE.test(stderr)) live.ready = true;
      } catch {
        // dann eben „startet“, bis die nächste Zeile „Done“ kommt
      }
    })();
    this.attach(id, live);
    return live;
  }

  private attach(id: string, live: LiveWorld): void {
    if (this.closed || live.attach) return;
    let child: ChildProcess;
    try {
      child = this.docker.spawn(['attach', '--sig-proxy=false', containerName(id)], ['pipe', 'pipe', 'pipe']);
    } catch (err) {
      this.log(`Konsole der Welt ${id}: ${message(err)}`);
      return;
    }
    live.attach = child;
    const out = new LogSplitter();
    const err = new LogSplitter();
    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of out.push(chunk)) this.onLine(id, live, line, false);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of err.push(chunk)) this.onLine(id, live, line, true);
    });
    child.stdin?.on('error', () => {});
    child.on('error', (error) => this.log(`Konsole der Welt ${id}: ${error.message}`));
    child.on('close', () => {
      for (const line of out.flush()) this.onLine(id, live, line, false);
      for (const line of err.flush()) this.onLine(id, live, line, true);
      if (live.attach === child) live.attach = null;
      if (this.closed || live.stopping || this.live.get(id) !== live) return;
      this.scheduleReattach(id, live);
    });
  }

  private scheduleReattach(id: string, live: LiveWorld): void {
    if (live.reattach) return;
    live.failures += 1;
    if (live.failures > 5) {
      this.log(`Konsole der Welt ${id} lässt sich nicht verbinden – neuer Versuch beim nächsten Befehl.`);
      return;
    }
    live.reattach = setTimeout(() => {
      live.reattach = null;
      if (this.closed || this.live.get(id) !== live || live.stopping) return;
      this.inspect(id).then(
        (info) => {
          if (this.live.get(id) !== live || live.stopping) return;
          if (info && info.status === 'running') this.attach(id, live);
          else this.dropLive(id);
        },
        () => this.scheduleReattach(id, live),
      );
    }, 1000 * live.failures);
    live.reattach.unref();
  }

  private onLine(id: string, live: LiveWorld, raw: string, fromStderr: boolean): void {
    // Meldungen des Docker-Programms selbst, nicht des Servers
    if (fromStderr && /^(Error response from daemon|You cannot attach|Error: No such container)/.test(raw)) return;
    const line = cleanLogLine(raw);
    live.failures = 0;
    if (!live.ready && READY_RE.test(line)) live.ready = true;
    for (const waiter of [...live.waiters]) {
      if (waiter.pattern.test(line)) {
        live.waiters.delete(waiter);
        waiter.resolve();
      }
    }
    for (const subscriber of [...(this.subscribers.get(id) ?? [])]) {
      try {
        subscriber(line);
      } catch {
        // ein Abonnent stört die anderen nicht
      }
    }
  }

  private async sendLine(id: string, line: string): Promise<void> {
    const live = this.live.get(id) ?? this.recover(id);
    if (!live.attach) {
      live.failures = 0;
      this.attach(id, live);
    }
    const stdin = live.attach?.stdin;
    const unreachable = () => new AgentError('Die Konsole der Welt ist gerade nicht erreichbar.', 'docker');
    if (!stdin || stdin.destroyed || !stdin.writable) throw unreachable();
    await new Promise<void>((resolve, reject) => stdin.write(`${line}\n`, (err) => (err ? reject(unreachable()) : resolve())));
  }

  private waitForLine(id: string, pattern: RegExp, timeoutMs: number): Promise<boolean> {
    const live = this.live.get(id);
    if (!live) return Promise.resolve(false);
    return new Promise((resolve) => {
      const waiter = {
        pattern,
        resolve: () => {
          clearTimeout(timer);
          resolve(true);
        },
      };
      const timer = setTimeout(() => {
        live.waiters.delete(waiter);
        resolve(false);
      }, timeoutMs);
      live.waiters.add(waiter);
    });
  }

  /** true, sobald der Container nicht mehr läuft (false nach timeoutMs). */
  private async waitExit(id: string, timeoutMs: number): Promise<boolean> {
    await new Promise<void>((resolve) => {
      let child: ChildProcess;
      try {
        child = this.docker.spawn(['wait', containerName(id)], ['ignore', 'ignore', 'ignore']);
      } catch {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, timeoutMs);
      child.on('error', () => {
        clearTimeout(timer);
        resolve();
      });
      child.on('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    try {
      return !(await this.isRunning(id));
    } catch {
      return false;
    }
  }

  /**
   * Läuft die Welt, schaltet der Wächter das Speichern kurz ab (`save-off`, `save-all flush`), damit Sicherung bzw.
   * Export einen festen Stand haben, und danach wieder an. `running` sagt fn, ob gerade jemand im Ordner schreibt.
   */
  private async quiesced<T>(id: string, fn: (running: boolean) => Promise<T>): Promise<T> {
    if (!(await this.isRunning(id))) return fn(false);
    this.recover(id);
    try {
      await this.sendLine(id, 'save-off');
      const saved = this.waitForLine(id, SAVED_RE, 120_000);
      await this.sendLine(id, 'save-all flush');
      if (!(await saved)) this.log(`Welt ${id}: „save-all“ ohne Bestätigung – sichere trotzdem.`);
    } catch (err) {
      this.log(`Welt ${id}: Speichern vor der Sicherung nicht möglich (${message(err)}).`);
    }
    try {
      return await fn(true);
    } finally {
      await this.sendLine(id, 'save-on').catch(() => {});
    }
  }

  // ------------------------------------------------------------------------------------------
  // Vorbereiten und Dateien vor dem Start
  // ------------------------------------------------------------------------------------------

  private async ensureJar(jar: ServerJar): Promise<string> {
    const hash = jar.software === 'paper' ? jar.sha256! : jar.sha1!;
    const file = `${jar.software}-${hash}.jar`;
    const target = path.join(this.jarsDir, file);
    const st = await lstatOrNull(target);
    if (st?.isFile() && st.size > 0) {
      const now = new Date();
      await fsp.utimes(target, now, now).catch(() => {});
      return file;
    }
    let job = this.jarJobs.get(file);
    if (!job) {
      job = (async () => {
        const tmp = await downloadVerified({
          url: jar.url,
          fetchUrl: this.config.fetchUrl,
          algorithm: jar.software === 'paper' ? 'sha256' : 'sha1',
          expected: hash,
          maxBytes: MAX_JAR_BYTES,
          timeoutMs: 10 * 60_000,
          tmpDir: this.tmpDir,
          userAgent: this.userAgent,
        });
        await fsp.chmod(tmp, 0o644);
        await fsp.rename(tmp, target);
        this.log(`Server-Jar geladen: ${jar.software} ${jar.version}${jar.build === null ? '' : ` (Build ${jar.build})`}`);
        return file;
      })().finally(() => this.jarJobs.delete(file));
      this.jarJobs.set(file, job);
    }
    return job;
  }

  /** Server-Jars, die keine Welt mehr nutzt und die älter als ein Tag sind, löschen. */
  private async cleanupJars(): Promise<void> {
    try {
      const used = new Set<string>();
      for (const id of await fsp.readdir(this.worldsDir)) {
        if (!HOSTED_WORLD_ID_RE.test(id)) continue;
        const cfg = await this.readWorldConfig(id).catch(() => null);
        if (cfg) used.add(cfg.jar.file);
      }
      const dayAgo = Date.now() - 86_400_000;
      for (const name of await fsp.readdir(this.jarsDir)) {
        if (used.has(name) || this.jarJobs.has(name)) continue;
        const st = await lstatOrNull(path.join(this.jarsDir, name));
        if (st && st.mtimeMs < dayAgo) await fsp.rm(path.join(this.jarsDir, name), { force: true });
      }
    } catch (err) {
      this.log(`Aufräumen der Server-Jars: ${message(err)}`);
    }
  }

  /** server.properties, eula.txt und Symbol schreiben (nur bei gestoppter Welt). */
  private async writeManagedFiles(id: string, cfg: WorldConfig): Promise<void> {
    const data = this.dataDir(id);
    const owner = this.config.owner;
    let existing = new Map<string, string>();
    const propertiesFile = path.join(data, 'server.properties');
    const st = await lstatOrNull(propertiesFile);
    if (st?.isFile() && st.size <= 256 * 1024) existing = parseProperties(await fsp.readFile(propertiesFile, 'utf8'));
    await writeAtomic(data, 'server.properties', formatProperties(mergeProperties(existing, cfg.properties, cfg.motd)), { owner, mode: 0o644 });
    await writeAtomic(data, 'eula.txt', EULA_TEXT, { owner, mode: 0o644 });
    if (cfg.jar.software === 'paper') {
      // Verbindungsdrossel aus: alle Spieler kommen über das Relay von derselben Adresse (siehe properties.ts)
      const bukkitFile = path.join(data, 'bukkit.yml');
      const bukkit = await lstatOrNull(bukkitFile);
      const current = bukkit?.isFile() && bukkit.size <= 256 * 1024 ? await fsp.readFile(bukkitFile, 'utf8') : null;
      const next = disableConnectionThrottle(current);
      if (next !== current) await writeAtomic(data, 'bukkit.yml', next, { owner, mode: 0o644 });
    }
    const icon = await fsp.readFile(path.join(this.worldDir(id), ICON)).catch(() => null);
    if (icon) await writeAtomic(data, 'server-icon.png', icon, { owner, mode: 0o644 });
  }

  private async prepareForStart(id: string, cfg: WorldConfig): Promise<void> {
    await this.ensureWorldDirs(id);
    await this.writeManagedFiles(id, cfg);
    if (cfg.jar.software === 'paper') await this.syncPlugins(id);
    await this.applyPendingFiles(id);
    await this.pruneLogs(id);
  }

  /** In data/plugins liegen danach genau die geprüften Jars (unbekannte *.jar und plugins/update fallen weg). */
  private async syncPlugins(id: string): Promise<void> {
    const plugins = await ensureDir(this.dataDir(id), 'plugins', this.config.owner, 0o755, true);
    const wanted = new Map((await this.readStore(id)).map((plugin) => [plugin.name, plugin]));
    await fsp.rm(path.join(plugins, 'update'), { recursive: true, force: true });
    for (const entry of await fsp.readdir(plugins, { withFileTypes: true })) {
      if (!entry.name.toLowerCase().endsWith('.jar')) continue;
      const plugin = wanted.get(entry.name);
      if (plugin && entry.isFile() && (await hashFile(path.join(plugins, entry.name), 'sha512').catch(() => '')) === plugin.sha512) {
        wanted.delete(entry.name);
        continue;
      }
      await fsp.rm(path.join(plugins, entry.name), { recursive: true, force: true });
    }
    for (const plugin of wanted.values()) {
      await copyAtomic(path.join(this.worldDir(id), STORE, plugin.name), plugins, plugin.name, { owner: this.config.owner, mode: 0o644 });
    }
  }

  /** Logs und Absturzberichte des Servers nach 7 Tagen löschen (Datenschutz: Server-Log 7 Tage). */
  private async pruneLogs(id: string): Promise<void> {
    const limit = Date.now() - LOG_DAYS * 86_400_000;
    for (const dir of ['logs', 'crash-reports']) {
      const full = path.join(this.dataDir(id), dir);
      if (!(await lstatOrNull(full))?.isDirectory()) continue;
      for (const entry of await fsp.readdir(full, { withFileTypes: true })) {
        if (!entry.isFile() || entry.name === 'latest.log') continue;
        const st = await lstatOrNull(path.join(full, entry.name));
        if (st && st.mtimeMs < limit) await fsp.rm(path.join(full, entry.name), { force: true });
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // HostingRunner: Lebenszyklus
  // ------------------------------------------------------------------------------------------

  async prepare(world: string, options: PrepareOptions): Promise<void> {
    const id = checkWorld(world);
    const opts = checkPrepare(options);
    this.requireEula();
    await this.withLock(id, async () => {
      await this.ensureWorldDirs(id);
      const file = await this.ensureJar(opts.jar);
      const old = await this.readWorldConfig(id).catch(() => null);
      const now = Date.now();
      const cfg: WorldConfig = {
        version: 1,
        jar: { file, software: opts.jar.software, version: opts.jar.version, build: opts.jar.build },
        memoryMb: opts.memoryMb,
        properties: opts.properties,
        motd: opts.motd,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
      };
      await this.writeWorldConfig(id, cfg);
      if (opts.iconPng) await writeAtomic(this.worldDir(id), ICON, opts.iconPng, { owner: null, mode: 0o600 });
      if (!(await this.isRunning(id))) await this.writeManagedFiles(id, cfg);
    });
    void this.cleanupJars();
  }

  async start(world: string): Promise<{ port: number }> {
    const id = checkWorld(world);
    return this.withLock(id, async () => {
      const cfg = await this.requireConfig(id);
      this.requireEula();
      const info = await this.inspect(id);
      if (info && RUNNING_STATES.has(info.status)) {
        if (info.port === null) throw new AgentError('Der Container der Welt hat keinen Port – bitte anhalten und neu starten.', 'docker');
        this.recover(id);
        return { port: info.port };
      }
      return this.startGate.run(async () => {
        const running = await this.containers(false);
        if (running.size >= this.config.maxRunning) {
          throw new AgentError('Gerade sind alle Plätze belegt – versuch es in ein paar Minuten noch einmal.', 'full');
        }
        this.starting.add(id);
        try {
          return await this.runContainer(id, cfg, info !== null, running);
        } finally {
          this.starting.delete(id);
        }
      });
    });
  }

  /** Dateien vorbereiten (Welt gestoppt), Port wählen, Container starten, Konsole anhängen. */
  private async runContainer(id: string, cfg: WorldConfig, hasContainer: boolean, running: Map<string, number | null>): Promise<{ port: number }> {
    if (hasContainer) await this.removeContainer(id);
    await this.ensureNetwork();
    await this.prepareForStart(id, cfg);
    const used = new Set([...running.values()].filter((port): port is number => port !== null));
    for (let attempt = 0; attempt < 5; attempt++) {
      const port = await this.pickPort(used);
      try {
        await this.docker.run(
          runArgs({ world: id, port, memoryMb: cfg.memoryMb, jarFile: cfg.jar.file, dataDir: this.dataDir(id), jarsDir: this.jarsDir }),
          180_000,
        );
      } catch (err) {
        await this.removeContainer(id).catch(() => {});
        if (err instanceof DockerFailure && /port is already allocated|address already in use|bind for/i.test(err.stderr)) {
          used.add(port);
          continue;
        }
        throw err;
      }
      this.attach(id, this.freshLive(id));
      this.log(`Welt ${id} gestartet (Port ${port}, ${cfg.memoryMb} MB, ${cfg.jar.software} ${cfg.jar.version})`);
      return { port };
    }
    throw new AgentError('Kein freier Port für die Welt gefunden.', 'docker');
  }

  private async pickPort(used: Set<number>): Promise<number> {
    const free: number[] = [];
    for (let port = this.config.portMin; port <= this.config.portMax; port++) if (!used.has(port)) free.push(port);
    // zufällige Reihenfolge: ein eben frei gewordener Port geht nicht sofort an die nächste Welt
    for (let i = free.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [free[i], free[j]] = [free[j]!, free[i]!];
    }
    for (const port of free.slice(0, 64)) if (await portFree(port)) return port;
    throw new AgentError('Kein freier Port für die Welt gefunden.', 'docker');
  }

  async stop(world: string, options: { timeoutMs?: number } = {}): Promise<void> {
    const id = checkWorld(world);
    const timeout = options.timeoutMs === undefined ? 60_000 : checkInt(options.timeoutMs, 1000, 600_000, 'Zeitgrenze (ms)');
    await this.withLock(id, async () => {
      const info = await this.inspect(id);
      if (!info || !RUNNING_STATES.has(info.status)) {
        this.dropLive(id);
        if (await this.worldExists(id)) await this.applyPendingFiles(id);
        return;
      }
      const live = this.live.get(id) ?? this.recover(id);
      live.stopping = true;
      let exited = false;
      try {
        await this.sendLine(id, 'stop');
        exited = await this.waitExit(id, timeout);
      } catch (err) {
        this.log(`Welt ${id}: „stop“ an die Konsole ging nicht (${message(err)}).`);
      }
      if (!exited) {
        this.log(`Welt ${id} hält nicht von selbst an – beende den Container.`);
        await this.docker.run(['stop', '-t', '10', containerName(id)], 60_000).catch((err) => this.log(`docker stop: ${message(err)}`));
        exited = await this.waitExit(id, 15_000);
        if (!exited) await this.docker.run(['kill', containerName(id)], 30_000).catch(() => {});
      }
      this.dropLive(id);
      await this.applyPendingFiles(id);
      this.log(`Welt ${id} angehalten`);
    });
  }

  async state(world: string): Promise<RunnerState> {
    const id = checkWorld(world);
    if (this.starting.has(id)) return 'starting';
    const info = await this.inspect(id);
    if (!info) return (await this.worldExists(id)) ? 'stopped' : 'missing';
    if (info.status === 'removing') return 'stopping';
    const known = this.live.get(id);
    if (!RUNNING_STATES.has(info.status)) {
      if (known && !known.stopping) this.dropLive(id);
      return known?.stopping ? 'stopping' : 'stopped';
    }
    const live = known ?? this.recover(id);
    await live.recovered;
    if (live.stopping) return 'stopping';
    return live.ready ? 'running' : 'starting';
  }

  async port(world: string): Promise<number | null> {
    const id = checkWorld(world);
    const info = await this.inspect(id);
    return info && RUNNING_STATES.has(info.status) ? info.port : null;
  }

  async command(world: string, line: string): Promise<void> {
    const id = checkWorld(world);
    const text = checkConsoleLine(line);
    if (!(await this.isRunning(id))) throw new AgentError('Die Welt läuft gerade nicht.', 'not-running');
    await this.sendLine(id, text);
  }

  async recentLogs(world: string, lines: number): Promise<string[]> {
    const id = checkWorld(world);
    const count = checkInt(lines, 1, 2000, 'Zeilen');
    if (await this.inspect(id)) return this.collectLogs(id, count);
    if (!(await this.worldExists(id))) throw new AgentError('Diese Welt gibt es beim Welten-Wächter nicht.', 'not-found');
    // ohne Container: das letzte Log des Servers aus dem Datenordner
    try {
      const fh = await openInside(this.dataDir(id), ['logs', 'latest.log'], O_RDONLY);
      try {
        const st = await fh.stat();
        const length = Math.min(st.size, 2 * 1024 * 1024);
        const buf = Buffer.alloc(length);
        await fh.read(buf, 0, length, st.size - length);
        return buf.toString('utf8').split('\n').map((line) => cleanLogLine(line.replace(/\r$/, ''))).filter((line) => line !== '').slice(-count);
      } finally {
        await fh.close();
      }
    } catch {
      return [];
    }
  }

  private collectLogs(id: string, count: number): Promise<string[]> {
    return new Promise((resolve) => {
      let child: ChildProcess;
      try {
        child = this.docker.spawn(['logs', '--tail', String(count), containerName(id)], ['ignore', 'pipe', 'pipe']);
      } catch {
        resolve([]);
        return;
      }
      const lines: string[] = [];
      const out = new LogSplitter();
      const err = new LogSplitter();
      const timer = setTimeout(() => child.kill(), 30_000);
      child.stdout?.on('data', (chunk: Buffer) => lines.push(...out.push(chunk)));
      child.stderr?.on('data', (chunk: Buffer) => lines.push(...err.push(chunk)));
      child.on('error', () => {
        clearTimeout(timer);
        resolve([]);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        lines.push(...out.flush(), ...err.flush());
        resolve(code === 0 ? lines.map(cleanLogLine).slice(-count) : []);
      });
    });
  }

  followLogs(world: string, onLine: (line: string) => void): () => void {
    const id = checkWorld(world);
    let set = this.subscribers.get(id);
    if (!set) {
      set = new Set();
      this.subscribers.set(id, set);
    }
    set.add(onLine);
    void this.isRunning(id).then(
      (running) => {
        if (running) this.recover(id);
      },
      () => {},
    );
    return () => {
      const current = this.subscribers.get(id);
      current?.delete(onLine);
      if (current && current.size === 0) this.subscribers.delete(id);
    };
  }

  async stats(world: string): Promise<RunnerStats> {
    const id = checkWorld(world);
    await this.requireWorld(id);
    const info = await this.inspect(id);
    let memoryMb = 0;
    let cpuPercent = 0;
    if (info?.status === 'running') {
      const { stdout } = await this.docker.run(['stats', '--no-stream', '--format', '{{.MemUsage}}|{{.CPUPerc}}', containerName(id)], 60_000);
      const [memory = '', cpu = ''] = (stdout.trim().split('\n')[0] ?? '').split('|');
      memoryMb = Math.round(parseDockerSize(memory.split('/')[0] ?? '') / 1048576);
      cpuPercent = Math.round((Number.parseFloat(cpu.replace('%', '')) || 0) * 10) / 10;
    }
    return { memoryMb, cpuPercent, diskMb: Math.round((await this.diskBytes(id)) / 1048576) };
  }

  /** Belegter Speicher: Datenordner (ohne die Server-Dateien von Paper/Mojang) und Sicherungen. */
  private async diskBytes(id: string): Promise<number> {
    let total = 0;
    try {
      await walkFiles(
        this.dataDir(id),
        [],
        { maxEntries: 1_000_000, maxDepth: 64, skip: (parts, entry) => parts.length === 1 && entry.isDirectory() && SERVER_FILES.has(entry.name) },
        (_parts, st) => {
          total += st.size;
        },
      );
    } catch (err) {
      if (!(err instanceof AgentError)) throw err;
    }
    for (const backup of await this.listBackupsOf(id)) total += backup.sizeBytes;
    return total;
  }

  async setProperties(world: string, properties: Record<string, string>, motd?: string): Promise<void> {
    const id = checkWorld(world);
    const props = checkProperties(properties);
    const newMotd = motd === undefined ? undefined : checkMotd(motd);
    await this.withLock(id, async () => {
      const cfg = await this.requireConfig(id);
      const next: WorldConfig = { ...cfg, properties: { ...cfg.properties, ...props }, motd: newMotd ?? cfg.motd, updatedAt: Date.now() };
      await this.writeWorldConfig(id, next);
      if (!(await this.isRunning(id))) await this.writeManagedFiles(id, next);
    });
  }

  // ------------------------------------------------------------------------------------------
  // Plugins (nur Modrinth, geprüft mit SHA-512)
  // ------------------------------------------------------------------------------------------

  private async readStore(id: string): Promise<StoredPlugin[]> {
    const list = await readJsonOrNull<StoredPlugin[]>(path.join(this.worldDir(id), STORE, STORE_INDEX));
    if (!Array.isArray(list)) return [];
    return list.filter((p) => {
      try {
        checkPluginName(p.name);
        checkModrinthUrl(p.url);
        checkSha(p.sha512, 128, 'SHA-512');
        return true;
      } catch {
        return false;
      }
    });
  }

  private async writeStore(id: string, list: StoredPlugin[]): Promise<void> {
    const dir = await ensureDir(this.worldDir(id), STORE, null, 0o700);
    const sorted = [...list].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    await writeAtomic(dir, STORE_INDEX, `${JSON.stringify(sorted, null, 2)}\n`, { owner: null, mode: 0o600 });
  }

  async listPlugins(world: string): Promise<string[]> {
    const id = checkWorld(world);
    await this.requireWorld(id);
    return (await this.readStore(id)).map((plugin) => plugin.name);
  }

  async installPlugin(world: string, file: PluginFile): Promise<void> {
    const id = checkWorld(world);
    const plugin = checkPluginFile(file);
    await this.withLock(id, async () => {
      const cfg = await this.requireConfig(id);
      if (cfg.jar.software !== 'paper') throw new AgentError('Vanilla-Server haben keine Plugins (nur Paper).', 'invalid');
      const list = await this.readStore(id);
      if (!list.some((p) => p.name === plugin.name) && list.length >= MAX_PLUGINS) {
        throw new AgentError(`Höchstens ${MAX_PLUGINS} Plugins je Welt.`, 'too-large');
      }
      const tmp = await downloadVerified({
        url: plugin.url,
        fetchUrl: this.config.fetchUrl,
        algorithm: 'sha512',
        expected: plugin.sha512,
        maxBytes: MAX_PLUGIN_BYTES,
        timeoutMs: 5 * 60_000,
        tmpDir: this.tmpDir,
        userAgent: this.userAgent,
      });
      try {
        const store = await ensureDir(this.worldDir(id), STORE, null, 0o700);
        await fsp.rename(tmp, path.join(store, plugin.name));
      } catch (err) {
        await fsp.rm(tmp, { force: true });
        throw err;
      }
      await this.writeStore(id, [...list.filter((p) => p.name !== plugin.name), { ...plugin, installedAt: Date.now() }]);
      if (!(await this.isRunning(id))) await this.syncPlugins(id);
      this.log(`Welt ${id}: Plugin ${plugin.name} installiert`);
    });
  }

  async removePlugin(world: string, name: string): Promise<void> {
    const id = checkWorld(world);
    const pluginName = checkPluginName(name);
    await this.withLock(id, async () => {
      await this.requireWorld(id);
      const list = await this.readStore(id);
      if (list.some((p) => p.name === pluginName)) {
        await this.writeStore(id, list.filter((p) => p.name !== pluginName));
        await fsp.rm(path.join(this.worldDir(id), STORE, pluginName), { force: true });
      }
      if ((await this.readWorldConfig(id))?.jar.software === 'paper' && !(await this.isRunning(id))) await this.syncPlugins(id);
    });
  }

  // ------------------------------------------------------------------------------------------
  // Plugin-Dateien (Textdateien unter plugins/)
  // ------------------------------------------------------------------------------------------

  private async readPending(id: string): Promise<Record<string, string>> {
    const index = await readJsonOrNull<{ files?: Record<string, unknown> }>(path.join(this.worldDir(id), PENDING, PENDING_INDEX));
    const files: Record<string, string> = {};
    for (const [rel, stored] of Object.entries(index?.files ?? {})) {
      try {
        if (checkPluginFilePath(rel) === rel && typeof stored === 'string' && /^[0-9a-f]{32}\.txt$/.test(stored)) files[rel] = stored;
      } catch {
        // ungültiger Eintrag: übergehen
      }
    }
    return files;
  }

  private async writePending(id: string, files: Record<string, string>): Promise<void> {
    const dir = await ensureDir(this.worldDir(id), PENDING, null, 0o700);
    await writeAtomic(dir, PENDING_INDEX, JSON.stringify({ files }), { owner: null, mode: 0o600 });
  }

  /** Datei im Datenordner schreiben (nur bei gestoppter Welt); der Ordner muss es schon geben. */
  private async writeDataFile(id: string, rel: string, bytes: Buffer): Promise<void> {
    const parts = rel.split('/');
    let dir = this.dataDir(id);
    for (const part of parts.slice(0, -1)) {
      dir = path.join(dir, part);
      const st = await lstatOrNull(dir);
      if (!st) throw new AgentError(`Den Ordner ${parts.slice(0, -1).join('/')} gibt es nicht.`, 'not-found');
      if (!st.isDirectory()) throw new AgentError('Pfad führt über einen Link oder eine Datei.');
    }
    const name = parts[parts.length - 1]!;
    if ((await lstatOrNull(path.join(dir, name)))?.isDirectory()) throw new AgentError('Das ist ein Ordner, keine Datei.');
    await writeAtomic(dir, name, bytes, { owner: this.config.owner, mode: 0o644 });
  }

  private async applyPendingFiles(id: string): Promise<void> {
    const dir = path.join(this.worldDir(id), PENDING);
    if (!(await lstatOrNull(dir))) return;
    if (await this.isRunning(id)) return;
    for (const [rel, stored] of Object.entries(await this.readPending(id))) {
      try {
        await this.writeDataFile(id, rel, await fsp.readFile(path.join(dir, stored)));
      } catch (err) {
        this.log(`Welt ${id}: ${rel} ließ sich nicht übernehmen (${message(err)}).`);
      }
    }
    await fsp.rm(dir, { recursive: true, force: true });
  }

  async readFile(world: string, relativePath: string): Promise<string> {
    const id = checkWorld(world);
    const rel = checkPluginFilePath(relativePath);
    await this.requireWorld(id);
    const stored = (await this.readPending(id))[rel];
    if (stored) return (await fsp.readFile(path.join(this.worldDir(id), PENDING, stored))).toString('utf8');
    const buf = await readInside(this.dataDir(id), rel.split('/'), MAX_TEXT_FILE_BYTES);
    if (buf.includes(0)) throw new AgentError('Das ist keine Textdatei.');
    return buf.toString('utf8');
  }

  async writeFile(world: string, relativePath: string, content: string): Promise<void> {
    const id = checkWorld(world);
    const rel = checkPluginFilePath(relativePath);
    const bytes = checkTextContent(content);
    await this.withLock(id, async () => {
      await this.requireWorld(id);
      if (await this.isRunning(id)) {
        // Welt läuft: merken und nach dem Anhalten übernehmen (der Ordner muss es schon geben)
        let dir = this.dataDir(id);
        for (const part of rel.split('/').slice(0, -1)) {
          dir = path.join(dir, part);
          if (!(await lstatOrNull(dir))?.isDirectory()) throw new AgentError('Den Ordner gibt es nicht.', 'not-found');
        }
        const pending = await this.readPending(id);
        const stored = `${createHash('sha256').update(rel).digest('hex').slice(0, 32)}.txt`;
        const pendingDir = await ensureDir(this.worldDir(id), PENDING, null, 0o700);
        await writeAtomic(pendingDir, stored, bytes, { owner: null, mode: 0o600 });
        await this.writePending(id, { ...pending, [rel]: stored });
        return;
      }
      await this.writeDataFile(id, rel, bytes);
      const pending = await this.readPending(id);
      if (pending[rel]) {
        const { [rel]: _dropped, ...rest } = pending;
        await this.writePending(id, rest);
      }
    });
  }

  async listFiles(world: string): Promise<string[]> {
    const id = checkWorld(world);
    await this.requireWorld(id);
    const files = new Set<string>();
    if ((await lstatOrNull(path.join(this.dataDir(id), 'plugins')))?.isDirectory()) {
      await walkFiles(
        this.dataDir(id),
        ['plugins'],
        { maxEntries: 20_000, maxDepth: 8, skip: (_parts, entry) => entry.name.startsWith('.') },
        (parts, st) => {
          if (files.size >= 2000 || st.size > MAX_TEXT_FILE_BYTES) return;
          const rel = parts.join('/');
          try {
            if (checkPluginFilePath(rel) === rel) files.add(rel);
          } catch {
            // keine erlaubte Textdatei
          }
        },
      ).catch((err: unknown) => {
        if (!(err instanceof AgentError)) throw err;
      });
    }
    for (const rel of Object.keys(await this.readPending(id))) files.add(rel);
    return [...files].sort();
  }

  // ------------------------------------------------------------------------------------------
  // Import und Export (Upload-Ordner des Dienstes)
  // ------------------------------------------------------------------------------------------

  /** Upload-Ordner: muss ein echter Ordner genau unter dem eingestellten Pfad sein (kein Link dorthin). */
  private async uploadsRoot(): Promise<string> {
    let real: string;
    try {
      real = await fsp.realpath(this.config.uploadsDir);
    } catch {
      throw new AgentError('Den Upload-Ordner des Dienstes gibt es nicht.', 'not-found');
    }
    const expected = path.resolve(this.config.uploadsDir);
    const same = process.platform === 'win32' ? real.toLowerCase() === expected.toLowerCase() : real === expected;
    if (!same) throw new AgentError('Der Upload-Ordner des Dienstes ist ein Link – abgelehnt.', 'invalid');
    return real;
  }

  private async openUpload(parts: string[]): Promise<FileHandle> {
    const fh = await openInside(await this.uploadsRoot(), parts, O_RDONLY);
    const st = await fh.stat();
    if (!st.isFile()) {
      await fh.close();
      throw new AgentError('Keine normale Datei.');
    }
    return fh;
  }

  /**
   * Neue Datei im Upload-Ordner (O_EXCL, Rechte 0640, Besitzer wie der Upload-Ordner, damit der Dienst sie lesen und
   * löschen kann). Bei einem Fehler wird sie nur geleert – löschen soll der Dienst sie selbst (kein Löschen über einen
   * Pfad, den ein anderer Prozess umlenken könnte).
   */
  private async createUpload(parts: string[], write: (fh: FileHandle) => Promise<void>): Promise<void> {
    const root = await this.uploadsRoot();
    const fh = await openInside(root, parts, O_WRONLY | O_CREAT | O_EXCL, 0o640);
    try {
      if (isRoot()) {
        const st = await fsp.stat(root);
        await fh.chown(st.uid, st.gid);
      }
      await write(fh);
    } catch (err) {
      await fh.truncate(0).catch(() => {});
      throw err;
    } finally {
      await fh.close();
    }
  }

  private async checkFreeSpace(bytes: number): Promise<void> {
    try {
      const st = await fsp.statfs(this.dataReal);
      if (st.bavail * st.bsize < bytes + 512 * 1024 * 1024) throw new AgentError('Auf dem Server ist nicht genug Speicherplatz frei.', 'too-large');
    } catch (err) {
      if (err instanceof AgentError) throw err;
    }
  }

  /** Entpackt Einträge in einen frischen Ordner des Wächters (in Reihenfolge der Offsets, also ohne Überlappung). */
  private async extractInto(reader: ZipReader, items: { item: ZipItem; parts: string[] }[], staging: string): Promise<void> {
    const owner = this.config.owner;
    const made = new Set<string>([staging]);
    const mkdirs = async (parts: string[]): Promise<string> => {
      let dir = staging;
      for (const part of parts) {
        dir = path.join(dir, part);
        if (made.has(dir)) continue;
        try {
          await fsp.mkdir(dir, { mode: 0o755 });
        } catch (err) {
          if (!isErrnoCode(err, 'EEXIST')) throw err;
        }
        if (owner) await fsp.lchown(dir, owner.uid, owner.gid);
        made.add(dir);
      }
      return dir;
    };
    let minOffset = 0;
    for (const { item, parts } of [...items].sort((a, b) => a.item.localOffset - b.item.localOffset)) {
      if (item.directory) {
        await mkdirs(parts);
        minOffset = await reader.extract(item, async () => {}, minOffset);
        continue;
      }
      const dir = await mkdirs(parts.slice(0, -1));
      const out = await fsp.open(path.join(dir, parts[parts.length - 1]!), O_WRONLY | O_CREAT | O_EXCL | FLAGS_NOFOLLOW, 0o644);
      try {
        let position = 0;
        minOffset = await reader.extract(
          item,
          async (chunk) => {
            await writeAllAt(out, chunk, position);
            position += chunk.length;
          },
          minOffset,
        );
        if (owner) await out.chown(owner.uid, owner.gid);
        await out.utimes(item.mtime, item.mtime);
      } finally {
        await out.close();
      }
    }
  }

  async importWorld(world: string, zipPath: string): Promise<void> {
    const id = checkWorld(world);
    const parts = checkUploadPath(zipPath, this.config.uploadsDir);
    await this.withLock(id, () =>
      this.heavy.run(async () => {
        await this.requireStopped(id);
        const data = await this.ensureWorldDirs(id);
        const fh = await this.openUpload(parts);
        try {
          const reader = await ZipReader.open(fh, this.importLimits);
          const prefix = worldPrefix(reader.entries);
          const items = reader.entries
            .filter((e) => e.name.startsWith(prefix) && e.name !== prefix && e.name !== `${prefix}session.lock`)
            .map((item) => ({ item, parts: item.name.slice(prefix.length).replace(/\/$/, '').split('/') }));
          await this.checkFreeSpace(items.reduce((sum, { item }) => sum + item.size, 0));
          const staging = path.join(this.worldDir(id), `.import-${randomBytes(6).toString('hex')}`);
          await fsp.mkdir(staging, { mode: 0o755 });
          if (this.config.owner) await fsp.lchown(staging, this.config.owner.uid, this.config.owner.gid);
          try {
            await this.extractInto(reader, items, staging);
            for (const name of ['world', 'world_nether', 'world_the_end']) await fsp.rm(path.join(data, name), { recursive: true, force: true });
            await fsp.rename(staging, path.join(data, 'world'));
          } catch (err) {
            await fsp.rm(staging, { recursive: true, force: true });
            throw err;
          }
          this.log(`Welt ${id}: Welt importiert (${items.length} Einträge)`);
        } finally {
          await fh.close();
        }
      }),
    );
  }

  /** Eine Datei ins ZIP (Lesen über openVerified, auch bei laufender Welt sicher); verschwundene oder umgelenkte übergehen. */
  private async addFileTo(zip: ZipWriter, root: string, parts: string[], name: string): Promise<void> {
    let fh: FileHandle;
    try {
      fh = await openVerified(root, path.join(root, ...parts), O_RDONLY);
    } catch {
      return;
    }
    try {
      const st = await fh.stat();
      if (st.isFile()) await zip.addFile(name, fh, st.mtime);
    } catch (err) {
      // ungültiger Name im Archiv (z. B. Steuerzeichen im Dateinamen): übergehen, alles andere ist ein Fehler
      if (!(err instanceof AgentError && err.code === 'invalid')) throw err;
    } finally {
      await fh.close();
    }
  }

  /** Dateien eines Teilbaums ins ZIP. */
  private async addTree(zip: ZipWriter, root: string, start: string[], mapName: (parts: string[]) => string | null, skip?: (parts: string[], dir: boolean) => boolean): Promise<void> {
    await walkFiles(root, start, { maxEntries: 600_000, maxDepth: 48, skip: (parts, entry) => skip?.(parts, entry.isDirectory()) ?? false }, async (parts) => {
      const name = mapName(parts);
      if (name !== null) await this.addFileTo(zip, root, parts, name);
    });
  }

  async exportWorld(world: string, zipPath: string): Promise<void> {
    const id = checkWorld(world);
    const parts = checkUploadPath(zipPath, this.config.uploadsDir);
    await this.withLock(id, () =>
      this.heavy.run(async () => {
        await this.requireWorld(id);
        const data = this.dataDir(id);
        if (!(await lstatOrNull(path.join(data, 'world')))?.isDirectory()) throw new AgentError('Die Welt hat noch keine Weltdaten.', 'not-found');
        await this.createUpload(parts, (fh) =>
          this.quiesced(id, async () => {
            // Paper legt Nether und End in eigene Ordner (world_nether/DIM-1, world_the_end/DIM1, ggf. dimensions/);
            // zurück ins Einzelspieler-Format: alles in eine Welt, die Ordner der Paper-Welten gewinnen
            const files = new Map<string, string[]>();
            const collect = async (start: string[], strip: number) => {
              if (!(await lstatOrNull(path.join(data, ...start)))?.isDirectory()) return;
              await walkFiles(data, start, { maxEntries: 600_000, maxDepth: 48 }, (p) => {
                const rel = p.slice(strip);
                if (strip === 1 && rel.length === 1 && ['session.lock', 'uid.dat', 'paper-world.yml'].includes(rel[0]!)) return;
                files.set(rel.join('/'), p);
              });
            };
            await collect(['world'], 1);
            for (const extra of ['world_nether', 'world_the_end']) {
              for (const sub of ['DIM-1', 'DIM1', 'dimensions']) {
                // Hat Paper die Dimension schon in seinen eigenen Ordner geholt, ist die Kopie in world/ veraltet
                if (sub !== 'dimensions' && (await lstatOrNull(path.join(data, extra, sub)))?.isDirectory()) {
                  for (const name of [...files.keys()]) if (name.startsWith(`${sub}/`) && files.get(name)![0] === 'world') files.delete(name);
                }
                await collect([extra, sub], 1);
              }
            }
            const zip = new ZipWriter(fh);
            for (const name of [...files.keys()].sort()) await this.addFileTo(zip, data, files.get(name)!, name);
            await zip.finish();
          }),
        );
        this.log(`Welt ${id}: Welt exportiert`);
      }),
    );
  }

  // ------------------------------------------------------------------------------------------
  // Sicherungen
  // ------------------------------------------------------------------------------------------

  private async listBackupsOf(id: string): Promise<BackupInfo[]> {
    const dir = path.join(this.worldDir(id), BACKUPS);
    let names: string[];
    try {
      names = await fsp.readdir(dir);
    } catch {
      return [];
    }
    const result: BackupInfo[] = [];
    for (const file of names) {
      if (!file.endsWith('.zip')) continue;
      const name = file.slice(0, -4);
      try {
        checkBackupName(name);
      } catch {
        continue;
      }
      const st = await lstatOrNull(path.join(dir, file));
      if (st?.isFile()) result.push({ name, sizeBytes: st.size, createdAt: Math.round(st.mtimeMs) });
    }
    return result.sort((a, b) => b.createdAt - a.createdAt || (a.name < b.name ? 1 : -1));
  }

  async backup(world: string, name: string): Promise<BackupInfo> {
    const id = checkWorld(world);
    const backupName = checkBackupName(name);
    return this.withLock(id, () =>
      this.heavy.run(async () => {
        await this.requireWorld(id);
        const dir = await ensureDir(this.worldDir(id), BACKUPS, null, 0o700);
        const final = path.join(dir, `${backupName}.zip`);
        if (await lstatOrNull(final)) throw new AgentError('Eine Sicherung mit diesem Namen gibt es schon.', 'exists');
        // Obergrenze als Schutz der Platte; alte Sicherungen löscht der Dienst selbst (deleteBackup), nie der Wächter
        if ((await this.listBackupsOf(id)).length >= this.config.maxBackups) {
          throw new AgentError(`Höchstens ${this.config.maxBackups} Sicherungen je Welt – bitte zuerst alte löschen.`, 'too-large');
        }
        const part = path.join(dir, `.${backupName}.${randomBytes(4).toString('hex')}.part`);
        const store = await this.readStore(id);
        const data = this.dataDir(id);
        await this.quiesced(id, async () => {
          const fh = await fsp.open(part, O_WRONLY | O_CREAT | O_EXCL | FLAGS_NOFOLLOW, 0o600);
          try {
            const zip = new ZipWriter(fh);
            await this.addTree(
              zip,
              data,
              [],
              (p) => p.join('/'),
              (p, isDir) =>
                (p.length === 1 && NOT_IN_BACKUP.has(p[0]!)) ||
                // Paper legt dort umgeschriebene Plugin-Jars ab; die entstehen beim Start neu
                (p.length === 2 && p[0] === 'plugins' && p[1] === '.paper-remapped') ||
                (!isDir && p[p.length - 1] === 'session.lock'),
            );
            await zip.addBuffer(MANIFEST_ENTRY, Buffer.from(JSON.stringify(store.map(({ name: n, url, sha512 }) => ({ name: n, url, sha512 })))));
            await zip.finish();
          } catch (err) {
            await fh.close();
            await fsp.rm(part, { force: true });
            throw err;
          }
          await fh.close();
        });
        await fsp.rename(part, final);
        const st = await fsp.stat(final);
        this.log(`Welt ${id}: Sicherung ${backupName} angelegt (${Math.round(st.size / 1048576)} MB)`);
        return { name: backupName, sizeBytes: st.size, createdAt: Math.round(st.mtimeMs) };
      }),
    );
  }

  async listBackups(world: string): Promise<BackupInfo[]> {
    const id = checkWorld(world);
    await this.requireWorld(id);
    return this.listBackupsOf(id);
  }

  private async openBackup(id: string, name: string): Promise<FileHandle> {
    try {
      return await openInside(this.worldDir(id), [BACKUPS, `${name}.zip`], O_RDONLY);
    } catch (err) {
      if (err instanceof AgentError && err.code === 'not-found') throw new AgentError('Diese Sicherung gibt es nicht.', 'not-found');
      throw err;
    }
  }

  async restoreBackup(world: string, name: string): Promise<void> {
    const id = checkWorld(world);
    const backupName = checkBackupName(name);
    await this.withLock(id, () =>
      this.heavy.run(async () => {
        await this.requireWorld(id);
        await this.requireStopped(id);
        const fh = await this.openBackup(id, backupName);
        const worldDir = this.worldDir(id);
        const staging = path.join(worldDir, `.restore-${randomBytes(6).toString('hex')}`);
        const newStore = path.join(worldDir, `.store-${randomBytes(6).toString('hex')}`);
        const trash = path.join(worldDir, `.trash-${randomBytes(6).toString('hex')}`);
        try {
          const limit = this.config.diskLimitBytes * 2;
          const reader = await ZipReader.open(fh, { maxEntries: 600_000, maxTotalBytes: limit, maxEntryBytes: limit });
          let manifest: unknown = [];
          const items: { item: ZipItem; parts: string[] }[] = [];
          for (const item of reader.entries) {
            const parts = item.name.replace(/\/$/, '').split('/');
            if (item.name === MANIFEST_ENTRY) {
              try {
                manifest = JSON.parse((await reader.readSmall(item, 1024 * 1024)).toString('utf8'));
              } catch {
                manifest = [];
              }
              continue;
            }
            if (NOT_IN_BACKUP.has(parts[0]!)) continue;
            items.push({ item, parts });
          }
          await this.checkFreeSpace(items.reduce((sum, { item }) => sum + item.size, 0));
          await fsp.mkdir(staging, { mode: 0o700 });
          if (this.config.owner) await fsp.lchown(staging, this.config.owner.uid, this.config.owner.gid);
          await this.extractInto(reader, items, staging);
          // Plugins: nur Jars, deren SHA-512 zur Liste der Sicherung passt, kommen wieder in den Speicher des Wächters
          const verified: StoredPlugin[] = [];
          await fsp.mkdir(newStore, { mode: 0o700 });
          for (const entry of Array.isArray(manifest) ? manifest.slice(0, MAX_PLUGINS) : []) {
            try {
              const plugin = checkPluginFile(entry);
              const jar = path.join(staging, 'plugins', plugin.name);
              if (!(await lstatOrNull(jar))?.isFile() || (await hashFile(jar, 'sha512')) !== plugin.sha512) continue;
              await copyAtomic(jar, newStore, plugin.name, { owner: null, mode: 0o600 });
              verified.push({ ...plugin, installedAt: Date.now() });
            } catch {
              // unbrauchbarer Eintrag: Plugin fällt weg
            }
          }
          // Tausch: alles außer den Server-Dateien und Logs zur Seite, dann die Sicherung an ihren Platz
          const data = this.dataDir(id);
          await fsp.mkdir(trash, { mode: 0o700 });
          for (const entry of await fsp.readdir(data)) {
            if (!KEEP_ON_RESTORE.has(entry)) await fsp.rename(path.join(data, entry), path.join(trash, entry));
          }
          for (const entry of await fsp.readdir(staging)) await fsp.rename(path.join(staging, entry), path.join(data, entry));
          await fsp.rm(path.join(worldDir, STORE), { recursive: true, force: true });
          await fsp.rename(newStore, path.join(worldDir, STORE));
          await this.writeStore(id, verified);
          await fsp.rm(path.join(worldDir, PENDING), { recursive: true, force: true });
          this.log(`Welt ${id}: Sicherung ${backupName} wiederhergestellt`);
        } finally {
          await fh.close();
          for (const dir of [staging, newStore, trash]) await fsp.rm(dir, { recursive: true, force: true });
        }
      }),
    );
  }

  async deleteBackup(world: string, name: string): Promise<void> {
    const id = checkWorld(world);
    const backupName = checkBackupName(name);
    await this.withLock(id, async () => {
      const file = path.join(this.worldDir(id), BACKUPS, `${backupName}.zip`);
      if (!(await lstatOrNull(file))?.isFile()) throw new AgentError('Diese Sicherung gibt es nicht.', 'not-found');
      await fsp.rm(file, { force: true });
    });
  }

  async exportBackup(world: string, name: string, zipPath: string): Promise<void> {
    const id = checkWorld(world);
    const backupName = checkBackupName(name);
    const parts = checkUploadPath(zipPath, this.config.uploadsDir);
    await this.heavy.run(async () => {
      const source = await this.openBackup(id, backupName);
      try {
        await this.createUpload(parts, async (out) => {
          let position = 0;
          for await (const chunk of readChunks(source)) {
            await writeAllAt(out, chunk, position);
            position += chunk.length;
          }
        });
      } finally {
        await source.close();
      }
    });
  }

  // ------------------------------------------------------------------------------------------
  // Entfernen und Liste
  // ------------------------------------------------------------------------------------------

  async remove(world: string): Promise<void> {
    const id = checkWorld(world);
    await this.withLock(id, async () => {
      await this.removeContainer(id);
      this.dropLive(id);
      const dir = this.worldDir(id);
      if (isInside(this.worldsDir, dir) && dir !== this.worldsDir) await fsp.rm(dir, { recursive: true, force: true });
      this.log(`Welt ${id} entfernt`);
    });
    void this.cleanupJars();
  }

  async list(): Promise<string[]> {
    const ids = new Set<string>();
    for (const name of await fsp.readdir(this.worldsDir).catch(() => [] as string[])) {
      if (HOSTED_WORLD_ID_RE.test(name)) ids.add(name);
    }
    try {
      for (const id of (await this.containers(true)).keys()) ids.add(id);
    } catch (err) {
      this.log(`Liste der Container: ${message(err)}`);
    }
    return [...ids].sort();
  }
}
